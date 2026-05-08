/**
 * Phase 14.0.A — Sect Territory Influence Foundation.
 *
 * Pure data + deterministic helpers. KHÔNG runtime/schema/migration ở
 * file này — runtime ghi điểm ở `apps/api/src/modules/territory/territory.service.ts`.
 *
 * Mục tiêu Phase 14.0.A:
 *   - Mỗi region trên bản đồ (`MAP_REGIONS`) có một "Sect Influence"
 *     leaderboard riêng — sect nào contribute nhiều activity trong region
 *     thì rank cao.
 *   - Activity contribute điểm: dungeon clear, boss participation, boss
 *     top damage. Tương lai (14.0.B+): sect mission + region buff +
 *     decay/season reset.
 *   - Foundation thin layer: catalog + read-only API + idempotent hook
 *     fail-soft. KHÔNG settlement capture / siege / region-wide buff /
 *     decay logic — defer roadmap.
 *
 * Anti-abuse / balance:
 *   - Mỗi nguồn có `dailyCap` / `weeklyCap` per character (giới hạn farm
 *     boost rank cá nhân thay vì sect tập thể).
 *   - Idempotency tracked qua composite UNIQUE
 *     `(regionKey, characterId, sourceKey, sourceType, sourceId)` ở
 *     Prisma layer — runtime hook retry an toàn.
 *   - Server-authoritative; FE KHÔNG tự cộng điểm.
 *   - Character không thuộc sect → no-op (skip safely, không log).
 *
 * Source of truth:
 *   - `docs/LONG_TERM_ROADMAP.md` Phase 14 territory section.
 *   - `docs/BALANCE_MODEL.md` §territory dial table (foundation).
 *   - `docs/CHANGELOG.md` Phase 14.0.A entry.
 */

import {
  MAP_REGIONS,
  isMapRegionKey,
  type MapRegionDef,
  type RegionKey,
} from './map-regions';

// ────────────────────────────────────────────────────────────────────────
// Types
// ────────────────────────────────────────────────────────────────────────

/**
 * Influence source key — stable identifier cho idempotent hook + ledger
 * reason. Append-only; ĐỪNG rename / remove sau khi production.
 */
export type TerritoryInfluenceSourceKey =
  | 'dungeon_clear'
  | 'boss_participation'
  | 'boss_top_damage';

/**
 * Source type — gắn vào idempotency key cùng `sourceId`. Convention 1
 * sourceType ↔ 1 entity domain (vd `DungeonRun.id`, `WorldBoss.id`).
 *
 * Cùng `(regionKey, characterId, sourceKey, sourceType, sourceId)` chỉ
 * ghi 1 row → runtime retry an toàn.
 */
export type TerritoryInfluenceSourceType = 'DungeonRun' | 'WorldBoss';

export interface TerritoryInfluenceSourceDef {
  /** Source key — DB stable identifier. */
  readonly key: TerritoryInfluenceSourceKey;
  /** Điểm cộng cho Sect mỗi lần trigger. Server-authoritative. */
  readonly points: number;
  /**
   * Daily cap per character per region (0 / undefined = unlimited).
   * Reset 00:00 ICT cùng mọi daily reset.
   */
  readonly dailyCap?: number;
  /**
   * Weekly cap per character per region (0 / undefined = unlimited).
   * Reset Monday 00:00 ICT cùng ISO week.
   */
  readonly weeklyCap?: number;
  /** Source type cho idempotency. */
  readonly sourceType: TerritoryInfluenceSourceType;
  /** i18n key cho FE label (vd `territory.source.dungeon_clear.label`). */
  readonly labelI18nKey: string;
  /** i18n key cho FE description. */
  readonly descriptionI18nKey: string;
}

export interface TerritoryRegionDef {
  /** Region key — phải tồn tại trong `MAP_REGIONS`. */
  readonly key: RegionKey;
  /**
   * Cap per-sect tổng influence trong region. 0 / undefined =
   * unlimited (không khuyến nghị production — để tránh mid-tier sect bị
   * crowded out hard, set cap mềm).
   *
   * Phase 14.0.A: cap soft = `Number.POSITIVE_INFINITY` cho mọi region
   * (không enforce). Defer Phase 14.0.B+ thêm cap thực tế khi có decay
   * + season reset.
   */
  readonly influenceCap: number;
  /** i18n key cho FE label override. Reuse `MapRegionDef.nameVi/En`. */
  readonly labelI18nKey: string;
  /** i18n key cho FE description ngắn (≤ 200 ký tự). */
  readonly descriptionI18nKey: string;
}

/**
 * Aggregate row leaderboard — sect aggregate trong 1 region.
 *
 * `sectName` snapshot tại request time để FE render trực tiếp (tránh
 * extra round-trip). `points` là tổng influence của mọi character thuộc
 * sect đó trong region.
 */
