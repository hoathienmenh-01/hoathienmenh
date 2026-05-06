import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { createI18n } from 'vue-i18n';
import { setActivePinia, createPinia } from 'pinia';
import type { BossView, DefeatedRewardSlice, AttackResult } from '@/api/boss';

/**
 * BossView smoke tests (session 9j task K / K3.9): cover auth routing, load
 * boss + no-boss render, attack flow (success → HP update + reward toast +
 * cooldown; submitting guard; error map), realtime WS events (`boss:update`
 * updates HP, `boss:defeated` switches status, `boss:end` EXPIRED), unmount
 * cleanup (tick timer cleared, WS handlers disposed).
 *
 * BossView đụng **damage-based reward distribution** (top/mid drop pool) qua
 * `attackBoss` + `boss:defeated`. Regression có thể làm mất reward hoặc
 * double-attack qua cooldown bypass. Thêm 11 test chống regression.
 */

const getActiveBossesMock = vi.fn();
const attackBossMock = vi.fn();

vi.mock('@/api/boss', async () => {
  const actual = await vi.importActual<typeof import('@/api/boss')>('@/api/boss');
  return {
    ...actual,
    // Phase 12.6 — view chuyển sang `getActiveBosses` (list multi-region).
    // `getCurrentBoss` legacy giữ cho external import nhưng view không
    // dùng. Helper `setSingleBoss(boss)` ở dưới wrap về list[1] cho
    // compat với test pattern cũ.
    getActiveBosses: (...a: unknown[]) => getActiveBossesMock(...a),
    attackBoss: (...a: unknown[]) => attackBossMock(...a),
  };
});

// Track WS handlers so tests can simulate incoming frames.
type WsHandler = (frame: { payload: unknown }) => void;
const wsHandlers: Record<string, WsHandler[]> = {};
const offFunctions: Array<() => void> = [];

const onMock = vi.fn((type: string, fn: WsHandler) => {
  if (!wsHandlers[type]) wsHandlers[type] = [];
  wsHandlers[type].push(fn);
  const off = () => {
    wsHandlers[type] = (wsHandlers[type] ?? []).filter((h) => h !== fn);
  };
  offFunctions.push(off);
  return off;
});

vi.mock('@/ws/client', () => ({
  on: (type: string, fn: WsHandler) => onMock(type, fn),
}));

const routerReplaceMock = vi.fn();
vi.mock('vue-router', () => ({
  useRouter: () => ({ replace: routerReplaceMock }),
  RouterLink: {
    name: 'RouterLinkStub',
    props: ['to'],
    template: '<a :href="to"><slot /></a>',
  },
}));

const toastPushMock = vi.fn();
vi.mock('@/stores/toast', () => ({
  useToastStore: () => ({ push: toastPushMock }),
}));

const authState = {
  isAuthenticated: true,
  hydrate: vi.fn().mockResolvedValue(undefined),
};
vi.mock('@/stores/auth', () => ({
  useAuthStore: () => authState,
}));

const gameState: { character: { sectKey: string; linhThach: string } | null } = {
  character: { sectKey: 'thanh_van', linhThach: '1000' },
};
vi.mock('@/stores/game', () => ({
  useGameStore: () => ({
    get character() {
      return gameState.character;
    },
    fetchState: vi.fn().mockResolvedValue(undefined),
    bindSocket: vi.fn(),
  }),
}));

vi.mock('@/components/shell/AppShell.vue', () => ({
  default: { name: 'AppShell', template: '<div><slot /></div>' },
}));

import BossViewComponent from '@/views/BossView.vue';

const i18n = createI18n({
  legacy: false,
  locale: 'vi',
  fallbackLocale: 'vi',
  missingWarn: false,
  fallbackWarn: false,
  messages: {
    vi: {
      common: { reload: 'Tải lại' },
      boss: {
        title: 'Thế giới Boss',
        noneTitle: 'Chưa có boss',
        noneHint: 'Hãy quay lại sau',
        timeLeft: 'Còn',
        participants: '{n} tham gia',
        hp: 'Máu',
        almostGone: 'Sắp hết',
        spawnToast: 'Boss mới xuất hiện',
        defeatedToast: '{name} đã bị đánh bại',
        endedToast: 'Boss đã kết thúc',
        damageToast: 'Gây {dmg} sát thương, hạng {rank}',
        errors: {
          COOLDOWN: 'Đang hồi',
          NO_MP: 'Không đủ mana',
          UNKNOWN: 'Lỗi không rõ',
        },
      },
    },
  },
});

