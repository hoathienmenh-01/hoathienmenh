/**
 * Tests cho Sect Season (Mùa Tông Môn) shared catalog — Phase 13.2.A.
 *
 * Coverage:
 *   - Season catalog invariants (key unique, format, dates valid, durationWeeks).
 *   - Milestone catalog invariants (key unique, monotonic, reward non-empty).
 *   - Helper sectSeasonByKey / sectSeasonMilestoneByKey lookup.
 *   - currentSectSeason boundaries (Monday 00:00 ICT).
 *   - sectSeasonWeekKeys length + first/last weekKey alignment.
 *   - sectSeasonAchievedMilestones / sectSeasonNextMilestone derivation.
 */

import { describe, it, expect } from 'vitest';
import { ITEMS } from './items';
import { TITLES } from './titles';
import { BUFFS } from './buffs';
import {
  SECT_SEASONS,
  SECT_SEASON_DEFAULT_TZ,
  SECT_SEASON_MILESTONES,
  SECT_SEASON_WEEKS,
  currentSectSeason,
  sectSeasonAchievedMilestones,
  sectSeasonByKey,
  sectSeasonClaimableMilestones,
  sectSeasonMilestoneByKey,
  sectSeasonNextMilestone,
  sectSeasonRewardSummary,
  sectSeasonWeekKeys,
  validateSectSeason,
  validateSectSeasonMilestone,
  validateSectSeasonMilestonesMonotonic,
} from './sect-season';
import { sectWarWeekKey } from './sect-war';

