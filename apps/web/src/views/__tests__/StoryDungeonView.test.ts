import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { createI18n } from 'vue-i18n';
import { setActivePinia, createPinia } from 'pinia';
import type {
  StoryDungeonAvailabilityStatus,
  StoryDungeonClaimResult,
  StoryDungeonRunStatus,
  StoryDungeonRunView,
  StoryDungeonView as StoryDungeonViewModel,
} from '@/api/storyDungeon';

/**
 * Phase 12.8.D — StoryDungeonView UI test coverage.
 *
 * Cover §F mục 1 + 2 + 4 + 5 cho `StoryDungeonView.vue`:
 *   - 1. renders locked / available / cleared status badges + counters.
 *   - 2. start button calls API + toast success.
 *   - 4. claim reward success state → reward modal mở + toast success.
 *   - 5. API error fallback → render error block, không crash.
 *
 * Mock `@/api/storyDungeon` để Pinia store thật chạy → cover store ↔ view loop.
 */

const fetchListMock = vi.fn();
const fetchOneMock = vi.fn();
const startMock = vi.fn();
const advanceMock = vi.fn();
const clearMock = vi.fn();
const claimMock = vi.fn();

vi.mock('@/api/storyDungeon', () => ({
  fetchStoryDungeonList: (...a: unknown[]) => fetchListMock(...a),
  fetchStoryDungeon: (...a: unknown[]) => fetchOneMock(...a),
  startStoryDungeon: (...a: unknown[]) => startMock(...a),
  advanceStoryDungeon: (...a: unknown[]) => advanceMock(...a),
  clearStoryDungeon: (...a: unknown[]) => clearMock(...a),
  claimStoryDungeon: (...a: unknown[]) => claimMock(...a),
}));

const toastPushMock = vi.fn();

vi.mock('@/stores/auth', () => ({
  useAuthStore: () => ({
    isAuthenticated: true,
    hydrate: vi.fn().mockResolvedValue(undefined),
  }),
}));

vi.mock('@/stores/game', () => ({
  useGameStore: () => ({
    character: { id: 'c1', realmKey: 'phamnhan' },
    fetchState: vi.fn().mockResolvedValue(undefined),
  }),
}));

vi.mock('@/stores/toast', () => ({
  useToastStore: () => ({ push: toastPushMock }),
}));

const routerReplaceMock = vi.fn();
vi.mock('vue-router', () => ({
  useRouter: () => ({ replace: routerReplaceMock, push: vi.fn() }),
}));

vi.mock('@/components/shell/AppShell.vue', () => ({
  default: {
    name: 'AppShellStub',
    template: '<div data-testid="app-shell"><slot /></div>',
  },
}));

import StoryDungeonView from '@/views/StoryDungeonView.vue';

