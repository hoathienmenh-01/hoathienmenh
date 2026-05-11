/**
 * Phase 16.4 — Market Trade Abuse catalog (shared, pure data + helpers).
 *
 * Bổ sung lớp **detection trade abuse** ngoài Phase 16.6 Market Price Band
 * (`market-price-band.ts`). Phase 16.6 chỉ reject listing post ngoài band.
 * Phase 16.4 quan sát thêm:
 *
 *   1. **Price deviation extreme** — listing nằm trong band nhưng lệch xa
 *      `referencePrice` (median/p50 7-day) → WARN/CRITICAL.
 *   2. **Repeated buyer/seller pair** — cùng cặp (seller, buyer) giao
 *      dịch nhiều lần trong cửa sổ 24h / 7d → funnel pattern.
 *   3. **Listing spam** — 1 seller post quá nhiều listing trong 1h.
 *   4. **Market volume spike** — Σ value (price × qty) cao bất thường
 *      cho 1 character trong 24h.
 *   5. **Unknown reference price** — item không có `ItemDef` hợp lệ
 *      hoặc reference price không tính được → flag INFO để admin
 *      quyết định manual; fail-soft KHÔNG crash.
 *
 * **Detection-first, guard-light**:
 *   - KHÔNG block giao dịch bình thường ngay cả khi WARN.
 *   - Trade flow hiện tại (Phase 16.6 band reject) vẫn áp dụng cho
 *     create listing — Phase 16.4 KHÔNG chồng lên đó.
 *   - Buy listing đã ACTIVE: KHÔNG block, chỉ tạo anomaly post-trade.
 *   - Admin xem panel + ack/resolve.
 *
 * Pure — không I/O, không Prisma, không env. Test 100% deterministic.
 */

import type { Quality } from './enums';
import { itemByKey } from './items';
import {
  DEFAULT_PRICE_BAND_BY_QUALITY,
  getMarketPriceBandForItem,
} from './market-price-band';

// ---------------------------------------------------------------------------
// Severity / status / type / source
// ---------------------------------------------------------------------------

export const MARKET_ABUSE_SEVERITIES = ['INFO', 'WARN', 'CRITICAL'] as const;
export type MarketAbuseSeverity = (typeof MARKET_ABUSE_SEVERITIES)[number];

export function isMarketAbuseSeverity(
  value: unknown,
): value is MarketAbuseSeverity {
  return (
    typeof value === 'string' &&
    (MARKET_ABUSE_SEVERITIES as readonly string[]).includes(value)
  );
}

export const MARKET_ABUSE_STATUSES = [
  'OPEN',
  'ACKNOWLEDGED',
  'RESOLVED',
] as const;
export type MarketAbuseStatus = (typeof MARKET_ABUSE_STATUSES)[number];

export function isMarketAbuseStatus(value: unknown): value is MarketAbuseStatus {
  return (
    typeof value === 'string' &&
    (MARKET_ABUSE_STATUSES as readonly string[]).includes(value)
  );
}

/**
 * 6 type anomaly Phase 16.4. KHÔNG trùng `EconomyAnomaly` (Phase 16.6
 * `MARKET_OUTLIER`) — Phase 16.6 đo deviation từ 7-day median ở mức
 * **per-listing single shot**; Phase 16.4 mở rộng sang **pattern**
 * (pair funnel, spam, volume) + price band classify chi tiết.
 */
export const MARKET_ABUSE_TYPES = [
  /** Listing/trade có `unitPrice` lệch xa floor band → có thể là dump farm/RMT. */
  'PRICE_EXTREME_LOW',
  /** Listing/trade có `unitPrice` lệch xa ceiling band → có thể là alt-account funnel. */
  'PRICE_EXTREME_HIGH',
  /** Cùng cặp (seller, buyer) giao dịch nhiều lần trong window (24h/7d). */
  'REPEATED_BUYER_SELLER_PAIR',
  /** 1 seller post ≥ N listing trong 1h. */
  'LISTING_SPAM',
  /** Σ value (price×qty) market của 1 character trong 24h vượt threshold. */
  'MARKET_VOLUME_SPIKE',
  /** Item không có `ItemDef` hợp lệ hoặc reference price không tính được. */
  'UNKNOWN_REFERENCE_PRICE',
] as const;
export type MarketAbuseType = (typeof MARKET_ABUSE_TYPES)[number];

