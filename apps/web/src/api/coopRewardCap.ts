/**
 * Phase 20.3 — Co-op Reward Cap / Weekly Contribution Season REST client.
 *
 * Endpoints khớp `apps/api/src/modules/coop-reward-cap/coop-reward-cap.controller.ts`:
 *   - GET  /coop/rewards/status               → caller cap + weekly snapshot
 *   - GET  /coop/rewards/weekly-leaderboard   → public top entries
 *   - POST /coop/rewards/weekly-claim         → claim weekly reward (CAS)
 *
 * Server bọc `{ ok, data, error }`. `unwrap` ném
 * `Object.assign(Error, { code })` cho FE catch theo code.
 */
import type {
  CoopRewardStatusDto,
  CoopWeeklyLeaderboardResponse,
  CoopWeeklyRewardClaimDto,
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

export async function getCoopRewardStatus(): Promise<CoopRewardStatusDto> {
  const { data } = await apiClient.get<Envelope<CoopRewardStatusDto>>(
    '/coop/rewards/status',
  );
  return unwrap(data);
}

export async function getCoopWeeklyLeaderboard(input?: {
  weekKey?: string;
  limit?: number;
}): Promise<CoopWeeklyLeaderboardResponse> {
  const params = new URLSearchParams();
  if (input?.weekKey) params.set('weekKey', input.weekKey);
  if (input?.limit) params.set('limit', String(input.limit));
  const qs = params.toString();
  const { data } = await apiClient.get<Envelope<CoopWeeklyLeaderboardResponse>>(
    `/coop/rewards/weekly-leaderboard${qs ? `?${qs}` : ''}`,
  );
  return unwrap(data);
}

export async function claimCoopWeeklyReward(
  seasonId: string,
): Promise<CoopWeeklyRewardClaimDto> {
  const { data } = await apiClient.post<Envelope<CoopWeeklyRewardClaimDto>>(
    '/coop/rewards/weekly-claim',
    { seasonId },
  );
  return unwrap(data);
}
