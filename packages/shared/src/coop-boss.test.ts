/**
 * Phase 20.2 — Co-op Boss Party Contribution shared helpers tests.
 *
 * Cover:
 *   - `computeContributionScore` formula + clamp âm/Infinity/NaN.
 *   - `classifyContributionTier` thresholds (NONE/LOW/NORMAL/HIGH/MVP)
 *     và eligibility gate.
 *   - `computeCoopBossRewardTier` multiplier theo tier; NONE → empty;
 *     MVP có tienNgoc bonus.
 *   - `canClaimCoopBossReward` gate (RUN_NOT_FINISHED, NOT_ELIGIBLE,
 *     TIER_NONE, ALREADY_CLAIMED, ok).
 *   - `clampContributionInput` anomaly flag + negative reject + cap.
 *   - `buildCoopBossRunRefId` format deterministic.
 *   - Status / tier / claim status guards.
 */
import { describe, expect, it } from 'vitest';
import {
  COOP_BOSS_BASE_REWARD,
  COOP_BOSS_CONTRIBUTION_TIERS,
  COOP_BOSS_LIMITS,
  COOP_BOSS_REWARD_CLAIM_STATUSES,
  COOP_BOSS_STATUSES,
  COOP_BOSS_TIER_MULTIPLIERS,
  buildCoopBossRunRefId,
  canClaimCoopBossReward,
  classifyContributionTier,
  clampContributionInput,
  computeContributionScore,
  computeCoopBossRewardTier,
  isCoopBossContributionTier,
  isCoopBossRewardClaimStatus,
  isCoopBossStatus,
} from './coop-boss';

describe('coop-boss / status guards', () => {
  it('isCoopBossStatus accepts canonical values, rejects junk', () => {
    for (const s of COOP_BOSS_STATUSES) {
      expect(isCoopBossStatus(s)).toBe(true);
    }
    expect(isCoopBossStatus('lobby')).toBe(false);
    expect(isCoopBossStatus('OPEN')).toBe(false);
    expect(isCoopBossStatus(123)).toBe(false);
  });

  it('isCoopBossRewardClaimStatus accepts canonical values', () => {
    for (const s of COOP_BOSS_REWARD_CLAIM_STATUSES) {
      expect(isCoopBossRewardClaimStatus(s)).toBe(true);
    }
    expect(isCoopBossRewardClaimStatus('CLAIMED ')).toBe(false);
  });

  it('isCoopBossContributionTier accepts canonical values', () => {
    for (const t of COOP_BOSS_CONTRIBUTION_TIERS) {
      expect(isCoopBossContributionTier(t)).toBe(true);
    }
    expect(isCoopBossContributionTier('TOP')).toBe(false);
  });
});

describe('coop-boss / computeContributionScore', () => {
  it('returns 0 for all-zero input', () => {
    expect(
      computeContributionScore({
        damageDone: 0,
        supportScore: 0,
        survivalSeconds: 0,
      }),
    ).toBe(0);
  });

  it('applies 1 damage = 0.001 + 1 support = 1 + 1 survival = 0.5 floor', () => {
    // 1000 dmg = 1, 10 sup = 10, 20 sec = 10 → 21.
    expect(
      computeContributionScore({
        damageDone: 1000,
        supportScore: 10,
        survivalSeconds: 20,
      }),
    ).toBe(21);
  });

  it('accepts bigint damage', () => {
    expect(
      computeContributionScore({
        damageDone: 50_000n,
        supportScore: 0,
        survivalSeconds: 0,
      }),
    ).toBe(50);
  });

  it('clamps negative + NaN + Infinity to 0', () => {
    expect(
      computeContributionScore({
        damageDone: -100,
        supportScore: Number.NaN,
        survivalSeconds: Number.POSITIVE_INFINITY,
      }),
    ).toBe(0);
  });
});

