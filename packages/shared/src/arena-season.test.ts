/**
 * Phase 14.1.C — Arena Season + ELO + Reward (shared) tests.
 *
 * Cover pure helpers: ELO determinism, tier mapping, reward table,
 * season key cadence, validation guards.
 */
import { describe, it, expect } from 'vitest';
import {
  ARENA_ELO_CONFIG,
  ARENA_SEASON_CADENCE,
  ARENA_SEASON_CONFIG,
  ARENA_SEASON_REWARD_TABLE,
  ARENA_SEASON_TIERS,
  ARENA_SEASON_TIER_TABLE,
  arenaCurrentSeasonKey,
  arenaEloApply,
  arenaEloExpected,
  arenaEloRatingDelta,
  arenaEloScoreAttacker,
  arenaSeasonKeyForWeek,
  arenaSeasonRewardFor,
  arenaSeasonTierDef,
  arenaSeasonTierFor,
  isArenaSeasonRewardValid,
  isArenaSeasonErrorCode,
  type ArenaSeasonReward,
} from './arena-season';
import { ITEMS } from './items';

describe('arena-season config', () => {
  it('is weekly Asia/Ho_Chi_Minh', () => {
    expect(ARENA_SEASON_CADENCE).toBe('weekly');
    expect(ARENA_SEASON_CONFIG.cadence).toBe('weekly');
    expect(ARENA_SEASON_CONFIG.timezone).toBe('Asia/Ho_Chi_Minh');
  });

  it('elo defaults align with Phase 14.1.B', () => {
    expect(ARENA_ELO_CONFIG.defaultRating).toBe(1000);
    expect(ARENA_ELO_CONFIG.minRating).toBe(0);
    expect(ARENA_ELO_CONFIG.kFactor).toBe(32);
    expect(ARENA_ELO_CONFIG.base).toBe(400);
    expect(ARENA_ELO_CONFIG.defenderScale).toBe(0.6);
  });
});

describe('arena-season ELO helpers', () => {
  it('expected score is 0.5 when ratings equal', () => {
    expect(arenaEloExpected(1000, 1000)).toBe(0.5);
  });

  it('expected score is monotonic in attacker advantage', () => {
    const lo = arenaEloExpected(1000, 1200);
    const eq = arenaEloExpected(1000, 1000);
    const hi = arenaEloExpected(1200, 1000);
    expect(lo).toBeLessThan(eq);
    expect(eq).toBeLessThan(hi);
  });

  it('attacker score: WIN=1, LOSE=0, DRAW=0.5', () => {
    expect(arenaEloScoreAttacker('ATTACKER_WIN')).toBe(1);
    expect(arenaEloScoreAttacker('DEFENDER_WIN')).toBe(0);
    expect(arenaEloScoreAttacker('DRAW')).toBe(0.5);
  });

  it('rating delta is deterministic for fixed inputs', () => {
    const a = arenaEloRatingDelta(1000, 1000, 'ATTACKER_WIN');
    const b = arenaEloRatingDelta(1000, 1000, 'ATTACKER_WIN');
    expect(a).toEqual(b);
  });

  it('win at equal rating gains positive attacker delta and negative defender delta', () => {
    const d = arenaEloRatingDelta(1000, 1000, 'ATTACKER_WIN');
    expect(d.attacker).toBeGreaterThan(0);
    expect(d.defender).toBeLessThan(0);
    // K=32, ea=0.5 → raw=16. Round to 16 attacker.
    expect(d.attacker).toBe(16);
    // Defender side = 32*0.6*(0.5-1) = -9.6 → round -10.
    expect(d.defender).toBe(-10);
  });

  it('loss at equal rating mirrors win: negative attacker, positive defender', () => {
    const d = arenaEloRatingDelta(1000, 1000, 'DEFENDER_WIN');
    expect(d.attacker).toBe(-16);
    expect(d.defender).toBe(10);
  });

  it('draw at equal rating yields zero deltas', () => {
    const d = arenaEloRatingDelta(1000, 1000, 'DRAW');
    expect(d.attacker).toBe(0);
    expect(d.defender).toBe(0);
  });

  it('upset (low beats high) gains MORE than expected win', () => {
    const upset = arenaEloRatingDelta(800, 1200, 'ATTACKER_WIN');
    const fav = arenaEloRatingDelta(1200, 800, 'ATTACKER_WIN');
    expect(upset.attacker).toBeGreaterThan(fav.attacker);
  });

  it('apply clamps below floor', () => {
    expect(arenaEloApply(5, -100)).toBe(0);
  });

  it('apply clamps above ceiling', () => {
    expect(arenaEloApply(4990, 100)).toBe(5000);
  });

  it('apply rounds to integer', () => {
    const v = arenaEloApply(1000, 0.5);
    expect(Number.isInteger(v)).toBe(true);
  });

  it('rating never goes negative even with extreme losses', () => {
    let rating = 100;
    for (let i = 0; i < 50; i++) {
      const d = arenaEloRatingDelta(rating, 2400, 'DEFENDER_WIN');
      rating = arenaEloApply(rating, d.attacker);
    }
    expect(rating).toBeGreaterThanOrEqual(0);
  });
});

