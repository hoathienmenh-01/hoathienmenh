import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { createI18n } from 'vue-i18n';
import { setActivePinia, createPinia } from 'pinia';

/**
 * PartyDungeonView smoke tests (PR #629).
 *
 * Coverage:
 *   1. Guest → redirect to /auth.
 *   2. No active room → shows empty state.
 *   3. Active room → shows room data.
 *   4. Back button navigates to /party.
 */

const getMyPartyDungeonRoomMock = vi.fn();
vi.mock('@/api/partyDungeon', () => ({
  getMyPartyDungeonRoom: (...a: unknown[]) => getMyPartyDungeonRoomMock(...a),
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

import PartyDungeonView from '@/views/PartyDungeonView.vue';

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
  wrapper = mount(PartyDungeonView, {
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
  getMyPartyDungeonRoomMock.mockReset().mockRejectedValue(new Error('no room'));
});

afterEach(() => {
  wrapper?.unmount();
  wrapper = null;
});

describe('PartyDungeonView — auth gating', () => {
  it('guest → router.replace("/auth")', async () => {
    authState.isAuthenticated = false;
    mountView();
    await flushPromises();
    expect(routerReplaceMock).toHaveBeenCalledWith('/auth');
    expect(getMyPartyDungeonRoomMock).not.toHaveBeenCalled();
  });
});

describe('PartyDungeonView — empty state', () => {
  it('no active room → shows empty state', async () => {
    getMyPartyDungeonRoomMock.mockRejectedValue(new Error('NO_ACTIVE_ROOM'));
    mountView();
    await flushPromises();
    expect(wrapper?.find('[data-testid="party-dungeon-empty"]').exists()).toBe(true);
    expect(wrapper?.find('[data-testid="party-dungeon-active-room"]').exists()).toBe(false);
  });
});

describe('PartyDungeonView — active room', () => {
  it('active room → renders room data', async () => {
    getMyPartyDungeonRoomMock.mockResolvedValue({ roomId: 'room-1', status: 'WAITING', members: [] });
    mountView();
    await flushPromises();
    expect(wrapper?.find('[data-testid="party-dungeon-active-room"]').exists()).toBe(true);
    expect(wrapper?.find('[data-testid="party-dungeon-empty"]').exists()).toBe(false);
  });
});

describe('PartyDungeonView — navigation', () => {
  it('back button navigates to /party', async () => {
    mountView();
    await flushPromises();
    await wrapper?.find('[data-testid="party-dungeon-back"]').trigger('click');
    expect(routerPushMock).toHaveBeenCalledWith('/party');
  });
});
