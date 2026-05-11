import { describe, it, expect } from 'vitest';
import {
  GAMEPLAY_ANOMALY_RULES,
  GAMEPLAY_ANOMALY_SEVERITIES,
  GAMEPLAY_ANOMALY_SOURCES,
  GAMEPLAY_ANOMALY_STATUSES,
  GAMEPLAY_ANOMALY_TYPES,
  buildGameplayAnomalyWindowKey,
  classifyCurrencyGainSpike,
  classifyExpGainSpike,
  classifyGameplaySeverity,
  classifyItemGainSpike,
  classifyRewardFarmPattern,
  coerceGameplayAnomalySource,
  compareGameplaySeverity,
  getGameplayAnomalyRule,
  isGameplayAnomalySeverity,
  isGameplayAnomalySource,
  isGameplayAnomalyStatus,
  isGameplayAnomalyType,
} from './gameplay-anticheat';

describe('Phase 16.3 — gameplay anticheat catalog', () => {
  it('type/severity/status/source enum không trùng key', () => {
    expect(new Set(GAMEPLAY_ANOMALY_TYPES).size).toBe(
      GAMEPLAY_ANOMALY_TYPES.length,
    );
    expect(new Set(GAMEPLAY_ANOMALY_SEVERITIES).size).toBe(
      GAMEPLAY_ANOMALY_SEVERITIES.length,
    );
    expect(new Set(GAMEPLAY_ANOMALY_STATUSES).size).toBe(
      GAMEPLAY_ANOMALY_STATUSES.length,
    );
    expect(new Set(GAMEPLAY_ANOMALY_SOURCES).size).toBe(
      GAMEPLAY_ANOMALY_SOURCES.length,
    );
  });

  it('có rule cho mọi type', () => {
    const ruleTypes = new Set(GAMEPLAY_ANOMALY_RULES.map((r) => r.type));
    for (const t of GAMEPLAY_ANOMALY_TYPES) {
      expect(ruleTypes.has(t)).toBe(true);
    }
    expect(GAMEPLAY_ANOMALY_RULES.length).toBe(GAMEPLAY_ANOMALY_TYPES.length);
  });

  it('threshold positive + critical >= warn + window positive cho mọi rule', () => {
    for (const r of GAMEPLAY_ANOMALY_RULES) {
      expect(r.warnThreshold > 0n).toBe(true);
      expect(r.criticalThreshold >= r.warnThreshold).toBe(true);
      expect(r.windowMs > 0).toBe(true);
      expect(r.description.length).toBeGreaterThan(0);
      expect(GAMEPLAY_ANOMALY_SOURCES).toContain(r.source);
    }
  });

  it('getGameplayAnomalyRule return rule khớp type', () => {
    for (const t of GAMEPLAY_ANOMALY_TYPES) {
      const r = getGameplayAnomalyRule(t);
      expect(r.type).toBe(t);
    }
  });

  it('getGameplayAnomalyRule throw cho type không tồn tại', () => {
    expect(() =>
      getGameplayAnomalyRule('NOT_A_RULE' as never),
    ).toThrow();
  });
});

describe('Phase 16.3 — type guards & coerce', () => {
  it('isGameplayAnomalyType', () => {
    expect(isGameplayAnomalyType('EXP_GAIN_SPIKE')).toBe(true);
    expect(isGameplayAnomalyType('NON_EXISTENT')).toBe(false);
  });

  it('isGameplayAnomalySeverity', () => {
    expect(isGameplayAnomalySeverity('CRITICAL')).toBe(true);
    expect(isGameplayAnomalySeverity('SHOUT')).toBe(false);
  });

  it('isGameplayAnomalyStatus', () => {
    expect(isGameplayAnomalyStatus('OPEN')).toBe(true);
    expect(isGameplayAnomalyStatus('NEW')).toBe(false);
  });

  it('isGameplayAnomalySource', () => {
    expect(isGameplayAnomalySource('DUNGEON_RUN')).toBe(true);
    expect(isGameplayAnomalySource('UNKNOWN')).toBe(false);
  });

  it('coerceGameplayAnomalySource fail-soft cho source lạ', () => {
    expect(coerceGameplayAnomalySource('DUNGEON_RUN')).toBe('DUNGEON_RUN');
    expect(coerceGameplayAnomalySource('UNKNOWN_MODULE')).toBe('OTHER');
    expect(coerceGameplayAnomalySource(null)).toBe('OTHER');
    expect(coerceGameplayAnomalySource(undefined)).toBe('OTHER');
    expect(coerceGameplayAnomalySource('')).toBe('OTHER');
  });
});

describe('Phase 16.3 — compareGameplaySeverity', () => {
  it('rank INFO < WARN < CRITICAL', () => {
    expect(compareGameplaySeverity('INFO', 'WARN')).toBe(-1);
    expect(compareGameplaySeverity('WARN', 'CRITICAL')).toBe(-1);
    expect(compareGameplaySeverity('CRITICAL', 'INFO')).toBe(1);
    expect(compareGameplaySeverity('WARN', 'WARN')).toBe(0);
  });
});

