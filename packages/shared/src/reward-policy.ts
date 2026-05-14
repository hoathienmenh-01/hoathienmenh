/**
 * Phase 44.0 — Reward Policy V1 (Economy Integrity & Reward Safety).
 *
 * Pure module: constants + deterministic helpers. KHÔNG runtime / DB I/O.
 *
 * Mục tiêu (xem docs/REWARD_POLICY.md):
 *   - Centralize **caps** cho mọi reward grant path (admin grant, mail,
 *     broadcast, drop, event).
 *   - Provide pure validators (`validateRewardShape`,
 *     `assertAdminGrantWithinPolicy`, ...) cho audit script + future
 *     runtime hardening.
 *   - Tag **endgame items** để audit script flag bất thường khi grant
 *     từ admin / mail / event.
 *
 * KHÔNG mutate behavior runtime hiện tại — Phase 44.0 V1 chỉ thêm
 * shared constants + audit checks. Phase 44.1+ có thể wire validator
 * vào MailService / AdminService / EventBuilder để enforce.
 */

/* eslint-disable @typescript-eslint/no-magic-numbers -- policy constants. */

// ─── Admin grant caps (mirror apps/api/src/modules/admin/admin.service.ts) ──
// Source of truth là admin.service.ts; ở đây chỉ tái xuất dưới dạng
// shared constant để CLI integrity script + admin UI có thể đọc 1 chỗ.

/** Cap | Δ | per `admin.grant` linhThach call. Phase 44.0 = 1 tỷ. */
export const MAX_ADMIN_GRANT_LINH_THACH = 1_000_000_000n;
/** Cap | Δ | per `admin.grant` tienNgoc call. Phase 44.0 = 1 triệu. */
export const MAX_ADMIN_GRANT_TIEN_NGOC = 1_000_000;
/** Cap | Δ | per `admin.grantExp` call. Phase 44.0 = 10^18. */
export const MAX_ADMIN_GRANT_EXP = 10n ** 18n;
/** Cap qty per `admin.grantItem` call. Mirror MAX_REVOKE_QTY. */
export const MAX_ADMIN_GRANT_ITEM_QTY = 999;

// ─── Broadcast / global gift caps (Phase 44.0 — tighter than admin grant) ──
// Broadcast = gửi cho TẤT CẢ character. Phải nhỏ hơn admin grant cá nhân
// để 1 admin compromised KHÔNG mint linh thạch / tiên ngọc / item endgame
// ra cả server trong 1 lệnh.

/** Cap linh thạch / broadcast row. Phase 44.0 = 10 triệu. */
export const MAX_BROADCAST_LINH_THACH = 10_000_000n;
/** Cap tiên ngọc / broadcast row. Phase 44.0 = 10k. */
export const MAX_BROADCAST_TIEN_NGOC = 10_000;
/** Cap exp / broadcast row. Phase 44.0 = 10^15 (đủ buffer mọi cảnh giới). */
export const MAX_BROADCAST_EXP = 10n ** 15n;
/** Cap số item rows mỗi broadcast mail. Mirror MAX_ITEMS_PER_MAIL. */
export const MAX_BROADCAST_ITEM_ROWS = 10;
/** Cap qty per item row trong broadcast. */
export const MAX_BROADCAST_ITEM_QTY = 99;

// ─── Mail reward caps (single-recipient mail) ─────────────────────────────

/** Cap linh thạch / single-recipient mail. */
export const MAX_MAIL_LINH_THACH = 100_000_000n;
/** Cap tiên ngọc / single-recipient mail. */
export const MAX_MAIL_TIEN_NGOC = 100_000;
/** Cap exp / single-recipient mail. */
export const MAX_MAIL_EXP = 10n ** 16n;
/** Cap số item rows / single-recipient mail. */
export const MAX_MAIL_ITEM_ROWS = 10;
/** Cap qty per item row trong mail. */
export const MAX_MAIL_ITEM_QTY = 999;

// ─── Reason policy ────────────────────────────────────────────────────────

/** Min length cho `reason` field khi admin grant / revoke. Empty = audit flag. */
export const MIN_REASON_LENGTH = 3;
/** Max length cho `reason` field. Mirror admin controller zod (200). */
export const MAX_REASON_LENGTH = 200;

