/**
 * Phase 14.1.D — Arena Anti-Wintrade shared rules tests.
 *
 * Coverage:
 *   - Default rules valid + thresholds positive.
 *   - Severity / status / type guards.
 *   - severityForCount thang bậc đúng.
 *   - Helpers (windowKey, pairKey, periodKey) deterministic + đối xứng.
 *   - assertArenaAntiWintradeRulesValid bắt mọi field âm / 0.
 */
import { describe, expect, it } from 'vitest';
import {
  ARENA_ANTI_WINTRADE_RULES,
  ARENA_WINTRADE_SEVERITIES,
  ARENA_WINTRADE_STATUSES,
  ARENA_WINTRADE_TYPES,
  arenaWintradePairKey,
  arenaWintradePeriodKey,
  arenaWintradeWindowKey,
  assertArenaAntiWintradeRulesValid,
  compareArenaWintradeSeverity,
  isArenaWintradeSeverity,
  isArenaWintradeStatus,
  isArenaWintradeType,
  severityForCount,
  type ArenaAntiWintradeRules,
} from './arena-anti-wintrade';

describe('ARENA_ANTI_WINTRADE_RULES default snapshot', () => {
  it('passes assertArenaAntiWintradeRulesValid', () => {
    expect(() =>
      assertArenaAntiWintradeRulesValid(ARENA_ANTI_WINTRADE_RULES),
    ).not.toThrow();
  });

  it('every positive field > 0', () => {
    expect(ARENA_ANTI_WINTRADE_RULES.repeatedOpponentWindowHours).toBeGreaterThan(0);
    expect(ARENA_ANTI_WINTRADE_RULES.maxMatchesSameOpponentPerWindow).toBeGreaterThan(0);
    expect(ARENA_ANTI_WINTRADE_RULES.criticalRepeatedMatchesPerWindow).toBeGreaterThan(0);
    expect(ARENA_ANTI_WINTRADE_RULES.reciprocalMatchThreshold).toBeGreaterThan(0);
    expect(ARENA_ANTI_WINTRADE_RULES.criticalReciprocalMatches).toBeGreaterThan(0);
    expect(ARENA_ANTI_WINTRADE_RULES.suspiciousWinRateThreshold).toBeGreaterThan(0);
    expect(ARENA_ANTI_WINTRADE_RULES.suspiciousWinRateThreshold).toBeLessThanOrEqual(1);
    expect(ARENA_ANTI_WINTRADE_RULES.minMatchesForWinRate).toBeGreaterThan(0);
    expect(ARENA_ANTI_WINTRADE_RULES.ratingGainSpikeWindowHours).toBeGreaterThan(0);
    expect(ARENA_ANTI_WINTRADE_RULES.ratingGainSpikeThreshold).toBeGreaterThan(0);
    expect(ARENA_ANTI_WINTRADE_RULES.criticalRatingGainSpike).toBeGreaterThan(0);
    expect(ARENA_ANTI_WINTRADE_RULES.rewardFarmMatchesMin).toBeGreaterThan(0);
    expect(ARENA_ANTI_WINTRADE_RULES.rewardFarmDistinctOpponentsMin).toBeGreaterThan(0);
    expect(ARENA_ANTI_WINTRADE_RULES.seasonSuspiciousMinDistinctOpponents).toBeGreaterThan(0);
    expect(ARENA_ANTI_WINTRADE_RULES.seasonSuspiciousMinMatches).toBeGreaterThan(0);
  });

  it('critical thresholds >= warn thresholds (monotonic ladder)', () => {
    expect(
      ARENA_ANTI_WINTRADE_RULES.criticalRepeatedMatchesPerWindow,
    ).toBeGreaterThanOrEqual(
      ARENA_ANTI_WINTRADE_RULES.maxMatchesSameOpponentPerWindow,
    );
    expect(
      ARENA_ANTI_WINTRADE_RULES.criticalReciprocalMatches,
    ).toBeGreaterThanOrEqual(ARENA_ANTI_WINTRADE_RULES.reciprocalMatchThreshold);
    expect(
      ARENA_ANTI_WINTRADE_RULES.criticalRatingGainSpike,
    ).toBeGreaterThanOrEqual(ARENA_ANTI_WINTRADE_RULES.ratingGainSpikeThreshold);
  });

  it('thresholds not too sensitive (avoid false positive)', () => {
    // Player F2P chăm có thể đánh ~5-10 match/24h cùng đối thủ rotated;
    // ngưỡng quá thấp (< 3) sẽ flag legit. Đảm bảo baseline ≥ 3.
    expect(
      ARENA_ANTI_WINTRADE_RULES.maxMatchesSameOpponentPerWindow,
    ).toBeGreaterThanOrEqual(3);
    expect(
      ARENA_ANTI_WINTRADE_RULES.reciprocalMatchThreshold,
    ).toBeGreaterThanOrEqual(3);
    // Win-rate threshold > 0.9 để tránh flag người chơi giỏi.
    expect(
      ARENA_ANTI_WINTRADE_RULES.suspiciousWinRateThreshold,
    ).toBeGreaterThanOrEqual(0.9);
  });
});

