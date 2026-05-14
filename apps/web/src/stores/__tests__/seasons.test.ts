import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import type { SeasonProgressView, SeasonLeaderboardView } from '@/api/seasons';

const fetchSeasonProgressMock = vi.fn();
const fetchSeasonLeaderboardMock = vi.fn();
const fetchSeasonMilestonesMock = vi.fn();
const claimSeasonRewardMock = vi.fn();

vi.mock('@/api/seasons', () => ({
  fetchSeasonProgress: (...a: unknown[]) => fetchSeasonProgressMock(...a),
  fetchSeasonLeaderboard: (...a: unknown[]) => fetchSeasonLeaderboardMock(...a),
  fetchSeasonMilestones: (...a: unknown[]) => fetchSeasonMilestonesMock(...a),
  claimSeasonReward: (...a: unknown[]) => claimSeasonRewardMock(...a),
}));

import { useSeasonStore } from '@/stores/seasons';

const season = {
  seasonKey: 's1',
  name: 'Mùa 1',
  description: 'desc',
  status: 'ACTIVE' as const,
  startAt: '2026-01-01T00:00:00.000Z',
  endAt: '2026-03-31T00:00:00.000Z',
  pointConfig: { dailyCap: 100, weeklyCap: 500, sourcePoints: {} },
  rewards: [],
  milestones: [],
};

const progressView: SeasonProgressView = {
  season,
  progress: {
    points: 75,
    bestRoguelikeFloor: 9,
    bossDefeats: 2,
    dungeonClears: 1,
    craftCount: 0,
    breakthroughCount: 0,
    dailyUsed: 75,
    dailyCap: 100,
    weeklyUsed: 75,
    weeklyCap: 500,
    lastPointAt: '2026-01-01T00:00:00.000Z',
  },
  rewards: [
    {
      rewardKey: 'r1',
      minPoints: 50,
      titleVi: 'Mốc 50',
      titleEn: 'Tier 50',
      linhThach: 10,
      exp: 5,
      eventToken: 0,
      items: [],
      claimable: true,
      claimed: false,
    },
  ],
};

beforeEach(() => {
  setActivePinia(createPinia());
  fetchSeasonProgressMock.mockReset();
  fetchSeasonLeaderboardMock.mockReset();
  fetchSeasonMilestonesMock.mockReset();
  claimSeasonRewardMock.mockReset();
});

describe('useSeasonStore', () => {
  it('loads personal progress and claimable reward count', async () => {
    fetchSeasonProgressMock.mockResolvedValue(progressView);
    const store = useSeasonStore();

    await store.load();

    expect(store.season?.seasonKey).toBe('s1');
    expect(store.points).toBe(75);
    expect(store.claimableCount).toBe(1);
    expect(store.lastError).toBeNull();
  });

  it('loads leaderboard by selected kind', async () => {
    const board: SeasonLeaderboardView = {
      season,
      kind: 'ROGUELIKE_FLOOR',
      entries: [
        {
          rank: 1,
          characterId: 'c1',
          characterName: 'A',
          score: 10,
          tieBreaker: 100,
          updatedAt: '2026-01-01T00:00:00.000Z',
        },
      ],
    };
    fetchSeasonLeaderboardMock.mockResolvedValue(board);
    const store = useSeasonStore();

    await store.loadLeaderboard('ROGUELIKE_FLOOR');

    expect(fetchSeasonLeaderboardMock).toHaveBeenCalledWith('ROGUELIKE_FLOOR');
    expect(store.leaderboardKind).toBe('ROGUELIKE_FLOOR');
    expect(store.leaderboard[0]?.score).toBe(10);
  });

  it('records API errors without clearing current state', async () => {
    fetchSeasonProgressMock.mockRejectedValue({ code: 'NO_CHARACTER' });
    const store = useSeasonStore();

    await store.load();

    expect(store.lastError).toBe('NO_CHARACTER');
    expect(store.loaded).toBe(false);
  });
});