// ─── Endgame item tagging ─────────────────────────────────────────────────
//
// Items được coi là "endgame" — KHÔNG nên drop từ admin gift / event /
// quest reward trừ khi có policy override. Audit script flag bất kỳ
// grant nào của các item key này từ source !== MARKET / CRAFT.
//
// Format: itemKey prefix hoặc exact match. Giữ list khiêm tốn — chỉ
// item có rarity LEGENDARY+ hoặc unique flag.

/** Prefix item key được coi là endgame (high-tier). */
export const ENDGAME_ITEM_KEY_PREFIXES: ReadonlyArray<string> = [
  'endgame_',
  'mythic_',
  'sacred_',
  'tien_khi_', // Tiên khí — endgame artifact tier
  'than_khi_', // Thần khí — endgame artifact tier
];

/** Exact-match item keys được coi là endgame (Phase 44.0 V1 — extend khi cần). */
export const ENDGAME_ITEM_KEYS: ReadonlyArray<string> = [
  // Phase 44.0 placeholder — sẽ extend khi catalog tag rõ endgame items.
];

/**
 * Trả về true nếu itemKey là endgame item — KHÔNG nên grant tự do qua
 * admin / mail / event reward path.
 *
 * Lý do: endgame item cần tier-balanced drop / craft path, KHÔNG nên
 * mint từ admin gift bừa bãi (vi phạm reward policy).
 */
export function isEndgameItemKey(itemKey: string): boolean {
  if (!itemKey) return false;
  if (ENDGAME_ITEM_KEYS.includes(itemKey)) return true;
  for (const prefix of ENDGAME_ITEM_KEY_PREFIXES) {
    if (itemKey.startsWith(prefix)) return true;
  }
  return false;
}

// ─── Reward shape validation ──────────────────────────────────────────────

export interface RewardItemShape {
  itemKey: string;
  qty: number;
}

export interface RewardShape {
  linhThach?: bigint;
  tienNgoc?: number;
  /** Premium locked, sub-set của tienNgoc. */
  tienNgocKhoa?: number;
  exp?: bigint;
  items?: ReadonlyArray<RewardItemShape>;
}

export type RewardContext =
  | 'ADMIN_GRANT'
  | 'ADMIN_GRANT_ITEM'
  | 'ADMIN_GRANT_EXP'
  | 'BROADCAST'
  | 'MAIL'
  | 'EVENT_REWARD'
  | 'GIFTCODE'
  | 'SYSTEM_GIFT';

export interface PolicyViolation {
  /** Stable code for filter + i18n. */
  code:
    | 'LINH_THACH_OVER_CAP'
    | 'TIEN_NGOC_OVER_CAP'
    | 'EXP_OVER_CAP'
    | 'ITEM_ROWS_OVER_CAP'
    | 'ITEM_QTY_OVER_CAP'
    | 'ITEM_QTY_NEGATIVE_OR_ZERO'
    | 'LINH_THACH_NEGATIVE'
    | 'TIEN_NGOC_NEGATIVE'
    | 'EXP_NEGATIVE'
    | 'ENDGAME_ITEM_NOT_ALLOWED'
    | 'REASON_EMPTY'
    | 'REASON_TOO_SHORT'
    | 'REASON_TOO_LONG';
  /** Human-readable summary. */
  message: string;
  /** Optional field detail (itemKey / reason text). */
  detail?: string;
}

interface RewardLimits {
  linhThach: bigint;
  tienNgoc: number;
  exp: bigint;
  itemRows: number;
  itemQty: number;
}

