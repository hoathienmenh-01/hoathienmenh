import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { createI18n } from 'vue-i18n';
import { setActivePinia, createPinia } from 'pinia';

/**
 * CoopBossView polish tests (PR #631).
 *
 * Coverage:
 *   1. Guest → redirect to /auth.
 *   2. No character → shows no-character state.
 *   3. No party → shows no-party warning + panel still mounts.
 *   4. Authenticated with party → mounts CoopBossPanel.
 *   5. Back button navigates to /party.
 *   6. Info section renders how-it-works steps.
 */

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
  character: { id: 'c1', name: 'Test' } as Record<string, unknown> | null,
  party: { id: 'p1' } as Record<string, unknown> | null,
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
vi.mock('@/components/CoopBossPanel.vue', () => ({
  default: {
    name: 'CoopBossPanelStub',
    inheritAttrs: true,
    template: '<div data-testid="coop-boss-panel-mount"></div>',
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
  gameState.character = { id: 'c1', name: 'Test' };
  gameState.party = { id: 'p1' };
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
  });
});

describe('CoopBossView — no character', () => {
  it('no character → shows no-character state', async () => {
    gameState.character = null;
    mountView();
    await flushPromises();
    expect(wrapper?.find('[data-testid="coop-boss-no-character"]').exists()).toBe(true);
    expect(wrapper?.find('[data-testid="coop-boss-panel-mount"]').exists()).toBe(false);
  });
});

describe('CoopBossView — no party (removed)', () => {
  it('always shows panel (panel handles party error internally)', async () => {
    mountView();
    await flushPromises();
    expect(wrapper?.find('[data-testid="coop-boss-panel-mount"]').exists()).toBe(true);
  });
});

describe('CoopBossView — authenticated with party', () => {
  it('mounts CoopBossPanel', async () => {
    mountView();
    await flushPromises();
    expect(wrapper?.find('[data-testid="coop-boss-panel-mount"]').exists()).toBe(true);
    expect(wrapper?.find('[data-testid="coop-boss-no-party"]').exists()).toBe(false);
    expect(wrapper?.find('[data-testid="coop-boss-no-character"]').exists()).toBe(false);
  });
});

describe('CoopBossView — info section', () => {
  it('renders how-it-works info section', async () => {
    mountView();
    await flushPromises();
    expect(wrapper?.find('[data-testid="coop-boss-info"]').exists()).toBe(true);
  });
});

describe('CoopBossView — navigation', () => {
  it('back button navigates to /party', async () => {
    mountView();
    await flushPromises();
    await wrapper?.find('[data-testid="coop-boss-back"]').trigger('click');
    expect(routerPushMock).toHaveBeenCalledWith('/party');
  });

  it('boss button navigates to /boss', async () => {
    mountView();
    await flushPromises();
    await wrapper?.find('[data-testid="coop-boss-to-boss"]').trigger('click');
    expect(routerPushMock).toHaveBeenCalledWith('/boss');
  });

  it('combat hub button navigates to /combat', async () => {
    mountView();
    await flushPromises();
    await wrapper?.find('[data-testid="coop-boss-to-combat"]').trigger('click');
    expect(routerPushMock).toHaveBeenCalledWith('/combat');
  });
});