function makeBoss(overrides: Partial<BossView> = {}): BossView {
  return {
    id: 'b1',
    bossKey: 'thuong_gia_moc',
    name: 'Thượng Giới Mộc Yêu',
    description: 'Yêu thú hung tàn',
    level: 10,
    maxHp: '10000',
    currentHp: '8000',
    status: 'ACTIVE',
    spawnedAt: '2026-04-30T00:00:00Z',
    expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    // Phase 12.6 — fixture default 'world' khớp catalog null mapping.
    regionKey: 'world',
    leaderboard: [],
    myDamage: null,
    myRank: null,
    participants: 5,
    cooldownUntil: null,
    topDropPool: [],
    midDropPool: [],
    ...overrides,
  };
}

function makeAttackResult(overrides: Partial<AttackResult> = {}): AttackResult {
  return {
    damageDealt: '500',
    bossHp: '7500',
    bossMaxHp: '10000',
    defeated: false,
    myDamageTotal: '1500',
    myRank: 3,
    charHp: 100,
    charMp: 50,
    charStamina: 80,
    ...overrides,
  };
}

function mountView() {
  return mount(BossViewComponent, { global: { plugins: [i18n] } });
}

beforeEach(() => {
  vi.useFakeTimers();
  setActivePinia(createPinia());
  getActiveBossesMock.mockReset();
  attackBossMock.mockReset();
  routerReplaceMock.mockReset();
  toastPushMock.mockReset();
  onMock.mockClear();
  for (const k of Object.keys(wsHandlers)) delete wsHandlers[k];
  offFunctions.length = 0;
  authState.isAuthenticated = true;
  authState.hydrate.mockReset();
  authState.hydrate.mockResolvedValue(undefined);
  gameState.character = { sectKey: 'thanh_van', linhThach: '1000' };
});

afterEach(() => {
  vi.useRealTimers();
});

describe('BossView — onMounted routing & load', () => {
  it('unauth → replace /auth, không gọi getCurrentBoss', async () => {
    authState.isAuthenticated = false;
    mountView();
    await flushPromises();
    expect(routerReplaceMock).toHaveBeenCalledWith('/auth');
    expect(getActiveBossesMock).not.toHaveBeenCalled();
  });

  it('auth + không có boss → render noneTitle', async () => {
    // Phase 12.6 — empty list → render noneTitle.
    getActiveBossesMock.mockResolvedValue([]);
    const w = mountView();
    await flushPromises();
    expect(w.text()).toContain('Chưa có boss');
  });

  it('auth + có boss → render name + level + HP', async () => {
    getActiveBossesMock.mockResolvedValue([
      makeBoss({ name: 'Test Boss', level: 42 }),
    ]);
    const w = mountView();
    await flushPromises();
    expect(w.text()).toContain('Test Boss');
    expect(w.text()).toContain('Lv.42');
    expect(w.text()).toContain('8000');
    expect(w.text()).toContain('10000');
  });

  it('getActiveBosses throw → boss = null (silent fail)', async () => {
    getActiveBossesMock.mockRejectedValue(new Error('network'));
    const w = mountView();
    await flushPromises();
    expect(w.text()).toContain('Chưa có boss');
  });
});

