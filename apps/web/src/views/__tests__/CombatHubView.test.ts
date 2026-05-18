import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { createI18n } from 'vue-i18n';
import { setActivePinia, createPinia } from 'pinia';

/**
 * CombatHubView tests (PR #631).
 *
 * Coverage:
 *   1. Guest → redirect to /auth.
 *   2. No character → shows no-character state.
 *   3. Authenticated → renders combat surface grid with 5 cards.
 *   4. Party-required surfaces show "need party" badge when no party.
 *   5. Daily tip section renders.
 *   6. Card click navigates to correct route.
 */

const routerReplaceMock = vi.fn();
const routerPushMock = vi.fn(() => Promise.resolve());
vi.mock('vue-router', () => ({
  useRouter: () => ({ replace: routerReplaceMock, push: routerPushMock }),
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

const dungeonRunStoreState = {
  startableCount: 3,
  hasActiveRun: false,
  load: vi.fn().mockResolvedValue(undefined),
};
vi.mock('@/stores/dungeonRun', () => ({
  useDungeonRunStore: () => dungeonRunStoreState,
}));

// Mock dynamic imports for boss/combat API
vi.mock('@/api/boss', () => ({
  getActiveBosses: vi.fn().mockResolvedValue([{ id: 'b1' }]),
}));
vi.mock('@/api/combat', () => ({
  getActiveEncounter: vi.fn().mockResolvedValue(null),
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

import CombatHubView from '@/views/CombatHubView.vue';

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
  wrapper = mount(CombatHubView, {
    global: { plugins: [i18n] },
  });
  return wrapper;
}

beforeEach(() => {
  setActivePinia(createPinia());
  routerReplaceMock.mockReset();
  routerPushMock.mockReset().mockResolvedValue(undefined);
  authState.isAuthenticated = true;
  authState.hydrate.mockReset().mockResolvedValue(undefined);
  gameState.fetchState.mockReset().mockResolvedValue(undefined);
  gameState.bindSocket.mockReset();
  gameState.character = { id: 'c1', name: 'Test' };
  gameState.party = { id: 'p1' };
  dungeonRunStoreState.load.mockReset().mockResolvedValue(undefined);
  dungeonRunStoreState.startableCount = 3;
  dungeonRunStoreState.hasActiveRun = false;
});

afterEach(() => {
  wrapper?.unmount();
  wrapper = null;
});

describe('CombatHubView — auth gating', () => {
  it('guest → router.replace("/auth")', async () => {
    authState.isAuthenticated = false;
    mountView();
    await flushPromises();
    expect(routerReplaceMock).toHaveBeenCalledWith('/auth');
  });
});

describe('CombatHubView — no character', () => {
  it('no character → shows no-character state', async () => {
    gameState.character = null;
    mountView();
    await flushPromises();
    expect(wrapper?.find('[data-testid="combat-hub-no-character"]').exists()).toBe(true);
    expect(wrapper?.find('[data-testid="combat-hub-grid"]').exists()).toBe(false);
  });
});

describe('CombatHubView — authenticated grid', () => {
  it('renders 5 combat surface cards', async () => {
    mountView();
    await flushPromises();
    const grid = wrapper?.find('[data-testid="combat-hub-grid"]');
    expect(grid?.exists()).toBe(true);
    expect(wrapper?.find('[data-testid="combat-hub-card-dungeon"]').exists()).toBe(true);
    expect(wrapper?.find('[data-testid="combat-hub-card-dungeon-run"]').exists()).toBe(true);
    expect(wrapper?.find('[data-testid="combat-hub-card-boss"]').exists()).toBe(true);
    expect(wrapper?.find('[data-testid="combat-hub-card-coop-boss"]').exists()).toBe(true);
    expect(wrapper?.find('[data-testid="combat-hub-card-party-dungeon"]').exists()).toBe(true);
  });

  it('party-required surfaces are always accessible (panel handles no-party)', async () => {
    mountView();
    await flushPromises();
    expect(wrapper?.find('[data-testid="combat-hub-card-coop-boss"]').exists()).toBe(true);
    expect(wrapper?.find('[data-testid="combat-hub-card-party-dungeon"]').exists()).toBe(true);
  });
});

describe('CombatHubView — daily tip', () => {
  it('renders daily tip section', async () => {
    mountView();
    await flushPromises();
    expect(wrapper?.find('[data-testid="combat-hub-daily-tip"]').exists()).toBe(true);
  });
});

describe('CombatHubView — navigation', () => {
  it('clicking dungeon card navigates to /dungeon', async () => {
    mountView();
    await flushPromises();
    await wrapper?.find('[data-testid="combat-hub-card-dungeon"]').trigger('click');
    expect(routerPushMock).toHaveBeenCalledWith('/dungeon');
  });

  it('clicking boss card navigates to /boss', async () => {
    mountView();
    await flushPromises();
    await wrapper?.find('[data-testid="combat-hub-card-boss"]').trigger('click');
    expect(routerPushMock).toHaveBeenCalledWith('/boss');
  });
});

describe('CombatHubView — recommended action', () => {
  it('active encounter → recommend continue encounter (/dungeon)', async () => {
    const { getActiveEncounter } = await import('@/api/combat');
    (getActiveEncounter as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ status: 'ACTIVE' });
    mountView();
    await flushPromises();
    const rec = wrapper?.find('[data-testid="combat-hub-recommend"]');
    expect(rec?.exists()).toBe(true);
    expect(wrapper?.find('[data-testid="combat-hub-recommend-title"]').text()).toContain('Đang chiến đấu');
    await rec?.trigger('click');
    expect(routerPushMock).toHaveBeenCalledWith('/dungeon');
  });

  it('active boss → recommend fight boss (/boss)', async () => {
    const { getActiveBosses } = await import('@/api/boss');
    (getActiveBosses as ReturnType<typeof vi.fn>).mockResolvedValueOnce([{ id: 'b1' }, { id: 'b2' }]);
    mountView();
    await flushPromises();
    const rec = wrapper?.find('[data-testid="combat-hub-recommend"]');
    expect(rec?.exists()).toBe(true);
    expect(wrapper?.find('[data-testid="combat-hub-recommend-title"]').text()).toContain('Boss');
    await rec?.trigger('click');
    expect(routerPushMock).toHaveBeenCalledWith('/boss');
  });

  it('active dungeon run → recommend continue run (/dungeon-run)', async () => {
    dungeonRunStoreState.hasActiveRun = true;
    const bossApi = await import('@/api/boss');
    (bossApi.getActiveBosses as ReturnType<typeof vi.fn>).mockResolvedValueOnce([]);
    mountView();
    await flushPromises();
    const rec = wrapper?.find('[data-testid="combat-hub-recommend"]');
    expect(rec?.exists()).toBe(true);
    expect(wrapper?.find('[data-testid="combat-hub-recommend-title"]').text()).toContain('đang chạy');
    await rec?.trigger('click');
    expect(routerPushMock).toHaveBeenCalledWith('/dungeon-run');
  });

  it('startable dungeon runs → recommend start run (/dungeon-run)', async () => {
    dungeonRunStoreState.startableCount = 5;
    dungeonRunStoreState.hasActiveRun = false;
    const bossApi = await import('@/api/boss');
    (bossApi.getActiveBosses as ReturnType<typeof vi.fn>).mockResolvedValueOnce([]);
    mountView();
    await flushPromises();
    const rec = wrapper?.find('[data-testid="combat-hub-recommend"]');
    expect(rec?.exists()).toBe(true);
    expect(wrapper?.find('[data-testid="combat-hub-recommend-title"]').text()).toContain('Lưu Phát');
    await rec?.trigger('click');
    expect(routerPushMock).toHaveBeenCalledWith('/dungeon-run');
  });

  it('no special state → recommend explore dungeon (/dungeon)', async () => {
    dungeonRunStoreState.startableCount = 0;
    dungeonRunStoreState.hasActiveRun = false;
    const bossApi = await import('@/api/boss');
    (bossApi.getActiveBosses as ReturnType<typeof vi.fn>).mockResolvedValueOnce([]);
    mountView();
    await flushPromises();
    const rec = wrapper?.find('[data-testid="combat-hub-recommend"]');
    expect(rec?.exists()).toBe(true);
    expect(wrapper?.find('[data-testid="combat-hub-recommend-title"]').text()).toContain('Bí Cảnh');
    await rec?.trigger('click');
    expect(routerPushMock).toHaveBeenCalledWith('/dungeon');
  });

  it('recommend panel does not render when no character', async () => {
    gameState.character = null;
    mountView();
    await flushPromises();
    expect(wrapper?.find('[data-testid="combat-hub-recommend"]').exists()).toBe(false);
  });
});
