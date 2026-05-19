import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { createI18n } from 'vue-i18n';
import { setActivePinia, createPinia } from 'pinia';
import type {
  DungeonAvailabilityView,
  DungeonClaimResult,
  DungeonRunStatus,
  DungeonRunView as DungeonRunViewModel,
  DungeonLockReason,
} from '@/api/dungeonRun';

const fetchDungeonRunListMock = vi.fn();
const startDungeonRunMock = vi.fn();
const nextDungeonEncounterMock = vi.fn();
const claimDungeonRunMock = vi.fn();

vi.mock('@/api/dungeonRun', () => ({
  fetchDungeonRunList: (...a: unknown[]) => fetchDungeonRunListMock(...a),
  startDungeonRun: (...a: unknown[]) => startDungeonRunMock(...a),
  nextDungeonEncounter: (...a: unknown[]) => nextDungeonEncounterMock(...a),
  claimDungeonRun: (...a: unknown[]) => claimDungeonRunMock(...a),
}));

vi.mock('@/components/shell/AppShell.vue', () => ({
  default: {
    name: 'AppShellStub',
    template: '<div data-testid="app-shell"><slot /></div>',
  },
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

vi.mock('vue-router', () => ({
  useRouter: () => ({ replace: vi.fn() }),
}));

import DungeonRunView from '@/views/DungeonRunView.vue';

const messages = {
  vi: {
    common: { loadingData: 'Đang tải…', close: 'Đóng' },
    dungeonRun: {
      title: 'Bí Cảnh Hành',
      subtitle: '',
      totalCount: 'Tổng: {n}',
      startableCount: 'Sẵn: {n}',
      activeBadge: 'Đang',
      startableBadge: 'Sẵn',
      progress: 'Ải {cur}/{total}',
      currentMonster: 'Quái:',
      monsterStat: 'Lv {lv} HP {hp} ATK {atk}',
      killedTitle: 'Hạ ({n})',
      lootedItem: '+{name} ×{qty}',
      rewardPreview: '+{linhThach} LT +{tienNgoc} TN +{exp} EXP',
      realmHint: 'Realm {realm}',
      start: 'Khởi',
      next: 'Tiếp',
      claim: 'Lĩnh',
      startToast: 'Khởi {name}',
      advanceToast: 'Tiến {cur}/{total}',
      completedToast: 'Done',
      claimToast: '+{linhThach} LT +{exp} EXP',
      empty: 'Trống',
      emptyFiltered: 'Trống {filter}',
      filter: { all: 'Tất', startable: 'Sẵn', locked: 'Khoá' },
      lockReason: {
        LOCKED_REALM: 'Realm thấp',
        DAILY_LIMIT: 'Hết lượt',
        STAMINA_LOW: 'Thiếu thể lực',
      },
      metric: {
        encounters: 'Số ải',
        stamina: 'Thể lực',
        dailyUsed: 'Lượt',
        bonusReward: 'Thưởng',
      },
      status: {
        ACTIVE: 'Đang',
        COMPLETED: 'Done',
        CLAIMED: 'Lĩnh',
        ABANDONED: 'Bỏ',
      },
      reward: {
        linhThach: '+{n} LT',
        tienNgoc: '+{n} TN',
        exp: '+{n} EXP',
        item: '{itemKey}×{qty}',
      },
      claimModal: {
        title: 'Lĩnh thưởng',
        subtitle: 'Done {templateKey}',
      },
      errors: {
        DUNGEON_LOCKED_REALM: 'Realm thấp',
        ALREADY_IN_RUN: 'Đang trong run',
        RUN_ALREADY_CLAIMED: 'Đã lĩnh',
        UNKNOWN: 'Lỗi',
      },
    },
  },
};

function buildAvailability(
  partial: Partial<DungeonAvailabilityView> & { key: string },
): DungeonAvailabilityView {
  return {
    dungeon: {
      key: partial.key,
      name: partial.dungeon?.name ?? `Dungeon ${partial.key}`,
      description: partial.dungeon?.description ?? 'desc',
      recommendedRealm: partial.dungeon?.recommendedRealm ?? 'phamnhan',
      monsters: partial.dungeon?.monsters ?? ['son_thu_lon'],
      staminaEntry: partial.dungeon?.staminaEntry ?? 5,
      element: partial.dungeon?.element ?? null,
      regionKey: partial.dungeon?.regionKey ?? 'son_coc',
      dailyLimit: partial.dungeon?.dailyLimit,
      runReward: partial.dungeon?.runReward,
    },
    unlocked: partial.unlocked ?? true,
    startable: partial.startable ?? true,
    staminaShort: partial.staminaShort ?? false,
    dailyUsed: partial.dailyUsed ?? 0,
    dailyLimit: partial.dailyLimit ?? null,
    lockReason: (partial.lockReason ?? null) as DungeonLockReason,
  };
}

function buildRun(
  partial: Partial<DungeonRunViewModel> & { id: string; status: DungeonRunStatus },
): DungeonRunViewModel {
  return {
    id: partial.id,
    templateKey: partial.templateKey ?? 'son_coc_normal',
    status: partial.status,
    encounterIndex: partial.encounterIndex ?? 0,
    totalEncounters: partial.totalEncounters ?? 3,
    currentMonster: partial.currentMonster ?? null,
    killedMonsters: partial.killedMonsters ?? [],
    startedAt: partial.startedAt ?? '2026-05-06T00:00:00.000Z',
    completedAt: partial.completedAt ?? null,
    claimedAt: partial.claimedAt ?? null,
    reward: partial.reward ?? { linhThach: 100, exp: 50 },
  };
}

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

function mountView() {
  const i18n = makeI18n();
  return mount(DungeonRunView, {
    global: { plugins: [i18n] },
  });
}

beforeEach(() => {
  setActivePinia(createPinia());
  fetchDungeonRunListMock.mockReset();
  startDungeonRunMock.mockReset();
  nextDungeonEncounterMock.mockReset();
  claimDungeonRunMock.mockReset();
  toastPushMock.mockReset();
});

describe('DungeonRunView — render', () => {
  it('list dungeon hiển thị + lock badge đúng', async () => {
    fetchDungeonRunListMock.mockResolvedValue({
      available: [
        buildAvailability({ key: 'a', startable: true }),
        buildAvailability({ key: 'b', startable: false, lockReason: 'LOCKED_REALM' }),
        buildAvailability({
          key: 'c',
          startable: false,
          lockReason: 'DAILY_LIMIT',
          dailyUsed: 3,
          dailyLimit: 3,
        }),
      ],
      activeRun: null,
    });
    const w = mountView();
    await flushPromises();
    expect(w.find('[data-testid="dungeon-run-list"]').exists()).toBe(true);
    expect(w.find('[data-testid="dungeon-run-row-a"]').exists()).toBe(true);
    expect(w.find('[data-testid="dungeon-run-startable-a"]').exists()).toBe(true);
    expect(w.find('[data-testid="dungeon-run-lock-b"]').text()).toBe('Realm thấp');
    expect(w.find('[data-testid="dungeon-run-lock-c"]').text()).toBe('Hết lượt');
    expect(w.find('[data-testid="dungeon-run-daily-c"]').text()).toBe('3 / 3');
  });

  it('counters đúng tổng + sẵn sàng', async () => {
    fetchDungeonRunListMock.mockResolvedValue({
      available: [
        buildAvailability({ key: 'a', startable: true }),
        buildAvailability({ key: 'b', startable: false, lockReason: 'LOCKED_REALM' }),
        buildAvailability({ key: 'c', startable: true }),
      ],
      activeRun: null,
    });
    const w = mountView();
    await flushPromises();
    expect(w.find('[data-testid="dungeon-run-total-count"]').text()).toBe('Tổng: 3');
    expect(w.find('[data-testid="dungeon-run-startable-count"]').text()).toBe('Sẵn: 2');
  });

  it('empty state khi loaded + filter ra hết', async () => {
    fetchDungeonRunListMock.mockResolvedValue({
      available: [],
      activeRun: null,
    });
    const w = mountView();
    await flushPromises();
    expect(w.find('[data-testid="dungeon-run-empty"]').exists()).toBe(true);
  });

  it('error state khi load thất bại', async () => {
    fetchDungeonRunListMock.mockRejectedValue({ code: 'NO_CHARACTER' });
    const w = mountView();
    await flushPromises();
    expect(w.find('[data-testid="dungeon-run-error"]').exists()).toBe(true);
  });

  it('active run card hiển thị progress + status + next button khi ACTIVE', async () => {
    fetchDungeonRunListMock.mockResolvedValue({
      available: [],
      activeRun: buildRun({
        id: 'r1',
        status: 'ACTIVE',
        encounterIndex: 1,
        totalEncounters: 3,
      }),
    });
    const w = mountView();
    await flushPromises();
    expect(w.find('[data-testid="dungeon-run-active"]').exists()).toBe(true);
    expect(w.find('[data-testid="dungeon-run-active-status"]').text()).toBe('Đang');
    expect(w.find('[data-testid="dungeon-run-active-progress"]').text()).toBe('Ải 1/3');
    expect(w.find('[data-testid="dungeon-run-next"]').exists()).toBe(true);
    expect(w.find('[data-testid="dungeon-run-claim"]').exists()).toBe(false);
  });

  it('Phase 12.3 — kill log render loot từ killedMonsters[i].loot', async () => {
    fetchDungeonRunListMock.mockResolvedValue({
      available: [],
      activeRun: buildRun({
        id: 'r1',
        status: 'ACTIVE',
        encounterIndex: 1,
        totalEncounters: 3,
        killedMonsters: [
          {
            monsterKey: 'son_thu_lon',
            killedAt: '2026-05-06T00:00:30.000Z',
            loot: [
              { itemKey: 'huyet_chi_dan', qty: 2 },
              { itemKey: 'so_kiem', qty: 1 },
            ],
          },
        ],
      }),
    });
    const w = mountView();
    await flushPromises();
    const lootEl = w.find('[data-testid="dungeon-run-killed-0-loot"]');
    expect(lootEl.exists()).toBe(true);
    // formatLoot fallback: itemByKey resolve → name; nếu không tìm được thì
    // dùng itemKey raw. Bất kể 'huyet_chi_dan' tồn tại hay không trong items
    // catalog, output phải chứa tên/key + qty.
    expect(lootEl.text()).toContain('×2');
    expect(lootEl.text()).toContain('×1');
  });

  it('Phase 12.3 — killedMonsters entry KHÔNG có loot field → không render loot span', async () => {
    fetchDungeonRunListMock.mockResolvedValue({
      available: [],
      activeRun: buildRun({
        id: 'r1',
        status: 'ACTIVE',
        encounterIndex: 1,
        totalEncounters: 3,
        killedMonsters: [
          { monsterKey: 'son_thu_lon', killedAt: '2026-05-06T00:00:30.000Z' },
        ],
      }),
    });
    const w = mountView();
    await flushPromises();
    expect(w.find('[data-testid="dungeon-run-killed-0"]').exists()).toBe(true);
    expect(w.find('[data-testid="dungeon-run-killed-0-loot"]').exists()).toBe(false);
  });

  it('active run COMPLETED → claim button hiển thị + reward preview', async () => {
    fetchDungeonRunListMock.mockResolvedValue({
      available: [],
      activeRun: buildRun({
        id: 'r1',
        status: 'COMPLETED',
        encounterIndex: 3,
        totalEncounters: 3,
        completedAt: '2026-05-06T00:30:00.000Z',
        reward: { linhThach: 200, tienNgoc: 0, exp: 100 },
      }),
    });
    const w = mountView();
    await flushPromises();
    expect(w.find('[data-testid="dungeon-run-claim"]').exists()).toBe(true);
    expect(w.find('[data-testid="dungeon-run-next"]').exists()).toBe(false);
    expect(w.find('[data-testid="dungeon-run-reward-preview"]').text()).toContain('200');
  });
});

describe('DungeonRunView — interactions', () => {
  it('click start dungeon → call store.start + toast success', async () => {
    fetchDungeonRunListMock.mockResolvedValueOnce({
      available: [buildAvailability({ key: 'son_coc_normal' })],
      activeRun: null,
    });
    startDungeonRunMock.mockResolvedValue(buildRun({ id: 'r1', status: 'ACTIVE' }));
    fetchDungeonRunListMock.mockResolvedValueOnce({
      available: [buildAvailability({ key: 'son_coc_normal', dailyUsed: 1, dailyLimit: 3 })],
      activeRun: buildRun({ id: 'r1', status: 'ACTIVE' }),
    });
    const w = mountView();
    await flushPromises();
    await w.find('[data-testid="dungeon-run-start-son_coc_normal"]').trigger('click');
    await flushPromises();
    expect(startDungeonRunMock).toHaveBeenCalledWith('son_coc_normal');
    expect(toastPushMock).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'success' }),
    );
  });

  it('start error → toast error code mapped', async () => {
    fetchDungeonRunListMock.mockResolvedValue({
      available: [buildAvailability({ key: 'son_coc_normal' })],
      activeRun: null,
    });
    startDungeonRunMock.mockRejectedValue({ code: 'DUNGEON_LOCKED_REALM' });
    const w = mountView();
    await flushPromises();
    await w.find('[data-testid="dungeon-run-start-son_coc_normal"]').trigger('click');
    await flushPromises();
    expect(toastPushMock).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'error', text: 'Realm thấp' }),
    );
  });

  it('click next → call store.next + toast info advance', async () => {
    fetchDungeonRunListMock.mockResolvedValueOnce({
      available: [],
      activeRun: buildRun({ id: 'r1', status: 'ACTIVE' }),
    });
    const advancedRun = buildRun({
      id: 'r1',
      status: 'ACTIVE',
      encounterIndex: 1,
      totalEncounters: 3,
    });
    nextDungeonEncounterMock.mockResolvedValue(advancedRun);
    fetchDungeonRunListMock.mockResolvedValueOnce({
      available: [],
      activeRun: advancedRun,
    });
    const w = mountView();
    await flushPromises();
    await w.find('[data-testid="dungeon-run-next"]').trigger('click');
    await flushPromises();
    expect(nextDungeonEncounterMock).toHaveBeenCalledWith('r1');
    expect(toastPushMock).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'info' }),
    );
  });

  it('next leads to COMPLETED → toast success completed', async () => {
    fetchDungeonRunListMock.mockResolvedValueOnce({
      available: [],
      activeRun: buildRun({
        id: 'r1',
        status: 'ACTIVE',
        encounterIndex: 2,
        totalEncounters: 3,
      }),
    });
    const completedRun = buildRun({
      id: 'r1',
      status: 'COMPLETED',
      encounterIndex: 3,
      totalEncounters: 3,
      completedAt: '2026-05-06T00:30:00.000Z',
    });
    nextDungeonEncounterMock.mockResolvedValue(completedRun);
    fetchDungeonRunListMock.mockResolvedValueOnce({
      available: [],
      activeRun: completedRun,
    });
    const w = mountView();
    await flushPromises();
    await w.find('[data-testid="dungeon-run-next"]').trigger('click');
    await flushPromises();
    expect(toastPushMock).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'success', text: 'Done' }),
    );
  });

  it('click claim → modal mở + toast success + close modal hoạt động', async () => {
    fetchDungeonRunListMock.mockResolvedValueOnce({
      available: [],
      activeRun: buildRun({
        id: 'r1',
        status: 'COMPLETED',
        encounterIndex: 3,
        totalEncounters: 3,
        completedAt: '2026-05-06T00:30:00.000Z',
      }),
    });
    const claimResult: DungeonClaimResult = {
      runId: 'r1',
      templateKey: 'son_coc_normal',
      claimedAt: '2026-05-06T01:00:00.000Z',
      granted: { linhThach: 200, tienNgoc: 0, exp: 100, items: [{ itemKey: 'gem_a', qty: 2 }] },
    };
    claimDungeonRunMock.mockResolvedValue(claimResult);
    fetchDungeonRunListMock.mockResolvedValueOnce({
      available: [],
      activeRun: buildRun({
        id: 'r1',
        status: 'CLAIMED',
        claimedAt: '2026-05-06T01:00:00.000Z',
      }),
    });
    const w = mountView();
    await flushPromises();
    await w.find('[data-testid="dungeon-run-claim"]').trigger('click');
    await flushPromises();
    expect(w.find('[data-testid="dungeon-run-claim-modal"]').exists()).toBe(true);
    expect(w.find('[data-testid="dungeon-run-claim-linh-thach"]').exists()).toBe(true);
    expect(w.find('[data-testid="dungeon-run-claim-exp"]').exists()).toBe(true);
    expect(w.find('[data-testid="dungeon-run-claim-item-0"]').text()).toContain('gem_a');
    expect(toastPushMock).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'success' }),
    );
    await w.find('[data-testid="dungeon-run-claim-close"]').trigger('click');
    expect(w.find('[data-testid="dungeon-run-claim-modal"]').exists()).toBe(false);
  });

  it('claim error → toast error mapped (RUN_ALREADY_CLAIMED)', async () => {
    fetchDungeonRunListMock.mockResolvedValue({
      available: [],
      activeRun: buildRun({
        id: 'r1',
        status: 'COMPLETED',
        encounterIndex: 3,
        totalEncounters: 3,
        completedAt: '2026-05-06T00:30:00.000Z',
      }),
    });
    claimDungeonRunMock.mockRejectedValue({ code: 'RUN_ALREADY_CLAIMED' });
    const w = mountView();
    await flushPromises();
    await w.find('[data-testid="dungeon-run-claim"]').trigger('click');
    await flushPromises();
    expect(toastPushMock).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'error', text: 'Đã lĩnh' }),
    );
  });
});

