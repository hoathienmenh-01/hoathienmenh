/**
 * Phase 31.0 — Returner Support Foundation.
 *
 * Mục tiêu: detect người chơi vắng X ngày, khi quay lại set flag,
 * gửi mail "Trở Lại Tiên Đồ", và mở gói nhiệm vụ returner. Reward
 * "vừa phải" — KHÔNG endgame item, KHÔNG vượt tier.
 *
 * Anti-abuse:
 *   - Mỗi `inactivityDaysTier` chỉ trigger 1 lần / chu kỳ (idempotent
 *     theo `cycleKey = YYYY-MM-DD-tier` lưu trong `CharacterReturnerState`).
 *   - `rewardTier = min(playerRealmTier, RETURNER_REWARD_TIER_CAP)`.
 *   - Item reward must NOT be in `RETURNER_FORBIDDEN_ITEM_KEYS`.
 */

export const RETURNER_TIERS = ['SHORT', 'MEDIUM', 'LONG'] as const;
export type ReturnerTier = (typeof RETURNER_TIERS)[number];

export function isReturnerTier(v: unknown): v is ReturnerTier {
  return typeof v === 'string' && (RETURNER_TIERS as readonly string[]).includes(v);
}

/**
 * Ngưỡng inactive (theo ngày) để xếp tier. Server đọc lúc login /
 * cron. FE không validate ngưỡng.
 */
export const RETURNER_INACTIVITY_DAYS: Record<ReturnerTier, number> = {
  SHORT: 7,
  MEDIUM: 14,
  LONG: 30,
};

/**
 * Cap reward tier theo returner tier. Mục đích: tránh phát endgame
 * item cho returner LONG khi player level cao.
 */
export const RETURNER_REWARD_TIER_CAP: Record<ReturnerTier, number> = {
  SHORT: 4,
  MEDIUM: 6,
  LONG: 9,
};

/**
 * Item key tuyệt đối forbidden trong returner reward. Dùng chung với
 * `admin-control-center.ts` forbidden list (subset).
 */
export const RETURNER_FORBIDDEN_ITEM_KEYS: ReadonlySet<string> = new Set([
  'hau_tho_tran_hon_an',
  'ban_nguyen_chi_bao',
  'hu_khong_chi_bao',
  'tien_huyen_kiem',
  'tien_huyen_giap',
  'than_dan',
]);

export const RETURNER_LIMITS = {
  /** Cap số linh thạch reward / 1 lần trigger. */
  MAX_LINH_THACH_PER_TRIGGER: 100_000n,
  /** Cap số tiên ngọc — Phase 31 mặc định 0 (KHÔNG mint TN cho returner). */
  MAX_TIEN_NGOC_PER_TRIGGER: 0,
  /** Cap exp / 1 lần. */
  MAX_EXP_PER_TRIGGER: 1_000_000n,
  /** Cap số item entries / mail returner. */
  MAX_ITEM_ENTRIES_PER_MAIL: 6,
} as const;

export interface ReturnerTierContext {
  tier: ReturnerTier;
  inactiveDays: number;
  /** Ngày tạo cycleKey để idempotent. */
  cycleKey: string;
}

export interface ReturnerRewardItem {
  itemKey: string;
  qty: number;
}

export interface ReturnerRewardTemplate {
  tier: ReturnerTier;
  /** Linh thạch (string bigint). */
  linhThach: string;
  /** Tiên ngọc — KHÔNG mint trong Phase 31 nhưng giữ field cho phase sau. */
  tienNgoc: number;
  /** EXP (string bigint). */
  exp: string;
  items: ReturnerRewardItem[];
}

/**
 * Default returner reward template per tier. Server có thể override
 * qua config-version sau. Anti-P2W: KHÔNG có item nào trong
 * `RETURNER_FORBIDDEN_ITEM_KEYS`.
 */
