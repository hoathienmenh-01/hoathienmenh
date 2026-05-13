/**
 * Phase 31.0 — Admin Mail / Announcement audit shape.
 *
 * Tách khỏi `mail.ts` để giữ shared/mail-types là pure enum/derivation
 * và mail logic Admin (audit, preview, bulk targeting) gom 1 chỗ.
 *
 * Server-authoritative:
 *   - Admin payload validator chạy ở `AdminMailService` trước khi
 *     persist Mail row.
 *   - Audit log row được tạo cùng tx → đảm bảo "không có mail admin
 *     nào không có audit".
 */

import type { MailType } from './mail-types';
import type { SystemGiftTargetRule } from './system-gift';

export const ADMIN_MAIL_KINDS = ['SEND_ONE', 'SEND_BULK', 'SEND_GLOBAL'] as const;
export type AdminMailKind = (typeof ADMIN_MAIL_KINDS)[number];

export function isAdminMailKind(v: unknown): v is AdminMailKind {
  return typeof v === 'string' && (ADMIN_MAIL_KINDS as readonly string[]).includes(v);
}

export interface AdminMailRewardItem {
  itemKey: string;
  qty: number;
}

export interface AdminMailReward {
  /** BigInt string. */
  linhThach: string;
  /** Tiên ngọc — admin KHÔNG được mint TN trong Phase 31 (cap 0). */
  tienNgoc: number;
  /** BigInt string. */
  exp: string;
  items: AdminMailRewardItem[];
}

export interface AdminMailBaseInput {
  mailType: MailType;
  subject: string;
  body: string;
  senderName?: string;
  reward: AdminMailReward;
  /** ISO datetime hoặc null. */
  expiresAt: string | null;
  /** Lý do gửi (audit) — REQUIRED, ≥ 4 chars. */
  reason: string;
}

export interface AdminMailSendOneInput extends AdminMailBaseInput {
  kind: 'SEND_ONE';
  recipientCharacterId: string;
}

export interface AdminMailSendBulkInput extends AdminMailBaseInput {
  kind: 'SEND_BULK';
  recipientCharacterIds: string[];
}

export interface AdminMailSendGlobalInput extends AdminMailBaseInput {
  kind: 'SEND_GLOBAL';
  /** Target rule (chia sẻ với SystemGift). */
  targetRule: SystemGiftTargetRule;
  /**
   * Dry-run preview only — không persist mail, chỉ trả về `targetCount`.
   */
  previewOnly?: boolean;
}

export type AdminMailSendInput =
  | AdminMailSendOneInput
  | AdminMailSendBulkInput
  | AdminMailSendGlobalInput;

export const ADMIN_MAIL_LIMITS = {
  SUBJECT_MAX: 120,
  BODY_MAX: 2000,
  REASON_MIN: 4,
  REASON_MAX: 200,
  MAX_ITEMS_PER_MAIL: 10,
  /** Max recipient ids cho SEND_BULK 1 request. */
  MAX_BULK_RECIPIENTS: 500,
  /** Cap linh thạch / 1 admin mail. */
  MAX_LINH_THACH_PER_MAIL: 10_000_000n,
  /** Cap tiên ngọc / 1 admin mail (Phase 31 = 0 — admin KHÔNG mint TN). */
  MAX_TIEN_NGOC_PER_MAIL: 0,
  /** Cap exp / 1 admin mail. */
  MAX_EXP_PER_MAIL: 100_000_000n,
} as const;

export const ADMIN_MAIL_FORBIDDEN_ITEM_KEYS: ReadonlySet<string> = new Set([
  'hau_tho_tran_hon_an',
  'ban_nguyen_chi_bao',
  'hu_khong_chi_bao',
  'tien_huyen_kiem',
  'tien_huyen_giap',
  'than_dan',
]);

export type AdminMailErrorCode =
  | 'INVALID_INPUT'
  | 'INVALID_SUBJECT'
  | 'INVALID_BODY'
  | 'INVALID_REASON'
  | 'INVALID_REWARD'
  | 'LINH_THACH_CAP'
  | 'TIEN_NGOC_CAP'
  | 'EXP_CAP'
  | 'ITEM_ENTRIES_CAP'
  | 'INVALID_ITEM'
  | 'ITEM_FORBIDDEN'
  | 'BULK_LIMIT_EXCEEDED'
  | 'INVALID_TARGET_RULE'
  | 'INVALID_DATE'
  | 'INVALID_RECIPIENT';

