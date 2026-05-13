/**
 * Phase 31.0 — System Gift / Compensation foundation.
 *
 * `SystemGift` row = template quà hệ thống (bảo trì / lỗi server /
 * mừng update / mốc server / event kết thúc). 1 row được "phát" thành
 * nhiều `Mail` row (1 per target character) — claim qua mail flow
 * thông thường (idempotent qua `Mail.claimedAt`).
 *
 * Target rule eval: server-authoritative. Test-friendly: validator
 * pure trên DTO, không touch DB.
 */

export const SYSTEM_GIFT_TARGET_RULE_TYPES = [
  'ALL_PLAYERS',
  'REALM_RANGE',
  'CREATED_BEFORE',
  'ACTIVE_IN_LAST_DAYS',
  'SECT_MEMBERS',
  'EVENT_PARTICIPANTS',
] as const;
export type SystemGiftTargetRuleType =
  (typeof SYSTEM_GIFT_TARGET_RULE_TYPES)[number];

export function isSystemGiftTargetRuleType(
  v: unknown,
): v is SystemGiftTargetRuleType {
  return (
    typeof v === 'string' &&
    (SYSTEM_GIFT_TARGET_RULE_TYPES as readonly string[]).includes(v)
  );
}

export interface SystemGiftItem {
  itemKey: string;
  qty: number;
}

export interface SystemGiftReward {
  /** BigInt string. */
  linhThach: string;
  /** Tiên ngọc — KHÔNG mint trong Phase 31 system gift mặc định. */
  tienNgoc: number;
  /** BigInt string. */
  exp: string;
  items: SystemGiftItem[];
}

export interface SystemGiftTargetRule {
  type: SystemGiftTargetRuleType;
  /** Realm tier min/max (inclusive) — chỉ áp dụng cho `REALM_RANGE`. */
  realmTierMin?: number;
  realmTierMax?: number;
  /** ISO datetime — chỉ áp dụng cho `CREATED_BEFORE`. */
  createdBefore?: string;
  /** Số ngày — chỉ áp dụng cho `ACTIVE_IN_LAST_DAYS`. */
  activeInLastDays?: number;
  /** Sect id — chỉ áp dụng cho `SECT_MEMBERS`. */
  sectId?: string;
  /** Event def id — chỉ áp dụng cho `EVENT_PARTICIPANTS`. */
  eventDefId?: string;
}

export interface SystemGiftDef {
  giftKey: string;
  title: string;
  body: string;
  reward: SystemGiftReward;
  targetRule: SystemGiftTargetRule;
  /** ISO datetime hoặc null. */
  expiresAt: string | null;
  /** userId admin tạo gift (null = system seed). */
  createdByAdminId: string | null;
}

export const SYSTEM_GIFT_LIMITS = {
  GIFT_KEY_MAX: 80,
  TITLE_MAX: 120,
  BODY_MAX: 2000,
  /** Max number of items per gift mail. */
  MAX_ITEMS_PER_GIFT: 10,
  /** Cap linh thạch / 1 gift mail (anti-mass-mint). */
  MAX_LINH_THACH_PER_GIFT: 10_000_000n,
  /** Cap tiên ngọc — Phase 31 mặc định 0 (KHÔNG được mint TN qua gift). */
  MAX_TIEN_NGOC_PER_GIFT: 0,
  /** Cap exp / 1 gift mail. */
  MAX_EXP_PER_GIFT: 100_000_000n,
  /** `ACTIVE_IN_LAST_DAYS` clamp range. */
  ACTIVE_IN_LAST_DAYS_MIN: 1,
  ACTIVE_IN_LAST_DAYS_MAX: 365,
  /** Realm tier clamp 1..28 (28-realm progression). */
  REALM_TIER_MIN: 1,
  REALM_TIER_MAX: 28,
} as const;

export type SystemGiftErrorCode =
  | 'INVALID_GIFT_KEY'
  | 'INVALID_TITLE'
  | 'INVALID_BODY'
  | 'INVALID_REWARD'
  | 'INVALID_TARGET_RULE'
  | 'LINH_THACH_CAP'
  | 'TIEN_NGOC_CAP'
  | 'EXP_CAP'
  | 'ITEM_ENTRIES_CAP'
  | 'INVALID_ITEM'
  | 'ITEM_FORBIDDEN'
  | 'INVALID_REALM_RANGE'
  | 'INVALID_DATE'
  | 'INVALID_DAYS_RANGE';

/**
 * Forbidden item keys (subset cùng với admin-control-center forbidden
 * list — endgame artifacts không được mint qua gift).
 */
