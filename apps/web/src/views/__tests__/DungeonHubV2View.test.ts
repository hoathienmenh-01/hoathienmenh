import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { createI18n } from 'vue-i18n';
import { setActivePinia, createPinia } from 'pinia';

const { listDungeonsV2Mock } = vi.hoisted(() => ({
  listDungeonsV2Mock: vi.fn(),
}));

vi.mock('@/api/worldContent', async () => {
  const actual: object = await vi.importActual('@/api/worldContent');
  return {
    ...actual,
    listDungeonsV2: listDungeonsV2Mock,
  };
});

vi.mock('@/components/shell/AppShell.vue', () => ({
  default: { name: 'AppShellStub', template: '<div><slot /></div>' },
}));

import DungeonHubV2View from '@/views/DungeonHubV2View.vue';
import viMessages from '@/i18n/vi.json';

const i18n = createI18n({
  legacy: false,
  locale: 'vi',
  fallbackLocale: 'vi',
  missingWarn: false,
  fallbackWarn: false,
  messages: { vi: viMessages },
});

function mountView() {
  return mount(DungeonHubV2View, { global: { plugins: [i18n] } });
}

const STUB = [
  {
    key: 'duoc_uyen_t1',
    nameVi: 'Dược Uyển Tiểu Cảnh',
    nameEn: 'Herb Garden Petite',
    descriptionVi: 'Bí cảnh luyện đan',
    descriptionEn: 'Alchemy dungeon',
    category: 'ALCHEMY_MATERIAL',
    regionKey: 'thanh_so_son',
    sourceTier: 1,
    dungeonTier: 1,
    unlockRealmOrder: 1,
    dailyAttempts: 3,
  },
  {
    key: 'huyet_tri_t1',
    nameVi: 'Huyết Trì Luyện Thể',
    nameEn: 'Blood Pool Body',
    descriptionVi: 'Bí cảnh luyện thể',
    descriptionEn: 'Body cultivation dungeon',
    category: 'BODY_MATERIAL',
    regionKey: 'thanh_so_son',
    sourceTier: 1,
    dungeonTier: 1,
    unlockRealmOrder: 1,
    dailyAttempts: 3,
  },
];

beforeEach(() => {
  setActivePinia(createPinia());
  vi.clearAllMocks();
});

describe('DungeonHubV2View', () => {
  it('loading → list', async () => {
    let resolveFn: (v: unknown) => void = () => undefined;
    listDungeonsV2Mock.mockReturnValueOnce(
      new Promise((res) => {
        resolveFn = res;
      }),
    );
    const w = mountView();
    expect(w.find('[data-testid="dungeon-hub-loading"]').exists()).toBe(true);
    resolveFn(STUB);
    await flushPromises();
    expect(w.find('[data-testid="dungeon-hub-list"]').exists()).toBe(true);
    expect(w.findAll('[data-testid^="dungeon-hub-item-"]').length).toBe(2);
  });

  it('empty state', async () => {
    listDungeonsV2Mock.mockResolvedValueOnce([]);
    const w = mountView();
    await flushPromises();
    expect(w.find('[data-testid="dungeon-hub-empty"]').exists()).toBe(true);
  });

  it('error → reload', async () => {
    listDungeonsV2Mock.mockRejectedValueOnce(new Error('boom'));
    const w = mountView();
    await flushPromises();
    expect(w.find('[data-testid="dungeon-hub-error"]').exists()).toBe(true);
    listDungeonsV2Mock.mockResolvedValueOnce(STUB);
    await w.find('[data-testid="dungeon-hub-error"] button').trigger('click');
    await flushPromises();
    expect(w.find('[data-testid="dungeon-hub-list"]').exists()).toBe(true);
  });

  it('filter category chỉ giữ entry tương ứng', async () => {
    listDungeonsV2Mock.mockResolvedValueOnce(STUB);
    const w = mountView();
    await flushPromises();
    await w
      .find('[data-testid="dungeon-hub-filter"]')
      .setValue('ALCHEMY_MATERIAL');
    await flushPromises();
    expect(w.findAll('[data-testid^="dungeon-hub-item-"]').length).toBe(1);
    expect(w.find('[data-testid="dungeon-hub-item-duoc_uyen_t1"]').exists()).toBe(true);
  });
});
