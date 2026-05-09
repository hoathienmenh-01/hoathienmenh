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
  TerritoryWarStateView,
  TerritoryWarHistoryView,
  TerritoryWarSettleCurrentResult,
  TerritoryRewardGrantSummary,
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
const adminDecayMock = vi.fn();
const getWarCurrentMock = vi.fn();
const getWarHistoryMock = vi.fn();
const adminWarSettleCurrentMock = vi.fn();
const adminGrantWeeklyRewardsMock = vi.fn();

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
    adminTerritoryDecay: (...a: unknown[]) => adminDecayMock(...a),
    getTerritoryWarCurrent: (...a: unknown[]) => getWarCurrentMock(...a),
    getTerritoryWarHistory: (...a: unknown[]) => getWarHistoryMock(...a),
    adminTerritoryWarSettleCurrent: (...a: unknown[]) =>
      adminWarSettleCurrentMock(...a),
    adminTerritoryGrantWeeklyRewards: (...a: unknown[]) =>
      adminGrantWeeklyRewardsMock(...a),
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
          war: 'Tranh Đoạt',
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
          currentPeriod: 'Kỳ: {period}',
          buffSectionTitle: 'Buff vùng',
          buffNone: 'Vùng này không có buff',
          buffActiveBadge: 'ĐANG ÁP DỤNG',
          buffInactiveBadge: 'CHỜ CHỦ',
          buffOwnerHint: 'Buff chỉ áp dụng cho thành viên Tông Môn chủ vùng.',
        },
        buff: {
          appliesTo: {
            DUNGEON_REWARD: 'Bí Cảnh',
            COMBAT: 'Chiến đấu',
            ELEMENTAL: 'Ngũ hành',
          },
          type: {
            EXP_BONUS: '+{value}% EXP',
            LINH_THACH_BONUS: '+{value}% Linh Thạch',
            ELEMENTAL_DAMAGE: '+{value}% sát thương ngũ hành',
            DEFENSE_BONUS: '+{value}% phòng ngự',
          },
          territory_son_coc_exp: {
            label: 'Linh Khí Sơn Cốc',
            desc: '+5% EXP Bí Cảnh trong Sơn Cốc.',
          },
          territory_kim_son_mach_dmg: {
            label: 'Kim Sơn Mạch Lực',
            desc: '+5% sát thương Kim trong Kim Sơn Mạch.',
          },
        },
        myBuffs: {
          title: 'Buff đang nhận',
          empty: 'Tông Môn chưa sở hữu vùng nào',
          noSect: 'Chưa có Tông Môn',
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
          DECAY_BPS_INVALID: 'Tỷ lệ suy giảm không hợp lệ',
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
          decayTitle: 'Decay',
          decaySubtitle: 'Reduce stale influence',
          decayBpsLabel: 'Decay bps',
          decayRun: 'Run decay',
          decayRunning: 'Running decay…',
          decayLastResult: 'Decay {period}: -{delta} pts · {rows} rows · {bpsPercent}%.',
          decaySkipped: 'Decay {period} skipped.',
        },
        war: {
          title: 'Tranh Đoạt Tuần',
          subtitle: 'Sub',
          countdownLabel: 'Còn lại',
          currentPeriod: 'Tuần: {period}',
          previousPeriod: 'Tuần trước: {period}',
          windowFmt: '{from} → {to}',
          regionContestedBadge: 'Tranh chấp',
          regionOwner: 'Chủ: {name}',
          regionLeadMargin: 'Hơn kém: {pts}',
          regionNoContenders: 'Chưa có',
          standingsTitle: 'Top 3',
          standingsRow: '#{rank} {sect} — {pts} điểm',
          leaderTag: 'DẪN ĐẦU',
          contributorsHint: '{n} TV',
          historyTitle: 'Lịch sử tuần',
          historyEmpty: 'Chưa có',
          historyRow: '{period} · {settled} · {wins}',
          adminTitle: 'Admin Settle Current Week',
          adminSubtitle: 'Sub',
          adminSettleButton: 'Chốt Tuần',
          adminSettleRunning: 'Đang chốt…',
          adminLastResult: 'Đã chốt {period}: {wins} thắng · {skip} bỏ qua.',
        },
        reward: {
          adminTitle: 'Admin Reward',
          adminSubtitle: 'Sub',
          adminGrantButton: 'Gửi Thưởng Lãnh Địa Tuần',
          adminGrantRunning: 'Đang gửi…',
          adminLastResult:
            'Đã xử lý {period}: {regions} vùng · gửi {mails} thư · bỏ qua {skipAlready} đã gửi · {skipNoWinner} không có chủ · {skipNoMembers} tông môn rỗng.',
        },
        errors2: {},
      },
      territory_extra_errors: {
        PERIOD_INVALID: 'Period key không hợp lệ',
      },
    },
  },
});

