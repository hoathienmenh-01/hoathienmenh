/**
 * Phase 14.0.E — Territory Owner Reward catalog (mail thưởng tuần cho
 * Tông Môn chiếm vùng).
 *
 * Pure data + deterministic helpers. KHÔNG runtime/schema/migration ở
 * file này — runtime grant ở
 * `apps/api/src/modules/territory/territory-reward.service.ts`.
 *
 * Mục tiêu Phase 14.0.E:
 *   - Sect đứng rank 1 (winner) của 1 region trong period (tuần) được
 *     tặng thưởng nhỏ qua mail cho mọi thành viên hiện tại của sect
 *     tại thời điểm grant.
 *   - Reward weekly-safe: linhThach + exp + 0..N item (không title /
 *     buff runtime trong PR này — chỉ ghi rewardHint cho FE label).
 *   - Server-authoritative; FE KHÔNG tự tính reward, chỉ trigger admin
 *     grant. Idempotency qua composite UNIQUE
 *     `(periodKey, regionKey, characterId)` ở Prisma layer
 *     (`TerritoryOwnerRewardGrant`) — gọi lại cùng `periodKey` không
 *     gửi mail trùng.
 *
 * Anti-abuse / balance:
 *   - Cap envelope cứng:
 *     - `linhThach` ≤ {@link TERRITORY_OWNER_REWARD_LINH_THACH_CAP}
 *       (1000 / member / region / week).
 *     - `exp`        ≤ {@link TERRITORY_OWNER_REWARD_EXP_CAP}
 *       (600 / member / region / week).
 *     - `itemRewards.length` ≤ {@link TERRITORY_OWNER_REWARD_ITEM_ENTRIES_CAP}
 *       (3 entry / region) và `qty` ≤ {@link TERRITORY_OWNER_REWARD_ITEM_QTY_CAP}
 *       (5 / entry) — giữ reward "nhỏ-có-kiểm-soát", không phá economy.
 *     - Mỗi region phải có TỔNG reward > 0 (linhThach hoặc exp hoặc
 *       items.length) — không cho catalog "rỗng" tránh skip nhầm.
 *   - Reward không issue title / buff runtime / currency premium
 *     (tienNgoc) — defer phase sau (cron 14.0.F).
 *
 * Source of truth:
 *   - `docs/LONG_TERM_ROADMAP.md` Phase 14.0.E reward mail roadmap.
 *   - `docs/BALANCE_MODEL.md` §territory owner reward dial table.
 *   - `docs/ECONOMY_MODEL.md` §sources/sinks LinhThach.
 *   - `docs/CHANGELOG.md` Phase 14.0.E entry.
 */

import { MAP_REGIONS, isMapRegionKey, type RegionKey } from './map-regions';
import { itemByKey } from './items';

// ────────────────────────────────────────────────────────────────────────
// Caps
// ────────────────────────────────────────────────────────────────────────

/** Cap linhThach / member / region / period. Vượt → catalog invariant fail. */
export const TERRITORY_OWNER_REWARD_LINH_THACH_CAP = 1000;
/** Cap EXP / member / region / period. */
export const TERRITORY_OWNER_REWARD_EXP_CAP = 600;
/** Cap số item entry / region. */
export const TERRITORY_OWNER_REWARD_ITEM_ENTRIES_CAP = 3;
/** Cap qty / entry. */
export const TERRITORY_OWNER_REWARD_ITEM_QTY_CAP = 5;

// ────────────────────────────────────────────────────────────────────────
// Types
// ────────────────────────────────────────────────────────────────────────

export interface TerritoryOwnerRewardItem {
  readonly itemKey: string;
  readonly qty: number;
}

export interface TerritoryOwnerRewardDef {
  /** Region phải tồn tại trong `MAP_REGIONS`. */
  readonly regionKey: RegionKey;
  /** Linh Thạch tặng / member / region / period (≥ 0, ≤ cap). */
  readonly linhThach: number;
  /** EXP tặng / member / region / period (≥ 0, ≤ cap). */
  readonly exp: number;
  /** Item entry list (0..3); empty list ⇒ không có item drop. */
  readonly itemRewards: ReadonlyArray<TerritoryOwnerRewardItem>;
  /**
   * i18n key cho FE label hint trong mail subject (vd
   * `territory.ownerReward.<regionKey>.subject`).
   */
  readonly subjectI18nKey: string;
  /**
   * i18n key cho FE body hint (vd
   * `territory.ownerReward.<regionKey>.body`).
   */
  readonly bodyI18nKey: string;
  /**
   * Reward hint vi/en — fallback khi i18n locale chưa wire / runtime
   * không có vue-i18n context (vd backend mail subject default copy).
   */
  readonly subjectVi: string;
  readonly subjectEn: string;
  readonly bodyVi: string;
  readonly bodyEn: string;
}