describe('coop-boss / classifyContributionTier', () => {
  it('returns NONE when not eligible regardless of score', () => {
    expect(
      classifyContributionTier({
        contributionScore: 9_999_999,
        eligibleForReward: false,
        isMvpCandidate: true,
      }),
    ).toBe('NONE');
  });

  it('returns NONE when score < minContributionScore', () => {
    expect(
      classifyContributionTier({
        contributionScore: COOP_BOSS_LIMITS.minContributionScore - 1,
        eligibleForReward: true,
        isMvpCandidate: false,
      }),
    ).toBe('NONE');
  });

  it('returns LOW between minContributionScore and 2x', () => {
    expect(
      classifyContributionTier({
        contributionScore: COOP_BOSS_LIMITS.minContributionScore,
        eligibleForReward: true,
        isMvpCandidate: false,
      }),
    ).toBe('LOW');
  });

  it('returns NORMAL between 2x and minMvpScore', () => {
    expect(
      classifyContributionTier({
        contributionScore: COOP_BOSS_LIMITS.minContributionScore * 2,
        eligibleForReward: true,
        isMvpCandidate: false,
      }),
    ).toBe('NORMAL');
  });

  it('returns HIGH at minMvpScore without MVP candidate', () => {
    expect(
      classifyContributionTier({
        contributionScore: COOP_BOSS_LIMITS.minMvpScore,
        eligibleForReward: true,
        isMvpCandidate: false,
      }),
    ).toBe('HIGH');
  });

  it('returns MVP at minMvpScore with MVP candidate', () => {
    expect(
      classifyContributionTier({
        contributionScore: COOP_BOSS_LIMITS.minMvpScore,
        eligibleForReward: true,
        isMvpCandidate: true,
      }),
    ).toBe('MVP');
  });
});

describe('coop-boss / computeCoopBossRewardTier', () => {
  it('NONE tier returns empty payload', () => {
    expect(computeCoopBossRewardTier({ tier: 'NONE' })).toEqual({
      tier: 'NONE',
    });
  });

  it('LOW tier applies multiplier on base', () => {
    const r = computeCoopBossRewardTier({ tier: 'LOW' });
    expect(r.tier).toBe('LOW');
    expect(r.linhThach).toBe(
      Math.floor(COOP_BOSS_BASE_REWARD.linhThach * COOP_BOSS_TIER_MULTIPLIERS.LOW),
    );
  });

  it('MVP tier includes tienNgoc bonus = 1', () => {
    const r = computeCoopBossRewardTier({ tier: 'MVP' });
    expect(r.tier).toBe('MVP');
    expect(r.tienNgoc).toBe(1);
    expect(r.linhThach).toBeGreaterThan(0);
  });
});

describe('coop-boss / canClaimCoopBossReward', () => {
  it('rejects when run not CLEARED', () => {
    expect(
      canClaimCoopBossReward({
        runStatus: 'FAILED',
        eligibleForReward: true,
        rewardTier: 'LOW',
        rewardStatus: 'PENDING',
      }),
    ).toEqual({ ok: false, code: 'RUN_NOT_FINISHED' });
  });

  it('rejects when not eligible', () => {
    expect(
      canClaimCoopBossReward({
        runStatus: 'CLEARED',
        eligibleForReward: false,
        rewardTier: 'LOW',
        rewardStatus: 'PENDING',
      }),
    ).toEqual({ ok: false, code: 'NOT_ELIGIBLE' });
  });

  it('rejects when tier NONE', () => {
    expect(
      canClaimCoopBossReward({
        runStatus: 'CLEARED',
        eligibleForReward: true,
        rewardTier: 'NONE',
        rewardStatus: 'PENDING',
      }),
    ).toEqual({ ok: false, code: 'TIER_NONE' });
  });

  it('rejects when already CLAIMED', () => {
    expect(
      canClaimCoopBossReward({
        runStatus: 'CLEARED',
        eligibleForReward: true,
        rewardTier: 'NORMAL',
        rewardStatus: 'CLAIMED',
      }),
    ).toEqual({ ok: false, code: 'ALREADY_CLAIMED' });
  });

  it('returns ok when CLEARED + eligible + tier != NONE + PENDING', () => {
    expect(
      canClaimCoopBossReward({
        runStatus: 'CLEARED',
        eligibleForReward: true,
        rewardTier: 'HIGH',
        rewardStatus: 'PENDING',
      }),
    ).toEqual({ ok: true });
  });
});

