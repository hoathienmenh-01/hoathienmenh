/**
 * Phase 30.0 — Market V2 / Auction House / Sect Treasury / Player Economy.
 *
 * Mở rộng layer chợ V1 (`Listing` model + `MarketService` Phase 4 + Phase 16.4
 * `MarketTradeAbuseService` + Phase 16.6 `MarketPriceBand`) thêm:
 *   - **Auction**: phiên đấu giá có start/min-step/buyout/end-time.
 *   - **Claim Box**: hộp nhận item/tiền sau giao dịch (idempotent).
 *   - **Personal Stall**: gian hàng cá nhân + slot limit + pinning.
 *   - **Sect Treasury**: kho tông môn + log nhập/xuất.
 *   - **Sect Internal Auction**: đấu giá nội bộ tông môn.
 *   - **Price History snapshot**: avg/min/max + volume cho UI/admin.
 *   - **Anti-abuse**: 10 anomaly type (rapid resale, same-pair repeat,
 *     alt account suspect, large value transfer, market manipulation,
 *     self-bid suspect, duplicate claim attempt, excessive cancel/relist,
 *     price too low/high).
 *
 * **Anti-P2W invariants (spec PHẦN 1 — 5 design rules)**:
 *   1. KHÔNG giao dịch Tiên Ngọc nạp trực tiếp giữa người chơi.
 *   2. KHÔNG bán item bind/expired/equipped/admin-locked.
 *   3. Mọi giao dịch atomic + ledger ledger-backed.
 *   4. Phí thị trường BURN/SINK Linh Thạch — chống lạm phát.
 *   5. Item endgame có policy chặn list infinity.
 *
 * Pure — không I/O, không Prisma, không env. Test 100% deterministic.
 */

import { ADMIN_FORBIDDEN_GRANT_ITEMS } from './admin-control-center';
import { FORBIDDEN_REWARD_ITEM_KEYS } from './monetization-systems';

// ---------------------------------------------------------------------------
// 1. Enums — listing/auction/currency/tradability
// ---------------------------------------------------------------------------

export const MARKET_LISTING_STATUSES = [
  'ACTIVE',
  'SOLD',
  'CANCELLED',
  'EXPIRED',
  'LOCKED',
  'FAILED',
] as const;
export type MarketListingStatus = (typeof MARKET_LISTING_STATUSES)[number];

export function isMarketListingStatus(s: unknown): s is MarketListingStatus {
  return (
    typeof s === 'string' &&
    (MARKET_LISTING_STATUSES as readonly string[]).includes(s)
  );
}

export const MARKET_LISTING_TYPES = [
  'FIXED_PRICE',
  'AUCTION',
  'PERSONAL_STALL',
  'SECT_INTERNAL_AUCTION',
] as const;
export type MarketListingType = (typeof MARKET_LISTING_TYPES)[number];

export function isMarketListingType(s: unknown): s is MarketListingType {
  return (
    typeof s === 'string' &&
    (MARKET_LISTING_TYPES as readonly string[]).includes(s)
  );
}

/**
 * Currency cho giao dịch market. Spec PHẦN 1 §1: KHÔNG cho giao dịch
 * Tiên Ngọc nạp trực tiếp giữa player (`TIEN_NGOC_PAID` không tồn tại
 * trong enum này — invariant chống P2W). Tiên Ngọc khóa (premium locked)
 * có thể được phép nếu config cho phép.
 */
export const MARKET_CURRENCIES = [
  'LINH_THACH',
  'SECT_CONTRIBUTION',
  'EVENT_TOKEN',
  'TIEN_NGOC_KHOA',
] as const;
export type MarketCurrency = (typeof MARKET_CURRENCIES)[number];

export function isMarketCurrency(s: unknown): s is MarketCurrency {
  return (
    typeof s === 'string' &&
    (MARKET_CURRENCIES as readonly string[]).includes(s)
  );
}

export const ITEM_TRADABILITIES = [
  'TRADEABLE',
  'BIND_ON_PICKUP',
  'BIND_ON_EQUIP',
  'ACCOUNT_BOUND',
  'EVENT_BOUND',
  'EXPIRED',
  'ADMIN_LOCKED',
] as const;
export type ItemTradability = (typeof ITEM_TRADABILITIES)[number];

