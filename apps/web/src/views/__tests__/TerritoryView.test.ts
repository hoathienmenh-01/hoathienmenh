import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { createI18n } from 'vue-i18n';
import { setActivePinia, createPinia } from 'pinia';
import type {
  TerritoryRegionsView,
  TerritoryLeaderboardView,
  TerritoryMyView,
  TerritoryRegionHistoryView,
  TerritorySettlementRunResult,
  TerritoryRegionView,
} from '@/api/territory';

/**
 * Phase 14.0.A + 14.0.B — TerritoryView smoke + flow tests.
 *
 * Cover:
 *   - Auth gate (unauth → redirect /auth, no API calls).
 *   - Loading + render content (region list overview, leaderboard, my-sect).
 *   - No-sect state (me tab fallback).
 *   - Switch tab + region pick triggers leaderboard fetch.
 *   - Load error fallback.
 *   - Phase 14.0.B: owner badge + history panel render
 *   - Phase 14.0.B: admin panel visibility + settlement trigger
 */

const getRegionsMock = vi.fn();
const getMeMock = vi.fn();
const getLeaderboardMock = vi.fn();
const getHistoryMock = vi.fn();
const adminSettleAllMock = vi.fn();
const adminSettleRegionMock = vi.fn();

vi.mock('@/api/territory', async () => {
  const actual =
    await vi.importActual<typeof import('@/api/territory')>('@/api/territory');
  return {
    ...actual,
    getTerritoryRegions: (...a: unknown[]) => getRegionsMock(...a),
    getTerritoryMe: (...a: unknown[]) => getMeMock(...a),
    getTerritoryRegionLeaderboard: (...a: unknown[]) =>
      getLeaderboardMock(...a),
    getTerritoryRegionHistory: (...a: unknown[]) => getHistoryMock(...a),
    adminTerritorySettleAll: (...a: unknown[]) => adminSettleAllMock(...a),
    adminTerritorySettleRegion: (...a: unknown[]) =>
      adminSettleRegionMock(...a),
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

const authState: {
  isAuthenticated: boolean;
  hydrate: ReturnType<typeof vi.fn>;
  user: { role: 'PLAYER' | 'MOD' | 'ADMIN' } | null;
} = {
  isAuthenticated: true,
  hydrate: vi.fn().mockResolvedValue(undefined),
  user: { role: 'PLAYER' },
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
          owner: 'Chủ: {name}',
          noOwner: 'Chưa có chủ',
          ownerSettled: 'Kết toán: {period}',
          ownerBadge: 'Đang chiếm giữ',
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
        history: {
          title: 'Lịch sử',
          empty: 'Chưa kết toán',
          viewMore: 'Xem',
          current: 'Chủ: {name} (kỳ {period})',
          currentNone: 'Chưa có chủ',
          row: '{period} · {sect} ({pts}) · runner-up {runner} ({rpts})',
          rowNoRunner: '{period} · {sect} ({pts})',
        },
        admin: {
          title: 'Admin',
          subtitle: 'Settle',
          periodLabel: 'Period',
          settleAll: 'Settle all',
          settleRegion: 'Settle region',
          running: 'Running…',
          lastResult: 'Settled {period}: {wins} wins · {skip} skip',
        },
      },
    },
  },
});

function makeRegions(over: {
  ownerSon?: Pick<
    TerritoryRegionView,
    'ownerSectId' | 'ownerSectName' | 'ownerPeriodKey' | 'ownerSettledAt'
  >;
} = {}): TerritoryRegionsView {
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
        ownerSectId: over.ownerSon?.ownerSectId ?? null,
        ownerSectName: over.ownerSon?.ownerSectName ?? null,
        ownerPeriodKey: over.ownerSon?.ownerPeriodKey ?? null,
        ownerSettledAt: over.ownerSon?.ownerSettledAt ?? null,
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
        ownerSectId: null,
        ownerSectName: null,
        ownerPeriodKey: null,
        ownerSettledAt: null,
      },
    ],
  };
}

function makeHistory(
  over: Partial<TerritoryRegionHistoryView> = {},
): TerritoryRegionHistoryView {
  return {
    regionKey: 'son_coc',
    currentOwnerSectId: 'sect-1',
    currentOwnerSectName: 'Thanh Vân',
    currentPeriodKey: '2026-W23',
    currentSettledAt: '2026-06-01T00:00:00.000Z',
    snapshots: [
      {
        id: 'snap-1',
        regionKey: 'son_coc',
        periodKey: '2026-W23',
        winnerSectId: 'sect-1',
        winnerSectName: 'Thanh Vân',
        winnerPoints: 64,
        runnerUpSectId: 'sect-2',
        runnerUpSectName: 'Huyền Thuỷ',
        runnerUpPoints: 16,
        totalSects: 2,
        totalPoints: 80,
        settledAt: '2026-06-01T00:00:00.000Z',
        settledBy: 'admin1',
      },
      {
        id: 'snap-2',
        regionKey: 'son_coc',
        periodKey: '2026-W22',
        winnerSectId: 'sect-2',
        winnerSectName: 'Huyền Thuỷ',
        winnerPoints: 32,
        runnerUpSectId: null,
        runnerUpSectName: null,
        runnerUpPoints: 0,
        totalSects: 1,
        totalPoints: 32,
        settledAt: '2026-05-25T00:00:00.000Z',
        settledBy: null,
      },
    ],
    ...over,
  };
}