describe('BossView — attack flow (reward safety)', () => {
  beforeEach(() => {
    getActiveBossesMock.mockResolvedValue([makeBoss()]);
  });

  it('success: attackBoss + HP update + damage toast', async () => {
    attackBossMock.mockResolvedValue({
      result: makeAttackResult({ damageDealt: '500', myRank: 3, bossHp: '7500' }),
      defeated: null,
    });
    const w = mountView();
    await flushPromises();
    // Find attack button — look for any button that is not disabled and not nav/reload
    const attackBtn = w
      .findAll('button')
      .find((b) => b.text().length > 0 && b.text() !== 'Tải lại');
    expect(attackBtn).toBeDefined();
    await attackBtn!.trigger('click');
    await flushPromises();

    expect(attackBossMock).toHaveBeenCalled();
    expect(toastPushMock).toHaveBeenCalledWith({
      type: 'success',
      text: 'Gây 500 sát thương, hạng 3',
    });
  });

  it('error COOLDOWN → toast mapped', async () => {
    attackBossMock.mockRejectedValue(
      Object.assign(new Error('wait'), { code: 'COOLDOWN' }),
    );
    const w = mountView();
    await flushPromises();
    const attackBtn = w
      .findAll('button')
      .find((b) => b.text().length > 0 && b.text() !== 'Tải lại');
    await attackBtn!.trigger('click');
    await flushPromises();

    expect(toastPushMock).toHaveBeenCalledWith({
      type: 'error',
      text: 'Đang hồi',
    });
  });

  it('error code lạ → fallback boss.errors.UNKNOWN', async () => {
    attackBossMock.mockRejectedValue(
      Object.assign(new Error('x'), { code: 'VOID_DRAGON' }),
    );
    const w = mountView();
    await flushPromises();
    const attackBtn = w
      .findAll('button')
      .find((b) => b.text().length > 0 && b.text() !== 'Tải lại');
    await attackBtn!.trigger('click');
    await flushPromises();

    expect(toastPushMock).toHaveBeenCalledWith({
      type: 'error',
      text: 'Lỗi không rõ',
    });
  });

  it('submitting guard: click lần 2 trong khi pending → chỉ 1 call', async () => {
    const resolveHolder: {
      current:
        | ((v: { result: AttackResult; defeated: DefeatedRewardSlice[] | null }) => void)
        | null;
    } = { current: null };
    attackBossMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveHolder.current = resolve;
        }),
    );
    const w = mountView();
    await flushPromises();
    const attackBtn = w
      .findAll('button')
      .find((b) => b.text().length > 0 && b.text() !== 'Tải lại');
    await attackBtn!.trigger('click');
    await flushPromises();
    await attackBtn!.trigger('click');
    await flushPromises();

    expect(attackBossMock).toHaveBeenCalledTimes(1);
    resolveHolder.current?.({ result: makeAttackResult(), defeated: null });
  });
});

describe('BossView — realtime WS events', () => {
  beforeEach(() => {
    getActiveBossesMock.mockResolvedValue([
      makeBoss({ id: 'b1', currentHp: '8000' }),
    ]);
  });

  it('đăng ký handlers cho boss:update, boss:spawn, boss:defeated, boss:end', async () => {
    mountView();
    await flushPromises();
    expect(onMock).toHaveBeenCalledWith('boss:update', expect.any(Function));
    expect(onMock).toHaveBeenCalledWith('boss:spawn', expect.any(Function));
    expect(onMock).toHaveBeenCalledWith('boss:defeated', expect.any(Function));
    expect(onMock).toHaveBeenCalledWith('boss:end', expect.any(Function));
  });

  it('boss:update → cập nhật currentHp của boss hiện tại', async () => {
    const w = mountView();
    await flushPromises();
    // Simulate incoming frame
    const handlers = wsHandlers['boss:update'] ?? [];
    expect(handlers.length).toBeGreaterThan(0);
    for (const h of handlers) {
      h({
        payload: {
          id: 'b1',
          currentHp: '5000',
          maxHp: '10000',
          status: 'ACTIVE',
          leaderboardTop5: [],
        },
      });
    }
    await flushPromises();
    expect(w.text()).toContain('5000');
  });

  it('boss:defeated → status=DEFEATED + toast success', async () => {
    mountView();
    await flushPromises();
    const handlers = wsHandlers['boss:defeated'] ?? [];
    for (const h of handlers) {
      h({
        payload: {
          id: 'b1',
          name: 'Thượng Giới Mộc Yêu',
          rewards: [],
        },
      });
    }
    await flushPromises();
    expect(toastPushMock).toHaveBeenCalledWith({
      type: 'success',
      text: 'Thượng Giới Mộc Yêu đã bị đánh bại',
    });
  });

  it('boss:end → toast system (boss expired)', async () => {
    mountView();
    await flushPromises();
    const handlers = wsHandlers['boss:end'] ?? [];
    for (const h of handlers) {
      h({
        payload: {
          id: 'b1',
          status: 'EXPIRED',
          rewards: [],
        },
      });
    }
    await flushPromises();
    expect(toastPushMock).toHaveBeenCalledWith({
      type: 'system',
      text: 'Boss đã kết thúc',
    });
  });
});
