import { describe, expect, it } from 'vitest';

import {
  applyLeechRiskDowngrade,
  buildCoopRewardDayKey,
  buildCoopRewardWeekKey,
  buildCoopWeeklyRewardRefId,
  buildWeekEndDate,
  buildWeekStartDate,
  canClaimCoopRewardWithinCap,
  canClaimCoopWeeklyReward,
  classifyCoopLeechRisk,
  classifyWeeklyRewardTier,
  computeWeeklyContributionPoints,
  computeWeeklyReward,
  COOP_LEECH_RISK_LEVELS,
  COOP_REWARD_CAP_LIMITS,
  COOP_REWARD_SOURCES,
  COOP_WEEKLY_BASE_REWARD,
  COOP_WEEKLY_REWARD_CLAIM_STATUSES,
  COOP_WEEKLY_REWARD_TIERS,
  COOP_WEEKLY_SEASON_STATUSES,
  isCoopLeechRiskLevel,
  isCoopRewardSource,
  isCoopWeeklyRewardClaimStatus,
  isCoopWeeklyRewardTier,
  isCoopWeeklySeasonStatus,
} from './coop-reward-cap';

describe('coop-reward-cap enums', () => {
  it('COOP_REWARD_SOURCES enum + guard', () => {
    expect(COOP_REWARD_SOURCES).toEqual(['COOP_BOSS', 'PARTY_DUNGEON']);
    expect(isCoopRewardSource('COOP_BOSS')).toBe(true);
    expect(isCoopRewardSource('PARTY_DUNGEON')).toBe(true);
    expect(isCoopRewardSource('UNKNOWN')).toBe(false);
    expect(isCoopRewardSource(null)).toBe(false);
  });

  it('COOP_LEECH_RISK_LEVELS enum + guard', () => {
    expect(COOP_LEECH_RISK_LEVELS).toEqual(['NONE', 'LOW', 'MEDIUM', 'HIGH']);
    expect(isCoopLeechRiskLevel('HIGH')).toBe(true);
    expect(isCoopLeechRiskLevel('LEGEND')).toBe(false);
  });

  it('COOP_WEEKLY_SEASON_STATUSES enum + guard', () => {
    expect(COOP_WEEKLY_SEASON_STATUSES).toEqual([
      'ACTIVE',
      'CLOSED',
      'SETTLED',
    ]);
    expect(isCoopWeeklySeasonStatus('ACTIVE')).toBe(true);
    expect(isCoopWeeklySeasonStatus('LOBBY')).toBe(false);
  });

  it('COOP_WEEKLY_REWARD_CLAIM_STATUSES enum + guard', () => {
    expect(COOP_WEEKLY_REWARD_CLAIM_STATUSES).toEqual([
      'PENDING',
      'CLAIMED',
      'SKIPPED',
      'FAILED',
    ]);
    expect(isCoopWeeklyRewardClaimStatus('PENDING')).toBe(true);
    expect(isCoopWeeklyRewardClaimStatus('SETTLED')).toBe(false);
  });

  it('COOP_WEEKLY_REWARD_TIERS enum + guard', () => {
    expect(COOP_WEEKLY_REWARD_TIERS).toEqual([
      'NONE',
      'BRONZE',
      'SILVER',
      'GOLD',
      'LEGEND',
    ]);
    expect(isCoopWeeklyRewardTier('LEGEND')).toBe(true);
    expect(isCoopWeeklyRewardTier('MVP')).toBe(false);
  });
});