describe('severities / statuses / types catalog', () => {
  it('severities are unique and INFO/WARN/CRITICAL', () => {
    expect(new Set(ARENA_WINTRADE_SEVERITIES).size).toBe(
      ARENA_WINTRADE_SEVERITIES.length,
    );
    expect([...ARENA_WINTRADE_SEVERITIES]).toEqual([
      'INFO',
      'WARN',
      'CRITICAL',
    ]);
  });

  it('statuses are unique and OPEN/ACK/RESOLVED', () => {
    expect(new Set(ARENA_WINTRADE_STATUSES).size).toBe(
      ARENA_WINTRADE_STATUSES.length,
    );
    expect([...ARENA_WINTRADE_STATUSES]).toEqual([
      'OPEN',
      'ACKNOWLEDGED',
      'RESOLVED',
    ]);
  });

  it('types are unique', () => {
    expect(new Set(ARENA_WINTRADE_TYPES).size).toBe(
      ARENA_WINTRADE_TYPES.length,
    );
  });

  it('isArenaWintradeSeverity guard', () => {
    expect(isArenaWintradeSeverity('CRITICAL')).toBe(true);
    expect(isArenaWintradeSeverity('warn')).toBe(false);
    expect(isArenaWintradeSeverity(null)).toBe(false);
  });

  it('isArenaWintradeStatus guard', () => {
    expect(isArenaWintradeStatus('OPEN')).toBe(true);
    expect(isArenaWintradeStatus('open')).toBe(false);
  });

  it('isArenaWintradeType guard', () => {
    expect(isArenaWintradeType('REPEATED_OPPONENT_PAIR')).toBe(true);
    expect(isArenaWintradeType('rEpEaTeD')).toBe(false);
    expect(isArenaWintradeType('UNKNOWN')).toBe(false);
  });
});

describe('compareArenaWintradeSeverity', () => {
  it('orders INFO < WARN < CRITICAL', () => {
    expect(compareArenaWintradeSeverity('INFO', 'WARN')).toBe(-1);
    expect(compareArenaWintradeSeverity('WARN', 'CRITICAL')).toBe(-1);
    expect(compareArenaWintradeSeverity('INFO', 'CRITICAL')).toBe(-1);
    expect(compareArenaWintradeSeverity('CRITICAL', 'WARN')).toBe(1);
    expect(compareArenaWintradeSeverity('WARN', 'WARN')).toBe(0);
  });
});

describe('severityForCount', () => {
  it('returns null when below warn', () => {
    expect(severityForCount(2, 5, 12)).toBeNull();
    expect(severityForCount(0, 1, 2)).toBeNull();
  });

  it('returns WARN at warn threshold', () => {
    expect(severityForCount(5, 5, 12)).toBe('WARN');
    expect(severityForCount(11, 5, 12)).toBe('WARN');
  });

  it('returns CRITICAL at critical threshold', () => {
    expect(severityForCount(12, 5, 12)).toBe('CRITICAL');
    expect(severityForCount(100, 5, 12)).toBe('CRITICAL');
  });
});