const messages = {
  vi: {
    common: { close: 'Đóng', loadingData: 'Đang tải…' },
    storyDungeon: {
      title: 'Bí Cảnh Cốt Truyện',
      subtitle: 'sub',
      totalCount: 'Tổng: {n}',
      availableCount: 'Có thể vào: {n}',
      lockedCount: 'Khoá: {n}',
      clearedCount: 'Đã thông: {n}',
      regionHint: 'Khu vực: {region}',
      realmHint: 'Đề nghị: {realm}',
      rewardPreview: '+{linhThach} LT · +{tienNgoc} TN · +{exp} EXP',
      oneTimeBadge: '1 LẦN',
      start: 'Khởi hành',
      resume: 'Tiếp tục',
      startToast: 'Bí cảnh {name} đã khởi hành.',
      advanceToast: 'Đã tiến — {cur}/{total}.',
      readyToClearToast: 'Sẵn sàng kết thúc.',
      clearToast: 'Đã hoàn tất.',
      claimToast: 'Đã lĩnh +{linhThach} LT · +{exp} EXP.',
      empty: 'Chưa có bí cảnh.',
      emptyFiltered: 'Không có {filter}.',
      filter: { all: 'Tất cả', available: 'Có thể', locked: 'Khoá', cleared: 'Đã thông' },
      status: { available: 'Có thể vào', locked: 'Đang khoá', cleared: 'Đã thông' },
      metric: {
        requiredQuest: 'Quest yêu cầu',
        encounters: 'Số bước',
        boss: 'Đại ma',
        bonusReward: 'Thưởng',
      },
      run: {
        activeBadge: 'Đang trong',
        progress: 'Bước {cur}/{total}',
        currentMonster: 'Sắp đối đầu',
        monsterStat: 'Lv {lv} · HP {hp} · Công {atk}',
        killedTitle: 'Đã hạ ({n})',
        bossHint: 'Boss: {name}',
        rewardPreview: '+{linhThach} LT · +{tienNgoc} TN · +{exp} EXP',
        realmHint: 'Realm: {realm}',
        advance: 'Tiến',
        clear: 'Kết',
        claim: 'Lĩnh',
        entryDialogue: 'Đầu',
        clearDialogue: 'Kết thoại',
      },
      runStatus: {
        ACTIVE: 'Đang vận hành',
        CLEARED: 'Đã thông',
        CLAIMED: 'Đã lĩnh',
        FAILED: 'Thất bại',
      },
      dialogue: {
        narratorFallback: 'Người dẫn',
        empty: 'Trống.',
      },
      reward: {
        modalTitle: 'Lĩnh thưởng',
        modalSubtitle: 'Đã hoàn tất {templateKey}.',
        linhThach: '+{n} LT',
        tienNgoc: '+{n} TN',
        exp: '+{n} EXP',
        item: '{name} ×{qty}',
      },
      errors: {
        DUNGEON_LOCKED: 'Khoá: chưa đủ điều kiện.',
        NO_CHARACTER: 'Chưa có nhân vật.',
        UNKNOWN: 'Lỗi.',
        UNKNOWN_ERROR: 'Lỗi.',
      },
    },
  },
};

function makeI18n() {
  return createI18n({
    legacy: false,
    locale: 'vi',
    fallbackLocale: 'vi',
    missingWarn: false,
    fallbackWarn: false,
    messages,
  });
}

function buildDungeon(
  partial: Partial<StoryDungeonViewModel> & {
    key: string;
    status: StoryDungeonAvailabilityStatus;
  },
): StoryDungeonViewModel {
  return {
    key: partial.key,
    titleI18nKey: partial.titleI18nKey ?? `story.${partial.key}.title`,
    descriptionI18nKey: partial.descriptionI18nKey ?? `story.${partial.key}.desc`,
    titleVi: partial.titleVi ?? `Bí cảnh ${partial.key}`,
    descriptionVi: partial.descriptionVi ?? 'desc',
    requiredQuestKey: partial.requiredQuestKey ?? 'q1',
    requiredQuestStep: partial.requiredQuestStep ?? null,
    regionKey: partial.regionKey ?? 'son_coc',
    recommendedRealm: partial.recommendedRealm ?? 'phamnhan',
    minRealmKey: partial.minRealmKey ?? null,
    npcKey: partial.npcKey ?? null,
    entryDialogueKey: partial.entryDialogueKey ?? null,
    clearDialogueKey: partial.clearDialogueKey ?? null,
    monsters: partial.monsters ?? [],
    boss: partial.boss ?? null,
    rewardHint: partial.rewardHint ?? null,
    oneTime: partial.oneTime ?? true,
    status: partial.status,
  };
}

function buildRun(
  partial: Partial<StoryDungeonRunView> & { id: string; status: StoryDungeonRunStatus },
): StoryDungeonRunView {
  return {
    id: partial.id,
    templateKey: partial.templateKey ?? 'a',
    status: partial.status,
    currentStep: partial.currentStep ?? 0,
    totalSteps: partial.totalSteps ?? 3,
    currentMonster: partial.currentMonster ?? null,
    killedMonsters: partial.killedMonsters ?? [],
    startedAt: partial.startedAt ?? '2026-05-07T00:00:00.000Z',
    clearedAt: partial.clearedAt ?? null,
    claimedAt: partial.claimedAt ?? null,
    rewardHint: partial.rewardHint ?? null,
  };
}

function mountView() {
  return mount(StoryDungeonView, {
    attachTo: document.body,
    global: { plugins: [makeI18n()] },
  });
}

