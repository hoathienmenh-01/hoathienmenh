import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { createI18n } from 'vue-i18n';
import { setActivePinia, createPinia } from 'pinia';
import type { SectWarCurrent, SectWarMyStatus } from '@/api/sectWar';

/**
 * Phase 13.1.A — SectWarView smoke + flow tests.
 *
 * Cover:
 *  - Auth gate (unauth → redirect /auth, no API calls).
 *  - Loading + render content (leaderboard rows, activity rules, reward tiers,
 *    my progress).
 *  - No-sect state (myProgress shows fallback, claim disabled).
 *  - Claim flow success → toast + refresh.
 *  - Claim flow error mapping (SECT_WAR_NOT_CLAIMABLE → mapped i18n string).
 *  - Eligible row highlight + button enabled gate.
 */

const getCurrentMock = vi.fn();
const claimMock = vi.fn();

vi.mock('@/api/sectWar', async () => {
  const actual = await vi.importActual<typeof import('@/api/sectWar')>('@/api/sectWar');
  return {
    ...actual,
    getSectWarCurrent: (...a: unknown[]) => getCurrentMock(...a),
    claimSectWarReward: (...a: unknown[]) => claimMock(...a),
  };
});

// router.replace phải trả Promise vì SectWarView gọi .catch() trên kết quả.
const routerReplaceMock = vi.fn().mockResolvedValue(undefined);
// Phase 13.1.B SectWarView dùng useRoute() để đọc `query.tab` → quyết định
// tab khởi tạo. Mỗi test có thể set `routeQuery.tab` trước khi mount để
// chọn tab (overview/leaderboard/missions/shop/rewards).
const routeQuery: { tab?: string } = {};
vi.mock('vue-router', () => ({
  useRouter: () => ({ replace: routerReplaceMock }),
  useRoute: () => ({
    query: routeQuery,
    params: {},
    path: '/sect-war',
    name: 'SectWar',
    fullPath: '/sect-war',
    hash: '',
    matched: [],
    redirectedFrom: undefined,
    meta: {},
  }),
}));

const toastPushMock = vi.fn();
vi.mock('@/stores/toast', () => ({
  useToastStore: () => ({ push: toastPushMock }),
}));

const authState = {
  isAuthenticated: true,
  hydrate: vi.fn().mockResolvedValue(undefined),
};
vi.mock('@/stores/auth', () => ({
  useAuthStore: () => authState,
}));

vi.mock('@/stores/game', () => ({
  useGameStore: () => ({
    fetchState: vi.fn().mockResolvedValue(undefined),
    bindSocket: vi.fn(),
  }),
}));

vi.mock('@/components/shell/AppShell.vue', () => ({
  default: { name: 'AppShell', template: '<div><slot /></div>' },
}));

import SectWarView from '@/views/SectWarView.vue';

