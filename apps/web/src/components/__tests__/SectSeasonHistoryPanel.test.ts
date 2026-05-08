/**
 * Phase 13.2.C — SectSeasonHistoryPanel tests.
 *
 * Cover:
 *   - render history list rows + champion/mvp summary.
 *   - empty state khi history list rỗng.
 *   - render Hall of Fame sect rows + member rows ordered by championships/mvps.
 *   - empty Hall of Fame state.
 *   - viewDetail click → fetch detail, render full leaderboard + top members.
 *   - back button quay lại list view.
 *   - error state KHÔNG crash.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { createI18n } from 'vue-i18n';
import { createPinia, setActivePinia } from 'pinia';

const getHistoryMock = vi.fn();
const getHistoryDetailMock = vi.fn();
const getHallOfFameMock = vi.fn();

vi.mock('@/api/sectSeason', () => ({
  getSectSeasonHistory: (...a: unknown[]) => getHistoryMock(...a),
  getSectSeasonHistoryDetail: (...a: unknown[]) => getHistoryDetailMock(...a),
  getSectSeasonHallOfFame: (...a: unknown[]) => getHallOfFameMock(...a),
}));

import SectSeasonHistoryPanel from '@/components/SectSeasonHistoryPanel.vue';
import type {
  SectHallOfFameView,
  SectSeasonHistoryListView,
  SectSeasonHistoryView,
} from '@/api/sectSeason';

const i18n = createI18n({
  legacy: false,
  locale: 'vi',
  fallbackLocale: 'vi',
  messages: {
    vi: {
      sectSeason: {
        season: {
          fallbackLabel: 'Mùa {k}',
          names: { s1: 'Mùa Khai Nguyên', s2: 'Mùa Linh Triều' },
        },
        leaderboard: {
          col: {
            rank: 'Hạng',
            sect: 'Tông',
            points: 'Điểm',
            contributors: 'Thành viên',
            weeks: 'Tuần',
          },
        },
        history: {
          title: 'Lịch sử mùa giải',
          loading: 'Đang tải lịch sử…',
          empty: 'Chưa có mùa giải nào kết thúc.',
          finalizedAt: 'Chốt lúc {at}',
          totalsLine: '{sects} Tông · {contributors} thành viên · {points} điểm',
          championLabel: 'Tông quán quân',
          noChampion: 'Không có Tông tích điểm',
          mvpLabel: 'Cá nhân xuất sắc',
          noMvp: 'Không có cá nhân tích điểm',
          viewDetail: 'Xem chi tiết',
          back: '← Quay lại danh sách',
          detail: {
            sectsTitle: 'Bảng xếp hạng Tông',
            membersTitle: 'Cá nhân tích cực',
            emptySects: 'Không có Tông tích điểm.',
            emptyMembers: 'Không có cá nhân tích điểm.',
            noSect: '(không Tông)',
          },
          errors: {
            SNAPSHOT_NOT_FOUND: 'Mùa giải này chưa được chốt.',
            SEASON_NOT_FOUND: 'Mùa giải không tồn tại.',
            UNKNOWN: 'Không tải được lịch sử mùa giải.',
          },
        },
        hallOfFame: {
          title: 'Hall of Fame',
          subtitle: 'Vinh danh.',
          totalsLine: '{seasons} mùa đã chốt',
          loading: 'Đang tải bảng vinh danh…',
          empty: 'Chưa có mùa nào được vinh danh.',
          sectsTitle: 'Tông Môn vinh danh',
          membersTitle: 'Cá nhân vinh danh',
          noLatestSect: '(không Tông)',
          col: {
            rank: '#',
            sect: 'Tông',
            member: 'Đạo hữu',
            championships: 'Quán quân',
            mvps: 'MVP',
            podiums: 'Top 3',
            appearances: 'Mùa góp',
            bestRank: 'Hạng cao nhất',
            totalPoints: 'Tổng điểm',
            latest: 'Mùa gần nhất',
            latestSect: 'Tông gần nhất',
          },
        },
      },
    },
  },
});

const HISTORY_LIST_SAMPLE: SectSeasonHistoryListView = {
  seasons: [
    {
      seasonKey: 'season_2026_s2',
      finalizedAt: '2026-05-25T00:00:00.000Z',
      totalSects: 3,
      totalContributors: 5,
      totalPoints: 1500,
      champion: {
        rank: 1,
        sectId: 'sect-a',
        sectName: 'Vạn Kiếm',
        points: 800,
        contributors: 0,
        weeksContributed: 0,
      },
      mvp: {
        rank: 1,
        characterId: 'char-1',
        characterName: 'Lý Bạch',
        sectId: 'sect-a',
        sectName: 'Vạn Kiếm',
        points: 500,
      },
    },
    {
      seasonKey: 'season_2026_s1',
      finalizedAt: '2026-04-27T00:00:00.000Z',
      totalSects: 2,
      totalContributors: 3,
      totalPoints: 900,
      champion: {
        rank: 1,
        sectId: 'sect-b',
        sectName: 'Thiên Vũ',
        points: 600,
        contributors: 0,
        weeksContributed: 0,
      },
      mvp: null,
    },
  ],
};

const HOF_SAMPLE: SectHallOfFameView = {
  totalSeasonsFinalized: 2,
  sects: [
    {
      sectId: 'sect-a',
      sectName: 'Vạn Kiếm',
      championships: 1,
      podiums: 2,
      appearances: 2,
      bestRank: 1,
      totalPoints: 1400,
      latestSeasonKey: 'season_2026_s2',
    },
    {
      sectId: 'sect-b',
      sectName: 'Thiên Vũ',
      championships: 1,
      podiums: 1,
      appearances: 1,
      bestRank: 1,
      totalPoints: 600,
      latestSeasonKey: 'season_2026_s1',
    },
  ],
  members: [
    {
      characterId: 'char-1',
      characterName: 'Lý Bạch',
      mvps: 1,
      podiums: 1,
      appearances: 1,
      bestRank: 1,
      totalPoints: 500,
      latestSeasonKey: 'season_2026_s2',
      latestSectName: 'Vạn Kiếm',
    },
  ],
};

const DETAIL_SAMPLE: SectSeasonHistoryView = {
  seasonKey: 'season_2026_s2',
  finalizedAt: '2026-05-25T00:00:00.000Z',
  totalSects: 3,
  totalContributors: 5,
  totalPoints: 1500,
  sects: [
    {
      rank: 1,
      sectId: 'sect-a',
      sectName: 'Vạn Kiếm',
      points: 800,
      contributors: 3,
      weeksContributed: 4,
    },
    {
      rank: 2,
      sectId: 'sect-b',
      sectName: 'Thiên Vũ',
      points: 500,
      contributors: 1,
      weeksContributed: 2,
    },
  ],
  topMembers: [
    {
      rank: 1,
      characterId: 'char-1',
      characterName: 'Lý Bạch',
      sectId: 'sect-a',
      sectName: 'Vạn Kiếm',
      points: 500,
    },
    {
      rank: 2,
      characterId: 'char-2',
      characterName: 'Đỗ Phủ',
      sectId: null,
      sectName: null,
      points: 200,
    },
  ],
};

function mountPanel() {
  return mount(SectSeasonHistoryPanel, {
    global: { plugins: [i18n] },
  });
}

describe('SectSeasonHistoryPanel', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    getHistoryMock.mockReset();
    getHistoryDetailMock.mockReset();
    getHallOfFameMock.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('render list view với 2 mùa, champion + mvp summary', async () => {
    getHistoryMock.mockResolvedValueOnce(HISTORY_LIST_SAMPLE);
    getHallOfFameMock.mockResolvedValueOnce(HOF_SAMPLE);
    const w = mountPanel();
    await flushPromises();

    expect(w.find('[data-test="sect-season-history-panel"]').exists()).toBe(true);
    expect(w.find('[data-test="sect-season-history-list"]').exists()).toBe(true);

    const rows = w.findAll('[data-test^="sect-season-history-row-"]');
    expect(rows).toHaveLength(2);
    // Newest first.
    expect(rows[0].attributes('data-test')).toBe(
      'sect-season-history-row-season_2026_s2',
    );

    // Champion summary first season.
    const champion = w.find(
      '[data-test="sect-season-history-champion-season_2026_s2"]',
    );
    expect(champion.text()).toContain('Vạn Kiếm');
    expect(champion.text()).toContain('800');

    // MVP for second season is null → fallback message.
    const mvp = w.find('[data-test="sect-season-history-mvp-season_2026_s1"]');
    expect(mvp.text()).toContain('Không có cá nhân tích điểm');
  });

  it('empty state khi history list rỗng', async () => {
    getHistoryMock.mockResolvedValueOnce({ seasons: [] });
    getHallOfFameMock.mockResolvedValueOnce({
      sects: [],
      members: [],
      totalSeasonsFinalized: 0,
    });
    const w = mountPanel();
    await flushPromises();

    expect(w.find('[data-test="sect-season-history-empty"]').exists()).toBe(true);
    expect(w.text()).toContain('Chưa có mùa giải nào kết thúc.');
    expect(w.find('[data-test="sect-season-hall-of-fame-empty"]').exists()).toBe(true);
    expect(w.text()).toContain('Chưa có mùa nào được vinh danh.');
  });

  it('Hall of Fame render sects + members theo thứ tự server', async () => {
    getHistoryMock.mockResolvedValueOnce({ seasons: [] });
    getHallOfFameMock.mockResolvedValueOnce(HOF_SAMPLE);
    const w = mountPanel();
    await flushPromises();

    const totals = w.find('[data-test="sect-season-hall-of-fame-totals"]');
    expect(totals.text()).toContain('2');

    const sectRows = w.findAll('[data-test="sect-season-hall-of-fame-sect-row"]');
    expect(sectRows).toHaveLength(2);
    // First row = top sect ordering từ server.
    expect(sectRows[0].text()).toContain('Vạn Kiếm');

    const memberRows = w.findAll(
      '[data-test="sect-season-hall-of-fame-member-row"]',
    );
    expect(memberRows).toHaveLength(1);
    expect(memberRows[0].text()).toContain('Lý Bạch');
  });

  it('viewDetail click → fetch detail, render full leaderboard + top members', async () => {
    getHistoryMock.mockResolvedValueOnce(HISTORY_LIST_SAMPLE);
    getHallOfFameMock.mockResolvedValueOnce(HOF_SAMPLE);
    getHistoryDetailMock.mockResolvedValueOnce(DETAIL_SAMPLE);
    const w = mountPanel();
    await flushPromises();

    await w
      .find('[data-test="sect-season-history-detail-btn-season_2026_s2"]')
      .trigger('click');
    await flushPromises();

    expect(getHistoryDetailMock).toHaveBeenCalledWith('season_2026_s2');
    expect(w.find('[data-test="sect-season-history-detail"]').exists()).toBe(true);
    expect(w.find('[data-test="sect-season-history-list"]').exists()).toBe(false);

    const sectRows = w.findAll('[data-test="sect-season-history-detail-sect-row"]');
    expect(sectRows).toHaveLength(2);
    expect(sectRows[0].text()).toContain('Vạn Kiếm');
    expect(sectRows[0].text()).toContain('800');

    const memberRows = w.findAll(
      '[data-test="sect-season-history-detail-member-row"]',
    );
    expect(memberRows).toHaveLength(2);
    // Member without sect → fallback noSect label.
    expect(memberRows[1].text()).toContain('(không Tông)');
  });

  it('back button quay lại list view', async () => {
    getHistoryMock.mockResolvedValueOnce(HISTORY_LIST_SAMPLE);
    getHallOfFameMock.mockResolvedValueOnce(HOF_SAMPLE);
    getHistoryDetailMock.mockResolvedValueOnce(DETAIL_SAMPLE);
    const w = mountPanel();
    await flushPromises();
    await w
      .find('[data-test="sect-season-history-detail-btn-season_2026_s2"]')
      .trigger('click');
    await flushPromises();

    await w.find('[data-test="sect-season-history-back"]').trigger('click');
    await flushPromises();
    expect(w.find('[data-test="sect-season-history-detail"]').exists()).toBe(false);
    expect(w.find('[data-test="sect-season-history-list"]').exists()).toBe(true);
  });

  it('error state KHÔNG crash', async () => {
    getHistoryMock.mockRejectedValueOnce(
      Object.assign(new Error('UNKNOWN'), { code: 'UNKNOWN' }),
    );
    getHallOfFameMock.mockResolvedValueOnce(HOF_SAMPLE);
    const w = mountPanel();
    await flushPromises();

    expect(w.find('[data-test="sect-season-history-error"]').exists()).toBe(true);
    expect(w.text()).toContain('Không tải được lịch sử mùa giải.');
  });

  it('detail error: SNAPSHOT_NOT_FOUND fallback i18n', async () => {
    getHistoryMock.mockResolvedValueOnce(HISTORY_LIST_SAMPLE);
    getHallOfFameMock.mockResolvedValueOnce(HOF_SAMPLE);
    getHistoryDetailMock.mockRejectedValueOnce(
      Object.assign(new Error('SNAPSHOT_NOT_FOUND'), { code: 'SNAPSHOT_NOT_FOUND' }),
    );
    const w = mountPanel();
    await flushPromises();
    await w
      .find('[data-test="sect-season-history-detail-btn-season_2026_s2"]')
      .trigger('click');
    await flushPromises();

    expect(
      w.find('[data-test="sect-season-history-detail-error"]').exists(),
    ).toBe(true);
    expect(w.text()).toContain('Mùa giải này chưa được chốt.');
  });
});
