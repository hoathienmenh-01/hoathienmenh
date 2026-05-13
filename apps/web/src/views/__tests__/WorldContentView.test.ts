import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { createI18n } from 'vue-i18n';
import { setActivePinia, createPinia } from 'pinia';

/**
 * Phase 26.5 — WorldContentView tests (summary dashboard).
 *
 * Bao phủ 4 state UI MODULE RULE: loading / empty / error / list.
 */

const { getWorldSummaryMock } = vi.hoisted(() => ({
  getWorldSummaryMock: vi.fn(),
}));

vi.mock('@/api/worldContent', async () => {
  const actual: object = await vi.importActual('@/api/worldContent');
  return {
    ...actual,
    getWorldSummary: getWorldSummaryMock,
    listFarmMaps: vi.fn(),
    listDungeonsV2: vi.fn(),
    listBossesV2: vi.fn(),
    listSectDungeons: vi.fn(),
    listSectBosses: vi.fn(),
    listOpportunities: vi.fn(),
    listTrialTowers: vi.fn(),
  };
});

vi.mock('@/components/shell/AppShell.vue', () => ({
  default: {
    name: 'AppShellStub',
    template: '<div data-testid="app-shell"><slot /></div>',
  },
}));

import WorldContentView from '@/views/WorldContentView.vue';
import viMessages from '@/i18n/vi.json';

const i18n = createI18n({
  legacy: false,
  locale: 'vi',
  fallbackLocale: 'vi',
  missingWarn: false,
  fallbackWarn: false,
  messages: { vi: viMessages },
});

vi.mock('vue-router', () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

function mountView() {
  return mount(WorldContentView, {
    global: {
      plugins: [i18n],
    },
  });
}

beforeEach(() => {
  setActivePinia(createPinia());
  vi.clearAllMocks();
});

describe('WorldContentView', () => {
  it('hiển thị loading state khi đang fetch summary', async () => {
    let resolveFn: (v: unknown) => void = () => undefined;
    getWorldSummaryMock.mockReturnValueOnce(
      new Promise((res) => {
        resolveFn = res;
      }),
    );
    const w = mountView();
    expect(w.find('[data-testid="world-content-loading"]').exists()).toBe(true);
    resolveFn(buildSummary(1));
    await flushPromises();
  });

  it('hiển thị error state khi fetch thất bại + nút reload', async () => {
    getWorldSummaryMock.mockRejectedValueOnce(new Error('boom'));
    const w = mountView();
    await flushPromises();
    expect(w.find('[data-testid="world-content-error"]').exists()).toBe(true);
    getWorldSummaryMock.mockResolvedValueOnce(buildSummary(2));
    await w.find('[data-testid="world-content-error"] button').trigger('click');
    await flushPromises();
    expect(w.find('[data-testid="world-content-list"]').exists()).toBe(true);
  });

  it('render list khi có summary', async () => {
    getWorldSummaryMock.mockResolvedValueOnce(buildSummary(3));
    const w = mountView();
    await flushPromises();
    expect(w.find('[data-testid="world-content-list"]').exists()).toBe(true);
    expect(w.find('[data-testid="world-content-region-table"]').exists()).toBe(true);
  });
});

function buildSummary(regions: number) {
  return {
    totalRegions: regions,
    totalFarmMaps: 5,
    totalDungeons: 4,
    totalStoryDungeons: 1,
    totalSectDungeons: 3,
    totalTrialTowers: 3,
    totalBosses: 7,
    totalWorldBosses: 1,
    totalEventBosses: 1,
    totalSectBosses: 1,
    totalQuestBosses: 2,
    totalMonsters: 20,
    totalEliteMonsters: 5,
    totalOpportunities: 8,
    contentByRegion: Array.from({ length: regions }, (_, i) => ({
      regionKey: `region_${i + 1}`,
      farmMaps: 2,
      dungeons: 1,
      bosses: 1,
      opportunities: 1,
    })),
  };
}
