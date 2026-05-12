export type MonetizationRewardKind = 'currency' | 'item' | 'cosmetic';
export type BattlePassTrack = 'free' | 'premium';
export type CosmeticKind = 'title' | 'aura' | 'frame';

export interface MonetizationReward {
  kind: MonetizationRewardKind;
  key: string;
  qty: number;
}

export interface BattlePassLevelReward {
  level: number;
  free: readonly MonetizationReward[];
  premium: readonly MonetizationReward[];
}

export interface BattlePassSeasonDef {
  seasonId: string;
  nameVi: string;
  nameEn: string;
  startAt: string;
  endAt: string;
  active: boolean;
  xpPerLevel: number;
  maxLevel: number;
  rewards: readonly BattlePassLevelReward[];
}

export interface BattlePassProgressLike {
  xp: number;
  level: number;
  premiumUnlocked: boolean;
  claimedFreeLevels: readonly number[];
  claimedPremiumLevels: readonly number[];
}

export interface MonthlyCardConfig {
  durationDays: number;
  dayBucketTimeZone: 'UTC';
  upfrontReward: readonly MonetizationReward[];
  dailyRewards: readonly MonetizationReward[];
  specialDailyRewards: Readonly<Record<number, readonly MonetizationReward[]>>;
}

export interface MonthlyCardSubscriptionLike {
  activeUntil: Date | string | null;
  lastClaimAt?: Date | string | null;
  totalClaimedDays: number;
}

export interface VipPerks {
  autoSweepBonus: number;
  inventorySlotBonus: number;
  gemUnsocketFeeDiscountPct: number;
  reforgeFeeDiscountPct: number;
  dungeonEntryBonusDaily: number;
  cosmeticTitleKey?: string;
  cosmeticFrameKey?: string;
}

export interface VipTierDef {
  level: number;
  lifetimeTopupMin: number;
  perks: VipPerks;
}

export const MONETIZATION_MAX_ACCELERATION_MULTIPLIER = 1.4;
export const BATTLE_PASS_MAX_REWARD_LEVEL = 10;
export const BATTLE_PASS_PREMIUM_ACCELERATION_LIMIT = 0.4;
export const MONTHLY_CARD_DURATION_DAYS = 30;
export const VIP_LIGHT_MAX_LEVEL = 5;

const BATTLE_PASS_REWARDS: readonly BattlePassLevelReward[] = [
  {
    level: 1,
    free: [currency('linhThach', 500), item('tinh_thiet', 4)],
    premium: [currency('linhThach', 800), item('tinh_thiet', 6), item('son_coc_yeu_phu', 1)],
  },
  {
    level: 2,
    free: [item('yeu_dan', 2)],
    premium: [item('yeu_dan', 4), item('refine_protection_charm', 1)],
  },
  {
    level: 3,
    free: [currency('tienNgocKhoa', 10), item('phap_bao_shard', 2)],
    premium: [currency('tienNgocKhoa', 20), item('phap_bao_shard', 4)],
  },
  {
    level: 4,
    free: [item('moc_huyen_lam_phu', 1)],
    premium: [item('moc_huyen_lam_phu', 1), item('refine_protection_charm', 1)],
  },
  {
    level: 5,
    free: [currency('linhThach', 1_000), item('han_ngoc', 1)],
    premium: [currency('linhThach', 1_500), item('han_ngoc', 2), cosmetic('title', 'title_tien_lo_lenh_so_khoi')],
  },
  {
    level: 6,
    free: [item('tinh_thiet', 6)],
    premium: [item('tinh_thiet', 10), item('yeu_dan', 4)],
  },
  {
    level: 7,
    free: [item('phap_bao_shard', 2)],
    premium: [item('phap_bao_shard', 4), item('awaken_stone', 1)],
  },
  {
    level: 8,
    free: [item('hac_lam_yeu_phu', 1)],
    premium: [item('hac_lam_yeu_phu', 1), item('refine_protection_charm', 1)],
  },
  {
    level: 9,
    free: [currency('tienNgocKhoa', 15), item('han_ngoc', 1)],
    premium: [currency('tienNgocKhoa', 25), item('han_ngoc', 2)],
  },
  {
    level: 10,
    free: [currency('linhThach', 2_000), cosmetic('aura', 'aura_tien_lo_moc_nien')],
    premium: [
      currency('linhThach', 3_000),
      item('phap_bao_shard', 6),
      cosmetic('frame', 'frame_tien_lo_lenh'),
    ],
  },
] as const;

export const BATTLE_PASS_SEASONS: readonly BattlePassSeasonDef[] = [
  {
    seasonId: 'phase_25_1_foundation',
    nameVi: 'Tiên Lộ Lệnh — Sơ Khởi',
    nameEn: 'Immortal Path Pass — Foundation',
    startAt: '2026-05-01T00:00:00.000Z',
    endAt: '2026-06-01T00:00:00.000Z',
    active: true,
    xpPerLevel: 100,
    maxLevel: BATTLE_PASS_MAX_REWARD_LEVEL,
    rewards: BATTLE_PASS_REWARDS,
  },
] as const;

