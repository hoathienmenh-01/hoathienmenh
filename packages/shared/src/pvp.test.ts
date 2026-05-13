/**
 * Phase 29.0 — PvP Foundation V1 tests.
 *
 * Pure-fn invariants:
 *   - PvpMode / Status / Result / SnapshotType guards.
 *   - validatePvpBalancePolicy rules (anti-P2W, anti-spam, anti-whaling).
 *   - validatePvpSnapshot / validatePvpDefenseProfile.
 *   - validatePvpBattleResolve (FRIENDLY_SPARRING zero-reward invariant).
 *   - computePvpPowerGap edge cases.
 *   - shouldBlockChallengeByPowerGap classification.
 *   - classifyPvpAnomaly severity bucket.
 */

import { describe, it, expect } from 'vitest';
import {
  PVP_MODES,
  PVP_BATTLE_STATUSES,
  PVP_RESULTS,
  PVP_SNAPSHOT_TYPES,
  PVP_ANOMALY_TYPES,
  PVP_ERROR_CODES,
  PVP_DEFAULT_BALANCE_POLICY,
  REWARDING_PVP_MODES,
  classifyPvpAnomaly,
  computeFriendlyMatch,
  computePvpPowerGap,
  isPvpAnomalyType,
  isPvpBattleStatus,
  isPvpErrorCode,
  isPvpMode,
  isPvpResult,
  isPvpSnapshotType,
  isRewardingPvpMode,
  shouldBlockChallengeByPowerGap,
  validatePvpBalancePolicy,
  validatePvpBattleResolve,
  validatePvpDefenseProfile,
  validatePvpSnapshot,
  type PvpBalancePolicy,
  type PvpBattleSnapshot,
  type PvpDefenseProfileDef,
} from './pvp';
import { FORBIDDEN_REWARD_ITEM_KEYS } from './monetization-systems';

describe('Phase 29.0 — PvpMode enum', () => {
  it('has 6 modes', () => {
    expect(PVP_MODES).toHaveLength(6);
  });
  it('includes DUEL / ARENA / SECT_WAR / TERRITORY_WAR / EVENT_PVP / FRIENDLY_SPARRING', () => {
    expect(PVP_MODES).toContain('DUEL');
    expect(PVP_MODES).toContain('ARENA');
    expect(PVP_MODES).toContain('SECT_WAR');
    expect(PVP_MODES).toContain('TERRITORY_WAR');
    expect(PVP_MODES).toContain('EVENT_PVP');
    expect(PVP_MODES).toContain('FRIENDLY_SPARRING');
  });
  it('isPvpMode type guard accepts valid + rejects garbage', () => {
    expect(isPvpMode('DUEL')).toBe(true);
    expect(isPvpMode('ARENA')).toBe(true);
    expect(isPvpMode('arena')).toBe(false);
    expect(isPvpMode(123)).toBe(false);
    expect(isPvpMode(null)).toBe(false);
  });
});

describe('Phase 29.0 — REWARDING_PVP_MODES excludes FRIENDLY_SPARRING', () => {
  it('5 rewarding modes', () => {
    expect(REWARDING_PVP_MODES).toHaveLength(5);
  });
  it('FRIENDLY_SPARRING never produces reward', () => {
    expect(isRewardingPvpMode('FRIENDLY_SPARRING')).toBe(false);
    expect(isRewardingPvpMode('DUEL')).toBe(true);
    expect(isRewardingPvpMode('ARENA')).toBe(true);
  });
});

describe('Phase 29.0 — PvpBattleStatus / Result / SnapshotType guards', () => {
  it('5 battle statuses', () => {
    expect(PVP_BATTLE_STATUSES).toHaveLength(5);
    expect(PVP_BATTLE_STATUSES).toContain('PENDING');
    expect(PVP_BATTLE_STATUSES).toContain('INVALIDATED');
  });
  it('4 results', () => {
    expect(PVP_RESULTS).toHaveLength(4);
    expect(PVP_RESULTS).toContain('ATTACKER_WIN');
    expect(PVP_RESULTS).toContain('DEFENDER_WIN');
    expect(PVP_RESULTS).toContain('DRAW');
    expect(PVP_RESULTS).toContain('FORFEIT');
  });
  it('4 snapshot types', () => {
    expect(PVP_SNAPSHOT_TYPES).toHaveLength(4);
  });
  it('type guards reject garbage', () => {
    expect(isPvpBattleStatus('RESOLVED')).toBe(true);
    expect(isPvpBattleStatus('resolved')).toBe(false);
    expect(isPvpResult('ATTACKER_WIN')).toBe(true);
    expect(isPvpResult(null)).toBe(false);
    expect(isPvpSnapshotType('ATTACKER')).toBe(true);
    expect(isPvpSnapshotType('attacker')).toBe(false);
  });
});

