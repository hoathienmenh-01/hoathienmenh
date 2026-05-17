import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { createI18n } from 'vue-i18n';
import { setActivePinia, createPinia } from 'pinia';

/**
 * CoopBossView smoke tests (PR #629).
 *
 * Coverage:
 *   1. Guest → redirect to /auth.
 *   2. No active run → shows empty state.
 *   3. Active run → renders run data.
 *   4. Recent history renders when available.
 *   5. Back button navigates to /party.
 */

const getMyCoopBossRunMock = vi.fn();
const listMyCoopBossRunsMock = vi.fn();
vi.mock('@/api/coopBoss', () => ({
  getMyCoopBossRun: (...a: unknown[]) => getMyCoopBossRunMock(...a),
  listMyCoopBossRuns: (...a: unknown[]) => listMyCoopBossRunsMock(...a),
}));

const routerReplaceMock = vi.fn();
const routerPushMock = vi.fn(() => Promise.resolve());
vi.mock('vue-router', () => ({
  useRouter: () => ({ replace: routerReplaceMock, push: routerPushMock }),
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

const gameState = {
  character: null,
  bindSocket: vi.fn(),
  fetchState: vi.fn().mockResolvedValue(undefined),
};
vi.mock('@/stores/game', () => ({
  useGameStore: () => gameState,
}));

vi.mock('@xuantoi/shared', () => ({}));

vi.mock('@/components/shell/AppShell.vue', () => ({
  default: {
    name: 'AppShellStub',
    template: '<div data-testid="app-shell-stub"><slot /></div>',
  },
}));
vi.mock('@/components/xianxia/XTLuxHero.vue', () => ({
  default: {
    name: 'XTLuxHeroStub',
    props: ['title', 'subtitle', 'eyebrow', 'label', 'breadcrumb', 'tone', 'watermarkLetter', 'testId'],
    template: '<div :data-testid="testId"><slot name="meta" /><slot /></div>',
  },
}));
vi.mock('@/components/xianxia/XTPageEyebrow.vue', () => ({
  default: {
    name: 'XTPageEyebrowStub',
    props: ['label', 'caps'],
    template: '<p>{{ label }}</p>',
  },
}));
vi.mock('@/components/ui/MButton.vue', () => ({
  default: {
    name: 'MButtonStub',
    inheritAttrs: false,
    template: '<button v-bind="$attrs" @click="$emit(\'click\')"><slot /></button>',
  },
}));

import CoopBossView from '@/views/CoopBossView.vue';

const i18n = createI18n({
  legacy: false,
  locale: 'vi',
  fallbackLocale: 'vi',
  missingWarn: false,
  fallbackWarn: false,
  messages: { vi: {} },
});

let wrapper: ReturnType<typeof mount> | null = null;

function mountView() {
  wrapper = mount(CoopBossView, {
    global: { plugins: [i18n] },
  });
  return wrapper;
}

beforeEach(() => {
  setActivePinia(createPinia());
  routerReplaceMock.mockReset();
  routerPushMock.mockReset().mockResolvedValue(undefined);
  toastPushMock.mockReset();
  authState.isAuthenticated = true;
  authState.hydrate.mockReset().mockResolvedValue(undefined);
  gameState.fetchState.mockReset().mockResolvedValue(undefined);
  gameState.bindSocket.mockReset();
  getMyCoopBossRunMock.mockReset().mockRejectedValue(new Error('no run'));
  listMyCoopBossRunsMock.mockReset().mockRejectedValue(new Error('no history'));
});

afterEach(() => {
  wrapper?.unmount();
  wrapper = null;
});

describe('CoopBossView — auth gating', () => {
  it('guest → router.replace("/auth")', async () => {
    authState.isAuthenticated = false;
    mountView();
    await flushPromises();
    expect(routerReplaceMock).toHaveBeenCalledWith('/auth');
    expect(getMyCoopBossRunMock).not.toHaveBeenCalled();
  });
});

describe('CoopBossView — empty state', () => {
  it('no active run → shows empty state', async () => {
    getMyCoopBossRunMock.mockResolvedValue(null);
    listMyCoopBossRunsMock.mockResolvedValue(null);
    mountView();
    await flushPromises();
    expect(wrapper?.find('[data-testid="coop-boss-empty"]').exists()).toBe(true);
    expect(wrapper?.find('[data-testid="coop-boss-active-run"]').exists()).toBe(false);
  });
});

describe('CoopBossView — active run', () => {
  it('active run → renders run data', async () => {
    getMyCoopBossRunMock.mockResolvedValue({ runId: 'run-1', status: 'IN_PROGRESS', bossKey: 'world_boss_1' });
    listMyCoopBossRunsMock.mockResolvedValue(null);
    mountView();
    await flushPromises();
    expect(wrapper?.find('[data-testid="coop-boss-active-run"]').exists()).toBe(true);
    expect(wrapper?.find('[data-testid="coop-boss-empty"]').exists()).toBe(false);
  });
});

describe('CoopBossView — history', () => {
  it('recent runs render when available', async () => {
    getMyCoopBossRunMock.mockResolvedValue(null);
    listMyCoopBossRunsMock.mockResolvedValue({
      runs: [
        { id: 'r1', bossKey: 'boss_a', status: 'CLEARED' },
        { id: 'r2', bossKey: 'boss_b', status: 'FAILED' },
      ],
    });
    mountView();
    await flushPromises();
    expect(wrapper?.find('[data-testid="coop-boss-history"]').exists()).toBe(true);
    const historyText = wrapper?.find('[data-testid="coop-boss-history"]').text();
    expect(historyText).toContain('boss_a');
    expect(historyText).toContain('CLEARED');
    expect(historyText).toContain('boss_b');
    expect(historyText).toContain('FAILED');
  });
});

describe('CoopBossView — navigation', () => {
  it('back button navigates to /party', async () => {
    getMyCoopBossRunMock.mockResolvedValue(null);
    listMyCoopBossRunsMock.mockResolvedValue(null);
    mountView();
    await flushPromises();
    await wrapper?.find('[data-testid="coop-boss-back"]').trigger('click');
    expect(routerPushMock).toHaveBeenCalledWith('/party');
  });
});