// Patch i18n vi messages: nhúng PERIOD_INVALID vào territory.errors (test
// helper inline tránh sửa cấu trúc cũ — chỉ thêm key cần cho Phase 14.0.E).
(i18n.global.messages.value as unknown as { vi: { territory: { errors: Record<string, string> } } })
  .vi.territory.errors.PERIOD_INVALID =
  'Period key không hợp lệ (yêu cầu ISO week YYYY-Www hoặc manual_*).';

function makeRegions(over: {
  ownerSon?: Pick<
    TerritoryRegionView,
    'ownerSectId' | 'ownerSectName' | 'ownerPeriodKey' | 'ownerSettledAt'
  >;
} = {}): TerritoryRegionsView {
  const sonCocBuffs = [
    {
      buffKey: 'territory_son_coc_exp',
      buffType: 'EXP_BONUS',
      value: 0.05,
      cap: 0.05,
      labelI18nKey: 'territory.buff.territory_son_coc_exp.label',
      descriptionI18nKey: 'territory.buff.territory_son_coc_exp.desc',
      appliesTo: ['DUNGEON_REWARD'],
      element: null,
    },
  ];
  const kimSonMachBuffs = [
    {
      buffKey: 'territory_kim_son_mach_dmg',
      buffType: 'ELEMENTAL_DAMAGE',
      value: 0.05,
      cap: 0.05,
      labelI18nKey: 'territory.buff.territory_kim_son_mach_dmg.label',
      descriptionI18nKey: 'territory.buff.territory_kim_son_mach_dmg.desc',
      appliesTo: ['COMBAT', 'ELEMENTAL'],
      element: 'kim',
    },
  ];
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
        buffs: sonCocBuffs,
        ownerBuffActive: !!over.ownerSon?.ownerSectId,
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
        buffs: kimSonMachBuffs,
        ownerBuffActive: false,
      },
    ],
    currentPeriodKey: '2026-W23',
    previousPeriodKey: '2026-W22',
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
    activeBuffs: [],
    currentPeriodKey: '2026-W23',
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
  adminDecayMock.mockReset();
  getWarCurrentMock.mockReset();
  getWarHistoryMock.mockReset();
  adminWarSettleCurrentMock.mockReset();
  adminGrantWeeklyRewardsMock.mockReset();
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

