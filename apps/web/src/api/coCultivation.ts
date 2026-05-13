/**
 * Phase 35.1 — Co-Cultivation / Hợp Luyện client. Khớp REST
 * `apps/api/src/modules/co-cultivation/co-cultivation.controller.ts`.
 *
 * Envelope shape giống Phase 19.1 social client.
 */
import type {
  CoCultivationHistoryResponse,
  CoCultivationSessionRow,
  CoCultivationStatusResponse,
} from '@xuantoi/shared';
import { apiClient } from './client';

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

export async function getCoCultivationStatus(): Promise<CoCultivationStatusResponse> {
  const { data } = await apiClient.get<Envelope<CoCultivationStatusResponse>>(
    '/social/co-cultivation/status',
  );
  return unwrap(data);
}

export async function getCoCultivationHistory(
  opts: { limit?: number; before?: string } = {},
): Promise<CoCultivationHistoryResponse> {
  const { data } = await apiClient.get<Envelope<CoCultivationHistoryResponse>>(
    '/social/co-cultivation/history',
    { params: opts },
  );
  return unwrap(data);
}

export async function requestCoCultivation(input: {
  partnerUserId: string;
  durationSec?: number;
  buffPercent?: number;
}): Promise<CoCultivationSessionRow> {
  const { data } = await apiClient.post<
    Envelope<{ session: CoCultivationSessionRow }>
  >('/social/co-cultivation/sessions', input);
  return unwrap(data).session;
}

export async function acceptCoCultivation(
  sessionId: string,
): Promise<CoCultivationSessionRow> {
  const { data } = await apiClient.post<
    Envelope<{ session: CoCultivationSessionRow }>
  >(`/social/co-cultivation/sessions/${encodeURIComponent(sessionId)}/accept`);
  return unwrap(data).session;
}

export async function cancelCoCultivation(
  sessionId: string,
): Promise<CoCultivationSessionRow> {
  const { data } = await apiClient.post<
    Envelope<{ session: CoCultivationSessionRow }>
  >(`/social/co-cultivation/sessions/${encodeURIComponent(sessionId)}/cancel`);
  return unwrap(data).session;
}

export async function completeCoCultivation(
  sessionId: string,
): Promise<CoCultivationSessionRow> {
  const { data } = await apiClient.post<
    Envelope<{ session: CoCultivationSessionRow }>
  >(
    `/social/co-cultivation/sessions/${encodeURIComponent(sessionId)}/complete`,
  );
  return unwrap(data).session;
}
