/**
 * Phase 19.2 — Chat Moderation & Report System. REST client cho cả 2
 * surface:
 *
 * 1) User-facing — `POST /chat/reports` + `GET /chat/reports/mine`
 *    + `GET /chat/reports/catalog`. Gọi từ ChatReportModal + (tuỳ chọn)
 *    "my reports" history view.
 * 2) Admin — `/admin/chat/*` reports/summary/ack/resolve, mutes
 *    create/list/revoke, message hide/unhide, group lock/unlock/
 *    dissolve. Gọi từ AdminChatModerationPanel.
 *
 * Mọi response server bọc `{ ok, data, error }`. `unwrap` ném
 * `Object.assign(Error, { code })` để FE store dùng
 * `extractApiErrorCode` / `extractApiErrorCodeOrDefault`.
 */
import { apiClient } from './client';
import type {
  AdminChatModerationSummary,
  AdminChatMuteListResponse,
  AdminChatReportListResponse,
  ChatMessageReportReason,
  ChatMessageReportRow,
  ChatMessageReportStatus,
  ChatMessageReportType,
  ChatMuteRow,
  ChatMuteScope,
} from '@xuantoi/shared';

interface Envelope<T> {
  ok: boolean;
  data?: T;
  error?: { code: string; message: string };
}

function unwrap<T>(env: Envelope<T>): T {
  if (!env.ok || !env.data) {
    const err = env.error ?? { code: 'UNKNOWN', message: 'UNKNOWN' };
    throw Object.assign(new Error(err.message), { code: err.code });
  }
  return env.data;
}

// ---------------------------------------------------------------------------
// User-facing
// ---------------------------------------------------------------------------

export interface SubmitChatReportInput {
  messageType: ChatMessageReportType;
  privateMessageId?: string | null;
  groupMessageId?: string | null;
  reason: ChatMessageReportReason;
  detailsText?: string | null;
}

export async function submitChatReport(
  input: SubmitChatReportInput,
): Promise<ChatMessageReportRow> {
  const { data } = await apiClient.post<
    Envelope<{ report: ChatMessageReportRow }>
  >('/chat/reports', {
    messageType: input.messageType,
    privateMessageId: input.privateMessageId ?? null,
    groupMessageId: input.groupMessageId ?? null,
    reason: input.reason,
    detailsText: input.detailsText ?? null,
  });
  return unwrap(data).report;
}

export async function listMyChatReports(
  limit = 50,
): Promise<ChatMessageReportRow[]> {
  const { data } = await apiClient.get<
    Envelope<{ reports: ChatMessageReportRow[] }>
  >('/chat/reports/mine', { params: { limit } });
  return unwrap(data).reports;
}

export interface ChatReportCatalog {
  reasons: readonly ChatMessageReportReason[];
  types: readonly ChatMessageReportType[];
  detailsMax: number;
}

export async function getChatReportCatalog(): Promise<ChatReportCatalog> {
  const { data } = await apiClient.get<Envelope<ChatReportCatalog>>(
    '/chat/reports/catalog',
  );
  return unwrap(data);
}

// ---------------------------------------------------------------------------
// Admin: reports
// ---------------------------------------------------------------------------

export interface AdminListReportsParams {
  status?: ChatMessageReportStatus;
  reason?: ChatMessageReportReason;
  messageType?: ChatMessageReportType;
  targetUserId?: string;
  reporterUserId?: string;
  fromDate?: string;
  toDate?: string;
  limit?: number;
  offset?: number;
}

export async function adminListChatReports(
  params: AdminListReportsParams = {},
): Promise<AdminChatReportListResponse> {
  const { data } = await apiClient.get<Envelope<AdminChatReportListResponse>>(
    '/admin/chat/reports',
    { params },
  );
  return unwrap(data);
}

export async function adminChatModerationSummary(): Promise<AdminChatModerationSummary> {
  const { data } = await apiClient.get<Envelope<AdminChatModerationSummary>>(
    '/admin/chat/reports/summary',
  );
  return unwrap(data);
}

export async function adminAckChatReport(
  reportId: string,
): Promise<ChatMessageReportRow> {
  const { data } = await apiClient.post<
    Envelope<{ report: ChatMessageReportRow }>
  >(`/admin/chat/reports/${encodeURIComponent(reportId)}/ack`);
  return unwrap(data).report;
}