describe('SectSeason — season catalog invariants', () => {
  it('có ≥3 season + key duy nhất', () => {
    expect(SECT_SEASONS.length).toBeGreaterThanOrEqual(3);
    const keys = SECT_SEASONS.map((s) => s.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('mọi season key match `season_YYYY_sN`', () => {
    for (const s of SECT_SEASONS) {
      expect(s.key, `season ${s.key}`).toMatch(/^season_\d{4}_s\d+$/);
    }
  });

  it('mọi season pass validateSectSeason', () => {
    for (const s of SECT_SEASONS) {
      const err = validateSectSeason(s);
      expect(err, `season ${s.key} validation: ${err}`).toBeNull();
    }
  });

  it('mọi season durationWeeks = SECT_SEASON_WEEKS (4)', () => {
    expect(SECT_SEASON_WEEKS).toBe(4);
    for (const s of SECT_SEASONS) {
      expect(s.durationWeeks, `season ${s.key}`).toBe(SECT_SEASON_WEEKS);
    }
  });

  it('default timezone = Asia/Ho_Chi_Minh', () => {
    expect(SECT_SEASON_DEFAULT_TZ).toBe('Asia/Ho_Chi_Minh');
    for (const s of SECT_SEASONS) {
      expect(s.timezone).toBe('Asia/Ho_Chi_Minh');
    }
  });

  it('season liên tiếp không gap (endsAt[i] = startsAt[i+1])', () => {
    for (let i = 1; i < SECT_SEASONS.length; i++) {
      expect(
        SECT_SEASONS[i].startsAtIso,
        `season ${SECT_SEASONS[i].key} startsAt phải = ${SECT_SEASONS[i - 1].key} endsAt`,
      ).toBe(SECT_SEASONS[i - 1].endsAtIso);
    }
  });

  it('mọi season i18n key non-empty', () => {
    for (const s of SECT_SEASONS) {
      expect(s.labelI18nKey).toMatch(/^sectSeason\./);
      expect(s.descriptionI18nKey).toMatch(/^sectSeason\./);
    }
  });

  it('validateSectSeason reject key sai format', () => {
    expect(
      validateSectSeason({
        key: 'wrong-format',
        startsAtIso: '2026-04-26T17:00:00.000Z',
        endsAtIso: '2026-05-24T17:00:00.000Z',
        durationWeeks: 4,
        timezone: 'Asia/Ho_Chi_Minh',
        labelI18nKey: 'x',
        descriptionI18nKey: 'x',
      }),
    ).toBe('INVALID_KEY');
  });

  it('validateSectSeason reject startsAt >= endsAt', () => {
    expect(
      validateSectSeason({
        key: 'season_2026_s1',
        startsAtIso: '2026-05-24T17:00:00.000Z',
        endsAtIso: '2026-04-26T17:00:00.000Z',
        durationWeeks: 4,
        timezone: 'Asia/Ho_Chi_Minh',
        labelI18nKey: 'x',
        descriptionI18nKey: 'x',
      }),
    ).toBe('INVALID_DATES');
  });

  it('validateSectSeason reject durationWeeks không khớp khoảng cách', () => {
    expect(
      validateSectSeason({
        key: 'season_2026_s1',
        startsAtIso: '2026-04-26T17:00:00.000Z',
        endsAtIso: '2026-05-24T17:00:00.000Z', // 4 tuần
        durationWeeks: 8, // mismatch
        timezone: 'Asia/Ho_Chi_Minh',
        labelI18nKey: 'x',
        descriptionI18nKey: 'x',
      }),
    ).toBe('INVALID_DURATION');
  });
});

describe('SectSeason — milestone catalog invariants', () => {
  it('có 5 milestone + key duy nhất', () => {
    expect(SECT_SEASON_MILESTONES.length).toBe(5);
    const keys = SECT_SEASON_MILESTONES.map((m) => m.key);
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys).toEqual([
      'milestone_bronze',
      'milestone_silver',
      'milestone_gold',
      'milestone_platinum',
      'milestone_diamond',
    ]);
  });

  it('mọi milestone pass validateSectSeasonMilestone', () => {
    for (const m of SECT_SEASON_MILESTONES) {
      const err = validateSectSeasonMilestone(m);
      expect(err, `milestone ${m.key}: ${err}`).toBeNull();
    }
  });

  it('milestones monotonic strictly increasing requiredPoints', () => {
    expect(validateSectSeasonMilestonesMonotonic(SECT_SEASON_MILESTONES)).toBeNull();
  });

  it('mọi milestone reward có ít nhất linhThach hoặc tienNgoc > 0', () => {
    for (const m of SECT_SEASON_MILESTONES) {
      const total = (m.reward.linhThach ?? 0) + (m.reward.tienNgoc ?? 0);
      expect(total, `milestone ${m.key}`).toBeGreaterThan(0);
    }
  });

  it('milestone reward grant tăng theo points (heuristic — total scale)', () => {
    // Không bắt buộc strict ordering của từng currency, nhưng tổng (LT + TN*5)
    // phải tăng hoặc bằng. Heuristic — đảm bảo grind reward đáng giá.
    const score = (m: { reward: { linhThach?: number; tienNgoc?: number } }) =>
      (m.reward.linhThach ?? 0) + (m.reward.tienNgoc ?? 0) * 5;
    for (let i = 1; i < SECT_SEASON_MILESTONES.length; i++) {
      expect(
        score(SECT_SEASON_MILESTONES[i]),
        `milestone ${SECT_SEASON_MILESTONES[i].key} reward >= prev`,
      ).toBeGreaterThanOrEqual(score(SECT_SEASON_MILESTONES[i - 1]));
    }
  });

  it('item/title/buff reference tồn tại trong catalog (nếu có)', () => {
    const itemKeys = new Set(ITEMS.map((i) => i.key));
    const titleKeys = new Set(TITLES.map((t) => t.key));
    const buffKeys = new Set(BUFFS.map((b) => b.key));
    for (const m of SECT_SEASON_MILESTONES) {
      for (const it of m.reward.items ?? []) {
        expect(itemKeys.has(it.itemKey), `${m.key} item ${it.itemKey}`).toBe(true);
      }
      if (m.reward.titleKey) {
        expect(titleKeys.has(m.reward.titleKey), `${m.key} title ${m.reward.titleKey}`).toBe(true);
      }
      if (m.reward.buffKey) {
        expect(buffKeys.has(m.reward.buffKey), `${m.key} buff ${m.reward.buffKey}`).toBe(true);
      }
    }
  });

  it('validateSectSeasonMilestone reject reward rỗng', () => {
    expect(
      validateSectSeasonMilestone({
        key: 'milestone_bronze',
        requiredPoints: 100,
        reward: {},
        labelI18nKey: 'x',
        descriptionI18nKey: 'x',
      }),
    ).toBe('INVALID_MILESTONE_REWARD');
  });

  it('validateSectSeasonMilestone reject requiredPoints < 1', () => {
    expect(
      validateSectSeasonMilestone({
        key: 'milestone_bronze',
        requiredPoints: 0,
        reward: { linhThach: 100 },
        labelI18nKey: 'x',
        descriptionI18nKey: 'x',
      }),
    ).toBe('INVALID_MILESTONE_POINTS');
  });

  it('validateSectSeasonMilestonesMonotonic reject non-monotonic', () => {
    expect(
      validateSectSeasonMilestonesMonotonic([
        {
          key: 'milestone_bronze',
          requiredPoints: 500,
          reward: { linhThach: 100 },
          labelI18nKey: 'x',
          descriptionI18nKey: 'x',
        },
        {
          key: 'milestone_silver',
          requiredPoints: 100, // < 500 — non-monotonic
          reward: { linhThach: 100 },
          labelI18nKey: 'x',
          descriptionI18nKey: 'x',
        },
      ]),
    ).toBe('NON_MONOTONIC_MILESTONES');
  });
});

describe('SectSeason — sectSeasonByKey / sectSeasonMilestoneByKey', () => {
  it('sectSeasonByKey lookup đúng key', () => {
    const s = sectSeasonByKey('season_2026_s2');
    expect(s).toBeDefined();
    expect(s!.startsAtIso).toBe('2026-04-26T17:00:00.000Z');
  });

  it('sectSeasonByKey trả undefined cho key sai', () => {
    expect(sectSeasonByKey('season_9999_s99')).toBeUndefined();
  });

  it('sectSeasonMilestoneByKey lookup đúng key', () => {
    const m = sectSeasonMilestoneByKey('milestone_gold');
    expect(m).toBeDefined();
    expect(m!.requiredPoints).toBe(1500);
  });

  it('sectSeasonMilestoneByKey trả undefined cho key sai', () => {
    expect(sectSeasonMilestoneByKey('milestone_unknown')).toBeUndefined();
  });
});

describe('SectSeason — currentSectSeason boundaries', () => {
  it('giữa season_2026_s2 (2026-W19, 2026-05-08) → trả season_2026_s2', () => {
    const s = currentSectSeason(new Date('2026-05-08T05:00:00Z'));
    expect(s).toBeDefined();
    expect(s!.key).toBe('season_2026_s2');
  });

  it('startsAt boundary inclusive: Mon 2026-04-27 00:00 ICT thuộc s2', () => {
    // 2026-04-26T17:00:00Z = 2026-04-27 00:00 ICT.
    const s = currentSectSeason(new Date('2026-04-26T17:00:00.000Z'));
    expect(s!.key).toBe('season_2026_s2');
  });

  it('endsAt boundary exclusive: Mon 2026-05-25 00:00 ICT thuộc s3 (không phải s2)', () => {
    // 2026-05-24T17:00:00Z = 2026-05-25 00:00 ICT.
    const s = currentSectSeason(new Date('2026-05-24T17:00:00.000Z'));
    expect(s!.key).toBe('season_2026_s3');
  });

  it('1 ms trước endsAt s2 → vẫn s2', () => {
    const s = currentSectSeason(new Date('2026-05-24T16:59:59.999Z'));
    expect(s!.key).toBe('season_2026_s2');
  });

  it('trước season đầu (2025-01-01) → undefined', () => {
    expect(currentSectSeason(new Date('2025-01-01T00:00:00Z'))).toBeUndefined();
  });

  it('sau season cuối (2030-01-01) → undefined', () => {
    expect(currentSectSeason(new Date('2030-01-01T00:00:00Z'))).toBeUndefined();
  });
});

describe('SectSeason — sectSeasonWeekKeys', () => {
  it('season_2026_s2 (4 tuần) → 4 weekKey [W18, W19, W20, W21]', () => {
    const s = sectSeasonByKey('season_2026_s2')!;
    const keys = sectSeasonWeekKeys(s);
    expect(keys).toHaveLength(4);
    expect(keys).toEqual(['2026-W18', '2026-W19', '2026-W20', '2026-W21']);
  });

  it('first weekKey = sectWarWeekKey(season.startsAt)', () => {
    for (const s of SECT_SEASONS.slice(0, 3)) {
      const keys = sectSeasonWeekKeys(s);
      expect(keys[0]).toBe(sectWarWeekKey(new Date(s.startsAtIso), s.timezone));
    }
  });

  it('weekKeys không duplicate trong cùng season', () => {
    for (const s of SECT_SEASONS) {
      const keys = sectSeasonWeekKeys(s);
      expect(new Set(keys).size, `season ${s.key}`).toBe(keys.length);
    }
  });

  it('weekKeys length = season.durationWeeks', () => {
    for (const s of SECT_SEASONS) {
      expect(sectSeasonWeekKeys(s).length).toBe(s.durationWeeks);
    }
  });
});

describe('SectSeason — milestone progress derivation', () => {
  it('points 0 → achieved=[]', () => {
    expect(sectSeasonAchievedMilestones(0)).toEqual([]);
  });

  it('points 50 → achieved=[]', () => {
    expect(sectSeasonAchievedMilestones(50)).toEqual([]);
  });

  it('points 100 → achieved=[bronze]', () => {
    const a = sectSeasonAchievedMilestones(100);
    expect(a.map((m) => m.key)).toEqual(['milestone_bronze']);
  });

  it('points 500 → achieved=[bronze, silver]', () => {
    const a = sectSeasonAchievedMilestones(500);
    expect(a.map((m) => m.key)).toEqual(['milestone_bronze', 'milestone_silver']);
  });

  it('points 7500 → achieved tất cả 5', () => {
    const a = sectSeasonAchievedMilestones(7500);
    expect(a).toHaveLength(5);
  });

  it('points âm → achieved=[]', () => {
    expect(sectSeasonAchievedMilestones(-100)).toEqual([]);
  });

  it('points NaN → achieved=[]', () => {
    expect(sectSeasonAchievedMilestones(Number.NaN)).toEqual([]);
  });

  it('sectSeasonNextMilestone(0) = bronze', () => {
    const m = sectSeasonNextMilestone(0);
    expect(m!.key).toBe('milestone_bronze');
  });

  it('sectSeasonNextMilestone(100) = silver (đã đạt bronze)', () => {
    const m = sectSeasonNextMilestone(100);
    expect(m!.key).toBe('milestone_silver');
  });

  it('sectSeasonNextMilestone(7500) = null (đã clear hết)', () => {
    expect(sectSeasonNextMilestone(7500)).toBeNull();
  });

  it('sectSeasonNextMilestone(99999) = null', () => {
    expect(sectSeasonNextMilestone(99999)).toBeNull();
  });
});

// Phase 13.2.B — claim helpers
describe('SectSeason — sectSeasonClaimableMilestones', () => {
  it('points 0 → claimable=[]', () => {
    expect(sectSeasonClaimableMilestones(0, [])).toEqual([]);
  });

  it('points 100 + claimed=[] → claimable=[bronze]', () => {
    const c = sectSeasonClaimableMilestones(100, []);
    expect(c.map((m) => m.key)).toEqual(['milestone_bronze']);
  });

  it('points 100 + claimed=[bronze] → claimable=[]', () => {
    const c = sectSeasonClaimableMilestones(100, ['milestone_bronze']);
    expect(c).toEqual([]);
  });

  it('points 7500 + claimed=[bronze,gold] → claimable=[silver,platinum,diamond]', () => {
    const c = sectSeasonClaimableMilestones(7500, ['milestone_bronze', 'milestone_gold']);
    expect(c.map((m) => m.key)).toEqual([
      'milestone_silver',
      'milestone_platinum',
      'milestone_diamond',
    ]);
  });

  it('claimable order stable theo catalog (asc requiredPoints)', () => {
    const c = sectSeasonClaimableMilestones(7500, []);
    const reqs = c.map((m) => m.requiredPoints);
    for (let i = 1; i < reqs.length; i++) {
      expect(reqs[i]).toBeGreaterThan(reqs[i - 1]);
    }
  });

  it('points âm → claimable=[]', () => {
    expect(sectSeasonClaimableMilestones(-50, [])).toEqual([]);
  });

  it('claimedKeys ngoài catalog không crash + bị bỏ qua', () => {
    const c = sectSeasonClaimableMilestones(100, ['milestone_unknown']);
    expect(c.map((m) => m.key)).toEqual(['milestone_bronze']);
  });
});

describe('SectSeason — sectSeasonRewardSummary', () => {
  it('reward đầy đủ → echo exact + items array shape', () => {
    const sum = sectSeasonRewardSummary({
      linhThach: 1000,
      tienNgoc: 5,
      items: [
        { itemKey: 'spirit_pill_lv1', qty: 3 },
        { itemKey: 'sect_token', qty: 1 },
      ],
      titleKey: 'season_champion',
      buffKey: 'season_aura',
    });
    expect(sum.linhThach).toBe(1000);
    expect(sum.tienNgoc).toBe(5);
    expect(sum.items).toEqual([
      { itemKey: 'spirit_pill_lv1', qty: 3 },
      { itemKey: 'sect_token', qty: 1 },
    ]);
    expect(sum.titleKey).toBe('season_champion');
    expect(sum.buffKey).toBe('season_aura');
  });

  it('reward rỗng → 0/empty/null defaults (FE không cần defensive)', () => {
    const sum = sectSeasonRewardSummary({});
    expect(sum.linhThach).toBe(0);
    expect(sum.tienNgoc).toBe(0);
    expect(sum.items).toEqual([]);
    expect(sum.titleKey).toBeNull();
    expect(sum.buffKey).toBeNull();
  });

  it('mọi catalog milestone → sum.linhThach + sum.tienNgoc tăng theo catalog ordering (heuristic)', () => {
    const score = (m: { reward: { linhThach?: number; tienNgoc?: number } }) =>
      sectSeasonRewardSummary(m.reward).linhThach +
      sectSeasonRewardSummary(m.reward).tienNgoc * 5;
    for (let i = 1; i < SECT_SEASON_MILESTONES.length; i++) {
      expect(score(SECT_SEASON_MILESTONES[i])).toBeGreaterThanOrEqual(
        score(SECT_SEASON_MILESTONES[i - 1]),
      );
    }
  });
});
