import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { createI18n } from 'vue-i18n';
import { setActivePinia, createPinia } from 'pinia';

const { listBossesV2Mock } = vi.hoisted(() => ({
  listBossesV2Mock: vi.fn(),
}));

vi.mock('@/api/worldContent', async () => {
  const actual: object = await vi.importActual('@/api/worldContent');
  return { ...actual, listBossesV2: listBossesV2Mock };
});

vi.mock('@/components/shell/AppShell.vue', () => ({
  default: { name: 'AppShellStub', template: '<div><slot /></div>' },
}));

import BossHubView from '@/views/BossHubView.vue';
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
  return mount(BossHubView, { global: { plugins: [i18n] } });
}

const STUB = [
  {
    key: 'huyet_lang_dau_dan',
    nameVi: 'Huyết Lang Đầu Đàn',
    nameEn: 'Blood Wolf Alpha',
    category: 'REGION_BOSS',
    family: 'YEU_THU',
    element: 'NONE',
    regionKey: 'thanh_so_son',
    sourceTier: 1,
    bossTier: 1,
    recommendedRealmOrder: 2,
    dailyRewardCap: 3,
    weeklyRewardCap: null,
    manualOnly: true,
  },
  {
    key: 'tinh_anh_yeu_vuong',
    nameVi: 'Tinh Anh Yêu Vương',
    nameEn: 'Elite Demon King',
    category: 'WORLD_BOSS',
    family: 'YEU_THU',
    element: 'KIM',
    regionKey: null,
    sourceTier: 3,
    bossTier: 3,
    recommendedRealmOrder: 8,
    dailyRewardCap: null,
    weeklyRewardCap: 1,
    manualOnly: false,
  },
];

beforeEach(() => {
  setActivePinia(createPinia());
  vi.clearAllMocks();
});

describe('BossHubView', () => {
  it('loading → list', async () => {
    let resolveFn: (v: unknown) => void = () => undefined;
    listBossesV2Mock.mockReturnValueOnce(
      new Promise((res) => {
        resolveFn = res;
      }),
    );
    const w = mountView();
    expect(w.find('[data-testid="boss-hub-loading"]').exists()).toBe(true);
    resolveFn(STUB);
    await flushPromises();
    expect(w.find('[data-testid="boss-hub-list"]').exists()).toBe(true);
    expect(w.findAll('[data-testid^="boss-hub-item-"]').length).toBe(2);
  });

  it('empty state', async () => {
    listBossesV2Mock.mockResolvedValueOnce([]);
    const w = mountView();
    await flushPromises();
    expect(w.find('[data-testid="boss-hub-empty"]').exists()).toBe(true);
  });

  it('error → reload', async () => {
    listBossesV2Mock.mockRejectedValueOnce(new Error('boom'));
    const w = mountView();
    await flushPromises();
    expect(w.find('[data-testid="boss-hub-error"]').exists()).toBe(true);
    listBossesV2Mock.mockResolvedValueOnce(STUB);
    await w.find('[data-testid="boss-hub-error"] button').trigger('click');
    await flushPromises();
    expect(w.find('[data-testid="boss-hub-list"]').exists()).toBe(true);
  });

  it('filter category=WORLD_BOSS lọc đúng entry', async () => {
    listBossesV2Mock.mockResolvedValueOnce(STUB);
    const w = mountView();
    await flushPromises();
    await w.find('[data-testid="boss-hub-filter"]').setValue('WORLD_BOSS');
    await flushPromises();
    expect(w.findAll('[data-testid^="boss-hub-item-"]').length).toBe(1);
    expect(w.find('[data-testid="boss-hub-item-tinh_anh_yeu_vuong"]').exists()).toBe(true);
  });
});
