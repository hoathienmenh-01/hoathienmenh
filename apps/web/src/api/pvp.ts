/**
 * Phase 29.0 — PvP Foundation V1 API client (non-arena modes).
 *
 * Wrap REST endpoints `/pvp/*` (player) + `/admin/pvp/*` (admin). Mode
 * ARENA tiếp tục dùng `arena.ts` (Phase 14.1.B/C).
 */
import { apiClient } from './client';
import type {
  PvpBalancePolicy,
  PvpBattleSnapshot,
  PvpDefenseProfileDef,
  PvpMode,
} from '@xuantoi/shared';

interface Envelope<T> {
  ok: boolean;
  data?: T;
  error?: { code: string; message: string };
}

export interface PvpBattleSummary {
  id: string;
  mode: string;
  status: string;
  result: string | null;
  attackerCharacterId: string;
  defenderCharacterId: string | null;
  powerGap: number;
  rewardGranted: boolean;
  sourceModuleKey: string | null;
  createdAt: string;
  resolvedAt: string | null;
}

export interface PvpChallengeResult {
  battleId: string;
  result: 'ATTACKER_WIN' | 'DEFENDER_WIN' | 'DRAW' | 'FORFEIT';
  attackerSnapshot: PvpBattleSnapshot;
  defenderSnapshot: PvpBattleSnapshot;
  rewardGranted: boolean;
  powerGap: number;
  ratingChange: { attackerDelta: number; defenderDelta: number } | null;
}

export interface PvpAnomalyRow {
  id: string;
  anomalyType: string;
  severity: number;
  characterId: string | null;
  sectId: string | null;
  relatedBattleId: string | null;
  detailJson: unknown;
  blockedReward: boolean;
  resolvedBy: string | null;
  resolution: string | null;
  resolveReason: string | null;
  resolvedAt: string | null;
  createdAt: string;
}

// ── Player ─────────────────────────────────────────────────────────────

export async function getPvpPolicy(): Promise<PvpBalancePolicy> {
  const { data } = await apiClient.get<Envelope<PvpBalancePolicy>>('/pvp/policy');
  if (!data.ok || !data.data) throw new Error(data.error?.code ?? 'PVP_FETCH_POLICY_FAIL');
  return data.data;
}

export async function getDefenseProfile(): Promise<PvpDefenseProfileDef | null> {
  const { data } = await apiClient.get<Envelope<PvpDefenseProfileDef | null>>(
    '/pvp/defense',
  );
  if (!data.ok) throw new Error(data.error?.code ?? 'PVP_FETCH_DEFENSE_FAIL');
  return data.data ?? null;
}

export async function upsertDefenseProfile(
  input: { label?: string | null },
): Promise<PvpDefenseProfileDef> {
  const { data } = await apiClient.post<Envelope<PvpDefenseProfileDef>>(
    '/pvp/defense',
    input,
  );
  if (!data.ok || !data.data) {
    throw new Error(data.error?.code ?? 'PVP_DEFENSE_UPSERT_FAIL');
  }
  return data.data;
}

export async function challengePvp(input: {
  defenderCharacterId: string;
  mode: 'DUEL' | 'FRIENDLY_SPARRING';
  idempotencyKey?: string;
}): Promise<PvpChallengeResult> {
  const { data } = await apiClient.post<Envelope<PvpChallengeResult>>(
    '/pvp/challenge',
    input,
  );
  if (!data.ok || !data.data) {
    throw new Error(data.error?.code ?? 'PVP_CHALLENGE_FAIL');
  }
  return data.data;
}