const RAW_LIMITS: Record<RewardContext, RewardLimits> = {
  ADMIN_GRANT: {
    linhThach: MAX_ADMIN_GRANT_LINH_THACH,
    tienNgoc: MAX_ADMIN_GRANT_TIEN_NGOC,
    exp: MAX_ADMIN_GRANT_EXP,
    itemRows: 1,
    itemQty: MAX_ADMIN_GRANT_ITEM_QTY,
  },
  ADMIN_GRANT_ITEM: {
    linhThach: 0n,
    tienNgoc: 0,
    exp: 0n,
    itemRows: 1,
    itemQty: MAX_ADMIN_GRANT_ITEM_QTY,
  },
  ADMIN_GRANT_EXP: {
    linhThach: 0n,
    tienNgoc: 0,
    exp: MAX_ADMIN_GRANT_EXP,
    itemRows: 0,
    itemQty: 0,
  },
  BROADCAST: {
    linhThach: MAX_BROADCAST_LINH_THACH,
    tienNgoc: MAX_BROADCAST_TIEN_NGOC,
    exp: MAX_BROADCAST_EXP,
    itemRows: MAX_BROADCAST_ITEM_ROWS,
    itemQty: MAX_BROADCAST_ITEM_QTY,
  },
  MAIL: {
    linhThach: MAX_MAIL_LINH_THACH,
    tienNgoc: MAX_MAIL_TIEN_NGOC,
    exp: MAX_MAIL_EXP,
    itemRows: MAX_MAIL_ITEM_ROWS,
    itemQty: MAX_MAIL_ITEM_QTY,
  },
  EVENT_REWARD: {
    linhThach: MAX_MAIL_LINH_THACH,
    tienNgoc: MAX_MAIL_TIEN_NGOC,
    exp: MAX_MAIL_EXP,
    itemRows: MAX_MAIL_ITEM_ROWS,
    itemQty: MAX_MAIL_ITEM_QTY,
  },
  GIFTCODE: {
    linhThach: MAX_MAIL_LINH_THACH,
    tienNgoc: MAX_MAIL_TIEN_NGOC,
    exp: MAX_MAIL_EXP,
    itemRows: MAX_MAIL_ITEM_ROWS,
    itemQty: MAX_MAIL_ITEM_QTY,
  },
  SYSTEM_GIFT: {
    linhThach: MAX_BROADCAST_LINH_THACH,
    tienNgoc: MAX_BROADCAST_TIEN_NGOC,
    exp: MAX_BROADCAST_EXP,
    itemRows: MAX_BROADCAST_ITEM_ROWS,
    itemQty: MAX_BROADCAST_ITEM_QTY,
  },
};

/**
 * Trả về cap effective cho context. Public để admin UI / docs có thể
 * surface giá trị (frozen).
 */
export function getRewardLimits(context: RewardContext): Readonly<RewardLimits> {
  return RAW_LIMITS[context];
}

/**
 * Pure validator. Trả về list violation, KHÔNG throw. Empty = clean.
 *
 * Cho phép caller (CLI audit, admin UI) collect tất cả vi phạm 1 lần
 * thay vì throw early. Runtime enforcement (Phase 44.1+) sẽ wrap function
 * này và throw nếu list non-empty.
 *
 * Lưu ý: validator KHÔNG kiểm tra item key có tồn tại trong catalog —
 * caller phải tự validate (vd `InventoryService.grantTx` đã skip itemKey
 * không có trong catalog).
 */