describe('Phase 29.0 — PvpAnomaly + Error codes', () => {
  it('has 8 anomaly types', () => {
    expect(PVP_ANOMALY_TYPES).toHaveLength(8);
  });
  it('has 22 error codes per spec PHẦN 19', () => {
    expect(PVP_ERROR_CODES).toHaveLength(22);
    expect(PVP_ERROR_CODES).toContain('PVP_NOT_ENABLED');
    expect(PVP_ERROR_CODES).toContain('PVP_TARGET_TOO_STRONG');
    expect(PVP_ERROR_CODES).toContain('ARENA_REWARD_ALREADY_CLAIMED');
    expect(PVP_ERROR_CODES).toContain('SECT_WAR_ROSTER_LOCKED');
    expect(PVP_ERROR_CODES).toContain('TERRITORY_PRODUCTION_ALREADY_CLAIMED');
    expect(PVP_ERROR_CODES).toContain('SEASON_REWARD_LOCKED');
  });
  it('isPvpAnomalyType / isPvpErrorCode guards', () => {
    expect(isPvpAnomalyType('PVP_POWER_JUMP_BEFORE_MATCH')).toBe(true);
    expect(isPvpAnomalyType('UNKNOWN')).toBe(false);
    expect(isPvpErrorCode('PVP_NOT_ENABLED')).toBe(true);
    expect(isPvpErrorCode('UNKNOWN')).toBe(false);
  });
});

describe('Phase 29.0 — PVP_DEFAULT_BALANCE_POLICY', () => {
  it('passes its own validator', () => {
    const issues = validatePvpBalancePolicy(PVP_DEFAULT_BALANCE_POLICY);
    expect(issues).toEqual([]);
  });
  it('paid challenge ≤ free / 4 (anti-whaling)', () => {
    expect(PVP_DEFAULT_BALANCE_POLICY.maxDailyPaidChallenge).toBeLessThanOrEqual(
      PVP_DEFAULT_BALANCE_POLICY.maxDailyChallenge / 4,
    );
  });
  it('forbidden list bao trùm monetization FORBIDDEN_REWARD_ITEM_KEYS', () => {
    for (const k of FORBIDDEN_REWARD_ITEM_KEYS) {
      expect(PVP_DEFAULT_BALANCE_POLICY.forbiddenRewardItemKeys).toContain(k);
    }
  });
  it('powerGapWarning < powerGapBlock', () => {
    expect(PVP_DEFAULT_BALANCE_POLICY.powerGapWarningThreshold).toBeLessThan(
      PVP_DEFAULT_BALANCE_POLICY.powerGapMatchBlockThreshold,
    );
  });
});

describe('Phase 29.0 — validatePvpBalancePolicy detects bad config', () => {
  function makeBadPolicy(override: Partial<PvpBalancePolicy>): PvpBalancePolicy {
    return { ...PVP_DEFAULT_BALANCE_POLICY, ...override };
  }
  it('reject maxDailyChallenge ≤ 0', () => {
    const issues = validatePvpBalancePolicy(makeBadPolicy({ maxDailyChallenge: 0 }));
    expect(issues.some((i) => i.code === 'PVP_POLICY_INVALID_CAP')).toBe(true);
  });
  it('reject paid > free/4', () => {
    const issues = validatePvpBalancePolicy(
      makeBadPolicy({ maxDailyChallenge: 8, maxDailyPaidChallenge: 4 }),
    );
    expect(issues.some((i) => i.code === 'PVP_POLICY_PAID_OVER_FREE')).toBe(true);
  });
  it('reject cooldown < 5min', () => {
    const issues = validatePvpBalancePolicy(
      makeBadPolicy({ sameTargetCooldownMinutes: 2 }),
    );
    expect(issues.some((i) => i.code === 'PVP_POLICY_COOLDOWN_TOO_LOW')).toBe(true);
  });
  it('reject tier delta > 1', () => {
    const issues = validatePvpBalancePolicy(
      makeBadPolicy({ maxSeasonRewardTierDelta: 2 }),
    );
    expect(issues.some((i) => i.code === 'PVP_POLICY_TIER_DELTA_RANGE')).toBe(true);
  });
  it('reject forbidden list không bao trùm monetization', () => {
    const issues = validatePvpBalancePolicy(
      makeBadPolicy({ forbiddenRewardItemKeys: [] }),
    );
    expect(issues.some((i) => i.code === 'PVP_POLICY_FORBIDDEN_LIST_INCOMPLETE')).toBe(
      true,
    );
  });
  it('reject powerGapWarning ≥ powerGapBlock', () => {
    const issues = validatePvpBalancePolicy(
      makeBadPolicy({
        powerGapWarningThreshold: 3.0,
        powerGapMatchBlockThreshold: 3.0,
      }),
    );
    expect(issues.some((i) => i.code === 'PVP_POLICY_POWERGAP_INVALID')).toBe(true);
  });
});

