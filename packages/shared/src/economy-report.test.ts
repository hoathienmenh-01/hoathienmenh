import { describe, expect, it } from 'vitest';
import {
  ECONOMY_REPORT_DEFAULT_RANGE_DAYS,
  ECONOMY_REPORT_MAX_RANGE_DAYS,
  ECONOMY_REPORT_SOURCES,
  LEDGER_REASON_TO_SOURCE,
  isEconomyReportSource,
  parseEconomyReportRange,
  reasonToReportSource,
} from './economy-report';

describe('reasonToReportSource', () => {
  it('known reason → mapped bucket', () => {
    expect(reasonToReportSource('MARKET_BUY')).toBe('MARKET');
    expect(reasonToReportSource('MARKET_SELL')).toBe('MARKET');
    expect(reasonToReportSource('SHOP_BUY')).toBe('SHOP');
    expect(reasonToReportSource('SECT_SHOP_BUY')).toBe('SECT_SHOP');
    expect(reasonToReportSource('EQUIPMENT_REFORGE')).toBe('REFORGE_ENCHANT');
    expect(reasonToReportSource('EQUIPMENT_ENCHANT_COST')).toBe(
      'REFORGE_ENCHANT',
    );
    expect(reasonToReportSource('ADMIN_GRANT')).toBe('ADMIN_GRANT');
    expect(reasonToReportSource('ADMIN_TOPUP_APPROVE')).toBe('TOPUP');
    expect(reasonToReportSource('DAILY_LOGIN')).toBe('DAILY_LOGIN');
    expect(reasonToReportSource('DUNGEON_RUN_REWARD')).toBe('DUNGEON_REWARD');
    expect(reasonToReportSource('BOSS_REWARD')).toBe('BOSS_REWARD');
    expect(reasonToReportSource('SECT_SEASON_REWARD')).toBe(
      'SECT_SEASON_REWARD',
    );
    expect(reasonToReportSource('LIVEOPS_FESTIVAL_GIFT_REWARD')).toBe(
      'LIVEOPS_REWARD',
    );
    expect(reasonToReportSource('MISSION_CLAIM')).toBe('MISSION_REWARD');
    expect(reasonToReportSource('QUEST_CLAIM')).toBe('QUEST_REWARD');
  });

  it('unknown reason → OTHER (fail-soft, never throws)', () => {
    expect(reasonToReportSource('UNKNOWN_NEW_REASON')).toBe('OTHER');
    expect(reasonToReportSource('')).toBe('OTHER');
    expect(reasonToReportSource('lowercase_invalid')).toBe('OTHER');
  });

  it('LEDGER_REASON_TO_SOURCE values are all valid EconomyReportSource', () => {
    for (const v of Object.values(LEDGER_REASON_TO_SOURCE)) {
      expect(isEconomyReportSource(v)).toBe(true);
    }
  });
});

describe('isEconomyReportSource', () => {
  it('valid sources pass', () => {
    for (const s of ECONOMY_REPORT_SOURCES) {
      expect(isEconomyReportSource(s)).toBe(true);
    }
  });

  it('invalid values reject', () => {
    expect(isEconomyReportSource('NOT_A_SOURCE')).toBe(false);
    expect(isEconomyReportSource('')).toBe(false);
    expect(isEconomyReportSource(123)).toBe(false);
    expect(isEconomyReportSource(null)).toBe(false);
    expect(isEconomyReportSource(undefined)).toBe(false);
  });
});