export function isItemTradability(s: unknown): s is ItemTradability {
  return (
    typeof s === 'string' &&
    (ITEM_TRADABILITIES as readonly string[]).includes(s)
  );
}

export const MARKET_AUCTION_STATUSES = [
  'SCHEDULED',
  'ACTIVE',
  'FINALIZED',
  'CANCELLED',
  'LOCKED',
  'FAILED',
] as const;
export type MarketAuctionStatus = (typeof MARKET_AUCTION_STATUSES)[number];

export const MARKET_BID_STATUSES = [
  'ACTIVE',
  'OUTBID',
  'WON',
  'REFUNDED',
  'CANCELLED',
] as const;
export type MarketBidStatus = (typeof MARKET_BID_STATUSES)[number];

export const MARKET_CLAIM_BOX_SOURCES = [
  'LISTING_SOLD',
  'LISTING_EXPIRED',
  'AUCTION_WON',
  'AUCTION_REFUND',
  'AUCTION_SELLER_PAYOUT',
  'ADMIN_REFUND',
  'ADMIN_GRANT',
  'SECT_AUCTION_WON',
  'SECT_AUCTION_REFUND',
] as const;
export type MarketClaimBoxSource = (typeof MARKET_CLAIM_BOX_SOURCES)[number];

export const MARKET_CLAIM_BOX_STATUSES = [
  'PENDING',
  'CLAIMED',
  'EXPIRED',
  'CANCELLED',
] as const;
export type MarketClaimBoxStatus = (typeof MARKET_CLAIM_BOX_STATUSES)[number];

// ---------------------------------------------------------------------------
// 2. Item trade policy
// ---------------------------------------------------------------------------

/**
 * Per-item override. Khi không có entry → fallback theo
 * `ItemDef.marketTradeable` + `bindOnPickup` mặc định của catalog.
 *
 * Mục đích: cho phép admin tạm khóa 1 itemKey trên chợ mà không sửa
 * catalog code (e.g. bug exploit drop tạm thời).
 */
export interface MarketItemPolicy {
  itemKey: string;
  tradability: ItemTradability;
  minPrice?: number;
  maxPrice?: number;
  /** Số listing tối đa / character / itemKey / ngày. */
  maxListingsPerDay?: number;
  /** Số lượng tối đa / listing (chống listing siêu lớn rửa tiền). */
  maxQtyPerListing?: number;
  /** Phí thuế override (decimal 0..1). Nếu undefined → dùng MarketFeeConfig. */
  taxRatePctOverride?: number;
  listingFeeFlatOverride?: number;
  reason?: string;
  updatedBy?: string;
  updatedAt?: string;
}

/**
 * Validate trade policy theo input. Trả về danh sách lỗi (rỗng = ok).
 * KHÔNG throw — caller quyết định.
 */
export function validateMarketItemPolicy(p: MarketItemPolicy): string[] {
  const errors: string[] = [];
  if (!p.itemKey || p.itemKey.trim() === '') {
    errors.push('MARKET_POLICY_ITEM_KEY_REQUIRED');
  }
  if (!isItemTradability(p.tradability)) {
    errors.push('MARKET_POLICY_INVALID_TRADABILITY');
  }
  if (p.minPrice !== undefined && p.minPrice < 0) {
    errors.push('MARKET_POLICY_MIN_PRICE_NEGATIVE');
  }
  if (p.maxPrice !== undefined && p.maxPrice < 0) {
    errors.push('MARKET_POLICY_MAX_PRICE_NEGATIVE');
  }
  if (
    p.minPrice !== undefined &&
    p.maxPrice !== undefined &&
    p.minPrice > p.maxPrice
  ) {
    errors.push('MARKET_POLICY_MIN_GT_MAX');
  }
  if (p.maxListingsPerDay !== undefined && p.maxListingsPerDay < 1) {
    errors.push('MARKET_POLICY_MAX_LISTINGS_LT_1');
  }
  if (p.maxQtyPerListing !== undefined && p.maxQtyPerListing < 1) {
    errors.push('MARKET_POLICY_MAX_QTY_LT_1');
  }
  if (
    p.taxRatePctOverride !== undefined &&
    (p.taxRatePctOverride < 0 || p.taxRatePctOverride > 0.5)
  ) {
    errors.push('MARKET_POLICY_TAX_OUT_OF_RANGE');
  }
  return errors;
}