/**
 * Reward catalog — parity 1-1 với `MAP_REGIONS`. Mọi region trong
 * `MAP_REGIONS` PHẢI có entry tương ứng (validator enforce).
 *
 * Tiering theo `unlockRealmKey` của region (early/mid/late):
 *   - early (luyenkhi/truc_co): 200-300 LT, 100-150 EXP, 0-1 PILL_HP/PILL_MP.
 *   - mid (kim_dan): 400 LT, 200 EXP, 1 LINH-tier consumable.
 *   - late (nguyen_anh+): 500-800 LT, 250-400 EXP, 1 LINH consumable.
 *
 * Tổng / member / week (best-case 9 region cùng owner — không thực tế nhưng
 * useful upper bound):
 *   - LT ≈ 200+300+300+400+400+400+500+500+800 = 3800 / week.
 *   - EXP ≈ 100+150+150+200+200+200+250+250+400 = 1900 / week.
 * Realistic 1-3 region / week ⇒ ~600-1500 LT / week / member — đủ thưởng
 * cho hoạt động lãnh địa nhưng KHÔNG vượt income chính (dungeon/mission).
 */
export const TERRITORY_OWNER_REWARDS: readonly TerritoryOwnerRewardDef[] = [
  {
    regionKey: 'son_coc',
    linhThach: 200,
    exp: 100,
    itemRewards: [{ itemKey: 'huyet_chi_dan', qty: 2 }],
    subjectI18nKey: 'territory.ownerReward.son_coc.subject',
    bodyI18nKey: 'territory.ownerReward.son_coc.body',
    subjectVi: 'Thưởng Lãnh Địa Sơn Cốc',
    subjectEn: 'Mountain Valley Territory Reward',
    bodyVi:
      'Tông môn ngươi đã chiếm Sơn Cốc tuần qua. Linh Thạch và Huyết Chỉ Đan đã được tặng thưởng cho thành viên.',
    bodyEn:
      'Your sect held Mountain Valley last week. Spirit Stones and recovery pills have been awarded to members.',
  },
  {
    regionKey: 'hac_lam',
    linhThach: 300,
    exp: 150,
    itemRewards: [{ itemKey: 'linh_lo_dan', qty: 1 }],
    subjectI18nKey: 'territory.ownerReward.hac_lam.subject',
    bodyI18nKey: 'territory.ownerReward.hac_lam.body',
    subjectVi: 'Thưởng Lãnh Địa Hắc Lâm',
    subjectEn: 'Black Forest Territory Reward',
    bodyVi:
      'Tông môn ngươi giữ vững Hắc Lâm. Linh Lộ Đan và Linh Thạch đã được phát cho đệ tử.',
    bodyEn:
      'Your sect maintained control of Black Forest. Mana pills and Spirit Stones have been distributed to disciples.',
  },
  {
    regionKey: 'moc_huyen_lam',
    linhThach: 300,
    exp: 150,
    itemRewards: [{ itemKey: 'huyet_tinh', qty: 2 }],
    subjectI18nKey: 'territory.ownerReward.moc_huyen_lam.subject',
    bodyI18nKey: 'territory.ownerReward.moc_huyen_lam.body',
    subjectVi: 'Thưởng Lãnh Địa Mộc Huyền Lâm',
    subjectEn: 'Wood-Mystery Forest Territory Reward',
    bodyVi:
      'Tông môn ngươi nhận thưởng Mộc Huyền Lâm tuần qua: Linh Thạch và tinh huyết yêu thú.',
    bodyEn:
      'Your sect collected this week\'s Wood-Mystery Forest tribute: Spirit Stones and beast essence.',
  },
  {
    regionKey: 'yeu_thu_dong',
    linhThach: 400,
    exp: 200,
    itemRewards: [{ itemKey: 'thanh_lam_dan', qty: 1 }],
    subjectI18nKey: 'territory.ownerReward.yeu_thu_dong.subject',
    bodyI18nKey: 'territory.ownerReward.yeu_thu_dong.body',
    subjectVi: 'Thưởng Lãnh Địa Yêu Thú Động',
    subjectEn: 'Beast Cavern Territory Reward',
    bodyVi:
      'Yêu Thú Động vẫn dưới sự thống trị của tông ngươi. Thanh Lam Đan và Linh Thạch tới đây.',
    bodyEn:
      'Beast Cavern remains under your sect\'s control. Spirit Stones and Azure Mist Pills have arrived.',
  },
  {
    regionKey: 'kim_son_mach',
    linhThach: 400,
    exp: 200,
    itemRewards: [{ itemKey: 'huyet_tinh', qty: 3 }],
    subjectI18nKey: 'territory.ownerReward.kim_son_mach.subject',
    bodyI18nKey: 'territory.ownerReward.kim_son_mach.body',
    subjectVi: 'Thưởng Lãnh Địa Kim Sơn Mạch',
    subjectEn: 'Golden Mountain Vein Territory Reward',
    bodyVi:
      'Tông môn ngươi khai thác Kim Sơn Mạch tuần qua. Linh Thạch và tinh huyết quặng cổ xin gửi.',
    bodyEn:
      'Your sect mined Golden Mountain Vein this week. Spirit Stones and ancient ore essence have been sent.',
  },
  {
    regionKey: 'thuy_long_uyen',
    linhThach: 400,
    exp: 200,
    itemRewards: [{ itemKey: 'thanh_lam_dan', qty: 1 }],
    subjectI18nKey: 'territory.ownerReward.thuy_long_uyen.subject',
    bodyI18nKey: 'territory.ownerReward.thuy_long_uyen.body',
    subjectVi: 'Thưởng Lãnh Địa Thuỷ Long Uyên',
    subjectEn: 'Water-Dragon Abyss Territory Reward',
    bodyVi:
      'Thuỷ Long Uyên vẫn chấp nhận tông ngươi. Linh Thạch và Thanh Lam Đan đã chuyển vào hòm thư.',
    bodyEn:
      'Water-Dragon Abyss accepts your sect once more. Spirit Stones and Azure Mist Pills delivered.',
  },
  {
    regionKey: 'hoa_diem_son',
    linhThach: 500,
    exp: 250,
    itemRewards: [{ itemKey: 'co_thien_dan', qty: 1 }],
    subjectI18nKey: 'territory.ownerReward.hoa_diem_son.subject',
    bodyI18nKey: 'territory.ownerReward.hoa_diem_son.body',
    subjectVi: 'Thưởng Lãnh Địa Hoả Diệm Sơn',
    subjectEn: 'Flame Mountain Territory Reward',
    bodyVi:
      'Hoả Diệm Sơn cháy vì sự uy nghi của tông ngươi. Cổ Thiên Đan và Linh Thạch xin tặng.',
    bodyEn:
      'Flame Mountain burns for your sect\'s glory. Ancient Heaven Pills and Spirit Stones await.',
  },
  {
    regionKey: 'hoang_tho_huyet',
    linhThach: 500,
    exp: 250,
    itemRewards: [{ itemKey: 'co_thien_dan', qty: 1 }],
    subjectI18nKey: 'territory.ownerReward.hoang_tho_huyet.subject',
    bodyI18nKey: 'territory.ownerReward.hoang_tho_huyet.body',
    subjectVi: 'Thưởng Lãnh Địa Hoàng Thổ Huyệt',
    subjectEn: 'Yellow-Earth Pit Territory Reward',
    bodyVi:
      'Hoàng Thổ Huyệt nay vẫn thuộc tông ngươi. Linh Thạch và Cổ Thiên Đan đã được phong ấn.',
    bodyEn:
      'Yellow-Earth Pit remains your sect\'s domain. Spirit Stones and Ancient Heaven Pills sealed for delivery.',
  },
  {
    regionKey: 'cuu_la_dien',
    linhThach: 800,
    exp: 400,
    itemRewards: [{ itemKey: 'co_thien_dan', qty: 2 }],
    subjectI18nKey: 'territory.ownerReward.cuu_la_dien.subject',
    bodyI18nKey: 'territory.ownerReward.cuu_la_dien.body',
    subjectVi: 'Thưởng Lãnh Địa Cửu La Điện',
    subjectEn: 'Nine-Hells Hall Territory Reward',
    bodyVi:
      'Cửu La Điện chứng kiến uy lực tông ngươi. Cổ Thiên Đan và Linh Thạch là minh chứng tuần này.',
    bodyEn:
      'The Nine-Hells Hall has witnessed your sect\'s might. This week\'s tribute of pills and stones acknowledges it.',
  },
];

