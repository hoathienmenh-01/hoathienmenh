import { describe, it, expect } from 'vitest';

import {
  computeMarketFee,
  validateListingPolicy,
  validateAuctionInput,
  validateBid,
  validatePersonalStall,
  validateSectAuctionInput,
  validateMarketItemPolicy,
  validateMarketFeeConfig,
  classifyMarketAnomaly,
  computePriceSnapshot,
  DEFAULT_MARKET_FEE_CONFIG,
  MARKET_LISTING_TYPES,
  MARKET_CURRENCIES,
  MARKET_ANOMALY_TYPES,
} from './market-v2';

describe('Phase 30.0 — market-v2: enums', () => {
  it('exposes 4 listing types', () => {
    expect(MARKET_LISTING_TYPES).toEqual([
      'FIXED_PRICE',
      'AUCTION',
      'PERSONAL_STALL',
      'SECT_INTERNAL_AUCTION',
    ]);
  });

  it('exposes 4 trade currencies — KHÔNG có TIEN_NGOC nạp', () => {
    expect(MARKET_CURRENCIES).toEqual([
      'LINH_THACH',
      'SECT_CONTRIBUTION',
      'EVENT_TOKEN',
      'TIEN_NGOC_KHOA',
    ]);
    expect(MARKET_CURRENCIES).not.toContain('TIEN_NGOC');
  });

  it('exposes 10 anomaly types', () => {
    expect(MARKET_ANOMALY_TYPES.length).toBe(10);
  });
});

describe('Phase 30.0 — market-v2: validateListingPolicy', () => {
  const base = {
    sellerCharacterId: 'c1',
    itemKey: 'pill_hp_t1',
    itemTradability: 'TRADEABLE' as const,
    quantity: 1,
    unitPrice: 100,
    currency: 'LINH_THACH' as const,
    isEquipped: false,
    isLockedExternal: false,
    isExpired: false,
  };

  it('chấp nhận listing hợp lệ', () => {
    expect(validateListingPolicy(base).ok).toBe(true);
  });

  it('chặn currency TIEN_NGOC (nạp)', () => {
    const r = validateListingPolicy({
      ...base,
      currency: 'TIEN_NGOC' as never,
    });
    expect(r).toEqual({ ok: false, code: 'MARKET_PAID_PREMIUM_NOT_TRADEABLE' });
  });

  it('chặn item bind on pickup', () => {
    const r = validateListingPolicy({ ...base, itemTradability: 'BIND_ON_PICKUP' });
    expect(r).toEqual({ ok: false, code: 'MARKET_ITEM_BIND' });
  });

  it('chặn item expired', () => {
    const r = validateListingPolicy({ ...base, isExpired: true });
    expect(r).toEqual({ ok: false, code: 'MARKET_ITEM_EXPIRED' });
  });

  it('chặn item đang trang bị', () => {
    const r = validateListingPolicy({ ...base, isEquipped: true });
    expect(r).toEqual({ ok: false, code: 'MARKET_ITEM_EQUIPPED' });
  });

  it('chặn item đang locked external (recipe/auction)', () => {
    const r = validateListingPolicy({ ...base, isLockedExternal: true });
    expect(r).toEqual({ ok: false, code: 'MARKET_ITEM_LOCKED_EXTERNAL' });
  });

  it('chặn qty < 1', () => {
    expect(validateListingPolicy({ ...base, quantity: 0 })).toEqual({
      ok: false,
      code: 'MARKET_QTY_LT_1',
    });
  });

  it('chặn unitPrice < 1', () => {
    expect(validateListingPolicy({ ...base, unitPrice: 0 })).toEqual({
      ok: false,
      code: 'MARKET_UNIT_PRICE_LT_1',
    });
  });

  it('respect policy.minPrice', () => {
    const r = validateListingPolicy({
      ...base,
      unitPrice: 50,
      itemPolicy: {
        itemKey: 'pill_hp_t1',
        tradability: 'TRADEABLE',
        minPrice: 100,
      },
    });
    expect(r).toEqual({ ok: false, code: 'MARKET_PRICE_BELOW_MIN' });
  });

  it('respect policy.maxPrice', () => {
    const r = validateListingPolicy({
      ...base,
      unitPrice: 10_000,
      itemPolicy: {
        itemKey: 'pill_hp_t1',
        tradability: 'TRADEABLE',
        maxPrice: 1_000,
      },
    });
    expect(r).toEqual({ ok: false, code: 'MARKET_PRICE_ABOVE_MAX' });
  });

  it('respect policy.maxQtyPerListing', () => {
    const r = validateListingPolicy({
      ...base,
      quantity: 100,
      itemPolicy: {
        itemKey: 'pill_hp_t1',
        tradability: 'TRADEABLE',
        maxQtyPerListing: 10,
      },
    });
    expect(r).toEqual({ ok: false, code: 'MARKET_QTY_EXCEEDS_POLICY' });
  });

  it('respect policy.maxListingsPerDay', () => {
    const r = validateListingPolicy({
      ...base,
      todayListingCountForItem: 5,
      itemPolicy: {
        itemKey: 'pill_hp_t1',
        tradability: 'TRADEABLE',
        maxListingsPerDay: 5,
      },
    });
    expect(r).toEqual({ ok: false, code: 'MARKET_LISTING_LIMIT_REACHED' });
  });

  it('chặn ADMIN_LOCKED qua policy override', () => {
    const r = validateListingPolicy({
      ...base,
      itemPolicy: {
        itemKey: 'pill_hp_t1',
        tradability: 'ADMIN_LOCKED',
      },
    });
    expect(r).toEqual({ ok: false, code: 'MARKET_ITEM_ADMIN_LOCKED' });
  });
});