describe('COOP_REWARD_CAP_LIMITS', () => {
  it('daily/weekly limits monotonic + positive', () => {
    expect(COOP_REWARD_CAP_LIMITS.maxBossClaimsPerDay).toBeGreaterThan(0);
    expect(COOP_REWARD_CAP_LIMITS.maxBossClaimsPerWeek).toBeGreaterThanOrEqual(
      COOP_REWARD_CAP_LIMITS.maxBossClaimsPerDay,
    );
    expect(COOP_REWARD_CAP_LIMITS.maxDungeonClaimsPerDay).toBeGreaterThan(0);
    expect(
      COOP_REWARD_CAP_LIMITS.maxDungeonClaimsPerWeek,
    ).toBeGreaterThanOrEqual(COOP_REWARD_CAP_LIMITS.maxDungeonClaimsPerDay);
  });

  it('min thresholds reasonable', () => {
    expect(COOP_REWARD_CAP_LIMITS.minContributionForReward).toBeGreaterThan(0);
    expect(
      COOP_REWARD_CAP_LIMITS.minSurvivalSecondsForReward,
    ).toBeGreaterThanOrEqual(30);
    expect(
      COOP_REWARD_CAP_LIMITS.minActionCountForReward,
    ).toBeGreaterThanOrEqual(1);
  });

  it('weekly tier ranks ascending', () => {
    const r = COOP_REWARD_CAP_LIMITS.weeklyRewardTopRanks;
    expect(r.legend).toBeLessThanOrEqual(r.gold);
    expect(r.gold).toBeLessThanOrEqual(r.silver);
  });

  it('weeklySeasonTimezone is Asia/Ho_Chi_Minh', () => {
    expect(COOP_REWARD_CAP_LIMITS.weeklySeasonTimezone).toBe(
      'Asia/Ho_Chi_Minh',
    );
  });

  it('COOP_WEEKLY_BASE_REWARD monotonic non-decreasing', () => {
    const tiers = ['NONE', 'BRONZE', 'SILVER', 'GOLD', 'LEGEND'] as const;
    for (let i = 1; i < tiers.length; i++) {
      expect(
        COOP_WEEKLY_BASE_REWARD[tiers[i]].linhThach,
      ).toBeGreaterThanOrEqual(COOP_WEEKLY_BASE_REWARD[tiers[i - 1]].linhThach);
      expect(COOP_WEEKLY_BASE_REWARD[tiers[i]].exp).toBeGreaterThanOrEqual(
        COOP_WEEKLY_BASE_REWARD[tiers[i - 1]].exp,
      );
    }
    expect(COOP_WEEKLY_BASE_REWARD.NONE.linhThach).toBe(0);
    expect(COOP_WEEKLY_BASE_REWARD.NONE.exp).toBe(0);
  });
});

describe('buildCoopRewardDayKey / buildCoopRewardWeekKey deterministic', () => {
  it('builds YYYY-MM-DD in Asia/Ho_Chi_Minh (+7) for known UTC instants', () => {
    // 2026-05-11 22:00 UTC = 2026-05-12 05:00 Asia/Ho_Chi_Minh.
    expect(buildCoopRewardDayKey(new Date('2026-05-11T22:00:00Z'))).toBe(
      '2026-05-12',
    );
    // 2026-05-12 16:00 UTC = 2026-05-12 23:00 local → still 2026-05-12.
    expect(buildCoopRewardDayKey(new Date('2026-05-12T16:00:00Z'))).toBe(
      '2026-05-12',
    );
    // 2026-05-12 17:00 UTC = 2026-05-13 00:00 local → 2026-05-13.
    expect(buildCoopRewardDayKey(new Date('2026-05-12T17:00:00Z'))).toBe(
      '2026-05-13',
    );
  });

  it('build ISO weekKey YYYY-Www for known dates', () => {
    // 2026-W01 starts Monday 2025-12-29.
    expect(buildCoopRewardWeekKey(new Date('2026-01-01T03:00:00Z'))).toBe(
      '2026-W01',
    );
    // 2026-05-11 (Monday) local → W20.
    expect(buildCoopRewardWeekKey(new Date('2026-05-11T03:00:00Z'))).toBe(
      '2026-W20',
    );
    // 2026-12-31 → W53? Per ISO, 2026 is not a 53-week year — Dec 31 falls in W53 only if Thursday in 2026. Year 2026 ends on Thursday 2026-12-31 → W53.
    expect(buildCoopRewardWeekKey(new Date('2026-12-31T03:00:00Z'))).toBe(
      '2026-W53',
    );
  });

  it('same day at 23:59 local = same dayKey', () => {
    // 2026-05-12 23:59 local = 2026-05-12 16:59 UTC.
    expect(buildCoopRewardDayKey(new Date('2026-05-12T16:59:00Z'))).toBe(
      '2026-05-12',
    );
  });

  it('buildWeekStartDate + buildWeekEndDate roundtrip', () => {
    const wk = '2026-W20';
    const start = buildWeekStartDate(wk);
    const end = buildWeekEndDate(wk);
    expect(buildCoopRewardWeekKey(start)).toBe(wk);
    expect(buildCoopRewardWeekKey(end)).toBe(wk);
    // start ~ Monday 00:00 Asia/Ho_Chi_Minh = Sunday 17:00 UTC.
    expect(start.toISOString()).toBe('2026-05-10T17:00:00.000Z');
    expect(end.getTime() - start.getTime()).toBe(7 * 24 * 60 * 60 * 1000 - 1);
  });

  it('buildWeekStartDate invalid weekKey throws', () => {
    expect(() => buildWeekStartDate('bad-key')).toThrowError(/Invalid/);
  });
});