describe('coop-boss / clampContributionInput', () => {
  it('passes valid input through with anomaly=false', () => {
    const out = clampContributionInput({
      damageDone: 1234,
      supportScore: 5,
      survivalSeconds: 60,
    });
    expect(out.clamped.damageDone).toBe(1234n);
    expect(out.clamped.supportScore).toBe(5);
    expect(out.clamped.survivalSeconds).toBe(60);
    expect(out.anomaly).toBe(false);
  });

  it('clamps negative damage to 0 + anomaly=true', () => {
    const out = clampContributionInput({
      damageDone: -50,
      supportScore: 0,
      survivalSeconds: 0,
    });
    expect(out.clamped.damageDone).toBe(0n);
    expect(out.anomaly).toBe(true);
  });

  it('clamps damage above maxDamagePerContribution', () => {
    const out = clampContributionInput({
      damageDone: COOP_BOSS_LIMITS.maxDamagePerContribution + 5,
      supportScore: 0,
      survivalSeconds: 0,
    });
    expect(out.clamped.damageDone).toBe(
      BigInt(COOP_BOSS_LIMITS.maxDamagePerContribution),
    );
    expect(out.anomaly).toBe(true);
  });

  it('clamps support negative + over-cap', () => {
    const out1 = clampContributionInput({
      damageDone: 0,
      supportScore: -10,
      survivalSeconds: 0,
    });
    expect(out1.clamped.supportScore).toBe(0);
    expect(out1.anomaly).toBe(true);

    const out2 = clampContributionInput({
      damageDone: 0,
      supportScore: COOP_BOSS_LIMITS.maxSupportPerContribution + 1,
      survivalSeconds: 0,
    });
    expect(out2.clamped.supportScore).toBe(
      COOP_BOSS_LIMITS.maxSupportPerContribution,
    );
    expect(out2.anomaly).toBe(true);
  });

  it('clamps survival negative + over contribution window', () => {
    const out1 = clampContributionInput({
      damageDone: 0,
      supportScore: 0,
      survivalSeconds: -1,
    });
    expect(out1.clamped.survivalSeconds).toBe(0);
    expect(out1.anomaly).toBe(true);

    const out2 = clampContributionInput({
      damageDone: 0,
      supportScore: 0,
      survivalSeconds: COOP_BOSS_LIMITS.contributionWindowSeconds + 1,
    });
    expect(out2.clamped.survivalSeconds).toBe(
      COOP_BOSS_LIMITS.contributionWindowSeconds,
    );
    expect(out2.anomaly).toBe(true);
  });

  it('treats NaN/Infinity as 0', () => {
    const out = clampContributionInput({
      damageDone: Number.NaN,
      supportScore: Number.POSITIVE_INFINITY,
      survivalSeconds: Number.NaN,
    });
    expect(out.clamped.damageDone).toBe(0n);
    expect(out.clamped.supportScore).toBe(0);
    expect(out.clamped.survivalSeconds).toBe(0);
  });

  it('accepts bigint damage above max → clamps', () => {
    const out = clampContributionInput({
      damageDone: 999_999_999_999n,
      supportScore: 0,
      survivalSeconds: 0,
    });
    expect(out.clamped.damageDone).toBe(
      BigInt(COOP_BOSS_LIMITS.maxDamagePerContribution),
    );
    expect(out.anomaly).toBe(true);
  });
});

describe('coop-boss / buildCoopBossRunRefId', () => {
  it('formats `<runId>:<characterId>`', () => {
    expect(
      buildCoopBossRunRefId({ runId: 'run_1', characterId: 'char_2' }),
    ).toBe('run_1:char_2');
  });
});
