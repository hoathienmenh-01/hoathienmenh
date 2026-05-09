/**
 * Phase 14.0.C — Sect Territory Region Buff + Influence Decay catalog.
 *
 * Pure data + deterministic helpers. KHÔNG runtime/schema/migration ở
 * file này — runtime apply buff ở `apps/api/src/modules/dungeon-run/...`
 * và `apps/api/src/modules/territory/territory-decay.service.ts`.
 *
 * Mục tiêu Phase 14.0.C:
 *   - Tông môn đang sở hữu region (`SectTerritoryRegionState.ownerSectId`)
 *     nhận buff vùng nhỏ — apply ở dungeon reward / boss reward / combat
 *     khi pattern an toàn.
 *   - Influence cũ có decay theo period để tránh 1 tông môn giữ region
 *     mãi (chốt một lần rồi farm tiếp giờ thấp hơn).
 *   - Buff áp dụng nhỏ, có kiểm soát — value cap 10% (`TERRITORY_BUFF_VALUE_MAX`)
 *     để không phá balance.
 *
 * Anti-abuse / balance:
 *   - Mỗi buff có `value` ∈ (0, 0.10] (0%–10%, exclusive 0). Cap an toàn
 *     enforced bởi `validateTerritoryBuffCatalog()`.
 *   - 1 region chỉ tối đa N buff (≤ `TERRITORY_BUFFS_PER_REGION_MAX`).
 *   - Decay rate cap 50% (`TERRITORY_DECAY_MAX_BPS`) — tránh wipe điểm
 *     bừa bãi.
 *   - Idempotency cap decay theo `periodKey` ở DB layer (Prisma model
 *     `SectTerritoryDecayLog`, UNIQUE periodKey).
 *
 * Source of truth:
 *   - `docs/BALANCE_MODEL.md` §territory buff dial table.
 *   - `docs/CHANGELOG.md` Phase 14.0.C entry.
 */

import { isMapRegionKey, type RegionKey } from './map-regions';

// ────────────────────────────────────────────────────────────────────────
// Types
// ────────────────────────────────────────────────────────────────────────

/**
 * Buff type — deterministic enum cho FE / runtime apply. Append-only;
 * ĐỪNG rename / remove sau khi production.
 *
 * Mapping runtime apply:
 *   - `EXP_BONUS`         → dungeon reward exp multiplier (1 + value).
 *   - `LINH_THACH_BONUS`  → dungeon reward linh thạch multiplier (1 + value).
 *   - `DROP_RATE_BONUS`   → boss / dungeon drop rate (defer 14.0.D — chưa
 *                            wire vào loot rng vì cần snapshot test rng).
 *   - `ELEMENTAL_DAMAGE`  → combat element damage multiplier (defer 14.0.D
 *                            — cần balance review combat scaling).
 *   - `DEFENSE_BONUS`     → combat def/hp (defer 14.0.D).
 *
 * Phase 14.0.C wire RUNTIME chỉ EXP_BONUS + LINH_THACH_BONUS (dungeon
 * reward path — đường ít rủi ro nhất). Các buff khác có entry trong
 * catalog nhưng chỉ FE display preview.
 */
export type TerritoryRegionBuffType =
  | 'EXP_BONUS'
  | 'LINH_THACH_BONUS'
  | 'DROP_RATE_BONUS'
  | 'ELEMENTAL_DAMAGE'
  | 'DEFENSE_BONUS';

/**
 * Apply context — domain runtime hook check trước khi apply buff.
 * Mỗi buff có thể `appliesTo` ≥ 1 context (vd `EXP_BONUS` có thể wire
 * vào `DUNGEON_REWARD` + `BOSS_REWARD`).
 */
export type TerritoryRegionBuffAppliesTo =
  | 'DUNGEON_REWARD'
  | 'BOSS_REWARD'
  | 'COMBAT'
  | 'ELEMENTAL'
  | 'CULTIVATION';

