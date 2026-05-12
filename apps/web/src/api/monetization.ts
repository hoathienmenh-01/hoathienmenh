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