export function isMarketAbuseType(value: unknown): value is MarketAbuseType {
  return (
    typeof value === 'string' &&
    (MARKET_ABUSE_TYPES as readonly string[]).includes(value)
  );
}

/**
 * Nguồn dữ liệu gốc — phân biệt anomaly tạo từ create-listing hook,
 * buy hook, hay scan-only batch.
 */
export const MARKET_ABUSE_SOURCES = [
  'LISTING_CREATE',
  'LISTING_BUY',
  'SCAN_BATCH',
  'OTHER',
] as const;
export type MarketAbuseSource = (typeof MARKET_ABUSE_SOURCES)[number];

export function isMarketAbuseSource(value: unknown): value is MarketAbuseSource {
  return (
    typeof value === 'string' &&
    (MARKET_ABUSE_SOURCES as readonly string[]).includes(value)
  );
}

/** Fail-soft coerce source lạ về `OTHER`. */
export function coerceMarketAbuseSource(value: unknown): MarketAbuseSource {
  return isMarketAbuseSource(value) ? value : 'OTHER';
}

// ---------------------------------------------------------------------------
// Threshold catalog
// ---------------------------------------------------------------------------

const ONE_HOUR_MS = 60 * 60 * 1000;
const ONE_DAY_MS = 24 * ONE_HOUR_MS;
const SEVEN_DAYS_MS = 7 * ONE_DAY_MS;

/**
 * Price deviation ratio thresholds.
 *
 * `deviationRatio = unitPrice / referencePrice` (float).
 *   - ratio ≥ 5 (`PRICE_EXTREME_HIGH` WARN), ≥ 20 → CRITICAL.
 *   - ratio ≤ 0.2 (`PRICE_EXTREME_LOW` WARN), ≤ 0.05 → CRITICAL.
 *
 * Lý do: Phase 16.6 band reject đã chặn listing post ngoài rarity band
 * tuyệt đối. Phase 16.4 chỉ flag listing **bên trong band** nhưng vẫn
 * lệch xa median rarity baseline → vẫn nghi vấn RMT/alt-account funnel.
 * Conservative initial — re-tune sau closed beta data.
 */
export const MARKET_PRICE_DEVIATION_WARN_HIGH = 5;
export const MARKET_PRICE_DEVIATION_CRITICAL_HIGH = 20;
export const MARKET_PRICE_DEVIATION_WARN_LOW = 0.2;
export const MARKET_PRICE_DEVIATION_CRITICAL_LOW = 0.05;

/**
 * Repeated pair thresholds. Cùng cặp (sellerId, buyerId) trade ≥ N
 * lần trong window → flag.
 *
 *   - 24h window: ≥ 3 trade = WARN, ≥ 10 = CRITICAL.
 *   - 7d window: ≥ 10 trade = WARN, ≥ 30 = CRITICAL.
 *
 * Conservative — friends trade 1-2 lần/ngày là bình thường; nhiều lần
 * liên tục là dấu hiệu alt funnel.
 */
export const MARKET_REPEATED_PAIR_24H_WARN = 3;
export const MARKET_REPEATED_PAIR_24H_CRITICAL = 10;
export const MARKET_REPEATED_PAIR_7D_WARN = 10;
export const MARKET_REPEATED_PAIR_7D_CRITICAL = 30;

/**
 * Listing spam thresholds. 1 seller post ≥ N listing ACTIVE/SOLD/
 * CANCELLED trong 1h.
 *
 *   - 1h: ≥ 30 listing = WARN, ≥ 80 = CRITICAL.
 *
 * Bot farm thường tạo loạt listing. Player legit khó vượt 30/h.
 */
