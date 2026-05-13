import { apiClient } from './client';

export interface MonetizationReward {
  kind: 'currency' | 'item' | 'cosmetic';
  key: string;
  qty: number;
}

export interface BattlePassState {
  season: {
    seasonId: string;
    nameVi: string;
    nameEn: string;
    startAt: string;
    endAt: string;
    xpPerLevel: number;
    maxLevel: number;
    rewards: Array<{
      level: number;
      free: MonetizationReward[];
      premium: MonetizationReward[];
    }>;
  };
  progress: {
    xp: number;
    level: number;
    premiumUnlocked: boolean;
    claimedFreeLevels: number[];
    claimedPremiumLevels: number[];
  };
}

export interface MonthlyCardState {
  subscription: {
    activeUntil: string;
    lastClaimAt: string | null;
    totalClaimedDays: number;
  } | null;
  active: boolean;
  daysRemaining: number;
  canClaimToday: boolean;
  todayReward: MonetizationReward[];
}

export interface VipState {
  profile: {
    vipLevel: number;
    lifetimeTopupAmount: number;
    grantedByAdmin: boolean;
  };
  perks: {
    autoSweepBonus: number;
    inventorySlotBonus: number;
    gemUnsocketFeeDiscountPct: number;
    reforgeFeeDiscountPct: number;
    dungeonEntryBonusDaily: number;
    cosmeticTitleKey?: string;
    cosmeticFrameKey?: string;
  };
  nextLevel: number | null;
}

interface ApiEnvelope<T> {
  ok: boolean;
  data: T;
}

export async function getBattlePass(): Promise<BattlePassState> {
  const { data } = await apiClient.get<ApiEnvelope<BattlePassState>>(
    '/monetization/battle-pass/current',
  );
  return data.data;
}

export async function claimBattlePass(
  level: number,
  track: 'free' | 'premium',
): Promise<BattlePassState> {
  const { data } = await apiClient.post<ApiEnvelope<BattlePassState>>(
    '/monetization/battle-pass/claim',
    { level, track },
  );
  return data.data;
}

export async function claimAllBattlePass(): Promise<BattlePassState> {
  const { data } = await apiClient.post<ApiEnvelope<BattlePassState>>(
    '/monetization/battle-pass/claim-all',
  );
  return data.data;
}

export async function getMonthlyCard(): Promise<MonthlyCardState> {
  const { data } = await apiClient.get<ApiEnvelope<MonthlyCardState>>(
    '/monetization/monthly-card',
  );
  return data.data;
}

export async function claimMonthlyCard(): Promise<MonthlyCardState> {
  const { data } = await apiClient.post<ApiEnvelope<MonthlyCardState>>(
    '/monetization/monthly-card/claim',
  );
  return data.data;
}

export async function getVip(): Promise<VipState> {
  const { data } = await apiClient.get<ApiEnvelope<VipState>>('/monetization/vip');
  return data.data;
}

// ─── Phase 27.0 — Foundation API client ────────────────────────────────────

export type WalletCurrencyKey =
  | 'TIEN_NGOC'
  | 'TIEN_NGOC_KHOA'
  | 'LINH_THACH'
  | 'CONG_HIEN_TONG_MON'
  | 'TRIAL_POINT'
  | 'EVENT_TOKEN';

export interface WalletSnapshot {
  TIEN_NGOC: number;
  TIEN_NGOC_KHOA: number;
  LINH_THACH: number;
  CONG_HIEN_TONG_MON: number;
  TRIAL_POINT: number;
  EVENT_TOKEN: number;
}

export interface WalletLedgerEntry {
  id: string;
  currency: WalletCurrencyKey;
  delta: number;
  reason: string;
  refType: string | null;
  refId: string | null;
  meta: Record<string, unknown>;
  createdAt: string;
}

export interface EntitlementView {
  key: string;
  value: number;
  source: string;
  startsAt: string;
  expiresAt: string | null;
}

