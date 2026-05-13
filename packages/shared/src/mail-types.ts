/**
 * Phase 31.0 — Mail Type taxonomy.
 *
 * Shared catalog tách `MailType` (lý do gửi) khỏi `Mail` row hiện có
 * (Phase 12). `Mail.mailType` là cột additive trên DB; mọi mail cũ
 * sẽ mặc định map sang `SYSTEM` qua migration.
 *
 * Server-authoritative: client KHÔNG được tự pick `mailType` —
 * sender service tự gán (vd `AdminMailService` → ADMIN, `ReturnerService`
 * → RETURNER). Validator chỉ dùng cho admin form chọn template title.
 */

export const MAIL_TYPES = [
  'SYSTEM',
  'ADMIN',
  'REWARD',
  'EVENT',
  'MAINTENANCE',
  'PURCHASE',
  'SECT',
  'FRIEND',
  'RETURNER',
  /**
   * Reserved for Phase 29 (PvP / Arena / Sect War / Territory) — KHÔNG
   * write trong Phase 31. Phase 29 có thể chèn mail với type này mà
   * không cần migration tiếp theo.
   */
  'PVP',
] as const;
export type MailType = (typeof MAIL_TYPES)[number];

export function isMailType(v: unknown): v is MailType {
  return typeof v === 'string' && (MAIL_TYPES as readonly string[]).includes(v);
}

/**
 * Mặc định mail type khi caller không truyền vào (compat với mail cũ
 * không có cột `mailType`).
 */
export const DEFAULT_MAIL_TYPE: MailType = 'SYSTEM';

/**
 * Bảng map MailType → human-readable label key (i18n). FE phải
 * register tương ứng trong `i18n/vi.json` + `en.json`.
 */
export function mailTypeLabelKey(type: MailType): string {
  return `mail.type.${type}`;
}

/**
 * Mail status enum (per Phase 31 prompt). Server không lưu cột riêng
 * — `status` là **derived** từ:
 *   - `UNREAD`  ← `readAt === null`
 *   - `READ`    ← `readAt !== null && claimedAt === null` (chỉ áp dụng nếu có reward)
 *   - `CLAIMED` ← `claimedAt !== null`
 *   - `EXPIRED` ← `expiresAt !== null && expiresAt <= now`
 *   - `DELETED` ← row đã prune (không trả về client) — nội bộ
 *
 * Helper `deriveMailStatus` để FE/test verify deterministic.
 */
export const MAIL_STATUSES = [
  'UNREAD',
  'READ',
  'CLAIMED',
  'EXPIRED',
  'DELETED',
] as const;
export type MailStatus = (typeof MAIL_STATUSES)[number];

export interface DeriveMailStatusInput {
  readAt: string | null;
  claimedAt: string | null;
  expiresAt: string | null;
  /** ISO string of "now" — caller cấp để test deterministic. */
  now: string;
  /** Server-side flag — có reward thì mới có trạng thái CLAIMED tự nhiên. */
  hasReward: boolean;
  /** Optional: row đã được soft-deleted bởi user (Phase 31). */
  deletedAt?: string | null;
}

export function deriveMailStatus(input: DeriveMailStatusInput): MailStatus {
  if (input.deletedAt) return 'DELETED';
  if (input.claimedAt) return 'CLAIMED';
  const now = Date.parse(input.now);
  if (input.expiresAt) {
    const exp = Date.parse(input.expiresAt);
    if (Number.isFinite(exp) && exp <= now) {
      // Nếu hết hạn nhưng chưa claim & có reward → EXPIRED (user vẫn
      // có thể xem nội dung nhưng KHÔNG claim được nữa).
      // Nếu không có reward → vẫn EXPIRED về mặt UX.
      return 'EXPIRED';
    }
  }
  if (input.readAt) return 'READ';
  return 'UNREAD';
}

/**
 * Có thể claim hay không. Server-authoritative: re-check trong tx.
 * FE chỉ dùng để render disabled state.
 */
export function isMailClaimable(input: DeriveMailStatusInput): boolean {
  if (!input.hasReward) return false;
  if (input.deletedAt) return false;
  if (input.claimedAt) return false;
  const now = Date.parse(input.now);
  if (input.expiresAt) {
    const exp = Date.parse(input.expiresAt);
    if (Number.isFinite(exp) && exp <= now) return false;
  }
  return true;
}
