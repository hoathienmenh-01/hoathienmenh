import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { createI18n } from 'vue-i18n';
import { setActivePinia, createPinia } from 'pinia';

/**
 * Phase 11 nâng cao §5 PR3 — BreakthroughView test suite.
 *
 * Bao phủ:
 *  - Pre-attempt: button render disabled khi !atPeak, enabled khi atPeak.
 *  - Click attempt → store.attempt called, toast fired theo branch.
 *  - Outcome banner success render (chance breakdown, transition).
 *  - Outcome banner fail render với debuff hint (tam_ma_light).
 *  - History list render rows + filter buttons toggle.
 *  - Empty history hint + load-more button khi historyHasMore.
 */

interface CharacterStub {
  realmKey: string;
  realmStage: number;
  exp: string;
  expNext: string;
}

type HistoryFilterStub = 'all' | 'success' | 'fail';
type HistoryRowStub = {
  id: string;
  fromRealmKey: string;
  fromRealmStage: number;
  toRealmKey: string;
  toRealmStage: number;
  chance: number;
  rngRoll: number;
  success: boolean;
  attemptIndex: number;
  tamMaActive: boolean;
  createdAt: string;
};

interface BreakthroughStateStub {
  lastOutcome: unknown;
  inFlight: boolean;
  lastError: string | null;
  history: HistoryRowStub[] | null;
  historyLoading: boolean;
  historyError: string | null;
  historyLimit: number;
  historyHasMore: boolean;
  historyMaxReached: boolean;
  historyFilter: HistoryFilterStub;
  readonly filteredHistory: HistoryRowStub[] | null;
  readonly historyTotalCount: number;
  readonly historySuccessCount: number;
  readonly historyFailCount: number;
  attempt: ReturnType<typeof vi.fn>;
  clearLastOutcome: ReturnType<typeof vi.fn>;
  fetchHistory: ReturnType<typeof vi.fn>;
  loadMoreHistory: ReturnType<typeof vi.fn>;
  setHistoryFilter: ReturnType<typeof vi.fn>;
}

const replaceMock = vi.fn();
const attemptMock = vi.fn();
const clearLastOutcomeMock = vi.fn();
const fetchHistoryMock = vi.fn().mockResolvedValue(null);
const loadMoreHistoryMock = vi.fn().mockResolvedValue(null);
const setHistoryFilterMock = vi.fn((filter: HistoryFilterStub) => {
  if (filter === 'all' || filter === 'success' || filter === 'fail') {
    btState.historyFilter = filter;
  }
});
const fetchStateMock = vi.fn().mockResolvedValue(undefined);
const toastPushMock = vi.fn();

const btState: BreakthroughStateStub = {
  lastOutcome: null,
  inFlight: false,
  lastError: null,
  history: null,
  historyLoading: false,
  historyError: null,
  historyLimit: 20,
  historyHasMore: false,
  historyMaxReached: false,
  historyFilter: 'all',
  get filteredHistory(): HistoryRowStub[] | null {
    const rows = this.history;
    if (!rows) return null;
    if (this.historyFilter === 'success') return rows.filter((r) => r.success);
    if (this.historyFilter === 'fail') return rows.filter((r) => !r.success);
    return rows;
  },
  get historyTotalCount(): number {
    return this.history?.length ?? 0;
  },
  get historySuccessCount(): number {
    return this.history?.filter((r) => r.success).length ?? 0;
  },
  get historyFailCount(): number {
    return this.history?.filter((r) => !r.success).length ?? 0;
  },
  attempt: attemptMock,
  clearLastOutcome: clearLastOutcomeMock,
  fetchHistory: fetchHistoryMock,
  loadMoreHistory: loadMoreHistoryMock,
  setHistoryFilter: setHistoryFilterMock,
};

const gameState: { character: CharacterStub | null; realmFullName: string } = {
  character: null,
  realmFullName: 'Trúc Cơ Cửu Trọng',
};