beforeEach(() => {
  setActivePinia(createPinia());
  fetchListMock.mockReset();
  fetchOneMock.mockReset();
  startMock.mockReset();
  advanceMock.mockReset();
  clearMock.mockReset();
  claimMock.mockReset();
  toastPushMock.mockReset();
  routerReplaceMock.mockReset();
});

afterEach(() => {
  document.body.innerHTML = '';
});

describe('StoryDungeonView — render danh sách + status badges', () => {
  it('loaded → render list + status badge available/locked/cleared + counters', async () => {
    fetchListMock.mockResolvedValue({
      dungeons: [
        buildDungeon({ key: 'd_avail', status: 'available', titleVi: 'Bí cảnh A' }),
        buildDungeon({ key: 'd_lock', status: 'locked', titleVi: 'Bí cảnh B' }),
        buildDungeon({ key: 'd_clr', status: 'cleared', titleVi: 'Bí cảnh C' }),
      ],
      activeRun: null,
    });
    const w = mountView();
    await flushPromises();

    expect(w.find('[data-testid="story-dungeon-view"]').exists()).toBe(true);
    expect(w.find('[data-testid="story-dungeon-list"]').exists()).toBe(true);

    // Status badges
    expect(w.find('[data-testid="story-dungeon-status-d_avail"]').text()).toBe('Có thể vào');
    expect(w.find('[data-testid="story-dungeon-status-d_lock"]').text()).toBe('Đang khoá');
    expect(w.find('[data-testid="story-dungeon-status-d_clr"]').text()).toBe('Đã thông');

    // Rows
    expect(w.find('[data-testid="story-dungeon-row-d_avail"]').exists()).toBe(true);
    expect(w.find('[data-testid="story-dungeon-row-d_lock"]').exists()).toBe(true);
    expect(w.find('[data-testid="story-dungeon-row-d_clr"]').exists()).toBe(true);

    // Counters
    expect(w.find('[data-testid="story-dungeon-total-count"]').text()).toContain('3');
    expect(w.find('[data-testid="story-dungeon-available-count"]').text()).toContain('1');
    expect(w.find('[data-testid="story-dungeon-cleared-count"]').text()).toContain('1');
    w.unmount();
  });

  it('start button: locked → disabled, available → enabled', async () => {
    fetchListMock.mockResolvedValue({
      dungeons: [
        buildDungeon({ key: 'd_avail', status: 'available' }),
        buildDungeon({ key: 'd_lock', status: 'locked' }),
        buildDungeon({ key: 'd_clr', status: 'cleared' }),
      ],
      activeRun: null,
    });
    const w = mountView();
    await flushPromises();
    const avail = w.find('[data-testid="story-dungeon-start-d_avail"]')
      .element as HTMLButtonElement;
    const lock = w.find('[data-testid="story-dungeon-start-d_lock"]')
      .element as HTMLButtonElement;
    const clr = w.find('[data-testid="story-dungeon-start-d_clr"]')
      .element as HTMLButtonElement;
    expect(avail.disabled).toBe(false);
    expect(lock.disabled).toBe(true);
    expect(clr.disabled).toBe(true);
    w.unmount();
  });

  it('filter "available" → ẩn locked/cleared rows', async () => {
    fetchListMock.mockResolvedValue({
      dungeons: [
        buildDungeon({ key: 'd_avail', status: 'available' }),
        buildDungeon({ key: 'd_lock', status: 'locked' }),
        buildDungeon({ key: 'd_clr', status: 'cleared' }),
      ],
      activeRun: null,
    });
    const w = mountView();
    await flushPromises();
    await w.find('[data-testid="story-dungeon-filter-available"]').trigger('click');
    await flushPromises();
    expect(w.find('[data-testid="story-dungeon-row-d_avail"]').exists()).toBe(true);
    expect(w.find('[data-testid="story-dungeon-row-d_lock"]').exists()).toBe(false);
    expect(w.find('[data-testid="story-dungeon-row-d_clr"]').exists()).toBe(false);
    w.unmount();
  });

  it('filter rỗng → render empty filtered placeholder', async () => {
    fetchListMock.mockResolvedValue({
      dungeons: [buildDungeon({ key: 'd_avail', status: 'available' })],
      activeRun: null,
    });
    const w = mountView();
    await flushPromises();
    await w.find('[data-testid="story-dungeon-filter-locked"]').trigger('click');
    await flushPromises();
    const empty = w.find('[data-testid="story-dungeon-empty"]');
    expect(empty.exists()).toBe(true);
    w.unmount();
  });
});

