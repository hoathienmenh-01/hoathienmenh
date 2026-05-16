/**
 * Phase 15.8 — AdminHallOfFameView smoke tests.
 *
 * Cover:
 *   - Forbidden state cho non-admin role (player) → endpoint KHÔNG được
 *     gọi, forbidden state hiển thị.
 *   - Admin role + empty payload → empty state hiển thị.
 *   - Admin role + populated payload → render season summary + reward
 *     stats + champion snapshot + aggregate Hall of Fame.
 *   - Filter season/sect/mvp → narrow list xuống đúng row.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { createI18n } from 'vue-i18n';
import { setActivePinia, createPinia } from 'pinia';

const apiMocks = vi.hoisted(() => ({
  getAdminSectSeasonHallOfFame: vi.fn(),
}));

vi.mock('@/api/adminSectSeason', () => apiMocks);

const authState = vi.hoisted(() => ({
  role: 'ADMIN' as 'ADMIN' | 'MOD' | 'PLAYER' | null,
}));

vi.mock('@/stores/auth', () => ({
  useAuthStore: () => ({
    user: authState.role ? { role: authState.role } : null,
  }),
}));

vi.mock('@/components/shell/AppShell.vue', () => ({
  default: { template: '<div><slot /></div>' },
}));

vi.mock('@/components/xianxia/XTPageEyebrow.vue', () => ({
  default: {
    props: ['caps', 'label'],
    template: '<div data-testid="eyebrow">{{ caps }} {{ label }}</div>',
  },
}));

vi.mock('@/components/ui/LoadingState.vue', () => ({
  default: {
    template: '<div data-testid="loading-state"></div>',
  },
}));

vi.mock('@/components/ui/EmptyState.vue', () => ({
  default: {
    props: ['titleKey', 'descriptionKey'],
    template:
      '<div :data-testid="$attrs[\'data-testid\']" data-comp="empty">{{ titleKey }}</div>',
    inheritAttrs: false,
  },
}));

vi.mock('@/components/ui/ErrorState.vue', () => ({
  default: {
    props: ['errorKey', 'testId'],
    emits: ['retry'],
    template:
      '<div :data-testid="testId" data-comp="error">{{ errorKey }}</div>',
  },
}));

import AdminHallOfFameView from '@/views/AdminHallOfFameView.vue';

const i18n = createI18n({
  legacy: false,
  locale: 'vi',
  fallbackLocale: 'vi',
  missingWarn: false,
  fallbackWarn: false,
  messages: {
    vi: {
      sectSeason: {
        season: {
          names: { s1: 'Mua S1', s2: 'Mua S2' },
          fallbackLabel: 'Mua {k}',
        },
      },
      adminHallOfFame: {
        eyebrow: 'HoF',
        title: 'Title',
        subtitle: 'Sub',
        notAdminTitle: 'No access',
        notAdminDescription: 'Restricted',
        emptyTitle: 'No data',
        emptyDescription: 'Empty',
        checkedAt: 'At',
        filters: {
          title: 'Filters',
          season: 'Season',
          sect: 'Sect',
          mvp: 'MVP',
          clear: 'Clear',
          count: '{visible}/{total}',
        },
        seasons: {
          title: 'Seasons',
          filteredEmpty: 'No match',
          season: 'Season',
          finalizedAt: 'Finalized',
          champion: 'Champion',
          score: 'Score',
          totals: 'Totals',
          mvp: 'MVP',
          mvpSect: 'MVP Sect',
          points: 'Points',
          rewardStatus: 'Reward',
          championGrants: 'Champion grants',
          mvpGrants: 'MVP grants',
          lastChampionGrantAt: 'Last champion',
          lastMvpGrantAt: 'Last MVP',
          snapshotMembers: 'Snapshot members',
          snapshotMissing: 'Snapshot missing',
        },
        aggregate: {
          title: 'Aggregate',
          totalSeasons: 'Total: {n}',
          topSects: 'Top sects',
          topSectsEmpty: 'No sect',
          topMembers: 'Top members',
          topMembersEmpty: 'No member',
          col: {
            championships: 'Ch',
            podiums: 'Po',
            appearances: 'Ap',
            bestRank: 'Best',
            mvps: 'Mvp',
          },
        },
        errors: {
          UNKNOWN: 'unknown',
        },
      },
    },
  },
});

const EMPTY_PAYLOAD = {
  checkedAt: '2026-05-30T00:00:00.000Z',
  seasons: [],
  hallOfFame: {
    sects: [],
    members: [],
    totalSeasonsFinalized: 0,
  },
};

const POPULATED_PAYLOAD = {
  checkedAt: '2026-05-30T00:00:00.000Z',
  seasons: [
    {
      seasonKey: 'season_2026_s2',
      finalizedAt: '2026-05-25T00:00:00.000Z',
      totalSects: 2,
      totalContributors: 2,
      totalPoints: 1000,
      champion: {
        rank: 1,
        sectId: 'sectB',
        sectName: 'SectB',
        points: 700,
        contributors: 0,
        weeksContributed: 0,
      },
      mvp: {
        rank: 1,
        characterId: 'cB',
        characterName: 'Bao',
        sectId: 'sectB',
        sectName: 'SectB',
        points: 700,
      },
      rewardStatus: {
        championGrants: 0,
        mvpGrants: 0,
        lastChampionGrantAt: null,
        lastMvpGrantAt: null,
      },
      championSnapshot: {
        sectId: 'sectB',
        rank: 1,
        memberCount: 1,
        createdAt: '2026-05-25T00:00:01.000Z',
      },
    },
    {
      seasonKey: 'season_2026_s1',
      finalizedAt: '2026-04-27T00:00:00.000Z',
      totalSects: 1,
      totalContributors: 1,
      totalPoints: 500,
      champion: {
        rank: 1,
        sectId: 'sectA',
        sectName: 'SectA',
        points: 500,
        contributors: 0,
        weeksContributed: 0,
      },
      mvp: {
        rank: 1,
        characterId: 'cA',
        characterName: 'An',
        sectId: 'sectA',
        sectName: 'SectA',
        points: 500,
      },
      rewardStatus: {
        championGrants: 1,
        mvpGrants: 1,
        lastChampionGrantAt: '2026-04-28T00:00:00.000Z',
        lastMvpGrantAt: '2026-04-28T00:01:00.000Z',
      },
      championSnapshot: {
        sectId: 'sectA',
        rank: 1,
        memberCount: 5,
        createdAt: '2026-04-27T00:00:01.000Z',
      },
    },
  ],
  hallOfFame: {
    sects: [
      {
        sectId: 'sectA',
        sectName: 'SectA',
        championships: 1,
        podiums: 1,
        appearances: 1,
        bestRank: 1,
        totalPoints: 500,
        latestSeasonKey: 'season_2026_s1',
      },
      {
        sectId: 'sectB',
        sectName: 'SectB',
        championships: 1,
        podiums: 1,
        appearances: 1,
        bestRank: 1,
        totalPoints: 700,
        latestSeasonKey: 'season_2026_s2',
      },
    ],
    members: [
      {
        characterId: 'cA',
        characterName: 'An',
        mvps: 1,
        podiums: 1,
        appearances: 1,
        bestRank: 1,
        totalPoints: 500,
        latestSeasonKey: 'season_2026_s1',
        latestSectName: 'SectA',
      },
      {
        characterId: 'cB',
        characterName: 'Bao',
        mvps: 1,
        podiums: 1,
        appearances: 1,
        bestRank: 1,
        totalPoints: 700,
        latestSeasonKey: 'season_2026_s2',
        latestSectName: 'SectB',
      },
    ],
    totalSeasonsFinalized: 2,
  },
};

beforeEach(() => {
  setActivePinia(createPinia());
  apiMocks.getAdminSectSeasonHallOfFame.mockReset();
  authState.role = 'ADMIN';
});

describe('AdminHallOfFameView smoke', () => {
  it('non-admin role → forbidden state + endpoint KHÔNG được gọi', async () => {
    authState.role = 'PLAYER';
    apiMocks.getAdminSectSeasonHallOfFame.mockResolvedValue(EMPTY_PAYLOAD);
    const w = mount(AdminHallOfFameView, { global: { plugins: [i18n] } });
    await flushPromises();
    expect(apiMocks.getAdminSectSeasonHallOfFame).not.toHaveBeenCalled();
    expect(w.find('[data-testid="admin-hof-forbidden"]').exists()).toBe(true);
  });

  it('MOD role → vẫn không phải ADMIN → forbidden (Phase 15.8 ADMIN-only)', async () => {
    authState.role = 'MOD';
    apiMocks.getAdminSectSeasonHallOfFame.mockResolvedValue(EMPTY_PAYLOAD);
    const w = mount(AdminHallOfFameView, { global: { plugins: [i18n] } });
    await flushPromises();
    expect(apiMocks.getAdminSectSeasonHallOfFame).not.toHaveBeenCalled();
    expect(w.find('[data-testid="admin-hof-forbidden"]').exists()).toBe(true);
  });

  it('admin + empty payload → empty state', async () => {
    apiMocks.getAdminSectSeasonHallOfFame.mockResolvedValue(EMPTY_PAYLOAD);
    const w = mount(AdminHallOfFameView, { global: { plugins: [i18n] } });
    await flushPromises();
    expect(apiMocks.getAdminSectSeasonHallOfFame).toHaveBeenCalledTimes(1);
    expect(w.find('[data-testid="admin-hof-empty"]').exists()).toBe(true);
    expect(w.find('[data-testid="admin-hof-seasons"]').exists()).toBe(false);
  });

  it('admin + populated payload → render seasons + reward status + aggregate', async () => {
    apiMocks.getAdminSectSeasonHallOfFame.mockResolvedValue(POPULATED_PAYLOAD);
    const w = mount(AdminHallOfFameView, { global: { plugins: [i18n] } });
    await flushPromises();

    expect(w.find('[data-testid="admin-hof-seasons"]').exists()).toBe(true);
    expect(w.find('[data-testid="admin-hof-season-season_2026_s1"]').exists()).toBe(
      true,
    );
    expect(w.find('[data-testid="admin-hof-season-season_2026_s2"]').exists()).toBe(
      true,
    );
    expect(w.find('[data-testid="admin-hof-aggregate"]').exists()).toBe(true);
    expect(w.find('[data-testid="admin-hof-top-sects"]').exists()).toBe(true);
    expect(w.find('[data-testid="admin-hof-top-members"]').exists()).toBe(true);

    // Reward status: s1 đã grant, s2 chưa.
    const s1 = w.find('[data-testid="admin-hof-season-season_2026_s1"]');
    expect(s1.text()).toContain('SectA');
    // Filter count badge shows total/visible.
    expect(w.find('[data-testid="admin-hof-filter-count"]').text()).toContain('2/2');
  });

  it('filter season key → chỉ giữ row khớp', async () => {
    apiMocks.getAdminSectSeasonHallOfFame.mockResolvedValue(POPULATED_PAYLOAD);
    const w = mount(AdminHallOfFameView, { global: { plugins: [i18n] } });
    await flushPromises();
    const input = w.find('[data-testid="admin-hof-filter-season"]');
    await input.setValue('s2');
    await flushPromises();
    expect(w.find('[data-testid="admin-hof-season-season_2026_s1"]').exists()).toBe(
      false,
    );
    expect(w.find('[data-testid="admin-hof-season-season_2026_s2"]').exists()).toBe(
      true,
    );
    expect(w.find('[data-testid="admin-hof-filter-count"]').text()).toContain('1/2');
  });

  it('filter MVP character → narrow list', async () => {
    apiMocks.getAdminSectSeasonHallOfFame.mockResolvedValue(POPULATED_PAYLOAD);
    const w = mount(AdminHallOfFameView, { global: { plugins: [i18n] } });
    await flushPromises();
    await w.find('[data-testid="admin-hof-filter-mvp"]').setValue('Bao');
    await flushPromises();
    expect(w.find('[data-testid="admin-hof-season-season_2026_s2"]').exists()).toBe(
      true,
    );
    expect(w.find('[data-testid="admin-hof-season-season_2026_s1"]').exists()).toBe(
      false,
    );
  });

  it('clear filter → khôi phục đầy đủ list', async () => {
    apiMocks.getAdminSectSeasonHallOfFame.mockResolvedValue(POPULATED_PAYLOAD);
    const w = mount(AdminHallOfFameView, { global: { plugins: [i18n] } });
    await flushPromises();
    await w.find('[data-testid="admin-hof-filter-sect"]').setValue('SectA');
    await flushPromises();
    expect(w.find('[data-testid="admin-hof-filter-count"]').text()).toContain('1/2');
    await w.find('[data-testid="admin-hof-filter-clear"]').trigger('click');
    await flushPromises();
    expect(w.find('[data-testid="admin-hof-filter-count"]').text()).toContain('2/2');
  });
});