/**
 * Per-listing validation (input từ player). Trả về error code đầu
 * tiên hoặc null nếu OK.
 */
export interface ListingPolicyInput {
  sellerCharacterId: string;
  itemKey: string;
  itemTradability: ItemTradability;
  quantity: number;
  unitPrice: number;
  currency: MarketCurrency;
  /** Item đang trang bị? */
  isEquipped: boolean;
  /** Item đang dùng trong recipe/auction khác? */
  isLockedExternal: boolean;
  /** Item đã hết hạn? */
  isExpired: boolean;
  /** Policy override per-item (nếu có). */
  itemPolicy?: MarketItemPolicy;
  /** Số listing đã có hôm nay của character cho cùng itemKey. */
  todayListingCountForItem?: number;
}

export function validateListingPolicy(
  input: ListingPolicyInput,
): { ok: true } | { ok: false; code: string } {
  // KHÔNG cho giao dịch Tiên Ngọc nạp.
  if ((input.currency as string) === 'TIEN_NGOC') {
    return { ok: false, code: 'MARKET_PAID_PREMIUM_NOT_TRADEABLE' };
  }
  if (!isMarketCurrency(input.currency)) {
    return { ok: false, code: 'MARKET_INVALID_CURRENCY' };
  }
  // Forbidden endgame items KHÔNG bán được.
  const forbidden = new Set<string>([
    ...FORBIDDEN_REWARD_ITEM_KEYS,
    ...ADMIN_FORBIDDEN_GRANT_ITEMS,
  ]);
  if (forbidden.has(input.itemKey)) {
    return { ok: false, code: 'MARKET_ITEM_FORBIDDEN_ENDGAME' };
  }
  if (input.itemPolicy?.tradability === 'ADMIN_LOCKED') {
    return { ok: false, code: 'MARKET_ITEM_ADMIN_LOCKED' };
  }
  // Item bind / expired / equipped: hard block.
  if (input.isExpired) return { ok: false, code: 'MARKET_ITEM_EXPIRED' };
  if (input.isEquipped) return { ok: false, code: 'MARKET_ITEM_EQUIPPED' };
  if (input.isLockedExternal) {
    return { ok: false, code: 'MARKET_ITEM_LOCKED_EXTERNAL' };
  }
  if (
    input.itemTradability === 'BIND_ON_PICKUP' ||
    input.itemTradability === 'ACCOUNT_BOUND'
  ) {
    return { ok: false, code: 'MARKET_ITEM_BIND' };
  }
  if (input.itemTradability === 'EVENT_BOUND') {
    // Event bound chỉ bán được nếu policy explicit cho phép qua
    // taxRatePctOverride/maxQtyPerListing đã set.
    if (!input.itemPolicy || input.itemPolicy.tradability !== 'TRADEABLE') {
      return { ok: false, code: 'MARKET_ITEM_EVENT_BOUND_NOT_ALLOWED' };
    }
  }
  if (input.itemTradability === 'EXPIRED') {
    return { ok: false, code: 'MARKET_ITEM_EXPIRED' };
  }
  if (input.itemTradability === 'ADMIN_LOCKED') {
    return { ok: false, code: 'MARKET_ITEM_ADMIN_LOCKED' };
  }
  if (input.quantity < 1) {
    return { ok: false, code: 'MARKET_QTY_LT_1' };
  }
  if (input.unitPrice < 1) {
    return { ok: false, code: 'MARKET_UNIT_PRICE_LT_1' };
  }
  const policy = input.itemPolicy;
  if (policy) {
    if (policy.minPrice !== undefined && input.unitPrice < policy.minPrice) {
      return { ok: false, code: 'MARKET_PRICE_BELOW_MIN' };
    }
    if (policy.maxPrice !== undefined && input.unitPrice > policy.maxPrice) {
      return { ok: false, code: 'MARKET_PRICE_ABOVE_MAX' };
    }
    if (policy.maxQtyPerListing !== undefined &&
        input.quantity > policy.maxQtyPerListing) {
      return { ok: false, code: 'MARKET_QTY_EXCEEDS_POLICY' };
    }
    if (
      policy.maxListingsPerDay !== undefined &&
      input.todayListingCountForItem !== undefined &&
      input.todayListingCountForItem >= policy.maxListingsPerDay
    ) {
      return { ok: false, code: 'MARKET_LISTING_LIMIT_REACHED' };
    }
  }
  return { ok: true };
}

