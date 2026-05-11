/**
 * Phase 20.2 — Co-op Boss Party Contribution REST client.
 *
 * Endpoints khớp `apps/api/src/modules/coop-boss/coop-boss.controller.ts`:
 *   - GET  /coop/boss/runs/current                    → my active run
 *   - GET  /coop/boss/runs/mine?limit=                → my history
 *   - GET  /coop/boss/runs/:id                        → detail (participant)
 *   - GET  /coop/boss/runs/:id/reward-preview         → live tier preview
 *   - POST /coop/boss/runs                            → leader create
 *   - POST /coop/boss/runs/:id/join                   → member join
 *   - POST /coop/boss/runs/:id/leave                  → leave (no penalty
 *                                                       unless < minSurvival)
 *   - POST /coop/boss/runs/:id/contribution           → record contribution
 *   - POST /coop/boss/runs/:id/finish                 → leader finish
 *   - POST /coop/boss/runs/:id/cancel                 → leader cancel (LOBBY)
 *   - POST /coop/boss/runs/:id/claim-reward           → claim
 *
 * Server bọc `{ ok, data, error }`. `unwrap` ném
 * `Object.assign(Error, { code })` cho FE catch theo code.
 */
import type {
  CoopBossContributionDto,
  CoopBossRewardClaimDto,
  CoopBossRewardPreview,
  CoopBossRunDetailResponse,
  CoopBossRunListResponse,
  MyCoopBossRunResponse,
} from '@xuantoi/shared';
import { apiClient } from './client';

interface Envelope<T> {
  ok: boolean;
  data?: T;
  error?: { code: string; message: string };
}

function unwrap<T>(env: Envelope<T>): T {
  if (!env.ok || env.data === undefined) {
    const err = env.error ?? { code: 'UNKNOWN', message: 'UNKNOWN' };
    throw Object.assign(new Error(err.message), { code: err.code });
  }
  return env.data;
}

export async function getMyCoopBossRun(): Promise<MyCoopBossRunResponse> {
  const { data } = await apiClient.get<Envelope<MyCoopBossRunResponse>>(
    '/coop/boss/runs/current',
  );
  return unwrap(data);
}

export async function listMyCoopBossRuns(
  limit?: number,
): Promise<CoopBossRunListResponse> {
  const qs = limit ? `?limit=${encodeURIComponent(String(limit))}` : '';
  const { data } = await apiClient.get<Envelope<CoopBossRunListResponse>>(
    `/coop/boss/runs/mine${qs}`,
  );
  return unwrap(data);
}

export async function getCoopBossRunDetail(
  runId: string,
): Promise<CoopBossRunDetailResponse> {
  const { data } = await apiClient.get<Envelope<CoopBossRunDetailResponse>>(
    `/coop/boss/runs/${encodeURIComponent(runId)}`,
  );
  return unwrap(data);
}

export async function getCoopBossRewardPreview(
  runId: string,
): Promise<{ preview: CoopBossRewardPreview | null }> {
  const { data } = await apiClient.get<
    Envelope<{ preview: CoopBossRewardPreview | null }>
  >(`/coop/boss/runs/${encodeURIComponent(runId)}/reward-preview`);
  return unwrap(data);
}

export async function createCoopBossRun(input: {
  bossKey: string;
  worldBossEventId?: string;
}): Promise<MyCoopBossRunResponse> {
  const { data } = await apiClient.post<Envelope<MyCoopBossRunResponse>>(
    '/coop/boss/runs',
    input,
  );
  return unwrap(data);
}

export async function joinCoopBossRun(
  runId: string,
): Promise<MyCoopBossRunResponse> {
  const { data } = await apiClient.post<Envelope<MyCoopBossRunResponse>>(
    `/coop/boss/runs/${encodeURIComponent(runId)}/join`,
    {},
  );
  return unwrap(data);
}

export async function leaveCoopBossRun(
  runId: string,
): Promise<MyCoopBossRunResponse> {
  const { data } = await apiClient.post<Envelope<MyCoopBossRunResponse>>(
    `/coop/boss/runs/${encodeURIComponent(runId)}/leave`,
    {},
  );
  return unwrap(data);
}

export async function recordCoopBossContribution(input: {
  runId: string;
  damageDone: number | string;
  supportScore: number;
  survivalSeconds: number;
}): Promise<{ contribution: CoopBossContributionDto }> {
  const { data } = await apiClient.post<
    Envelope<{ contribution: CoopBossContributionDto }>
  >(`/coop/boss/runs/${encodeURIComponent(input.runId)}/contribution`, {
    damageDone: input.damageDone,
    supportScore: input.supportScore,
    survivalSeconds: input.survivalSeconds,
  });
  return unwrap(data);
}

export async function finishCoopBossRun(
  runId: string,
  result: 'CLEARED' | 'FAILED',
): Promise<MyCoopBossRunResponse> {
  const { data } = await apiClient.post<Envelope<MyCoopBossRunResponse>>(
    `/coop/boss/runs/${encodeURIComponent(runId)}/finish`,
    { result },
  );
  return unwrap(data);
}

export async function cancelCoopBossRun(
  runId: string,
): Promise<MyCoopBossRunResponse> {
  const { data } = await apiClient.post<Envelope<MyCoopBossRunResponse>>(
    `/coop/boss/runs/${encodeURIComponent(runId)}/cancel`,
    {},
  );
  return unwrap(data);
}

export async function claimCoopBossReward(
  runId: string,
): Promise<{ claim: CoopBossRewardClaimDto }> {
  const { data } = await apiClient.post<
    Envelope<{ claim: CoopBossRewardClaimDto }>
  >(`/coop/boss/runs/${encodeURIComponent(runId)}/claim-reward`, {});
  return unwrap(data);
}