export interface TerritoryLeaderboardRow {
  readonly rank: number;
  readonly sectId: string;
  readonly sectName: string;
  readonly points: number;
  readonly contributors: number;
}

export interface TerritoryRegionView {
  readonly regionKey: RegionKey;
  readonly nameVi: string;
  readonly nameEn: string;
  readonly flavorVi: string;
  readonly flavorEn: string;
  readonly unlockRealmKey: string;
  readonly sortOrder: number;
  readonly dominantElement: string | null;
  readonly totalPoints: number;
  readonly contributors: number;
  readonly topSectId: string | null;
  readonly topSectName: string | null;
  readonly topSectPoints: number;
}

export interface TerritoryRegionsView {
  readonly regions: ReadonlyArray<TerritoryRegionView>;
}

export interface TerritoryLeaderboardView {
  readonly regionKey: RegionKey;
  readonly rows: ReadonlyArray<TerritoryLeaderboardRow>;
}

export interface TerritoryMyRegionRow {
  readonly regionKey: RegionKey;
  readonly nameVi: string;
  readonly nameEn: string;
  readonly sectPoints: number;
  readonly sectRank: number | null;
  readonly personalPoints: number;
}

export interface TerritoryMyView {
  readonly hasSect: boolean;
  readonly sectId: string | null;
  readonly sectName: string | null;
  readonly regions: ReadonlyArray<TerritoryMyRegionRow>;
}

// ────────────────────────────────────────────────────────────────────────
// Catalog
// ────────────────────────────────────────────────────────────────────────

/**
 * Influence source catalog — order stable: dungeon → boss participation →
 * boss top damage. Đừng đảo trừ khi cần (snapshot test break).
 *
 * Balance philosophy (BALANCE_MODEL.md §territory):
 *   - dungeon_clear:        8 pts, dailyCap 60 (≈ 7-8 clear / region / day).
 *   - boss_participation:   12 pts, weeklyCap 96 (≈ 8 boss / region / week).
 *   - boss_top_damage:      20 pts bonus, weeklyCap 80 (≈ 4 top-rank / region / week).
 *
 * Soft envelope tổng / character / region / week:
 *   - dungeon: 60 pts/day × 7 = 420
 *   - boss:    96 pts/week
 *   - top:     80 pts/week
 *   = ~596 pts cá nhân tối đa / region / tuần.
 *
 * Sect 50 thành viên tích cực ⇒ ~30000 pts / region / tuần — đủ rank
 * mà không saturate. Sect 5 thành viên đỉnh ⇒ ~3000 pts — rank thấp
 * nhưng không 0.
 */
export const TERRITORY_INFLUENCE_SOURCES: readonly TerritoryInfluenceSourceDef[] =
  [
    {
      key: 'dungeon_clear',
      points: 8,
      dailyCap: 60,
      weeklyCap: 420,
      sourceType: 'DungeonRun',
      labelI18nKey: 'territory.source.dungeon_clear.label',
      descriptionI18nKey: 'territory.source.dungeon_clear.desc',
    },
    {
      key: 'boss_participation',
      points: 12,
      weeklyCap: 96,
      sourceType: 'WorldBoss',
      labelI18nKey: 'territory.source.boss_participation.label',
      descriptionI18nKey: 'territory.source.boss_participation.desc',
    },
    {
      key: 'boss_top_damage',
      points: 20,
      weeklyCap: 80,
      sourceType: 'WorldBoss',
      labelI18nKey: 'territory.source.boss_top_damage.label',
      descriptionI18nKey: 'territory.source.boss_top_damage.desc',
    },
  ];

/**
 * Territory region catalog — parity 1-1 với `MAP_REGIONS`. Mọi RegionKey
 * trong `MAP_REGIONS` phải có entry tương ứng trong `TERRITORY_REGIONS`.
 *
 * Phase 14.0.A `influenceCap = +Infinity` (no enforcement). Defer cap
 * thực tế khi Phase 14.0.B+ ship decay/season reset (cần cap để cycling
 * mới có tác dụng).
 */
export const TERRITORY_REGIONS: readonly TerritoryRegionDef[] = MAP_REGIONS.map(
  (r) => ({
    key: r.key,
    influenceCap: Number.POSITIVE_INFINITY,
    labelI18nKey: `territory.region.${r.key}.label`,
    descriptionI18nKey: `territory.region.${r.key}.desc`,
  }),
);

// ────────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────────

/**
 * Lookup region def + map data theo key. Trả `undefined` nếu không
 * tồn tại — caller phải xử lý null trước khi dereference.
 */