// ---------------------------------------------------------------------------
// 3. Market fee config — sink Linh Thạch
// ---------------------------------------------------------------------------

export interface MarketFeeConfig {
  /** Phí flat đăng listing (Linh Thạch). */
  listingFeeFlat: number;
  /** Phí phần trăm theo unitPrice (decimal 0..1). */
  listingFeePercent: number;
  /** Thuế sau khi bán thành công (decimal 0..1). Burn/sink. */
  transactionTaxPercent: number;
  /** Phí tạo phiên đấu giá. */
  auctionCreateFee: number;
  /** Thuế khi auction chốt thành công (decimal 0..1). */
  auctionSuccessTaxPercent: number;
  /** Floor fee tuyệt đối (Linh Thạch). */
  minFee: number;
  /** Trần fee — chống config sai. */
  maxFee: number;
  /** Multiplier theo tier item (tier × n × baseFee). */
  tierMultiplier: number;
  /** Multiplier theo rarity. */
  rarityMultiplier: number;
}

export const DEFAULT_MARKET_FEE_CONFIG: MarketFeeConfig = {
  listingFeeFlat: 100,
  listingFeePercent: 0.01,
  transactionTaxPercent: 0.05,
  auctionCreateFee: 500,
  auctionSuccessTaxPercent: 0.05,
  minFee: 1,
  maxFee: 10_000_000,
  tierMultiplier: 1.2,
  rarityMultiplier: 1.1,
};

export function validateMarketFeeConfig(cfg: MarketFeeConfig): string[] {
  const errors: string[] = [];
  if (cfg.listingFeeFlat < 0) errors.push('MARKET_FEE_LISTING_FLAT_NEGATIVE');
  if (cfg.listingFeePercent < 0 || cfg.listingFeePercent > 0.5) {
    errors.push('MARKET_FEE_LISTING_PCT_OUT_OF_RANGE');
  }
  if (cfg.transactionTaxPercent < 0 || cfg.transactionTaxPercent > 0.5) {
    errors.push('MARKET_FEE_TAX_OUT_OF_RANGE');
  }
  if (cfg.auctionCreateFee < 0) errors.push('MARKET_FEE_AUCTION_CREATE_NEGATIVE');
  if (
    cfg.auctionSuccessTaxPercent < 0 ||
    cfg.auctionSuccessTaxPercent > 0.5
  ) {
    errors.push('MARKET_FEE_AUCTION_TAX_OUT_OF_RANGE');
  }
  if (cfg.minFee < 0) errors.push('MARKET_FEE_MIN_NEGATIVE');
  if (cfg.maxFee < cfg.minFee) errors.push('MARKET_FEE_MAX_LT_MIN');
  if (cfg.tierMultiplier < 1) errors.push('MARKET_FEE_TIER_MULT_LT_1');
  if (cfg.rarityMultiplier < 1) errors.push('MARKET_FEE_RARITY_MULT_LT_1');
  return errors;
}

/**
 * Tính listing fee + transaction tax cho 1 listing.
 *
 * `tierMultiplier^(tier-1)` áp lên fee để tier cao đóng phí cao hơn
 * (chống dump item tier cao giá rẻ). `rarityMultiplier^(rarityIdx)`
 * áp lên fee theo rarity.
 *
 * Cuối cùng clamp về `[minFee, maxFee]`.
 */