export interface TerritoryRegionBuffDef {
  /** Region key — phải tồn tại trong `MAP_REGIONS`. */
  readonly regionKey: RegionKey;
  /** Buff key — UNIQUE toàn catalog. Stable identifier (DB / i18n). */
  readonly buffKey: string;
  /** Buff type — runtime hook switch theo type. */
  readonly buffType: TerritoryRegionBuffType;
  /**
   * Buff value — mức bonus thường dạng phần trăm dạng float
   * (vd 0.05 = +5%). Phải ∈ (0, `TERRITORY_BUFF_VALUE_MAX`].
   */
  readonly value: number;
  /**
   * Cap kiểm soát — max value cho phép (per buff). Nếu admin tooling
   * future cho điều chỉnh value qua liveops, value KHÔNG được vượt cap.
   * Catalog tĩnh hiện tại `cap === value` (no headroom).
   */
  readonly cap: number;
  /** i18n key cho FE label (vd `territory.buff.son_coc_exp.label`). */
  readonly labelI18nKey: string;
  /** i18n key cho FE description ngắn (≤ 200 ký tự). */
  readonly descriptionI18nKey: string;
  /**
   * Domain context apply. ≥ 1 entry. Runtime hook chỉ apply nếu match
   * context — tránh leak buff cross-domain.
   */
  readonly appliesTo: ReadonlyArray<TerritoryRegionBuffAppliesTo>;
  /**
   * Optional — element key (kim/moc/thuy/hoa/tho) cho ELEMENTAL_DAMAGE
   * buff. Phải set khi `buffType === 'ELEMENTAL_DAMAGE'`.
   */
  readonly element?: string;
}

/**
 * Buff preview — dùng cho FE hiển thị "region này có buff gì khi sở
 * hữu" + "active buff của tông môn mình". Lite version của def, không
 * leak `descriptionI18nKey` raw (FE đã lookup i18n bởi `labelI18nKey`).
 */
export interface TerritoryRegionBuffPreview {
  readonly regionKey: RegionKey;
  readonly buffKey: string;
  readonly buffType: TerritoryRegionBuffType;
  readonly value: number;
  readonly cap: number;
  readonly labelI18nKey: string;
  readonly descriptionI18nKey: string;
  readonly appliesTo: ReadonlyArray<TerritoryRegionBuffAppliesTo>;
  readonly element: string | null;
}

// ────────────────────────────────────────────────────────────────────────
// Constants — caps & decay defaults
// ────────────────────────────────────────────────────────────────────────

/**
 * Hard cap value cho buff — ngăn admin / catalog vô tình ship buff phá
 * balance. ≤ 10% áp dụng cho mọi buff hiện tại.
 */
export const TERRITORY_BUFF_VALUE_MAX = 0.1;

/** Số buff tối đa / region — ngăn region pile-up nhiều buff stacking. */
export const TERRITORY_BUFFS_PER_REGION_MAX = 3;

/**
 * Default decay rate cho admin trigger không truyền `decayBps`.
 * 25% = 2500 basis points. Đủ slow để rotation không quá đột ngột,
 * đủ fast để tránh permanent dominance (sect đỉnh 100k pts → 75k → 56k → ...).
 */
export const TERRITORY_DECAY_DEFAULT_BPS = 2500;

/** Hard cap decay rate — admin không thể wipe điểm > 50%/period. */
export const TERRITORY_DECAY_MAX_BPS = 5000;

// ────────────────────────────────────────────────────────────────────────
// Catalog
// ────────────────────────────────────────────────────────────────────────

/**
 * Region buff catalog Phase 14.0.C — small, controlled bonuses.
 *
 * Order stable theo `MapRegionDef.sortOrder`. Đừng đảo trừ khi cần
 * (snapshot test break).
 *
 * Balance philosophy:
 *   - Sơn Cốc (luyện khí, tho): +EXP dungeon — newbie region, exp
 *     bonus giúp leveling.
 *   - Hắc Lâm (trúc cơ, moc): +drop rate — early dungeon farming.
 *   - Mộc Huyền Lâm (trúc cơ, moc): +Mộc damage — element synergy.
 *   - Kim Sơn Mạch (kim đan, kim): +Kim damage — element synergy.
 *   - Hoàng Thổ Huyệt (nguyên anh, tho): +def/hp — endgame survival.
 *
 * Phase 14.0.C wire RUNTIME chỉ Sơn Cốc EXP + Hắc Lâm linh thạch (đường
 * ít rủi ro nhất — dungeon claim path). Các region còn lại có entry
 * cho FE preview nhưng chưa wire combat.
 */