describe('canClaimCoopRewardWithinCap', () => {
  it('ok khi dưới cả 2 cap', () => {
    expect(
      canClaimCoopRewardWithinCap({
        source: 'COOP_BOSS',
        dailyClaims: 0,
        weeklyClaims: 0,
      }),
    ).toEqual({ ok: true });
    expect(
      canClaimCoopRewardWithinCap({
        source: 'PARTY_DUNGEON',
        dailyClaims: 5,
        weeklyClaims: 20,
      }),
    ).toEqual({ ok: true });
  });

  it('reject DAILY_CAP_REACHED khi đạt cap ngày', () => {
    expect(
      canClaimCoopRewardWithinCap({
        source: 'COOP_BOSS',
        dailyClaims: COOP_REWARD_CAP_LIMITS.maxBossClaimsPerDay,
        weeklyClaims: 0,
      }),
    ).toEqual({ ok: false, code: 'DAILY_CAP_REACHED' });
  });

  it('reject WEEKLY_CAP_REACHED khi đạt cap tuần', () => {
    expect(
      canClaimCoopRewardWithinCap({
        source: 'COOP_BOSS',
        dailyClaims: 0,
        weeklyClaims: COOP_REWARD_CAP_LIMITS.maxBossClaimsPerWeek,
      }),
    ).toEqual({ ok: false, code: 'WEEKLY_CAP_REACHED' });
  });

  it('INVALID_SOURCE khi source bậy', () => {
    expect(
      canClaimCoopRewardWithinCap({
        source: 'UNKNOWN' as never,
        dailyClaims: 0,
        weeklyClaims: 0,
      }),
    ).toEqual({ ok: false, code: 'INVALID_SOURCE' });
  });

  it('PARTY_DUNGEON cap riêng với COOP_BOSS', () => {
    expect(
      canClaimCoopRewardWithinCap({
        source: 'PARTY_DUNGEON',
        dailyClaims: COOP_REWARD_CAP_LIMITS.maxBossClaimsPerDay,
        weeklyClaims: 0,
      }),
    ).toEqual({ ok: true });
  });
});