describe('TerritoryView — Phase 14.0.C buff display', () => {
  it('overview render buff list theo region + active badge khi có owner', async () => {
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

    // Render currentPeriodKey hint.
    expect(w.find('[data-test="territory-overview-period"]').text()).toContain(
      '2026-W23',
    );

    const buffBlocks = w.findAll('[data-test="territory-region-buffs"]');
    expect(buffBlocks.length).toBe(2);

    // Region son_coc: có owner → active badge.
    const sonCocBuffs = buffBlocks.find(
      (b) => b.attributes('data-region-key') === 'son_coc',
    )!;
    const sonCocRows = sonCocBuffs.findAll(
      '[data-test="territory-region-buff-row"]',
    );
    expect(sonCocRows.length).toBe(1);
    expect(sonCocRows[0].attributes('data-buff-key')).toBe(
      'territory_son_coc_exp',
    );
    expect(sonCocRows[0].text()).toContain('Linh Khí Sơn Cốc');
    expect(sonCocRows[0].text()).toContain('+5% EXP');
    expect(sonCocRows[0].text()).toContain('Bí Cảnh');
    expect(
      sonCocRows[0].find('[data-test="territory-region-buff-active"]').exists(),
    ).toBe(true);
    expect(
      sonCocRows[0]
        .find('[data-test="territory-region-buff-inactive"]')
        .exists(),
    ).toBe(false);

    // Region kim_son_mach: chưa có owner → inactive badge.
    const kimBuffs = buffBlocks.find(
      (b) => b.attributes('data-region-key') === 'kim_son_mach',
    )!;
    const kimRows = kimBuffs.findAll(
      '[data-test="territory-region-buff-row"]',
    );
    expect(kimRows.length).toBe(1);
    expect(kimRows[0].text()).toContain('Kim Sơn Mạch Lực');
    expect(
      kimRows[0].find('[data-test="territory-region-buff-active"]').exists(),
    ).toBe(false);
    expect(
      kimRows[0]
        .find('[data-test="territory-region-buff-inactive"]')
        .exists(),
    ).toBe(true);
  });

  it('region không có buff → render empty placeholder', async () => {
    const regions = makeRegions();
    // Override son_coc buffs = []
    const mut = JSON.parse(JSON.stringify(regions));
    mut.regions[0].buffs = [];
    getRegionsMock.mockResolvedValue(mut);
    getMeMock.mockResolvedValue(makeMe());
    const w = mountView();
    await flushPromises();

    const sonCocBuffsBlock = w
      .findAll('[data-test="territory-region-buffs"]')
      .find((b) => b.attributes('data-region-key') === 'son_coc')!;
    expect(
      sonCocBuffsBlock
        .find('[data-test="territory-region-buffs-empty"]')
        .exists(),
    ).toBe(true);
  });

  it('me tab + sect đang sở hữu region → render activeBuffs list', async () => {
    routeQuery.tab = 'me';
    getRegionsMock.mockResolvedValue(makeRegions());
    getMeMock.mockResolvedValue(
      makeMe({
        activeBuffs: [
          {
            buffKey: 'territory_son_coc_exp',
            buffType: 'EXP_BONUS',
            value: 0.05,
            cap: 0.05,
            labelI18nKey: 'territory.buff.territory_son_coc_exp.label',
            descriptionI18nKey:
              'territory.buff.territory_son_coc_exp.desc',
            appliesTo: ['DUNGEON_REWARD'],
            element: null,
          },
        ],
      }),
    );
    const w = mountView();
    await flushPromises();

    expect(
      w.find('[data-test="territory-me-active-buffs"]').exists(),
    ).toBe(true);
    const buffRows = w.findAll(
      '[data-test="territory-me-active-buff-row"]',
    );
    expect(buffRows.length).toBe(1);
    expect(buffRows[0].attributes('data-buff-key')).toBe(
      'territory_son_coc_exp',
    );
    expect(buffRows[0].text()).toContain('Linh Khí Sơn Cốc');
    expect(buffRows[0].text()).toContain('+5% EXP');
  });

  it('me tab + sect không sở hữu region nào → empty placeholder', async () => {
    routeQuery.tab = 'me';
    getRegionsMock.mockResolvedValue(makeRegions());
    getMeMock.mockResolvedValue(makeMe({ activeBuffs: [] }));
    const w = mountView();
    await flushPromises();

    expect(
      w.find('[data-test="territory-me-active-buffs-empty"]').exists(),
    ).toBe(true);
  });
});