describe('StoryDungeonView — start CTA', () => {
  it('start success → call API + toast success + auto-load reload', async () => {
    fetchListMock
      .mockResolvedValueOnce({
        dungeons: [buildDungeon({ key: 'd1', status: 'available', titleVi: 'Bí Cảnh X' })],
        activeRun: null,
      })
      .mockResolvedValueOnce({
        dungeons: [buildDungeon({ key: 'd1', status: 'available', titleVi: 'Bí Cảnh X' })],
        activeRun: buildRun({ id: 'r1', status: 'ACTIVE', templateKey: 'd1' }),
      });
    startMock.mockResolvedValue(buildRun({ id: 'r1', status: 'ACTIVE', templateKey: 'd1' }));

    const w = mountView();
    await flushPromises();
    await w.find('[data-testid="story-dungeon-start-d1"]').trigger('click');
    await flushPromises();

    expect(startMock).toHaveBeenCalledWith('d1');
    expect(toastPushMock).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'success', text: expect.stringContaining('Bí Cảnh X') }),
    );
    // After reload — activeRun set, RunPanel render
    expect(w.find('[data-testid="story-dungeon-run-panel"]').exists()).toBe(true);
    w.unmount();
  });

  it('start error envelope DUNGEON_LOCKED → toast error i18n', async () => {
    fetchListMock.mockResolvedValue({
      dungeons: [buildDungeon({ key: 'd1', status: 'available' })],
      activeRun: null,
    });
    startMock.mockRejectedValue({ code: 'DUNGEON_LOCKED' });

    const w = mountView();
    await flushPromises();
    await w.find('[data-testid="story-dungeon-start-d1"]').trigger('click');
    await flushPromises();

    expect(toastPushMock).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'error', text: 'Khoá: chưa đủ điều kiện.' }),
    );
    w.unmount();
  });

  it('start unknown error → toast UNKNOWN i18n (no crash)', async () => {
    fetchListMock.mockResolvedValue({
      dungeons: [buildDungeon({ key: 'd1', status: 'available' })],
      activeRun: null,
    });
    startMock.mockRejectedValue(new Error('boom'));

    const w = mountView();
    await flushPromises();
    await w.find('[data-testid="story-dungeon-start-d1"]').trigger('click');
    await flushPromises();

    expect(toastPushMock).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'error', text: 'Lỗi.' }),
    );
    w.unmount();
  });
});