describe('classifyCoopLeechRisk', () => {
  const minContrib = COOP_REWARD_CAP_LIMITS.minContributionForReward;
  const minSurv = COOP_REWARD_CAP_LIMITS.minSurvivalSecondsForReward;
  const minAct = COOP_REWARD_CAP_LIMITS.minActionCountForReward;

  it('NONE khi tất cả ≥ ngưỡng', () => {
    expect(
      classifyCoopLeechRisk({
        contributionScore: minContrib,
        survivalSeconds: minSurv,
        actionCount: minAct,
      }),
    ).toBe('NONE');
  });

  it('LOW khi 1 chỉ số fail', () => {
    expect(
      classifyCoopLeechRisk({
        contributionScore: minContrib - 1,
        survivalSeconds: minSurv,
        actionCount: minAct,
      }),
    ).toBe('LOW');
    expect(
      classifyCoopLeechRisk({
        contributionScore: minContrib,
        survivalSeconds: minSurv - 1,
        actionCount: minAct,
      }),
    ).toBe('LOW');
    expect(
      classifyCoopLeechRisk({
        contributionScore: minContrib,
        survivalSeconds: minSurv,
        actionCount: minAct - 1,
      }),
    ).toBe('LOW');
  });

  it('MEDIUM khi 2 chỉ số fail', () => {
    expect(
      classifyCoopLeechRisk({
        contributionScore: minContrib - 1,
        survivalSeconds: minSurv - 1,
        actionCount: minAct,
      }),
    ).toBe('MEDIUM');
  });

  it('HIGH khi 3 chỉ số fail', () => {
    expect(
      classifyCoopLeechRisk({
        contributionScore: 0,
        survivalSeconds: 0,
        actionCount: 0,
      }),
    ).toBe('HIGH');
  });
});

describe('computeWeeklyContributionPoints', () => {
  it('boss-only, no MVP', () => {
    expect(
      computeWeeklyContributionPoints({
        bossContributionScore: 500,
        dungeonContributionScore: 0,
        isMvp: false,
      }),
    ).toBe(500); // 500 * 1.0
  });

  it('dungeon-only, no MVP, 0.5x', () => {
    expect(
      computeWeeklyContributionPoints({
        bossContributionScore: 0,
        dungeonContributionScore: 600,
        isMvp: false,
      }),
    ).toBe(300); // 600 * 0.5
  });

  it('mvp bonus +25% on boss part', () => {
    expect(
      computeWeeklyContributionPoints({
        bossContributionScore: 400,
        dungeonContributionScore: 200,
        isMvp: true,
      }),
    ).toBe(600); // 400 + 100 (mvp) + 100 (dungeon * 0.5)
  });

  it('result is integer', () => {
    expect(
      Number.isInteger(
        computeWeeklyContributionPoints({
          bossContributionScore: 333,
          dungeonContributionScore: 111,
          isMvp: true,
        }),
      ),
    ).toBe(true);
  });
});

describe('classifyWeeklyRewardTier', () => {
  const min = COOP_REWARD_CAP_LIMITS.minPointsForRank;

  it('LEGEND for rank 1 with enough points', () => {
    expect(classifyWeeklyRewardTier({ rank: 1, totalPoints: min })).toBe(
      'LEGEND',
    );
  });

  it('GOLD for rank 2-3', () => {
    expect(classifyWeeklyRewardTier({ rank: 2, totalPoints: min })).toBe(
      'GOLD',
    );
    expect(classifyWeeklyRewardTier({ rank: 3, totalPoints: min })).toBe(
      'GOLD',
    );
  });

  it('SILVER for rank 4-10', () => {
    expect(classifyWeeklyRewardTier({ rank: 4, totalPoints: min })).toBe(
      'SILVER',
    );
    expect(classifyWeeklyRewardTier({ rank: 10, totalPoints: min })).toBe(
      'SILVER',
    );
  });

  it('BRONZE for rank > 10 with enough points', () => {
    expect(classifyWeeklyRewardTier({ rank: 50, totalPoints: min })).toBe(
      'BRONZE',
    );
  });

  it('NONE for rank null or points below minPointsForRank', () => {
    expect(classifyWeeklyRewardTier({ rank: null, totalPoints: 9999 })).toBe(
      'NONE',
    );
    expect(classifyWeeklyRewardTier({ rank: 1, totalPoints: min - 1 })).toBe(
      'NONE',
    );
  });
});