export interface ShopProductDef {
  key: string;
  nameVi: string;
  nameEn: string;
  productType: string;
  priceCurrency: WalletCurrencyKey;
  priceAmount: number;
  reward: MonetizationReward[];
  monthlyCardKey?: string;
  entitlement?: { key: string; value: number };
  entitlementDurationDays?: number;
  extraAttemptLimitKey?: string;
  growthFundKey?: string;
  purchaseLimitType: 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'LIFETIME' | 'NONE';
  purchaseLimitCount: number;
  enabled: boolean;
  descriptionVi: string;
}

export interface ShopListing {
  product: ShopProductDef;
  purchasedInPeriod: number;
  remaining: number;
  soldOut: boolean;
}

export interface ShopPurchaseResult {
  product: ShopProductDef;
  reward: MonetizationReward[];
  purchaseId: string;
  walletDelta: { currency: WalletCurrencyKey; delta: number };
}

export interface ExtraAttemptStateEntry {
  limitKey: string;
  usedCount: number;
  maxCount: number;
  remaining: number;
}

export interface GrowthFundMilestoneView {
  key: string;
  realmKey: string;
  realmOrder: number;
  nameVi: string;
  reward: MonetizationReward[];
  eligible: boolean;
  claimed: boolean;
}

export interface GrowthFundView {
  fundKey: string;
  purchasedAt: string;
  milestones: GrowthFundMilestoneView[];
}

export async function getWallet(): Promise<WalletSnapshot> {
  const { data } = await apiClient.get<ApiEnvelope<WalletSnapshot>>('/monetization/wallet');
  return data.data;
}

export async function getWalletLedger(opts: {
  limit?: number;
  currency?: WalletCurrencyKey;
} = {}): Promise<WalletLedgerEntry[]> {
  const params: Record<string, string> = {};
  if (opts.limit != null) params.limit = String(opts.limit);
  if (opts.currency) params.currency = opts.currency;
  const { data } = await apiClient.get<ApiEnvelope<WalletLedgerEntry[]>>(
    '/monetization/wallet/ledger',
    { params },
  );
  return data.data;
}

export async function listEntitlements(): Promise<EntitlementView[]> {
  const { data } = await apiClient.get<ApiEnvelope<EntitlementView[]>>(
    '/monetization/entitlements',
  );
  return data.data;
}

export async function listShop(): Promise<ShopListing[]> {
  const { data } = await apiClient.get<ApiEnvelope<ShopListing[]>>('/monetization/shop');
  return data.data;
}

export async function purchaseProduct(productKey: string): Promise<ShopPurchaseResult> {
  const { data } = await apiClient.post<ApiEnvelope<ShopPurchaseResult>>(
    '/monetization/shop/purchase',
    { productKey },
  );
  return data.data;
}

export async function useSweepTicket(input: {
  ticketKey: string;
  contentType: string;
  contentKey: string;
}): Promise<{
  ticketKey: string;
  contentType: string;
  contentKey: string;
  logId: string;
}> {
  const { data } = await apiClient.post<
    ApiEnvelope<{
      ticketKey: string;
      contentType: string;
      contentKey: string;
      logId: string;
    }>
  >('/monetization/sweep/use', input);
  return data.data;
}

export async function getExtraAttempts(): Promise<ExtraAttemptStateEntry[]> {
  const { data } = await apiClient.get<ApiEnvelope<ExtraAttemptStateEntry[]>>(
    '/monetization/extra-attempts',
  );
  return data.data;
}

export async function buyExtraAttempt(limitKey: string): Promise<ExtraAttemptStateEntry> {
  const { data } = await apiClient.post<ApiEnvelope<ExtraAttemptStateEntry>>(
    '/monetization/extra-attempts/buy',
    { limitKey },
  );
  return data.data;
}

export async function getGrowthFund(fundKey: string): Promise<GrowthFundView | null> {
  const { data } = await apiClient.get<ApiEnvelope<GrowthFundView | null>>(
    '/monetization/growth-fund',
    { params: { fundKey } },
  );
  return data.data;
}

export async function claimGrowthFundMilestone(
  fundKey: string,
  milestoneKey: string,
): Promise<GrowthFundView> {
  const { data } = await apiClient.post<ApiEnvelope<GrowthFundView>>(
    '/monetization/growth-fund/claim',
    { fundKey, milestoneKey },
  );
  return data.data;
}