export const DEFAULT_RETURNER_REWARDS: Record<ReturnerTier, ReturnerRewardTemplate> = {
  SHORT: {
    tier: 'SHORT',
    linhThach: '10000',
    tienNgoc: 0,
    exp: '100000',
    items: [
      { itemKey: 'qi_pill_minor', qty: 5 },
      { itemKey: 'stamina_pill_minor', qty: 3 },
    ],
  },
  MEDIUM: {
    tier: 'MEDIUM',
    linhThach: '50000',
    tienNgoc: 0,
    exp: '500000',
    items: [
      { itemKey: 'qi_pill_minor', qty: 15 },
      { itemKey: 'stamina_pill_minor', qty: 8 },
      { itemKey: 'breakthrough_charm_minor', qty: 1 },
    ],
  },
  LONG: {
    tier: 'LONG',
    linhThach: '100000',
    tienNgoc: 0,
    exp: '1000000',
    items: [
      { itemKey: 'qi_pill_medium', qty: 10 },
      { itemKey: 'stamina_pill_medium', qty: 5 },
      { itemKey: 'breakthrough_charm_medium', qty: 1 },
    ],
  },
};

/**
 * Resolve returner tier theo inactiveDays. Trả `null` nếu < ngưỡng
 * SHORT (không phải returner).
 */
export function resolveReturnerTier(inactiveDays: number): ReturnerTier | null {
  if (!Number.isFinite(inactiveDays) || inactiveDays < RETURNER_INACTIVITY_DAYS.SHORT) {
    return null;
  }
  if (inactiveDays >= RETURNER_INACTIVITY_DAYS.LONG) return 'LONG';
  if (inactiveDays >= RETURNER_INACTIVITY_DAYS.MEDIUM) return 'MEDIUM';
  return 'SHORT';
}

/**
 * Build cycleKey deterministic theo (userId, tier, today). Anti-replay:
 * 1 returner tier chỉ trigger 1 lần / 1 ngày (server timezone UTC).
 */
export function buildReturnerCycleKey(
  userId: string,
  tier: ReturnerTier,
  now: Date,
): string {
  const y = now.getUTCFullYear();
  const m = String(now.getUTCMonth() + 1).padStart(2, '0');
  const d = String(now.getUTCDate()).padStart(2, '0');
  return `${userId}:${tier}:${y}-${m}-${d}`;
}

/**
 * Pure validator: 1 reward template không vi phạm Phase 31 caps.
 */
export function validateReturnerReward(template: ReturnerRewardTemplate): string | null {
  const lt = (() => {
    try {
      return BigInt(template.linhThach);
    } catch {
      return null;
    }
  })();
  if (lt === null || lt < 0n) return 'INVALID_LINH_THACH';
  if (lt > RETURNER_LIMITS.MAX_LINH_THACH_PER_TRIGGER) return 'LINH_THACH_CAP';
  if (template.tienNgoc < 0) return 'INVALID_TIEN_NGOC';
  if (template.tienNgoc > RETURNER_LIMITS.MAX_TIEN_NGOC_PER_TRIGGER) {
    return 'TIEN_NGOC_CAP';
  }
  const ex = (() => {
    try {
      return BigInt(template.exp);
    } catch {
      return null;
    }
  })();
  if (ex === null || ex < 0n) return 'INVALID_EXP';
  if (ex > RETURNER_LIMITS.MAX_EXP_PER_TRIGGER) return 'EXP_CAP';
  if (template.items.length > RETURNER_LIMITS.MAX_ITEM_ENTRIES_PER_MAIL) {
    return 'ITEM_ENTRIES_CAP';
  }
  for (const it of template.items) {
    if (!it.itemKey || it.qty <= 0) return 'INVALID_ITEM';
    if (RETURNER_FORBIDDEN_ITEM_KEYS.has(it.itemKey)) return 'ITEM_FORBIDDEN';
  }
  return null;
}

export interface ReturnerStateView {
  characterId: string;
  /** ISO datetime. Null khi character chưa từng login (rare). */
  lastLoginAt: string | null;
  /** Số ngày inactive tại thời điểm computeReturnerState. */
  inactiveDays: number;
  /** Tier hiện tại (null nếu chưa qualify returner). */
  tier: ReturnerTier | null;
  /** Server đã trigger reward cho `currentCycleKey` chưa. */
  alreadyClaimedThisCycle: boolean;
  /** ISO datetime của lần trigger gần nhất. */
  lastTriggerAt: string | null;
}