describe('Phase 30.0 — market-v2: computeMarketFee', () => {
  it('tính listing fee + tax cơ bản', () => {
    const { listingFee, transactionTaxBase } = computeMarketFee(
      DEFAULT_MARKET_FEE_CONFIG,
      1000,
      1,
    );
    expect(listingFee).toBeGreaterThan(0);
    expect(transactionTaxBase).toBe(50);
  });

  it('tier multiplier tăng fee', () => {
    const t1 = computeMarketFee(DEFAULT_MARKET_FEE_CONFIG, 1000, 1, { tier: 1 });
    const t5 = computeMarketFee(DEFAULT_MARKET_FEE_CONFIG, 1000, 1, { tier: 5 });
    expect(t5.listingFee).toBeGreaterThan(t1.listingFee);
  });

  it('auction fee bao gồm auctionCreateFee', () => {
    const fp = computeMarketFee(DEFAULT_MARKET_FEE_CONFIG, 1000, 1);
    const auc = computeMarketFee(DEFAULT_MARKET_FEE_CONFIG, 1000, 1, {
      isAuction: true,
    });
    expect(auc.listingFee).toBeGreaterThan(fp.listingFee);
  });

  it('clamp về minFee/maxFee', () => {
    const cfg = {
      ...DEFAULT_MARKET_FEE_CONFIG,
      listingFeeFlat: 1_000_000_000,
      maxFee: 50_000,
    };
    const r = computeMarketFee(cfg, 1000, 1);
    expect(r.listingFee).toBe(50_000);
  });
});

describe('Phase 30.0 — market-v2: validateMarketItemPolicy', () => {
  it('chấp nhận policy hợp lệ', () => {
    expect(
      validateMarketItemPolicy({
        itemKey: 'pill_hp_t1',
        tradability: 'TRADEABLE',
        minPrice: 100,
        maxPrice: 1000,
      }),
    ).toEqual([]);
  });

  it('reject min > max', () => {
    const errs = validateMarketItemPolicy({
      itemKey: 'pill_hp_t1',
      tradability: 'TRADEABLE',
      minPrice: 1000,
      maxPrice: 100,
    });
    expect(errs).toContain('MARKET_POLICY_MIN_GT_MAX');
  });

  it('reject tax > 0.5', () => {
    const errs = validateMarketItemPolicy({
      itemKey: 'pill_hp_t1',
      tradability: 'TRADEABLE',
      taxRatePctOverride: 0.6,
    });
    expect(errs).toContain('MARKET_POLICY_TAX_OUT_OF_RANGE');
  });
});

