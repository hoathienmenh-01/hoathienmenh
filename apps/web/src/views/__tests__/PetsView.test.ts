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
const listPetCatalogMock = vi.fn();
const listPetCollectionMock = vi.fn();
const listPetShardsMock = vi.fn();
const listPetBoxesMock = vi.fn();
const listPetBoxLogsMock = vi.fn();
const equipPetMock = vi.fn();
const unequipPetMock = vi.fn();
const getEquippedSnapshotMock = vi.fn();

vi.mock('@/api/pet', () => ({
  listPetCatalog: (...a: unknown[]) => listPetCatalogMock(...a),
  listPetCollection: (...a: unknown[]) => listPetCollectionMock(...a),
  listPetShards: (...a: unknown[]) => listPetShardsMock(...a),
  listPetBoxes: (...a: unknown[]) => listPetBoxesMock(...a),
  listPetBoxLogs: (...a: unknown[]) => listPetBoxLogsMock(...a),
  getPetBoxPity: vi.fn().mockResolvedValue(null),
  openPetBox: vi.fn().mockResolvedValue({}),
  equipPet: (...a: unknown[]) => equipPetMock(...a),
  unequipPet: (...a: unknown[]) => unequipPetMock(...a),
  lockPet: vi.fn().mockResolvedValue(undefined),
  unlockPet: vi.fn().mockResolvedValue(undefined),
  renamePet: vi.fn().mockResolvedValue(undefined),
  starUpPet: vi.fn().mockResolvedValue({}),
  breakthroughPet: vi.fn().mockResolvedValue({}),
  evolvePet: vi.fn().mockResolvedValue({}),
  getEquippedSnapshot: (...a: unknown[]) => getEquippedSnapshotMock(...a),
  getPetSources: vi.fn().mockResolvedValue([]),
  feedPet: vi.fn().mockResolvedValue({}),
  upgradePetSkill: vi.fn().mockResolvedValue({}),
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
    listPetCatalogMock.mockResolvedValue([]);
    listPetCollectionMock.mockResolvedValue([]);
    listPetShardsMock.mockResolvedValue([]);
    listPetBoxesMock.mockResolvedValue([]);
    listPetBoxLogsMock.mockResolvedValue([]);
    getEquippedSnapshotMock.mockResolvedValue({ contexts: [] });
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

describe('PetsView — functional', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    listPetCatalogMock.mockReset();
    listPetCollectionMock.mockReset();
    listPetShardsMock.mockReset();
    listPetBoxesMock.mockReset();
    listPetBoxLogsMock.mockReset();
    equipPetMock.mockReset();
    unequipPetMock.mockReset();
    getEquippedSnapshotMock.mockReset();
    listPetCatalogMock.mockResolvedValue([]);
    listPetCollectionMock.mockResolvedValue([]);
    listPetShardsMock.mockResolvedValue([]);
    listPetBoxesMock.mockResolvedValue([]);
    listPetBoxLogsMock.mockResolvedValue([]);
  });

  it('empty state khi collection rỗng', async () => {
    listPetCatalogMock.mockResolvedValue([]);
    listPetCollectionMock.mockResolvedValue([]);
    const w = mountView();
    await flushPromises();
    expect(w.text()).toContain('Trống');
  });

  it('render pet cards khi có collection', async () => {
    listPetCollectionMock.mockResolvedValue([
      { id: 'p1', petKey: 'phuong_hoang', customName: null, level: 5, star: 1, isEquipped: true, locked: false, element: 'HOA', type: 'LINH_THU', skillLevel: 1 },
    ]);
    listPetCatalogMock.mockResolvedValue([
      { petKey: 'phuong_hoang', nameVi: 'Phượng Hoàng', nameEn: 'Phoenix', type: 'LINH_THU', element: 'HOA', tier: 'LEGENDARY', rarity: 'SSR', quality: 'SSR', role: 'ATTACK', skillKeys: ['fire_ball', 'rebirth'] },
    ]);
    getEquippedSnapshotMock.mockResolvedValue({ contexts: [] });
    const w = mountView();
    await flushPromises();
    expect(w.text()).toContain('Phượng Hoàng');
  });

  it('switch tab sang catalog', async () => {
    listPetCatalogMock.mockResolvedValue([
      { petKey: 'phuong_hoang', nameVi: 'Phượng Hoàng', nameEn: 'Phoenix', type: 'LINH_THU', element: 'HOA', tier: 'LEGENDARY', rarity: 'SSR', quality: 'SSR', role: 'ATTACK', skillKeys: ['fire_ball', 'rebirth'] },
    ]);
    const w = mountView();
    await flushPromises();
    const buttons = w.findAll('button');
    const catalogTab = buttons.find((b) => b.text().toLowerCase().includes('catalog') || b.text().toLowerCase().includes('danh mục'));
    if (catalogTab) {
      await catalogTab.trigger('click');
      await flushPromises();
      expect(w.text()).toContain('Phượng Hoàng');
    }
  });
});