describe('Phase 29.0 — validatePvpSnapshot', () => {
  function goodSnap(): PvpBattleSnapshot {
    return {
      characterId: 42,
      realmOrder: 5,
      totalPower: 12345,
      snapshotType: 'ATTACKER',
      createdAt: new Date().toISOString(),
    };
  }
  it('accepts valid snapshot', () => {
    expect(validatePvpSnapshot(goodSnap())).toEqual([]);
  });
  it('rejects invalid characterId', () => {
    const issues = validatePvpSnapshot({ ...goodSnap(), characterId: 0 });
    expect(issues.some((i) => i.code === 'PVP_SNAPSHOT_INVALID_CHARACTER')).toBe(true);
  });
  it('rejects negative power', () => {
    const issues = validatePvpSnapshot({ ...goodSnap(), totalPower: -1 });
    expect(issues.some((i) => i.code === 'PVP_SNAPSHOT_INVALID_POWER')).toBe(true);
  });
  it('rejects bad createdAt', () => {
    const issues = validatePvpSnapshot({ ...goodSnap(), createdAt: 'not-iso' });
    expect(issues.some((i) => i.code === 'PVP_SNAPSHOT_INVALID_CREATED_AT')).toBe(
      true,
    );
  });
});

describe('Phase 29.0 — validatePvpDefenseProfile', () => {
  function goodProfile(): PvpDefenseProfileDef {
    return {
      characterId: 42,
      snapshot: {
        characterId: 42,
        realmOrder: 5,
        totalPower: 12345,
        snapshotType: 'DEFENDER',
        createdAt: new Date().toISOString(),
      },
      updatedAt: new Date().toISOString(),
    };
  }
  it('accepts valid defender profile', () => {
    expect(validatePvpDefenseProfile(goodProfile())).toEqual([]);
  });
  it('rejects ATTACKER snapshot type', () => {
    const bad = goodProfile();
    bad.snapshot = { ...bad.snapshot, snapshotType: 'ATTACKER' };
    const issues = validatePvpDefenseProfile(bad);
    expect(issues.some((i) => i.code === 'PVP_DEFENSE_SNAPSHOT_NOT_DEFENDER')).toBe(
      true,
    );
  });
  it('accepts SECT_MEMBER snapshot type (for sect war defense roster)', () => {
    const sectDefender = goodProfile();
    sectDefender.snapshot = { ...sectDefender.snapshot, snapshotType: 'SECT_MEMBER' };
    const issues = validatePvpDefenseProfile(sectDefender);
    expect(
      issues.some((i) => i.code === 'PVP_DEFENSE_SNAPSHOT_NOT_DEFENDER'),
    ).toBe(false);
  });
  it('rejects label > 60 chars', () => {
    const issues = validatePvpDefenseProfile({
      ...goodProfile(),
      label: 'x'.repeat(61),
    });
    expect(issues.some((i) => i.code === 'PVP_DEFENSE_LABEL_TOO_LONG')).toBe(true);
  });
});