export function computeMarketFee(
  cfg: MarketFeeConfig,
  unitPrice: number,
  quantity: number,
  opts?: { tier?: number; rarityIdx?: number; isAuction?: boolean },
): { listingFee: number; transactionTaxBase: number } {
  const tier = Math.max(1, opts?.tier ?? 1);
  const rarityIdx = Math.max(0, opts?.rarityIdx ?? 0);
  const totalPrice = unitPrice * quantity;
  const tierMul = Math.pow(cfg.tierMultiplier, tier - 1);
  const rarityMul = Math.pow(cfg.rarityMultiplier, rarityIdx);
  const baseListingFee =
    cfg.listingFeeFlat + Math.floor(totalPrice * cfg.listingFeePercent);
  const baseAuctionFee = opts?.isAuction ? cfg.auctionCreateFee : 0;
  const listingFee = clampNumber(
    Math.floor((baseListingFee + baseAuctionFee) * tierMul * rarityMul),
    cfg.minFee,
    cfg.maxFee,
  );
  const taxPct = opts?.isAuction
    ? cfg.auctionSuccessTaxPercent
    : cfg.transactionTaxPercent;
  const transactionTaxBase = Math.floor(totalPrice * taxPct);
  return { listingFee, transactionTaxBase };
}

function clampNumber(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

// ---------------------------------------------------------------------------
// 4. Auction
// ---------------------------------------------------------------------------

export interface AuctionInput {
  sellerCharacterId: string;
  itemKey: string;
  quantity: number;
  startPrice: number;
  buyoutPrice?: number;
  minBidStep: number;
  currency: MarketCurrency;
  durationMinutes: number;
}

export interface BidInput {
  auctionId: string;
  bidderCharacterId: string;
  bidAmount: number;
  currency: MarketCurrency;
  currentBid: number;
  currentBidderId?: string;
  minBidStep: number;
  sellerCharacterId: string;
  buyoutPrice?: number;
  auctionStatus: MarketAuctionStatus;
  endsAt: string;
  nowIso: string;
}

export const MIN_AUCTION_DURATION_MINUTES = 30;
export const MAX_AUCTION_DURATION_MINUTES = 60 * 24 * 7;

export function validateAuctionInput(
  input: AuctionInput,
): { ok: true } | { ok: false; code: string } {
  if (input.quantity < 1) return { ok: false, code: 'MARKET_QTY_LT_1' };
  if (input.startPrice < 1) {
    return { ok: false, code: 'MARKET_AUCTION_START_PRICE_LT_1' };
  }
  if (input.buyoutPrice !== undefined && input.buyoutPrice <= input.startPrice) {
    return { ok: false, code: 'MARKET_AUCTION_BUYOUT_LE_START' };
  }
  if (input.minBidStep < 1) {
    return { ok: false, code: 'MARKET_AUCTION_MIN_STEP_LT_1' };
  }
  if (
    input.durationMinutes < MIN_AUCTION_DURATION_MINUTES ||
    input.durationMinutes > MAX_AUCTION_DURATION_MINUTES
  ) {
    return { ok: false, code: 'MARKET_AUCTION_DURATION_OUT_OF_RANGE' };
  }
  if ((input.currency as string) === 'TIEN_NGOC') {
    return { ok: false, code: 'MARKET_PAID_PREMIUM_NOT_TRADEABLE' };
  }
  if (!isMarketCurrency(input.currency)) {
    return { ok: false, code: 'MARKET_INVALID_CURRENCY' };
  }
  return { ok: true };
}

export function validateBid(
  input: BidInput,
): { ok: true; isBuyout: boolean } | { ok: false; code: string } {
  if (input.bidderCharacterId === input.sellerCharacterId) {
    return { ok: false, code: 'MARKET_AUCTION_SELF_BID' };
  }
  if (input.auctionStatus !== 'ACTIVE') {
    return { ok: false, code: 'MARKET_AUCTION_NOT_ACTIVE' };
  }
  if (new Date(input.nowIso).getTime() >= new Date(input.endsAt).getTime()) {
    return { ok: false, code: 'MARKET_AUCTION_ENDED' };
  }
  if (input.currency !== (input.currency as MarketCurrency)) {
    return { ok: false, code: 'MARKET_INVALID_CURRENCY' };
  }
  if (input.bidAmount < input.currentBid + input.minBidStep) {
    return { ok: false, code: 'MARKET_AUCTION_BID_TOO_LOW' };
  }
  if (
    input.buyoutPrice !== undefined &&
    input.bidAmount >= input.buyoutPrice
  ) {
    return { ok: true, isBuyout: true };
  }
  return { ok: true, isBuyout: false };
}

// ---------------------------------------------------------------------------
// 5. Anti-abuse anomaly
// ---------------------------------------------------------------------------

export const MARKET_ANOMALY_TYPES = [
  'PRICE_TOO_LOW',
  'PRICE_TOO_HIGH',
  'RAPID_RESALE',
  'SAME_PAIR_REPEATED_TRADES',
  'ALT_ACCOUNT_SUSPECTED',
  'LARGE_VALUE_TRANSFER',
  'MARKET_MANIPULATION',
  'AUCTION_SELF_BID_SUSPECTED',
  'DUPLICATE_CLAIM_ATTEMPT',
  'EXCESSIVE_CANCEL_RELIST',
] as const;
export type MarketAnomalyType = (typeof MARKET_ANOMALY_TYPES)[number];

export const MARKET_ANOMALY_SEVERITIES = ['INFO', 'WARN', 'CRITICAL'] as const;
export type MarketAnomalySeverity = (typeof MARKET_ANOMALY_SEVERITIES)[number];

export const MARKET_ANOMALY_DEFAULT_SEVERITY: Readonly<
  Record<MarketAnomalyType, MarketAnomalySeverity>
> = {
  PRICE_TOO_LOW: 'WARN',
  PRICE_TOO_HIGH: 'WARN',
  RAPID_RESALE: 'WARN',
  SAME_PAIR_REPEATED_TRADES: 'WARN',
  ALT_ACCOUNT_SUSPECTED: 'CRITICAL',
  LARGE_VALUE_TRANSFER: 'CRITICAL',
  MARKET_MANIPULATION: 'CRITICAL',
  AUCTION_SELF_BID_SUSPECTED: 'WARN',
  DUPLICATE_CLAIM_ATTEMPT: 'CRITICAL',
  EXCESSIVE_CANCEL_RELIST: 'INFO',
};

export interface MarketAnomalyClassifyInput {
  type: MarketAnomalyType;
  /** Tỉ lệ giá so với median 7-day. 0.1 = 10% median. */
  priceRatio?: number;
  /** Số lần resale cùng item trong window. */
  resaleCount?: number;
  /** Số lần cùng cặp seller/buyer giao dịch. */
  pairCount?: number;
  /** Tổng giá trị giao dịch (Linh Thạch). */
  totalValue?: number;
}

/**
 * Auto-derive severity. Trường hợp delta lớn → bump severity.
 * Mặc định = MARKET_ANOMALY_DEFAULT_SEVERITY.
 */
export function classifyMarketAnomaly(
  input: MarketAnomalyClassifyInput,
): MarketAnomalySeverity {
  const base = MARKET_ANOMALY_DEFAULT_SEVERITY[input.type];
  if (input.type === 'PRICE_TOO_LOW' && (input.priceRatio ?? 1) < 0.1) {
    return 'CRITICAL';
  }
  if (input.type === 'PRICE_TOO_HIGH' && (input.priceRatio ?? 1) > 10) {
    return 'CRITICAL';
  }
  if (input.type === 'RAPID_RESALE' && (input.resaleCount ?? 0) > 10) {
    return 'CRITICAL';
  }
  if (
    input.type === 'SAME_PAIR_REPEATED_TRADES' &&
    (input.pairCount ?? 0) > 5
  ) {
    return 'CRITICAL';
  }
  if (input.type === 'LARGE_VALUE_TRANSFER' && (input.totalValue ?? 0) > 100_000_000) {
    return 'CRITICAL';
  }
  return base;
}

// ---------------------------------------------------------------------------
// 6. Personal Stall
// ---------------------------------------------------------------------------

export const PERSONAL_STALL_DEFAULT_SLOT_LIMIT = 6;
export const PERSONAL_STALL_MAX_SLOT_LIMIT = 30;

export interface PersonalStallInput {
  characterId: string;
  stallName: string;
  description?: string;
  slotLimit: number;
  autoRenewEnabled?: boolean;
  themeKey?: string;
}

export const STALL_NAME_MAX_LENGTH = 30;
export const STALL_DESCRIPTION_MAX_LENGTH = 200;

export function validatePersonalStall(input: PersonalStallInput): string[] {
  const errors: string[] = [];
  if (!input.characterId) errors.push('STALL_CHARACTER_ID_REQUIRED');
  if (!input.stallName || input.stallName.trim() === '') {
    errors.push('STALL_NAME_REQUIRED');
  }
  if (input.stallName.length > STALL_NAME_MAX_LENGTH) {
    errors.push('STALL_NAME_TOO_LONG');
  }
  if (input.description && input.description.length > STALL_DESCRIPTION_MAX_LENGTH) {
    errors.push('STALL_DESCRIPTION_TOO_LONG');
  }
  if (
    input.slotLimit < 1 ||
    input.slotLimit > PERSONAL_STALL_MAX_SLOT_LIMIT
  ) {
    errors.push('STALL_SLOT_LIMIT_OUT_OF_RANGE');
  }
  return errors;
}

// ---------------------------------------------------------------------------
// 7. Sect Treasury / Internal Auction
// ---------------------------------------------------------------------------

export const SECT_TREASURY_ACTION_TYPES = [
  'DEPOSIT',
  'WITHDRAW',
  'INTERNAL_AUCTION_DEPOSIT',
  'INTERNAL_AUCTION_RETURN',
  'ADMIN_FORCE_WITHDRAW',
  'ADMIN_LOCK',
  'ADMIN_UNLOCK',
] as const;
export type SectTreasuryActionType = (typeof SECT_TREASURY_ACTION_TYPES)[number];

export const SECT_TREASURY_ROLES_FOR_WITHDRAW = ['LEADER', 'ELDER'] as const;
export type SectTreasuryRole = (typeof SECT_TREASURY_ROLES_FOR_WITHDRAW)[number];

export interface SectAuctionInput {
  sectId: string;
  itemKey: string;
  quantity: number;
  startPrice: number;
  minBidStep: number;
  currency: MarketCurrency;
  durationMinutes: number;
}

export function validateSectAuctionInput(
  input: SectAuctionInput,
): { ok: true } | { ok: false; code: string } {
  if (input.quantity < 1) return { ok: false, code: 'SECT_AUCTION_QTY_LT_1' };
  if (input.startPrice < 1) {
    return { ok: false, code: 'SECT_AUCTION_START_PRICE_LT_1' };
  }
  if (input.minBidStep < 1) {
    return { ok: false, code: 'SECT_AUCTION_MIN_STEP_LT_1' };
  }
  if (
    input.durationMinutes < MIN_AUCTION_DURATION_MINUTES ||
    input.durationMinutes > MAX_AUCTION_DURATION_MINUTES
  ) {
    return { ok: false, code: 'SECT_AUCTION_DURATION_OUT_OF_RANGE' };
  }
  // Sect internal auction phải dùng Sect Contribution hoặc Linh Thạch.
  if (
    input.currency !== 'SECT_CONTRIBUTION' &&
    input.currency !== 'LINH_THACH'
  ) {
    return { ok: false, code: 'SECT_AUCTION_INVALID_CURRENCY' };
  }
  return { ok: true };
}

// ---------------------------------------------------------------------------
// 8. Price History snapshot
// ---------------------------------------------------------------------------

export interface MarketPriceSnapshotDef {
  itemKey: string;
  tier?: number;
  rarity?: string;
  avgPrice24h: number;
  avgPrice7d: number;
  avgPrice30d: number;
  minPrice: number;
  maxPrice: number;
  volume24h: number;
  volume7d: number;
  updatedAt: string;
}

export interface PriceSnapshotInput {
  /** Tất cả transaction trong window 30 ngày, sorted by ASC time. */
  transactions: ReadonlyArray<{
    unitPrice: number;
    quantity: number;
    timestamp: string;
  }>;
  itemKey: string;
  nowIso: string;
}

const MS_24H = 24 * 60 * 60 * 1000;
const MS_7D = 7 * MS_24H;
const MS_30D = 30 * MS_24H;

export function computePriceSnapshot(
  input: PriceSnapshotInput,
): MarketPriceSnapshotDef {
  const now = new Date(input.nowIso).getTime();
  const tx24 = input.transactions.filter(
    (t) => now - new Date(t.timestamp).getTime() <= MS_24H,
  );
  const tx7 = input.transactions.filter(
    (t) => now - new Date(t.timestamp).getTime() <= MS_7D,
  );
  const tx30 = input.transactions.filter(
    (t) => now - new Date(t.timestamp).getTime() <= MS_30D,
  );

  const avg = (arr: typeof input.transactions): number => {
    if (arr.length === 0) return 0;
    const sum = arr.reduce((s, t) => s + t.unitPrice * t.quantity, 0);
    const qty = arr.reduce((s, t) => s + t.quantity, 0);
    return qty > 0 ? Math.floor(sum / qty) : 0;
  };
  const vol = (arr: typeof input.transactions): number =>
    arr.reduce((s, t) => s + t.unitPrice * t.quantity, 0);

  const prices = tx30.map((t) => t.unitPrice);
  return {
    itemKey: input.itemKey,
    avgPrice24h: avg(tx24),
    avgPrice7d: avg(tx7),
    avgPrice30d: avg(tx30),
    minPrice: prices.length > 0 ? Math.min(...prices) : 0,
    maxPrice: prices.length > 0 ? Math.max(...prices) : 0,
    volume24h: vol(tx24),
    volume7d: vol(tx7),
    updatedAt: input.nowIso,
  };
}

// ---------------------------------------------------------------------------
// 9. Error codes
// ---------------------------------------------------------------------------

export const MARKET_ERROR_CODES = [
  'MARKET_PAID_PREMIUM_NOT_TRADEABLE',
  'MARKET_INVALID_CURRENCY',
  'MARKET_ITEM_FORBIDDEN_ENDGAME',
  'MARKET_ITEM_BIND',
  'MARKET_ITEM_EXPIRED',
  'MARKET_ITEM_EQUIPPED',
  'MARKET_ITEM_LOCKED_EXTERNAL',
  'MARKET_ITEM_ADMIN_LOCKED',
  'MARKET_ITEM_EVENT_BOUND_NOT_ALLOWED',
  'MARKET_QTY_LT_1',
  'MARKET_QTY_EXCEEDS_POLICY',
  'MARKET_UNIT_PRICE_LT_1',
  'MARKET_PRICE_BELOW_MIN',
  'MARKET_PRICE_ABOVE_MAX',
  'MARKET_LISTING_LIMIT_REACHED',
  'MARKET_AUCTION_START_PRICE_LT_1',
  'MARKET_AUCTION_BUYOUT_LE_START',
  'MARKET_AUCTION_MIN_STEP_LT_1',
  'MARKET_AUCTION_DURATION_OUT_OF_RANGE',
  'MARKET_AUCTION_SELF_BID',
  'MARKET_AUCTION_NOT_ACTIVE',
  'MARKET_AUCTION_ENDED',
  'MARKET_AUCTION_BID_TOO_LOW',
  'SECT_AUCTION_QTY_LT_1',
  'SECT_AUCTION_START_PRICE_LT_1',
  'SECT_AUCTION_MIN_STEP_LT_1',
  'SECT_AUCTION_DURATION_OUT_OF_RANGE',
  'SECT_AUCTION_INVALID_CURRENCY',
  'STALL_CHARACTER_ID_REQUIRED',
  'STALL_NAME_REQUIRED',
  'STALL_NAME_TOO_LONG',
  'STALL_DESCRIPTION_TOO_LONG',
  'STALL_SLOT_LIMIT_OUT_OF_RANGE',
] as const;
export type MarketErrorCode = (typeof MARKET_ERROR_CODES)[number];
