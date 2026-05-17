import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { createI18n } from 'vue-i18n';
import { setActivePinia, createPinia } from 'pinia';

/**
 * PartyHubView smoke tests (PR #629).
 *
 * Coverage:
 *   1. Guest → redirect to /auth.
 *   2. No party → shows empty state with Create Party CTA.
 *   3. Active party → shows members, activity entries.
 *   4. Dungeon/Coop-Boss entries navigate to correct routes.
 */

const getMyPartyMock = vi.fn();
const createPartyMock = vi.fn();
const leavePartyMock = vi.fn();
vi.mock('@/api/party', () => ({
  getMyParty: (...a: unknown[]) => getMyPartyMock(...a),
  createParty: (...a: unknown[]) => createPartyMock(...a),
  leaveParty: (...a: unknown[]) => leavePartyMock(...a),
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

vi.mock('@xuantoi/shared', () => ({
  PARTY_LIMITS: { maxMembers: 5, inviteExpireMinutes: 10, maxPendingInvitesPerInvitee: 5, maxPendingInvitesPerParty: 10, nameMin: 3, nameMax: 40 },
}));

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
vi.mock('@/components/xianxia/XTGlyphBadge.vue', () => ({
  default: {
    name: 'XTGlyphBadgeStub',
    props: ['tone', 'size', 'glyph'],
    template: '<span><slot /></span>',
  },
}));
vi.mock('@/components/ui/MButton.vue', () => ({
  default: {
    name: 'MButtonStub',
    inheritAttrs: false,
    template: '<button v-bind="$attrs" @click="$emit(\'click\')"><slot /></button>',
  },
}));

import PartyHubView from '@/views/PartyHubView.vue';

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
  wrapper = mount(PartyHubView, {
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
  getMyPartyMock.mockReset().mockResolvedValue({ party: null, members: [] });
  createPartyMock.mockReset();
  leavePartyMock.mockReset();
});

afterEach(() => {
  wrapper?.unmount();
  wrapper = null;
});

describe('PartyHubView — auth gating', () => {
  it('guest → router.replace("/auth")', async () => {
    authState.isAuthenticated = false;
    mountView();
    await flushPromises();
    expect(routerReplaceMock).toHaveBeenCalledWith('/auth');
    expect(getMyPartyMock).not.toHaveBeenCalled();
  });
});

describe('PartyHubView — empty state', () => {
  it('no party → shows empty state with create button', async () => {
    getMyPartyMock.mockResolvedValue({ party: null, members: [] });
    mountView();
    await flushPromises();
    expect(wrapper?.find('[data-testid="party-hub-empty"]').exists()).toBe(true);
    expect(wrapper?.find('[data-testid="party-create-btn"]').exists()).toBe(true);
    expect(wrapper?.find('[data-testid="party-hub-info"]').exists()).toBe(false);
  });
});

describe('PartyHubView — active party', () => {
  const mockParty = {
    party: {
      id: 'party-1',
      leaderUserId: 'user-1',
      name: 'Thanh Vân Đội',
      status: 'ACTIVE' as const,
      maxMembers: 5,
      memberCount: 2,
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
      disbandedAt: null,
    },
    members: [
      { id: 'm1', partyId: 'party-1', userId: 'user-1', displayName: 'Lý Bạch', role: 'LEADER' as const, online: true, joinedAt: '2026-01-01T00:00:00Z', leftAt: null },
      { id: 'm2', partyId: 'party-1', userId: 'user-2', displayName: 'Đỗ Phủ', role: 'MEMBER' as const, online: false, joinedAt: '2026-01-01T01:00:00Z', leftAt: null },
    ],
  };

  it('renders party info, members, and activity entries', async () => {
    getMyPartyMock.mockResolvedValue(mockParty);
    mountView();
    await flushPromises();

    expect(wrapper?.find('[data-testid="party-hub-empty"]').exists()).toBe(false);
    expect(wrapper?.find('[data-testid="party-hub-info"]').exists()).toBe(true);
    expect(wrapper?.find('[data-testid="party-hub-members"]').exists()).toBe(true);
    expect(wrapper?.find('[data-testid="party-hub-activities"]').exists()).toBe(true);

    // Members rendered
    const membersText = wrapper?.find('[data-testid="party-hub-members"]').text();
    expect(membersText).toContain('Lý Bạch');
    expect(membersText).toContain('Đỗ Phủ');
  });

  it('dungeon and coop-boss entries navigate correctly', async () => {
    getMyPartyMock.mockResolvedValue(mockParty);
    mountView();
    await flushPromises();

    await wrapper?.find('[data-testid="party-hub-dungeon-entry"]').trigger('click');
    expect(routerPushMock).toHaveBeenCalledWith('/party/dungeon');

    routerPushMock.mockClear();
    await wrapper?.find('[data-testid="party-hub-coop-boss-entry"]').trigger('click');
    expect(routerPushMock).toHaveBeenCalledWith('/party/coop-boss');
  });
});
