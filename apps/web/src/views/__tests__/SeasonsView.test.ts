import { beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { createI18n } from 'vue-i18n';
import { createPinia, setActivePinia } from 'pinia';
import type {
  SeasonLeaderboardView,
  SeasonMilestoneView,
  SeasonProgressView,
} from '@/api/seasons';

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

vi.mock('@/components/shell/AppShell.vue', () => ({
  default: { name: 'AppShellStub', template: '<div><slot /></div>' },
}));

const toastPushMock = vi.fn();
vi.mock('@/stores/toast', () => ({
  useToastStore: () => ({ push: toastPushMock }),
}));

import SeasonsView from '@/views/SeasonsView.vue';

const messages = {
  vi: {
    common: { refresh: 'Làm mới', loadingData: 'Đang tải' },
    seasons: {
      kicker: 'Phase 39',
      title: 'Mùa Giải',
      subtitle: 'sub',
      timeLeft: 'Còn lại',
      timeLeftValue: '{days} ngày {hours} giờ',
      ended: 'Đã kết thúc',
      myPoints: 'Điểm mùa',
      progress: 'Tiến độ',
      dailyCap: 'Ngày',
      weeklyCap: 'Tuần',
      bestFloor: 'Tầng',
      bossDefeats: 'Boss',
      rewards: 'Thưởng',
      claimableCount: '{n} thưởng',
      requiresPoints: 'Cần {n}',
      claim: 'Lĩnh',
      claimed: 'Đã lĩnh',
      locked: 'Khoá',
      leaderboard: 'BXH',
      serverMilestones: 'Mốc server',
      unlocked: 'Mở',
      emptyTitle: 'Chưa có mùa',
      emptyBody: 'Admin tạo mùa',
      emptyRewards: 'Không thưởng',
      emptyLeaderboard: 'Trống BXH',
      emptyMilestones: 'Trống mốc',
      claimToast: '+{linhThach} +{exp}',
      leaderboardKind: {
        POINTS: 'Điểm',
        ROGUELIKE_FLOOR: 'Tầng',
        BOSS_DEFEATS: 'Boss',
        DUNGEON_CLEARS: 'Bí cảnh',
      },
      errors: { UNKNOWN: 'Lỗi', UNKNOWN_ERROR: 'Lỗi' },
    },
  },
};

const season = {
  seasonKey: 's1',
  name: 'Mùa Xuân',
  description: 'Mùa đầu',
  status: 'ACTIVE' as const,
  startAt: '2026-01-01T00:00:00.000Z',
  endAt: '2026-12-31T00:00:00.000Z',
  pointConfig: { dailyCap: 100, weeklyCap: 500, sourcePoints: {} },
  rewards: [],
  milestones: [],
};

function mountView() {
  const i18n = createI18n({ legacy: false, locale: 'vi', messages });
  return mount(SeasonsView, {
    global: {
      plugins: [createPinia(), i18n],
    },
  });
}

beforeEach(() => {
  setActivePinia(createPinia());
  fetchSeasonProgressMock.mockReset();
  fetchSeasonLeaderboardMock.mockReset();
  fetchSeasonMilestonesMock.mockReset();
  claimSeasonRewardMock.mockReset();
  toastPushMock.mockReset();
});

describe('SeasonsView', () => {
  it('renders season progress, rewards, leaderboard, and milestones', async () => {
    const progress: SeasonProgressView = {
      season,
      progress: {
        points: 120,
        bestRoguelikeFloor: 8,
        bossDefeats: 2,
        dungeonClears: 1,
        craftCount: 0,
        breakthroughCount: 0,
        dailyUsed: 60,
        dailyCap: 100,
        weeklyUsed: 120,
        weeklyCap: 500,
        lastPointAt: null,
      },
      rewards: [
        {
          rewardKey: 'r1',
          minPoints: 100,
          titleVi: 'Mốc 100',
          titleEn: 'Tier 100',
          linhThach: 10,
          exp: 5,
          eventToken: 0,
          items: [],
          claimable: true,
          claimed: false,
        },
      ],
    };
    const leaderboard: SeasonLeaderboardView = {
      season,
      kind: 'POINTS',
      entries: [
        {
          rank: 1,
          characterId: 'c1',
          characterName: 'Đạo hữu A',
          score: 120,
          tieBreaker: 1,
          updatedAt: '2026-01-01T00:00:00.000Z',
        },
      ],
    };
    const milestones: SeasonMilestoneView = {
      season,
      milestones: [
        {
          milestoneKey: 'm1',
          metric: 'BOSS_DEFEATS',
          target: 10,
          progress: 4,
          unlockedAt: null,
          effectKey: 'buff',
          titleVi: 'Hạ boss',
          titleEn: 'Bosses',
          effectVi: 'Mở buff',
          effectEn: 'Unlock buff',
        },
      ],
    };
    fetchSeasonProgressMock.mockResolvedValue(progress);
    fetchSeasonLeaderboardMock.mockResolvedValue(leaderboard);
    fetchSeasonMilestonesMock.mockResolvedValue(milestones);

    const wrapper = mountView();
    await flushPromises();

    expect(wrapper.text()).toContain('Mùa Giải');
    expect(wrapper.text()).toContain('Mùa Xuân');
    expect(wrapper.text()).toContain('120');
    expect(wrapper.text()).toContain('Mốc 100');
    expect(wrapper.text()).toContain('Đạo hữu A');
    expect(wrapper.text()).toContain('Hạ boss');
  });

  it('renders empty active-season state', async () => {
    fetchSeasonProgressMock.mockResolvedValue({
      season: null,
      progress: null,
      rewards: [],
    });
    fetchSeasonLeaderboardMock.mockResolvedValue({
      season: null,
      kind: 'POINTS',
      entries: [],
    });
    fetchSeasonMilestonesMock.mockResolvedValue({
      season: null,
      milestones: [],
    });

    const wrapper = mountView();
    await flushPromises();

    expect(wrapper.text()).toContain('Chưa có mùa');
  });
});