describe('TerritoryView — Phase 14.0.C admin decay', () => {
  it('user PLAYER → KHÔNG render decay panel', async () => {
    authState.user = { role: 'PLAYER' };
    getRegionsMock.mockResolvedValue(makeRegions());
    getMeMock.mockResolvedValue(makeMe());
    getLeaderboardMock.mockResolvedValue(makeLeaderboard('son_coc'));
    getHistoryMock.mockResolvedValue(makeHistory());
    const w = mountView();
    await flushPromises();
    await w.find('[data-test="territory-tab-leaderboard"]').trigger('click');
    await flushPromises();

    expect(
      w.find('[data-test="territory-admin-decay-panel"]').exists(),
    ).toBe(false);
  });

  it('ADMIN click decay → API gọi với periodKey + decayBps; render last result', async () => {
    authState.user = { role: 'ADMIN' };
    getRegionsMock.mockResolvedValue(makeRegions());
    getMeMock.mockResolvedValue(makeMe());
    getLeaderboardMock.mockResolvedValue(makeLeaderboard('son_coc'));
    getHistoryMock.mockResolvedValue(makeHistory());
    adminDecayMock.mockResolvedValue({
      periodKey: '2026-W22',
      decayBps: 2500,
      skipped: false,
      rowsAffected: 4,
      pointsBefore: 200,
      pointsAfter: 150,
      delta: 50,
      triggeredAt: '2026-06-01T00:00:00.000Z',
    });
    const w = mountView();
    await flushPromises();
    await w.find('[data-test="territory-tab-leaderboard"]').trigger('click');
    await flushPromises();

    await w
      .find<HTMLInputElement>('[data-test="territory-admin-period-input"]')
      .setValue('2026-W22');
    await w
      .find<HTMLInputElement>(
        '[data-test="territory-admin-decay-bps-input"]',
      )
      .setValue('2500');
    await w.find('[data-test="territory-admin-decay-run"]').trigger('click');
    await flushPromises();

    expect(adminDecayMock).toHaveBeenCalledWith({
      periodKey: '2026-W22',
      decayBps: 2500,
    });
    const result = w.find('[data-test="territory-admin-decay-result"]');
    expect(result.exists()).toBe(true);
    expect(result.text()).toContain('2026-W22');
    expect(result.text()).toContain('-50');
    expect(result.text()).toContain('25');
  });

  it('ADMIN click decay không nhập input → API gọi với undefined opts', async () => {
    authState.user = { role: 'ADMIN' };
    getRegionsMock.mockResolvedValue(makeRegions());
    getMeMock.mockResolvedValue(makeMe());
    getLeaderboardMock.mockResolvedValue(makeLeaderboard('son_coc'));
    getHistoryMock.mockResolvedValue(makeHistory());
    adminDecayMock.mockResolvedValue({
      periodKey: '2026-W22',
      decayBps: 2500,
      skipped: false,
      rowsAffected: 0,
      pointsBefore: 0,
      pointsAfter: 0,
      delta: 0,
      triggeredAt: '2026-06-01T00:00:00.000Z',
    });
    const w = mountView();
    await flushPromises();
    await w.find('[data-test="territory-tab-leaderboard"]').trigger('click');
    await flushPromises();

    await w.find('[data-test="territory-admin-decay-run"]').trigger('click');
    await flushPromises();

    expect(adminDecayMock).toHaveBeenCalledWith({
      periodKey: undefined,
      decayBps: undefined,
    });
  });

  it('ADMIN decay skipped (cùng periodKey) → render skipped state', async () => {
    authState.user = { role: 'ADMIN' };
    getRegionsMock.mockResolvedValue(makeRegions());
    getMeMock.mockResolvedValue(makeMe());
    getLeaderboardMock.mockResolvedValue(makeLeaderboard('son_coc'));
    getHistoryMock.mockResolvedValue(makeHistory());
    adminDecayMock.mockResolvedValue({
      periodKey: '2026-W22',
      decayBps: 2500,
      skipped: true,
      rowsAffected: 0,
      pointsBefore: 0,
      pointsAfter: 0,
      delta: 0,
      triggeredAt: '2026-06-01T00:00:00.000Z',
    });
    const w = mountView();
    await flushPromises();
    await w.find('[data-test="territory-tab-leaderboard"]').trigger('click');
    await flushPromises();

    await w.find('[data-test="territory-admin-decay-run"]').trigger('click');
    await flushPromises();

    expect(
      w.find('[data-test="territory-admin-decay-skipped"]').exists(),
    ).toBe(true);
    expect(
      w.find('[data-test="territory-admin-decay-result"]').exists(),
    ).toBe(false);
  });

  it('ADMIN decay error DECAY_BPS_INVALID → render error', async () => {
    authState.user = { role: 'ADMIN' };
    getRegionsMock.mockResolvedValue(makeRegions());
    getMeMock.mockResolvedValue(makeMe());
    getLeaderboardMock.mockResolvedValue(makeLeaderboard('son_coc'));
    getHistoryMock.mockResolvedValue(makeHistory());
    adminDecayMock.mockRejectedValue(
      Object.assign(new Error('bad bps'), { code: 'DECAY_BPS_INVALID' }),
    );
    const w = mountView();
    await flushPromises();
    await w.find('[data-test="territory-tab-leaderboard"]').trigger('click');
    await flushPromises();

    await w
      .find<HTMLInputElement>(
        '[data-test="territory-admin-decay-bps-input"]',
      )
      .setValue('999999');
    await w.find('[data-test="territory-admin-decay-run"]').trigger('click');
    await flushPromises();

    const err = w.find('[data-test="territory-admin-decay-error"]');
    expect(err.exists()).toBe(true);
    expect(err.text()).toContain('Tỷ lệ suy giảm không hợp lệ');
  });
});