describe('Phase 16.3 — classify helpers', () => {
  it('classifyGameplaySeverity tiers correctly', () => {
    const rule = getGameplayAnomalyRule('EXP_GAIN_SPIKE');
    expect(classifyGameplaySeverity(rule.warnThreshold - 1n, rule)).toBeNull();
    expect(classifyGameplaySeverity(rule.warnThreshold, rule)).toBe('WARN');
    expect(
      classifyGameplaySeverity(rule.criticalThreshold - 1n, rule),
    ).toBe('WARN');
    expect(classifyGameplaySeverity(rule.criticalThreshold, rule)).toBe(
      'CRITICAL',
    );
    expect(
      classifyGameplaySeverity(rule.criticalThreshold + 100n, rule),
    ).toBe('CRITICAL');
  });

  it('classifyGameplaySeverity dùng |value| cho input âm', () => {
    const rule = getGameplayAnomalyRule('CURRENCY_GAIN_SPIKE');
    expect(classifyGameplaySeverity(-rule.warnThreshold, rule)).toBe('WARN');
  });

  it('classifyExpGainSpike sugar', () => {
    expect(classifyExpGainSpike(0n)).toBeNull();
    expect(classifyExpGainSpike(50_000n)).toBe('WARN');
    expect(classifyExpGainSpike(500_000n)).toBe('CRITICAL');
  });

  it('classifyCurrencyGainSpike sugar', () => {
    expect(classifyCurrencyGainSpike(0n)).toBeNull();
    expect(classifyCurrencyGainSpike(200_000n)).toBe('WARN');
    expect(classifyCurrencyGainSpike(1_000_000n)).toBe('CRITICAL');
  });

  it('classifyItemGainSpike sugar', () => {
    expect(classifyItemGainSpike(0n)).toBeNull();
    expect(classifyItemGainSpike(100n)).toBe('WARN');
    expect(classifyItemGainSpike(500n)).toBe('CRITICAL');
  });

  it('classifyRewardFarmPattern theo type', () => {
    expect(classifyRewardFarmPattern('DUNGEON_REWARD_FARM', 20n)).toBe('WARN');
    expect(classifyRewardFarmPattern('DUNGEON_REWARD_FARM', 50n)).toBe(
      'CRITICAL',
    );
    expect(classifyRewardFarmPattern('BOSS_REWARD_FARM', 14n)).toBeNull();
    expect(classifyRewardFarmPattern('BOSS_REWARD_FARM', 15n)).toBe('WARN');
    expect(classifyRewardFarmPattern('BOSS_REWARD_FARM', 40n)).toBe('CRITICAL');
    expect(classifyRewardFarmPattern('MISSION_REWARD_FARM', 30n)).toBe('WARN');
    expect(classifyRewardFarmPattern('ARENA_REWARD_FARM', 80n)).toBe(
      'CRITICAL',
    );
    expect(classifyRewardFarmPattern('TERRITORY_REWARD_SPIKE', 10n)).toBe(
      'WARN',
    );
  });
});

describe('Phase 16.3 — buildGameplayAnomalyWindowKey', () => {
  const sampleNow = new Date(Date.UTC(2026, 4, 11, 7, 30, 0));

  it('1h window → 1h:YYYY-MM-DDTHH UTC', () => {
    expect(
      buildGameplayAnomalyWindowKey({
        type: 'EXP_GAIN_SPIKE',
        now: sampleNow,
      }),
    ).toBe('1h:2026-05-11T07');
  });

  it('24h window → 24h:YYYY-MM-DD UTC', () => {
    expect(
      buildGameplayAnomalyWindowKey({
        type: 'DUNGEON_REWARD_FARM',
        now: sampleNow,
      }),
    ).toBe('24h:2026-05-11');
  });

  it('7d window → 7d:YYYY-Www ISO week UTC', () => {
    const wkey = buildGameplayAnomalyWindowKey({
      type: 'TERRITORY_REWARD_SPIKE',
      now: sampleNow,
    });
    expect(wkey).toMatch(/^7d:\d{4}-W\d{2}$/);
  });

  it('deterministic — cùng now cùng type cùng windowKey', () => {
    const a = buildGameplayAnomalyWindowKey({
      type: 'CURRENCY_GAIN_SPIKE',
      now: sampleNow,
    });
    const b = buildGameplayAnomalyWindowKey({
      type: 'CURRENCY_GAIN_SPIKE',
      now: new Date(sampleNow.getTime()),
    });
    expect(a).toBe(b);
  });

  it('khác hour bucket khi giờ thay đổi', () => {
    const earlier = buildGameplayAnomalyWindowKey({
      type: 'EXP_GAIN_SPIKE',
      now: new Date(Date.UTC(2026, 4, 11, 7, 59, 59)),
    });
    const later = buildGameplayAnomalyWindowKey({
      type: 'EXP_GAIN_SPIKE',
      now: new Date(Date.UTC(2026, 4, 11, 8, 0, 0)),
    });
    expect(earlier).not.toBe(later);
  });

  it('windowMs override fallback → "<ms>ms:<timestampFloor>"', () => {
    const customWindowMs = 15 * 60 * 1000; // 15 phút
    const k = buildGameplayAnomalyWindowKey({
      type: 'EXP_GAIN_SPIKE',
      now: sampleNow,
      windowMs: customWindowMs,
    });
    expect(k.startsWith(`${customWindowMs}ms:`)).toBe(true);
  });
});