function makeRunResult(): TerritorySettlementRunResult {
  return {
    periodKey: '2026-W23',
    settledAt: '2026-06-01T00:00:00.000Z',
    snapshots: [
      {
        id: 'snap-1',
        regionKey: 'son_coc',
        periodKey: '2026-W23',
        winnerSectId: 'sect-1',
        winnerSectName: 'Thanh Vân',
        winnerPoints: 64,
        runnerUpSectId: null,
        runnerUpSectName: null,
        runnerUpPoints: 0,
        totalSects: 1,
        totalPoints: 64,
        settledAt: '2026-06-01T00:00:00.000Z',
        settledBy: 'admin1',
      },
    ],
    skippedRegions: ['kim_son_mach'],
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
  getHistoryMock.mockReset();
  adminSettleAllMock.mockReset();
  adminSettleRegionMock.mockReset();
  routerReplaceMock.mockReset();
  routerReplaceMock.mockResolvedValue(undefined);
  authState.isAuthenticated = true;
  authState.user = { role: 'PLAYER' };
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

describe('TerritoryView — Phase 14.0.B owner display', () => {
  it('region không có owner → KHÔNG render badge "Đang chiếm giữ"', async () => {
    getRegionsMock.mockResolvedValue(makeRegions());
    getMeMock.mockResolvedValue(makeMe());
    const w = mountView();
    await flushPromises();

    expect(
      w.find('[data-test="territory-region-owner-badge"]').exists(),
    ).toBe(false);
    const ownerBlocks = w.findAll('[data-test="territory-region-owner"]');
    // 2 region đều render block — nội dung "Chưa có chủ".
    expect(ownerBlocks.length).toBe(2);
    expect(ownerBlocks[0].text()).toContain('Chưa có chủ');
    expect(ownerBlocks[1].text()).toContain('Chưa có chủ');
  });

  it('region có owner → render badge + "Chủ: <name>" + period', async () => {
    getRegionsMock.mockResolvedValue(
      makeRegions({
        ownerSon: {
          ownerSectId: 'sect-1',
          ownerSectName: 'Thanh Vân',
          ownerPeriodKey: '2026-W23',
          ownerSettledAt: '2026-06-01T00:00:00.000Z',
        },
      }),
    );
    getMeMock.mockResolvedValue(makeMe());
    const w = mountView();
    await flushPromises();

    const badges = w.findAll('[data-test="territory-region-owner-badge"]');
    expect(badges.length).toBe(1);
    expect(badges[0].text()).toContain('Đang chiếm giữ');
    expect(badges[0].attributes('data-owner-sect-id')).toBe('sect-1');

    const ownerRow = w
      .findAll('[data-test="territory-region-row"]')
      .find((r) => r.attributes('data-region-key') === 'son_coc')!;
    expect(ownerRow.text()).toContain('Chủ: Thanh Vân');
    expect(ownerRow.text()).toContain('Kết toán: 2026-W23');
  });
});

describe('TerritoryView — Phase 14.0.B history panel', () => {
  it('vào leaderboard tab → fetch history + render snapshots DESC', async () => {
    getRegionsMock.mockResolvedValue(
      makeRegions({
        ownerSon: {
          ownerSectId: 'sect-1',
          ownerSectName: 'Thanh Vân',
          ownerPeriodKey: '2026-W23',
          ownerSettledAt: '2026-06-01T00:00:00.000Z',
        },
      }),
    );
    getMeMock.mockResolvedValue(makeMe());
    getLeaderboardMock.mockResolvedValue(makeLeaderboard('son_coc'));
    getHistoryMock.mockResolvedValue(makeHistory());
    const w = mountView();
    await flushPromises();

    await w.find('[data-test="territory-tab-leaderboard"]').trigger('click');
    await flushPromises();

    expect(getHistoryMock).toHaveBeenCalledWith('son_coc');
    const panel = w.find('[data-test="territory-history-panel"]');
    expect(panel.exists()).toBe(true);
    const rows = panel.findAll('[data-test="territory-history-row"]');
    expect(rows.length).toBe(2);
    expect(rows[0].attributes('data-period-key')).toBe('2026-W23');
    expect(rows[0].text()).toContain('Thanh Vân');
    expect(rows[0].text()).toContain('Huyền Thuỷ');
    expect(rows[1].attributes('data-period-key')).toBe('2026-W22');

    const current = w.find('[data-test="territory-history-current"]');
    expect(current.text()).toContain('Thanh Vân');
    expect(current.text()).toContain('2026-W23');
  });

  it('region chưa từng settle → empty state', async () => {
    getRegionsMock.mockResolvedValue(makeRegions());
    getMeMock.mockResolvedValue(makeMe());
    getLeaderboardMock.mockResolvedValue(makeLeaderboard('son_coc'));
    getHistoryMock.mockResolvedValue(
      makeHistory({
        currentOwnerSectId: null,
        currentOwnerSectName: null,
        currentPeriodKey: null,
        currentSettledAt: null,
        snapshots: [],
      }),
    );
    const w = mountView();
    await flushPromises();
    await w.find('[data-test="territory-tab-leaderboard"]').trigger('click');
    await flushPromises();

    expect(w.find('[data-test="territory-history-empty"]').exists()).toBe(
      true,
    );
    expect(w.find('[data-test="territory-history-current"]').text()).toContain(
      'Chưa có chủ',
    );
  });
});

describe('TerritoryView — Phase 14.0.B admin panel', () => {
  it('user PLAYER → KHÔNG render admin panel', async () => {
    authState.user = { role: 'PLAYER' };
    getRegionsMock.mockResolvedValue(makeRegions());
    getMeMock.mockResolvedValue(makeMe());
    getLeaderboardMock.mockResolvedValue(makeLeaderboard('son_coc'));
    getHistoryMock.mockResolvedValue(makeHistory());
    const w = mountView();
    await flushPromises();
    await w.find('[data-test="territory-tab-leaderboard"]').trigger('click');
    await flushPromises();

    expect(w.find('[data-test="territory-admin-panel"]').exists()).toBe(false);
  });

  it('user ADMIN → render admin panel + click Settle all triggers API', async () => {
    authState.user = { role: 'ADMIN' };
    getRegionsMock.mockResolvedValue(makeRegions());
    getMeMock.mockResolvedValue(makeMe());
    getLeaderboardMock.mockResolvedValue(makeLeaderboard('son_coc'));
    getHistoryMock.mockResolvedValue(makeHistory());
    adminSettleAllMock.mockResolvedValue(makeRunResult());
    const w = mountView();
    await flushPromises();
    await w.find('[data-test="territory-tab-leaderboard"]').trigger('click');
    await flushPromises();

    expect(w.find('[data-test="territory-admin-panel"]').exists()).toBe(true);

    const input = w.find<HTMLInputElement>(
      '[data-test="territory-admin-period-input"]',
    );
    await input.setValue('2026-W23');
    await w.find('[data-test="territory-admin-settle-all"]').trigger('click');
    await flushPromises();

    expect(adminSettleAllMock).toHaveBeenCalledWith('2026-W23');
    expect(w.find('[data-test="territory-admin-result"]').text()).toContain(
      '2026-W23',
    );
  });

  it('user ADMIN + click Settle region → API region call + history refresh', async () => {
    authState.user = { role: 'ADMIN' };
    getRegionsMock.mockResolvedValue(makeRegions());
    getMeMock.mockResolvedValue(makeMe());
    getLeaderboardMock.mockResolvedValue(makeLeaderboard('son_coc'));
    getHistoryMock.mockResolvedValue(makeHistory());
    adminSettleRegionMock.mockResolvedValue({
      regionKey: 'son_coc',
      periodKey: '2026-W23',
      skipped: false,
      snapshot: makeHistory().snapshots[0],
    });
    const w = mountView();
    await flushPromises();
    await w.find('[data-test="territory-tab-leaderboard"]').trigger('click');
    await flushPromises();

    getHistoryMock.mockClear();
    await w
      .find<HTMLInputElement>('[data-test="territory-admin-period-input"]')
      .setValue('2026-W23');
    await w
      .find('[data-test="territory-admin-settle-region"]')
      .trigger('click');
    await flushPromises();

    expect(adminSettleRegionMock).toHaveBeenCalledWith(
      'son_coc',
      '2026-W23',
    );
    // Force refetch history sau khi settle.
    expect(getHistoryMock).toHaveBeenCalledWith('son_coc');
  });

  it('admin settle thất bại với ADMIN_ONLY → render error', async () => {
    authState.user = { role: 'ADMIN' };
    getRegionsMock.mockResolvedValue(makeRegions());
    getMeMock.mockResolvedValue(makeMe());
    getLeaderboardMock.mockResolvedValue(makeLeaderboard('son_coc'));
    getHistoryMock.mockResolvedValue(makeHistory());
    adminSettleAllMock.mockRejectedValue(
      Object.assign(new Error('forbidden'), { code: 'ADMIN_ONLY' }),
    );
    const w = mountView();
    await flushPromises();
    await w.find('[data-test="territory-tab-leaderboard"]').trigger('click');
    await flushPromises();

    await w.find('[data-test="territory-admin-settle-all"]').trigger('click');
    await flushPromises();

    const err = w.find('[data-test="territory-admin-error"]');
    expect(err.exists()).toBe(true);
    expect(err.text()).toContain('Lỗi không rõ');
  });
});