// ────────────────────────────────────────────────────────────────────────────
// Phase 14.0.D — Weekly War Loop tests
// ────────────────────────────────────────────────────────────────────────────

function makeWarState(
  over: Partial<TerritoryWarStateView> = {},
): TerritoryWarStateView {
  // Tạo `endsAt` ở tương lai để countdown > 0.
  const now = new Date('2026-06-01T00:00:00.000Z');
  const endsAt = new Date(now.getTime() + 3 * 86400 * 1000); // +3d
  return {
    periodKey: '2026-W23',
    previousPeriodKey: '2026-W22',
    startsAt: '2026-06-01T00:00:00.000Z',
    endsAt: endsAt.toISOString(),
    nextResetAt: endsAt.toISOString(),
    serverNow: now.toISOString(),
    timeRemainingMs: 3 * 86400 * 1000,
    regions: [
      {
        regionKey: 'son_coc',
        nameVi: 'Sơn Cốc',
        nameEn: 'Son Coc',
        sortOrder: 1,
        totalPoints: 80,
        contestedSectCount: 2,
        leaderSectId: 'sect-1',
        leaderSectName: 'Thanh Vân',
        leaderPoints: 64,
        leadMargin: 48,
        contested: true,
        currentOwnerSectId: 'sect-prev',
        currentOwnerSectName: 'Old Owner',
        currentOwnerPeriodKey: '2026-W22',
        topStandings: [
          {
            rank: 1,
            sectId: 'sect-1',
            sectName: 'Thanh Vân',
            points: 64,
            contributors: 4,
            isLeader: true,
          },
          {
            rank: 2,
            sectId: 'sect-2',
            sectName: 'Huyền Thuỷ',
            points: 16,
            contributors: 2,
            isLeader: false,
          },
        ],
      },
      {
        regionKey: 'kim_son_mach',
        nameVi: 'Kim Sơn Mạch',
        nameEn: 'Kim Son Mach',
        sortOrder: 2,
        totalPoints: 0,
        contestedSectCount: 0,
        leaderSectId: null,
        leaderSectName: null,
        leaderPoints: 0,
        leadMargin: 0,
        contested: false,
        currentOwnerSectId: null,
        currentOwnerSectName: null,
        currentOwnerPeriodKey: null,
        topStandings: [],
      },
    ],
    ...over,
  };
}