// ────────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────────

/**
 * Lookup reward def theo regionKey. Trả `undefined` nếu region không
 * có entry (lỗi catalog invariant — không nên xảy ra production).
 */
export function territoryOwnerRewardByRegion(
  regionKey: string,
): TerritoryOwnerRewardDef | undefined {
  if (!isMapRegionKey(regionKey)) return undefined;
  return TERRITORY_OWNER_REWARDS.find((r) => r.regionKey === regionKey);
}

/**
 * True nếu reward def có ít nhất 1 reward type > 0 (linhThach / exp /
 * items). Catalog invariant validator cũng dùng helper này.
 */
export function territoryOwnerRewardHasValue(
  def: TerritoryOwnerRewardDef,
): boolean {
  return def.linhThach > 0 || def.exp > 0 || def.itemRewards.length > 0;
}

// ────────────────────────────────────────────────────────────────────────
// Validator
// ────────────────────────────────────────────────────────────────────────

export type TerritoryOwnerRewardValidationCode =
  | 'REGION_NOT_IN_MAP'
  | 'REGION_DUPLICATE'
  | 'REGION_MISSING_FROM_CATALOG'
  | 'REWARD_LINH_THACH_INVALID'
  | 'REWARD_LINH_THACH_OVER_CAP'
  | 'REWARD_EXP_INVALID'
  | 'REWARD_EXP_OVER_CAP'
  | 'REWARD_VALUE_NOT_POSITIVE'
  | 'REWARD_ITEM_ENTRIES_OVER_CAP'
  | 'REWARD_ITEM_KEY_INVALID'
  | 'REWARD_ITEM_QTY_INVALID'
  | 'REWARD_ITEM_QTY_OVER_CAP'
  | 'REWARD_ITEM_KEY_DUPLICATE';