describe('computeWeeklyReward + canClaimCoopWeeklyReward', () => {
  it('computeWeeklyReward returns from COOP_WEEKLY_BASE_REWARD', () => {
    expect(computeWeeklyReward('LEGEND')).toEqual(
      COOP_WEEKLY_BASE_REWARD.LEGEND,
    );
    expect(computeWeeklyReward('NONE')).toEqual(COOP_WEEKLY_BASE_REWARD.NONE);
  });

  it('canClaimCoopWeeklyReward ok khi SETTLED + tier ≠ NONE + PENDING', () => {
    expect(
      canClaimCoopWeeklyReward({
        seasonStatus: 'SETTLED',
        rewardTier: 'GOLD',
        rewardStatus: 'PENDING',
      }),
    ).toEqual({ ok: true });
  });

  it('reject SEASON_NOT_SETTLED khi ACTIVE/CLOSED', () => {
    expect(
      canClaimCoopWeeklyReward({
        seasonStatus: 'ACTIVE',
        rewardTier: 'GOLD',
        rewardStatus: 'PENDING',
      }),
    ).toEqual({ ok: false, code: 'SEASON_NOT_SETTLED' });
    expect(
      canClaimCoopWeeklyReward({
        seasonStatus: 'CLOSED',
        rewardTier: 'GOLD',
        rewardStatus: 'PENDING',
      }),
    ).toEqual({ ok: false, code: 'SEASON_NOT_SETTLED' });
  });

  it('reject TIER_NONE', () => {
    expect(
      canClaimCoopWeeklyReward({
        seasonStatus: 'SETTLED',
        rewardTier: 'NONE',
        rewardStatus: 'PENDING',
      }),
    ).toEqual({ ok: false, code: 'TIER_NONE' });
  });

  it('reject ALREADY_CLAIMED', () => {
    expect(
      canClaimCoopWeeklyReward({
        seasonStatus: 'SETTLED',
        rewardTier: 'GOLD',
        rewardStatus: 'CLAIMED',
      }),
    ).toEqual({ ok: false, code: 'ALREADY_CLAIMED' });
  });

  it('reject SKIPPED', () => {
    expect(
      canClaimCoopWeeklyReward({
        seasonStatus: 'SETTLED',
        rewardTier: 'GOLD',
        rewardStatus: 'SKIPPED',
      }),
    ).toEqual({ ok: false, code: 'SKIPPED' });
  });

  it('buildCoopWeeklyRewardRefId stable + deterministic', () => {
    expect(
      buildCoopWeeklyRewardRefId({ seasonId: 'sea1', characterId: 'c1' }),
    ).toBe('coop-weekly:sea1:c1');
  });
});

describe('applyLeechRiskDowngrade', () => {
  it('NONE/LOW leech khong downgrade', () => {
    expect(
      applyLeechRiskDowngrade({ tier: 'HIGH', leechRisk: 'NONE' }),
    ).toBe('HIGH');
    expect(applyLeechRiskDowngrade({ tier: 'MVP', leechRisk: 'LOW' })).toBe(
      'MVP',
    );
  });

  it('MEDIUM leech downgrade 1 bậc', () => {
    expect(
      applyLeechRiskDowngrade({ tier: 'MVP', leechRisk: 'MEDIUM' }),
    ).toBe('HIGH');
    expect(
      applyLeechRiskDowngrade({ tier: 'HIGH', leechRisk: 'MEDIUM' }),
    ).toBe('NORMAL');
    expect(
      applyLeechRiskDowngrade({ tier: 'NORMAL', leechRisk: 'MEDIUM' }),
    ).toBe('LOW');
    expect(
      applyLeechRiskDowngrade({ tier: 'LOW', leechRisk: 'MEDIUM' }),
    ).toBe('LOW');
  });

  it('HIGH leech về LOW', () => {
    expect(applyLeechRiskDowngrade({ tier: 'MVP', leechRisk: 'HIGH' })).toBe(
      'LOW',
    );
    expect(applyLeechRiskDowngrade({ tier: 'HIGH', leechRisk: 'HIGH' })).toBe(
      'LOW',
    );
    expect(
      applyLeechRiskDowngrade({ tier: 'NORMAL', leechRisk: 'HIGH' }),
    ).toBe('LOW');
    expect(applyLeechRiskDowngrade({ tier: 'LOW', leechRisk: 'HIGH' })).toBe(
      'LOW',
    );
    expect(applyLeechRiskDowngrade({ tier: 'NONE', leechRisk: 'HIGH' })).toBe(
      'NONE',
    );
  });
});
