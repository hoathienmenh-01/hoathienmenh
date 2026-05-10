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

import { localPartsInTz, utcDateForLocal } from './liveops';
import {
  MAP_REGIONS,
  isMapRegionKey,
  type MapRegionDef,
  type RegionKey,
} from './map-regions';
import {
  SECT_WAR_DEFAULT_TZ,
  sectWarWeekKey,
  startOfSectWarWeek,
} from './sect-war';

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
  /**
   * Phase 14.0.B — current owner sect ID. `null` = chưa được settle hoặc
   * lần settlement gần nhất không có sect đủ điểm. Snapshot từ
   * `SectTerritoryRegionState`.
   */
  readonly ownerSectId: string | null;
  /**
   * Owner sect name snapshot tại settlement time (denormalized — không
   * đổi khi sect rename sau khi chiếm).
   */
  readonly ownerSectName: string | null;
  /**
   * Period key của lần settlement gần nhất xác lập owner. `null` nếu
   * chưa settle.
   */
  readonly ownerPeriodKey: string | null;
  /**
   * ISO timestamp của lần settlement gần nhất xác lập owner. `null` nếu
   * chưa settle.
   */
  readonly ownerSettledAt: string | null;
  /**
   * Phase 14.0.C — buff preview cho region. List buff sẽ active khi sect
   * sở hữu region. Empty nếu region chưa có buff trong catalog. Order
   * stable theo `TERRITORY_REGION_BUFFS`.
   */
  readonly buffs: ReadonlyArray<TerritoryRegionBuffPreviewLite>;
  /**
   * Phase 14.0.C — true nếu region có owner sect (≡ `ownerSectId !== null`).
   * Convenience flag — FE check để render `ownerActive` chip.
   */
  readonly ownerBuffActive: boolean;
}

/**
 * Lite preview buff cho API response — strip i18n key dài, chỉ giữ
 * những field FE cần render. Match `TerritoryRegionBuffPreview` từ
 * `territory-buffs.ts` — re-declare ở đây tránh circular import (file
 * `territory-buffs.ts` đã import từ `map-regions.ts`).
 */
export interface TerritoryRegionBuffPreviewLite {
  readonly regionKey: RegionKey;
  readonly buffKey: string;
  readonly buffType: string;
  readonly value: number;
  readonly cap: number;
  readonly labelI18nKey: string;
  readonly descriptionI18nKey: string;
  readonly appliesTo: ReadonlyArray<string>;
  readonly element: string | null;
}

export interface TerritoryRegionsView {
  readonly regions: ReadonlyArray<TerritoryRegionView>;
  /**
   * Phase 14.0.C — current period key (ISO week). FE display "decay sẽ
   * apply lên period nào nếu admin trigger".
   */
  readonly currentPeriodKey: string;
  /**
   * Phase 14.0.C — previous period key (ISO week). FE display "settlement
   * gần nhất đã chốt period nào".
   */
  readonly previousPeriodKey: string;
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
  /**
   * Phase 14.0.C — list buff đang active cho sect user (region mà sect
   * đang sở hữu). Empty nếu user chưa có sect HOẶC sect không sở hữu
   * region nào.
   */
  readonly activeBuffs: ReadonlyArray<TerritoryRegionBuffPreviewLite>;
  /**
   * Phase 14.0.C — current period key (FE display).
   */
  readonly currentPeriodKey: string;
}

// ────────────────────────────────────────────────────────────────────────
// Phase 14.0.B — Settlement
// ────────────────────────────────────────────────────────────────────────

/**
 * 1 settlement event cho 1 region trong 1 period.
 *
 * `winnerSectName` denormalized snapshot tại settlement time. `winnerSectId`
 * có thể `null` nếu region không có sect đủ điểm tại period đó (skip
 * empty region) — entry vẫn ghi để audit "đã chạy settlement vào period
 * này nhưng region rỗng".
 *
 * `periodKey` ISO week format `YYYY-Www` (vd `2026-W23`) hoặc admin
 * custom (vd `manual_<ts>`). Format được validate ở caller.
 */
export interface TerritorySettlementSnapshotView {
  readonly id: string;
  readonly regionKey: RegionKey;
  readonly periodKey: string;
  readonly winnerSectId: string | null;
  readonly winnerSectName: string | null;
  readonly winnerPoints: number;
  readonly runnerUpSectId: string | null;
  readonly runnerUpSectName: string | null;
  readonly runnerUpPoints: number;
  readonly totalSects: number;
  readonly totalPoints: number;
  readonly settledAt: string;
  readonly settledBy: string | null;
}

