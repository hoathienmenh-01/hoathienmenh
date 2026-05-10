/**
 * Phase 14.1.B — Async Arena Foundation API client.
 *
 * Wire 4 endpoints server-authoritative:
 *   - GET  /arena/profile             — lazy-create + return profile.
 *   - GET  /arena/opponents?limit=N   — list opponents.
 *   - POST /arena/matches             — body { defenderCharacterId, seed? }.
 *   - GET  /arena/matches/history?... — list matches.
 *
 * Mirror pattern `breakthrough.ts` / `tribulation.ts`.
 */
import { i18n } from '@/i18n';
import { apiClient } from './client';
import type {
  ArenaLeaderboardView,
  ArenaMatchResult,
  ArenaMyStandingView,
  ArenaOpponentSummary,
  ArenaProfileSummary,
  ArenaSeasonRewardPreviewView,
  ArenaSeasonView,
} from '@xuantoi/shared';

interface Envelope<T> {
  ok: boolean;
  data?: T;
  error?: { code: string; message: string };
}

function fallbackError(op: string): Error {
  const path = `common.apiFallback.${op}`;
  const msg = i18n.global.te(path) ? i18n.global.t(path) : 'arena.errors.unknown';
  return new Error(msg);
}

export type {
  ArenaLeaderboardEntry,
  ArenaLeaderboardView,
  ArenaMatchResult,
  ArenaMyStandingView,
  ArenaOpponentSummary,
  ArenaProfileSummary,
  ArenaSeasonRewardPreviewEntry,
  ArenaSeasonRewardPreviewView,
  ArenaSeasonView,
} from '@xuantoi/shared';

/** GET /arena/profile — lazy create. */
export async function fetchArenaProfile(): Promise<ArenaProfileSummary> {
  const { data } = await apiClient.get<Envelope<{ profile: ArenaProfileSummary }>>(
    '/arena/profile',
  );
  if (!data.ok || !data.data) throw data.error ?? fallbackError('arenaProfile');
  return data.data.profile;
}

/** GET /arena/opponents?limit=N. */
export async function fetchArenaOpponents(
  limit?: number,
): Promise<ArenaOpponentSummary[]> {
  const url =
    limit !== undefined
      ? `/arena/opponents?limit=${encodeURIComponent(String(limit))}`
      : '/arena/opponents';
  const { data } = await apiClient.get<
    Envelope<{ opponents: ArenaOpponentSummary[] }>
  >(url);
  if (!data.ok || !data.data) throw data.error ?? fallbackError('arenaOpponents');
  return data.data.opponents;
}

/** POST /arena/matches — challenge. */
export async function challengeArenaOpponent(
  defenderCharacterId: string,
  seed?: number,
): Promise<ArenaMatchResult> {
  const body: { defenderCharacterId: string; seed?: number } = {
    defenderCharacterId,
  };
  if (seed !== undefined) body.seed = seed;
  const { data } = await apiClient.post<Envelope<{ match: ArenaMatchResult }>>(
    '/arena/matches',
    body,
  );
  if (!data.ok || !data.data) throw data.error ?? fallbackError('arenaChallenge');
  return data.data.match;
}

/** GET /arena/matches/history. */
export async function fetchArenaHistory(
  limit?: number,
  side?: 'all' | 'attacker' | 'defender',
): Promise<ArenaMatchResult[]> {
  const params = new URLSearchParams();
  if (limit !== undefined) params.set('limit', String(limit));
  if (side !== undefined) params.set('side', side);
  const qs = params.toString();
  const url = qs ? `/arena/matches/history?${qs}` : '/arena/matches/history';
  const { data } = await apiClient.get<Envelope<{ matches: ArenaMatchResult[] }>>(
    url,
  );
  if (!data.ok || !data.data) throw data.error ?? fallbackError('arenaHistory');
  return data.data.matches;
}

/* ---------------------------------------------------------------------------
 * Phase 14.1.C — Arena Season + leaderboard + reward preview.
 * ------------------------------------------------------------------------- */

/** GET /arena/season/current. */
export async function fetchArenaCurrentSeason(): Promise<ArenaSeasonView> {
  const { data } = await apiClient.get<Envelope<{ season: ArenaSeasonView }>>(
    '/arena/season/current',
  );
  if (!data.ok || !data.data) throw data.error ?? fallbackError('arenaSeason');
  return data.data.season;
}

/** GET /arena/leaderboard?seasonKey=&limit=&offset=. */
export async function fetchArenaLeaderboard(opts: {
  seasonKey?: string;
  limit?: number;
  offset?: number;
} = {}): Promise<ArenaLeaderboardView> {
  const params = new URLSearchParams();
  if (opts.seasonKey) params.set('seasonKey', opts.seasonKey);
  if (opts.limit !== undefined) params.set('limit', String(opts.limit));
  if (opts.offset !== undefined) params.set('offset', String(opts.offset));
  const qs = params.toString();
  const url = qs ? `/arena/leaderboard?${qs}` : '/arena/leaderboard';
  const { data } =
    await apiClient.get<Envelope<{ leaderboard: ArenaLeaderboardView }>>(url);
  if (!data.ok || !data.data) {
    throw data.error ?? fallbackError('arenaLeaderboard');
  }
  return data.data.leaderboard;
}

/** GET /arena/season/rewards. */
export async function fetchArenaRewardPreview(
  seasonKey?: string,
): Promise<ArenaSeasonRewardPreviewView> {
  const url = seasonKey
    ? `/arena/season/rewards?seasonKey=${encodeURIComponent(seasonKey)}`
    : '/arena/season/rewards';
  const { data } =
    await apiClient.get<Envelope<{ preview: ArenaSeasonRewardPreviewView }>>(url);
  if (!data.ok || !data.data) {
    throw data.error ?? fallbackError('arenaRewards');
  }
  return data.data.preview;
}

/** GET /arena/season/standing. */
export async function fetchArenaMyStanding(
  seasonKey?: string,
): Promise<ArenaMyStandingView | null> {
  const url = seasonKey
    ? `/arena/season/standing?seasonKey=${encodeURIComponent(seasonKey)}`
    : '/arena/season/standing';
  const { data } =
    await apiClient.get<Envelope<{ standing: ArenaMyStandingView | null }>>(url);
  if (!data.ok || !data.data) {
    throw data.error ?? fallbackError('arenaStanding');
  }
  return data.data.standing;
}