function makeWarHistory(
  over: Partial<TerritoryWarHistoryView> = {},
): TerritoryWarHistoryView {
  return {
    entries: [
      {
        periodKey: '2026-W22',
        startsAt: '2026-05-25T00:00:00.000Z',
        endsAt: '2026-06-01T00:00:00.000Z',
        settledAt: '2026-06-01T00:01:00.000Z',
        snapshots: [
          {
            id: 'snap-h1',
            regionKey: 'son_coc',
            periodKey: '2026-W22',
            winnerSectId: 'sect-prev',
            winnerSectName: 'Old Owner',
            winnerPoints: 50,
            runnerUpSectId: null,
            runnerUpSectName: null,
            runnerUpPoints: 0,
            totalSects: 1,
            totalPoints: 50,
            settledAt: '2026-06-01T00:01:00.000Z',
            settledBy: 'admin1',
          },
        ],
      },
    ],
    ...over,
  };
}

function makeWarSettleResult(): TerritoryWarSettleCurrentResult {
  return {
    periodKey: '2026-W23',
    settledAt: '2026-06-01T00:05:00.000Z',
    snapshots: [
      {
        id: 'snap-w23',
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
        settledAt: '2026-06-01T00:05:00.000Z',
        settledBy: 'admin1',
      },
    ],
    skippedRegions: ['kim_son_mach'],
    ownersAfter: [
      {
        regionKey: 'son_coc',
        ownerSectId: 'sect-1',
        ownerSectName: 'Thanh Vân',
        periodKey: '2026-W23',
        settledAt: '2026-06-01T00:05:00.000Z',
      },
      {
        regionKey: 'kim_son_mach',
        ownerSectId: null,
        ownerSectName: null,
        periodKey: null,
        settledAt: null,
      },
    ],
  };
}

