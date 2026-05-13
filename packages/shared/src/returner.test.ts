import { describe, it, expect } from 'vitest';
import {
  DEFAULT_RETURNER_REWARDS,
  RETURNER_FORBIDDEN_ITEM_KEYS,
  RETURNER_LIMITS,
  RETURNER_REWARD_TIER_CAP,
  buildReturnerCycleKey,
  resolveReturnerTier,
  validateReturnerReward,
  type ReturnerRewardTemplate,
} from './returner';

describe('Phase 31 — returner', () => {
  describe('resolveReturnerTier', () => {
    it('returns null when inactiveDays < 7', () => {
      expect(resolveReturnerTier(0)).toBeNull();
      expect(resolveReturnerTier(6)).toBeNull();
    });

    it('returns SHORT for 7..13 days', () => {
      expect(resolveReturnerTier(7)).toBe('SHORT');
      expect(resolveReturnerTier(13)).toBe('SHORT');
    });

    it('returns MEDIUM for 14..29 days', () => {
      expect(resolveReturnerTier(14)).toBe('MEDIUM');
      expect(resolveReturnerTier(29)).toBe('MEDIUM');
    });

    it('returns LONG for 30+ days', () => {
      expect(resolveReturnerTier(30)).toBe('LONG');
      expect(resolveReturnerTier(120)).toBe('LONG');
    });
  });

  describe('buildReturnerCycleKey', () => {
    it('builds deterministic key (UTC date)', () => {
      const date = new Date('2026-05-13T17:30:00Z');
      const key = buildReturnerCycleKey('user_abc', 'SHORT', date);
      expect(key).toBe('user_abc:SHORT:2026-05-13');
    });
  });

  describe('validateReturnerReward', () => {
    it('accepts default templates', () => {
      for (const tier of Object.keys(DEFAULT_RETURNER_REWARDS) as Array<
        keyof typeof DEFAULT_RETURNER_REWARDS
      >) {
        expect(
          validateReturnerReward(DEFAULT_RETURNER_REWARDS[tier]),
        ).toBeNull();
      }
    });

    it('rejects negative linh thach', () => {
      const tpl: ReturnerRewardTemplate = {
        ...DEFAULT_RETURNER_REWARDS.SHORT,
        linhThach: '-5',
      };
      expect(validateReturnerReward(tpl)).toBe('INVALID_LINH_THACH');
    });

    it('rejects linh thach over cap', () => {
      const tpl: ReturnerRewardTemplate = {
        ...DEFAULT_RETURNER_REWARDS.SHORT,
        linhThach: (
          RETURNER_LIMITS.MAX_LINH_THACH_PER_TRIGGER + 1n
        ).toString(),
      };
      expect(validateReturnerReward(tpl)).toBe('LINH_THACH_CAP');
    });

    it('rejects tien ngoc > 0 (Phase 31 anti-P2W)', () => {
      const tpl: ReturnerRewardTemplate = {
        ...DEFAULT_RETURNER_REWARDS.SHORT,
        tienNgoc: 1,
      };
      expect(validateReturnerReward(tpl)).toBe('TIEN_NGOC_CAP');
    });

    it('rejects forbidden endgame item', () => {
      const tpl: ReturnerRewardTemplate = {
        ...DEFAULT_RETURNER_REWARDS.SHORT,
        items: [{ itemKey: 'than_dan', qty: 1 }],
      };
      expect(validateReturnerReward(tpl)).toBe('ITEM_FORBIDDEN');
    });
  });

  it('RETURNER_REWARD_TIER_CAP escalates by tier and is bounded', () => {
    expect(RETURNER_REWARD_TIER_CAP.SHORT).toBeLessThan(
      RETURNER_REWARD_TIER_CAP.MEDIUM,
    );
    expect(RETURNER_REWARD_TIER_CAP.MEDIUM).toBeLessThan(
      RETURNER_REWARD_TIER_CAP.LONG,
    );
    expect(RETURNER_REWARD_TIER_CAP.LONG).toBeLessThanOrEqual(28);
  });

  it('forbidden set blocks every endgame artifact key', () => {
    for (const key of [
      'hau_tho_tran_hon_an',
      'ban_nguyen_chi_bao',
      'hu_khong_chi_bao',
      'tien_huyen_kiem',
      'tien_huyen_giap',
      'than_dan',
    ]) {
      expect(RETURNER_FORBIDDEN_ITEM_KEYS.has(key)).toBe(true);
    }
  });
});
