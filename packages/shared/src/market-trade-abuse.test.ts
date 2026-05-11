import { describe, expect, it } from 'vitest';
import {
  buildMarketAbuseWindowKey,
  classifyListingPriceBand,
  classifyMarketTradeAbuseCount,
  classifyMarketTradeAbuseVolume,
  coerceMarketAbuseSource,
  estimateItemReferencePrice,
  isMarketAbuseSeverity,
  isMarketAbuseSource,
  isMarketAbuseStatus,
  isMarketAbuseType,
  MARKET_ABUSE_SEVERITIES,
  MARKET_ABUSE_SOURCES,
  MARKET_ABUSE_STATUSES,
  MARKET_ABUSE_THRESHOLDS,
  MARKET_ABUSE_TYPES,
  MARKET_LISTING_SPAM_1H_CRITICAL,
  MARKET_LISTING_SPAM_1H_WARN,
  MARKET_PRICE_DEVIATION_CRITICAL_HIGH,
  MARKET_PRICE_DEVIATION_CRITICAL_LOW,
  MARKET_PRICE_DEVIATION_WARN_HIGH,
  MARKET_PRICE_DEVIATION_WARN_LOW,
  MARKET_REPEATED_PAIR_24H_CRITICAL,
  MARKET_REPEATED_PAIR_24H_WARN,
  MARKET_VOLUME_24H_CRITICAL,
  MARKET_VOLUME_24H_WARN,
} from './market-trade-abuse';

describe('market-trade-abuse — catalog', () => {
  it('severity/status/type/source guards work', () => {
    expect(MARKET_ABUSE_SEVERITIES).toEqual(['INFO', 'WARN', 'CRITICAL']);
    expect(MARKET_ABUSE_STATUSES).toEqual(['OPEN', 'ACKNOWLEDGED', 'RESOLVED']);
    expect(MARKET_ABUSE_TYPES).toContain('PRICE_EXTREME_LOW');
    expect(MARKET_ABUSE_TYPES).toContain('PRICE_EXTREME_HIGH');
    expect(MARKET_ABUSE_TYPES).toContain('REPEATED_BUYER_SELLER_PAIR');
    expect(MARKET_ABUSE_TYPES).toContain('LISTING_SPAM');
    expect(MARKET_ABUSE_TYPES).toContain('MARKET_VOLUME_SPIKE');
    expect(MARKET_ABUSE_TYPES).toContain('UNKNOWN_REFERENCE_PRICE');
    expect(MARKET_ABUSE_SOURCES).toContain('LISTING_CREATE');
    expect(MARKET_ABUSE_SOURCES).toContain('LISTING_BUY');
    expect(MARKET_ABUSE_SOURCES).toContain('SCAN_BATCH');
    expect(MARKET_ABUSE_SOURCES).toContain('OTHER');

    expect(isMarketAbuseSeverity('WARN')).toBe(true);
    expect(isMarketAbuseSeverity('warn')).toBe(false);
    expect(isMarketAbuseStatus('OPEN')).toBe(true);
    expect(isMarketAbuseStatus('PENDING')).toBe(false);
    expect(isMarketAbuseType('LISTING_SPAM')).toBe(true);
    expect(isMarketAbuseType('UNKNOWN')).toBe(false);
    expect(isMarketAbuseSource('LISTING_CREATE')).toBe(true);
    expect(isMarketAbuseSource('???')).toBe(false);
  });

  it('coerceMarketAbuseSource fail-soft', () => {
    expect(coerceMarketAbuseSource('LISTING_CREATE')).toBe('LISTING_CREATE');
    expect(coerceMarketAbuseSource('???')).toBe('OTHER');
    expect(coerceMarketAbuseSource(undefined)).toBe('OTHER');
    expect(coerceMarketAbuseSource(null)).toBe('OTHER');
  });

  it('threshold catalog has stable shape', () => {
    expect(MARKET_ABUSE_THRESHOLDS.priceDeviation.warnHigh).toBe(
      MARKET_PRICE_DEVIATION_WARN_HIGH,
    );
    expect(MARKET_ABUSE_THRESHOLDS.priceDeviation.criticalHigh).toBe(
      MARKET_PRICE_DEVIATION_CRITICAL_HIGH,
    );
    expect(MARKET_ABUSE_THRESHOLDS.priceDeviation.warnLow).toBe(
      MARKET_PRICE_DEVIATION_WARN_LOW,
    );
    expect(MARKET_ABUSE_THRESHOLDS.priceDeviation.criticalLow).toBe(
      MARKET_PRICE_DEVIATION_CRITICAL_LOW,
    );
    expect(MARKET_ABUSE_THRESHOLDS.repeatedPair.warn24h).toBe(
      MARKET_REPEATED_PAIR_24H_WARN,
    );
    expect(MARKET_ABUSE_THRESHOLDS.repeatedPair.critical24h).toBe(
      MARKET_REPEATED_PAIR_24H_CRITICAL,
    );
    expect(MARKET_ABUSE_THRESHOLDS.listingSpam.warn1h).toBe(
      MARKET_LISTING_SPAM_1H_WARN,
    );
    expect(MARKET_ABUSE_THRESHOLDS.listingSpam.critical1h).toBe(
      MARKET_LISTING_SPAM_1H_CRITICAL,
    );
    expect(MARKET_ABUSE_THRESHOLDS.volume.warn24h).toBe(MARKET_VOLUME_24H_WARN);
    expect(MARKET_ABUSE_THRESHOLDS.volume.critical24h).toBe(
      MARKET_VOLUME_24H_CRITICAL,
    );
    expect(MARKET_VOLUME_24H_CRITICAL).toBeGreaterThan(MARKET_VOLUME_24H_WARN);
  });
});