export const TERRITORY_REGION_BUFFS: readonly TerritoryRegionBuffDef[] = [
  {
    regionKey: 'son_coc',
    buffKey: 'territory_son_coc_exp',
    buffType: 'EXP_BONUS',
    value: 0.05,
    cap: 0.05,
    labelI18nKey: 'territory.buff.territory_son_coc_exp.label',
    descriptionI18nKey: 'territory.buff.territory_son_coc_exp.desc',
    appliesTo: ['DUNGEON_REWARD'],
  },
  {
    regionKey: 'hac_lam',
    buffKey: 'territory_hac_lam_drop',
    buffType: 'LINH_THACH_BONUS',
    value: 0.05,
    cap: 0.05,
    labelI18nKey: 'territory.buff.territory_hac_lam_drop.label',
    descriptionI18nKey: 'territory.buff.territory_hac_lam_drop.desc',
    appliesTo: ['DUNGEON_REWARD'],
  },
  {
    regionKey: 'moc_huyen_lam',
    buffKey: 'territory_moc_huyen_lam_dmg',
    buffType: 'ELEMENTAL_DAMAGE',
    value: 0.05,
    cap: 0.05,
    labelI18nKey: 'territory.buff.territory_moc_huyen_lam_dmg.label',
    descriptionI18nKey: 'territory.buff.territory_moc_huyen_lam_dmg.desc',
    appliesTo: ['COMBAT', 'ELEMENTAL'],
    element: 'moc',
  },
  {
    regionKey: 'kim_son_mach',
    buffKey: 'territory_kim_son_mach_dmg',
    buffType: 'ELEMENTAL_DAMAGE',
    value: 0.05,
    cap: 0.05,
    labelI18nKey: 'territory.buff.territory_kim_son_mach_dmg.label',
    descriptionI18nKey: 'territory.buff.territory_kim_son_mach_dmg.desc',
    appliesTo: ['COMBAT', 'ELEMENTAL'],
    element: 'kim',
  },
  {
    regionKey: 'hoang_tho_huyet',
    buffKey: 'territory_hoang_tho_huyet_def',
    buffType: 'DEFENSE_BONUS',
    value: 0.05,
    cap: 0.05,
    labelI18nKey: 'territory.buff.territory_hoang_tho_huyet_def.label',
    descriptionI18nKey: 'territory.buff.territory_hoang_tho_huyet_def.desc',
    appliesTo: ['COMBAT'],
  },
];

// ────────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────────

/**
 * Trả về list buff cho 1 region. Region key invalid → []. Region không
 * có buff định nghĩa → [].
 *
 * KHÔNG kiểm tra owner — caller phải check sect ownership trước khi
 * apply.
 */
export function territoryRegionBuffsForRegion(
  regionKey: string,
): ReadonlyArray<TerritoryRegionBuffDef> {
  if (!isMapRegionKey(regionKey)) return [];
  return TERRITORY_REGION_BUFFS.filter((b) => b.regionKey === regionKey);
}

/**
 * Trả về list buff cho region nếu có owner. Owner null → [] (không
 * leak buff cho region chưa settle). Owner !== null → buff list cho
 * region đó (caller match `sectId` để decide có active không).
 *
 * Tên helper dùng generic `ForOwner` thay vì `ForOwnerSect` vì owner
 * có thể null — semantic là "buff áp dụng cho whoever owner is".
 */
export function territoryRegionBuffForOwner(
  regionKey: string,
  ownerSectId: string | null,
): ReadonlyArray<TerritoryRegionBuffDef> {
  if (!ownerSectId) return [];
  return territoryRegionBuffsForRegion(regionKey);
}

/**
 * Lookup 1 buff theo `(regionKey, buffKey)`. Trả undefined nếu không
 * tồn tại.
 */
