import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { createI18n } from 'vue-i18n';
import { setActivePinia, createPinia } from 'pinia';

vi.mock('@/stores/auth', () => ({
  useAuthStore: () => ({
    hydrate: vi.fn().mockResolvedValue(undefined),
    isAuthenticated: true,
  }),
}));
vi.mock('@/stores/toast', () => ({
  useToastStore: () => ({ push: vi.fn() }),
}));
vi.mock('vue-router', () => ({
  useRouter: () => ({ replace: vi.fn() }),
}));
vi.mock('@/lib/apiError', () => ({
  extractApiErrorCodeOrDefault: () => 'UNKNOWN',
}));
vi.mock('@/components/shell/AppShell.vue', () => ({
  default: { name: 'AppShellStub', template: '<div data-testid="app-shell"><slot /></div>' },
}));
vi.mock('@/components/xianxia/XTLuxHero.vue', () => ({
  default: { name: 'XTLuxHeroStub', props: ['testId'], template: '<div :data-testid="testId || \'hero\'"><slot /></div>' },
}));
vi.mock('@/components/ui/MButton.vue', () => ({
  default: { name: 'MButtonStub', inheritAttrs: false, template: '<button v-bind="$attrs" @click="$emit(\'click\')"><slot /></button>' },
}));

const playerListEventsMock = vi.fn();
const playerListPersonalMock = vi.fn();
const playerClaimMissionMock = vi.fn();
const playerClaimPersonalMock = vi.fn();

vi.mock('@/api/eventBuilder', () => ({
  playerListEvents: (...a: unknown[]) => playerListEventsMock(...a),
  playerListPersonal: (...a: unknown[]) => playerListPersonalMock(...a),
  playerGetEvent: vi.fn().mockResolvedValue({ event: {}, brackets: [], playerCtx: {} }),
  playerListMissions: vi.fn().mockResolvedValue({ definitions: [], progress: [] }),
  playerClaimMission: (...a: unknown[]) => playerClaimMissionMock(...a),
  playerClaimPersonal: (...a: unknown[]) => playerClaimPersonalMock(...a),
  playerLeaderboard: vi.fn().mockResolvedValue({ entries: [] }),
}));

import EventsView from '@/views/EventsView.vue';

const i18n = createI18n({
  legacy: false,
  locale: 'vi',
  fallbackLocale: 'vi',
  missingWarn: false,
  fallbackWarn: false,
  messages: {
    vi: {
      events: {
        title: 'Sự Kiện',
        subtitle: 'sub',
        loading: 'Đang tải',
        empty: 'Trống',
        roleHint: 'Sự kiện LiveOps.',
        crossNav: {
          missions: 'Nhiệm Vụ',
          missionsDesc: 'desc',
          leaderboard: 'BXH',
          leaderboardDesc: 'desc',
        },
        tab: { all: 'Tất cả', personal: 'Cá nhân' },
        eventType: 'Loại',
        remaining: 'Còn lại',
        endedShort: 'Hết',
        errors: { loadFailed: 'Lỗi {code}' },
        personal: { empty: 'Trống', trigger: 'Trigger', expiresAt: 'Hết hạn', claim: 'Nhận', claimed: 'Đã nhận', alreadyClaimed: 'Đã nhận', notCompleted: 'Chưa xong', claimFailed: 'Lỗi {code}' },
        mission: { claimed: 'Đã nhận', claimFailed: 'Lỗi {code}', alreadyClaimed: 'Đã nhận', inProgress: 'Đang làm', claim: 'Nhận' },
        detail: { yourBracket: 'Bracket', tier: 'Tier', rewardTier: 'Reward', tokenMul: 'Token', loadLeaderboard: 'BXH', missions: 'Nhiệm vụ', noMissions: 'Trống', leaderboard: 'BXH' },
      },
    },
  },
});

function mountView() {
  return mount(EventsView, { global: { plugins: [i18n] } });
}

describe('EventsView — UX polish', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
  });

  it('render hero', async () => {
    const w = mountView();
    await flushPromises();
    expect(w.find('[data-testid="events-hero"]').exists()).toBe(true);
  });

  it('render role hint', async () => {
    const w = mountView();
    await flushPromises();
    expect(w.find('[data-testid="events-role-hint"]').exists()).toBe(true);
    expect(w.find('[data-testid="events-role-hint"]').text()).toBeTruthy();
  });

  it('render cross-nav', async () => {
    const w = mountView();
    await flushPromises();
    expect(w.find('[data-testid="events-cross-nav"]').exists()).toBe(true);
  });
});

describe('EventsView — functional', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    playerListEventsMock.mockReset();
    playerListPersonalMock.mockReset();
    playerClaimMissionMock.mockReset();
    playerClaimPersonalMock.mockReset();
  });

  it('empty state khi không có event', async () => {
    playerListEventsMock.mockResolvedValue({ events: [], characterId: 'c1' });
    playerListPersonalMock.mockResolvedValue({ entries: [] });
    const w = mountView();
    await flushPromises();
    expect(w.text()).toContain('Trống');
  });

  it('render event cards khi có data', async () => {
    playerListEventsMock.mockResolvedValue({
      events: [
        { key: 'evt1', name: 'Sự kiện 1', description: 'desc', status: 'ACTIVE', eventType: 'SEASONAL', msRemaining: 86400000, myBracketKey: null, myEffectiveRewardTier: null },
      ],
      characterId: 'c1',
    });
    playerListPersonalMock.mockResolvedValue({ entries: [] });
    const w = mountView();
    await flushPromises();
    expect(w.text()).toContain('Sự kiện 1');
  });

  it('switch tab sang personal → gọi playerListPersonal', async () => {
    playerListEventsMock.mockResolvedValue({ events: [], characterId: 'c1' });
    playerListPersonalMock.mockResolvedValue({ entries: [] });
    const w = mountView();
    await flushPromises();
    const tabs = w.findAll('button.tab');
    const personalTab = tabs.find((b) => b.text().includes('Cá nhân'));
    expect(personalTab).toBeTruthy();
    await personalTab!.trigger('click');
    await flushPromises();
    expect(playerListPersonalMock).toHaveBeenCalled();
  });
});