const i18n = createI18n({
  legacy: false,
  locale: 'vi',
  fallbackLocale: 'vi',
  missingWarn: false,
  fallbackWarn: false,
  messages: {
    vi: {
      sectWar: {
        title: 'Tông Môn Chiến',
        subtitle: 'Tuần lễ tranh đoạt',
        loading: 'Đang tải…',
        weekKey: 'Tuần {wk}',
        season: {
          label: 'Tuần hiện tại: {wk}',
          remaining: 'Còn lại {d}d {h}h {m}m',
          ended: 'Đã kết thúc',
          range: 'Từ {start} đến {end}',
        },
        myProgress: {
          title: 'Tiến độ cá nhân',
          noSect: 'Đạo hữu chưa gia nhập Tông',
          sect: 'Tông',
          sectRank: 'Hạng',
          sectPoints: 'Điểm Tông',
          personalPoints: 'Điểm cá nhân',
          breakdown: 'Chi tiết',
          noContrib: 'Chưa có đóng góp',
        },
        leaderboard: {
          title: 'Bảng xếp hạng',
          empty: 'Chưa có Tông nào',
          youTag: '(Tông của tôi)',
          col: { rank: 'Hạng', sect: 'Tông', points: 'Điểm', contributors: 'TV' },
        },
        rules: {
          title: 'Cách kiếm điểm',
          col: { activity: 'Hoạt động', points: 'Điểm', dailyCap: 'Trần ngày', weeklyCap: 'Trần tuần' },
        },
        activity: {
          daily_login: { label: 'Điểm danh', desc: 'Điểm danh hằng ngày' },
          dungeon_clear: { label: 'Bí cảnh', desc: 'Bí cảnh' },
          boss_participation: { label: 'Boss tham chiến', desc: 'Boss' },
          boss_top_damage: { label: 'Top boss', desc: 'Top boss' },
          quest_complete: { label: 'Nhiệm vụ', desc: 'Quest' },
        },
        reward: {
          title: 'Thưởng tuần',
          col: { tier: 'Hạng', rankRange: 'Phạm vi', reward: 'Phần thưởng' },
          linhThach: '{n} Linh Thạch',
          tienNgoc: '{n} Tiên Ngọc',
          titleAward: 'Danh hiệu: {k}',
          buff: 'Buff: {k}',
          items: '{n} vật phẩm',
          claimBtn: 'Nhận thưởng',
          alreadyClaimed: 'Đã nhận tuần này',
          requireSect: 'Cần gia nhập Tông',
          notEligible: 'Không đủ điều kiện',
          eligibleHint: 'Đủ điều kiện: {tier}',
          claimToast: 'Hạng #{rank} — {linhThach} LT + {tienNgoc} TN',
        },
        tier: {
          rank_1: { label: 'Quán quân', desc: 'Hạng 1' },
          rank_2_3: { label: 'Á quân', desc: 'Hạng 2-3' },
          rank_4_10: { label: 'Top 10', desc: 'Hạng 4-10' },
          participation: { label: 'Tham gia', desc: 'Tham gia' },
          rankSingle: 'Hạng {rank}',
          rankRange: 'Hạng {from}–{to}',
          rankFromOnly: 'Hạng {from} trở xuống',
        },
        errors: {
          SECT_REQUIRED: 'Cần gia nhập Tông',
          SECT_WAR_NOT_CLAIMABLE: 'Chưa thể nhận thưởng',
          SECT_WAR_ALREADY_CLAIMED: 'Đã nhận rồi',
          SECT_WAR_NO_REWARD: 'Tông không đủ điều kiện',
          NO_CHARACTER: 'Chưa có nhân vật',
          UNKNOWN: 'Lỗi không rõ',
        },
      },
    },
  },
});

function makeMe(over: Partial<SectWarMyStatus> = {}): SectWarMyStatus {
  return {
    weekKey: '2026-W18',
    hasSect: true,
    sectId: 'sect-1',
    sectName: 'Thanh Vân',
    personalPoints: 120,
    breakdown: [
      { activityKey: 'dungeon_clear', points: 80, count: 4 },
      { activityKey: 'boss_participation', points: 40, count: 2 },
    ],
    sectRank: 2,
    sectPoints: 320,
    eligibleTierKey: 'rank_2_3',
    alreadyClaimed: false,
    canClaim: true,
    ...over,
  };
}

function makeCurrent(over: Partial<SectWarCurrent> = {}): SectWarCurrent {
  return {
    weekKey: '2026-W18',
    season: {
      weekKey: '2026-W18',
      startsAtIso: '2026-04-27T00:00:00.000Z',
      endsAtIso: '2026-05-04T00:00:00.000Z',
      timezone: 'Asia/Ho_Chi_Minh',
    },
    activities: [
      {
        key: 'daily_login',
        points: 10,
        dailyCap: 1,
        weeklyCap: 7,
        sourceType: 'DailyLoginClaim',
        labelI18nKey: 'sectWar.activity.daily_login.label',
        descriptionI18nKey: 'sectWar.activity.daily_login.desc',
      },
      {
        key: 'dungeon_clear',
        points: 20,
        weeklyCap: 200,
        sourceType: 'DungeonRun',
        labelI18nKey: 'sectWar.activity.dungeon_clear.label',
        descriptionI18nKey: 'sectWar.activity.dungeon_clear.desc',
      },
    ],
    rewardTiers: [
      {
        key: 'rank_1',
        minRank: 1,
        maxRank: 1,
        labelI18nKey: 'sectWar.tier.rank_1.label',
        descriptionI18nKey: 'sectWar.tier.rank_1.desc',
        reward: { linhThach: 5000, tienNgoc: 200, titleKey: 'sect_war_champion' },
      },
      {
        key: 'rank_2_3',
        minRank: 2,
        maxRank: 3,
        labelI18nKey: 'sectWar.tier.rank_2_3.label',
        descriptionI18nKey: 'sectWar.tier.rank_2_3.desc',
        reward: { linhThach: 2500, tienNgoc: 100 },
      },
      {
        key: 'participation',
        minRank: 11,
        maxRank: null,
        labelI18nKey: 'sectWar.tier.participation.label',
        descriptionI18nKey: 'sectWar.tier.participation.desc',
        reward: { linhThach: 200 },
      },
    ],
    leaderboard: [
      { rank: 1, sectId: 'sect-2', sectName: 'Huyền Thủy', points: 500, contributors: 5 },
      { rank: 2, sectId: 'sect-1', sectName: 'Thanh Vân', points: 320, contributors: 3 },
    ],
    me: makeMe(),
    ...over,
  };
}