describe('Phase 29.0 — validatePvpBattleResolve (FRIENDLY_SPARRING reward invariant)', () => {
  it('FRIENDLY_SPARRING + rewardGranted=true → error', () => {
    const issues = validatePvpBattleResolve({
      mode: 'FRIENDLY_SPARRING',
      status: 'RESOLVED',
      result: 'ATTACKER_WIN',
      rewardGranted: true,
    });
    expect(
      issues.some((i) => i.code === 'PVP_BATTLE_FRIENDLY_REWARD_FORBIDDEN'),
    ).toBe(true);
  });
  it('FRIENDLY_SPARRING + rewardGranted=false → OK', () => {
    const issues = validatePvpBattleResolve({
      mode: 'FRIENDLY_SPARRING',
      status: 'RESOLVED',
      result: 'ATTACKER_WIN',
      rewardGranted: false,
    });
    expect(issues).toEqual([]);
  });
  it('CANCELLED status + non-FORFEIT result → error', () => {
    const issues = validatePvpBattleResolve({
      mode: 'DUEL',
      status: 'CANCELLED',
      result: 'ATTACKER_WIN',
      rewardGranted: false,
    });
    expect(
      issues.some((i) => i.code === 'PVP_BATTLE_RESULT_NOT_FORFEIT_ON_CANCEL'),
    ).toBe(true);
  });
});

describe('Phase 29.0 — computePvpPowerGap edge cases', () => {
  it('equal powers → 1.0', () => {
    expect(computePvpPowerGap(1000, 1000)).toBe(1.0);
  });
  it('attacker 2x defender → 2.0', () => {
    expect(computePvpPowerGap(2000, 1000)).toBe(2.0);
  });
  it('defender 2x attacker → 2.0 (always max/min)', () => {
    expect(computePvpPowerGap(500, 1000)).toBe(2.0);
  });
  it('zero power both → 1.0', () => {
    expect(computePvpPowerGap(0, 0)).toBe(1.0);
  });
  it('one zero → Infinity', () => {
    expect(computePvpPowerGap(1000, 0)).toBe(Infinity);
  });
  it('negative power → NaN', () => {
    expect(Number.isNaN(computePvpPowerGap(-1, 1000))).toBe(true);
  });
});

describe('Phase 29.0 — shouldBlockChallengeByPowerGap', () => {
  const policy = PVP_DEFAULT_BALANCE_POLICY;
  it('gap 1.0 → no warning, no block', () => {
    expect(shouldBlockChallengeByPowerGap(1.0, policy)).toEqual({
      blocked: false,
      warning: false,
    });
  });
  it('gap 1.5 = warning threshold → warning only', () => {
    expect(shouldBlockChallengeByPowerGap(1.5, policy)).toEqual({
      blocked: false,
      warning: true,
    });
  });
  it('gap 2.0 → warning, not blocked', () => {
    expect(shouldBlockChallengeByPowerGap(2.0, policy)).toEqual({
      blocked: false,
      warning: true,
    });
  });
  it('gap 3.0 = block threshold → blocked + warning', () => {
    expect(shouldBlockChallengeByPowerGap(3.0, policy)).toEqual({
      blocked: true,
      warning: true,
    });
  });
  it('gap NaN → blocked', () => {
    expect(shouldBlockChallengeByPowerGap(NaN, policy).blocked).toBe(true);
  });
});

describe('Phase 29.0 — computeFriendlyMatch', () => {
  it('FRIENDLY_SPARRING → zero reward + zero rating', () => {
    expect(computeFriendlyMatch('FRIENDLY_SPARRING')).toEqual({
      rewardGranted: false,
      ratingChange: 0,
    });
  });
  it('DUEL → null (no override)', () => {
    expect(computeFriendlyMatch('DUEL')).toBeNull();
  });
  it('ARENA → null (no override)', () => {
    expect(computeFriendlyMatch('ARENA')).toBeNull();
  });
});

describe('Phase 29.0 — classifyPvpAnomaly severity bucket', () => {
  it('TERRITORY_PRODUCTION_DUPLICATE_CLAIM → severity 1.0, block reward', () => {
    expect(classifyPvpAnomaly('TERRITORY_PRODUCTION_DUPLICATE_CLAIM')).toEqual({
      severity: 1.0,
      blockRewardClaim: true,
    });
  });
  it('SEASON_REWARD_DOUBLE_CLAIM → block reward', () => {
    expect(classifyPvpAnomaly('SEASON_REWARD_DOUBLE_CLAIM').blockRewardClaim).toBe(
      true,
    );
  });
  it('PVP_DAMAGE_OUTLIER → severity 0.6, no auto block (admin review only)', () => {
    expect(classifyPvpAnomaly('PVP_DAMAGE_OUTLIER')).toEqual({
      severity: 0.6,
      blockRewardClaim: false,
    });
  });
  it('ARENA_TARGET_FARMING → severity 0.9, block reward', () => {
    expect(classifyPvpAnomaly('ARENA_TARGET_FARMING').blockRewardClaim).toBe(true);
  });
});
