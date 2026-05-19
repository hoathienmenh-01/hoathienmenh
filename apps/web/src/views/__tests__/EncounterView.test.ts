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
vi.mock('@/stores/dailyEncounter', () => ({
  useDailyEncounterStore: () => ({
    loaded: true,
    encounters: [],
    fetchState: vi.fn().mockResolvedValue(undefined),
    claim: vi.fn().mockResolvedValue(null),
    isClaiming: () => false,
  }),
}));
vi.mock('@/stores/toast', () => ({
  useToastStore: () => ({ push: vi.fn() }),
}));
vi.mock('vue-router', () => ({
  useRouter: () => ({ replace: vi.fn() }),
}));
vi.mock('@/components/shell/AppShell.vue', () => ({
  default: { name: 'AppShellStub', template: '<div data-testid="app-shell"><slot /></div>' },
}));
vi.mock('@/components/xianxia/XTLuxHero.vue', () => ({
  default: { name: 'XTLuxHeroStub', props: ['testId'], template: '<div :data-testid="testId || \'hero\'"><slot /></div>' },
}));

import EncounterView from '@/views/EncounterView.vue';

const i18n = createI18n({
  legacy: false,
  locale: 'vi',
  fallbackLocale: 'vi',
  missingWarn: false,
  fallbackWarn: false,
  messages: {
    vi: {
      encounter: {
        title: 'Kỳ Ngộ',
        subtitle: 'sub',
        loading: 'Đang tải',
        empty: 'Trống',
        roleHint: 'Gặp gỡ ngẫu nhiên.',
        crossNav: {
          dungeon: 'Phó Bản',
          dungeonDesc: 'desc',
          combat: 'Chiến Đấu',
          combatDesc: 'desc',
        },
      },
    },
  },
});

function mountView() {
  return mount(EncounterView, { global: { plugins: [i18n] } });
}

describe('EncounterView — UX polish', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
  });

  it('render hero', async () => {
    const w = mountView();
    await flushPromises();
    expect(w.find('[data-testid="encounter-view-hero"]').exists()).toBe(true);
  });

  it('render role hint', async () => {
    const w = mountView();
    await flushPromises();
    expect(w.find('[data-testid="encounter-role-hint"]').exists()).toBe(true);
    expect(w.find('[data-testid="encounter-role-hint"]').text()).toBeTruthy();
  });

  it('render cross-nav', async () => {
    const w = mountView();
    await flushPromises();
    expect(w.find('[data-testid="encounter-cross-nav"]').exists()).toBe(true);
    expect(w.find('[data-testid="cross-nav-dungeon"]').exists()).toBe(true);
    expect(w.find('[data-testid="cross-nav-combat"]').exists()).toBe(true);
  });
});
