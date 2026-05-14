import { beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { createI18n } from 'vue-i18n';
import type { LongTermGoalDef, ReputationGroupDef } from '@xuantoi/shared';

const replaceMock = vi.fn();
const fetchStateMock = vi.fn().mockResolvedValue(undefined);

const repDef: ReputationGroupDef = {
  key: 'TIEN_DAO',
  nameVi: 'Tiên Đạo',
  nameEn: 'Immortal Dao',
  descriptionVi: 'desc',
  descriptionEn: 'desc',
  dailyCap: 300,
};

const goalDef: LongTermGoalDef = {
  key: 'dao_seed_first_breakthrough',
  nameVi: 'Mầm Đạo',
  nameEn: 'Dao Seed',
  descriptionVi: 'desc',
  descriptionEn: 'desc',
  category: 'realm',
  tier: 'bronze',
  goalKind: 'BREAKTHROUGH',
  goalAmount: 1,
  reward: { reputation: { TIEN_DAO: 40 } },
};

const authState = {
  hydrate: vi.fn().mockResolvedValue(undefined),
  isAuthenticated: true,
};
const gameState = {
  fetchState: vi.fn().mockResolvedValue(undefined),
  bindSocket: vi.fn(),
};
const storeState = {
  reputation: [
    {
      group: 'TIEN_DAO',
      score: 120,
      dailyGain: 40,
      dailyCap: 300,
      lastGainedAt: '2026-01-01T00:00:00.000Z',
      def: repDef,
    },
  ],
  goals: [
    {
      goalKey: 'dao_seed_first_breakthrough',
      progress: 1,
      completedAt: '2026-01-01T00:00:00.000Z',
      def: goalDef,
    },
  ],
  loaded: true,
  totalReputation: 120,
  completedGoals: 1,
  totalGoals: 1,
  fetchState: fetchStateMock,
  reset: vi.fn(),
};

vi.mock('@/stores/auth', () => ({
  useAuthStore: () => authState,
}));
vi.mock('@/stores/game', () => ({
  useGameStore: () => gameState,
}));
vi.mock('@/stores/reputationGoals', () => ({
  useReputationGoalsStore: () => storeState,
}));
vi.mock('vue-router', () => ({
  useRouter: () => ({ replace: replaceMock }),
}));
vi.mock('@/components/shell/AppShell.vue', () => ({
  default: {
    name: 'AppShellStub',
    template: '<div data-testid="app-shell"><slot /></div>',
  },
}));

import ReputationView from '@/views/ReputationView.vue';

const i18n = createI18n({
  legacy: false,
  locale: 'vi',
  messages: {
    vi: {
      reputation: {
        title: 'Uy Danh',
        subtitle: 'sub',
        summary: '{score}/{completed}/{total}',
        loading: 'loading',
        empty: 'empty',
        groupsTitle: 'groups',
        goalsTitle: 'goals',
        score: '{score}',
        dailyCap: 'cap',
        progress: 'progress',
        filter: { group: 'group', goal: 'goal', all: 'all' },
        goalStatus: { active: 'active', completed: 'completed' },
        goalCategory: {
          realm: 'realm',
          body: 'body',
          pet: 'pet',
          dungeon: 'dungeon',
          boss: 'boss',
          sect: 'sect',
        },
      },
    },
  },
});

describe('ReputationView', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authState.isAuthenticated = true;
  });

  it('renders reputation and long-term goal panels', async () => {
    const wrapper = mount(ReputationView, {
      global: { plugins: [i18n] },
    });
    await flushPromises();
    expect(fetchStateMock).toHaveBeenCalled();
    expect(wrapper.find('[data-testid="reputation-card-TIEN_DAO"]').exists()).toBe(true);
    expect(wrapper.find('[data-testid="long-term-goals-panel"]').exists()).toBe(true);
    expect(
      wrapper.find('[data-testid="goal-card-dao_seed_first_breakthrough"]').exists(),
    ).toBe(true);
  });

  it('redirects unauthenticated users', async () => {
    authState.isAuthenticated = false;
    mount(ReputationView, {
      global: { plugins: [i18n] },
    });
    await flushPromises();
    expect(replaceMock).toHaveBeenCalledWith('/auth');
  });
});