describe('estimateItemReferencePrice', () => {
  it('returns null for unknown item (fail-soft)', () => {
    expect(estimateItemReferencePrice('nonexistent_item_xyz')).toBeNull();
  });

  it('returns geometric mean of band for known item', () => {
    // tien_huyen_kiem is a TIEN-rarity item; band [1_000, 500_000].
    // geomean ≈ sqrt(1_000 * 500_000) = sqrt(500_000_000) ≈ 22360.
    const ref = estimateItemReferencePrice('tien_huyen_kiem');
    expect(ref).not.toBeNull();
    if (ref !== null) {
      expect(ref).toBeGreaterThan(20_000n);
      expect(ref).toBeLessThan(25_000n);
    }
  });
});

describe('classifyListingPriceBand', () => {
  it('UNKNOWN_REFERENCE_PRICE for unknown item', () => {
    const r = classifyListingPriceBand({
      itemKey: 'nonexistent_item_xyz',
      unitPrice: 100n,
    });
    expect(r.type).toBe('UNKNOWN_REFERENCE_PRICE');
    expect(r.severity).toBe('INFO');
    expect(r.referencePrice).toBeNull();
    expect(r.deviationRatio).toBeNull();
  });

  it('UNKNOWN_REFERENCE_PRICE when unitPrice <= 0', () => {
    const r = classifyListingPriceBand({
      itemKey: 'tien_huyen_kiem',
      unitPrice: 0n,
    });
    expect(r.type).toBe('UNKNOWN_REFERENCE_PRICE');
    expect(r.severity).toBe('INFO');
  });

  it('NORMAL near reference price', () => {
    // tien_huyen_kiem ref ~ 22360 LT. unitPrice = 22000 LT.
    const r = classifyListingPriceBand({
      itemKey: 'tien_huyen_kiem',
      unitPrice: 22_000n,
    });
    expect(r.type).toBe('NORMAL');
    expect(r.severity).toBe('INFO');
    expect(r.referencePrice).not.toBeNull();
    expect(r.deviationRatio).toBeGreaterThan(0.9);
    expect(r.deviationRatio).toBeLessThan(1.1);
  });

  it('PRICE_EXTREME_HIGH WARN for ratio in [warnHigh, criticalHigh)', () => {
    // ref ~ 22360 LT. unitPrice = 200_000 LT → ratio ~ 8.94.
    const r = classifyListingPriceBand({
      itemKey: 'tien_huyen_kiem',
      unitPrice: 200_000n,
    });
    expect(r.type).toBe('PRICE_EXTREME_HIGH');
    expect(r.severity).toBe('WARN');
    expect(r.deviationRatio).toBeGreaterThanOrEqual(
      MARKET_PRICE_DEVIATION_WARN_HIGH,
    );
    expect(r.deviationRatio).toBeLessThan(MARKET_PRICE_DEVIATION_CRITICAL_HIGH);
  });

  it('PRICE_EXTREME_HIGH CRITICAL for ratio >= criticalHigh', () => {
    // ref ~ 22360 LT. unitPrice = 500_000 LT → ratio ~ 22.4.
    const r = classifyListingPriceBand({
      itemKey: 'tien_huyen_kiem',
      unitPrice: 500_000n,
    });
    expect(r.type).toBe('PRICE_EXTREME_HIGH');
    expect(r.severity).toBe('CRITICAL');
    expect(r.deviationRatio).toBeGreaterThanOrEqual(
      MARKET_PRICE_DEVIATION_CRITICAL_HIGH,
    );
  });

  it('PRICE_EXTREME_LOW WARN for ratio in (criticalLow, warnLow]', () => {
    // ref ~ 22360 LT. unitPrice = 3_000 LT → ratio ~ 0.134.
    const r = classifyListingPriceBand({
      itemKey: 'tien_huyen_kiem',
      unitPrice: 3_000n,
    });
    expect(r.type).toBe('PRICE_EXTREME_LOW');
    expect(r.severity).toBe('WARN');
    expect(r.deviationRatio).toBeLessThanOrEqual(
      MARKET_PRICE_DEVIATION_WARN_LOW,
    );
    expect(r.deviationRatio).toBeGreaterThan(
      MARKET_PRICE_DEVIATION_CRITICAL_LOW,
    );
  });

  it('PRICE_EXTREME_LOW CRITICAL for ratio <= criticalLow', () => {
    // ref ~ 22360 LT. unitPrice = 1_000 LT → ratio ~ 0.0447.
    const r = classifyListingPriceBand({
      itemKey: 'tien_huyen_kiem',
      unitPrice: 1_000n,
    });
    expect(r.type).toBe('PRICE_EXTREME_LOW');
    expect(r.severity).toBe('CRITICAL');
    expect(r.deviationRatio).toBeLessThanOrEqual(
      MARKET_PRICE_DEVIATION_CRITICAL_LOW,
    );
  });

  it('honors referencePriceOverride', () => {
    const r = classifyListingPriceBand({
      itemKey: 'tien_huyen_kiem',
      unitPrice: 1_000n,
      referencePriceOverride: 1_000n,
    });
    expect(r.type).toBe('NORMAL');
    expect(r.referencePrice).toBe(1_000n);
    expect(r.deviationRatio).toBeCloseTo(1, 5);
  });

  it('null referencePriceOverride yields UNKNOWN_REFERENCE_PRICE', () => {
    const r = classifyListingPriceBand({
      itemKey: 'tien_huyen_kiem',
      unitPrice: 22_000n,
      referencePriceOverride: null,
    });
    expect(r.type).toBe('UNKNOWN_REFERENCE_PRICE');
    expect(r.severity).toBe('INFO');
  });
});

