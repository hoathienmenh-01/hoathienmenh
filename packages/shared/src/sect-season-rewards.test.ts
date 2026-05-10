/**
 * Phase 15.7 — sect-season Champion / MVP reward catalog tests.
 *
 * Pure unit tests:
 *   - Validate catalog invariant (no negative, no over-cap, items exist).
 *   - Tie-break determinism cho sect rank + member rank.
 *   - Lookup helper trả về đúng def theo type.
 */

import { describe, it, expect } from 'vitest';
import {
  SECT_SEASON_CHAMPION_REWARD,
  SECT_SEASON_MVP_REWARD,
  SECT_SEASON_CHAMPION_LINH_THACH_CAP,
  SECT_SEASON_CHAMPION_EXP_CAP,
  SECT_SEASON_MVP_LINH_THACH_CAP,
  SECT_SEASON_MVP_EXP_CAP,
  SECT_SEASON_CHAMPION_MEMBER_CAP,
  validateSectSeasonRewards,
  sectSeasonRewardByType,
  compareSectRankTie,
  compareMemberRankTie,
} from './sect-season-rewards';
import { itemByKey } from './items';

describe('SECT_SEASON Champion / MVP reward catalog', () => {
  describe('validateSectSeasonRewards', () => {
    it('catalog hiện tại không có issue nào', () => {
      const issues = validateSectSeasonRewards();
      expect(issues).toEqual([]);
    });

    it('Champion reward stay within caps', () => {
      expect(SECT_SEASON_CHAMPION_REWARD.linhThach).toBeGreaterThanOrEqual(0);
      expect(SECT_SEASON_CHAMPION_REWARD.linhThach).toBeLessThanOrEqual(
        SECT_SEASON_CHAMPION_LINH_THACH_CAP,
      );
      expect(SECT_SEASON_CHAMPION_REWARD.exp).toBeGreaterThanOrEqual(0);
      expect(SECT_SEASON_CHAMPION_REWARD.exp).toBeLessThanOrEqual(
        SECT_SEASON_CHAMPION_EXP_CAP,
      );
    });

    it('MVP reward stay within caps', () => {
      expect(SECT_SEASON_MVP_REWARD.linhThach).toBeGreaterThanOrEqual(0);
      expect(SECT_SEASON_MVP_REWARD.linhThach).toBeLessThanOrEqual(
        SECT_SEASON_MVP_LINH_THACH_CAP,
      );
      expect(SECT_SEASON_MVP_REWARD.exp).toBeGreaterThanOrEqual(0);
      expect(SECT_SEASON_MVP_REWARD.exp).toBeLessThanOrEqual(
        SECT_SEASON_MVP_EXP_CAP,
      );
    });

    it('MVP reward > Champion reward (per-member) — individual achievement nên cao hơn', () => {
      expect(SECT_SEASON_MVP_REWARD.linhThach).toBeGreaterThan(
        SECT_SEASON_CHAMPION_REWARD.linhThach,
      );
      expect(SECT_SEASON_MVP_REWARD.exp).toBeGreaterThan(
        SECT_SEASON_CHAMPION_REWARD.exp,
      );
    });

    it('mọi item key trong reward đều tồn tại trong items.ts catalog', () => {
      for (const it of SECT_SEASON_CHAMPION_REWARD.itemRewards) {
        expect(itemByKey(it.itemKey)).toBeDefined();
        expect(it.qty).toBeGreaterThan(0);
      }
      for (const it of SECT_SEASON_MVP_REWARD.itemRewards) {
        expect(itemByKey(it.itemKey)).toBeDefined();
        expect(it.qty).toBeGreaterThan(0);
      }
    });

    it('Champion member cap > 0 và <= 1000 (sanity)', () => {
      expect(SECT_SEASON_CHAMPION_MEMBER_CAP).toBeGreaterThan(0);
      expect(SECT_SEASON_CHAMPION_MEMBER_CAP).toBeLessThanOrEqual(1000);
    });

    it('i18n key đúng namespace `sectSeason.`', () => {
      expect(SECT_SEASON_CHAMPION_REWARD.subjectI18nKey).toMatch(
        /^sectSeason\./,
      );
      expect(SECT_SEASON_CHAMPION_REWARD.bodyI18nKey).toMatch(/^sectSeason\./);
      expect(SECT_SEASON_MVP_REWARD.subjectI18nKey).toMatch(/^sectSeason\./);
      expect(SECT_SEASON_MVP_REWARD.bodyI18nKey).toMatch(/^sectSeason\./);
    });

    it('fallback text vi/en không rỗng', () => {
      expect(SECT_SEASON_CHAMPION_REWARD.subjectVi.trim()).not.toBe('');
      expect(SECT_SEASON_CHAMPION_REWARD.subjectEn.trim()).not.toBe('');
      expect(SECT_SEASON_CHAMPION_REWARD.bodyVi.trim()).not.toBe('');
      expect(SECT_SEASON_CHAMPION_REWARD.bodyEn.trim()).not.toBe('');
      expect(SECT_SEASON_MVP_REWARD.subjectVi.trim()).not.toBe('');
      expect(SECT_SEASON_MVP_REWARD.subjectEn.trim()).not.toBe('');
      expect(SECT_SEASON_MVP_REWARD.bodyVi.trim()).not.toBe('');
      expect(SECT_SEASON_MVP_REWARD.bodyEn.trim()).not.toBe('');
    });

    it('Champion + MVP cap weekly equivalent < weekly Sect War tier-1 income', () => {
      // Sect War tier-1 weekly cho top sect là khoảng 5000 LT / tuần.
      // Champion: 5000 LT / season (4 tuần) = 1250 LT/tuần — OK.
      const championPerWeek = SECT_SEASON_CHAMPION_REWARD.linhThach / 4;
      expect(championPerWeek).toBeLessThan(5000);
      // MVP: 15000 LT / season (4 tuần) = 3750 LT/tuần — OK, vẫn dưới
      // weekly tier-1 cap.
      const mvpPerWeek = SECT_SEASON_MVP_REWARD.linhThach / 4;
      expect(mvpPerWeek).toBeLessThan(5000);
    });
  });

  describe('sectSeasonRewardByType', () => {
    it('lookup CHAMPION → SECT_SEASON_CHAMPION_REWARD', () => {
      expect(sectSeasonRewardByType('CHAMPION')).toBe(
        SECT_SEASON_CHAMPION_REWARD,
      );
    });
    it('lookup MVP → SECT_SEASON_MVP_REWARD', () => {
      expect(sectSeasonRewardByType('MVP')).toBe(SECT_SEASON_MVP_REWARD);
    });
  });

  describe('compareSectRankTie', () => {
    it('points DESC', () => {
      const a = { sectId: 'sect_b', points: 100, contributors: 5 };
      const b = { sectId: 'sect_a', points: 200, contributors: 5 };
      // b.points > a.points → b đứng trước → compare(a, b) > 0
      expect(compareSectRankTie(a, b)).toBeGreaterThan(0);
      expect(compareSectRankTie(b, a)).toBeLessThan(0);
    });

    it('tie points → contributors DESC', () => {
      const a = { sectId: 'sect_a', points: 100, contributors: 3 };
      const b = { sectId: 'sect_b', points: 100, contributors: 5 };
      // b.contributors > a.contributors → b đứng trước
      expect(compareSectRankTie(a, b)).toBeGreaterThan(0);
    });

    it('tie points + contributors → sectId ASC', () => {
      const a = { sectId: 'sect_aaa', points: 100, contributors: 5 };
      const b = { sectId: 'sect_zzz', points: 100, contributors: 5 };
      // a.sectId < b.sectId lexicographic → a đứng trước
      expect(compareSectRankTie(a, b)).toBeLessThan(0);
    });

    it('full tie → 0', () => {
      const a = { sectId: 'sect_x', points: 100, contributors: 5 };
      const b = { sectId: 'sect_x', points: 100, contributors: 5 };
      expect(compareSectRankTie(a, b)).toBe(0);
    });

    it('sort 4 sect deterministic', () => {
      const sects = [
        { sectId: 'b', points: 100, contributors: 5 },
        { sectId: 'a', points: 100, contributors: 5 },
        { sectId: 'c', points: 200, contributors: 1 },
        { sectId: 'd', points: 100, contributors: 7 },
      ];
      const sorted = [...sects].sort(compareSectRankTie);
      expect(sorted.map((s) => s.sectId)).toEqual(['c', 'd', 'a', 'b']);
      // c first (highest points), then d (tie 100 but contributors=7),
      // then a (tie 100/5 lexicographic), then b.
    });
  });

  describe('compareMemberRankTie', () => {
    it('points DESC', () => {
      const a = { characterId: 'char_a', points: 100 };
      const b = { characterId: 'char_b', points: 200 };
      expect(compareMemberRankTie(a, b)).toBeGreaterThan(0);
    });

    it('tie points → characterId ASC', () => {
      const a = { characterId: 'char_aaa', points: 100 };
      const b = { characterId: 'char_zzz', points: 100 };
      expect(compareMemberRankTie(a, b)).toBeLessThan(0);
    });

    it('full tie → 0', () => {
      const a = { characterId: 'char_x', points: 100 };
      const b = { characterId: 'char_x', points: 100 };
      expect(compareMemberRankTie(a, b)).toBe(0);
    });

    it('sort 4 member deterministic', () => {
      const members = [
        { characterId: 'c', points: 100 },
        { characterId: 'a', points: 200 },
        { characterId: 'b', points: 100 },
        { characterId: 'd', points: 200 },
      ];
      const sorted = [...members].sort(compareMemberRankTie);
      expect(sorted.map((m) => m.characterId)).toEqual(['a', 'd', 'b', 'c']);
      // a + d tie 200 but a < d lex; b + c tie 100 but b < c lex.
    });
  });
});
