/**
 * Phase 16.6 — Market Price Band catalog (shared, pure data + helpers).
 *
 * Mỗi item được phép niêm yết market trong khoảng `[minPrice, maxPrice]`
 * linh thạch / unit. Listing ngoài band → reject với `INVALID_PRICE_BAND`.
 *
 * **Mục tiêu**:
 *   - Chặn chuyển tài sản giả mạo (admin grant 1 LT cho item, đăng giá
 *     1B LT cho alt account mua).
 *   - Chặn flooding market với giá troll (1 LT cho item TIEN — vô tình
 *     giết economy + tạo arbitrage bot).
 *   - **KHÔNG ảnh hưởng listing đã ACTIVE** — chỉ áp dụng cho listing
 *     mới. Existing listing tiếp tục bán bình thường (KHÔNG mutate).
 *
 * **Per-item override** ưu tiên cao nhất nếu có, ngược lại fallback
 * theo rarity (`Quality`). Default rarity band tuned conservative
 * theo `ItemDef.price` baseline (xem `BALANCE_MODEL.md` §17).
 *
 * Pure — không đọc env, không mutate Prisma. Test 100% deterministic.
 */

import type { Quality } from './enums';
import type { ItemDef } from './items';
import { itemByKey } from './items';

export interface MarketPriceBand {
  /** Min price/unit (linh thạch). Tính `> 0n`. */
  readonly minPrice: bigint;
  /** Max price/unit (linh thạch). Luôn `>= minPrice`. */
  readonly maxPrice: bigint;
  /** Source identification cho UI hint. */
  readonly source: 'PER_ITEM' | 'RARITY_FALLBACK' | 'GLOBAL_FALLBACK';
}

/**
 * Default band theo rarity. Lấy từ `ItemDef.price` baseline scale lên/xuống.
 *
 * **Tuning rationale**:
 *   - PHAM (price ~30-100): band [10, 1_000] — phổ thông, không có
 *     mục tiêu RMT.
 *   - LINH (price ~150-300): band [50, 5_000] — đan dược/bí kíp, có
 *     trade nhưng giá trần đủ rộng cho whale.
 *   - HUYEN (price ~700-1_500): band [200, 50_000] — gear endgame mid,
 *     cần băng đủ rộng cho rare drop.
 *   - TIEN (price ~3_000-8_000): band [1_000, 500_000] — gear endgame
 *     high; band rộng để cover các affix luck/spirit cao.
 *   - THAN (price ~15_000+): band [5_000, 5_000_000] — top tier; band
 *     rất rộng vì giao dịch hiếm. CRITICAL anomaly nếu vượt.
 *
 * NB: `Quality.PHAM` không có `pham_giap` price > 100 → band PHAM rộng
 * gấp ~10x baseline để cover trường hợp item PHAM stackable nhỏ
 * (vd ore, pill PHAM) bán cho người mới.
 */
export const DEFAULT_PRICE_BAND_BY_QUALITY: Readonly<
  Record<Quality, { minPrice: bigint; maxPrice: bigint }>
> = Object.freeze({
  PHAM: { minPrice: 10n, maxPrice: 1_000n },
  LINH: { minPrice: 50n, maxPrice: 5_000n },
  HUYEN: { minPrice: 200n, maxPrice: 50_000n },
  TIEN: { minPrice: 1_000n, maxPrice: 500_000n },
  THAN: { minPrice: 5_000n, maxPrice: 5_000_000n },
});

/**
 * Per-item override. Phase 16.6 chưa fill — stub Map empty. Dev/ops
 * thêm key cụ thể khi cần (vd "som_tien_dan" PILL_EXP TIEN giá floor
 * cao hơn rarity TIEN baseline để chặn dump).
 *
 * Convention naming: `<itemKey>` → band cụ thể.
 */
export const MARKET_PRICE_BAND_BY_ITEM: Readonly<
  Record<string, { minPrice: bigint; maxPrice: bigint }>
> = Object.freeze({
  // Phase 16.6 không có override — sẽ thêm sau khi observe data closed beta.
});

/**
 * Global fallback khi rarity không nhận diện được. KHÔNG nên xảy ra với
 * `ItemDef` chuẩn (Quality enum strict), nhưng safety net cho legacy /
 * data lệch.
 */
export const GLOBAL_FALLBACK_PRICE_BAND: {
  readonly minPrice: bigint;
  readonly maxPrice: bigint;
} = Object.freeze({
  minPrice: 10n,
  maxPrice: 5_000_000n,
});

/**
 * Lookup band cho 1 itemKey. Order:
 *   1. Per-item override trong `MARKET_PRICE_BAND_BY_ITEM`.
 *   2. Default band theo rarity từ `itemByKey(itemKey).quality`.
 *   3. `GLOBAL_FALLBACK_PRICE_BAND` (item không tồn tại / quality lệch).
 *
 * Pure — không I/O. Test 100% deterministic.
 */
export function getMarketPriceBandForItem(itemKey: string): MarketPriceBand {
  const override = MARKET_PRICE_BAND_BY_ITEM[itemKey];
  if (override) {
    return {
      minPrice: override.minPrice,
      maxPrice: override.maxPrice,
      source: 'PER_ITEM',
    };
  }
  const item: ItemDef | undefined = itemByKey(itemKey);
  if (item) {
    const rarityBand = DEFAULT_PRICE_BAND_BY_QUALITY[item.quality];
    if (rarityBand) {
      return {
        minPrice: rarityBand.minPrice,
        maxPrice: rarityBand.maxPrice,
        source: 'RARITY_FALLBACK',
      };
    }
  }
  return {
    minPrice: GLOBAL_FALLBACK_PRICE_BAND.minPrice,
    maxPrice: GLOBAL_FALLBACK_PRICE_BAND.maxPrice,
    source: 'GLOBAL_FALLBACK',
  };
}

/**
 * Check `pricePerUnit` có nằm trong band của itemKey không.
 *
 * Trả `{ ok: true, band }` nếu hợp lệ. Ngược lại trả error code
 * `'TOO_LOW' | 'TOO_HIGH'` + band để caller render lỗi user.
 *
 * KHÔNG throw — caller (API service) tự throw `MarketError`.
 */
export type CheckListingPriceResult =
  | { readonly ok: true; readonly band: MarketPriceBand }
  | {
      readonly ok: false;
      readonly band: MarketPriceBand;
      readonly reason: 'TOO_LOW' | 'TOO_HIGH';
    };

export function checkListingPriceBand(
  itemKey: string,
  pricePerUnit: bigint,
): CheckListingPriceResult {
  const band = getMarketPriceBandForItem(itemKey);
  if (pricePerUnit < band.minPrice) {
    return { ok: false, band, reason: 'TOO_LOW' };
  }
  if (pricePerUnit > band.maxPrice) {
    return { ok: false, band, reason: 'TOO_HIGH' };
  }
  return { ok: true, band };
}
