/**
 * Phase 14.1.B — Arena API client unit tests.
 *
 * Verifies envelope parsing, query string handling, error throw on
 * `ok: false`.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('@/i18n', () => ({
  i18n: {
    global: {
      te: () => false,
      t: (k: string) => k,
    },
  },
}));

const { getMock, postMock } = vi.hoisted(() => ({
  getMock: vi.fn(),
  postMock: vi.fn(),
}));

vi.mock('@/api/client', () => ({
  apiClient: {
    get: getMock,
    post: postMock,
  },
}));

import {
  challengeArenaOpponent,
  fetchArenaHistory,
  fetchArenaOpponents,
  fetchArenaProfile,
} from '@/api/arena';

describe('api/arena', () => {
  beforeEach(() => {
    getMock.mockReset();
    postMock.mockReset();
  });

  it('fetchArenaProfile: GET /arena/profile and unwraps envelope', async () => {
    getMock.mockResolvedValueOnce({
      data: { ok: true, data: { profile: { rating: 1000 } } },
    });
    const profile = await fetchArenaProfile();
    expect(getMock).toHaveBeenCalledWith('/arena/profile');
    expect(profile.rating).toBe(1000);
  });

  it('fetchArenaProfile: throws envelope error on ok:false', async () => {
    getMock.mockResolvedValueOnce({
      data: { ok: false, error: { code: 'NO_CHARACTER', message: 'x' } },
    });
    await expect(fetchArenaProfile()).rejects.toMatchObject({
      code: 'NO_CHARACTER',
    });
  });

  it('fetchArenaOpponents: forwards limit qs', async () => {
    getMock.mockResolvedValueOnce({
      data: { ok: true, data: { opponents: [] } },
    });
    await fetchArenaOpponents(8);
    expect(getMock).toHaveBeenCalledWith('/arena/opponents?limit=8');
  });

  it('fetchArenaOpponents: omits qs when limit undefined', async () => {
    getMock.mockResolvedValueOnce({
      data: { ok: true, data: { opponents: [] } },
    });
    await fetchArenaOpponents();
    expect(getMock).toHaveBeenCalledWith('/arena/opponents');
  });

  it('challengeArenaOpponent: POST with body and parses match', async () => {
    postMock.mockResolvedValueOnce({
      data: { ok: true, data: { match: { matchId: 'm1' } } },
    });
    const m = await challengeArenaOpponent('opp-1');
    expect(postMock).toHaveBeenCalledWith('/arena/matches', {
      defenderCharacterId: 'opp-1',
    });
    expect(m.matchId).toBe('m1');
  });

  it('challengeArenaOpponent: includes seed when provided', async () => {
    postMock.mockResolvedValueOnce({
      data: { ok: true, data: { match: { matchId: 'm2' } } },
    });
    await challengeArenaOpponent('opp-1', 42);
    expect(postMock).toHaveBeenCalledWith('/arena/matches', {
      defenderCharacterId: 'opp-1',
      seed: 42,
    });
  });

  it('fetchArenaHistory: encodes side + limit qs', async () => {
    getMock.mockResolvedValueOnce({
      data: { ok: true, data: { matches: [] } },
    });
    await fetchArenaHistory(5, 'attacker');
    expect(getMock).toHaveBeenCalledWith(
      '/arena/matches/history?limit=5&side=attacker',
    );
  });

  it('fetchArenaHistory: omits qs when no params', async () => {
    getMock.mockResolvedValueOnce({
      data: { ok: true, data: { matches: [] } },
    });
    await fetchArenaHistory();
    expect(getMock).toHaveBeenCalledWith('/arena/matches/history');
  });
});