export async function listBattleLogs(input: {
  mode?: PvpMode;
  limit?: number;
  cursor?: string;
}): Promise<{ logs: PvpBattleSummary[]; characterId: string }> {
  const params = new URLSearchParams();
  if (input.mode) params.set('mode', input.mode);
  if (input.limit) params.set('limit', String(input.limit));
  if (input.cursor) params.set('cursor', input.cursor);
  const qs = params.toString() ? `?${params.toString()}` : '';
  const { data } = await apiClient.get<
    Envelope<{ logs: PvpBattleSummary[]; characterId: string }>
  >(`/pvp/battle-logs${qs}`);
  if (!data.ok || !data.data) {
    throw new Error(data.error?.code ?? 'PVP_FETCH_LOGS_FAIL');
  }
  return data.data;
}

// ── Admin ──────────────────────────────────────────────────────────────

export async function adminGetPolicy(): Promise<{
  current: PvpBalancePolicy;
  default: PvpBalancePolicy;
}> {
  const { data } = await apiClient.get<
    Envelope<{ current: PvpBalancePolicy; default: PvpBalancePolicy }>
  >('/admin/pvp/policy');
  if (!data.ok || !data.data) {
    throw new Error(data.error?.code ?? 'ADMIN_PVP_POLICY_FAIL');
  }
  return data.data;
}

export async function adminListBattleLogs(input: {
  mode?: PvpMode;
  characterId?: string;
  limit?: number;
}): Promise<PvpBattleSummary[]> {
  const params = new URLSearchParams();
  if (input.mode) params.set('mode', input.mode);
  if (input.characterId) params.set('characterId', input.characterId);
  if (input.limit) params.set('limit', String(input.limit));
  const qs = params.toString() ? `?${params.toString()}` : '';
  const { data } = await apiClient.get<Envelope<PvpBattleSummary[]>>(
    `/admin/pvp/battle-logs${qs}`,
  );
  if (!data.ok || !data.data) {
    throw new Error(data.error?.code ?? 'ADMIN_PVP_LOGS_FAIL');
  }
  return data.data;
}

export async function adminInvalidateBattle(
  battleId: string,
  reason: string,
): Promise<unknown> {
  const { data } = await apiClient.post<Envelope<unknown>>(
    `/admin/pvp/battle-logs/${battleId}/invalidate`,
    { reason },
  );
  if (!data.ok) throw new Error(data.error?.code ?? 'ADMIN_PVP_INVALIDATE_FAIL');
  return data.data;
}

export async function adminListAnomalies(input: {
  status?: 'PENDING' | 'RESOLVED' | 'ALL';
  type?: string;
  limit?: number;
}): Promise<PvpAnomalyRow[]> {
  const params = new URLSearchParams();
  if (input.status) params.set('status', input.status);
  if (input.type) params.set('type', input.type);
  if (input.limit) params.set('limit', String(input.limit));
  const qs = params.toString() ? `?${params.toString()}` : '';
  const { data } = await apiClient.get<Envelope<PvpAnomalyRow[]>>(
    `/admin/pvp/anomalies${qs}`,
  );
  if (!data.ok || !data.data) {
    throw new Error(data.error?.code ?? 'ADMIN_PVP_ANOMALIES_FAIL');
  }
  return data.data;
}

export async function adminResolveAnomaly(
  anomalyId: string,
  resolution: 'DISMISSED' | 'CONFIRMED' | 'ESCALATED',
  reason: string,
): Promise<unknown> {
  const { data } = await apiClient.post<Envelope<unknown>>(
    `/admin/pvp/anomalies/${anomalyId}/resolve`,
    { resolution, reason },
  );
  if (!data.ok) {
    throw new Error(data.error?.code ?? 'ADMIN_PVP_ANOMALY_RESOLVE_FAIL');
  }
  return data.data;
}

export async function adminGetDefense(
  characterId: string,
): Promise<PvpDefenseProfileDef | null> {
  const { data } = await apiClient.get<Envelope<PvpDefenseProfileDef | null>>(
    `/admin/pvp/defense/${characterId}`,
  );
  if (!data.ok) {
    throw new Error(data.error?.code ?? 'ADMIN_PVP_DEFENSE_FAIL');
  }
  return data.data ?? null;
}