export function validateRewardShape(
  reward: RewardShape,
  context: RewardContext,
  opts?: {
    /** Allow endgame items trong reward (default false). Set true khi
     *  caller có policy override hợp lệ (vd crafted via market). */
    allowEndgameItems?: boolean;
  },
): ReadonlyArray<PolicyViolation> {
  const v: PolicyViolation[] = [];
  const limits = RAW_LIMITS[context];
  const allowEndgame = opts?.allowEndgameItems ?? false;

  if (reward.linhThach !== undefined) {
    if (reward.linhThach < 0n) {
      v.push({
        code: 'LINH_THACH_NEGATIVE',
        message: `linhThach < 0 (${reward.linhThach.toString()})`,
      });
    } else if (reward.linhThach > limits.linhThach) {
      v.push({
        code: 'LINH_THACH_OVER_CAP',
        message: `linhThach=${reward.linhThach.toString()} vượt cap context=${context} (max=${limits.linhThach.toString()})`,
      });
    }
  }

  if (reward.tienNgoc !== undefined) {
    if (reward.tienNgoc < 0) {
      v.push({
        code: 'TIEN_NGOC_NEGATIVE',
        message: `tienNgoc < 0 (${reward.tienNgoc})`,
      });
    } else if (reward.tienNgoc > limits.tienNgoc) {
      v.push({
        code: 'TIEN_NGOC_OVER_CAP',
        message: `tienNgoc=${reward.tienNgoc} vượt cap context=${context} (max=${limits.tienNgoc})`,
      });
    }
  }

  if (reward.tienNgocKhoa !== undefined) {
    if (reward.tienNgocKhoa < 0) {
      v.push({
        code: 'TIEN_NGOC_NEGATIVE',
        message: `tienNgocKhoa < 0 (${reward.tienNgocKhoa})`,
        detail: 'tienNgocKhoa',
      });
    } else if (reward.tienNgocKhoa > limits.tienNgoc) {
      v.push({
        code: 'TIEN_NGOC_OVER_CAP',
        message: `tienNgocKhoa=${reward.tienNgocKhoa} vượt cap context=${context} (max=${limits.tienNgoc})`,
        detail: 'tienNgocKhoa',
      });
    }
  }

  if (reward.exp !== undefined) {
    if (reward.exp < 0n) {
      v.push({
        code: 'EXP_NEGATIVE',
        message: `exp < 0 (${reward.exp.toString()})`,
      });
    } else if (reward.exp > limits.exp) {
      v.push({
        code: 'EXP_OVER_CAP',
        message: `exp=${reward.exp.toString()} vượt cap context=${context} (max=${limits.exp.toString()})`,
      });
    }
  }

  if (reward.items !== undefined) {
    if (reward.items.length > limits.itemRows) {
      v.push({
        code: 'ITEM_ROWS_OVER_CAP',
        message: `items.length=${reward.items.length} vượt cap context=${context} (max=${limits.itemRows})`,
      });
    }
    for (const it of reward.items) {
      if (!Number.isFinite(it.qty) || it.qty <= 0) {
        v.push({
          code: 'ITEM_QTY_NEGATIVE_OR_ZERO',
          message: `item ${it.itemKey} qty=${it.qty} (phải > 0)`,
          detail: it.itemKey,
        });
        continue;
      }
      if (it.qty > limits.itemQty) {
        v.push({
          code: 'ITEM_QTY_OVER_CAP',
          message: `item ${it.itemKey} qty=${it.qty} vượt cap context=${context} (max=${limits.itemQty})`,
          detail: it.itemKey,
        });
      }
      if (!allowEndgame && isEndgameItemKey(it.itemKey)) {
        v.push({
          code: 'ENDGAME_ITEM_NOT_ALLOWED',
          message: `item ${it.itemKey} là endgame item — KHÔNG được grant tự do qua ${context}`,
          detail: it.itemKey,
        });
      }
    }
  }

  return v;
}

/**
 * Validate reason text cho admin grant / revoke / system gift / mail
 * broadcast. Empty + too-short = audit flag (Phase 44.0 — KHÔNG throw,
 * chỉ log; Phase 44.1+ có thể enforce).
 */
export function validateReason(
  reason: string | null | undefined,
): ReadonlyArray<PolicyViolation> {
  const v: PolicyViolation[] = [];
  if (reason == null) {
    v.push({ code: 'REASON_EMPTY', message: 'reason missing (null/undefined)' });
    return v;
  }
  const trimmed = reason.trim();
  if (trimmed.length === 0) {
    v.push({ code: 'REASON_EMPTY', message: 'reason rỗng (empty string)' });
    return v;
  }
  if (trimmed.length < MIN_REASON_LENGTH) {
    v.push({
      code: 'REASON_TOO_SHORT',
      message: `reason='${trimmed}' quá ngắn (min=${MIN_REASON_LENGTH})`,
      detail: trimmed,
    });
  }
  if (trimmed.length > MAX_REASON_LENGTH) {
    v.push({
      code: 'REASON_TOO_LONG',
      message: `reason length=${trimmed.length} vượt cap (max=${MAX_REASON_LENGTH})`,
    });
  }
  return v;
}

/**
 * Convenience: validate **cả** reward shape + reason cho admin grant
 * context. Trả về list combined violation.
 */
export function validateAdminGrant(
  reward: RewardShape,
  reason: string | null | undefined,
  context: 'ADMIN_GRANT' | 'ADMIN_GRANT_ITEM' | 'ADMIN_GRANT_EXP' = 'ADMIN_GRANT',
  opts?: { allowEndgameItems?: boolean },
): ReadonlyArray<PolicyViolation> {
  return [
    ...validateRewardShape(reward, context, opts),
    ...validateReason(reason),
  ];
}