describe('classifyMarketTradeAbuseCount', () => {
  it('below warn threshold → hit=false', () => {
    const r = classifyMarketTradeAbuseCount({
      count: 2,
      warnThreshold: MARKET_REPEATED_PAIR_24H_WARN,
      criticalThreshold: MARKET_REPEATED_PAIR_24H_CRITICAL,
    });
    expect(r.hit).toBe(false);
    expect(r.severity).toBe('INFO');
  });

  it('count >= warn but < critical → WARN', () => {
    const r = classifyMarketTradeAbuseCount({
      count: MARKET_REPEATED_PAIR_24H_WARN,
      warnThreshold: MARKET_REPEATED_PAIR_24H_WARN,
      criticalThreshold: MARKET_REPEATED_PAIR_24H_CRITICAL,
    });
    expect(r.hit).toBe(true);
    expect(r.severity).toBe('WARN');
  });

  it('count >= critical → CRITICAL', () => {
    const r = classifyMarketTradeAbuseCount({
      count: MARKET_REPEATED_PAIR_24H_CRITICAL + 5,
      warnThreshold: MARKET_REPEATED_PAIR_24H_WARN,
      criticalThreshold: MARKET_REPEATED_PAIR_24H_CRITICAL,
    });
    expect(r.hit).toBe(true);
    expect(r.severity).toBe('CRITICAL');
  });

  it('threshold relation honored for listing spam', () => {
    const lo = classifyMarketTradeAbuseCount({
      count: MARKET_LISTING_SPAM_1H_WARN - 1,
      warnThreshold: MARKET_LISTING_SPAM_1H_WARN,
      criticalThreshold: MARKET_LISTING_SPAM_1H_CRITICAL,
    });
    expect(lo.hit).toBe(false);

    const med = classifyMarketTradeAbuseCount({
      count: MARKET_LISTING_SPAM_1H_WARN,
      warnThreshold: MARKET_LISTING_SPAM_1H_WARN,
      criticalThreshold: MARKET_LISTING_SPAM_1H_CRITICAL,
    });
    expect(med.severity).toBe('WARN');

    const hi = classifyMarketTradeAbuseCount({
      count: MARKET_LISTING_SPAM_1H_CRITICAL,
      warnThreshold: MARKET_LISTING_SPAM_1H_WARN,
      criticalThreshold: MARKET_LISTING_SPAM_1H_CRITICAL,
    });
    expect(hi.severity).toBe('CRITICAL');
  });
});