export const MONTHLY_CARD_CONFIG: MonthlyCardConfig = {
  durationDays: MONTHLY_CARD_DURATION_DAYS,
  dayBucketTimeZone: 'UTC',
  upfrontReward: [currency('tienNgocKhoa', 60), item('son_coc_yeu_phu', 1)],
  dailyRewards: [currency('tienNgocKhoa', 10), currency('linhThach', 500)],
  specialDailyRewards: {
    7: [item('refine_protection_charm', 1)],
    14: [item('phap_bao_shard', 3)],
    21: [item('hac_lam_yeu_phu', 1)],
    30: [item('awaken_stone', 1), cosmetic('aura', 'aura_nguyet_tap_vien_man')],
  },
} as const;

export const VIP_LIGHT_CONFIG: readonly VipTierDef[] = [
  { level: 0, lifetimeTopupMin: 0, perks: vipPerks(0, 0, 0, 0, 0) },
  {
    level: 1,
    lifetimeTopupMin: 50_000,
    perks: vipPerks(1, 10, 5, 5, 0, 'title_vip_light_1'),
  },
  {
    level: 2,
    lifetimeTopupMin: 150_000,
    perks: vipPerks(1, 20, 8, 8, 0, 'title_vip_light_2'),
  },
  {
    level: 3,
    lifetimeTopupMin: 300_000,
    perks: vipPerks(2, 30, 10, 10, 1, 'title_vip_light_3'),
  },
  {
    level: 4,
    lifetimeTopupMin: 600_000,
    perks: vipPerks(2, 40, 12, 12, 1, 'title_vip_light_4', 'frame_vip_light_4'),
  },
  {
    level: 5,
    lifetimeTopupMin: 1_000_000,
    perks: vipPerks(3, 50, 15, 15, 1, 'title_vip_light_5', 'frame_vip_light_5'),
  },
] as const;

const DIRECT_EQUIPMENT_ITEM_KEYS = new Set([
  'tien_huyen_kiem',
  'tien_huyen_giap',
  'than_dan',
]);

const FORBIDDEN_DIRECT_ARTIFACT_KEYS = new Set([
  'hau_tho_tran_hon_an',
  'ban_nguyen_chi_bao',
  'hu_khong_chi_bao',
]);

const MAX_ITEM_QTY_PER_REWARD: Readonly<Record<string, number>> = {
  tinh_thiet: 20,
  yeu_dan: 12,
  han_ngoc: 6,
  phap_bao_shard: 10,
  awaken_stone: 1,
  refine_protection_charm: 2,
  son_coc_yeu_phu: 2,
  hac_lam_yeu_phu: 2,
  yeu_thu_dong_phu: 1,
  kim_son_mach_phu: 1,
  moc_huyen_lam_phu: 1,
  thuy_long_uyen_phu: 1,
};

export function getActiveBattlePassSeason(
  now: Date = new Date(),
): BattlePassSeasonDef | null {
  return (
    BATTLE_PASS_SEASONS.find(
      (season) =>
        season.active && now >= new Date(season.startAt) && now < new Date(season.endAt),
    ) ?? null
  );
}

export function getBattlePassLevelForXp(
  xp: number,
  season: BattlePassSeasonDef = BATTLE_PASS_SEASONS[0],
): number {
  if (!Number.isFinite(xp) || xp < 0) return 0;
  return Math.min(season.maxLevel, Math.floor(xp / season.xpPerLevel));
}

export function getBattlePassReward(
  level: number,
  track: BattlePassTrack,
  season: BattlePassSeasonDef = BATTLE_PASS_SEASONS[0],
): readonly MonetizationReward[] {
  const reward = season.rewards.find((entry) => entry.level === level);
  return reward?.[track] ?? [];
}

export function canClaimBattlePassReward(
  progress: BattlePassProgressLike,
  level: number,
  track: BattlePassTrack,
): boolean {
  if (!Number.isInteger(level) || level < 1) return false;
  if (progress.level < level) return false;
  if (track === 'premium' && !progress.premiumUnlocked) return false;
  const claimed =
    track === 'free' ? progress.claimedFreeLevels : progress.claimedPremiumLevels;
  return !claimed.includes(level);
}

