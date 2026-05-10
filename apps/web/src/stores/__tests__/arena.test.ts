/**
 * Phase 14.1.B — useArenaStore unit tests.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';

const { fetchProfileMock, fetchOpponentsMock, challengeMock, fetchHistoryMock } =
  vi.hoisted(() => ({
    fetchProfileMock: vi.fn(),
    fetchOpponentsMock: vi.fn(),
    challengeMock: vi.fn(),
    fetchHistoryMock: vi.fn(),
  }));

vi.mock('@/api/arena', () => ({
  fetchArenaProfile: fetchProfileMock,
  fetchArenaOpponents: fetchOpponentsMock,
  challengeArenaOpponent: challengeMock,
  fetchArenaHistory: fetchHistoryMock,
}));

import { useArenaStore } from '@/stores/arena';

beforeEach(() => {
  setActivePinia(createPinia());
  fetchProfileMock.mockReset();
  fetchOpponentsMock.mockReset();
  challengeMock.mockReset();
  fetchHistoryMock.mockReset();
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
