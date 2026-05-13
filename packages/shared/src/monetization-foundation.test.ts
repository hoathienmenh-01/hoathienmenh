import { describe, expect, it } from 'vitest';
import {
  ENTITLEMENTS,
  ENTITLEMENT_VALUE_CAPS,
  EXTRA_ATTEMPT_LIMITS,
  GROWTH_FUND_VARIANTS,
  MONETIZATION_ERROR_CODES,
  MONTHLY_CARD_VARIANTS,
  NON_SWEEPABLE_CONTENT_TYPES,
  SHOP_PRODUCTS,
  SWEEPABLE_CONTENT_TYPES,
  WALLET_CURRENCIES,
  WALLET_CURRENCY_KEYS,
  canSweepContentType,
  getEntitlementDef,
  getExtraAttemptLimit,
  getGrowthFundMilestone,
  getGrowthFundVariant,
  getMonthlyCardVariant,
  getShopProduct,
  getWalletCurrencyDef,
  periodKey,
  validateMonetizationFoundationCatalog,
} from './monetization-foundation';
import { REALMS } from './realms';

describe('monetization foundation — catalog invariants', () => {
  it('all wallet currencies have a registered def', () => {
    for (const key of WALLET_CURRENCY_KEYS) {
      const def = getWalletCurrencyDef(key);
      expect(def.key).toBe(key);
      expect(def.nameVi.length).toBeGreaterThan(0);
      expect(def.nameEn.length).toBeGreaterThan(0);
    }
    expect(WALLET_CURRENCIES.length).toBe(WALLET_CURRENCY_KEYS.length);
  });

  it('TIEN_NGOC_KHOA is bound (anti-trade)', () => {
    expect(getWalletCurrencyDef('TIEN_NGOC_KHOA').bound).toBe(true);
  });

  it('all entitlements have maxValue ≤ ENTITLEMENT_VALUE_CAPS', () => {
    for (const e of ENTITLEMENTS) {
      expect(e.maxValue).toBeLessThanOrEqual(ENTITLEMENT_VALUE_CAPS[e.key]);
    }
  });

  it('every shop product references a known catalog id', () => {
    for (const p of SHOP_PRODUCTS) {
      if (p.productType === 'MONTHLY_CARD') {
        expect(getMonthlyCardVariant(p.monthlyCardKey ?? '')).toBeDefined();
      }
      if (p.productType === 'EXTRA_ATTEMPT') {
        expect(getExtraAttemptLimit(p.extraAttemptLimitKey ?? '')).toBeDefined();
      }
      if (p.productType === 'GROWTH_FUND') {
        expect(getGrowthFundVariant(p.growthFundKey ?? '')).toBeDefined();
      }
    }
  });

  it('extra attempt limits ≤ 3 / day (anti-P2W)', () => {
    for (const limit of EXTRA_ATTEMPT_LIMITS) {
      expect(limit.maxPerDay).toBeGreaterThanOrEqual(1);
      expect(limit.maxPerDay).toBeLessThanOrEqual(3);
    }
  });

  it('sweepable / non-sweepable types are disjoint', () => {
    for (const t of SWEEPABLE_CONTENT_TYPES) {
      expect(NON_SWEEPABLE_CONTENT_TYPES as readonly string[]).not.toContain(t);
      expect(canSweepContentType(t)).toBe(true);
    }
    for (const t of NON_SWEEPABLE_CONTENT_TYPES) {
      expect(canSweepContentType(t)).toBe(false);
    }
  });

  it('growth fund milestones map to real REALM orders monotonic', () => {
    for (const variant of GROWTH_FUND_VARIANTS) {
      let prevOrder = -1;
      for (const m of variant.milestones) {
        const realm = REALMS.find((r) => r.key === m.realmKey);
        expect(realm).toBeDefined();
        expect(realm!.order).toBe(m.realmOrder);
        expect(m.realmOrder).toBeGreaterThan(prevOrder);
        prevOrder = m.realmOrder;
      }
    }
  });

  it('getGrowthFundMilestone returns defined entry', () => {
    expect(getGrowthFundMilestone('pham', 'luyenkhi')).toBeDefined();
    expect(getGrowthFundMilestone('pham', 'unknown')).toBeUndefined();
  });

  it('error codes catalog includes mandatory error codes from spec', () => {
    for (const code of [
      'INSUFFICIENT_CURRENCY',
      'PRODUCT_NOT_FOUND',
      'PRODUCT_DISABLED',
      'PURCHASE_LIMIT_REACHED',
      'ENTITLEMENT_EXPIRED',
      'DAILY_CLAIM_ALREADY_DONE',
      'CONTENT_NOT_CLEARED',
      'CAP_REACHED',
      'INVALID_CURRENCY',
      'TRANSACTION_CONFLICT',
    ]) {
      expect(MONETIZATION_ERROR_CODES as readonly string[]).toContain(code);
    }
  });

  it('validateMonetizationFoundationCatalog passes', () => {
    const result = validateMonetizationFoundationCatalog();
    expect(result.errors).toEqual([]);
    expect(result.ok).toBe(true);
  });

  it('getMonthlyCardVariant + getShopProduct + getEntitlementDef return defined entries', () => {
    expect(getMonthlyCardVariant('tieu_nguyet_tap')).toBeDefined();
    expect(getMonthlyCardVariant('unknown')).toBeUndefined();
    expect(getShopProduct('sweep_ticket_x5')).toBeDefined();
    expect(getEntitlementDef('SWEEP_TICKET_DAILY').nameVi.length).toBeGreaterThan(0);
  });

  it('every monthly card has a matching shop product (catalog cross-ref)', () => {
    for (const card of MONTHLY_CARD_VARIANTS) {
      const product = SHOP_PRODUCTS.find(
        (p) =>
          p.productType === 'MONTHLY_CARD' && p.monthlyCardKey === card.key,
      );
      expect(product).toBeDefined();
      expect(product!.priceCurrency).toBe(card.priceCurrency);
      expect(product!.priceAmount).toBe(card.priceAmount);
    }
  });
});

describe('monetization foundation — periodKey', () => {
  it('DAILY returns YYYY-MM-DD', () => {
    expect(periodKey(new Date('2026-05-13T10:00:00Z'), 'DAILY')).toBe('2026-05-13');
  });

  it('WEEKLY returns YYYY-Www', () => {
    expect(periodKey(new Date('2026-05-13T10:00:00Z'), 'WEEKLY')).toMatch(
      /^\d{4}-W\d{2}$/,
    );
  });

  it('MONTHLY returns YYYY-MM', () => {
    expect(periodKey(new Date('2026-05-13T10:00:00Z'), 'MONTHLY')).toBe('2026-05');
  });

  it('LIFETIME + NONE return constant lifetime bucket', () => {
    expect(periodKey(new Date('2026-05-13T10:00:00Z'), 'LIFETIME')).toBe('lifetime');
    expect(periodKey(new Date('2026-05-13T10:00:00Z'), 'NONE')).toBe('lifetime');
  });
});