describe('Phase 30.0 — market-v2: validateMarketFeeConfig', () => {
  it('default config hợp lệ', () => {
    expect(validateMarketFeeConfig(DEFAULT_MARKET_FEE_CONFIG)).toEqual([]);
  });

  it('reject tax > 0.5', () => {
    const errs = validateMarketFeeConfig({
      ...DEFAULT_MARKET_FEE_CONFIG,
      transactionTaxPercent: 0.6,
    });
    expect(errs).toContain('MARKET_FEE_TAX_OUT_OF_RANGE');
  });

  it('reject maxFee < minFee', () => {
    const errs = validateMarketFeeConfig({
      ...DEFAULT_MARKET_FEE_CONFIG,
      minFee: 100,
      maxFee: 50,
    });
    expect(errs).toContain('MARKET_FEE_MAX_LT_MIN');
  });
});

describe('Phase 30.0 — market-v2: validateAuctionInput', () => {
  const base = {
    sellerCharacterId: 'c1',
    itemKey: 'artifact_1',
    quantity: 1,
    startPrice: 1000,
    minBidStep: 100,
    currency: 'LINH_THACH' as const,
    durationMinutes: 60 * 24,
  };

  it('chấp nhận auction hợp lệ', () => {
    expect(validateAuctionInput(base).ok).toBe(true);
  });

  it('chặn duration < 30 phút', () => {
    const r = validateAuctionInput({ ...base, durationMinutes: 10 });
    expect(r).toEqual({ ok: false, code: 'MARKET_AUCTION_DURATION_OUT_OF_RANGE' });
  });

  it('chặn buyout <= start', () => {
    const r = validateAuctionInput({ ...base, buyoutPrice: 1000 });
    expect(r).toEqual({ ok: false, code: 'MARKET_AUCTION_BUYOUT_LE_START' });
  });

  it('chặn currency TIEN_NGOC', () => {
    const r = validateAuctionInput({ ...base, currency: 'TIEN_NGOC' as never });
    expect(r).toEqual({ ok: false, code: 'MARKET_PAID_PREMIUM_NOT_TRADEABLE' });
  });
});

describe('Phase 30.0 — market-v2: validateBid', () => {
  const now = '2026-05-13T13:00:00.000Z';
  const endsAt = '2026-05-13T14:00:00.000Z';
  const base = {
    auctionId: 'a1',
    bidderCharacterId: 'c2',
    bidAmount: 2000,
    currency: 'LINH_THACH' as const,
    currentBid: 1500,
    minBidStep: 100,
    sellerCharacterId: 'c1',
    auctionStatus: 'ACTIVE' as const,
    endsAt,
    nowIso: now,
  };

  it('chấp nhận bid hợp lệ', () => {
    expect(validateBid(base)).toEqual({ ok: true, isBuyout: false });
  });

  it('chặn self-bid', () => {
    expect(validateBid({ ...base, bidderCharacterId: 'c1' })).toEqual({
      ok: false,
      code: 'MARKET_AUCTION_SELF_BID',
    });
  });

  it('chặn bid khi auction đã ENDED', () => {
    expect(
      validateBid({ ...base, auctionStatus: 'FINALIZED' as const }),
    ).toEqual({ ok: false, code: 'MARKET_AUCTION_NOT_ACTIVE' });
  });

  it('chặn bid quá thấp (< current + minStep)', () => {
    expect(validateBid({ ...base, bidAmount: 1500 })).toEqual({
      ok: false,
      code: 'MARKET_AUCTION_BID_TOO_LOW',
    });
  });

  it('phát hiện buyout khi bid >= buyoutPrice', () => {
    expect(validateBid({ ...base, bidAmount: 5000, buyoutPrice: 5000 })).toEqual({
      ok: true,
      isBuyout: true,
    });
  });

  it('chặn bid sau end time', () => {
    expect(validateBid({ ...base, nowIso: '2026-05-13T15:00:00.000Z' })).toEqual({
      ok: false,
      code: 'MARKET_AUCTION_ENDED',
    });
  });
});

describe('Phase 30.0 — market-v2: validatePersonalStall', () => {
  it('chấp nhận stall hợp lệ', () => {
    expect(
      validatePersonalStall({
        characterId: 'c1',
        stallName: 'Hàng Hộ Mệnh',
        slotLimit: 6,
      }),
    ).toEqual([]);
  });

  it('chặn stall name > 30 chars', () => {
    const errs = validatePersonalStall({
      characterId: 'c1',
      stallName: 'x'.repeat(50),
      slotLimit: 6,
    });
    expect(errs).toContain('STALL_NAME_TOO_LONG');
  });

  it('chặn slotLimit > 30', () => {
    const errs = validatePersonalStall({
      characterId: 'c1',
      stallName: 'OK',
      slotLimit: 100,
    });
    expect(errs).toContain('STALL_SLOT_LIMIT_OUT_OF_RANGE');
  });
});