vi.mock('@/stores/auth', () => ({
  useAuthStore: () => ({
    hydrate: vi.fn().mockResolvedValue(undefined),
    isAuthenticated: true,
  }),
}));
vi.mock('@/stores/game', () => ({
  useGameStore: () => ({
    fetchState: fetchStateMock,
    get character() {
      return gameState.character;
    },
    get realmFullName() {
      return gameState.realmFullName;
    },
  }),
}));
vi.mock('@/stores/breakthrough', () => ({
  useBreakthroughStore: () => btState,
}));
vi.mock('@/stores/toast', () => ({
  useToastStore: () => ({
    push: toastPushMock,
  }),
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
vi.mock('@/components/ui/MButton.vue', () => ({
  default: {
    name: 'MButtonStub',
    props: ['loading', 'disabled'],
    template:
      '<button :disabled="disabled || loading" v-bind="$attrs"><slot /></button>',
  },
}));

import BreakthroughView from '@/views/BreakthroughView.vue';

const i18n = createI18n({
  legacy: false,
  locale: 'vi',
  fallbackLocale: 'vi',
  missingWarn: false,
  fallbackWarn: false,
  messages: {
    vi: {
      common: {
        loadingData: 'Đang tải…',
        apiFallback: { breakthrough: 'Đột phá thất bại' },
      },
      breakthrough: {
        title: 'Đột Phá',
        subtitle: 'sub',
        currentRealm: 'Cảnh giới: {realm}',
        action: {
          title: 'Khởi sự',
          peakHint: 'Đã peak',
          notPeakHint: 'Chưa peak',
          chanceHint: 'Tỷ lệ tính khi đột phá',
          submit: 'Đột phá nâng cao',
        },
        outcome: {
          successTitle: 'Thành công',
          failTitle: 'Thất bại',
          transition: '{from} → {to}',
          finalChance: 'TL cuối',
          rngRoll: 'Roll',
          attemptIndex: 'Lượt',
          breakdownLabel: 'Chi tiết',
          successToast: 'OK',
          failToast: 'FAIL',
          debuffApplied: 'Bị {key} {expiresIn}',
          debuffExpired: 'đã tan',
        },
        breakdown: {
          baseChance: 'Gốc',
          rootPurityBonus: 'LC',
          methodAffinityBonus: 'CP',
          itemBonus: 'Item',
          rawChance: 'Thô',
          reason: 'Lý do',
        },
        history: {
          title: 'Lịch sử',
          stats: 'T:{total} S:{success} F:{fail}',
          empty: 'Trống',
          noMatch: 'No match',
          successBadge: 'OK',
          failBadge: 'FAIL',
          chanceShort: 'TL: {n}',
          rollShort: 'Roll: {n}',
          tamMaIndicator: 'Tâm Ma',
          loadMore: 'Tải thêm',
          maxReached: 'Max',
          maxReachedToast: 'Max toast',
          retry: 'Lại',
          justNow: 'vừa xong',
          minutesAgo: '{n} phút',
          hoursAgo: '{n} giờ',
          daysAgo: '{n} ngày',
          filter: { all: 'Tất cả', success: 'Thành công', fail: 'Thất bại' },
        },
        errors: {
          NO_CHARACTER: 'Chưa nhân vật',
          NOT_AT_PEAK: 'Chưa peak',
          UNAUTHENTICATED: 'Hết phiên',
          IN_FLIGHT: 'Đang xử lý',
          UNKNOWN: 'Lỗi',
        },
      },
    },
  },
});

function mountView() {
  return mount(BreakthroughView, {
    global: { plugins: [i18n] },
  });
}

function rowFor(
  id: string,
  attemptIndex: number,
  success: boolean,
): HistoryRowStub {
  return {
    id,
    fromRealmKey: 'truc_co',
    fromRealmStage: 9,
    toRealmKey: success ? 'kim_dan' : 'truc_co',
    toRealmStage: success ? 1 : 9,
    chance: 0.85,
    rngRoll: success ? 0.42 : 0.91,
    success,
    attemptIndex,
    tamMaActive: !success,
    createdAt: new Date().toISOString(),
  };
}

const SUCCESS_OUTCOME = {
  success: true,
  fromRealmKey: 'truc_co',
  fromRealmStage: 9,
  toRealmKey: 'kim_dan',
  toRealmStage: 1,
  breakdown: {
    reason: 'all',
    baseChance: 0.7,
    rootPurityBonus: 0.1,
    methodAffinityBonus: 0.05,
    itemBonus: 0,
    rawChance: 0.85,
    finalChance: 0.85,
  },
  rngRoll: 0.42,
  attemptIndex: 1,
  logId: 'btlog-1',
  debuff: { applied: false, key: null, expiresAt: null },
  character: { realmKey: 'kim_dan', realmStage: 1 },
};

const FAIL_OUTCOME = {
  ...SUCCESS_OUTCOME,
  success: false,
  toRealmKey: 'truc_co',
  toRealmStage: 9,
  rngRoll: 0.91,
  attemptIndex: 2,
  logId: 'btlog-2',
  debuff: {
    applied: true,
    key: 'tam_ma_light',
    expiresAt: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
  },
};

describe('BreakthroughView — Phase 11 nâng cao §5 PR3', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
    btState.lastOutcome = null;
    btState.history = null;
    btState.historyLoading = false;
    btState.historyError = null;
    btState.historyHasMore = false;
    btState.historyMaxReached = false;
    btState.historyFilter = 'all';
    gameState.character = null;
    gameState.realmFullName = 'Trúc Cơ Cửu Trọng';
    fetchHistoryMock.mockResolvedValue(null);
    loadMoreHistoryMock.mockResolvedValue(null);
  });

  it('mount: redirect /auth nếu chưa authenticated → KHÔNG áp dụng vì auth=true mock', async () => {
    gameState.character = { realmKey: 'truc_co', realmStage: 9, exp: '1', expNext: '1' };
    const w = mountView();
    await flushPromises();
    expect(replaceMock).not.toHaveBeenCalled();
    expect(fetchHistoryMock).toHaveBeenCalledTimes(1);
    w.unmount();
  });

  it('attempt button hidden khi character null (action card chỉ render khi có nhân vật)', async () => {
    const w = mountView();
    await flushPromises();
    expect(w.find('[data-testid="breakthrough-attempt-btn"]').exists()).toBe(false);
    w.unmount();
  });

  it('attempt button disabled khi character chưa peak (stage < 9)', async () => {
    gameState.character = { realmKey: 'truc_co', realmStage: 5, exp: '1000', expNext: '1000' };
    const w = mountView();
    await flushPromises();
    const btn = w.get('[data-testid="breakthrough-attempt-btn"]');
    expect((btn.element as HTMLButtonElement).disabled).toBe(true);
    w.unmount();
  });

  it('attempt button disabled khi exp < expNext (chưa đủ EXP)', async () => {
    gameState.character = { realmKey: 'truc_co', realmStage: 9, exp: '500', expNext: '1000' };
    const w = mountView();
    await flushPromises();
    const btn = w.get('[data-testid="breakthrough-attempt-btn"]');
    expect((btn.element as HTMLButtonElement).disabled).toBe(true);
    w.unmount();
  });

  it('attempt button enabled khi atPeak (stage 9 + exp ≥ expNext)', async () => {
    gameState.character = { realmKey: 'truc_co', realmStage: 9, exp: '1000', expNext: '1000' };
    const w = mountView();
    await flushPromises();
    const btn = w.get('[data-testid="breakthrough-attempt-btn"]');
    expect((btn.element as HTMLButtonElement).disabled).toBe(false);
    w.unmount();
  });

  it('click attempt → store.attempt called + success toast on success branch', async () => {
    gameState.character = { realmKey: 'truc_co', realmStage: 9, exp: '1000', expNext: '1000' };
    attemptMock.mockImplementationOnce(async () => {
      btState.lastOutcome = SUCCESS_OUTCOME;
      return null;
    });
    const w = mountView();
    await flushPromises();
    await w.get('[data-testid="breakthrough-attempt-btn"]').trigger('click');
    await flushPromises();
    expect(attemptMock).toHaveBeenCalledTimes(1);
    expect(toastPushMock).toHaveBeenCalled();
    const last = toastPushMock.mock.calls[toastPushMock.mock.calls.length - 1][0];
    expect(last.type).toBe('system');
    w.unmount();
  });

  it('click attempt → fail toast on fail branch (RNG fail)', async () => {
    gameState.character = { realmKey: 'truc_co', realmStage: 9, exp: '1000', expNext: '1000' };
    attemptMock.mockImplementationOnce(async () => {
      btState.lastOutcome = FAIL_OUTCOME;
      return null;
    });
    const w = mountView();
    await flushPromises();
    await w.get('[data-testid="breakthrough-attempt-btn"]').trigger('click');
    await flushPromises();
    const last = toastPushMock.mock.calls[toastPushMock.mock.calls.length - 1][0];
    expect(last.type).toBe('warning');
    w.unmount();
  });

  it('click attempt server-reject (NOT_AT_PEAK) → toast warning, không set outcome', async () => {
    gameState.character = { realmKey: 'truc_co', realmStage: 9, exp: '1000', expNext: '1000' };
    attemptMock.mockResolvedValueOnce('NOT_AT_PEAK');
    const w = mountView();
    await flushPromises();
    await w.get('[data-testid="breakthrough-attempt-btn"]').trigger('click');
    await flushPromises();
    expect(attemptMock).toHaveBeenCalled();
    const last = toastPushMock.mock.calls[toastPushMock.mock.calls.length - 1][0];
    expect(last.type).toBe('warning');
    w.unmount();
  });

  it('outcome banner success: render successTitle + final chance + roll', async () => {
    gameState.character = { realmKey: 'kim_dan', realmStage: 1, exp: '0', expNext: '1000' };
    btState.lastOutcome = SUCCESS_OUTCOME;
    const w = mountView();
    await flushPromises();
    expect(w.find('[data-testid="breakthrough-outcome-success"]').exists()).toBe(true);
    expect(w.find('[data-testid="breakthrough-outcome-fail"]').exists()).toBe(false);
    expect(w.find('[data-testid="breakthrough-debuff"]').exists()).toBe(false);
    const html = w.html();
    expect(html).toContain('Thành công');
    expect(html).toContain('85.0%'); // finalChance 0.85 formatted
    w.unmount();
  });

  it('outcome banner fail: render failTitle + debuff hint (tam_ma_light)', async () => {
    gameState.character = { realmKey: 'truc_co', realmStage: 9, exp: '1000', expNext: '1000' };
    btState.lastOutcome = FAIL_OUTCOME;
    const w = mountView();
    await flushPromises();
    expect(w.find('[data-testid="breakthrough-outcome-fail"]').exists()).toBe(true);
    expect(w.find('[data-testid="breakthrough-outcome-success"]').exists()).toBe(false);
    expect(w.find('[data-testid="breakthrough-debuff"]').exists()).toBe(true);
    const html = w.html();
    expect(html).toContain('tam_ma_light');
    w.unmount();
  });

  it('history empty: render empty hint khi history=[] (đã fetch)', async () => {
    gameState.character = { realmKey: 'truc_co', realmStage: 9, exp: '0', expNext: '1' };
    btState.history = [];
    const w = mountView();
    await flushPromises();
    expect(w.html()).toContain('Trống');
    expect(w.findAll('[data-testid="breakthrough-history-row"]')).toHaveLength(0);
    w.unmount();
  });

  it('history rows: render attemptIndex, transition, success badge', async () => {
    gameState.character = { realmKey: 'truc_co', realmStage: 9, exp: '0', expNext: '1' };
    btState.history = [rowFor('a', 3, true), rowFor('b', 2, false), rowFor('c', 1, true)];
    const w = mountView();
    await flushPromises();
    const rows = w.findAll('[data-testid="breakthrough-history-row"]');
    expect(rows).toHaveLength(3);
    const html = w.html();
    expect(html).toContain('#3');
    expect(html).toContain('#2');
    expect(html).toContain('#1');
    // tamMa indicator chỉ render trên fail row.
    const tamMaIndicators = w.findAll('[data-testid="breakthrough-history-tamma"]');
    expect(tamMaIndicators).toHaveLength(1);
    w.unmount();
  });

  it('history filter buttons: setHistoryFilter called với key tương ứng', async () => {
    gameState.character = { realmKey: 'truc_co', realmStage: 9, exp: '0', expNext: '1' };
    btState.history = [rowFor('a', 3, true), rowFor('b', 2, false)];
    const w = mountView();
    await flushPromises();
    await w.get('[data-testid="breakthrough-filter-success"]').trigger('click');
    expect(setHistoryFilterMock).toHaveBeenCalledWith('success');
    await w.get('[data-testid="breakthrough-filter-fail"]').trigger('click');
    expect(setHistoryFilterMock).toHaveBeenCalledWith('fail');
    await w.get('[data-testid="breakthrough-filter-all"]').trigger('click');
    expect(setHistoryFilterMock).toHaveBeenCalledWith('all');
    w.unmount();
  });

  it('history filter no match: render noMatch hint', async () => {
    gameState.character = { realmKey: 'truc_co', realmStage: 9, exp: '0', expNext: '1' };
    btState.history = [rowFor('a', 3, true)];
    btState.historyFilter = 'fail';
    const w = mountView();
    await flushPromises();
    expect(w.html()).toContain('No match');
    w.unmount();
  });

  it('load more: button render khi historyHasMore, click → loadMoreHistory called', async () => {
    gameState.character = { realmKey: 'truc_co', realmStage: 9, exp: '0', expNext: '1' };
    btState.history = Array.from({ length: 20 }, (_, i) => rowFor(String(i), i, true));
    btState.historyHasMore = true;
    const w = mountView();
    await flushPromises();
    const btn = w.get('[data-testid="breakthrough-load-more"]');
    expect((btn.element as HTMLButtonElement).disabled).toBe(false);
    await btn.trigger('click');
    expect(loadMoreHistoryMock).toHaveBeenCalledTimes(1);
    w.unmount();
  });

  it('historyMaxReached: render maxReached hint thay cho load-more button', async () => {
    gameState.character = { realmKey: 'truc_co', realmStage: 9, exp: '0', expNext: '1' };
    btState.history = Array.from({ length: 100 }, (_, i) => rowFor(String(i), i, true));
    btState.historyHasMore = false;
    btState.historyMaxReached = true;
    const w = mountView();
    await flushPromises();
    expect(w.find('[data-testid="breakthrough-load-more"]').exists()).toBe(false);
    expect(w.html()).toContain('Max');
    w.unmount();
  });

  it('historyError: render error message + retry button', async () => {
    gameState.character = { realmKey: 'truc_co', realmStage: 9, exp: '0', expNext: '1' };
    btState.history = null;
    btState.historyError = 'UNAUTHENTICATED';
    const w = mountView();
    await flushPromises();
    expect(w.html()).toContain('Hết phiên');
    expect(w.html()).toContain('Lại');
    w.unmount();
  });

  it('clearLastOutcome: click ✕ button gọi store.clearLastOutcome', async () => {
    gameState.character = { realmKey: 'kim_dan', realmStage: 1, exp: '0', expNext: '1000' };
    btState.lastOutcome = SUCCESS_OUTCOME;
    const w = mountView();
    await flushPromises();
    const banner = w.get('[data-testid="breakthrough-outcome-success"]');
    await banner.find('button').trigger('click');
    expect(clearLastOutcomeMock).toHaveBeenCalledTimes(1);
    w.unmount();
  });
});