describe('parseEconomyReportRange', () => {
  const NOW = new Date('2026-05-11T05:30:00.000Z');

  it('cả 2 omitted → default last 7 days (inclusive today)', () => {
    const r = parseEconomyReportRange(undefined, undefined, NOW);
    expect(r.ok).toBe(true);
    expect(r.range?.from).toBe('2026-05-05');
    expect(r.range?.to).toBe('2026-05-11');
    expect(r.range?.days).toBe(ECONOMY_REPORT_DEFAULT_RANGE_DAYS);
  });

  it('cả 2 empty string → default 7d', () => {
    const r = parseEconomyReportRange('', '', NOW);
    expect(r.ok).toBe(true);
    expect(r.range?.days).toBe(ECONOMY_REPORT_DEFAULT_RANGE_DAYS);
  });

  it('chỉ to truyền → from = to - 6d', () => {
    const r = parseEconomyReportRange(undefined, '2026-05-10', NOW);
    expect(r.ok).toBe(true);
    expect(r.range?.from).toBe('2026-05-04');
    expect(r.range?.to).toBe('2026-05-10');
    expect(r.range?.days).toBe(7);
  });

  it('cả 2 truyền hợp lệ', () => {
    const r = parseEconomyReportRange('2026-05-01', '2026-05-07', NOW);
    expect(r.ok).toBe(true);
    expect(r.range?.from).toBe('2026-05-01');
    expect(r.range?.to).toBe('2026-05-07');
    expect(r.range?.days).toBe(7);
    // toDateExclusive = next day 00:00 UTC
    expect(r.range?.toDateExclusive.toISOString()).toBe(
      '2026-05-08T00:00:00.000Z',
    );
  });

  it('cùng ngày = 1 day', () => {
    const r = parseEconomyReportRange('2026-05-01', '2026-05-01', NOW);
    expect(r.ok).toBe(true);
    expect(r.range?.days).toBe(1);
  });

  it('from > to → FROM_AFTER_TO', () => {
    const r = parseEconomyReportRange('2026-05-10', '2026-05-01', NOW);
    expect(r.ok).toBe(false);
    expect(r.error).toBe('FROM_AFTER_TO');
  });

  it(`range vượt ${ECONOMY_REPORT_MAX_RANGE_DAYS}d → RANGE_TOO_LARGE`, () => {
    const r = parseEconomyReportRange('2026-04-01', '2026-05-10', NOW);
    expect(r.ok).toBe(false);
    expect(r.error).toBe('RANGE_TOO_LARGE');
  });

  it('exactly 31d → OK', () => {
    const r = parseEconomyReportRange('2026-04-11', '2026-05-11', NOW);
    expect(r.ok).toBe(true);
    expect(r.range?.days).toBe(ECONOMY_REPORT_MAX_RANGE_DAYS);
  });

  it('32d → RANGE_TOO_LARGE', () => {
    const r = parseEconomyReportRange('2026-04-10', '2026-05-11', NOW);
    expect(r.ok).toBe(false);
    expect(r.error).toBe('RANGE_TOO_LARGE');
  });

  it('invalid from format → INVALID_FROM', () => {
    expect(parseEconomyReportRange('not-a-date', '2026-05-11', NOW).error).toBe(
      'INVALID_FROM',
    );
    expect(parseEconomyReportRange('2026/05/01', '2026-05-11', NOW).error).toBe(
      'INVALID_FROM',
    );
    expect(parseEconomyReportRange('26-05-01', '2026-05-11', NOW).error).toBe(
      'INVALID_FROM',
    );
  });

  it('invalid to format → INVALID_TO', () => {
    expect(parseEconomyReportRange('2026-05-01', 'invalid', NOW).error).toBe(
      'INVALID_TO',
    );
  });

  it('invalid date overflow (Feb 30) → INVALID', () => {
    expect(parseEconomyReportRange('2026-02-30', '2026-05-11', NOW).error).toBe(
      'INVALID_FROM',
    );
    expect(parseEconomyReportRange('2026-05-01', '2026-13-01', NOW).error).toBe(
      'INVALID_TO',
    );
  });

  it('valid range provides UTC start/exclusive end', () => {
    const r = parseEconomyReportRange('2026-05-01', '2026-05-03', NOW);
    expect(r.ok).toBe(true);
    expect(r.range?.fromDate.toISOString()).toBe('2026-05-01T00:00:00.000Z');
    expect(r.range?.toDateExclusive.toISOString()).toBe(
      '2026-05-04T00:00:00.000Z',
    );
  });
});
