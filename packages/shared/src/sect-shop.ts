/**
 * Sect Shop (Tông Môn Tiệm) — Phase 13.1.B catalog & helpers.
 *
 * Pure data. Catalog-driven; KHÔNG runtime/schema. Item phải tồn tại trong
 * `items.ts` ITEMS catalog — trùng key.
 *
 * Mục tiêu PR (file 13.1.B Phase C):
 *   - Định nghĩa Sect Shop entry: itemKey + contributionCost + daily/weekly limit.
 *   - Phân tier:
 *     1. Pill thường (huyết chỉ đan, thanh lam đan)        — cost thấp, daily cap.
 *     2. Pill cao cấp (cổ thiên đan, vạn linh đan)         — cost cao, weekly cap.
 *     3. Material rare (linh căn đan)                       — cost rất cao, weekly cap 1.
 *
 * Anti-abuse:
 *   - Daily/Weekly limit ép ở backend qua sum `SectShopPurchase.qty`
 *     trong period window. FE display nhưng KHÔNG là source of truth.
 *   - Server-authoritative cost — FE không gửi cost, chỉ gửi `entryKey + qty`.
 *   - Yêu cầu `Character.sectId != null` (xem `SectShopService`).
 *   - Character.sectContribBalance >= cost*qty (atomic CAS — xem service).
 */

import { itemByKey } from './items';

// ────────────────────────────────────────────────────────────────────────
// Types
// ────────────────────────────────────────────────────────────────────────

export interface SectShopEntryDef {
  /** Stable entry key (catalog identifier). Đừng đổi sau khi production. */
  readonly key: string;
  /** Item key trong catalog `items.ts`. Validate ở runtime. */
  readonly itemKey: string;
  /** Số điểm cống hiến cần trừ mỗi unit. >= 1. */
  readonly contributionCost: number;
  /** Optional cap số unit / character / ngày (theo TZ). 0/undefined = không cap. */
  readonly dailyLimit?: number;
  /** Optional cap số unit / character / tuần ISO. 0/undefined = không cap. */
  readonly weeklyLimit?: number;
  /** Optional sect.level >= n yêu cầu (Phase 13.1.B chưa unlock — placeholder). */
  readonly requiredSectLevel?: number;
  /** i18n key cho FE render. */
  readonly labelI18nKey: string;
  readonly descriptionI18nKey: string;
}

// ────────────────────────────────────────────────────────────────────────
// Catalog
// ────────────────────────────────────────────────────────────────────────

/**
 * Sect Shop initial catalog (Phase 13.1.B). Order stable.
 *
 * Balance philosophy (BALANCE_MODEL.md §sect-shop):
 *   - Player active hằng tuần đạt ~700-1000 contribution (mission daily +
 *     weekly + sect war activity).
 *   - Catalog phải "vừa phải" — không tạo whale-only spend, không khuyến khích
 *     hoarding.
 *   - Pill phổ thông (huyết_chi_đan / thanh_lam_đan) cost ~50-80, daily cap
 *     5/3 → ~250-400 contribution/ngày = đủ no-AFK player tiêu hết daily.
 *   - Pill cao cấp (cổ_thiên_đan) cost 200, weekly cap 3 → 600 contribution
 *     ≈ 1 lần spend big chunk weekly.
 *   - Vạn linh đan (placeholder thượng phẩm) cost 1500 weekly cap 1 = end-game
 *     spend cho main treasure.
 *   - Linh căn đan cost 5000 weekly cap 1 = save-up reward (multi-tuần).
 */
export const SECT_SHOP_ENTRIES: readonly SectShopEntryDef[] = [
  {
    key: 'sect_shop_huyet_chi_dan',
    itemKey: 'huyet_chi_dan',
    contributionCost: 50,
    dailyLimit: 5,
    labelI18nKey: 'sectShop.entry.huyet_chi_dan.label',
    descriptionI18nKey: 'sectShop.entry.huyet_chi_dan.desc',
  },
  {
    key: 'sect_shop_thanh_lam_dan',
    itemKey: 'thanh_lam_dan',
    contributionCost: 250,
    dailyLimit: 3,
    labelI18nKey: 'sectShop.entry.thanh_lam_dan.label',
    descriptionI18nKey: 'sectShop.entry.thanh_lam_dan.desc',
  },
  {
    key: 'sect_shop_co_thien_dan',
    itemKey: 'co_thien_dan',
    contributionCost: 200,
    weeklyLimit: 3,
    labelI18nKey: 'sectShop.entry.co_thien_dan.label',
    descriptionI18nKey: 'sectShop.entry.co_thien_dan.desc',
  },
  {
    key: 'sect_shop_huyet_tinh',
    itemKey: 'huyet_tinh',
    contributionCost: 80,
    weeklyLimit: 10,
    labelI18nKey: 'sectShop.entry.huyet_tinh.label',
    descriptionI18nKey: 'sectShop.entry.huyet_tinh.desc',
  },
  {
    key: 'sect_shop_than_dan',
    itemKey: 'than_dan',
    contributionCost: 5000,
    weeklyLimit: 1,
    labelI18nKey: 'sectShop.entry.than_dan.label',
    descriptionI18nKey: 'sectShop.entry.than_dan.desc',
  },
];

// ────────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────────

/** Lookup entry theo key. */
export function sectShopEntryByKey(key: string): SectShopEntryDef | undefined {
  return SECT_SHOP_ENTRIES.find((e) => e.key === key);
}

/**
 * Validate catalog tại module load — chạy 1 lần (test). Không export
 * vì vô tình runtime caller không gọi; test sẽ assert.
 */
export function validateSectShopCatalog(): { ok: boolean; errors: string[] } {
  const errors: string[] = [];
  const seen = new Set<string>();
  for (const e of SECT_SHOP_ENTRIES) {
    if (seen.has(e.key)) errors.push(`duplicate entry key ${e.key}`);
    seen.add(e.key);
    if (!itemByKey(e.itemKey)) {
      errors.push(`entry ${e.key} references unknown itemKey ${e.itemKey}`);
    }
    if (e.contributionCost < 1) {
      errors.push(`entry ${e.key} contributionCost must be >= 1`);
    }
    if (e.dailyLimit !== undefined && e.dailyLimit < 1) {
      errors.push(`entry ${e.key} dailyLimit must be >= 1`);
    }
    if (e.weeklyLimit !== undefined && e.weeklyLimit < 1) {
      errors.push(`entry ${e.key} weeklyLimit must be >= 1`);
    }
  }
  return { ok: errors.length === 0, errors };
}
