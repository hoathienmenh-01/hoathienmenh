import { describe, expect, it } from 'vitest';
import {
  filterNavigationEntries,
  NAVIGATION_REGISTRY,
} from '@xuantoi/shared';

/**
 * Phase 41.0 — Navigation registry endpoint surface test.
 *
 * Đảm bảo:
 *   - PLAYER không thấy entry minRole >= MOD.
 *   - MOD thấy được admin entries.
 *   - Filter keyword cho command palette.
 */
describe('player-navigation — Phase 41.0', () => {
  it('PLAYER role excludes admin-only entries', () => {
    const entries = filterNavigationEntries('PLAYER', null);
    const adminKeys = entries.filter((e) => e.minRole !== 'PLAYER');
    expect(adminKeys.length).toBe(0);
  });

  it('MOD role includes admin entries', () => {
    const entries = filterNavigationEntries('MOD', null);
    expect(entries.find((e) => e.key === 'adminFeedback')).toBeDefined();
  });

  it('keyword search matches vi keywords', () => {
    const entries = filterNavigationEntries('PLAYER', 'cài đặt');
    expect(entries.some((e) => e.key === 'settings')).toBe(true);
  });

  it('returns entries with stable enabled state', () => {
    for (const e of NAVIGATION_REGISTRY) {
      expect(typeof e.enabled).toBe('boolean');
    }
  });
});
