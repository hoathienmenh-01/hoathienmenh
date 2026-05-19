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
vi.mock('@/stores/secretRealm', () => ({
  useSecretRealmStore: () => ({
    loaded: true,
    realms: [],
    fetchState: vi.fn().mockResolvedValue(undefined),
    enter: vi.fn().mockResolvedValue(null),
    claim: vi.fn().mockResolvedValue(null),
    isEntering: () => false,
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

import SecretRealmView from '@/views/SecretRealmView.vue';

const i18n = createI18n({
  legacy: false,
  locale: 'vi',
  fallbackLocale: 'vi',
  missingWarn: false,
  fallbackWarn: false,
  messages: {
    vi: {
      secretRealm: {
        title: 'Bí Cảnh',
        subtitle: 'sub',
        loading: 'Đang tải',
        empty: 'Trống',
        roleHint: 'Thám hiểm bí cảnh.',
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
  return mount(SecretRealmView, { global: { plugins: [i18n] } });
}

describe('SecretRealmView — UX polish', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
  });

  it('render hero', async () => {
    const w = mountView();
    await flushPromises();
    expect(w.find('[data-testid="secret-realm-hero"]').exists()).toBe(true);
  });

  it('render role hint', async () => {
    const w = mountView();
    await flushPromises();
    expect(w.find('[data-testid="secret-realm-role-hint"]').exists()).toBe(true);
    expect(w.find('[data-testid="secret-realm-role-hint"]').text()).toBeTruthy();
  });

  it('render cross-nav', async () => {
    const w = mountView();
    await flushPromises();
    expect(w.find('[data-testid="secret-realm-cross-nav"]').exists()).toBe(true);
    expect(w.find('[data-testid="cross-nav-dungeon"]').exists()).toBe(true);
    expect(w.find('[data-testid="cross-nav-combat"]').exists()).toBe(true);
  });
});
