/**
 * Phase 14.1.B — Async Arena Foundation shared helpers tests.
 *
 * Mục tiêu:
 *   - Rating delta đúng theo outcome (3 nhánh: ATTACKER_WIN / DEFENDER_WIN /
 *     DRAW).
 *   - Clamp rating respect floor/ceiling.
 *   - Day bucket deterministic theo tz Asia/Ho_Chi_Minh.
 *   - Status enum guard.
 *   - Tier placeholder Phase 14.1.B = `'unranked'`.
 */
import { describe, expect, it } from 'vitest';
import {
  ARENA_DAILY_LIMIT_DEFAULT,
  ARENA_MATCH_OUTCOMES,
  ARENA_MATCH_STATUSES,
  ARENA_RANK_TIERS,
  ARENA_RATING_CEILING,
  ARENA_RATING_DEFAULT,
  ARENA_RATING_DRAW_DELTA,
  ARENA_RATING_FLOOR,
  ARENA_RATING_LOSE_DELTA,
  ARENA_RATING_WIN_DELTA,
  arenaDayBucket,
  arenaRankTierFor,
  arenaRatingDeltaFor,
  clampArenaRating,
  isArenaErrorCode,
  isArenaMatchStatus,
} from './arena';

describe('arena rating delta', () => {
  it('ATTACKER_WIN → attacker +10, defender -3', () => {
    const d = arenaRatingDeltaFor('ATTACKER_WIN');
    expect(d.attacker).toBe(ARENA_RATING_WIN_DELTA);
    expect(d.attacker).toBe(10);
    expect(d.defender).toBe(-3);
  });

  it('DEFENDER_WIN → attacker -5, defender +5', () => {
    const d = arenaRatingDeltaFor('DEFENDER_WIN');
    expect(d.attacker).toBe(ARENA_RATING_LOSE_DELTA);
    expect(d.attacker).toBe(-5);
    expect(d.defender).toBe(5);
  });

  it('DRAW → 0/0', () => {
    const d = arenaRatingDeltaFor('DRAW');
    expect(d.attacker).toBe(ARENA_RATING_DRAW_DELTA);
    expect(d.attacker).toBe(0);
    expect(d.defender).toBe(0);
  });
});

describe('arena clamp rating', () => {
  it('clamps below floor → floor', () => {
    expect(clampArenaRating(-100)).toBe(ARENA_RATING_FLOOR);
    expect(clampArenaRating(0)).toBe(ARENA_RATING_FLOOR);
  });

  it('clamps above ceiling → ceiling', () => {
    expect(clampArenaRating(99999)).toBe(ARENA_RATING_CEILING);
  });

  it('rounds finite values', () => {
    expect(clampArenaRating(1234.6)).toBe(1235);
    expect(clampArenaRating(1234.4)).toBe(1234);
  });

  it('non-finite → default', () => {
    expect(clampArenaRating(Number.NaN)).toBe(ARENA_RATING_DEFAULT);
    expect(clampArenaRating(Infinity)).toBe(ARENA_RATING_DEFAULT);
  });
});

describe('arena day bucket', () => {
  it('returns YYYY-MM-DD for Asia/Ho_Chi_Minh', () => {
    // 2026-01-15T15:00:00Z = 2026-01-15 22:00 ICT (still 15th).
    const day = arenaDayBucket(new Date('2026-01-15T15:00:00Z'));
    expect(day).toBe('2026-01-15');
  });

  it('crosses ICT day boundary correctly', () => {
    // 2026-01-15T17:30:00Z = 2026-01-16 00:30 ICT (next day).
    const day = arenaDayBucket(new Date('2026-01-15T17:30:00Z'));
    expect(day).toBe('2026-01-16');
  });

  it('default tz matches config', () => {
    expect(ARENA_DAILY_LIMIT_DEFAULT.tz).toBe('Asia/Ho_Chi_Minh');
    expect(ARENA_DAILY_LIMIT_DEFAULT.maxAttacksPerDay).toBeGreaterThan(0);
  });

  it('explicit UTC tz produces UTC date', () => {
    const day = arenaDayBucket(new Date('2026-01-15T17:30:00Z'), 'UTC');
    expect(day).toBe('2026-01-15');
  });
});

describe('arena enum guards', () => {
  it('isArenaMatchStatus accepts known statuses', () => {
    for (const s of ARENA_MATCH_STATUSES) {
      expect(isArenaMatchStatus(s)).toBe(true);
    }
    expect(isArenaMatchStatus('UNKNOWN')).toBe(false);
    expect(isArenaMatchStatus(null)).toBe(false);
  });

  it('isArenaErrorCode accepts known codes', () => {
    expect(isArenaErrorCode('CANNOT_ATTACK_SELF')).toBe(true);
    expect(isArenaErrorCode('UNAUTHENTICATED')).toBe(true);
    expect(isArenaErrorCode('FOO')).toBe(false);
  });

  it('outcome / status enums non-empty', () => {
    expect(ARENA_MATCH_OUTCOMES.length).toBe(3);
    expect(ARENA_MATCH_STATUSES.length).toBe(3);
  });
});

describe('arena rank tier placeholder Phase 14.1.B', () => {
  it('returns unranked for any rating', () => {
    expect(arenaRankTierFor(0)).toBe('unranked');
    expect(arenaRankTierFor(1000)).toBe('unranked');
    expect(arenaRankTierFor(5000)).toBe('unranked');
  });

  it('exposes 5 tier slots reserved for 14.1.C', () => {
    expect(ARENA_RANK_TIERS.length).toBe(5);
    expect(ARENA_RANK_TIERS).toContain('unranked');
  });
});