describe('DungeonRunView — filter', () => {
  it('filter "startable" → chỉ show dungeon startable', async () => {
    fetchDungeonRunListMock.mockResolvedValue({
      available: [
        buildAvailability({ key: 'a', startable: true }),
        buildAvailability({ key: 'b', startable: false, lockReason: 'LOCKED_REALM' }),
      ],
      activeRun: null,
    });
    const w = mountView();
    await flushPromises();
    await w.find('[data-testid="dungeon-run-filter-startable"]').trigger('click');
    expect(w.find('[data-testid="dungeon-run-row-a"]').exists()).toBe(true);
    expect(w.find('[data-testid="dungeon-run-row-b"]').exists()).toBe(false);
  });

  it('filter "locked" → chỉ show dungeon bị khoá', async () => {
    fetchDungeonRunListMock.mockResolvedValue({
      available: [
        buildAvailability({ key: 'a', startable: true }),
        buildAvailability({ key: 'b', startable: false, lockReason: 'LOCKED_REALM' }),
      ],
      activeRun: null,
    });
    const w = mountView();
    await flushPromises();
    await w.find('[data-testid="dungeon-run-filter-locked"]').trigger('click');
    expect(w.find('[data-testid="dungeon-run-row-a"]').exists()).toBe(false);
    expect(w.find('[data-testid="dungeon-run-row-b"]').exists()).toBe(true);
  });
});

describe('DungeonRunView — role hint + cross-nav', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
  });

  it('render role hint', async () => {
    fetchDungeonRunListMock.mockResolvedValue({ available: [], activeRun: null });
    const w = mountView();
    await flushPromises();
    expect(w.find('[data-testid="dungeon-run-role-section"]').exists()).toBe(true);
    expect(w.find('[data-testid="dungeon-run-role-hint"]').text()).toBeTruthy();
  });

  it('render cross-nav với link đúng', async () => {
    fetchDungeonRunListMock.mockResolvedValue({ available: [], activeRun: null });
    const w = mountView();
    await flushPromises();
    expect(w.find('[data-testid="dungeon-run-cross-nav"]').exists()).toBe(true);
    expect(w.find('[data-testid="dungeon-run-cross-nav-dungeon"]').exists()).toBe(true);
    expect(w.find('[data-testid="dungeon-run-cross-nav-combat"]').exists()).toBe(true);
  });
});
