import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { createI18n } from 'vue-i18n';
import { setActivePinia, createPinia } from 'pinia';
import type {
  TerritoryRegionsView,
  TerritoryLeaderboardView,
  TerritoryMyView,
} from '@/api/territory';

/**
 * Phase 14.0.A — TerritoryView smoke + flow tests.
 *
 * Cover:
 *   - Auth gate (unauth → redirect /auth, no API calls).
 *   - Loading + render content (region list overview, leaderboard, my-sect).
 *   - No-sect state (me tab fallback).
 *   - Switch tab + region pick triggers leaderboard fetch.
 *   - Load error fallback.
 */

const getRegionsMock = vi.fn();
const getMeMock = vi.fn();
const getLeaderboardMock = vi.fn();

vi.mock('@/api/territory', async () => {
  const actual =
    await vi.importActual<typeof import('@/api/territory')>('@/api/territory');
  return {
    ...actual,
    getTerritoryRegions: (...a: unknown[]) => getRegionsMock(...a),
    getTerritoryMe: (...a: unknown[]) => getMeMock(...a),
    getTerritoryRegionLeaderboard: (...a: unknown[]) =>
      getLeaderboardMock(...a),
  };
});

const routerReplaceMock = vi.fn().mockResolvedValue(undefined);
const routeQuery: { tab?: string; region?: string } = {};
vi.mock('vue-router', () => ({
  useRouter: () => ({ replace: routerReplaceMock }),
  useRoute: () => ({
    query: routeQuery,
    params: {},
    path: '/territory',
    name: 'territory',
    fullPath: '/territory',
    hash: '',
    matched: [],
    redirectedFrom: undefined,
    meta: {},
  }),
}));

const authState = {
  isAuthenticated: true,
  hydrate: vi.fn().mockResolvedValue(undefined),
};
vi.mock('@/stores/auth', () => ({
  useAuthStore: () => authState,
}));

vi.mock('@/components/shell/AppShell.vue', () => ({
  default: { name: 'AppShell', template: '<div><slot /></div>' },
}));

import TerritoryView from '@/views/TerritoryView.vue';

const i18n = createI18n({
  legacy: false,
  locale: 'vi',
  fallbackLocale: 'vi',
  missingWarn: false,
  fallbackWarn: false,
  messages: {
    vi: {
      territory: {
        title: 'Lãnh Địa Tông Môn',
        subtitle: 'Ảnh hưởng vùng đất',
        loading: 'Đang tải…',
        tab: {
          overview: 'Tổng quan',
          leaderboard: 'Bảng xếp hạng',
          me: 'Tông của tôi',
        },
        overview: {
          empty: 'Chưa có dữ liệu',
          summary: '{pts} điểm · {contributors} TV',
          topSect: 'Đứng đầu: {name} ({pts})',
          noTopSect: 'Chưa có Tông',
        },
        leaderboard: {
          empty: 'Chưa có Tông nào',
          pickHint: 'Chọn vùng đất',
          youTag: '(Tông của tôi)',
          col: {
            rank: 'Hạng',
            sect: 'Tông',
            points: 'Điểm',
            contributors: 'TV',
          },
        },
        me: {
          noSect: 'Chưa gia nhập Tông',
          header: 'Tông: {sect}',
          col: {
            region: 'Vùng',
            rank: 'Hạng',
            sectPoints: 'Điểm Tông',
            personalPoints: 'Cá nhân',
          },
        },
        errors: {
          NO_CHARACTER: 'Chưa có nhân vật',
          REGION_INVALID: 'Vùng không tồn tại',
          UNKNOWN: 'Lỗi không rõ',
        },
      },
    },
  },
});

function makeRegions(): TerritoryRegionsView {
  return {
    regions: [
      {
        regionKey: 'son_coc',
        nameVi: 'Sơn Cốc',
        nameEn: 'Son Coc',
        flavorVi: '',
        flavorEn: '',
        unlockRealmKey: 'r1',
        sortOrder: 1,
        dominantElement: null,
        totalPoints: 80,
        contributors: 4,
        topSectId: 'sect-1',
        topSectName: 'Thanh Vân',
        topSectPoints: 64,
      },
      {
        regionKey: 'kim_son_mach',
        nameVi: 'Kim Sơn Mạch',
        nameEn: 'Kim Son Mach',
        flavorVi: '',
        flavorEn: '',
        unlockRealmKey: 'r2',
        sortOrder: 2,
        dominantElement: 'kim',
        totalPoints: 0,
        contributors: 0,
        topSectId: null,
        topSectName: null,
        topSectPoints: 0,
      },
    ],
  };
}

function makeMe(over: Partial<TerritoryMyView> = {}): TerritoryMyView {
  return {
    hasSect: true,
    sectId: 'sect-1',
    sectName: 'Thanh Vân',
    regions: [
      {
        regionKey: 'son_coc',
        nameVi: 'Sơn Cốc',
        nameEn: 'Son Coc',
        sectPoints: 64,
        sectRank: 1,
        personalPoints: 16,
      },
      {
        regionKey: 'kim_son_mach',
        nameVi: 'Kim Sơn Mạch',
        nameEn: 'Kim Son Mach',
        sectPoints: 0,
        sectRank: null,
        personalPoints: 0,
      },
    ],
    ...over,
  };
}

function makeLeaderboard(regionKey = 'son_coc'): TerritoryLeaderboardView {
  return {
    regionKey: regionKey as TerritoryLeaderboardView['regionKey'],
    rows: [
      {
        rank: 1,
        sectId: 'sect-1',
        sectName: 'Thanh Vân',
        points: 64,
        contributors: 3,
      },
      {
        rank: 2,
        sectId: 'sect-2',
        sectName: 'Huyền Thuỷ',
        points: 16,
        contributors: 1,
      },
    ],
  };
}

