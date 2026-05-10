/**
 * Tests cho Sect War (Tông Môn Chiến) shared catalog — Phase 13.1.A.
 *
 * Coverage:
 *   - Activity catalog invariants (key unique, points > 0, caps valid).
 *   - Reward tier invariants (rank range, reward grant non-empty).
 *   - Helper sectWarActivityByKey / sectWarRewardTierForRank lookup.
 *   - sectWarWeekKey stability trong cùng tuần + chuyển tuần.
 *   - currentSectWarSeason start/end timestamp đúng Monday 00:00 ICT.
 */

import { describe, it, expect } from 'vitest';
import { TITLES } from './titles';
import { BUFFS } from './buffs';
import { ITEMS } from './items';
import {
  SECT_WAR_ACTIVITIES,
  SECT_WAR_DEFAULT_TZ,
  SECT_WAR_REWARD_TIERS,
  currentSectWarSeason,
  sectWarActivityByKey,
  sectWarRewardTierForRank,
  sectWarTheoreticalMaxPointsPerWeek,
  sectWarWeekKey,
  startOfSectWarWeek,
  validateSectWarActivity,
  validateSectWarRewardTier,
} from './sect-war';

describe('SectWar — activity catalog invariants', () => {
  it('có ≥4 activity (daily_login, dungeon_clear, boss_participation, boss_top_damage, quest_complete)', () => {
    expect(SECT_WAR_ACTIVITIES.length).toBeGreaterThanOrEqual(4);
    const keys = SECT_WAR_ACTIVITIES.map((a) => a.key);
    expect(keys).toContain('daily_login');
    expect(keys).toContain('dungeon_clear');
    expect(keys).toContain('boss_participation');
    expect(keys).toContain('boss_top_damage');
    expect(keys).toContain('quest_complete');
  });

  it('activity keys duy nhất', () => {
    const keys = SECT_WAR_ACTIVITIES.map((a) => a.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('mọi activity pass validateSectWarActivity', () => {
    for (const a of SECT_WAR_ACTIVITIES) {
      const err = validateSectWarActivity(a);
      expect(err, `activity ${a.key} validation: ${err}`).toBeNull();
    }
  });

  it('mọi activity points > 0', () => {
    for (const a of SECT_WAR_ACTIVITIES) {
      expect(a.points, `activity ${a.key}`).toBeGreaterThan(0);
    }
  });

  it('caps consistent (dailyCap ≥ points; weeklyCap ≥ dailyCap nếu có)', () => {
    for (const a of SECT_WAR_ACTIVITIES) {
      if (a.dailyCap !== undefined) {
        expect(a.dailyCap, `activity ${a.key} dailyCap`).toBeGreaterThanOrEqual(a.points);
      }
      if (a.weeklyCap !== undefined) {
        expect(a.weeklyCap, `activity ${a.key} weeklyCap`).toBeGreaterThanOrEqual(a.points);
        if (a.dailyCap !== undefined) {
          expect(a.weeklyCap, `activity ${a.key} weeklyCap >= dailyCap`).toBeGreaterThanOrEqual(
            a.dailyCap,
          );
        }
      }
    }
  });

  it('mọi i18n key non-empty', () => {
    for (const a of SECT_WAR_ACTIVITIES) {
      expect(a.labelI18nKey).toMatch(/^sectWar\./);
      expect(a.descriptionI18nKey).toMatch(/^sectWar\./);
    }
  });

  it('validateSectWarActivity reject points <= 0', () => {
    expect(
      validateSectWarActivity({
        key: 'daily_login',
        points: 0,
        sourceType: 'DungeonRun',
        labelI18nKey: 'sectWar.x',
        descriptionI18nKey: 'sectWar.x',
      }),
    ).toBe('INVALID_POINTS');
  });

  it('validateSectWarActivity reject dailyCap < points', () => {
    expect(
      validateSectWarActivity({
        key: 'daily_login',
        points: 10,
        dailyCap: 5,
        sourceType: 'DungeonRun',
        labelI18nKey: 'sectWar.x',
        descriptionI18nKey: 'sectWar.x',
      }),
    ).toBe('INVALID_DAILY_CAP');
  });

  it('validateSectWarActivity reject weeklyCap < dailyCap', () => {
    expect(
      validateSectWarActivity({
        key: 'daily_login',
        points: 10,
        dailyCap: 50,
        weeklyCap: 30,
        sourceType: 'DungeonRun',
        labelI18nKey: 'sectWar.x',
        descriptionI18nKey: 'sectWar.x',
      }),
    ).toBe('INVALID_WEEKLY_CAP');
  });
});

describe('SectWar — reward tier invariants', () => {
  it('có 4 tier (rank_1, rank_2_3, rank_4_10, participation)', () => {
    expect(SECT_WAR_REWARD_TIERS.length).toBe(4);
    const keys = SECT_WAR_REWARD_TIERS.map((t) => t.key);
    expect(keys).toEqual(['rank_1', 'rank_2_3', 'rank_4_10', 'participation']);
  });

  it('mọi tier pass validateSectWarRewardTier', () => {
    for (const t of SECT_WAR_REWARD_TIERS) {
      const err = validateSectWarRewardTier(t);
      expect(err, `tier ${t.key}: ${err}`).toBeNull();
    }
  });

  it('mọi tier có ít nhất linhThach hoặc tienNgoc > 0', () => {
    for (const t of SECT_WAR_REWARD_TIERS) {
      const reward = t.reward;
      const total = (reward.linhThach ?? 0) + (reward.tienNgoc ?? 0);
      expect(total, `tier ${t.key}`).toBeGreaterThan(0);
    }
  });

  it('tier reward decreasing theo rank (rank_1 > rank_2_3 > rank_4_10)', () => {
    const t1 = SECT_WAR_REWARD_TIERS.find((t) => t.key === 'rank_1')!;
    const t23 = SECT_WAR_REWARD_TIERS.find((t) => t.key === 'rank_2_3')!;
    const t410 = SECT_WAR_REWARD_TIERS.find((t) => t.key === 'rank_4_10')!;
    expect(t1.reward.linhThach!).toBeGreaterThan(t23.reward.linhThach!);
    expect(t23.reward.linhThach!).toBeGreaterThan(t410.reward.linhThach!);
  });

  it('participation tier có minPersonalPoints > 0', () => {
    const part = SECT_WAR_REWARD_TIERS.find((t) => t.key === 'participation')!;
    expect(part.minPersonalPoints).toBeDefined();
    expect(part.minPersonalPoints!).toBeGreaterThan(0);
  });

  it('item/title/buff reference tồn tại trong catalog (nếu có)', () => {
    const itemKeys = new Set(ITEMS.map((i) => i.key));
    const titleKeys = new Set(TITLES.map((t) => t.key));
    const buffKeys = new Set(BUFFS.map((b) => b.key));
    for (const t of SECT_WAR_REWARD_TIERS) {
      for (const it of t.reward.items ?? []) {
        expect(itemKeys.has(it.itemKey), `tier ${t.key} item ${it.itemKey}`).toBe(true);
      }
      if (t.reward.titleKey) {
        expect(titleKeys.has(t.reward.titleKey), `tier ${t.key} title ${t.reward.titleKey}`).toBe(true);
      }
      if (t.reward.buffKey) {
        expect(buffKeys.has(t.reward.buffKey), `tier ${t.key} buff ${t.reward.buffKey}`).toBe(true);
      }
    }
  });

  it('validateSectWarRewardTier reject tier không có reward', () => {
    expect(
      validateSectWarRewardTier({
        key: 'rank_1',
        minRank: 1,
        maxRank: 1,
        reward: {},
        labelI18nKey: 'sectWar.x',
        descriptionI18nKey: 'sectWar.x',
      }),
    ).toBe('INVALID_TIER_REWARD');
  });

  it('validateSectWarRewardTier reject minRank < 1', () => {
    expect(
      validateSectWarRewardTier({
        key: 'rank_1',
        minRank: 0,
        maxRank: 5,
        reward: { linhThach: 100 },
        labelI18nKey: 'sectWar.x',
        descriptionI18nKey: 'sectWar.x',
      }),
    ).toBe('INVALID_TIER_RANK');
  });

  it('validateSectWarRewardTier reject maxRank < minRank', () => {
    expect(
      validateSectWarRewardTier({
        key: 'rank_1',
        minRank: 5,
        maxRank: 2,
        reward: { linhThach: 100 },
        labelI18nKey: 'sectWar.x',
        descriptionI18nKey: 'sectWar.x',
      }),
    ).toBe('INVALID_TIER_RANK');
  });
});

describe('SectWar — sectWarActivityByKey / sectWarRewardTierForRank', () => {
  it('sectWarActivityByKey lookup đúng key', () => {
    const a = sectWarActivityByKey('dungeon_clear');
    expect(a).toBeDefined();
    expect(a!.points).toBe(10);
  });

  it('sectWarActivityByKey trả undefined cho key sai', () => {
    expect(sectWarActivityByKey('khong_ton_tai')).toBeUndefined();
  });

  it('sectWarRewardTierForRank rank 1 → tier rank_1', () => {
    const t = sectWarRewardTierForRank(1, 1000);
    expect(t).toBeDefined();
    expect(t!.key).toBe('rank_1');
  });

  it('sectWarRewardTierForRank rank 2 → tier rank_2_3', () => {
    const t = sectWarRewardTierForRank(2, 1000);
    expect(t!.key).toBe('rank_2_3');
  });

  it('sectWarRewardTierForRank rank 3 → tier rank_2_3', () => {
    const t = sectWarRewardTierForRank(3, 1000);
    expect(t!.key).toBe('rank_2_3');
  });

  it('sectWarRewardTierForRank rank 7 → tier rank_4_10', () => {
    const t = sectWarRewardTierForRank(7, 1000);
    expect(t!.key).toBe('rank_4_10');
  });

  it('sectWarRewardTierForRank rank 11 + đủ 50 personal → tier participation', () => {
    const t = sectWarRewardTierForRank(11, 50);
    expect(t!.key).toBe('participation');
  });

  it('sectWarRewardTierForRank rank 11 + ít hơn 50 personal → undefined', () => {
    expect(sectWarRewardTierForRank(11, 49)).toBeUndefined();
  });

  it('sectWarRewardTierForRank rank 0 → undefined', () => {
    expect(sectWarRewardTierForRank(0, 1000)).toBeUndefined();
  });
});

describe('SectWar — sectWarWeekKey timezone stability', () => {
  it('default tz = Asia/Ho_Chi_Minh', () => {
    expect(SECT_WAR_DEFAULT_TZ).toBe('Asia/Ho_Chi_Minh');
  });

  it('format YYYY-Www', () => {
    const key = sectWarWeekKey(new Date('2026-05-07T05:00:00Z'));
    expect(key).toMatch(/^\d{4}-W\d{2}$/);
  });

  it('stable trong cùng tuần ISO (Monday → Sunday)', () => {
    // 2026-05-04 = Monday ICT, 2026-05-10 = Sunday ICT
    const monday = sectWarWeekKey(new Date('2026-05-04T00:00:00+07:00'));
    const wednesday = sectWarWeekKey(new Date('2026-05-06T12:00:00+07:00'));
    const sunday = sectWarWeekKey(new Date('2026-05-10T23:30:00+07:00'));
    expect(monday).toBe(wednesday);
    expect(wednesday).toBe(sunday);
  });

  it('chuyển tuần khi sang Monday tuần kế', () => {
    const sundayLate = sectWarWeekKey(new Date('2026-05-10T23:59:00+07:00'));
    const mondayNew = sectWarWeekKey(new Date('2026-05-11T00:00:00+07:00'));
    expect(mondayNew).not.toBe(sundayLate);
  });

  it('Monday 00:00 ICT (Sunday 17:00 UTC) đã thuộc tuần mới', () => {
    // 2026-05-11 00:00 ICT = 2026-05-10 17:00 UTC. Tuần phải là 2026-W20.
    const key = sectWarWeekKey(new Date('2026-05-10T17:00:00Z'));
    expect(key).toBe('2026-W20');
  });

  it('Sunday 23:30 ICT (16:30 UTC) vẫn thuộc tuần cũ 2026-W19', () => {
    const key = sectWarWeekKey(new Date('2026-05-10T16:30:00Z'));
    expect(key).toBe('2026-W19');
  });

  it('cross-year boundary: tuần ISO 2026-W01 chứa 2025-12-29..2026-01-04', () => {
    // 2025-12-29 = Monday ICT → ISO week 2026-W01.
    const key = sectWarWeekKey(new Date('2025-12-29T03:00:00Z')); // 10:00 ICT Monday
    expect(key).toBe('2026-W01');
  });

  it('UTC tz cũng work (no offset)', () => {
    const key = sectWarWeekKey(new Date('2026-05-07T12:00:00Z'), 'UTC');
    expect(key).toBe('2026-W19');
  });
});

describe('SectWar — currentSectWarSeason boundaries', () => {
  it('startsAt = Monday 00:00 ICT, endsAt = Monday 00:00 ICT tuần kế', () => {
    // 2026-05-07 (Thursday ICT) → tuần 2026-W19 = 2026-05-04 Mon → 2026-05-11 Mon.
    const s = currentSectWarSeason(new Date('2026-05-07T05:00:00Z'));
    expect(s.weekKey).toBe('2026-W19');
    expect(s.startsAtIso).toBe('2026-05-03T17:00:00.000Z'); // 2026-05-04 00:00 ICT
    expect(s.endsAtIso).toBe('2026-05-10T17:00:00.000Z'); // 2026-05-11 00:00 ICT
    expect(s.timezone).toBe('Asia/Ho_Chi_Minh');
  });

  it('Monday 00:00 ICT → start = current instant, end = +7 ngày', () => {
    const s = currentSectWarSeason(new Date('2026-05-03T17:00:00Z')); // 2026-05-04 00:00 ICT
    expect(s.startsAtIso).toBe('2026-05-03T17:00:00.000Z');
    expect(s.endsAtIso).toBe('2026-05-10T17:00:00.000Z');
  });
});

describe('SectWar — startOfSectWarWeek TZ Hotfix', () => {
  it('Monday 00:00 ICT cho any timestamp trong tuần', () => {
    // 2026-05-04 = Monday ICT. Expected: 2026-05-03T17:00:00Z (= Mon 00:00 ICT).
    const expectedMondayUtc = '2026-05-03T17:00:00.000Z';
    expect(startOfSectWarWeek(new Date('2026-05-04T00:00:00+07:00')).toISOString()).toBe(
      expectedMondayUtc,
    );
    expect(startOfSectWarWeek(new Date('2026-05-06T12:00:00+07:00')).toISOString()).toBe(
      expectedMondayUtc,
    );
    expect(startOfSectWarWeek(new Date('2026-05-10T23:59:00+07:00')).toISOString()).toBe(
      expectedMondayUtc,
    );
  });

  it('chuyển tuần khi sang Monday tuần kế', () => {
    const w1 = startOfSectWarWeek(new Date('2026-05-10T23:59:00+07:00')).toISOString();
    const w2 = startOfSectWarWeek(new Date('2026-05-11T00:00:00+07:00')).toISOString();
    expect(w1).not.toBe(w2);
    expect(w2).toBe('2026-05-10T17:00:00.000Z'); // Mon 2026-05-11 00:00 ICT
  });

  it('consistency: sectWarWeekKey(startOfSectWarWeek(now)) === sectWarWeekKey(now)', () => {
    const samples = [
      new Date('2026-05-04T00:00:00+07:00'),
      new Date('2026-05-06T12:00:00+07:00'),
      new Date('2026-05-10T23:30:00+07:00'),
      new Date('2026-05-13T12:00:00Z'),
      new Date('2026-05-17T15:00:00Z'),
    ];
    for (const s of samples) {
      const key = sectWarWeekKey(s);
      const mondayKey = sectWarWeekKey(startOfSectWarWeek(s));
      expect(mondayKey).toBe(key);
    }
  });

  it('idempotent: startOfSectWarWeek(startOfSectWarWeek(now)) === startOfSectWarWeek(now)', () => {
    const now = new Date('2026-05-06T12:00:00Z');
    const m1 = startOfSectWarWeek(now);
    const m2 = startOfSectWarWeek(m1);
    expect(m2.toISOString()).toBe(m1.toISOString());
  });

  it('UTC tz cũng work', () => {
    const m = startOfSectWarWeek(new Date('2026-05-07T12:00:00Z'), 'UTC').toISOString();
    expect(m).toBe('2026-05-04T00:00:00.000Z'); // Mon 00:00 UTC
  });

  it('cross-year boundary: 2025-12-29 (Monday ICT) là start cho 2026-W01', () => {
    const m = startOfSectWarWeek(new Date('2025-12-29T03:00:00Z')).toISOString();
    expect(m).toBe('2025-12-28T17:00:00.000Z'); // Mon 2025-12-29 00:00 ICT
    expect(sectWarWeekKey(new Date(m))).toBe('2026-W01');
  });
});

describe('SectWar — sectWarTheoreticalMaxPointsPerWeek heuristic', () => {
  it('không null + reasonable upper bound (< 5000)', () => {
    const max = sectWarTheoreticalMaxPointsPerWeek();
    expect(max).toBeGreaterThan(0);
    expect(max).toBeLessThan(5000); // anti-abuse audit guard
  });
});