export const MARKET_LISTING_SPAM_1H_WARN = 30;
export const MARKET_LISTING_SPAM_1H_CRITICAL = 80;

/**
 * Market volume spike. Σ value (pricePerUnit × qty) của trade (cả
 * seller hoặc buyer) trong 24h.
 *
 *   - 24h: Σ ≥ 500k LT = WARN, ≥ 5M LT = CRITICAL.
 *
 * Whale legit có thể trade 100-300k/ngày; 500k đã rất cao.
 */
export const MARKET_VOLUME_24H_WARN = 500_000n;
export const MARKET_VOLUME_24H_CRITICAL = 5_000_000n;

// ---------------------------------------------------------------------------
// Reference price estimate
// ---------------------------------------------------------------------------

/**
 * Reference price baseline cho 1 itemKey, lấy theo rarity band median
 * (geometric mean của `minPrice` / `maxPrice` từ `DEFAULT_PRICE_BAND_BY_QUALITY`).
 *
 * Trả `null` nếu item không tồn tại (catalog hardcode) → caller tạo
 * `UNKNOWN_REFERENCE_PRICE` anomaly INFO.
 *
 * Lưu ý: Phase 16.4 KHÔNG đọc DB live median. Service runtime có thể
 * override estimate bằng 7-day rolling median nếu có data; ở đây chỉ
 * cung cấp deterministic baseline cho test + fallback khi DB rỗng.
 */
export function estimateItemReferencePrice(itemKey: string): bigint | null {
  const item = itemByKey(itemKey);
  if (!item) return null;
  const quality: Quality = item.quality;
  const band = DEFAULT_PRICE_BAND_BY_QUALITY[quality];
  if (!band) return null;
  // Geometric mean để giữ scale (band rộng ~100x giữa min và max).
  // Approximate: sqrt(min*max) via Number conversion (band ≤ 5_000_000n
  // → fit float64). Quay về BigInt floor.
  const minF = Number(band.minPrice);
  const maxF = Number(band.maxPrice);
  if (minF <= 0 || maxF <= 0) return null;
  const geomean = Math.sqrt(minF * maxF);
  if (!Number.isFinite(geomean) || geomean <= 0) return null;
  return BigInt(Math.round(geomean));
}

// ---------------------------------------------------------------------------
// Classifiers
// ---------------------------------------------------------------------------

export interface ClassifyListingPriceBandResult {
  readonly type:
    | 'NORMAL'
    | 'PRICE_EXTREME_LOW'
    | 'PRICE_EXTREME_HIGH'
    | 'UNKNOWN_REFERENCE_PRICE';
  readonly severity: MarketAbuseSeverity;
  readonly referencePrice: bigint | null;
  readonly deviationRatio: number | null;
}

/**
 * Classify 1 listing/trade theo price deviation từ
 * `estimateItemReferencePrice` (hoặc reference override do caller
 * tính từ market median).
 *
 *   - referencePrice null → `UNKNOWN_REFERENCE_PRICE` (INFO).
 *   - unitPrice ≤ 0 → `UNKNOWN_REFERENCE_PRICE` (INFO).
 *   - ratio ≥ CRITICAL_HIGH → `PRICE_EXTREME_HIGH` (CRITICAL).
 *   - ratio ≥ WARN_HIGH → `PRICE_EXTREME_HIGH` (WARN).
 *   - ratio ≤ CRITICAL_LOW → `PRICE_EXTREME_LOW` (CRITICAL).
 *   - ratio ≤ WARN_LOW → `PRICE_EXTREME_LOW` (WARN).
 *   - else → `NORMAL` (INFO, KHÔNG tạo anomaly ở caller).
 *
 * Pure — KHÔNG đọc DB.
 */
