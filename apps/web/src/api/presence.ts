/**
 * Phase 19.3 — Presence query REST client.
 *
 * Backed by `apps/api/src/modules/presence/presence.controller.ts`.
 * Auth: cookie session (`xt_access`). Privacy: server filters users
 * who have blocked the viewer (returns OFFLINE + null lastSeen).
 *
 * Realtime mirror: server pushes `presence:update` WS event to friends
 * when target user transitions online↔offline (0↔1 connections).
 */
import { apiClient } from './client';
import type { PresenceQueryResponse } from '@xuantoi/shared';

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

export async function getPresence(
  userIds: readonly string[],
): Promise<PresenceQueryResponse> {
  if (userIds.length === 0) return { presences: [] };
  const params = { userIds: userIds.join(',') };
  const { data } = await apiClient.get<Envelope<PresenceQueryResponse>>(
    '/social/presence',
    { params },
  );
  return unwrap(data);
}