export function territoryRegionBuffByKey(
  regionKey: string,
  buffKey: string,
): TerritoryRegionBuffDef | undefined {
  return TERRITORY_REGION_BUFFS.find(
    (b) => b.regionKey === regionKey && b.buffKey === buffKey,
  );
}

/**
 * Compute active buffs cho 1 sect — list mọi region mà sect đang sở
 * hữu (qua `ownerStateMap`) → flat list buff def.
 *
 * `ownerStateMap` = Map<regionKey, ownerSectId | null> — caller resolve
 * từ `SectTerritoryRegionState` (server-authoritative). Region không
 * có entry hoặc ownerSectId !== sectId → skip.
 *
 * Empty sectId / sectId không sở hữu region nào → [].
 */
export function activeTerritoryBuffsForSect(
  sectId: string | null,
  ownerStateMap: ReadonlyMap<string, { ownerSectId: string | null }>,
): ReadonlyArray<TerritoryRegionBuffDef> {
  if (!sectId) return [];
  const out: TerritoryRegionBuffDef[] = [];
  for (const buff of TERRITORY_REGION_BUFFS) {
    const state = ownerStateMap.get(buff.regionKey);
    if (state?.ownerSectId === sectId) out.push(buff);
  }
  return out;
}

/**
 * Convert buff def → preview dùng cho API response (FE-friendly).
 * Map `element?: string` → `element: string | null` (consistency với
 * shared API contract).
 */
export function toBuffPreview(
  def: TerritoryRegionBuffDef,
): TerritoryRegionBuffPreview {
  return {
    regionKey: def.regionKey,
    buffKey: def.buffKey,
    buffType: def.buffType,
    value: def.value,
    cap: def.cap,
    labelI18nKey: def.labelI18nKey,
    descriptionI18nKey: def.descriptionI18nKey,
    appliesTo: def.appliesTo,
    element: def.element ?? null,
  };
}

export type TerritoryBuffValidationCode =
  | 'BUFF_REGION_NOT_IN_MAP'
  | 'BUFF_DUPLICATE_KEY'
  | 'BUFF_INVALID_VALUE'
  | 'BUFF_VALUE_OVER_CAP'
  | 'BUFF_VALUE_OVER_HARD_CAP'
  | 'BUFF_INVALID_TYPE'
  | 'BUFF_INVALID_APPLIES_TO'
  | 'BUFF_ELEMENT_MISSING'
  | 'BUFF_ELEMENT_UNEXPECTED'
  | 'BUFF_REGION_OVERFLOW';

const VALID_BUFF_TYPES: ReadonlySet<TerritoryRegionBuffType> = new Set([
  'EXP_BONUS',
  'LINH_THACH_BONUS',
  'DROP_RATE_BONUS',
  'ELEMENTAL_DAMAGE',
  'DEFENSE_BONUS',
]);

const VALID_APPLIES_TO: ReadonlySet<TerritoryRegionBuffAppliesTo> = new Set([
  'DUNGEON_REWARD',
  'BOSS_REWARD',
  'COMBAT',
  'ELEMENTAL',
  'CULTIVATION',
]);

/**
 * Validate catalog tính nhất quán — gọi một lần ở test, KHÔNG gọi mỗi
 * runtime hook (catalog static, immutable).
 *
 * Trả về list error code rỗng nếu pass.
 */