describe('arenaWintradeWindowKey', () => {
  it('joins type and periodKey', () => {
    expect(
      arenaWintradeWindowKey('REPEATED_OPPONENT_PAIR', '24h:2026-05-09'),
    ).toBe('REPEATED_OPPONENT_PAIR:24h:2026-05-09');
  });

  it('throws when periodKey empty', () => {
    expect(() =>
      arenaWintradeWindowKey('REPEATED_OPPONENT_PAIR', ''),
    ).toThrow();
  });
});

describe('arenaWintradePairKey', () => {
  it('is symmetric (A,B) === (B,A)', () => {
    const k1 = arenaWintradePairKey('alice', 'bob');
    const k2 = arenaWintradePairKey('bob', 'alice');
    expect(k1).toBe(k2);
  });

  it('uses sort-lex ordering', () => {
    expect(arenaWintradePairKey('zzz', 'aaa')).toBe('aaa::zzz');
  });

  it('throws on equal ids', () => {
    expect(() => arenaWintradePairKey('x', 'x')).toThrow();
  });
});

describe('arenaWintradePeriodKey', () => {
  it('returns YYYY-MM-DD bucket for hours >= 24', () => {
    const now = new Date('2026-05-09T05:30:00.000Z');
    expect(arenaWintradePeriodKey(now, 24)).toBe('24h:2026-05-09');
    expect(arenaWintradePeriodKey(now, 48)).toBe('48h:2026-05-09');
  });

  it('returns hour-block bucket for hours < 24', () => {
    const a = new Date('2026-05-09T05:00:00.000Z');
    const b = new Date('2026-05-09T05:59:00.000Z');
    const c = new Date('2026-05-09T06:00:00.000Z');
    // 6h block: 00,06,12,18 — hour 5 → 00, hour 6 → 06.
    expect(arenaWintradePeriodKey(a, 6)).toBe('6h:2026-05-09T00');
    expect(arenaWintradePeriodKey(b, 6)).toBe('6h:2026-05-09T00');
    expect(arenaWintradePeriodKey(c, 6)).toBe('6h:2026-05-09T06');
  });

  it('throws on invalid args', () => {
    expect(() => arenaWintradePeriodKey(new Date('invalid'), 24)).toThrow();
    expect(() => arenaWintradePeriodKey(new Date(), 0)).toThrow();
    expect(() => arenaWintradePeriodKey(new Date(), -1)).toThrow();
  });
});

describe('assertArenaAntiWintradeRulesValid', () => {
  it('rejects negative threshold', () => {
    const bad: ArenaAntiWintradeRules = {
      ...ARENA_ANTI_WINTRADE_RULES,
      maxMatchesSameOpponentPerWindow: -1,
    };
    expect(() => assertArenaAntiWintradeRulesValid(bad)).toThrow();
  });

  it('rejects winRate > 1', () => {
    const bad: ArenaAntiWintradeRules = {
      ...ARENA_ANTI_WINTRADE_RULES,
      suspiciousWinRateThreshold: 1.5,
    };
    expect(() => assertArenaAntiWintradeRulesValid(bad)).toThrow();
  });

  it('rejects critical < warn for repeated', () => {
    const bad: ArenaAntiWintradeRules = {
      ...ARENA_ANTI_WINTRADE_RULES,
      maxMatchesSameOpponentPerWindow: 10,
      criticalRepeatedMatchesPerWindow: 5,
    };
    expect(() => assertArenaAntiWintradeRulesValid(bad)).toThrow();
  });

  it('rejects critical < warn for rating spike', () => {
    const bad: ArenaAntiWintradeRules = {
      ...ARENA_ANTI_WINTRADE_RULES,
      ratingGainSpikeThreshold: 500,
      criticalRatingGainSpike: 100,
    };
    expect(() => assertArenaAntiWintradeRulesValid(bad)).toThrow();
  });
});