export const SYSTEM_GIFT_FORBIDDEN_ITEM_KEYS: ReadonlySet<string> = new Set([
  'hau_tho_tran_hon_an',
  'ban_nguyen_chi_bao',
  'hu_khong_chi_bao',
  'tien_huyen_kiem',
  'tien_huyen_giap',
  'than_dan',
]);

function isFiniteDate(v: string): boolean {
  const t = Date.parse(v);
  return Number.isFinite(t);
}

export function validateSystemGiftDef(
  def: SystemGiftDef,
): SystemGiftErrorCode | null {
  if (
    !def.giftKey ||
    def.giftKey.length === 0 ||
    def.giftKey.length > SYSTEM_GIFT_LIMITS.GIFT_KEY_MAX
  ) {
    return 'INVALID_GIFT_KEY';
  }
  if (!/^[a-z0-9_]+$/.test(def.giftKey)) return 'INVALID_GIFT_KEY';
  if (!def.title || def.title.length > SYSTEM_GIFT_LIMITS.TITLE_MAX) {
    return 'INVALID_TITLE';
  }
  if (!def.body || def.body.length > SYSTEM_GIFT_LIMITS.BODY_MAX) {
    return 'INVALID_BODY';
  }

  // Reward validation
  const lt = (() => {
    try {
      return BigInt(def.reward.linhThach);
    } catch {
      return null;
    }
  })();
  if (lt === null || lt < 0n) return 'INVALID_REWARD';
  if (lt > SYSTEM_GIFT_LIMITS.MAX_LINH_THACH_PER_GIFT) return 'LINH_THACH_CAP';
  if (def.reward.tienNgoc < 0) return 'INVALID_REWARD';
  if (def.reward.tienNgoc > SYSTEM_GIFT_LIMITS.MAX_TIEN_NGOC_PER_GIFT) {
    return 'TIEN_NGOC_CAP';
  }
  const ex = (() => {
    try {
      return BigInt(def.reward.exp);
    } catch {
      return null;
    }
  })();
  if (ex === null || ex < 0n) return 'INVALID_REWARD';
  if (ex > SYSTEM_GIFT_LIMITS.MAX_EXP_PER_GIFT) return 'EXP_CAP';
  if (def.reward.items.length > SYSTEM_GIFT_LIMITS.MAX_ITEMS_PER_GIFT) {
    return 'ITEM_ENTRIES_CAP';
  }
  for (const it of def.reward.items) {
    if (!it.itemKey || it.qty <= 0) return 'INVALID_ITEM';
    if (SYSTEM_GIFT_FORBIDDEN_ITEM_KEYS.has(it.itemKey)) return 'ITEM_FORBIDDEN';
  }

  // Target rule validation
  const rule = def.targetRule;
  if (!isSystemGiftTargetRuleType(rule.type)) return 'INVALID_TARGET_RULE';
  switch (rule.type) {
    case 'REALM_RANGE': {
      const lo = rule.realmTierMin;
      const hi = rule.realmTierMax;
      if (lo === undefined || hi === undefined) return 'INVALID_REALM_RANGE';
      if (
        lo < SYSTEM_GIFT_LIMITS.REALM_TIER_MIN ||
        hi > SYSTEM_GIFT_LIMITS.REALM_TIER_MAX ||
        lo > hi
      ) {
        return 'INVALID_REALM_RANGE';
      }
      break;
    }
    case 'CREATED_BEFORE': {
      if (!rule.createdBefore || !isFiniteDate(rule.createdBefore)) {
        return 'INVALID_DATE';
      }
      break;
    }
    case 'ACTIVE_IN_LAST_DAYS': {
      const d = rule.activeInLastDays;
      if (
        d === undefined ||
        !Number.isFinite(d) ||
        d < SYSTEM_GIFT_LIMITS.ACTIVE_IN_LAST_DAYS_MIN ||
        d > SYSTEM_GIFT_LIMITS.ACTIVE_IN_LAST_DAYS_MAX
      ) {
        return 'INVALID_DAYS_RANGE';
      }
      break;
    }
    case 'SECT_MEMBERS': {
      if (!rule.sectId || rule.sectId.length === 0) return 'INVALID_TARGET_RULE';
      break;
    }
    case 'EVENT_PARTICIPANTS': {
      if (!rule.eventDefId || rule.eventDefId.length === 0) return 'INVALID_TARGET_RULE';
      break;
    }
    case 'ALL_PLAYERS':
    default:
      break;
  }

  if (def.expiresAt !== null && !isFiniteDate(def.expiresAt)) {
    return 'INVALID_DATE';
  }
  return null;
}
