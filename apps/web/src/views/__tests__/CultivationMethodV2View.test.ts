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
vi.mock('@/stores/game', () => ({
  useGameStore: () => ({
    fetchState: vi.fn().mockResolvedValue(undefined),
    bindSocket: vi.fn(),
  }),
}));
vi.mock('@/stores/cultivationMethodV2', () => ({
  useCultivationMethodV2Store: () => ({
    loaded: true,
    methods: [],
    catalog: [],
    equippedSlots: [],
    fetchState: vi.fn().mockResolvedValue(undefined),
    isEquipped: () => false,
    isUnlocking: () => false,
    isUpgrading: () => false,
    isEquipping: () => false,
  }),
}));
vi.mock('@/stores/toast', () => ({
  useToastStore: () => ({ push: vi.fn() }),
}));
vi.mock('vue-router', () => ({
  useRouter: () => ({ replace: vi.fn() }),
  useRoute: () => ({ params: {} }),
}));
vi.mock('@/components/shell/AppShell.vue', () => ({
  default: { name: 'AppShellStub', template: '<div data-testid="app-shell"><slot /></div>' },
}));
vi.mock('@/components/xianxia/XTLuxHero.vue', () => ({
  default: { name: 'XTLuxHeroStub', props: ['testId'], template: '<div :data-testid="testId || \'hero\'"><slot /></div>' },
}));

import CultivationMethodV2View from '@/views/CultivationMethodV2View.vue';

const i18n = createI18n({
  legacy: false,
  locale: 'vi',
  fallbackLocale: 'vi',
  missingWarn: false,
  fallbackWarn: false,
  messages: {
    vi: {
      cultivationMethodV2: {
        title: 'Công Pháp V2',
        subtitle: 'sub',
        loading: 'Đang tải',
        empty: 'Trống',
        roleHint: 'Quản lý công pháp.',
        crossNav: {
          cultivation: 'Tu Luyện',
          cultivationDesc: 'desc',
          skillBook: 'Sách Kỹ Năng',
          skillBookDesc: 'desc',
        },
      },
    },
  },
});

function mountView() {
  return mount(CultivationMethodV2View, { global: { plugins: [i18n] } });
}

describe('CultivationMethodV2View — UX polish', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
  });

  it('render hero', async () => {
    const w = mountView();
    await flushPromises();
    expect(w.find('[data-testid="cultivation-method-v2-hero"]').exists()).toBe(true);
  });

  it('render role hint', async () => {
    const w = mountView();
    await flushPromises();
    expect(w.find('[data-testid="cultivation-method-v2-role-hint"]').exists()).toBe(true);
    expect(w.find('[data-testid="cultivation-method-v2-role-hint"]').text()).toBeTruthy();
  });

  it('render cross-nav', async () => {
    const w = mountView();
    await flushPromises();
    expect(w.find('[data-testid="cultivation-method-v2-cross-nav"]').exists()).toBe(true);
    expect(w.find('[data-testid="cross-nav-cultivation"]').exists()).toBe(true);
    expect(w.find('[data-testid="cross-nav-skillBook"]').exists()).toBe(true);
  });
});
