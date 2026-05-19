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
vi.mock('@/stores/toast', () => ({
  useToastStore: () => ({ push: vi.fn() }),
}));
vi.mock('vue-router', () => ({
  useRouter: () => ({ replace: vi.fn() }),
}));
vi.mock('@/api/pet', () => ({
  getPetCollection: vi.fn().mockResolvedValue({ pets: [] }),
  getPetCatalog: vi.fn().mockResolvedValue({ pets: [] }),
  getPetBoxes: vi.fn().mockResolvedValue({ boxes: [] }),
  openPetBox: vi.fn().mockResolvedValue({}),
  getPetSources: vi.fn().mockResolvedValue({ sources: [] }),
  getPetLogs: vi.fn().mockResolvedValue({ logs: [] }),
  upgradePet: vi.fn().mockResolvedValue({}),
}));
vi.mock('@/components/shell/AppShell.vue', () => ({
  default: { name: 'AppShellStub', template: '<div data-testid="app-shell"><slot /></div>' },
}));
vi.mock('@/components/xianxia/XTLuxHero.vue', () => ({
  default: { name: 'XTLuxHeroStub', props: ['testId'], template: '<div :data-testid="testId || \'hero\'"><slot /></div>' },
}));

import PetsView from '@/views/PetsView.vue';

const i18n = createI18n({
  legacy: false,
  locale: 'vi',
  fallbackLocale: 'vi',
  missingWarn: false,
  fallbackWarn: false,
  messages: {
    vi: {
      pets: {
        title: 'Linh Thú',
        subtitle: 'sub',
        loading: 'Đang tải',
        empty: 'Trống',
        roleHint: 'Quản lý linh thú.',
        crossNav: {
          combat: 'Chiến Đấu',
          combatDesc: 'desc',
          inventory: 'Túi Đồ',
          inventoryDesc: 'desc',
        },
        tab: { collection: 'Bộ sưu tập', catalog: 'Danh mục', boxes: 'Rương', upgrade: 'Nâng cấp', sources: 'Nguồn', logs: 'Nhật ký' },
      },
    },
  },
});

function mountView() {
  return mount(PetsView, { global: { plugins: [i18n] } });
}

describe('PetsView — UX polish', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
  });

  it('render hero', async () => {
    const w = mountView();
    await flushPromises();
    expect(w.find('[data-testid="pets-hero"]').exists()).toBe(true);
  });

  it('render role hint', async () => {
    const w = mountView();
    await flushPromises();
    expect(w.find('[data-testid="pets-role-hint"]').exists()).toBe(true);
    expect(w.find('[data-testid="pets-role-hint"]').text()).toBeTruthy();
  });

  it('render cross-nav', async () => {
    const w = mountView();
    await flushPromises();
    expect(w.find('[data-testid="pets-cross-nav"]').exists()).toBe(true);
  });
});
