import { describe, it, expect } from 'vitest';
import {
  DEFAULT_PRICE_BAND_BY_QUALITY,
  GLOBAL_FALLBACK_PRICE_BAND,
  MARKET_PRICE_BAND_BY_ITEM,
  checkListingPriceBand,
  getMarketPriceBandForItem,
} from './market-price-band';
import { QUALITIES } from './enums';
import { ITEMS } from './items';

describe('Phase 16.6 — market price band catalog', () => {
  it('có band cho mọi rarity', () => {
    for (const q of QUALITIES) {
      const band = DEFAULT_PRICE_BAND_BY_QUALITY[q];
      expect(band).toBeDefined();
      expect(band.minPrice > 0n).toBe(true);
      expect(band.maxPrice > band.minPrice).toBe(true);
    }
  });

  it('rarity band tăng dần theo quality (PHAM nhỏ hơn THAN)', () => {
    expect(DEFAULT_PRICE_BAND_BY_QUALITY.PHAM.maxPrice).toBeLessThan(
      DEFAULT_PRICE_BAND_BY_QUALITY.LINH.maxPrice,
    );
    expect(DEFAULT_PRICE_BAND_BY_QUALITY.LINH.maxPrice).toBeLessThan(
      DEFAULT_PRICE_BAND_BY_QUALITY.HUYEN.maxPrice,
    );
    expect(DEFAULT_PRICE_BAND_BY_QUALITY.HUYEN.maxPrice).toBeLessThan(
      DEFAULT_PRICE_BAND_BY_QUALITY.TIEN.maxPrice,
    );
    expect(DEFAULT_PRICE_BAND_BY_QUALITY.TIEN.maxPrice).toBeLessThan(
      DEFAULT_PRICE_BAND_BY_QUALITY.THAN.maxPrice,
    );
  });

  it('global fallback positive + maxPrice > minPrice', () => {
    expect(GLOBAL_FALLBACK_PRICE_BAND.minPrice > 0n).toBe(true);
    expect(GLOBAL_FALLBACK_PRICE_BAND.maxPrice).toBeGreaterThan(
      GLOBAL_FALLBACK_PRICE_BAND.minPrice,
    );
  });

  it('per-item override (nếu có) hợp lệ', () => {
    for (const [itemKey, band] of Object.entries(MARKET_PRICE_BAND_BY_ITEM)) {
      expect(itemKey.length).toBeGreaterThan(0);
      expect(band.minPrice > 0n).toBe(true);
      expect(band.maxPrice).toBeGreaterThan(band.minPrice);
    }
  });
});

describe('getMarketPriceBandForItem', () => {
  it('item PHAM (so_kiem) trả band PHAM rarity fallback', () => {
    const band = getMarketPriceBandForItem('so_kiem');
    expect(band.source).toBe('RARITY_FALLBACK');
    expect(band.minPrice).toBe(DEFAULT_PRICE_BAND_BY_QUALITY.PHAM.minPrice);
    expect(band.maxPrice).toBe(DEFAULT_PRICE_BAND_BY_QUALITY.PHAM.maxPrice);
  });

  it('item key không tồn tại trả global fallback', () => {
    const band = getMarketPriceBandForItem('NOT_A_REAL_ITEM_KEY');
    expect(band.source).toBe('GLOBAL_FALLBACK');
    expect(band.minPrice).toBe(GLOBAL_FALLBACK_PRICE_BAND.minPrice);
    expect(band.maxPrice).toBe(GLOBAL_FALLBACK_PRICE_BAND.maxPrice);
  });

  it('mọi ITEMS trong catalog có band lookup ra rarity (≠ GLOBAL_FALLBACK)', () => {
    for (const item of ITEMS) {
      const band = getMarketPriceBandForItem(item.key);
      expect(band.source).not.toBe('GLOBAL_FALLBACK');
    }
  });
});

describe('checkListingPriceBand', () => {
  it('giá trong band ⇒ ok', () => {
    // so_kiem (PHAM) band [10, 1_000].
    const r = checkListingPriceBand('so_kiem', 100n);
    expect(r.ok).toBe(true);
    expect(r.band.minPrice).toBe(10n);
    expect(r.band.maxPrice).toBe(1_000n);
  });

  it('giá thấp hơn min ⇒ TOO_LOW + band', () => {
    const r = checkListingPriceBand('so_kiem', 1n);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe('TOO_LOW');
      expect(r.band.minPrice).toBe(10n);
    }
  });

  it('giá cao hơn max ⇒ TOO_HIGH + band', () => {
    const r = checkListingPriceBand('so_kiem', 999_999_999n);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe('TOO_HIGH');
      expect(r.band.maxPrice).toBe(1_000n);
    }
  });

  it('giá đúng biên min/max ⇒ ok (inclusive)', () => {
    const minR = checkListingPriceBand('so_kiem', 10n);
    expect(minR.ok).toBe(true);
    const maxR = checkListingPriceBand('so_kiem', 1_000n);
    expect(maxR.ok).toBe(true);
  });

  it('item rarity TIEN có band rộng phù hợp endgame', () => {
    // Tìm 1 item TIEN trong catalog làm sanity check.
    const tienItem = ITEMS.find((i) => i.quality === 'TIEN');
    if (tienItem) {
      const inBand = checkListingPriceBand(tienItem.key, 50_000n);
      expect(inBand.ok).toBe(true);
      const tooHigh = checkListingPriceBand(tienItem.key, 10_000_000n);
      expect(tooHigh.ok).toBe(false);
    }
  });
});