// ─── Phase 27.1–27.5 — Monetization Systems V1 ───────────────────────────

export interface MonetizationOverview {
  activeEntitlements: Array<{
    key: string;
    value: number;
    source: string;
    expiresAt: string | null;
  }>;
  monthlyCards: Array<{
    cardKey: string;
    activeUntil: string;
    daysRemaining: number;
    canClaimToday: boolean;
    lastClaimAt: string | null;
  }>;
  battlePass: {
    seasonId: string | null;
    level: number;
    maxLevel: number;
    xp: number;
    xpPerLevel: number;
    premiumUnlocked: boolean;
    endsAt: string | null;
  };
  growthFunds: Array<{
    fundKey: string;
    purchased: boolean;
    purchasedAt: string | null;
    claimedMilestones: string[];
  }>;
  limitedShops: Array<{
    shopKey: string;
    period: 'DAILY' | 'WEEKLY' | 'MONTHLY';
    periodKey: string;
  }>;
  sweepTickets: Array<{ itemKey: string; quantity: number }>;
  extraAttempts: Array<{
    limitKey: string;
    usedToday: number;
    maxPerDay: number;
    nextResetAt: string;
  }>;
  wallet: Array<{ currency: string; amount: number }>;
}

export interface BattlePassMissionView {
  mission: {
    key: string;
    scope: 'DAILY' | 'WEEKLY' | 'SEASON';
    source: string;
    target: number;
    expReward: number;
    nameVi: string;
    nameEn: string;
    descriptionVi: string;
  };
  scopeBucket: string;
  progress: number;
  target: number;
  completed: boolean;
  claimed: boolean;
}

export interface BattlePassMissionsView {
  seasonId: string;
  daily: BattlePassMissionView[];
  weekly: BattlePassMissionView[];
  season: BattlePassMissionView[];
}

export interface LimitedShopItemListing {
  item: {
    shopKey: 'DAILY_SHOP' | 'WEEKLY_SHOP' | 'MONTHLY_SHOP';
    itemKey: string;
    nameVi: string;
    nameEn: string;
    descriptionVi: string;
    priceCurrency: string;
    priceAmount: number;
    purchaseLimitCount: number;
    reward: MonetizationReward[];
    enabled: boolean;
  };
  periodKey: string;
  purchasedInPeriod: number;
  remaining: number;
  soldOut: boolean;
}

export interface LimitedShopListing {
  shopKey: 'DAILY_SHOP' | 'WEEKLY_SHOP' | 'MONTHLY_SHOP';
  period: 'DAILY' | 'WEEKLY' | 'MONTHLY';
  periodKey: string;
  items: LimitedShopItemListing[];
}

export async function getMonetizationOverview(): Promise<MonetizationOverview> {
  const { data } = await apiClient.get<ApiEnvelope<MonetizationOverview>>(
    '/monetization/overview',
  );
  return data.data;
}

export async function getBattlePassMissions(): Promise<BattlePassMissionsView> {
  const { data } = await apiClient.get<ApiEnvelope<BattlePassMissionsView>>(
    '/monetization/battle-pass/missions',
  );
  return data.data;
}

export async function getLimitedShops(): Promise<LimitedShopListing[]> {
  const { data } = await apiClient.get<ApiEnvelope<LimitedShopListing[]>>(
    '/monetization/limited-shops',
  );
  return data.data;
}

export async function buyLimitedShopItem(
  shopKey: 'DAILY_SHOP' | 'WEEKLY_SHOP' | 'MONTHLY_SHOP',
  itemKey: string,
): Promise<{
  shopKey: string;
  itemKey: string;
  periodKey: string;
  quantity: number;
  totalInPeriod: number;
  limit: number;
}> {
  const { data } = await apiClient.post<
    ApiEnvelope<{
      shopKey: string;
      itemKey: string;
      periodKey: string;
      quantity: number;
      totalInPeriod: number;
      limit: number;
    }>
  >(`/monetization/limited-shops/buy`, { shopKey, itemKey });
  return data.data;
}