/**
 * Validate `TERRITORY_OWNER_REWARDS` invariants — gọi 1 lần ở test
 * (catalog static, immutable). Trả về list error code rỗng nếu pass.
 */
export function validateTerritoryOwnerRewardCatalog(): TerritoryOwnerRewardValidationCode[] {
  const errors: TerritoryOwnerRewardValidationCode[] = [];
  const seenRegions = new Set<string>();
  const mapKeys = new Set(MAP_REGIONS.map((r) => r.key));

  for (const def of TERRITORY_OWNER_REWARDS) {
    if (!mapKeys.has(def.regionKey)) {
      errors.push('REGION_NOT_IN_MAP');
    }
    if (seenRegions.has(def.regionKey)) {
      errors.push('REGION_DUPLICATE');
    }
    seenRegions.add(def.regionKey);

    if (!Number.isFinite(def.linhThach) || def.linhThach < 0) {
      errors.push('REWARD_LINH_THACH_INVALID');
    } else if (def.linhThach > TERRITORY_OWNER_REWARD_LINH_THACH_CAP) {
      errors.push('REWARD_LINH_THACH_OVER_CAP');
    }

    if (!Number.isFinite(def.exp) || def.exp < 0) {
      errors.push('REWARD_EXP_INVALID');
    } else if (def.exp > TERRITORY_OWNER_REWARD_EXP_CAP) {
      errors.push('REWARD_EXP_OVER_CAP');
    }

    if (!territoryOwnerRewardHasValue(def)) {
      errors.push('REWARD_VALUE_NOT_POSITIVE');
    }

    if (def.itemRewards.length > TERRITORY_OWNER_REWARD_ITEM_ENTRIES_CAP) {
      errors.push('REWARD_ITEM_ENTRIES_OVER_CAP');
    }

    const seenItems = new Set<string>();
    for (const it of def.itemRewards) {
      if (!itemByKey(it.itemKey)) {
        errors.push('REWARD_ITEM_KEY_INVALID');
      }
      if (!Number.isInteger(it.qty) || it.qty <= 0) {
        errors.push('REWARD_ITEM_QTY_INVALID');
      } else if (it.qty > TERRITORY_OWNER_REWARD_ITEM_QTY_CAP) {
        errors.push('REWARD_ITEM_QTY_OVER_CAP');
      }
      if (seenItems.has(it.itemKey)) {
        errors.push('REWARD_ITEM_KEY_DUPLICATE');
      }
      seenItems.add(it.itemKey);
    }
  }

  // Parity check — mọi region trong MAP_REGIONS phải có entry.
  for (const r of MAP_REGIONS) {
    if (!seenRegions.has(r.key)) errors.push('REGION_MISSING_FROM_CATALOG');
  }

  return errors;
}
