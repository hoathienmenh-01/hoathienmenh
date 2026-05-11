/**
 * Phase 19.3 — Notification REST client.
 *
 * Backed by `apps/api/src/modules/notification/notification.controller.ts`.
 * All requests carry the cookie session (`xt_access`); server enforces
 * own-user-only access on every route.
 *
 * Realtime mirror: server also pushes `notification:new` and
 * `notification:unread-count` over WS when the user is online; FE
 * store applies both REST and WS sources.
 */
import { apiClient } from './client';
import type {
  NotificationListResponse,
  NotificationMarkAllReadResponse,
  NotificationMarkReadResponse,
  NotificationType,
  NotificationUnreadCountResponse,
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

export interface ListNotificationsQuery {
  cursor?: string | null;
  limit?: number;
  types?: readonly NotificationType[] | null;
  unread?: boolean | null;
}

export async function listNotifications(
  q: ListNotificationsQuery = {},
): Promise<NotificationListResponse> {
  const params: Record<string, string> = {};
  if (q.cursor) params.cursor = q.cursor;
  if (q.limit) params.limit = String(q.limit);
  if (q.types && q.types.length > 0) params.types = q.types.join(',');
  if (q.unread === true) params.unread = 'true';
  else if (q.unread === false) params.unread = 'false';
  const { data } = await apiClient.get<Envelope<NotificationListResponse>>(
    '/notifications',
    { params },
  );
  return unwrap(data);
}

export async function getUnreadCount(): Promise<NotificationUnreadCountResponse> {
  const { data } = await apiClient.get<
    Envelope<NotificationUnreadCountResponse>
  >('/notifications/unread-count');
  return unwrap(data);
}

export async function markRead(
  id: string,
): Promise<NotificationMarkReadResponse> {
  const { data } = await apiClient.post<
    Envelope<NotificationMarkReadResponse>
  >(`/notifications/${encodeURIComponent(id)}/read`);
  return unwrap(data);
}

export async function markAllRead(): Promise<NotificationMarkAllReadResponse> {
  const { data } = await apiClient.post<
    Envelope<NotificationMarkAllReadResponse>
  >('/notifications/read-all');
  return unwrap(data);
}