export function validateBattlePassReward(reward: MonetizationReward): boolean {
  if (!Number.isInteger(reward.qty) || reward.qty <= 0) return false;
  if (reward.kind === 'currency') {
    if (!['linhThach', 'tienNgocKhoa'].includes(reward.key)) return false;
    if (reward.key === 'linhThach') return reward.qty <= 5_000;
    return reward.qty <= 60;
  }
  if (reward.kind === 'cosmetic') {
    return ['title_', 'aura_', 'frame_'].some((prefix) => reward.key.startsWith(prefix));
  }
  if (DIRECT_EQUIPMENT_ITEM_KEYS.has(reward.key)) return false;
  if (FORBIDDEN_DIRECT_ARTIFACT_KEYS.has(reward.key)) return false;
  const maxQty = MAX_ITEM_QTY_PER_REWARD[reward.key];
  return maxQty !== undefined && reward.qty <= maxQty;
}

export function validateBattlePassSeason(season: BattlePassSeasonDef): boolean {
  if (season.maxLevel > BATTLE_PASS_MAX_REWARD_LEVEL) return false;
  if (season.xpPerLevel <= 0) return false;
  return season.rewards.every(
    (entry) =>
      entry.level >= 1 &&
      entry.level <= season.maxLevel &&
      entry.free.every(validateBattlePassReward) &&
      entry.premium.every(validateBattlePassReward),
  );
}

export function canClaimMonthlyCard(
  subscription: MonthlyCardSubscriptionLike | null,
  now: Date = new Date(),
): boolean {
  if (!subscription?.activeUntil) return false;
  if (new Date(subscription.activeUntil) <= now) return false;
  if (!subscription.lastClaimAt) return true;
  return utcDayBucket(subscription.lastClaimAt) !== utcDayBucket(now);
}

export function getMonthlyCardDailyReward(
  day: number,
): readonly MonetizationReward[] {
  const base = [...MONTHLY_CARD_CONFIG.dailyRewards];
  const special = MONTHLY_CARD_CONFIG.specialDailyRewards[day] ?? [];
  return [...base, ...special];
}

export function getMonthlyCardDaysRemaining(
  subscription: MonthlyCardSubscriptionLike | null,
  now: Date = new Date(),
): number {
  if (!subscription?.activeUntil) return 0;
  const ms = new Date(subscription.activeUntil).getTime() - now.getTime();
  return Math.max(0, Math.ceil(ms / 86_400_000));
}

export function getVipLevelFromTopup(amount: number): number {
  if (!Number.isFinite(amount) || amount < 0) return 0;
  return VIP_LIGHT_CONFIG.reduce((level, tier) => {
    if (amount >= tier.lifetimeTopupMin) return tier.level;
    return level;
  }, 0);
}

export function getVipPerks(level: number): VipPerks {
  const tier = VIP_LIGHT_CONFIG.find((entry) => entry.level === level);
  return tier?.perks ?? VIP_LIGHT_CONFIG[0].perks;
}

export function validateVipPerks(level: number): boolean {
  if (!Number.isInteger(level) || level < 0 || level > VIP_LIGHT_MAX_LEVEL) return false;
  const perks = getVipPerks(level);
  return (
    perks.autoSweepBonus <= 3 &&
    perks.inventorySlotBonus <= 50 &&
    perks.gemUnsocketFeeDiscountPct <= 15 &&
    perks.reforgeFeeDiscountPct <= 15 &&
    perks.dungeonEntryBonusDaily <= 1
  );
}

export function validateMonthlyCardConfig(): boolean {
  return (
    MONTHLY_CARD_CONFIG.durationDays === MONTHLY_CARD_DURATION_DAYS &&
    MONTHLY_CARD_CONFIG.upfrontReward.every(validateBattlePassReward) &&
    MONTHLY_CARD_CONFIG.dailyRewards.every(validateBattlePassReward) &&
    Object.values(MONTHLY_CARD_CONFIG.specialDailyRewards).every((rewards) =>
      rewards.every(validateBattlePassReward),
    )
  );
}

export function utcDayBucket(input: Date | string): string {
  return new Date(input).toISOString().slice(0, 10);
}

function currency(key: 'linhThach' | 'tienNgocKhoa', qty: number): MonetizationReward {
  return { kind: 'currency', key, qty };
}

function item(key: string, qty: number): MonetizationReward {
  return { kind: 'item', key, qty };
}

function cosmetic(kind: CosmeticKind, key: string): MonetizationReward {
  return { kind: 'cosmetic', key, qty: 1 };
}

function vipPerks(
  autoSweepBonus: number,
  inventorySlotBonus: number,
  gemUnsocketFeeDiscountPct: number,
  reforgeFeeDiscountPct: number,
  dungeonEntryBonusDaily: number,
  cosmeticTitleKey?: string,
  cosmeticFrameKey?: string,
): VipPerks {
  return {
    autoSweepBonus,
    inventorySlotBonus,
    gemUnsocketFeeDiscountPct,
    reforgeFeeDiscountPct,
    dungeonEntryBonusDaily,
    cosmeticTitleKey,
    cosmeticFrameKey,
  };
}