export function classifyListingPriceBand(params: {
  itemKey: string;
  unitPrice: bigint;
  referencePriceOverride?: bigint | null;
}): ClassifyListingPriceBandResult {
  const { itemKey, unitPrice } = params;
  const reference =
    params.referencePriceOverride !== undefined
      ? params.referencePriceOverride
      : estimateItemReferencePrice(itemKey);

  if (reference === null || reference <= 0n) {
    return {
      type: 'UNKNOWN_REFERENCE_PRICE',
      severity: 'INFO',
      referencePrice: reference,
      deviationRatio: null,
    };
  }
  if (unitPrice <= 0n) {
    return {
      type: 'UNKNOWN_REFERENCE_PRICE',
      severity: 'INFO',
      referencePrice: reference,
      deviationRatio: null,
    };
  }

  const ratio = Number(unitPrice) / Number(reference);

  if (ratio >= MARKET_PRICE_DEVIATION_CRITICAL_HIGH) {
    return {
      type: 'PRICE_EXTREME_HIGH',
      severity: 'CRITICAL',
      referencePrice: reference,
      deviationRatio: ratio,
    };
  }
  if (ratio >= MARKET_PRICE_DEVIATION_WARN_HIGH) {
    return {
      type: 'PRICE_EXTREME_HIGH',
      severity: 'WARN',
      referencePrice: reference,
      deviationRatio: ratio,
    };
  }
  if (ratio <= MARKET_PRICE_DEVIATION_CRITICAL_LOW) {
    return {
      type: 'PRICE_EXTREME_LOW',
      severity: 'CRITICAL',
      referencePrice: reference,
      deviationRatio: ratio,
    };
  }
  if (ratio <= MARKET_PRICE_DEVIATION_WARN_LOW) {
    return {
      type: 'PRICE_EXTREME_LOW',
      severity: 'WARN',
      referencePrice: reference,
      deviationRatio: ratio,
    };
  }
  return {
    type: 'NORMAL',
    severity: 'INFO',
    referencePrice: reference,
    deviationRatio: ratio,
  };
}

export interface ClassifyMarketTradeAbuseCountResult {
  readonly hit: boolean;
  readonly severity: MarketAbuseSeverity;
  readonly threshold: { readonly warn: number; readonly critical: number };
}

/**
 * Generic count-based classifier dùng cho `REPEATED_BUYER_SELLER_PAIR`
 * / `LISTING_SPAM`. Trả `hit=true` nếu count ≥ warn.
 */
export function classifyMarketTradeAbuseCount(params: {
  count: number;
  warnThreshold: number;
  criticalThreshold: number;
}): ClassifyMarketTradeAbuseCountResult {
  const { count, warnThreshold, criticalThreshold } = params;
  const threshold = {
    warn: warnThreshold,
    critical: criticalThreshold,
  } as const;
  if (count >= criticalThreshold) {
    return { hit: true, severity: 'CRITICAL', threshold };
  }
  if (count >= warnThreshold) {
    return { hit: true, severity: 'WARN', threshold };
  }
  return { hit: false, severity: 'INFO', threshold };
}

export interface ClassifyMarketVolumeResult {
  readonly hit: boolean;
  readonly severity: MarketAbuseSeverity;
  readonly threshold: { readonly warn: bigint; readonly critical: bigint };
}

/**
 * Σ value (bigint) trong 24h vs WARN/CRITICAL threshold.
 */
export function classifyMarketTradeAbuseVolume(params: {
  totalValue: bigint;
}): ClassifyMarketVolumeResult {
  const { totalValue } = params;
  const threshold = {
    warn: MARKET_VOLUME_24H_WARN,
    critical: MARKET_VOLUME_24H_CRITICAL,
  } as const;
  if (totalValue >= MARKET_VOLUME_24H_CRITICAL) {
    return { hit: true, severity: 'CRITICAL', threshold };
  }
  if (totalValue >= MARKET_VOLUME_24H_WARN) {
    return { hit: true, severity: 'WARN', threshold };
  }
  return { hit: false, severity: 'INFO', threshold };
}