describe('StoryDungeonView — active run panel + claim flow', () => {
  it('activeRun từ server → render StoryDungeonRunPanel inline', async () => {
    fetchListMock.mockResolvedValue({
      dungeons: [buildDungeon({ key: 'd1', status: 'available', titleVi: 'Bí Cảnh X' })],
      activeRun: buildRun({
        id: 'r1',
        status: 'ACTIVE',
        templateKey: 'd1',
        currentStep: 1,
        totalSteps: 3,
      }),
    });
    const w = mountView();
    await flushPromises();
    expect(w.find('[data-testid="story-dungeon-run-panel"]').exists()).toBe(true);
    expect(w.find('[data-testid="story-dungeon-run-title"]').text()).toBe('Bí Cảnh X');
    expect(w.find('[data-testid="story-dungeon-active-d1"]').exists()).toBe(true);
    w.unmount();
  });

  it('claim success → reward modal mở + toast success + linhThach/exp render', async () => {
    fetchListMock
      .mockResolvedValueOnce({
        dungeons: [buildDungeon({ key: 'd1', status: 'available' })],
        activeRun: buildRun({
          id: 'r1',
          status: 'CLEARED',
          templateKey: 'd1',
          currentStep: 3,
          totalSteps: 3,
          clearedAt: '2026-05-07T01:00:00.000Z',
        }),
      })
      .mockResolvedValueOnce({
        dungeons: [buildDungeon({ key: 'd1', status: 'cleared' })],
        activeRun: buildRun({
          id: 'r1',
          status: 'CLAIMED',
          templateKey: 'd1',
          currentStep: 3,
          totalSteps: 3,
          clearedAt: '2026-05-07T01:00:00.000Z',
          claimedAt: '2026-05-07T02:00:00.000Z',
        }),
      });
    const claimResult: StoryDungeonClaimResult = {
      runId: 'r1',
      templateKey: 'd1',
      claimedAt: '2026-05-07T02:00:00.000Z',
      granted: { linhThach: 250, tienNgoc: 1, exp: 800, items: [] },
    };
    claimMock.mockResolvedValue(claimResult);

    const w = mountView();
    await flushPromises();
    await w.find('[data-testid="story-dungeon-run-claim"]').trigger('click');
    await flushPromises();

    expect(claimMock).toHaveBeenCalledWith('r1');
    // Reward modal teleported → query body
    expect(document.querySelector('[data-testid="story-dungeon-reward-modal"]')).not.toBeNull();
    expect(
      document.querySelector('[data-testid="story-dungeon-reward-linh-thach"]')?.textContent,
    ).toContain('250');
    expect(
      document.querySelector('[data-testid="story-dungeon-reward-exp"]')?.textContent,
    ).toContain('800');
    expect(toastPushMock).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'success' }),
    );
    w.unmount();
  });

  it('advance success → toast info advance', async () => {
    fetchListMock
      .mockResolvedValueOnce({
        dungeons: [buildDungeon({ key: 'd1', status: 'available' })],
        activeRun: buildRun({
          id: 'r1',
          status: 'ACTIVE',
          templateKey: 'd1',
          currentStep: 0,
          totalSteps: 3,
        }),
      })
      .mockResolvedValueOnce({
        dungeons: [buildDungeon({ key: 'd1', status: 'available' })],
        activeRun: buildRun({
          id: 'r1',
          status: 'ACTIVE',
          templateKey: 'd1',
          currentStep: 1,
          totalSteps: 3,
        }),
      });
    advanceMock.mockResolvedValue(
      buildRun({
        id: 'r1',
        status: 'ACTIVE',
        templateKey: 'd1',
        currentStep: 1,
        totalSteps: 3,
      }),
    );

    const w = mountView();
    await flushPromises();
    await w.find('[data-testid="story-dungeon-run-advance"]').trigger('click');
    await flushPromises();
    expect(advanceMock).toHaveBeenCalledWith('r1');
    expect(toastPushMock).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'info', text: expect.stringContaining('1/3') }),
    );
    w.unmount();
  });
});

describe('StoryDungeonView — error / empty / loading', () => {
  it('lastError sau load fail → render error block (KHÔNG crash)', async () => {
    fetchListMock.mockRejectedValue({ code: 'NO_CHARACTER' });
    const w = mountView();
    await flushPromises();
    const err = w.find('[data-testid="story-dungeon-error"]');
    expect(err.exists()).toBe(true);
    expect(err.text()).toBe('Chưa có nhân vật.');
    expect(w.find('[data-testid="story-dungeon-list"]').exists()).toBe(false);
    w.unmount();
  });

  it('loaded + dungeons rỗng → render empty placeholder', async () => {
    fetchListMock.mockResolvedValue({ dungeons: [], activeRun: null });
    const w = mountView();
    await flushPromises();
    expect(w.find('[data-testid="story-dungeon-empty"]').exists()).toBe(true);
    w.unmount();
  });

  it('loading khi chưa loaded → render loading block', async () => {
    let resolveFn: (
      v: { dungeons: StoryDungeonViewModel[]; activeRun: StoryDungeonRunView | null },
    ) => void = () => {};
    fetchListMock.mockReturnValue(
      new Promise<{
        dungeons: StoryDungeonViewModel[];
        activeRun: StoryDungeonRunView | null;
      }>((resolve) => {
        resolveFn = resolve;
      }),
    );
    const w = mountView();
    await flushPromises();
    expect(w.find('[data-testid="story-dungeon-loading"]').exists()).toBe(true);
    resolveFn({ dungeons: [], activeRun: null });
    await flushPromises();
    w.unmount();
  });
});
