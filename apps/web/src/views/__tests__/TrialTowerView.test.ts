import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { createI18n } from 'vue-i18n';
import { setActivePinia, createPinia } from 'pinia';

const { listTrialTowersMock, attemptTrialFloorMock, toastPushMock } = vi.hoisted(
  () => ({
    listTrialTowersMock: vi.fn(),
    attemptTrialFloorMock: vi.fn(),
    toastPushMock: vi.fn(),
  }),
);

vi.mock('@/stores/toast', () => ({
  useToastStore: () => ({ push: toastPushMock }),
}));

vi.mock('@/api/worldContent', async () => {
  const actual: object = await vi.importActual('@/api/worldContent');
  return {
    ...actual,
    listTrialTowers: listTrialTowersMock,
    attemptTrialFloor: attemptTrialFloorMock,
  };
});

vi.mock('@/components/shell/AppShell.vue', () => ({
  default: { name: 'AppShellStub', template: '<div><slot /></div>' },
}));

import TrialTowerView from '@/views/TrialTowerView.vue';
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
  return mount(TrialTowerView, { global: { plugins: [i18n] } });
}

const STUB_TOWERS = [
  {
    key: 'dang_tien_thap',
    towerType: 'DANG_TIEN_THAP' as const,
    nameVi: 'Đăng Tiên Tháp',
    nameEn: 'Ascend Tower',
    descriptionVi: 'Tháp tổng hợp',
    descriptionEn: 'General tower',
    unlockRealmOrder: 1,
    unlocked: true,
    infiniteScaling: true,
    maxGeneratedFloor: null,
    dailyAttempts: 5,
    statWeights: {},
    highestFloorCleared: 49,
    seasonHighestFloor: 49,
    enabled: true,
  },
  {
    key: 'linh_khi_thap',
    towerType: 'LINH_KHI_THAP' as const,
    nameVi: 'Linh Khí Tháp',
    nameEn: 'Spirit Qi Tower',
    descriptionVi: 'Tháp luyện khí',
    descriptionEn: 'Qi tower',
    unlockRealmOrder: 1,
    unlocked: true,
    infiniteScaling: true,
    maxGeneratedFloor: null,
    dailyAttempts: 5,
    statWeights: { qi: 1 },
    highestFloorCleared: 0,
    seasonHighestFloor: 0,
    enabled: true,
  },
];

beforeEach(() => {
  setActivePinia(createPinia());
  vi.clearAllMocks();
});

describe('TrialTowerView', () => {
  it('loading → list towers + hiển thị highest floor', async () => {
    let resolveFn: (v: unknown) => void = () => undefined;
    listTrialTowersMock.mockReturnValueOnce(
      new Promise((res) => {
        resolveFn = res;
      }),
    );
    const w = mountView();
    expect(w.find('[data-testid="trial-tower-loading"]').exists()).toBe(true);
    resolveFn(STUB_TOWERS);
    await flushPromises();
    expect(w.find('[data-testid="trial-tower-list"]').exists()).toBe(true);
    expect(w.text()).toContain('49');
  });

  it('empty state khi không có tháp', async () => {
    listTrialTowersMock.mockResolvedValueOnce([]);
    const w = mountView();
    await flushPromises();
    expect(w.find('[data-testid="trial-tower-empty"]').exists()).toBe(true);
  });

  it('error state + reload', async () => {
    listTrialTowersMock.mockRejectedValueOnce(new Error('boom'));
    const w = mountView();
    await flushPromises();
    expect(w.find('[data-testid="trial-tower-error"]').exists()).toBe(true);
    listTrialTowersMock.mockResolvedValueOnce(STUB_TOWERS);
    await w.find('[data-testid="trial-tower-error"] button').trigger('click');
    await flushPromises();
    expect(w.find('[data-testid="trial-tower-list"]').exists()).toBe(true);
  });

  it('switch tab sang tháp khác', async () => {
    listTrialTowersMock.mockResolvedValueOnce(STUB_TOWERS);
    const w = mountView();
    await flushPromises();
    await w.find('[data-testid="trial-tower-tab-LINH_KHI_THAP"]').trigger('click');
    await flushPromises();
    expect(w.text()).toContain('Linh Khí Tháp');
  });

  it('attempt floor — gọi attemptTrialFloor với floor input', async () => {
    listTrialTowersMock.mockResolvedValueOnce(STUB_TOWERS);
    attemptTrialFloorMock.mockResolvedValueOnce({
      towerKey: 'dang_tien_thap',
      floor: 50,
      success: true,
      requiredPower: 100,
      battlePower: 200,
      enemyType: 'MILESTONE_BOSS',
      isFirstClear: true,
      milestoneClaimed: true,
      reward: { linhThach: 100, exp: 50, trialPoints: 10 },
    });
    const w = mountView();
    await flushPromises();
    await w
      .find('[data-testid="trial-tower-floor-input-dang_tien_thap"]')
      .setValue(50);
    await w
      .find('[data-testid="trial-tower-attempt-dang_tien_thap"]')
      .trigger('click');
    await flushPromises();
    expect(attemptTrialFloorMock).toHaveBeenCalledWith('dang_tien_thap', 50);
    expect(w.find('[data-testid="trial-tower-last-result"]').exists()).toBe(true);
  });
});