// ---------------------------------------------------------------------------
// Window key
// ---------------------------------------------------------------------------

export type MarketAbuseWindowSpan = '1h' | '24h' | '7d';

/**
 * Build `windowKey` deterministic cho idempotent UNIQUE
 * `(type, sellerCharacterId|buyerCharacterId|listingId, windowKey)`.
 *
 *   - `'1h'` → `'1h:2026-05-11T07'` (UTC hour).
 *   - `'24h'` → `'24h:2026-05-11'` (UTC day).
 *   - `'7d'` → `'7d:2026-W19'` (ISO week, UTC).
 *
 * Pure — input là `Date` từ caller (test inject).
 */
export function buildMarketAbuseWindowKey(
  span: MarketAbuseWindowSpan,
  now: Date,
): string {
  if (span === '1h') {
    const yyyy = now.getUTCFullYear();
    const mm = String(now.getUTCMonth() + 1).padStart(2, '0');
    const dd = String(now.getUTCDate()).padStart(2, '0');
    const hh = String(now.getUTCHours()).padStart(2, '0');
    return `1h:${yyyy}-${mm}-${dd}T${hh}`;
  }
  if (span === '24h') {
    const yyyy = now.getUTCFullYear();
    const mm = String(now.getUTCMonth() + 1).padStart(2, '0');
    const dd = String(now.getUTCDate()).padStart(2, '0');
    return `24h:${yyyy}-${mm}-${dd}`;
  }
  // ISO week: ISO-8601 week number (UTC).
  const week = isoWeekKeyUtc(now);
  return `7d:${week}`;
}

/** Internal ISO-8601 week key `YYYY-WNN` (UTC). */
function isoWeekKeyUtc(date: Date): string {
  // Algorithm: Thursday of the week determines the year.
  const d = new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
  );
  const dayNum = d.getUTCDay() === 0 ? 7 : d.getUTCDay();
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = Date.UTC(d.getUTCFullYear(), 0, 1);
  const weekNo = Math.ceil(((d.getTime() - yearStart) / 86_400_000 + 1) / 7);
  const yyyy = d.getUTCFullYear();
  const ww = String(weekNo).padStart(2, '0');
  return `${yyyy}-W${ww}`;
}

// ---------------------------------------------------------------------------
// Constants re-export for service layer
// ---------------------------------------------------------------------------

export const MARKET_ABUSE_WINDOWS = Object.freeze({
  ONE_HOUR_MS,
  ONE_DAY_MS,
  SEVEN_DAYS_MS,
});

export const MARKET_ABUSE_THRESHOLDS = Object.freeze({
  priceDeviation: {
    warnHigh: MARKET_PRICE_DEVIATION_WARN_HIGH,
    criticalHigh: MARKET_PRICE_DEVIATION_CRITICAL_HIGH,
    warnLow: MARKET_PRICE_DEVIATION_WARN_LOW,
    criticalLow: MARKET_PRICE_DEVIATION_CRITICAL_LOW,
  },
  repeatedPair: {
    warn24h: MARKET_REPEATED_PAIR_24H_WARN,
    critical24h: MARKET_REPEATED_PAIR_24H_CRITICAL,
    warn7d: MARKET_REPEATED_PAIR_7D_WARN,
    critical7d: MARKET_REPEATED_PAIR_7D_CRITICAL,
  },
  listingSpam: {
    warn1h: MARKET_LISTING_SPAM_1H_WARN,
    critical1h: MARKET_LISTING_SPAM_1H_CRITICAL,
  },
  volume: {
    warn24h: MARKET_VOLUME_24H_WARN,
    critical24h: MARKET_VOLUME_24H_CRITICAL,
  },
});

/**
 * Re-export `getMarketPriceBandForItem` để service runtime chỉ phải
 * import 1 module shared cho cả band check (Phase 16.6) + abuse
 * classify (Phase 16.4).
 */
export { getMarketPriceBandForItem };
