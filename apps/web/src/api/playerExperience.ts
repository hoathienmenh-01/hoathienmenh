/**
 * Phase 41.0 — Player Experience REST clients.
 *
 * Wraps:
 *   - GET/PATCH/POST /player/settings(/reset)
 *   - GET /player/dashboard
 *   - GET /player/navigation/entries
 *   - POST/GET /support/feedback(/my, /:id)
 *   - POST/GET /support/report-player(/my, /:id)
 *   - GET/PATCH /admin/support/feedback(/:id)
 *   - POST /admin/support/feedback/:id/resolve | /close
 *   - GET/PATCH /admin/support/reports(/:id)
 *
 * Tất cả request mang cookie session; server enforce role/owner check.
 */
import { apiClient } from './client';
import type {
  DashboardResponse,
  FeedbackListResponse,
  NavigationEntry,
  PlayerFeedbackRow,
  PlayerReportListResponse,
  PlayerReportRow,
  PlayerSettings,
  PlayerSettingsRow,
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

// ─── Player Settings ─────────────────────────────────────────────────

export async function fetchPlayerSettings(): Promise<PlayerSettingsRow> {
  const { data } = await apiClient.get<Envelope<{ settings: PlayerSettingsRow }>>(
    '/player/settings',
  );
  return unwrap(data).settings;
}

export async function patchPlayerSettings(
  patch: Partial<PlayerSettings>,
): Promise<PlayerSettingsRow> {
  const { data } = await apiClient.patch<Envelope<{ settings: PlayerSettingsRow }>>(
    '/player/settings',
    patch,
  );
  return unwrap(data).settings;
}

export async function resetPlayerSettings(): Promise<PlayerSettingsRow> {
  const { data } = await apiClient.post<Envelope<{ settings: PlayerSettingsRow }>>(
    '/player/settings/reset',
  );
  return unwrap(data).settings;
}

// ─── Dashboard ───────────────────────────────────────────────────────

export async function fetchDashboard(): Promise<DashboardResponse> {
  const { data } = await apiClient.get<Envelope<DashboardResponse>>(
    '/player/dashboard',
  );
  return unwrap(data);
}

// ─── Navigation ──────────────────────────────────────────────────────

export async function fetchNavigationEntries(
  q?: string,
): Promise<NavigationEntry[]> {
  const params: Record<string, string> = {};
  if (q && q.trim().length > 0) params.q = q.trim();
  const { data } = await apiClient.get<Envelope<{ entries: NavigationEntry[] }>>(
    '/player/navigation/entries',
    { params },
  );
  return unwrap(data).entries;
}

// ─── Feedback ────────────────────────────────────────────────────────

export interface FeedbackCreatePayload {
  type: PlayerFeedbackRow['type'];
  title: string;
  description: string;
  severity?: PlayerFeedbackRow['severity'];
  relatedFeature?: string | null;
  relatedEntityType?: string | null;
  relatedEntityId?: string | null;
  targetCharacterId?: string | null;
}

export async function createFeedback(
  payload: FeedbackCreatePayload,
): Promise<PlayerFeedbackRow> {
  const { data } = await apiClient.post<Envelope<{ feedback: PlayerFeedbackRow }>>(
    '/support/feedback',
    payload,
  );
  return unwrap(data).feedback;
}

export interface FeedbackListQuery {
  cursor?: string | null;
  limit?: number;
  status?: PlayerFeedbackRow['status'] | null;
  type?: PlayerFeedbackRow['type'] | null;
}

export async function listMyFeedback(
  q: FeedbackListQuery = {},
): Promise<FeedbackListResponse> {
  const params: Record<string, string> = {};
  if (q.cursor) params.cursor = q.cursor;
  if (q.limit) params.limit = String(q.limit);
  if (q.status) params.status = q.status;
  if (q.type) params.type = q.type;
  const { data } = await apiClient.get<Envelope<FeedbackListResponse>>(
    '/support/feedback/my',
    { params },
  );
  return unwrap(data);
}

export async function getFeedback(id: string): Promise<PlayerFeedbackRow> {
  const { data } = await apiClient.get<Envelope<{ feedback: PlayerFeedbackRow }>>(
    `/support/feedback/${id}`,
  );
  return unwrap(data).feedback;
}

export async function adminListFeedback(
  q: FeedbackListQuery = {},
): Promise<FeedbackListResponse> {
  const params: Record<string, string> = {};
  if (q.cursor) params.cursor = q.cursor;
  if (q.limit) params.limit = String(q.limit);
  if (q.status) params.status = q.status;
  if (q.type) params.type = q.type;
  const { data } = await apiClient.get<Envelope<FeedbackListResponse>>(
    '/admin/support/feedback',
    { params },
  );
  return unwrap(data);
}

export async function adminGetFeedback(id: string): Promise<PlayerFeedbackRow> {
  const { data } = await apiClient.get<Envelope<{ feedback: PlayerFeedbackRow }>>(
    `/admin/support/feedback/${id}`,
  );
  return unwrap(data).feedback;
}

export interface AdminFeedbackPatchPayload {
  status?: PlayerFeedbackRow['status'];
  severity?: PlayerFeedbackRow['severity'];
  adminNote?: string | null;
}

export async function adminPatchFeedback(
  id: string,
  patch: AdminFeedbackPatchPayload,
): Promise<PlayerFeedbackRow> {
  const { data } = await apiClient.patch<Envelope<{ feedback: PlayerFeedbackRow }>>(
    `/admin/support/feedback/${id}`,
    patch,
  );
  return unwrap(data).feedback;
}

export async function adminResolveFeedback(
  id: string,
): Promise<PlayerFeedbackRow> {
  const { data } = await apiClient.post<Envelope<{ feedback: PlayerFeedbackRow }>>(
    `/admin/support/feedback/${id}/resolve`,
  );
  return unwrap(data).feedback;
}

export async function adminCloseFeedback(
  id: string,
): Promise<PlayerFeedbackRow> {
  const { data } = await apiClient.post<Envelope<{ feedback: PlayerFeedbackRow }>>(
    `/admin/support/feedback/${id}/close`,
  );
  return unwrap(data).feedback;
}

// ─── Player Report ───────────────────────────────────────────────────

export interface PlayerReportCreatePayload {
  targetCharacterId: string;
  reportType: PlayerReportRow['reportType'];
  description: string;
  evidenceJson?: Record<string, unknown> | null;
}

export async function createPlayerReport(
  payload: PlayerReportCreatePayload,
): Promise<PlayerReportRow> {
  const { data } = await apiClient.post<Envelope<{ report: PlayerReportRow }>>(
    '/support/report-player',
    payload,
  );
  return unwrap(data).report;
}

export interface PlayerReportListQuery {
  cursor?: string | null;
  limit?: number;
  status?: PlayerReportRow['status'] | null;
}

export async function listMyReports(
  q: PlayerReportListQuery = {},
): Promise<PlayerReportListResponse> {
  const params: Record<string, string> = {};
  if (q.cursor) params.cursor = q.cursor;
  if (q.limit) params.limit = String(q.limit);
  if (q.status) params.status = q.status;
  const { data } = await apiClient.get<Envelope<PlayerReportListResponse>>(
    '/support/report-player/my',
    { params },
  );
  return unwrap(data);
}

export async function getReport(id: string): Promise<PlayerReportRow> {
  const { data } = await apiClient.get<Envelope<{ report: PlayerReportRow }>>(
    `/support/report-player/${id}`,
  );
  return unwrap(data).report;
}

export async function adminListReports(
  q: PlayerReportListQuery & { targetCharacterId?: string | null } = {},
): Promise<PlayerReportListResponse> {
  const params: Record<string, string> = {};
  if (q.cursor) params.cursor = q.cursor;
  if (q.limit) params.limit = String(q.limit);
  if (q.status) params.status = q.status;
  if (q.targetCharacterId) params.targetCharacterId = q.targetCharacterId;
  const { data } = await apiClient.get<Envelope<PlayerReportListResponse>>(
    '/admin/support/reports',
    { params },
  );
  return unwrap(data);
}

export async function adminGetReport(id: string): Promise<PlayerReportRow> {
  const { data } = await apiClient.get<Envelope<{ report: PlayerReportRow }>>(
    `/admin/support/reports/${id}`,
  );
  return unwrap(data).report;
}

export interface AdminReportPatchPayload {
  status?: PlayerReportRow['status'];
  adminNote?: string | null;
}

export async function adminPatchReport(
  id: string,
  patch: AdminReportPatchPayload,
): Promise<PlayerReportRow> {
  const { data } = await apiClient.patch<Envelope<{ report: PlayerReportRow }>>(
    `/admin/support/reports/${id}`,
    patch,
  );
  return unwrap(data).report;
}