describe('TerritoryView — Phase 14.0.D weekly war tab', () => {
  it('tab "war" có button trong tablist + click chuyển content', async () => {
    getRegionsMock.mockResolvedValue(makeRegions());
    getMeMock.mockResolvedValue(makeMe());
    getWarCurrentMock.mockResolvedValue(makeWarState());
    getWarHistoryMock.mockResolvedValue(makeWarHistory());
    const w = mountView();
    await flushPromises();

    const tabBtn = w.find('[data-test="territory-tab-war"]');
    expect(tabBtn.exists()).toBe(true);

    await tabBtn.trigger('click');
    await flushPromises();

    expect(w.find('[data-test="territory-war-content"]').exists()).toBe(true);
    expect(getWarCurrentMock).toHaveBeenCalled();
    expect(getWarHistoryMock).toHaveBeenCalled();
  });

  it('render countdown + period panel + 9 region cards với standings', async () => {
    getRegionsMock.mockResolvedValue(makeRegions());
    getMeMock.mockResolvedValue(makeMe());
    getWarCurrentMock.mockResolvedValue(makeWarState());
    getWarHistoryMock.mockResolvedValue(makeWarHistory());
    const w = mountView();
    await flushPromises();
    await w.find('[data-test="territory-tab-war"]').trigger('click');
    await flushPromises();

    expect(
      w.find('[data-test="territory-war-period-panel"]').exists(),
    ).toBe(true);
    expect(w.find('[data-test="territory-war-countdown"]').text().length).toBeGreaterThan(0);

    const cards = w.findAll('[data-test="territory-war-region-card"]');
    expect(cards.length).toBe(2);
    // Card son_coc: contested badge + owner + standings.
    expect(cards[0].find('[data-test="territory-war-region-contested"]').exists()).toBe(true);
    expect(cards[0].find('[data-test="territory-war-region-owner"]').text()).toContain('Old Owner');
    const standings = cards[0].findAll('[data-test="territory-war-region-standing"]');
    expect(standings.length).toBe(2);
    expect(standings[0].text()).toContain('Thanh Vân');
    expect(standings[0].text()).toContain('DẪN ĐẦU');
    // Card kim_son_mach: empty state.
    expect(cards[1].find('[data-test="territory-war-region-empty"]').exists()).toBe(true);
  });

  it('history panel render khi có entries', async () => {
    getRegionsMock.mockResolvedValue(makeRegions());
    getMeMock.mockResolvedValue(makeMe());
    getWarCurrentMock.mockResolvedValue(makeWarState());
    getWarHistoryMock.mockResolvedValue(makeWarHistory());
    const w = mountView();
    await flushPromises();
    await w.find('[data-test="territory-tab-war"]').trigger('click');
    await flushPromises();

    expect(w.find('[data-test="territory-war-history-panel"]').exists()).toBe(true);
    const rows = w.findAll('[data-test="territory-war-history-row"]');
    expect(rows.length).toBe(1);
    expect(rows[0].text()).toContain('2026-W22');
  });

  it('history panel empty state khi entries rỗng', async () => {
    getRegionsMock.mockResolvedValue(makeRegions());
    getMeMock.mockResolvedValue(makeMe());
    getWarCurrentMock.mockResolvedValue(makeWarState());
    getWarHistoryMock.mockResolvedValue({ entries: [] });
    const w = mountView();
    await flushPromises();
    await w.find('[data-test="territory-tab-war"]').trigger('click');
    await flushPromises();

    expect(w.find('[data-test="territory-war-history-empty"]').exists()).toBe(true);
    expect(w.findAll('[data-test="territory-war-history-row"]').length).toBe(0);
  });

  it('PLAYER role → KHÔNG có admin settle button', async () => {
    authState.user = { role: 'PLAYER' };
    getRegionsMock.mockResolvedValue(makeRegions());
    getMeMock.mockResolvedValue(makeMe());
    getWarCurrentMock.mockResolvedValue(makeWarState());
    getWarHistoryMock.mockResolvedValue(makeWarHistory());
    const w = mountView();
    await flushPromises();
    await w.find('[data-test="territory-tab-war"]').trigger('click');
    await flushPromises();

    expect(w.find('[data-test="territory-war-admin-panel"]').exists()).toBe(false);
    expect(w.find('[data-test="territory-war-admin-settle"]').exists()).toBe(false);
  });

  it('ADMIN role → admin button click triggers service + render result', async () => {
    authState.user = { role: 'ADMIN' };
    getRegionsMock.mockResolvedValue(makeRegions());
    getMeMock.mockResolvedValue(makeMe());
    getWarCurrentMock.mockResolvedValue(makeWarState());
    getWarHistoryMock
      .mockResolvedValueOnce(makeWarHistory())
      .mockResolvedValueOnce(makeWarHistory());
    adminWarSettleCurrentMock.mockResolvedValue(makeWarSettleResult());
    const w = mountView();
    await flushPromises();
    await w.find('[data-test="territory-tab-war"]').trigger('click');
    await flushPromises();

    expect(w.find('[data-test="territory-war-admin-panel"]').exists()).toBe(true);
    const btn = w.find('[data-test="territory-war-admin-settle"]');
    expect(btn.exists()).toBe(true);

    await btn.trigger('click');
    await flushPromises();

    expect(adminWarSettleCurrentMock).toHaveBeenCalled();
    // Sau khi settle → fetchWarHistory được gọi lại lần 2 (refresh).
    expect(getWarHistoryMock).toHaveBeenCalledTimes(2);
    const result = w.find('[data-test="territory-war-admin-result"]');
    expect(result.exists()).toBe(true);
    expect(result.text()).toContain('2026-W23');
  });
});

function makeRewardGrantResult(
  overrides: Partial<TerritoryRewardGrantSummary> = {},
): TerritoryRewardGrantSummary {
  return {
    periodKey: '2026-W19',
    regionsProcessed: 9,
    mailsCreated: 5,
    skippedAlreadyGranted: 1,
    skippedNoWinner: 4,
    skippedNoMembers: 0,
    dryRun: false,
    regions: [],
    ...overrides,
  };
}

