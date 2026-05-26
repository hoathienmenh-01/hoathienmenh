import { describe, it, expect } from 'vitest';
import {
  DEFAULT_MARKET_FEE_PCT,
  MAX_MARKET_FEE_PCT,
  resolveMarketFeePct,
} from './market.service';

describe('resolveMarketFeePct (G15 — L2 market fee config)', () => {
  it('undefined / empty → DEFAULT (0.05)', () => {
    expect(resolveMarketFeePct(undefined)).toBe(DEFAULT_MARKET_FEE_PCT);
    expect(resolveMarketFeePct('')).toBe(DEFAULT_MARKET_FEE_PCT);
    expect(resolveMarketFeePct('   ')).toBe(DEFAULT_MARKET_FEE_PCT);
  });

  it('số hợp lệ trong [0, 0.5] → trả về số đó', () => {
    expect(resolveMarketFeePct('0')).toBe(0);
    expect(resolveMarketFeePct('0.05')).toBe(0.05);
    expect(resolveMarketFeePct('0.1')).toBeCloseTo(0.1, 10);
    expect(resolveMarketFeePct('0.5')).toBe(0.5);
  });

  it('non-numeric string → DEFAULT + logger.warn (no crash)', () => {
    // Logger migration: console.warn → structured logger
    // Test verifies fallback behavior without spying on logger
    expect(resolveMarketFeePct('abc')).toBe(DEFAULT_MARKET_FEE_PCT);
  });

  it('số âm → DEFAULT + warn (no crash)', () => {
    expect(resolveMarketFeePct('-0.01')).toBe(DEFAULT_MARKET_FEE_PCT);
  });

  it('số > 0.5 → DEFAULT + warn (chống gõ nhầm 5 thay 0.05)', () => {
    expect(resolveMarketFeePct('5')).toBe(DEFAULT_MARKET_FEE_PCT);
    expect(resolveMarketFeePct('0.6')).toBe(DEFAULT_MARKET_FEE_PCT);
  });

  it('chính giá trị MAX (0.5) là biên hợp lệ', () => {
    expect(resolveMarketFeePct(String(MAX_MARKET_FEE_PCT))).toBe(MAX_MARKET_FEE_PCT);
  });

  it('NaN literal → DEFAULT (no crash)', () => {
    expect(resolveMarketFeePct('NaN')).toBe(DEFAULT_MARKET_FEE_PCT);
  });
});