describe('classifyMarketTradeAbuseVolume', () => {
  it('below warn → hit=false', () => {
    const r = classifyMarketTradeAbuseVolume({ totalValue: 100_000n });
    expect(r.hit).toBe(false);
    expect(r.severity).toBe('INFO');
  });

  it('between warn and critical → WARN', () => {
    const r = classifyMarketTradeAbuseVolume({
      totalValue: MARKET_VOLUME_24H_WARN + 1n,
    });
    expect(r.hit).toBe(true);
    expect(r.severity).toBe('WARN');
  });

  it('above critical → CRITICAL', () => {
    const r = classifyMarketTradeAbuseVolume({
      totalValue: MARKET_VOLUME_24H_CRITICAL + 1n,
    });
    expect(r.hit).toBe(true);
    expect(r.severity).toBe('CRITICAL');
  });
});

describe('buildMarketAbuseWindowKey', () => {
  const fixed = new Date('2026-05-11T07:23:45Z');

  it('1h key format', () => {
    expect(buildMarketAbuseWindowKey('1h', fixed)).toBe('1h:2026-05-11T07');
  });

  it('24h key format', () => {
    expect(buildMarketAbuseWindowKey('24h', fixed)).toBe('24h:2026-05-11');
  });

  it('7d key uses ISO week', () => {
    const key = buildMarketAbuseWindowKey('7d', fixed);
    expect(key).toMatch(/^7d:\d{4}-W\d{2}$/);
    // 2026-05-11 falls in ISO week 20 of 2026.
    expect(key).toBe('7d:2026-W20');
  });

  it('deterministic — same input yields same key', () => {
    const k1 = buildMarketAbuseWindowKey('24h', fixed);
    const k2 = buildMarketAbuseWindowKey('24h', new Date(fixed.getTime()));
    expect(k1).toBe(k2);
  });

  it('different hours yield different 1h keys', () => {
    const t1 = new Date('2026-05-11T07:59:59Z');
    const t2 = new Date('2026-05-11T08:00:00Z');
    expect(buildMarketAbuseWindowKey('1h', t1)).not.toBe(
      buildMarketAbuseWindowKey('1h', t2),
    );
  });
});