describe('TerritoryView — Phase 14.0.E admin reward grant button', () => {
  beforeEach(() => {
    routeQuery.tab = 'war';
    routeQuery.region = undefined;
  });

  it('PLAYER role → button KHÔNG hiển thị', async () => {
    authState.user = { role: 'PLAYER' };
    getRegionsMock.mockResolvedValue(makeRegions());
    getMeMock.mockResolvedValue(makeMe());
    getWarCurrentMock.mockResolvedValue(makeWarState());
    getWarHistoryMock.mockResolvedValue(makeWarHistory());
    const w = mountView();
    await flushPromises();
    await w.find('[data-test="territory-tab-war"]').trigger('click');
    await flushPromises();

    expect(
      w.find('[data-test="territory-reward-admin-panel"]').exists(),
    ).toBe(false);
    expect(
      w.find('[data-test="territory-reward-admin-grant"]').exists(),
    ).toBe(false);
  });

  it('ADMIN role → panel + button hiển thị', async () => {
    authState.user = { role: 'ADMIN' };
    getRegionsMock.mockResolvedValue(makeRegions());
    getMeMock.mockResolvedValue(makeMe());
    getWarCurrentMock.mockResolvedValue(makeWarState());
    getWarHistoryMock.mockResolvedValue(makeWarHistory());
    const w = mountView();
    await flushPromises();
    await w.find('[data-test="territory-tab-war"]').trigger('click');
    await flushPromises();

    expect(
      w.find('[data-test="territory-reward-admin-panel"]').exists(),
    ).toBe(true);
    const btn = w.find('[data-test="territory-reward-admin-grant"]');
    expect(btn.exists()).toBe(true);
    // Result chưa có vì chưa click.
    expect(
      w.find('[data-test="territory-reward-admin-result"]').exists(),
    ).toBe(false);
  });

  it('ADMIN click → service được gọi + render summary', async () => {
    authState.user = { role: 'ADMIN' };
    getRegionsMock.mockResolvedValue(makeRegions());
    getMeMock.mockResolvedValue(makeMe());
    getWarCurrentMock.mockResolvedValue(makeWarState());
    getWarHistoryMock.mockResolvedValue(makeWarHistory());
    adminGrantWeeklyRewardsMock.mockResolvedValue(makeRewardGrantResult());

    const w = mountView();
    await flushPromises();
    await w.find('[data-test="territory-tab-war"]').trigger('click');
    await flushPromises();

    const btn = w.find('[data-test="territory-reward-admin-grant"]');
    await btn.trigger('click');
    await flushPromises();

    expect(adminGrantWeeklyRewardsMock).toHaveBeenCalledTimes(1);
    const result = w.find('[data-test="territory-reward-admin-result"]');
    expect(result.exists()).toBe(true);
    const txt = result.text();
    expect(txt).toContain('2026-W19'); // periodKey
    expect(txt).toContain('9'); // regionsProcessed
    expect(txt).toContain('5'); // mailsCreated
  });

  it('ADMIN service error → render error code', async () => {
    authState.user = { role: 'ADMIN' };
    getRegionsMock.mockResolvedValue(makeRegions());
    getMeMock.mockResolvedValue(makeMe());
    getWarCurrentMock.mockResolvedValue(makeWarState());
    getWarHistoryMock.mockResolvedValue(makeWarHistory());
    adminGrantWeeklyRewardsMock.mockRejectedValue(
      Object.assign(new Error('PERIOD_INVALID'), { code: 'PERIOD_INVALID' }),
    );

    const w = mountView();
    await flushPromises();
    await w.find('[data-test="territory-tab-war"]').trigger('click');
    await flushPromises();

    await w
      .find('[data-test="territory-reward-admin-grant"]')
      .trigger('click');
    await flushPromises();

    const errBox = w.find('[data-test="territory-reward-admin-error"]');
    expect(errBox.exists()).toBe(true);
    // i18n vi key `territory.errors.PERIOD_INVALID` → "Period key không hợp lệ ..."
    expect(errBox.text()).toContain('Period key');
  });
});