describe('arena-season tier mapping', () => {
  it('tier table covers all 5 tiers', () => {
    expect(ARENA_SEASON_TIER_TABLE).toHaveLength(5);
    expect(ARENA_SEASON_TIERS).toEqual([
      'BRONZE',
      'SILVER',
      'GOLD',
      'DIAMOND',
      'IMMORTAL',
    ]);
  });

  it('rating maps to expected tiers', () => {
    expect(arenaSeasonTierFor(0)).toBe('BRONZE');
    expect(arenaSeasonTierFor(999)).toBe('BRONZE');
    expect(arenaSeasonTierFor(1000)).toBe('SILVER');
    expect(arenaSeasonTierFor(1199)).toBe('SILVER');
    expect(arenaSeasonTierFor(1200)).toBe('GOLD');
    expect(arenaSeasonTierFor(1499)).toBe('GOLD');
    expect(arenaSeasonTierFor(1500)).toBe('DIAMOND');
    expect(arenaSeasonTierFor(1799)).toBe('DIAMOND');
    expect(arenaSeasonTierFor(1800)).toBe('IMMORTAL');
    expect(arenaSeasonTierFor(9999)).toBe('IMMORTAL');
  });

  it('tier table is contiguous + monotonic', () => {
    for (let i = 1; i < ARENA_SEASON_TIER_TABLE.length; i++) {
      const prev = ARENA_SEASON_TIER_TABLE[i - 1];
      const curr = ARENA_SEASON_TIER_TABLE[i];
      expect(curr.minRating).toBe(prev.maxRating + 1);
    }
  });

  it('arenaSeasonTierDef returns def by key', () => {
    expect(arenaSeasonTierDef('GOLD').minRating).toBe(1200);
    expect(arenaSeasonTierDef('IMMORTAL').minRating).toBe(1800);
  });
});

describe('arena-season reward table', () => {
  it('has 1 entry per tier', () => {
    expect(ARENA_SEASON_REWARD_TABLE).toHaveLength(ARENA_SEASON_TIERS.length);
    const seen = new Set(ARENA_SEASON_REWARD_TABLE.map((e) => e.tier));
    expect(seen.size).toBe(ARENA_SEASON_TIERS.length);
  });

  it('all rewards are valid (non-negative + items have positive qty)', () => {
    for (const e of ARENA_SEASON_REWARD_TABLE) {
      expect(isArenaSeasonRewardValid(e.reward)).toBe(true);
    }
  });

  it('reward itemKey exists in shared ITEMS catalog', () => {
    const itemKeys = new Set(ITEMS.map((it) => it.key));
    for (const e of ARENA_SEASON_REWARD_TABLE) {
      for (const it of e.reward.items) {
        expect(itemKeys.has(it.itemKey)).toBe(true);
      }
    }
  });

  it('reward LT scale stays under 5000 (economy-safe)', () => {
    for (const e of ARENA_SEASON_REWARD_TABLE) {
      expect(e.reward.linhThach).toBeLessThanOrEqual(5000);
      expect(e.reward.tienNgoc).toBeLessThanOrEqual(50);
    }
  });

  it('reward magnitude monotonic non-decreasing by tier', () => {
    let prevLT = -1;
    for (const tier of ARENA_SEASON_TIERS) {
      const r = arenaSeasonRewardFor(tier);
      expect(r.linhThach).toBeGreaterThanOrEqual(prevLT);
      prevLT = r.linhThach;
    }
  });

  it('isArenaSeasonRewardValid rejects bad shapes', () => {
    const bad: ArenaSeasonReward = {
      linhThach: -1,
      tienNgoc: 0,
      exp: 0,
      items: [],
    };
    expect(isArenaSeasonRewardValid(bad)).toBe(false);
    const bad2: ArenaSeasonReward = {
      linhThach: 0,
      tienNgoc: 0,
      exp: 0,
      items: [{ itemKey: '', qty: 1 }],
    };
    expect(isArenaSeasonRewardValid(bad2)).toBe(false);
    const bad3: ArenaSeasonReward = {
      linhThach: 0,
      tienNgoc: 0,
      exp: 0,
      items: [{ itemKey: 'foo', qty: 0 }],
    };
    expect(isArenaSeasonRewardValid(bad3)).toBe(false);
  });
});

describe('arena-season key + cadence', () => {
  it('arenaSeasonKeyForWeek prefixes ISO week', () => {
    expect(arenaSeasonKeyForWeek('2026-W19')).toBe('arena_2026-W19');
  });

  it('arenaCurrentSeasonKey is stable within same ICT week', () => {
    const monday = new Date('2026-05-04T01:00:00+07:00');
    const sunday = new Date('2026-05-10T22:00:00+07:00');
    expect(arenaCurrentSeasonKey(monday)).toBe(arenaCurrentSeasonKey(sunday));
  });

  it('arenaCurrentSeasonKey advances at next ICT Monday', () => {
    const sunday = new Date('2026-05-10T22:00:00+07:00');
    const nextMonday = new Date('2026-05-11T01:00:00+07:00');
    expect(arenaCurrentSeasonKey(sunday)).not.toBe(arenaCurrentSeasonKey(nextMonday));
  });
});

describe('arena-season error codes', () => {
  it('isArenaSeasonErrorCode identifies known codes', () => {
    expect(isArenaSeasonErrorCode('NO_CHARACTER')).toBe(true);
    expect(isArenaSeasonErrorCode('SEASON_ALREADY_SETTLED')).toBe(true);
    expect(isArenaSeasonErrorCode('FOO')).toBe(false);
    expect(isArenaSeasonErrorCode(0)).toBe(false);
  });
});
