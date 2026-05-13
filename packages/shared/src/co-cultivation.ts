/**
 * Phase 35.1 — Co-Cultivation / Hợp Luyện shared catalog + DTO.
 *
 * Server-authoritative. Client KHÔNG được tự tính bonus EXP — chỉ
 * dùng các hằng số ở đây để render UI (cap, percent text).
 */

import { CULTIVATION_TICK_BASE_EXP, CULTIVATION_TICK_MS } from './ws-events';

/**
 * Trạng thái lifecycle của 1 phiên hợp luyện.
 *
 * `PENDING` → `ACTIVE` (partner accept) → `COMPLETED` (initiator
 * complete) hoặc → `CANCELLED` / `EXPIRED`.
 */
export const CO_CULTIVATION_STATUSES = [
  'PENDING',
  'ACTIVE',
  'COMPLETED',
  'CANCELLED',
  'EXPIRED',
] as const;
export type CoCultivationStatus = (typeof CO_CULTIVATION_STATUSES)[number];

export function isCoCultivationStatus(v: unknown): v is CoCultivationStatus {
  return (
    typeof v === 'string' &&
    (CO_CULTIVATION_STATUSES as readonly string[]).includes(v)
  );
}

/**
 * Cap + balance dial. Server-authoritative — không nhận từ client.
 *
 * `BUFF_PERCENT_MIN`/`MAX`: vùng buff cho phép (clamp ở service).
 * `DAILY_SESSIONS_CAP`: số session hoàn thành tối đa / ngày / user.
 * `DAILY_BUFF_SECONDS_CAP`: tổng durationSec đã hoàn thành tối đa / ngày.
 * `MIN_DURATION_SEC` / `MAX_DURATION_SEC`: cap thời lượng 1 phiên.
 * `DEFAULT_DURATION_SEC`: thời lượng mặc định khi initiator không
 * truyền (FE hiện tại luôn dùng default).
 * `COMPLETE_COOLDOWN_SEC`: cooldown giữa 2 phiên COMPLETED liên tiếp
 * của cùng 1 user → chống loop spam claim.
 * `PENDING_EXPIRES_SEC`: hạn chờ accept trước khi tự EXPIRED.
 */
export const CO_CULTIVATION_LIMITS = {
  BUFF_PERCENT_MIN: 1,
  BUFF_PERCENT_MAX: 5,
  BUFF_PERCENT_DEFAULT: 3,
  DAILY_SESSIONS_CAP: 3,
  DAILY_BUFF_SECONDS_CAP: 1800,
  MIN_DURATION_SEC: 60,
  MAX_DURATION_SEC: 1800,
  DEFAULT_DURATION_SEC: 600,
  COMPLETE_COOLDOWN_SEC: 60,
  PENDING_EXPIRES_SEC: 120,
  HISTORY_LIMIT_MAX: 50,
} as const;

export type CoCultivationErrorCode =
  | 'NOT_FOUND'
  | 'NOT_AUTHORIZED'
  | 'SELF_NOT_ALLOWED'
  | 'NOT_FRIEND'
  | 'BLOCKED'
  | 'INVALID_INPUT'
  | 'INVALID_TRANSITION'
  | 'PARTNER_OFFLINE'
  | 'ALREADY_ACTIVE'
  | 'DAILY_CAP_REACHED'
  | 'BUFF_BUDGET_EXCEEDED'
  | 'COOLDOWN_ACTIVE'
  | 'NO_CHARACTER';

/**
 * Tính bonus EXP cho 1 phiên hợp luyện COMPLETED dựa trên duration +
 * buff percent. Server-authoritative — pure function để test
 * deterministic không cần Prisma.
 *
 * Formula:
 *   baseExpPerTick = CULTIVATION_TICK_BASE_EXP (5 EXP / tick)
 *   tickSec = CULTIVATION_TICK_MS / 1000 (30s)
 *   ticks = floor(durationSec / tickSec)
 *   bonusExp = round(baseExpPerTick × buffPercent/100 × ticks)
 *
 * Tránh overflow: dùng số nguyên Math.round. Bonus thực tế nhỏ
 * (e.g. 600s × 3% × 5/tick / 30s = 3 EXP) — KHÔNG dual-farm vô hạn
 * vì share budget `CULTIVATION` reward cap với regular tick.
 */
export function computeCoCultivationBonusExp(
  durationSec: number,
  buffPercent: number,
): number {
  const tickSec = CULTIVATION_TICK_MS / 1000;
  const ticks = Math.floor(Math.max(0, durationSec) / tickSec);
  const pct = clampBuffPercent(buffPercent);
  const bonus = Math.round((CULTIVATION_TICK_BASE_EXP * pct * ticks) / 100);
  return Math.max(0, bonus);
}

export function clampBuffPercent(p: number): number {
  const v = Math.floor(p);
  if (!Number.isFinite(v)) return CO_CULTIVATION_LIMITS.BUFF_PERCENT_DEFAULT;
  return Math.min(
    CO_CULTIVATION_LIMITS.BUFF_PERCENT_MAX,
    Math.max(CO_CULTIVATION_LIMITS.BUFF_PERCENT_MIN, v),
  );
}

export function clampDurationSec(d: number): number {
  const v = Math.floor(d);
  if (!Number.isFinite(v))
    return CO_CULTIVATION_LIMITS.DEFAULT_DURATION_SEC;
  return Math.min(
    CO_CULTIVATION_LIMITS.MAX_DURATION_SEC,
    Math.max(CO_CULTIVATION_LIMITS.MIN_DURATION_SEC, v),
  );
}

export interface CoCultivationSessionRow {
  id: string;
  initiatorUserId: string;
  partnerUserId: string;
  initiatorCharacterId: string;
  partnerCharacterId: string;
  status: CoCultivationStatus;
  durationSec: number;
  buffPercent: number;
  startedAt: string | null;
  completedAt: string | null;
  expiresAt: string | null;
  rewardApplied: boolean;
  /** EXP bonus TỔNG (cả 2 user). Stringify để safe cho BigInt. */
  bonusExpGranted: string;
  createdAt: string;
}

export interface CoCultivationDailyUsageRow {
  userId: string;
  dateKey: string;
  sessionsCompleted: number;
  totalBuffSeconds: number;
  /** EXP bonus tổng đã nhận hôm nay (audit). Stringify để safe BigInt. */
  totalBonusExp: string;
  /** Cap còn lại theo session (DAILY_SESSIONS_CAP - sessionsCompleted). */
  remainingSessions: number;
  /** Cap còn lại theo buffSeconds (DAILY_BUFF_SECONDS_CAP - totalBuffSeconds). */
  remainingBuffSeconds: number;
}

export interface CoCultivationStatusResponse {
  /** Phiên đang PENDING hoặc ACTIVE (cao nhất 1 cái). */
  active: CoCultivationSessionRow | null;
  /** Usage hôm nay. */
  today: CoCultivationDailyUsageRow;
}

export interface CoCultivationHistoryResponse {
  sessions: readonly CoCultivationSessionRow[];
  hasMore: boolean;
}

/**
 * Sanitize input partnerUserId (length ≤ 64, non-empty, không space).
 * Trả về null nếu invalid.
 */
export function sanitizePartnerUserId(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (trimmed.length === 0 || trimmed.length > 64) return null;
  if (/\s/.test(trimmed)) return null;
  return trimmed;
}
