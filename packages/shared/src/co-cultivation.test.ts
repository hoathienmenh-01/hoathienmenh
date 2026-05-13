import { describe, expect, it } from 'vitest';
import {
  CO_CULTIVATION_LIMITS,
  clampBuffPercent,
  clampDurationSec,
  computeCoCultivationBonusExp,
  isCoCultivationStatus,
  sanitizePartnerUserId,
} from './co-cultivation';

describe('co-cultivation shared catalog', () => {
  it('clampBuffPercent within [MIN, MAX]', () => {
    expect(clampBuffPercent(0)).toBe(CO_CULTIVATION_LIMITS.BUFF_PERCENT_MIN);
    expect(clampBuffPercent(99)).toBe(CO_CULTIVATION_LIMITS.BUFF_PERCENT_MAX);
    expect(clampBuffPercent(3)).toBe(3);
    expect(clampBuffPercent(Number.NaN)).toBe(
      CO_CULTIVATION_LIMITS.BUFF_PERCENT_DEFAULT,
    );
  });

  it('clampDurationSec within [MIN, MAX]', () => {
    expect(clampDurationSec(10)).toBe(CO_CULTIVATION_LIMITS.MIN_DURATION_SEC);
    expect(clampDurationSec(99999)).toBe(
      CO_CULTIVATION_LIMITS.MAX_DURATION_SEC,
    );
    expect(clampDurationSec(600)).toBe(600);
    expect(clampDurationSec(Number.NaN)).toBe(
      CO_CULTIVATION_LIMITS.DEFAULT_DURATION_SEC,
    );
  });

  it('computeCoCultivationBonusExp deterministic + non-negative', () => {
    // 600s / 30s = 20 ticks. baseRate = 5. 5 × 3% × 20 = 3 (round).
    expect(computeCoCultivationBonusExp(600, 3)).toBe(3);
    // 1800s / 30s = 60 ticks. baseRate = 5. 5 × 5% × 60 = 15.
    expect(computeCoCultivationBonusExp(1800, 5)).toBe(15);
    // Negative duration → 0.
    expect(computeCoCultivationBonusExp(-100, 5)).toBe(0);
    // Below tickSec → 0 ticks.
    expect(computeCoCultivationBonusExp(10, 5)).toBe(0);
  });

  it('isCoCultivationStatus accepts known statuses only', () => {
    expect(isCoCultivationStatus('ACTIVE')).toBe(true);
    expect(isCoCultivationStatus('COMPLETED')).toBe(true);
    expect(isCoCultivationStatus('unknown')).toBe(false);
    expect(isCoCultivationStatus(null)).toBe(false);
  });

  it('sanitizePartnerUserId rejects empty/space/long', () => {
    expect(sanitizePartnerUserId('user-abc')).toBe('user-abc');
    expect(sanitizePartnerUserId('  user-abc  ')).toBe('user-abc');
    expect(sanitizePartnerUserId('')).toBeNull();
    expect(sanitizePartnerUserId('with space')).toBeNull();
    expect(sanitizePartnerUserId('x'.repeat(65))).toBeNull();
    expect(sanitizePartnerUserId(123)).toBeNull();
  });
});