export interface TerritoryRegionHistoryView {
  readonly regionKey: RegionKey;
  readonly currentOwnerSectId: string | null;
  readonly currentOwnerSectName: string | null;
  readonly currentPeriodKey: string | null;
  readonly currentSettledAt: string | null;
  readonly snapshots: ReadonlyArray<TerritorySettlementSnapshotView>;
}

/**
 * Result của 1 settlement run (1 region hoặc all regions). Dùng cho admin
 * trigger response để FE hiển thị tóm tắt.
 */
export interface TerritorySettlementRunResult {
  readonly periodKey: string;
  readonly settledAt: string;
  readonly snapshots: ReadonlyArray<TerritorySettlementSnapshotView>;
  readonly skippedRegions: ReadonlyArray<RegionKey>;
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

// ────────────────────────────────────────────────────────────────────────
// Phase 14.0.B — Settlement period key
// ────────────────────────────────────────────────────────────────────────

/**
 * Regex match cho ISO week settlement period (vd `2026-W23`).
 *
 * Settlement period key có 2 dạng:
 *   1. ISO week: `YYYY-Www` (vd `2026-W23`) — dùng cho cron-based weekly
 *      settlement và admin trigger không truyền key tường minh.
 *   2. Manual admin override: `manual_<id>` — admin trigger với key tự do
 *      (lowercase a-z 0-9 _- only, length 1..40).
 *
 * Validate ở caller — runtime hook KHÔNG validate (server-authoritative).
 */
export const TERRITORY_PERIOD_ISO_WEEK_RE = /^\d{4}-W(0[1-9]|[1-4]\d|5[0-3])$/;
export const TERRITORY_PERIOD_MANUAL_RE = /^manual_[a-z0-9_-]{1,40}$/;

export function isTerritoryPeriodKey(key: string): boolean {
  return (
    TERRITORY_PERIOD_ISO_WEEK_RE.test(key) ||
    TERRITORY_PERIOD_MANUAL_RE.test(key)
  );
}

/**
 * Compute ISO week period key cho 1 Date instance trong `timezone` (default
 * `Asia/Ho_Chi_Minh`).
 *
 * Format: `YYYY-Www` (vd `2026-W23`). Tuần ISO bắt đầu thứ Hai theo local
 * timezone, tuần 1 là tuần chứa thứ Năm đầu tiên của năm (ISO 8601).
 *
 * Delegate to `sectWarWeekKey()` để đảm bảo TZ-aware boundary **đồng nhất**
 * với sect war / sect mission / sect season — single source of truth cho
 * weekly period key trong toàn hệ.
 *
 * Dùng cho cron-based weekly settlement (chốt sau khi tuần kết thúc) và
 * fallback khi admin trigger không truyền key tường minh.
 */
export function territoryPeriodKeyForDate(
  date: Date,
  timezone: string = SECT_WAR_DEFAULT_TZ,
): string {
  return sectWarWeekKey(date, timezone);
}

/**
 * Compute period key cho tuần TRƯỚC (settlement chốt sau khi tuần kết thúc)
 * theo TZ-aware boundary `timezone` (default `Asia/Ho_Chi_Minh`).
 *
 * Implementation: lấy `startOfSectWarWeek(now, tz)` (Monday 00:00 local-tz
 * của tuần hiện tại) rồi lùi 1ms → rơi vào tuần trước → key qua
 * `sectWarWeekKey`. Cách này luôn cho period key chính xác kể cả khi `now`
 * sát biên Monday 00:00 ICT (ví dụ cron chạy thứ Hai 00:05 ICT chốt tuần
 * vừa kết thúc).
 *
 * Trước Phase 15.6+/TZ Hotfix dùng `now - 7 days` UTC arithmetic → off-by-one
 * khi cron chạy đầu tuần ICT (= late-Sun UTC) vì pivot date rơi vào tuần
 * UTC-cũ-hơn-1.
 */
export function previousTerritoryPeriodKey(
  now: Date = new Date(),
  timezone: string = SECT_WAR_DEFAULT_TZ,
): string {
  const thisMonday = startOfSectWarWeek(now, timezone);
  const endOfPrevWeek = new Date(thisMonday.getTime() - 1);
  return sectWarWeekKey(endOfPrevWeek, timezone);
}

// ────────────────────────────────────────────────────────────────────────
// Phase 14.0.D — Territory Weekly War Loop helpers + types
// ────────────────────────────────────────────────────────────────────────

/**
 * Phase 14.0.D — current ISO week period key (TZ-aware, default ICT).
 *
 * Alias cho `territoryPeriodKeyForDate(now, timezone)` để code đọc tự nhiên
 * ở runtime hook ("chốt period hiện tại" ↔ "kỳ tuần này").
 */
export function currentTerritoryPeriodKey(
  now: Date = new Date(),
  timezone: string = SECT_WAR_DEFAULT_TZ,
): string {
  return territoryPeriodKeyForDate(now, timezone);
}

/**
 * Phase 14.0.D — Mốc reset tuần kế tiếp theo TZ-aware (default ICT).
 *
 * Trả về `Date` đại diện mốc Thứ Hai 00:00:00 theo `timezone` kế tiếp `now`.
 * Convention:
 *   - Nếu `now` đúng 00:00:00.000 ngày Thứ Hai local-tz → vẫn đẩy về 7 ngày
 *     sau (mốc reset tiếp theo, không phải mốc reset hiện tại).
 *   - Nếu `now` ở giữa tuần → đẩy về Thứ Hai gần nhất phía trước rồi cộng
 *     7 ngày local-tz wall time, luôn > now.
 *
 * Dùng cho FE countdown ("còn bao nhiêu giây tới reset") và
 * `territoryPeriodWindow()` lấy `endsAt`.
 *
 * Implementation: `startOfSectWarWeek(now, tz)` cho Monday 00:00 local-tz
 * của tuần hiện tại, cộng 7 ngày wall-time (qua `utcDateForLocal`) để xử
 * lý DST safely nếu tz có DST.
 */
export function nextTerritoryResetAt(
  now: Date = new Date(),
  timezone: string = SECT_WAR_DEFAULT_TZ,
): Date {
  const thisMonday = startOfSectWarWeek(now, timezone);
  // Đọc parts của thisMonday trong local-tz (00:00 local), cộng 7 ngày local
  // wall-time, rồi convert ngược ra UTC instant.
  const parts = localPartsInTz(thisMonday, timezone);
  const utc = Date.UTC(parts.year, parts.month - 1, parts.day);
  const nextUtc = new Date(utc);
  nextUtc.setUTCDate(nextUtc.getUTCDate() + 7);
  return utcDateForLocal(
    nextUtc.getUTCFullYear(),
    nextUtc.getUTCMonth() + 1,
    nextUtc.getUTCDate(),
    0,
    0,
    timezone,
  );
}

/**
 * Phase 14.0.D — Cửa sổ thời gian của 1 ISO week period (TZ-aware, default
 * ICT).
 *
 * Trả về `{ startsAt, endsAt }` UTC instant cho period key dạng `YYYY-Www`.
 *   - `startsAt` = Thứ Hai 00:00 trong `timezone` của tuần (ISO week start).
 *   - `endsAt` = Thứ Hai 00:00 trong `timezone` của tuần kế tiếp (exclusive).
 *
 * Tuần ISO bắt đầu Thứ Hai trong local-tz. Với `timezone = Asia/Ho_Chi_Minh`,
 * mốc Thứ Hai 00:00 ICT = Chủ Nhật 17:00 UTC tuần liền trước.
 *
 * Hành vi:
 *   - Period key không hợp lệ (không khớp regex ISO week, không phải
 *     `manual_*`) → trả `null`.
 *   - Period key dạng `manual_<id>` → trả `null` (không có cửa sổ
 *     thời gian xác định).
 */
export function territoryPeriodWindow(
  periodKey: string,
  timezone: string = SECT_WAR_DEFAULT_TZ,
): { startsAt: Date; endsAt: Date } | null {
  if (!TERRITORY_PERIOD_ISO_WEEK_RE.test(periodKey)) return null;
  const m = /^(\d{4})-W(\d{2})$/.exec(periodKey);
  if (!m) return null;
  const year = Number.parseInt(m[1], 10);
  const week = Number.parseInt(m[2], 10);
  if (!Number.isFinite(year) || !Number.isFinite(week)) return null;
  // ISO 8601: tuần 1 là tuần chứa Thứ Năm đầu năm. Thứ Hai tuần 1:
  //   - bắt đầu từ ngày 4/1 (luôn nằm trong tuần 1) → lùi về Thứ Hai.
  // Compute Monday-of-week trong **UTC arithmetic** (TZ-agnostic ngày tháng),
  // sau đó convert thành mốc 00:00 local-tz qua `utcDateForLocal`.
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const isoDayJan4 = jan4.getUTCDay() === 0 ? 7 : jan4.getUTCDay();
  const week1Monday = new Date(jan4.getTime() - (isoDayJan4 - 1) * 86400000);
  const monday = new Date(week1Monday.getTime() + (week - 1) * 7 * 86400000);
  const nextMonday = new Date(monday.getTime() + 7 * 86400000);
  const startsAt = utcDateForLocal(
    monday.getUTCFullYear(),
    monday.getUTCMonth() + 1,
    monday.getUTCDate(),
    0,
    0,
    timezone,
  );
  const endsAt = utcDateForLocal(
    nextMonday.getUTCFullYear(),
    nextMonday.getUTCMonth() + 1,
    nextMonday.getUTCDate(),
    0,
    0,
    timezone,
  );
  return { startsAt, endsAt };
}

/** Kết quả validate `periodKey` — dùng cho controller / runtime hook. */
export type TerritoryPeriodValidationCode =
  | 'PERIOD_INVALID_FORMAT'
  | 'PERIOD_EMPTY'
  | 'PERIOD_TOO_LONG';

export interface TerritoryPeriodValidationResult {
  readonly ok: boolean;
  readonly code: TerritoryPeriodValidationCode | null;
  readonly kind: 'iso_week' | 'manual' | null;
}

/**
 * Phase 14.0.D — structured validate cho `periodKey`.
 *
 * Wraps `isTerritoryPeriodKey()` thêm lý do fail (empty / too long /
 * invalid format) cho admin tooling + log audit. Runtime hook đa số
 * vẫn dùng boolean `isTerritoryPeriodKey()` (light-weight).
 */
export function validateTerritoryPeriodKey(
  periodKey: string,
): TerritoryPeriodValidationResult {
  if (typeof periodKey !== 'string' || periodKey.length === 0) {
    return { ok: false, code: 'PERIOD_EMPTY', kind: null };
  }
  if (periodKey.length > 64) {
    return { ok: false, code: 'PERIOD_TOO_LONG', kind: null };
  }
  if (TERRITORY_PERIOD_ISO_WEEK_RE.test(periodKey)) {
    return { ok: true, code: null, kind: 'iso_week' };
  }
  if (TERRITORY_PERIOD_MANUAL_RE.test(periodKey)) {
    return { ok: true, code: null, kind: 'manual' };
  }
  return { ok: false, code: 'PERIOD_INVALID_FORMAT', kind: null };
}

// ────────────────────────────────────────────────────────────────────────
// Phase 14.0.D — Weekly War view types
// ────────────────────────────────────────────────────────────────────────

/**
 * Standing 1 sect trong 1 region cho war state hiện tại. Top-N (mặc định 3
 * cho overview, 10 cho region detail). Reuse cấu trúc tương tự
 * `TerritoryLeaderboardRow`, thêm tỉ lệ điểm và flag `isLeader`.
 */
export interface TerritoryRegionWarStandingView {
  readonly rank: number;
  readonly sectId: string;
  readonly sectName: string;
  readonly points: number;
  readonly contributors: number;
  /** True nếu sect đang dẫn đầu (rank === 1). */
  readonly isLeader: boolean;
}

/**
 * Tóm tắt war state cho 1 region trong period hiện tại — dùng cho
 * `GET /territory/war/current` (mỗi region 1 entry).
 */
export interface TerritoryRegionWarSummaryView {
  readonly regionKey: RegionKey;
  readonly nameVi: string;
  readonly nameEn: string;
  readonly sortOrder: number;
  /** Tổng điểm influence trong region cho period hiện tại. */
  readonly totalPoints: number;
  /** Số sect có điểm > 0 trong region (≥ 0). */
  readonly contestedSectCount: number;
  /** Sect dẫn đầu hiện tại (nếu có). */
  readonly leaderSectId: string | null;
  readonly leaderSectName: string | null;
  readonly leaderPoints: number;
  /**
   * Khoảng cách điểm leader - runner-up. Nếu chỉ 1 sect có điểm,
   * `leadMargin = leaderPoints` (không có challenger).
   */
  readonly leadMargin: number;
  /**
   * True nếu region có ≥ 2 sect đang tranh (FE hiển thị badge "ĐANG
   * TRANH ĐOẠT"). Nếu chỉ 1 sect → false (region đang được "giữ").
   */
  readonly contested: boolean;
  /** Owner đã chốt từ kỳ trước (snapshot từ `SectTerritoryRegionState`). */
  readonly currentOwnerSectId: string | null;
  readonly currentOwnerSectName: string | null;
  readonly currentOwnerPeriodKey: string | null;
  /** Top 3 standings (rank 1..3) — order by points DESC, sectId ASC. */
  readonly topStandings: ReadonlyArray<TerritoryRegionWarStandingView>;
}

/**
 * Snapshot owner snapshot cho 1 region (sau settlement). Dùng cho
 * `TerritoryWarSettleCurrentResult.ownersAfter`.
 */
export interface TerritoryRegionOwnerSnapshotView {
  readonly regionKey: RegionKey;
  readonly ownerSectId: string | null;
  readonly ownerSectName: string | null;
  readonly periodKey: string | null;
  readonly settledAt: string | null;
}

/**
 * Phase 14.0.D — Top-level state response cho
 * `GET /territory/war/current`.
 */
export interface TerritoryWarStateView {
  /** Period hiện tại (ISO week) — tuần đang tranh đoạt. */
  readonly periodKey: string;
  /** Period kỳ trước — settlement gần nhất chốt key này. */
  readonly previousPeriodKey: string;
  /** Mốc bắt đầu period hiện tại (Thứ Hai 00:00 UTC). */
  readonly startsAt: string;
  /** Mốc kết thúc period hiện tại (Thứ Hai 00:00 UTC kỳ kế). */
  readonly endsAt: string;
  /** Mốc reset tuần kế tiếp (=`endsAt`). */
  readonly nextResetAt: string;
  /** Server time tại lúc gen response (FE drift correction). */
  readonly serverNow: string;
  /** Thời gian còn lại tới `endsAt`, tính bằng millisecond. ≥ 0. */
  readonly timeRemainingMs: number;
  /** Tóm tắt 9 region (order theo `sortOrder`). */
  readonly regions: ReadonlyArray<TerritoryRegionWarSummaryView>;
}

/**
 * Phase 14.0.D — Region detail cho `GET /territory/war/regions/:key`.
 *
 * Mở rộng `TerritoryRegionWarSummaryView`:
 *   - `standings` top 10 thay vì top 3.
 *   - `recentSettlements` 5 snapshot gần nhất từ
 *     `SectTerritorySettlementSnapshot`.
 */
export interface TerritoryRegionWarStatusView {
  readonly regionKey: RegionKey;
  readonly nameVi: string;
  readonly nameEn: string;
  readonly sortOrder: number;
  readonly periodKey: string;
  readonly previousPeriodKey: string;
  readonly startsAt: string;
  readonly endsAt: string;
  readonly serverNow: string;
  readonly timeRemainingMs: number;
  readonly totalPoints: number;
  readonly contestedSectCount: number;
  readonly leaderSectId: string | null;
  readonly leaderSectName: string | null;
  readonly leaderPoints: number;
  readonly leadMargin: number;
  readonly contested: boolean;
  readonly currentOwnerSectId: string | null;
  readonly currentOwnerSectName: string | null;
  readonly currentOwnerPeriodKey: string | null;
  readonly currentOwnerSettledAt: string | null;
  readonly standings: ReadonlyArray<TerritoryRegionWarStandingView>;
  readonly recentSettlements: ReadonlyArray<TerritorySettlementSnapshotView>;
}

/**
 * Phase 14.0.D — 1 entry trong war history (1 period đã chốt).
 *
 * Cấu trúc gộp: 1 periodKey → list snapshot 9 region (region nào skip
 * sẽ không có trong array). FE render mỗi entry là 1 dòng "Tuần X →
 * winner mỗi region".
 */
export interface TerritoryWarHistoryEntry {
  readonly periodKey: string;
  /** Cửa sổ thời gian của period (null nếu period là `manual_*`). */
  readonly startsAt: string | null;
  readonly endsAt: string | null;
  /** ISO timestamp settlement gần nhất trong period (max settledAt). */
  readonly settledAt: string;
  readonly snapshots: ReadonlyArray<TerritorySettlementSnapshotView>;
}

export interface TerritoryWarHistoryView {
  readonly entries: ReadonlyArray<TerritoryWarHistoryEntry>;
}

/**
 * Phase 14.0.D — Result của
 * `POST /admin/territory/war/settle-current`.
 *
 * Mở rộng `TerritorySettlementRunResult`:
 *   - `ownersAfter`: owner snapshot 9 region SAU settlement (FE refresh
 *     trực tiếp không cần round-trip thêm).
 */
export interface TerritoryWarSettleCurrentResult {
  readonly periodKey: string;
  readonly settledAt: string;
  readonly snapshots: ReadonlyArray<TerritorySettlementSnapshotView>;
  readonly skippedRegions: ReadonlyArray<RegionKey>;
  readonly ownersAfter: ReadonlyArray<TerritoryRegionOwnerSnapshotView>;
}
