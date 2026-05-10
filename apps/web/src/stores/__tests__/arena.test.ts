/**
 * Phase 14.1.B — useArenaStore unit tests.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';

const {
  fetchProfileMock,
  fetchOpponentsMock,
  challengeMock,
  fetchHistoryMock,
  fetchSeasonMock,
  fetchMyStandingMock,
  fetchLeaderboardMock,
  fetchRewardPreviewMock,
} = vi.hoisted(() => ({
  fetchProfileMock: vi.fn(),
  fetchOpponentsMock: vi.fn(),
  challengeMock: vi.fn(),
  fetchHistoryMock: vi.fn(),
  fetchSeasonMock: vi.fn(),
  fetchMyStandingMock: vi.fn(),
  fetchLeaderboardMock: vi.fn(),
  fetchRewardPreviewMock: vi.fn(),
}));

vi.mock('@/api/arena', () => ({
  fetchArenaProfile: fetchProfileMock,
  fetchArenaOpponents: fetchOpponentsMock,
  challengeArenaOpponent: challengeMock,
  fetchArenaHistory: fetchHistoryMock,
  fetchArenaCurrentSeason: fetchSeasonMock,
  fetchArenaMyStanding: fetchMyStandingMock,
  fetchArenaLeaderboard: fetchLeaderboardMock,
  fetchArenaRewardPreview: fetchRewardPreviewMock,
}));

import { useArenaStore } from '@/stores/arena';

beforeEach(() => {
  setActivePinia(createPinia());
  fetchProfileMock.mockReset();
  fetchOpponentsMock.mockReset();
  challengeMock.mockReset();
  fetchHistoryMock.mockReset();
  fetchSeasonMock.mockReset();
  fetchMyStandingMock.mockReset();
  fetchLeaderboardMock.mockReset();
  fetchRewardPreviewMock.mockReset();
});

describe('useArenaStore.fetchProfile', () => {
  it('sets profile on success', async () => {
    const store = useArenaStore();
    fetchProfileMock.mockResolvedValueOnce({ rating: 1000 });
    await store.fetchProfile();
    expect(store.profile?.rating).toBe(1000);
    expect(store.profileError).toBeNull();
    expect(store.profileLoading).toBe(false);
  });

  it('sets profileError code on failure', async () => {
    const store = useArenaStore();
    fetchProfileMock.mockRejectedValueOnce({ code: 'NO_CHARACTER' });
    await store.fetchProfile();
    expect(store.profile).toBeNull();
    expect(store.profileError).toBe('NO_CHARACTER');
  });
});

describe('useArenaStore.fetchOpponents', () => {
  it('sets opponents on success', async () => {
    const store = useArenaStore();
    fetchOpponentsMock.mockResolvedValueOnce([{ characterId: 'x' }]);
    await store.fetchOpponents();
    expect(store.opponents?.length).toBe(1);
  });

  it('sets opponentsError on failure', async () => {
    const store = useArenaStore();
    fetchOpponentsMock.mockRejectedValueOnce(new Error('boom'));
    await store.fetchOpponents();
    expect(store.opponentsError).toBe('OPPONENTS_FETCH_FAILED');
  });
});

describe('useArenaStore.challenge', () => {
  it('sets lastResult and refetches profile/history on success', async () => {
    const store = useArenaStore();
    challengeMock.mockResolvedValueOnce({ matchId: 'm1' });
    fetchProfileMock.mockResolvedValueOnce({ rating: 1010 });
    fetchHistoryMock.mockResolvedValueOnce([{ matchId: 'm1' }]);
    const code = await store.challenge('opp-1');
    expect(code).toBeNull();
    expect(store.lastResult?.matchId).toBe('m1');
    expect(fetchProfileMock).toHaveBeenCalled();
    expect(fetchHistoryMock).toHaveBeenCalled();
  });

  it('returns code on failure', async () => {
    const store = useArenaStore();
    challengeMock.mockRejectedValueOnce({ code: 'CANNOT_ATTACK_SELF' });
    const code = await store.challenge('opp-1');
    expect(code).toBe('CANNOT_ATTACK_SELF');
    expect(store.lastResult).toBeNull();
  });

  it('returns IN_FLIGHT when called while another challenge runs', async () => {
    const store = useArenaStore();
    let release: () => void = () => undefined;
    challengeMock.mockImplementationOnce(
      () => new Promise((res) => (release = () => res({ matchId: 'mx' }))),
    );
    fetchProfileMock.mockResolvedValueOnce({ rating: 1000 });
    fetchHistoryMock.mockResolvedValueOnce([]);
    const p = store.challenge('opp-1');
    const code = await store.challenge('opp-2');
    expect(code).toBe('IN_FLIGHT');
    release();
    await p;
  });
});

describe('useArenaStore.clearLastResult', () => {
  it('clears lastResult', () => {
    const store = useArenaStore();
    store.lastResult = { matchId: 'm1' } as never;
    store.clearLastResult();
    expect(store.lastResult).toBeNull();
  });
});

// Phase 14.1.C — season actions.
describe('useArenaStore.fetchSeason', () => {
  it('sets season on success', async () => {
    const store = useArenaStore();
    fetchSeasonMock.mockResolvedValueOnce({
      seasonKey: 'arena_2026-W19',
      status: 'ACTIVE',
    });
    await store.fetchSeason();
    expect(store.season?.seasonKey).toBe('arena_2026-W19');
    expect(store.seasonError).toBeNull();
  });

  it('sets error code on failure', async () => {
    const store = useArenaStore();
    fetchSeasonMock.mockRejectedValueOnce({ code: 'OFFLINE' });
    await store.fetchSeason();
    expect(store.seasonError).toBe('OFFLINE');
  });
});

describe('useArenaStore.fetchMyStanding', () => {
  it('sets myStanding on success', async () => {
    const store = useArenaStore();
    fetchMyStandingMock.mockResolvedValueOnce({ rating: 1234, rank: 5 });
    await store.fetchMyStanding();
    expect(store.myStanding?.rating).toBe(1234);
    expect(store.myStanding?.rank).toBe(5);
  });

  it('sets fallback STANDING_FETCH_FAILED on failure', async () => {
    const store = useArenaStore();
    fetchMyStandingMock.mockRejectedValueOnce(new Error('boom'));
    await store.fetchMyStanding();
    expect(store.myStandingError).toBe('STANDING_FETCH_FAILED');
  });
});

describe('useArenaStore.fetchLeaderboard', () => {
  it('sets leaderboard on success', async () => {
    const store = useArenaStore();
    fetchLeaderboardMock.mockResolvedValueOnce({ total: 2, entries: [] });
    await store.fetchLeaderboard({ limit: 10 });
    expect(store.leaderboard?.total).toBe(2);
  });

  it('sets fallback LEADERBOARD_FETCH_FAILED on failure', async () => {
    const store = useArenaStore();
    fetchLeaderboardMock.mockRejectedValueOnce(new Error('boom'));
    await store.fetchLeaderboard();
    expect(store.leaderboardError).toBe('LEADERBOARD_FETCH_FAILED');
  });
});

describe('useArenaStore.fetchRewardPreview', () => {
  it('sets rewardPreview on success', async () => {
    const store = useArenaStore();
    fetchRewardPreviewMock.mockResolvedValueOnce({ tiers: [] });
    await store.fetchRewardPreview();
    expect(store.rewardPreview?.tiers).toEqual([]);
  });

  it('sets fallback REWARDS_FETCH_FAILED on failure', async () => {
    const store = useArenaStore();
    fetchRewardPreviewMock.mockRejectedValueOnce(new Error('boom'));
    await store.fetchRewardPreview();
    expect(store.rewardPreviewError).toBe('REWARDS_FETCH_FAILED');
  });
});
