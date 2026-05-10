import { describe, it, expect } from 'vitest';
import {
  ECONOMY_ANOMALY_RULES,
  ECONOMY_ANOMALY_SEVERITIES,
  ECONOMY_ANOMALY_SOURCES,
  ECONOMY_ISSUE_STATUSES,
  compareSeverity,
  deriveSeverityForValue,
  getEconomyAnomalyRule,
  isEconomyAnomalySeverity,
  isEconomyAnomalySource,
  isEconomyIssueStatus,
} from './economy-anomaly';

describe('Phase 16.6 — economy anomaly catalog', () => {
  it('source/severity/status enum không trùng key', () => {
    expect(new Set(ECONOMY_ANOMALY_SOURCES).size).toBe(
      ECONOMY_ANOMALY_SOURCES.length,
    );
    expect(new Set(ECONOMY_ANOMALY_SEVERITIES).size).toBe(
      ECONOMY_ANOMALY_SEVERITIES.length,
    );
    expect(new Set(ECONOMY_ISSUE_STATUSES).size).toBe(
      ECONOMY_ISSUE_STATUSES.length,
    );
  });

  it('có rule cho mọi source', () => {
    const ruleSources = new Set(ECONOMY_ANOMALY_RULES.map((r) => r.source));
    for (const s of ECONOMY_ANOMALY_SOURCES) {
      expect(ruleSources.has(s)).toBe(true);
    }
  });

  it('threshold positive + critical >= warn cho mọi rule', () => {
    for (const r of ECONOMY_ANOMALY_RULES) {
      expect(r.warnThreshold > 0n).toBe(true);
      expect(r.criticalThreshold >= r.warnThreshold).toBe(true);
      expect(r.description.length > 0).toBe(true);
    }
  });

  it('getEconomyAnomalyRule return rule khớp source', () => {
    for (const s of ECONOMY_ANOMALY_SOURCES) {
      const r = getEconomyAnomalyRule(s);
      expect(r.source).toBe(s);
    }
  });

  it('getEconomyAnomalyRule throw cho source không tồn tại', () => {
    // Sử dụng cast để vượt qua type guard (test edge case runtime).
    expect(() => getEconomyAnomalyRule('NOT_A_RULE' as never)).toThrow();
  });

  it('isEconomyAnomalySource type guard', () => {
    expect(isEconomyAnomalySource('CURRENCY_DELTA_24H')).toBe(true);
    expect(isEconomyAnomalySource('NON_EXISTENT')).toBe(false);
  });

  it('isEconomyAnomalySeverity type guard', () => {
    expect(isEconomyAnomalySeverity('CRITICAL')).toBe(true);
    expect(isEconomyAnomalySeverity('warn')).toBe(false);
  });

  it('isEconomyIssueStatus type guard', () => {
    expect(isEconomyIssueStatus('OPEN')).toBe(true);
    expect(isEconomyIssueStatus('open')).toBe(false);
  });
});

describe('compareSeverity', () => {
  it('INFO < WARN < CRITICAL', () => {
    expect(compareSeverity('INFO', 'WARN')).toBe(-1);
    expect(compareSeverity('WARN', 'CRITICAL')).toBe(-1);
    expect(compareSeverity('INFO', 'CRITICAL')).toBe(-1);
  });

  it('CRITICAL > WARN > INFO', () => {
    expect(compareSeverity('CRITICAL', 'WARN')).toBe(1);
    expect(compareSeverity('WARN', 'INFO')).toBe(1);
    expect(compareSeverity('CRITICAL', 'INFO')).toBe(1);
  });

  it('cùng severity = 0', () => {
    expect(compareSeverity('CRITICAL', 'CRITICAL')).toBe(0);
    expect(compareSeverity('WARN', 'WARN')).toBe(0);
    expect(compareSeverity('INFO', 'INFO')).toBe(0);
  });
});

describe('deriveSeverityForValue', () => {
  const rule = getEconomyAnomalyRule('CURRENCY_DELTA_24H');

  it('value < warnThreshold ⇒ null (không trigger)', () => {
    expect(deriveSeverityForValue(rule.warnThreshold - 1n, rule)).toBe(null);
    expect(deriveSeverityForValue(0n, rule)).toBe(null);
  });

  it('warn ≤ value < critical ⇒ WARN', () => {
    expect(deriveSeverityForValue(rule.warnThreshold, rule)).toBe('WARN');
    expect(
      deriveSeverityForValue(rule.criticalThreshold - 1n, rule),
    ).toBe('WARN');
  });

  it('value ≥ critical ⇒ CRITICAL', () => {
    expect(deriveSeverityForValue(rule.criticalThreshold, rule)).toBe(
      'CRITICAL',
    );
    expect(deriveSeverityForValue(rule.criticalThreshold * 2n, rule)).toBe(
      'CRITICAL',
    );
  });

  it('absolute value — âm cũng tính', () => {
    expect(deriveSeverityForValue(-rule.warnThreshold, rule)).toBe('WARN');
    expect(deriveSeverityForValue(-rule.criticalThreshold, rule)).toBe(
      'CRITICAL',
    );
  });
});
