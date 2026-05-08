/**
 * Phase 13.2.A — SectSeasonPanel tests.
 * Phase 13.2.B — extended với claim flow (claimable button, claimed badge,
 * locked state, claim success result, claim error toast).
 *
 * Mock /sect-season/current + /sect-season/milestones/:k/claim; verify:
 *   - render header season label + countdown.
 *   - render personal progress (points, weeks).
 *   - render milestone list with achieved/locked status.
 *   - render leaderboard with mySectId highlight.
 *   - out-of-range fallback (season=null).
 *   - error state KHÔNG crash.
 *   - Phase 13.2.B: claim button enable/disable theo claimableMilestoneKeys.
 *   - Phase 13.2.B: claim success → result toast + refresh state.
 *   - Phase 13.2.B: claim error → error toast (i18n code).
 *   - Phase 13.2.B: claimed milestone → "Đã nhận" badge thay button.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { createI18n } from 'vue-i18n';
import { createPinia, setActivePinia } from 'pinia';

const getSectSeasonCurrentMock = vi.fn();
const claimSectSeasonMilestoneMock = vi.fn();

vi.mock('@/api/sectSeason', () => ({
  getSectSeasonCurrent: (...a: unknown[]) => getSectSeasonCurrentMock(...a),
  claimSectSeasonMilestone: (...a: unknown[]) => claimSectSeasonMilestoneMock(...a),
}));

import SectSeasonPanel from '@/components/SectSeasonPanel.vue';
import type { SectSeasonClaimResult, SectSeasonCurrent } from '@/api/sectSeason';

const i18n = createI18n({
  legacy: false,
  locale: 'vi',
  fallbackLocale: 'vi',
  messages: {
    vi: {
      sectSeason: {
        loading: 'Đang tải dữ liệu mùa giải…',
        outOfRange: 'Hiện không có mùa giải đang chạy.',
        dismiss: 'Đóng',
        season: {
          fallbackLabel: 'Mùa {k}',
          keyLabel: '{k}',
          range: '{start} → {end} ({weeks} tuần)',
          remaining: 'Còn {d}d {h}h {m}m',
          ended: 'Mùa đã kết thúc',
          names: { s1: 'Mùa Khai Nguyên' },
          namesDesc: { s1: 'Mùa khởi đầu.' },
        },
        myProgress: {
          title: 'Tiến độ cá nhân',
          noData: 'Chưa có dữ liệu mùa giải cho bạn.',
          sect: 'Tông Môn',
          noSect: 'Chưa gia nhập Tông',
          personalPoints: 'Điểm cống hiến mùa',
          weeksContributed: 'Tuần đóng góp',
          weeksOf: '{contributed}/{total}',
          nextHint: 'Còn {need} điểm để đạt {label}.',
        },
        milestone: {
          title: 'Cột mốc mùa giải',
          achieved: 'Đã đạt',
          locked: 'Chưa đạt',
          claimed: 'Đã nhận',
          claim: 'Nhận thưởng',
          claiming: 'Đang nhận…',
          required: '{n} điểm',
          names: { bronze: 'Đồng', silver: 'Bạc' },
          namesDesc: { bronze: 'Mở rương đầu mùa.', silver: 'Hộp quà bạc.' },
        },
        claimResult: {
          title: 'Đã nhận thưởng cột mốc {key}',
        },
        leaderboard: {
          title: 'Bảng xếp hạng Tông',
          empty: 'Chưa có Tông nào tích điểm.',
          youTag: '(Tông của bạn)',
          col: {
            rank: 'Hạng',
            sect: 'Tông',
            points: 'Điểm',
            contributors: 'Thành viên',
            weeks: 'Tuần',
          },
        },
        reward: {
          linhThach: '{n} linh thạch',
          tienNgoc: '{n} tiên ngọc',
          items: '{n} vật phẩm',
          titleAward: 'Danh hiệu {k}',
          buff: 'Buff {k}',
        },
        errors: {
          NO_CHARACTER: 'Chưa có nhân vật.',
          SEASON_NOT_FOUND: 'Mùa giải không tồn tại.',
          SECT_SEASON_MILESTONE_NOT_FOUND: 'Cột mốc mùa giải không tồn tại.',
          SECT_SEASON_NOT_ELIGIBLE: 'Chưa đủ điểm để nhận cột mốc này.',
          SECT_SEASON_ALREADY_CLAIMED: 'Bạn đã nhận thưởng cột mốc này rồi.',
          UNKNOWN: 'Không tải được dữ liệu mùa giải — thử lại.',
        },
      },
    },
  },
});

const NOW = new Date('2026-04-05T03:00:00.000Z').getTime();
const STARTS = '2026-03-30T17:00:00.000Z';
const ENDS = '2026-04-27T17:00:00.000Z';

const SAMPLE: SectSeasonCurrent = {
  seasonKey: 's1',
  season: {
    key: 's1',
    startsAtIso: STARTS,
    endsAtIso: ENDS,
    durationWeeks: 4,
    timezone: 'Asia/Ho_Chi_Minh',
    labelI18nKey: 'sectSeason.season.names.s1',
    descriptionI18nKey: 'sectSeason.season.namesDesc.s1',
  },
  milestones: [
    {
      key: 'bronze',
      requiredPoints: 100,
      reward: { linhThach: 50 },
      labelI18nKey: 'sectSeason.milestone.names.bronze',
      descriptionI18nKey: 'sectSeason.milestone.namesDesc.bronze',
    },
    {
      key: 'silver',
      requiredPoints: 500,
      reward: { linhThach: 200, items: [{ itemKey: 'qiSparkPill', qty: 5 }] },
      labelI18nKey: 'sectSeason.milestone.names.silver',
      descriptionI18nKey: 'sectSeason.milestone.namesDesc.silver',
    },
  ],
  leaderboard: [
    {
      rank: 1,
      sectId: 'sect-1',
      sectName: 'Vạn Kiếm',
      points: 1200,
      contributors: 8,
      weeksContributed: 1,
    },
    {
      rank: 2,
      sectId: 'sect-2',
      sectName: 'Thiên Vũ',
      points: 800,
      contributors: 5,
      weeksContributed: 1,
    },
  ],
  me: {
    seasonKey: 's1',
    hasSect: true,
    sectId: 'sect-2',
    sectName: 'Thiên Vũ',
    personalPoints: 150,
    weeksContributed: 1,
    achievedMilestoneKeys: ['bronze'],
    nextMilestoneKey: 'silver',
    claimedMilestoneKeys: [],
    claimableMilestoneKeys: ['bronze'],
  },
};

function mountPanel(props: Record<string, unknown> = {}) {
  return mount(SectSeasonPanel, {
    props,
    global: { plugins: [i18n] },
  });
}

describe('SectSeasonPanel', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    getSectSeasonCurrentMock.mockReset();
    claimSectSeasonMilestoneMock.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('render season header + countdown khi season active', async () => {
    getSectSeasonCurrentMock.mockResolvedValueOnce(SAMPLE);
    const w = mountPanel({ mySectId: 'sect-2' });
    await flushPromises();

    expect(w.find('[data-test="sect-season-panel"]').exists()).toBe(true);
    expect(w.find('[data-test="sect-season-content"]').exists()).toBe(true);
    expect(w.find('[data-test="sect-season-header"]').exists()).toBe(true);
    expect(w.text()).toContain('Mùa Khai Nguyên');
    // Remaining countdown formatted (4 weeks - 7 days from start = 21+ days remaining).
    const remainingText = w.find('[data-test="sect-season-remaining"]').text();
    expect(remainingText).toMatch(/Còn \d+d \d+h \d+m/);
  });

  it('render personal progress: points, weeks, sect name', async () => {
    getSectSeasonCurrentMock.mockResolvedValueOnce(SAMPLE);
    const w = mountPanel();
    await flushPromises();

    expect(w.find('[data-test="sect-season-my-points"]').text()).toContain('150');
    expect(w.find('[data-test="sect-season-my-weeks"]').text()).toContain('1/4');
    expect(w.find('[data-test="sect-season-my-sect"]').text()).toContain('Thiên Vũ');
    // Next milestone hint: silver requires 500, achieved 150 → need 350.
    expect(w.find('[data-test="sect-season-next-milestone-hint"]').text()).toContain(
      '350',
    );
    expect(w.find('[data-test="sect-season-next-milestone-hint"]').text()).toContain(
      'Bạc',
    );
  });

  it('render milestones với achieved/locked status', async () => {
    getSectSeasonCurrentMock.mockResolvedValueOnce(SAMPLE);
    const w = mountPanel();
    await flushPromises();

    expect(w.find('[data-test="sect-season-milestone-row-bronze"]').exists()).toBe(true);
    expect(w.find('[data-test="sect-season-milestone-row-silver"]').exists()).toBe(true);

    // Bronze achieved → '✓'.
    expect(w.find('[data-test="sect-season-milestone-status-bronze"]').text()).toBe('✓');
    // Silver locked → '·'.
    expect(w.find('[data-test="sect-season-milestone-status-silver"]').text()).toBe('·');

    // Reward summary render.
    expect(w.find('[data-test="sect-season-milestone-reward-bronze"]').text()).toContain(
      'linh thạch',
    );
    expect(w.find('[data-test="sect-season-milestone-reward-silver"]').text()).toContain(
      'vật phẩm',
    );
  });

  it('render leaderboard với mySectId highlight', async () => {
    getSectSeasonCurrentMock.mockResolvedValueOnce(SAMPLE);
    const w = mountPanel({ mySectId: 'sect-2' });
    await flushPromises();

    const rows = w.findAll('[data-test="sect-season-leaderboard-row"]');
    expect(rows.length).toBe(2);
    // Row 0: Vạn Kiếm (sect-1) — không highlight.
    expect(rows[0].text()).toContain('Vạn Kiếm');
    expect(rows[0].text()).toContain('1,200');
    // Row 1: Thiên Vũ (sect-2) — highlight + youTag.
    expect(rows[1].text()).toContain('Thiên Vũ');
    expect(rows[1].text()).toContain('(Tông của bạn)');
    expect(rows[1].classes().some((c) => c.includes('amber'))).toBe(true);
  });

  it('out-of-range fallback (season=null) → hiển thị info banner, KHÔNG crash', async () => {
    getSectSeasonCurrentMock.mockResolvedValueOnce({
      seasonKey: null,
      season: null,
      milestones: [],
      leaderboard: [],
      me: null,
    });
    const w = mountPanel();
    await flushPromises();

    expect(w.find('[data-test="sect-season-out-of-range"]').exists()).toBe(true);
    expect(w.find('[data-test="sect-season-content"]').exists()).toBe(false);
    expect(w.text()).toContain('Hiện không có mùa giải đang chạy.');
  });

  it('error state: render error i18n + KHÔNG crash', async () => {
    getSectSeasonCurrentMock.mockRejectedValueOnce(
      Object.assign(new Error('NO_CHARACTER'), { code: 'NO_CHARACTER' }),
    );
    const w = mountPanel();
    await flushPromises();

    expect(w.find('[data-test="sect-season-error"]').exists()).toBe(true);
    expect(w.text()).toContain('Chưa có nhân vật.');
  });

  it('loading state KHÔNG crash', async () => {
    let resolveFn: ((v: SectSeasonCurrent) => void) | null = null;
    getSectSeasonCurrentMock.mockReturnValueOnce(
      new Promise<SectSeasonCurrent>((r) => {
        resolveFn = r;
      }),
    );
    const w = mountPanel();
    expect(w.find('[data-test="sect-season-loading"]').exists()).toBe(true);
    resolveFn!(SAMPLE);
    await flushPromises();
    expect(w.find('[data-test="sect-season-loading"]').exists()).toBe(false);
  });

  // Phase 13.2.B — claim flow.

  it('claim button render cho milestone trong claimableMilestoneKeys', async () => {
    getSectSeasonCurrentMock.mockResolvedValueOnce(SAMPLE);
    const w = mountPanel();
    await flushPromises();

    // Bronze claimable → button visible.
    const btn = w.find('[data-test="sect-season-milestone-claim-bronze"]');
    expect(btn.exists()).toBe(true);
    expect(btn.text()).toContain('Nhận thưởng');
    expect((btn.element as HTMLButtonElement).disabled).toBe(false);

    // Silver locked (chưa achieved) → KHÔNG có button claim, có locked label.
    expect(w.find('[data-test="sect-season-milestone-claim-silver"]').exists()).toBe(
      false,
    );
    expect(w.find('[data-test="sect-season-milestone-locked-silver"]').exists()).toBe(
      true,
    );
  });

  it('claim success → result toast render + reload state', async () => {
    // Initial load: bronze claimable.
    getSectSeasonCurrentMock.mockResolvedValueOnce(SAMPLE);
    const claimResult: SectSeasonClaimResult = {
      seasonKey: 's1',
      milestoneKey: 'bronze',
      granted: {
        linhThach: 50,
        tienNgoc: 0,
        items: [],
        titleKey: null,
        buffKey: null,
      },
      pointsAtClaim: 150,
      claimedAtIso: '2026-04-05T03:01:00.000Z',
    };
    claimSectSeasonMilestoneMock.mockResolvedValueOnce(claimResult);
    // After claim: refresh() → bronze trong claimedMilestoneKeys, claimable rỗng.
    getSectSeasonCurrentMock.mockResolvedValueOnce({
      ...SAMPLE,
      me: {
        ...SAMPLE.me!,
        claimedMilestoneKeys: ['bronze'],
        claimableMilestoneKeys: [],
      },
    });

    const w = mountPanel();
    await flushPromises();

    await w.find('[data-test="sect-season-milestone-claim-bronze"]').trigger('click');
    await flushPromises();

    expect(claimSectSeasonMilestoneMock).toHaveBeenCalledWith('bronze');
    // Result toast render với reward summary.
    const toast = w.find('[data-test="sect-season-claim-result"]');
    expect(toast.exists()).toBe(true);
    expect(toast.text()).toContain('bronze');
    expect(
      w.find('[data-test="sect-season-claim-result-summary"]').text(),
    ).toContain('linh thạch');

    // After refresh, claim button bị thay bởi "Đã nhận" badge.
    expect(w.find('[data-test="sect-season-milestone-claim-bronze"]').exists()).toBe(
      false,
    );
    expect(w.find('[data-test="sect-season-milestone-claimed-bronze"]').exists()).toBe(
      true,
    );
    expect(w.find('[data-test="sect-season-milestone-claimed-bronze"]').text()).toBe(
      'Đã nhận',
    );

    // Dismiss toast → ẩn.
    await w.find('[data-test="sect-season-claim-result-dismiss"]').trigger('click');
    await flushPromises();
    expect(w.find('[data-test="sect-season-claim-result"]').exists()).toBe(false);
  });

  it('claim error: error code map → i18n toast', async () => {
    getSectSeasonCurrentMock.mockResolvedValueOnce(SAMPLE);
    claimSectSeasonMilestoneMock.mockRejectedValueOnce(
      Object.assign(new Error('SECT_SEASON_ALREADY_CLAIMED'), {
        code: 'SECT_SEASON_ALREADY_CLAIMED',
      }),
    );

    const w = mountPanel();
    await flushPromises();
    await w.find('[data-test="sect-season-milestone-claim-bronze"]').trigger('click');
    await flushPromises();

    const toast = w.find('[data-test="sect-season-claim-error"]');
    expect(toast.exists()).toBe(true);
    expect(toast.text()).toContain('Bạn đã nhận thưởng cột mốc này rồi.');

    // Dismiss → ẩn.
    await w.find('[data-test="sect-season-claim-error-dismiss"]').trigger('click');
    await flushPromises();
    expect(w.find('[data-test="sect-season-claim-error"]').exists()).toBe(false);
  });

  it('claimed milestone render "Đã nhận" badge thay vì button', async () => {
    getSectSeasonCurrentMock.mockResolvedValueOnce({
      ...SAMPLE,
      me: {
        ...SAMPLE.me!,
        claimedMilestoneKeys: ['bronze'],
        claimableMilestoneKeys: [],
      },
    });
    const w = mountPanel();
    await flushPromises();

    expect(w.find('[data-test="sect-season-milestone-claim-bronze"]').exists()).toBe(
      false,
    );
    expect(w.find('[data-test="sect-season-milestone-claimed-bronze"]').exists()).toBe(
      true,
    );
  });
});