function mountView() {
  return mount(SectWarView, { global: { plugins: [i18n] } });
}

beforeEach(() => {
  setActivePinia(createPinia());
  getCurrentMock.mockReset();
  claimMock.mockReset();
  routerReplaceMock.mockReset();
  // Restore Promise resolution behaviour sau mockReset (SectWarView gọi .catch).
  routerReplaceMock.mockResolvedValue(undefined);
  toastPushMock.mockReset();
  authState.isAuthenticated = true;
  authState.hydrate.mockReset();
  authState.hydrate.mockResolvedValue(undefined);
  // Reset tab về overview default cho mỗi test (Phase 13.1.B tab system).
  delete routeQuery.tab;
});

describe('SectWarView — auth gate', () => {
  it('unauth → replace /auth, KHÔNG gọi getCurrent', async () => {
    authState.isAuthenticated = false;
    mountView();
    await flushPromises();
    expect(routerReplaceMock).toHaveBeenCalledWith('/auth');
    expect(getCurrentMock).not.toHaveBeenCalled();
  });
});

describe('SectWarView — render flow', () => {
  it('auth + load thành công → render overview/leaderboard/rewards tabs (Phase 13.1.B tab system)', async () => {
    getCurrentMock.mockResolvedValue(makeCurrent());
    const w = mountView();
    await flushPromises();

    expect(w.find('[data-test="sect-war-content"]').exists()).toBe(true);
    expect(w.find('[data-test="sect-war-loading"]').exists()).toBe(false);

    // Default tab=overview: my-progress + activity rules visible.
    const me = w.find('[data-test="sect-war-my-progress"]');
    expect(me.exists()).toBe(true);
    expect(me.text()).toContain('Thanh Vân');
    expect(me.text()).toContain('120');
    expect(me.text()).toContain('Bí cảnh');

    const acts = w.findAll('[data-test="sect-war-activity-row"]');
    expect(acts.length).toBe(2);
    expect(acts[0].text()).toContain('Điểm danh');
    expect(acts[0].text()).toContain('+10');

    // Switch to leaderboard tab.
    await w.find('[data-test="sect-war-tab-leaderboard"]').trigger('click');
    await flushPromises();
    const lbRows = w.findAll('[data-test="sect-war-leaderboard-row"]');
    expect(lbRows.length).toBe(2);
    expect(lbRows[0].text()).toContain('Huyền Thủy');
    expect(lbRows[1].text()).toContain('Thanh Vân');
    expect(lbRows[1].text()).toContain('(Tông của tôi)');

    // Switch to rewards tab.
    await w.find('[data-test="sect-war-tab-rewards"]').trigger('click');
    await flushPromises();
    const rewardRows = w.findAll('[data-test="sect-war-reward-row"]');
    expect(rewardRows.length).toBe(3);
    expect(rewardRows[0].text()).toContain('5000');
    expect(rewardRows[2].text()).toContain('Hạng 11 trở xuống');
  });

  it('character không có sect → render fallback "noSect", claim disabled', async () => {
    getCurrentMock.mockResolvedValue(
      makeCurrent({
        me: makeMe({
          hasSect: false,
          sectId: null,
          sectName: null,
          personalPoints: 0,
          breakdown: [],
          sectRank: null,
          sectPoints: null,
          eligibleTierKey: null,
          alreadyClaimed: false,
          canClaim: false,
        }),
      }),
    );
    const w = mountView();
    await flushPromises();

    // Overview tab: no-sect fallback hiển thị trên my-progress.
    const myProg = w.find('[data-test="sect-war-my-progress"]');
    expect(myProg.find('[data-test="sect-war-no-sect"]').exists()).toBe(true);

    // Switch to rewards tab để check claim button disabled.
    await w.find('[data-test="sect-war-tab-rewards"]').trigger('click');
    await flushPromises();
    const claimBtn = w.find('[data-test="sect-war-claim-button"]');
    expect(claimBtn.exists()).toBe(true);
    expect(claimBtn.attributes('disabled')).toBeDefined();
  });

  it('alreadyClaimed → claim button disabled + render alreadyClaimed hint', async () => {
    routeQuery.tab = 'rewards';
    getCurrentMock.mockResolvedValue(
      makeCurrent({
        me: makeMe({ alreadyClaimed: true, canClaim: false }),
      }),
    );
    const w = mountView();
    await flushPromises();
    const claimBtn = w.find('[data-test="sect-war-claim-button"]');
    expect(claimBtn.attributes('disabled')).toBeDefined();
    expect(w.text()).toContain('Đã nhận tuần này');
  });
});