export function validateTerritoryBuffCatalog(): TerritoryBuffValidationCode[] {
  const errors: TerritoryBuffValidationCode[] = [];

  const seen = new Set<string>();
  const perRegion = new Map<string, number>();
  for (const b of TERRITORY_REGION_BUFFS) {
    if (!isMapRegionKey(b.regionKey)) {
      errors.push('BUFF_REGION_NOT_IN_MAP');
    }
    if (seen.has(b.buffKey)) {
      errors.push('BUFF_DUPLICATE_KEY');
    }
    seen.add(b.buffKey);

    if (!Number.isFinite(b.value) || b.value <= 0) {
      errors.push('BUFF_INVALID_VALUE');
    }
    if (Number.isFinite(b.value) && b.value > b.cap) {
      errors.push('BUFF_VALUE_OVER_CAP');
    }
    if (Number.isFinite(b.cap) && b.cap > TERRITORY_BUFF_VALUE_MAX) {
      errors.push('BUFF_VALUE_OVER_HARD_CAP');
    }

    if (!VALID_BUFF_TYPES.has(b.buffType)) {
      errors.push('BUFF_INVALID_TYPE');
    }

    if (!b.appliesTo || b.appliesTo.length === 0) {
      errors.push('BUFF_INVALID_APPLIES_TO');
    } else {
      for (const ctx of b.appliesTo) {
        if (!VALID_APPLIES_TO.has(ctx)) {
          errors.push('BUFF_INVALID_APPLIES_TO');
          break;
        }
      }
    }

    if (b.buffType === 'ELEMENTAL_DAMAGE') {
      if (!b.element || b.element.length === 0) {
        errors.push('BUFF_ELEMENT_MISSING');
      }
    } else if (b.element !== undefined) {
      errors.push('BUFF_ELEMENT_UNEXPECTED');
    }

    perRegion.set(b.regionKey, (perRegion.get(b.regionKey) ?? 0) + 1);
  }

  for (const [, count] of perRegion) {
    if (count > TERRITORY_BUFFS_PER_REGION_MAX) {
      errors.push('BUFF_REGION_OVERFLOW');
    }
  }

  return errors;
}

// ────────────────────────────────────────────────────────────────────────
// Decay
// ────────────────────────────────────────────────────────────────────────

export interface TerritoryDecayResult {
  /** Decay rate dưới dạng basis points (0–10000). */
  readonly decayBps: number;
  /** Điểm sau decay — `floor(points × (10000 - decayBps) / 10000)`. */
  readonly pointsAfter: number;
  /** Delta = pointsBefore - pointsAfter (≥ 0). */
  readonly delta: number;
}

/**
 * Compute decay deterministic — `floor(points × (10000 - decayBps) /
 * 10000)`. Floor ở 0 (không bao giờ âm).
 *
 * Pure function — không mutate state. Caller (decay service) dùng
 * để tính delta trước khi update DB.
 *
 * Edge cases:
 *   - `points <= 0` → trả `pointsAfter: 0`, `delta: 0` (no-op).
 *   - `decayBps <= 0` → trả `pointsAfter: points`, `delta: 0` (no-op).
 *   - `decayBps >= 10000` → trả `pointsAfter: 0`, `delta: points`
 *     (full wipe).
 *   - `decayBps > TERRITORY_DECAY_MAX_BPS` → clamp xuống MAX (caller
 *     phải validate trước khi gọi — nhưng helper an toàn fallback).
 */
export function computeTerritoryDecay(
  points: number,
  decayBps: number,
): TerritoryDecayResult {
  if (!Number.isFinite(points) || points <= 0) {
    return { decayBps: Math.max(0, Math.floor(decayBps)), pointsAfter: 0, delta: 0 };
  }
  let bps = Math.floor(decayBps);
  if (!Number.isFinite(bps) || bps <= 0) {
    return { decayBps: 0, pointsAfter: points, delta: 0 };
  }
  if (bps > 10000) bps = 10000;
  if (bps > TERRITORY_DECAY_MAX_BPS) bps = TERRITORY_DECAY_MAX_BPS;
  const pointsAfter = Math.max(
    0,
    Math.floor((points * (10000 - bps)) / 10000),
  );
  return {
    decayBps: bps,
    pointsAfter,
    delta: points - pointsAfter,
  };
}

/**
 * Validate decay bps input — caller (admin endpoint) phải reject
 * trước khi gọi service. Trả `null` nếu valid, error code nếu không.
 */
export function isValidTerritoryDecayBps(bps: number): boolean {
  if (!Number.isFinite(bps)) return false;
  if (!Number.isInteger(bps)) return false;
  if (bps <= 0) return false;
  if (bps > TERRITORY_DECAY_MAX_BPS) return false;
  return true;
}
