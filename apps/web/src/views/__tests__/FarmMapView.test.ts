import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { createI18n } from 'vue-i18n';
import { setActivePinia, createPinia } from 'pinia';

/**
 * Phase 26.5 — FarmMapView tests.
 *
 * Bao phủ 4 state UI MODULE RULE (loading / empty / error / list) +
 * golden path: start session → claim disabled khi đang busy.
 */

const {
  listFarmMapsMock,
  startFarmSessionMock,
  claimFarmSessionMock,
  toastPushMock,
} = vi.hoisted(() => ({
  listFarmMapsMock: vi.fn(),
  startFarmSessionMock: vi.fn(),
  claimFarmSessionMock: vi.fn(),
  toastPushMock: vi.fn(),
}));

vi.mock('@/stores/toast', () => ({
  useToastStore: () => ({ push: toastPushMock }),
}));

vi.mock('@/api/worldContent', async () => {
  const actual: object = await vi.importActual('@/api/worldContent');
  return {
    ...actual,
    listFarmMaps: listFarmMapsMock,
    startFarmSession: startFarmSessionMock,
    claimFarmSession: claimFarmSessionMock,
  };
});

vi.mock('@/components/shell/AppShell.vue', () => ({
  default: { name: 'AppShellStub', template: '<div><slot /></div>' },
}));

import FarmMapView from '@/views/FarmMapView.vue';
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
  return mount(FarmMapView, { global: { plugins: [i18n] } });
}

const STUB_MAPS = [
  {
    key: 'thanh_so_son_map_1',
    regionKey: 'thanh_so_son',
    nameVi: 'Thanh Sơ Lâm',
    nameEn: 'Thanh So Forest',
    sourceTier: 1,
    recommendedRealmOrder: 1,
    unlockRealmOrder: 1,
    unlocked: true,
    unlockReason: null,
    autoFarmAllowed: true,
    sweepAllowed: true,
    freeSessionMinutes: 60,
    sessionLimitMinutes: 60,
    maxSessionMinutes: 720,
    monsterPoolSize: 6,
    opportunityPoolSize: 3,
    enabled: true,
  },
  {
    key: 'thanh_so_son_map_2',
    regionKey: 'thanh_so_son',
    nameVi: 'Linh Sơn',
    nameEn: 'Linh Mountain',
    sourceTier: 2,
    recommendedRealmOrder: 3,
    unlockRealmOrder: 5,
    unlocked: false,
    unlockReason: 'REALM_TOO_LOW',
    autoFarmAllowed: true,
    sweepAllowed: false,
    freeSessionMinutes: 60,
    sessionLimitMinutes: 60,
    maxSessionMinutes: 720,
    monsterPoolSize: 4,
    opportunityPoolSize: 2,
    enabled: true,
  },
];

beforeEach(() => {
  setActivePinia(createPinia());
  vi.clearAllMocks();
});

describe('FarmMapView', () => {
  it('hiển thị loading lúc đầu, list sau khi load', async () => {
    let resolveFn: (v: unknown) => void = () => undefined;
    listFarmMapsMock.mockReturnValueOnce(
      new Promise((res) => {
        resolveFn = res;
      }),
    );
    const w = mountView();
    expect(w.find('[data-testid="farm-map-loading"]').exists()).toBe(true);
    resolveFn(STUB_MAPS);
    await flushPromises();
    expect(w.find('[data-testid="farm-map-list"]').exists()).toBe(true);
    expect(w.findAll('[data-testid^="farm-map-item-"]').length).toBe(2);
  });

  it('empty state khi không có map', async () => {
    listFarmMapsMock.mockResolvedValueOnce([]);
    const w = mountView();
    await flushPromises();
    expect(w.find('[data-testid="farm-map-empty"]').exists()).toBe(true);
  });

  it('error state khi fetch fail + reload nhiều lần', async () => {
    listFarmMapsMock.mockRejectedValueOnce(new Error('boom'));
    const w = mountView();
    await flushPromises();
    expect(w.find('[data-testid="farm-map-error"]').exists()).toBe(true);
    listFarmMapsMock.mockResolvedValueOnce(STUB_MAPS);
    await w.find('[data-testid="farm-map-error"] button').trigger('click');
    await flushPromises();
    expect(w.find('[data-testid="farm-map-list"]').exists()).toBe(true);
  });

  it('start farm button hoạt động — gọi startFarmSession + claim button hiện ra', async () => {
    listFarmMapsMock.mockResolvedValueOnce(STUB_MAPS);
    startFarmSessionMock.mockResolvedValueOnce({
      id: 'sess-1',
      farmMapKey: 'thanh_so_son_map_1',
      status: 'ACTIVE',
      startedAt: '2025-01-01T00:00:00Z',
      endedAt: null,
      minutesProcessed: 0,
      sessionLimitMinutes: 60,
      rewards: { linhThach: 0, exp: 0, sourceTier: 1, items: [] },
    });
    const w = mountView();
    await flushPromises();
    await w.find('[data-testid="farm-map-start-thanh_so_son_map_1"]').trigger('click');
    await flushPromises();
    expect(startFarmSessionMock).toHaveBeenCalledWith('thanh_so_son_map_1');
    expect(w.find('[data-testid="farm-map-claim-thanh_so_son_map_1"]').exists()).toBe(true);
  });

  it('start button disabled khi map locked', async () => {
    listFarmMapsMock.mockResolvedValueOnce(STUB_MAPS);
    const w = mountView();
    await flushPromises();
    const btn = w.find('[data-testid="farm-map-start-thanh_so_son_map_2"]');
    expect((btn.element as HTMLButtonElement).disabled).toBe(true);
  });
});
