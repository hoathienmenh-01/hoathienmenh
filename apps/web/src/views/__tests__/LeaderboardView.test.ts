import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { createI18n } from 'vue-i18n';
import { setActivePinia, createPinia } from 'pinia';

const fetchPower = vi.fn();
const fetchTopup = vi.fn();
const fetchSect = vi.fn();

vi.mock('@/api/leaderboard', () => ({
  fetchLeaderboardPower: (...a: unknown[]) => fetchPower(...a),
  fetchLeaderboardTopup: (...a: unknown[]) => fetchTopup(...a),
  fetchLeaderboardSect: (...a: unknown[]) => fetchSect(...a),
}));

// Stub AppShell để test view không kéo theo full shell + websocket setup.
vi.mock('@/components/shell/AppShell.vue', () => ({
  default: {
    name: 'AppShellStub',
    template: '<div data-testid="app-shell"><slot /></div>',
  },
}));

import LeaderboardView from '@/views/LeaderboardView.vue';
import type {
  LeaderboardRow,
  LeaderboardTopupRow,
  LeaderboardSectRow,
} from '@/api/leaderboard';

const i18n = createI18n({
  legacy: false,
  locale: 'vi',
  fallbackLocale: 'vi',
  messages: {
    vi: {
      shell: {
        sect: {
          thanh_van: 'Thanh Vân Môn',
          huyen_thuy: 'Huyền Thuỷ Cung',
          tu_la: 'Tu La Tông',
        },
      },
      leaderboard: {
        title: 'Phong Thần Bảng',
        subtitle: {
          power: 'Top 50 đạo hữu — cảnh giới + lực.',
          topup: 'Top 50 nạp Tiên Ngọc.',
          sect: 'Top 50 tông môn — linh thạch khố.',
        },
        tab: {
          power: 'Cảnh Giới',
          topup: 'Tiên Ngọc',
          sect: 'Tông Môn',
        },
        loading: 'Đang truy vấn…',
        error: 'Lỗi.',
        retry: 'Thử lại',
        empty: 'Chưa có đạo hữu nào.',
        col: {
          name: 'Đạo Hiệu',
          realm: 'Cảnh Giới',
          sect: 'Tông Môn',
          power: 'Lực',
          totalTienNgoc: 'Tiên Ngọc',
          sectName: 'Tông Môn',
          leader: 'Tông Chủ',
          level: 'Cấp',
          members: 'Đệ Tử',
          treasury: 'Linh Thạch Khố',
        },
        roleHint: 'Đối sánh lực chiến, tài sản và tông môn giữa các đạo hữu.',
        crossNav: {
          arena: 'Đấu Trường',
          arenaDesc: 'PvP & Xếp hạng',
          achievements: 'Thành Tựu',
          achievementsDesc: 'Cột mốc & Danh hiệu',
          sect: 'Tông Môn',
          sectDesc: 'Quản lý tông phái',
        },
      },
    },
  },
});

function makeRow(overrides: Partial<LeaderboardRow> = {}): LeaderboardRow {
  return {
    rank: 1,
    characterId: 'c1',
    name: 'Đạo Hữu',
    realmKey: 'luyenkhi',
    realmStage: 1,
    power: 100,
    level: 1,
    sectKey: null,
    ...overrides,
  };
}

function makeTopupRow(
  overrides: Partial<LeaderboardTopupRow> = {},
): LeaderboardTopupRow {
  return {
    rank: 1,
    characterId: 'c1',
    name: 'Đại Gia',
    realmKey: 'luyenkhi',
    realmStage: 1,
    totalTienNgoc: 1000,
    sectKey: null,
    ...overrides,
  };
}

function makeSectRow(
  overrides: Partial<LeaderboardSectRow> = {},
): LeaderboardSectRow {
  return {
    rank: 1,
    sectId: 's1',
    sectKey: 'thanh_van',
    name: 'Thanh Vân Môn',
    level: 5,
    treasuryLinhThach: '1000000',
    memberCount: 42,
    leaderName: 'Tông Chủ A',
    ...overrides,
  };
}

function mountView() {
  return mount(LeaderboardView, {
    global: { plugins: [i18n] },
  });
}