export async function adminResolveChatReport(
  reportId: string,
  status: 'RESOLVED' | 'REJECTED',
  note: string | null,
): Promise<ChatMessageReportRow> {
  const { data } = await apiClient.post<
    Envelope<{ report: ChatMessageReportRow }>
  >(`/admin/chat/reports/${encodeURIComponent(reportId)}/resolve`, {
    status,
    note,
  });
  return unwrap(data).report;
}

// ---------------------------------------------------------------------------
// Admin: mutes
// ---------------------------------------------------------------------------

export interface AdminListMutesParams {
  userId?: string;
  scope?: ChatMuteScope;
  activeOnly?: boolean;
  limit?: number;
  offset?: number;
}

export async function adminListChatMutes(
  params: AdminListMutesParams = {},
): Promise<AdminChatMuteListResponse> {
  const { data } = await apiClient.get<Envelope<AdminChatMuteListResponse>>(
    '/admin/chat/mutes',
    { params },
  );
  return unwrap(data);
}

export interface AdminCreateMuteInput {
  userId: string;
  scope: ChatMuteScope;
  reason: string;
  expiresAt?: string | null;
}

export async function adminCreateChatMute(
  input: AdminCreateMuteInput,
): Promise<ChatMuteRow> {
  const { data } = await apiClient.post<Envelope<{ mute: ChatMuteRow }>>(
    '/admin/chat/mutes',
    {
      userId: input.userId,
      scope: input.scope,
      reason: input.reason,
      expiresAt: input.expiresAt ?? null,
    },
  );
  return unwrap(data).mute;
}

export async function adminRevokeChatMute(
  muteId: string,
): Promise<ChatMuteRow> {
  const { data } = await apiClient.delete<Envelope<{ mute: ChatMuteRow }>>(
    `/admin/chat/mutes/${encodeURIComponent(muteId)}`,
  );
  return unwrap(data).mute;
}

// ---------------------------------------------------------------------------
// Admin: hide / unhide message
// ---------------------------------------------------------------------------

export async function adminHideChatMessage(
  messageType: ChatMessageReportType,
  messageId: string,
  reason: string | null,
): Promise<{ messageId: string; messageType: 'PRIVATE' | 'GROUP' }> {
  const { data } = await apiClient.post<
    Envelope<{ messageId: string; messageType: 'PRIVATE' | 'GROUP' }>
  >(`/admin/chat/messages/${encodeURIComponent(messageId)}/hide`, {
    messageType,
    reason,
  });
  return unwrap(data);
}

export async function adminUnhideChatMessage(
  messageType: ChatMessageReportType,
  messageId: string,
): Promise<{ messageId: string; messageType: 'PRIVATE' | 'GROUP' }> {
  const { data } = await apiClient.post<
    Envelope<{ messageId: string; messageType: 'PRIVATE' | 'GROUP' }>
  >(`/admin/chat/messages/${encodeURIComponent(messageId)}/unhide`, {
    messageType,
  });
  return unwrap(data);
}

// ---------------------------------------------------------------------------
// Admin: group lock / unlock / dissolve
// ---------------------------------------------------------------------------

export async function adminLockChatGroup(
  groupId: string,
  reason: string | null,
): Promise<{ groupId: string; lockedAt: string }> {
  const { data } = await apiClient.post<
    Envelope<{ groupId: string; lockedAt: string }>
  >(`/admin/chat/groups/${encodeURIComponent(groupId)}/lock`, { reason });
  return unwrap(data);
}

export async function adminUnlockChatGroup(
  groupId: string,
): Promise<{ groupId: string }> {
  const { data } = await apiClient.post<Envelope<{ groupId: string }>>(
    `/admin/chat/groups/${encodeURIComponent(groupId)}/unlock`,
  );
  return unwrap(data);
}

export async function adminDissolveChatGroup(
  groupId: string,
  reason: string | null,
): Promise<{ groupId: string; dissolvedAt: string }> {
  const { data } = await apiClient.post<
    Envelope<{ groupId: string; dissolvedAt: string }>
  >(`/admin/chat/groups/${encodeURIComponent(groupId)}/dissolve`, { reason });
  return unwrap(data);
}
