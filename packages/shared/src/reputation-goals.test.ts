import { describe, expect, it } from 'vitest';

import {
  LONG_TERM_GOALS,
  REPUTATION_GROUPS,
  getLongTermGoalDef,
  getReputationGroupDef,
  isReputationGroup,
  longTermGoalsByCategory,
  type LongTermGoalCategory,
  type LongTermGoalTier,
  type ReputationGroup,
} from './reputation-goals';
import type { MissionGoalKind } from './missions';

const VALID_GROUPS: readonly ReputationGroup[] = [
  'TIEN_DAO',
  'DAN_DAO',
  'CHIEN_DAU',
  'BI_CANH',
  'TONG_MON',
  'XA_HOI',
  'SU_KIEN',
  'THUONG_HOI',
];

const VALID_CATEGORIES: readonly LongTermGoalCategory[] = [
  'realm',
  'body',
  'pet',
  'dungeon',
  'boss',
  'sect',
];

const VALID_TIERS: readonly LongTermGoalTier[] = [
  'bronze',
  'silver',
  'gold',
  'platinum',
];

const VALID_GOAL_KINDS: readonly MissionGoalKind[] = [
  'GAIN_EXP',
  'CULTIVATE_SECONDS',
  'KILL_MONSTER',
  'CLEAR_DUNGEON',
  'BOSS_HIT',
  'SELL_LISTING',
  'BUY_LISTING',
  'CHAT_MESSAGE',
  'SECT_CONTRIBUTE',
  'BREAKTHROUGH',
  'ALCHEMY_CRAFT',
];

describe('REPUTATION_GROUPS catalog', () => {
  it('covers exactly the Phase 46 reputation groups', () => {
    expect(REPUTATION_GROUPS.map((g) => g.key)).toEqual(VALID_GROUPS);
  });

  it('has unique keys, labels and safe daily caps', () => {
    const seen = new Set<string>();
    for (const g of REPUTATION_GROUPS) {
      expect(seen.has(g.key)).toBe(false);
      seen.add(g.key);
      expect(g.nameVi.length).toBeGreaterThan(0);
      expect(g.nameEn.length).toBeGreaterThan(0);
      expect(g.descriptionVi.length).toBeGreaterThan(0);
      expect(g.descriptionEn.length).toBeGreaterThan(0);
      expect(g.dailyCap).toBeGreaterThan(0);
      expect(g.dailyCap).toBeLessThanOrEqual(500);
      expect(getReputationGroupDef(g.key)?.key).toBe(g.key);
      expect(isReputationGroup(g.key)).toBe(true);
    }
    expect(isReputationGroup('INVALID')).toBe(false);
  });
});

describe('LONG_TERM_GOALS catalog', () => {
  it('has unique keys and valid shape', () => {
    const seen = new Set<string>();
    for (const goal of LONG_TERM_GOALS) {
      expect(goal.key).toMatch(/^[a-z][a-z0-9_]*$/);
      expect(seen.has(goal.key)).toBe(false);
      seen.add(goal.key);
      expect(goal.nameVi.length).toBeGreaterThan(0);
      expect(goal.nameEn.length).toBeGreaterThan(0);
      expect(VALID_CATEGORIES).toContain(goal.category);
      expect(VALID_TIERS).toContain(goal.tier);
      expect(VALID_GOAL_KINDS).toContain(goal.goalKind);
      expect(goal.goalAmount).toBeGreaterThan(0);
      expect(getLongTermGoalDef(goal.key)?.key).toBe(goal.key);
      for (const [group, amount] of Object.entries(goal.reward.reputation ?? {})) {
        expect(VALID_GROUPS).toContain(group as ReputationGroup);
        expect(amount).toBeGreaterThan(0);
        expect(amount).toBeLessThanOrEqual(250);
      }
    }
  });

  it('covers requested long-term categories', () => {
    for (const category of VALID_CATEGORIES) {
      expect(longTermGoalsByCategory(category).length).toBeGreaterThanOrEqual(1);
    }
  });
});