describe('Phase 30.0 — market-v2: validateSectAuctionInput', () => {
  it('chấp nhận sect auction hợp lệ', () => {
    expect(
      validateSectAuctionInput({
        sectId: 's1',
        itemKey: 'artifact_1',
        quantity: 1,
        startPrice: 1000,
        minBidStep: 100,
        currency: 'SECT_CONTRIBUTION',
        durationMinutes: 60 * 24,
      }).ok,
    ).toBe(true);
  });

  it('chặn currency event_token cho sect auction', () => {
    const r = validateSectAuctionInput({
      sectId: 's1',
      itemKey: 'artifact_1',
      quantity: 1,
      startPrice: 1000,
      minBidStep: 100,
      currency: 'EVENT_TOKEN',
      durationMinutes: 60 * 24,
    });
    expect(r).toEqual({ ok: false, code: 'SECT_AUCTION_INVALID_CURRENCY' });
  });
});

describe('Phase 30.0 — market-v2: classifyMarketAnomaly', () => {
  it('PRICE_TOO_LOW < 10% median = CRITICAL', () => {
    expect(
      classifyMarketAnomaly({ type: 'PRICE_TOO_LOW', priceRatio: 0.05 }),
    ).toBe('CRITICAL');
  });

  it('PRICE_TOO_LOW > 10% median = WARN (default)', () => {
    expect(
      classifyMarketAnomaly({ type: 'PRICE_TOO_LOW', priceRatio: 0.5 }),
    ).toBe('WARN');
  });

  it('LARGE_VALUE_TRANSFER > 100M = CRITICAL', () => {
    expect(
      classifyMarketAnomaly({ type: 'LARGE_VALUE_TRANSFER', totalValue: 200_000_000 }),
    ).toBe('CRITICAL');
  });

  it('ALT_ACCOUNT_SUSPECTED default = CRITICAL', () => {
    expect(classifyMarketAnomaly({ type: 'ALT_ACCOUNT_SUSPECTED' })).toBe(
      'CRITICAL',
    );
  });

  it('EXCESSIVE_CANCEL_RELIST default = INFO', () => {
    expect(classifyMarketAnomaly({ type: 'EXCESSIVE_CANCEL_RELIST' })).toBe(
      'INFO',
    );
  });
});

describe('Phase 30.0 — market-v2: computePriceSnapshot', () => {
  const now = '2026-05-13T13:00:00.000Z';
  it('snapshot rỗng khi không có transaction', () => {
    const r = computePriceSnapshot({
      itemKey: 'pill_hp_t1',
      transactions: [],
      nowIso: now,
    });
    expect(r.avgPrice24h).toBe(0);
    expect(r.minPrice).toBe(0);
    expect(r.maxPrice).toBe(0);
    expect(r.volume24h).toBe(0);
  });

  it('snapshot tính đúng avg/min/max', () => {
    const r = computePriceSnapshot({
      itemKey: 'pill_hp_t1',
      transactions: [
        { unitPrice: 100, quantity: 1, timestamp: now },
        { unitPrice: 200, quantity: 1, timestamp: now },
      ],
      nowIso: now,
    });
    expect(r.avgPrice24h).toBe(150);
    expect(r.minPrice).toBe(100);
    expect(r.maxPrice).toBe(200);
    expect(r.volume24h).toBe(300);
  });

  it('exclude transactions ngoài window 24h', () => {
    const oneWeekAgo = '2026-05-06T13:00:00.000Z';
    const r = computePriceSnapshot({
      itemKey: 'pill_hp_t1',
      transactions: [
        { unitPrice: 1000, quantity: 1, timestamp: oneWeekAgo },
        { unitPrice: 100, quantity: 1, timestamp: now },
      ],
      nowIso: now,
    });
    expect(r.avgPrice24h).toBe(100);
    expect(r.avgPrice7d).toBeGreaterThan(0);
  });
});