describe('SectWarView — claim flow', () => {
  it('canClaim=true → click claim → claimSectWarReward gọi + toast success + refresh', async () => {
    routeQuery.tab = 'rewards';
    getCurrentMock.mockResolvedValueOnce(makeCurrent());
    claimMock.mockResolvedValue({
      weekKey: '2026-W18',
      rewardTierKey: 'rank_2_3',
      granted: { linhThach: 2500, tienNgoc: 100 },
      sectRank: 2,
      personalPoints: 120,
    });
    getCurrentMock.mockResolvedValueOnce(
      makeCurrent({ me: makeMe({ alreadyClaimed: true, canClaim: false }) }),
    );

    const w = mountView();
    await flushPromises();
    const claimBtn = w.find('[data-test="sect-war-claim-button"]');
    expect(claimBtn.attributes('disabled')).toBeUndefined();
    await claimBtn.trigger('click');
    await flushPromises();

    expect(claimMock).toHaveBeenCalledTimes(1);
    expect(toastPushMock).toHaveBeenCalledWith({
      type: 'success',
      text: 'Hạng #2 — 2500 LT + 100 TN',
    });
    // Re-fetch state after success.
    expect(getCurrentMock).toHaveBeenCalledTimes(2);
  });

  it('claim error SECT_WAR_NOT_CLAIMABLE → toast mapped', async () => {
    routeQuery.tab = 'rewards';
    getCurrentMock.mockResolvedValue(makeCurrent());
    claimMock.mockRejectedValue(
      Object.assign(new Error('not yet'), { code: 'SECT_WAR_NOT_CLAIMABLE' }),
    );
    const w = mountView();
    await flushPromises();
    const claimBtn = w.find('[data-test="sect-war-claim-button"]');
    await claimBtn.trigger('click');
    await flushPromises();

    expect(toastPushMock).toHaveBeenCalledWith({
      type: 'error',
      text: 'Chưa thể nhận thưởng',
    });
  });

  it('claim error UNKNOWN code → fallback i18n UNKNOWN', async () => {
    routeQuery.tab = 'rewards';
    getCurrentMock.mockResolvedValue(makeCurrent());
    claimMock.mockRejectedValue(
      Object.assign(new Error('boom'), { code: 'WEIRD_INTERNAL' }),
    );
    const w = mountView();
    await flushPromises();
    const claimBtn = w.find('[data-test="sect-war-claim-button"]');
    await claimBtn.trigger('click');
    await flushPromises();

    expect(toastPushMock).toHaveBeenCalledWith({
      type: 'error',
      text: 'Lỗi không rõ',
    });
  });
});

describe('SectWarView — load error fallback', () => {
  it('getCurrent throws → render error placeholder, KHÔNG crash', async () => {
    getCurrentMock.mockRejectedValue(
      Object.assign(new Error('down'), { code: 'NO_CHARACTER' }),
    );
    const w = mountView();
    await flushPromises();
    expect(w.find('[data-test="sect-war-error"]').exists()).toBe(true);
    expect(w.find('[data-test="sect-war-error"]').text()).toContain('Chưa có nhân vật');
  });
});