export function territoryRegionByKey(
  key: string,
): { def: TerritoryRegionDef; map: MapRegionDef } | undefined {
  if (!isMapRegionKey(key)) return undefined;
  const def = TERRITORY_REGIONS.find((r) => r.key === key);
  const map = MAP_REGIONS.find((r) => r.key === key);
  if (!def || !map) return undefined;
  return { def, map };
}

/**
 * Lookup influence source theo key. Trả `undefined` nếu không tồn tại.
 */
export function territorySourceByKey(
  key: string,
): TerritoryInfluenceSourceDef | undefined {
  return TERRITORY_INFLUENCE_SOURCES.find((s) => s.key === key);
}

/**
 * Type guard cho `TerritoryInfluenceSourceKey`. Dùng narrow string xuống
 * union khi parse input từ admin tooling / runtime hook caller.
 */
export function isTerritoryInfluenceSourceKey(
  key: string,
): key is TerritoryInfluenceSourceKey {
  return TERRITORY_INFLUENCE_SOURCES.some((s) => s.key === key);
}

export type TerritoryValidationCode =
  | 'REGION_NOT_IN_MAP'
  | 'REGION_DUPLICATE_KEY'
  | 'REGION_INVALID_CAP'
  | 'SOURCE_DUPLICATE_KEY'
  | 'SOURCE_INVALID_POINTS'
  | 'SOURCE_INVALID_DAILY_CAP'
  | 'SOURCE_INVALID_WEEKLY_CAP'
  | 'SOURCE_DAILY_LARGER_THAN_WEEKLY';

/**
 * Validate catalog tính nhất quán — gọi một lần ở test, KHÔNG gọi mỗi
 * runtime hook (catalog static, immutable).
 *
 * Trả về list error code rỗng nếu pass.
 */
export function validateTerritoryCatalog(): TerritoryValidationCode[] {
  const errors: TerritoryValidationCode[] = [];

  // ── Region parity ──
  const regionSeen = new Set<string>();
  const mapKeySet = new Set(MAP_REGIONS.map((r) => r.key));
  for (const r of TERRITORY_REGIONS) {
    if (!mapKeySet.has(r.key)) errors.push('REGION_NOT_IN_MAP');
    if (regionSeen.has(r.key)) errors.push('REGION_DUPLICATE_KEY');
    regionSeen.add(r.key);
    if (
      !(r.influenceCap === Number.POSITIVE_INFINITY) &&
      !(Number.isFinite(r.influenceCap) && r.influenceCap > 0)
    ) {
      errors.push('REGION_INVALID_CAP');
    }
  }
  for (const m of MAP_REGIONS) {
    if (!regionSeen.has(m.key)) errors.push('REGION_NOT_IN_MAP');
  }

  // ── Source dial ──
  const sourceSeen = new Set<string>();
  for (const s of TERRITORY_INFLUENCE_SOURCES) {
    if (sourceSeen.has(s.key)) errors.push('SOURCE_DUPLICATE_KEY');
    sourceSeen.add(s.key);
    if (!(Number.isFinite(s.points) && s.points > 0)) {
      errors.push('SOURCE_INVALID_POINTS');
    }
    if (
      s.dailyCap !== undefined &&
      !(Number.isFinite(s.dailyCap) && s.dailyCap >= 0)
    ) {
      errors.push('SOURCE_INVALID_DAILY_CAP');
    }
    if (
      s.weeklyCap !== undefined &&
      !(Number.isFinite(s.weeklyCap) && s.weeklyCap >= 0)
    ) {
      errors.push('SOURCE_INVALID_WEEKLY_CAP');
    }
    if (
      s.dailyCap !== undefined &&
      s.weeklyCap !== undefined &&
      s.dailyCap > s.weeklyCap
    ) {
      errors.push('SOURCE_DAILY_LARGER_THAN_WEEKLY');
    }
  }

  return errors;
}

/**
 * Compute soft theoretical max influence cá nhân / region / tuần — sum
 * weeklyCap của mọi source. Nếu source không có weeklyCap (unlimited),
 * fallback `dailyCap × 7`. Nếu không có cap nào → POSITIVE_INFINITY.
 *
 * Dùng cho admin tooling / docs only.
 */
export function territoryMaxPersonalPointsPerWeek(): number {
  let total = 0;
  for (const s of TERRITORY_INFLUENCE_SOURCES) {
    const wk =
      s.weeklyCap && s.weeklyCap > 0
        ? s.weeklyCap
        : s.dailyCap && s.dailyCap > 0
          ? s.dailyCap * 7
          : Number.POSITIVE_INFINITY;
    if (!Number.isFinite(wk)) return Number.POSITIVE_INFINITY;
    total += wk;
  }
  return total;
}