function mountView() {
  return mount(TerritoryView, { global: { plugins: [i18n] } });
}

beforeEach(() => {
  setActivePinia(createPinia());
  getRegionsMock.mockReset();
  getMeMock.mockReset();
  getLeaderboardMock.mockReset();
  routerReplaceMock.mockReset();
  routerReplaceMock.mockResolvedValue(undefined);
  authState.isAuthenticated = true;
  authState.hydrate.mockReset();
  authState.hydrate.mockResolvedValue(undefined);
  delete routeQuery.tab;
  delete routeQuery.region;
});

describe('TerritoryView — auth gate', () => {
  it('unauth → replace /auth, KHÔNG fetch', async () => {
    authState.isAuthenticated = false;
    mountView();
    await flushPromises();
    expect(routerReplaceMock).toHaveBeenCalledWith('/auth');
    expect(getRegionsMock).not.toHaveBeenCalled();
    expect(getMeMock).not.toHaveBeenCalled();
  });
});

describe('TerritoryView — render flow', () => {
  it('auth + load thành công → render overview region list', async () => {
    getRegionsMock.mockResolvedValue(makeRegions());
    getMeMock.mockResolvedValue(makeMe());
    const w = mountView();
    await flushPromises();

    expect(w.find('[data-test="territory-content"]').exists()).toBe(true);
    expect(w.find('[data-test="territory-loading"]').exists()).toBe(false);

    const rows = w.findAll('[data-test="territory-region-row"]');
    expect(rows.length).toBe(2);
    expect(rows[0].text()).toContain('Sơn Cốc');
    expect(rows[0].text()).toContain('80 điểm');
    expect(rows[0].text()).toContain('Đứng đầu: Thanh Vân (64)');
    expect(rows[1].text()).toContain('Kim Sơn Mạch');
    expect(rows[1].text()).toContain('Chưa có Tông');
  });

  it('switch leaderboard tab → fetch + render leaderboard rows', async () => {
    getRegionsMock.mockResolvedValue(makeRegions());
    getMeMock.mockResolvedValue(makeMe());
    getLeaderboardMock.mockResolvedValue(makeLeaderboard('son_coc'));
    const w = mountView();
    await flushPromises();

    await w.find('[data-test="territory-tab-leaderboard"]').trigger('click');
    await flushPromises();

    // Auto-selected son_coc (sortOrder=1) → fetched.
    expect(getLeaderboardMock).toHaveBeenCalledWith('son_coc');

    const lbRows = w.findAll('[data-test="territory-leaderboard-row"]');
    expect(lbRows.length).toBe(2);
    expect(lbRows[0].text()).toContain('Thanh Vân');
    expect(lbRows[0].text()).toContain('(Tông của tôi)');
    expect(lbRows[1].text()).toContain('Huyền Thuỷ');
  });

  it('switch leaderboard → đổi region pick triggers fetch region khác', async () => {
    getRegionsMock.mockResolvedValue(makeRegions());
    getMeMock.mockResolvedValue(makeMe());
    getLeaderboardMock
      .mockResolvedValueOnce(makeLeaderboard('son_coc'))
      .mockResolvedValueOnce(makeLeaderboard('kim_son_mach'));
    const w = mountView();
    await flushPromises();

    await w.find('[data-test="territory-tab-leaderboard"]').trigger('click');
    await flushPromises();

    await w
      .find('[data-test="territory-region-pick-kim_son_mach"]')
      .trigger('click');
    await flushPromises();

    expect(getLeaderboardMock).toHaveBeenCalledWith('kim_son_mach');
  });

  it('me tab + character có sect → render rank table', async () => {
    routeQuery.tab = 'me';
    getRegionsMock.mockResolvedValue(makeRegions());
    getMeMock.mockResolvedValue(makeMe());
    const w = mountView();
    await flushPromises();

    expect(w.find('[data-test="territory-me-table"]').exists()).toBe(true);
    const meRows = w.findAll('[data-test="territory-me-row"]');
    expect(meRows.length).toBe(2);
    expect(meRows[0].text()).toContain('Sơn Cốc');
    expect(meRows[0].text()).toContain('#1');
    expect(meRows[0].text()).toContain('64');
    expect(meRows[0].text()).toContain('16');
    // Region không có sect points → rank cell hiển thị "—"
    expect(meRows[1].text()).toContain('—');
  });

  it('me tab + character không có sect → fallback noSect', async () => {
    routeQuery.tab = 'me';
    getRegionsMock.mockResolvedValue(makeRegions());
    getMeMock.mockResolvedValue(
      makeMe({
        hasSect: false,
        sectId: null,
        sectName: null,
      }),
    );
    const w = mountView();
    await flushPromises();

    expect(w.find('[data-test="territory-me-no-sect"]').exists()).toBe(true);
    expect(w.find('[data-test="territory-me-table"]').exists()).toBe(false);
  });
});

describe('TerritoryView — load error fallback', () => {
  it('getRegions throws → render error placeholder, KHÔNG crash', async () => {
    getRegionsMock.mockRejectedValue(
      Object.assign(new Error('down'), { code: 'NO_CHARACTER' }),
    );
    getMeMock.mockResolvedValue(makeMe());
    const w = mountView();
    await flushPromises();

    expect(w.find('[data-test="territory-error"]').exists()).toBe(true);
    expect(w.text()).toContain('Chưa có nhân vật');
  });
});