function isFiniteDate(v: string | null): boolean {
  if (v === null) return true;
  const t = Date.parse(v);
  return Number.isFinite(t);
}

export function validateAdminMailReward(
  reward: AdminMailReward,
): AdminMailErrorCode | null {
  const lt = (() => {
    try {
      return BigInt(reward.linhThach);
    } catch {
      return null;
    }
  })();
  if (lt === null || lt < 0n) return 'INVALID_REWARD';
  if (lt > ADMIN_MAIL_LIMITS.MAX_LINH_THACH_PER_MAIL) return 'LINH_THACH_CAP';

  if (reward.tienNgoc < 0) return 'INVALID_REWARD';
  if (reward.tienNgoc > ADMIN_MAIL_LIMITS.MAX_TIEN_NGOC_PER_MAIL) {
    return 'TIEN_NGOC_CAP';
  }

  const ex = (() => {
    try {
      return BigInt(reward.exp);
    } catch {
      return null;
    }
  })();
  if (ex === null || ex < 0n) return 'INVALID_REWARD';
  if (ex > ADMIN_MAIL_LIMITS.MAX_EXP_PER_MAIL) return 'EXP_CAP';

  if (reward.items.length > ADMIN_MAIL_LIMITS.MAX_ITEMS_PER_MAIL) {
    return 'ITEM_ENTRIES_CAP';
  }
  for (const it of reward.items) {
    if (!it.itemKey || it.qty <= 0) return 'INVALID_ITEM';
    if (ADMIN_MAIL_FORBIDDEN_ITEM_KEYS.has(it.itemKey)) return 'ITEM_FORBIDDEN';
  }
  return null;
}

export function validateAdminMailBase(
  input: AdminMailBaseInput,
): AdminMailErrorCode | null {
  if (!input.subject || input.subject.length > ADMIN_MAIL_LIMITS.SUBJECT_MAX) {
    return 'INVALID_SUBJECT';
  }
  if (!input.body || input.body.length > ADMIN_MAIL_LIMITS.BODY_MAX) {
    return 'INVALID_BODY';
  }
  if (
    !input.reason ||
    input.reason.length < ADMIN_MAIL_LIMITS.REASON_MIN ||
    input.reason.length > ADMIN_MAIL_LIMITS.REASON_MAX
  ) {
    return 'INVALID_REASON';
  }
  if (!isFiniteDate(input.expiresAt)) return 'INVALID_DATE';
  return validateAdminMailReward(input.reward);
}

export function validateAdminMailSendInput(
  input: AdminMailSendInput,
): AdminMailErrorCode | null {
  const base = validateAdminMailBase(input);
  if (base) return base;
  switch (input.kind) {
    case 'SEND_ONE':
      if (
        !input.recipientCharacterId ||
        input.recipientCharacterId.length === 0
      ) {
        return 'INVALID_RECIPIENT';
      }
      return null;
    case 'SEND_BULK': {
      if (
        !Array.isArray(input.recipientCharacterIds) ||
        input.recipientCharacterIds.length === 0
      ) {
        return 'INVALID_RECIPIENT';
      }
      if (
        input.recipientCharacterIds.length >
        ADMIN_MAIL_LIMITS.MAX_BULK_RECIPIENTS
      ) {
        return 'BULK_LIMIT_EXCEEDED';
      }
      for (const id of input.recipientCharacterIds) {
        if (!id || typeof id !== 'string') return 'INVALID_RECIPIENT';
      }
      return null;
    }
    case 'SEND_GLOBAL':
      if (!input.targetRule || !input.targetRule.type) {
        return 'INVALID_TARGET_RULE';
      }
      return null;
    default:
      return 'INVALID_INPUT';
  }
}

export interface AdminMailLogRow {
  id: string;
  adminUserId: string;
  kind: AdminMailKind;
  mailType: MailType;
  subject: string;
  reason: string;
  /** Số mail thực sự đã tạo. Với preview = 0. */
  mailCount: number;
  /** Recipient list snapshot (truncate cho SEND_BULK lớn). */
  recipientsSnapshot: string[];
  /** Target rule snapshot (SEND_GLOBAL). */
  targetRuleSnapshot: SystemGiftTargetRule | null;
  /** ISO datetime. */
  createdAt: string;
}