describe('LeaderboardView', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    fetchPower.mockReset();
    fetchTopup.mockReset();
    fetchSect.mockReset();
  });

  it('hiển thị skeleton loader khi đang fetch (G13 — L5)', async () => {
    let resolveFetch: (rows: LeaderboardRow[]) => void = () => {};
    fetchPower.mockReturnValue(
      new Promise<LeaderboardRow[]>((r) => {
        resolveFetch = r;
      }),
    );
    const w = mountView();
    await w.vm.$nextTick();
    expect(w.find('[data-testid="leaderboard-skeleton"]').exists()).toBe(true);
    expect(w.find('[data-testid="leaderboard-table"]').exists()).toBe(false);
    resolveFetch([]);
    await flushPromises();
    expect(w.find('[data-testid="leaderboard-skeleton"]').exists()).toBe(false);
  });

  it('empty state khi rows rỗng', async () => {
    fetchPower.mockResolvedValue([]);
    const w = mountView();
    await flushPromises();
    expect(w.text()).toContain('Chưa có đạo hữu nào');
    expect(w.find('[data-testid="leaderboard-table"]').exists()).toBe(false);
  });

  it('error state khi fetch throw, click retry gọi lại fetch', async () => {
    fetchPower
      .mockRejectedValueOnce(
        Object.assign(new Error('UNKNOWN'), { code: 'UNKNOWN' }),
      )
      .mockResolvedValueOnce([]);
    const w = mountView();
    await flushPromises();
    expect(w.text()).toContain('Lỗi.');
    expect(fetchPower).toHaveBeenCalledTimes(1);
    await w
      .findAll('button')
      .find((b) => b.text() === 'Thử lại')!
      .trigger('click');
    await flushPromises();
    expect(fetchPower).toHaveBeenCalledTimes(2);
  });

  it('render power table với rows + format realm + sect + power', async () => {
    fetchPower.mockResolvedValue([
      makeRow({
        rank: 1,
        characterId: 'c1',
        name: 'Lý Phi Vũ',
        realmKey: 'kim_dan',
        realmStage: 5,
        power: 12345,
        sectKey: 'thanh_van',
      }),
      makeRow({
        rank: 2,
        characterId: 'c2',
        name: 'Trương Tam',
        realmKey: 'luyenkhi',
        realmStage: 9,
        power: 999,
        sectKey: null,
      }),
    ]);
    const w = mountView();
    await flushPromises();
    const tbl = w.find('[data-testid="leaderboard-table"]');
    expect(tbl.exists()).toBe(true);
    const rows = tbl.findAll('tbody tr');
    expect(rows).toHaveLength(2);
    expect(rows[0].text()).toContain('Lý Phi Vũ');
    expect(rows[0].text()).toContain('Kim Đan');
    expect(rows[0].text()).toContain('Ngũ Trọng');
    expect(rows[0].text()).toContain('Thanh Vân Môn');
    expect(rows[0].text()).toContain('12,345');
    expect(rows[1].text()).toContain('Trương Tam');
    expect(rows[1].text()).toContain('—');
  });

  it('rank ≤ 3 highlight, rank > 3 không highlight', async () => {
    fetchPower.mockResolvedValue([
      makeRow({ rank: 1, characterId: 'c1', name: 'Top1' }),
      makeRow({ rank: 4, characterId: 'c4', name: 'Top4' }),
    ]);
    const w = mountView();
    await flushPromises();
    const rows = w.findAll('tbody tr');
    expect(rows[0].html()).toContain('bg-amber-500/20');
    expect(rows[1].html()).not.toContain('bg-amber-500/20');
  });

  it('mount → fetch power được gọi với limit=50, topup/sect chưa gọi', async () => {
    fetchPower.mockResolvedValue([]);
    mountView();
    await flushPromises();
    expect(fetchPower).toHaveBeenCalledWith(50);
    expect(fetchTopup).not.toHaveBeenCalled();
    expect(fetchSect).not.toHaveBeenCalled();
  });

  it('switch sang tab topup → fetchTopup gọi 1 lần với limit=50, render topup table', async () => {
    fetchPower.mockResolvedValue([]);
    fetchTopup.mockResolvedValue([
      makeTopupRow({
        rank: 1,
        characterId: 'c1',
        name: 'Đại Gia A',
        totalTienNgoc: 50000,
        sectKey: 'tu_la',
      }),
    ]);
    const w = mountView();
    await flushPromises();
    await w.find('[data-testid="leaderboard-tab-topup"]').trigger('click');
    await flushPromises();
    expect(fetchTopup).toHaveBeenCalledWith(50);
    expect(fetchTopup).toHaveBeenCalledTimes(1);
    const topupTbl = w.find('[data-testid="leaderboard-topup-table"]');
    expect(topupTbl.exists()).toBe(true);
    expect(topupTbl.text()).toContain('Đại Gia A');
    expect(topupTbl.text()).toContain('50,000');
    expect(topupTbl.text()).toContain('Tu La Tông');
  });

  it('switch sang tab sect → fetchSect gọi 1 lần, render sect table với BigInt format', async () => {
    fetchPower.mockResolvedValue([]);
    fetchSect.mockResolvedValue([
      makeSectRow({
        rank: 1,
        sectId: 's1',
        sectKey: 'thanh_van',
        name: 'Thanh Vân Môn',
        level: 7,
        treasuryLinhThach: '12345678901',
        memberCount: 99,
        leaderName: 'Tổ Sư',
      }),
      makeSectRow({
        rank: 2,
        sectId: 's2',
        sectKey: null,
        name: 'Tự lập tông môn',
        leaderName: null,
      }),
    ]);
    const w = mountView();
    await flushPromises();
    await w.find('[data-testid="leaderboard-tab-sect"]').trigger('click');
    await flushPromises();
    expect(fetchSect).toHaveBeenCalledWith(50);
    const sectTbl = w.find('[data-testid="leaderboard-sect-table"]');
    expect(sectTbl.exists()).toBe(true);
    expect(sectTbl.text()).toContain('Thanh Vân Môn');
    expect(sectTbl.text()).toContain('Tổ Sư');
    expect(sectTbl.text()).toContain('12,345,678,901');
    expect(sectTbl.text()).toContain('99');
    // sectKey null → fallback name + leader '—'
    const rows = sectTbl.findAll('tbody tr');
    expect(rows[1].text()).toContain('Tự lập tông môn');
    expect(rows[1].text()).toContain('—');
  });

  it('chuyển tab 2 lần liên tiếp → fetch chỉ gọi 1 lần cho tab đó', async () => {
    fetchPower.mockResolvedValue([]);
    fetchTopup.mockResolvedValue([]);
    const w = mountView();
    await flushPromises();
    await w.find('[data-testid="leaderboard-tab-topup"]').trigger('click');
    await flushPromises();
    await w.find('[data-testid="leaderboard-tab-topup"]').trigger('click');
    await flushPromises();
    expect(fetchTopup).toHaveBeenCalledTimes(1);
  });

  it('aria-selected đúng cho tab active', async () => {
    fetchPower.mockResolvedValue([]);
    fetchSect.mockResolvedValue([]);
    const w = mountView();
    await flushPromises();
    expect(
      w.find('[data-testid="leaderboard-tab-power"]').attributes('aria-selected'),
    ).toBe('true');
    await w.find('[data-testid="leaderboard-tab-sect"]').trigger('click');
    await flushPromises();
    expect(
      w.find('[data-testid="leaderboard-tab-power"]').attributes('aria-selected'),
    ).toBe('false');
    expect(
      w.find('[data-testid="leaderboard-tab-sect"]').attributes('aria-selected'),
    ).toBe('true');
  });
});

describe('LeaderboardView — cross-navigation', () => {
  it('render role hint', async () => {
    fetchPower.mockResolvedValue([]);
    const w = mountView();
    await flushPromises();
    expect(w.find('[data-testid="leaderboard-role-hint"]').exists()).toBe(true);
    expect(w.find('[data-testid="leaderboard-role-hint"]').text()).toContain('Đối sánh');
  });

  it('render cross-navigation links', async () => {
    fetchPower.mockResolvedValue([]);
    const w = mountView();
    await flushPromises();
    expect(w.find('[data-testid="leaderboard-cross-nav"]').exists()).toBe(true);
    expect(w.find('[data-testid="cross-nav-arena"]').exists()).toBe(true);
    expect(w.find('[data-testid="cross-nav-achievements"]').exists()).toBe(true);
    expect(w.find('[data-testid="cross-nav-sect"]').exists()).toBe(true);
  });
});
