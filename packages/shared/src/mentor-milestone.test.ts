/**
 * Phase 35.2 — Mentor Milestone catalog audit.
 */

import { describe, it, expect } from 'vitest';
import {
  MENTOR_MILESTONES,
  MENTOR_MILESTONE_ROLES,
  MENTOR_MILESTONE_STATUSES,
  getMentorMilestoneReward,
  isMentorMilestoneKey,
  isMentorMilestoneRole,
  isMentorMilestoneStatus,
  mentorMilestoneByKey,
  mentorMilestonesEarnedAt,
} from './mentor-milestone';
import { realmByKey } from './realms';

describe('MENTOR_MILESTONES catalog audit (Phase 35.2)', () => {
  it('has 8 milestones', () => {
    expect(MENTOR_MILESTONES.length).toBe(8);
  });

  it('milestoneKey unique', () => {
    const keys = MENTOR_MILESTONES.map((m) => m.milestoneKey);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('requiredRealmKey resolve to real realm + order match', () => {
    for (const m of MENTOR_MILESTONES) {
      const realm = realmByKey(m.requiredRealmKey);
      expect(realm, `realm ${m.requiredRealmKey}`).toBeDefined();
      expect(m.requiredRealmOrder).toBe(realm!.order);
    }
  });

  it('requiredRealmOrder strictly increasing', () => {
    for (let i = 1; i < MENTOR_MILESTONES.length; i++) {
      expect(MENTOR_MILESTONES[i]!.requiredRealmOrder).toBeGreaterThan(
        MENTOR_MILESTONES[i - 1]!.requiredRealmOrder,
      );
    }
  });

  it('mentor reward < disciple reward for every milestone', () => {
    for (const m of MENTOR_MILESTONES) {
      expect(m.mentorRewardLinhThach).toBeLessThan(m.discipleRewardLinhThach);
      expect(m.mentorRewardLinhThach).toBeGreaterThan(0n);
    }
  });

  it('cumulative cap stays within tolerance (mentor ≤ 1M, disciple ≤ 1.5M)', () => {
    const mentorSum = MENTOR_MILESTONES.reduce(
      (a, m) => a + m.mentorRewardLinhThach,
      0n,
    );
    const discipleSum = MENTOR_MILESTONES.reduce(
      (a, m) => a + m.discipleRewardLinhThach,
      0n,
    );
    expect(mentorSum).toBeLessThanOrEqual(1_000_000n);
    expect(discipleSum).toBeLessThanOrEqual(1_500_000n);
  });

  it('titleVi + titleEn non-empty', () => {
    for (const m of MENTOR_MILESTONES) {
      expect(m.titleVi.length).toBeGreaterThan(0);
      expect(m.titleEn.length).toBeGreaterThan(0);
    }
  });
});

describe('mentor-milestone helpers', () => {
  it('mentorMilestoneByKey returns def for known key', () => {
    expect(mentorMilestoneByKey('mentor_milestone_truc_co')).toBeDefined();
    expect(mentorMilestoneByKey('does_not_exist')).toBeUndefined();
  });

  it('isMentorMilestoneKey type guard', () => {
    expect(isMentorMilestoneKey('mentor_milestone_kim_dan')).toBe(true);
    expect(isMentorMilestoneKey('nope')).toBe(false);
    expect(isMentorMilestoneKey(42)).toBe(false);
  });

  it('isMentorMilestoneRole + isMentorMilestoneStatus type guards', () => {
    for (const r of MENTOR_MILESTONE_ROLES) {
      expect(isMentorMilestoneRole(r)).toBe(true);
    }
    for (const s of MENTOR_MILESTONE_STATUSES) {
      expect(isMentorMilestoneStatus(s)).toBe(true);
    }
    expect(isMentorMilestoneRole('ADMIN')).toBe(false);
    expect(isMentorMilestoneStatus('PENDING')).toBe(false);
  });

  it('getMentorMilestoneReward returns correct value per role', () => {
    const truc = MENTOR_MILESTONES[0]!;
    expect(getMentorMilestoneReward(truc.milestoneKey, 'MENTOR')).toBe(
      truc.mentorRewardLinhThach,
    );
    expect(getMentorMilestoneReward(truc.milestoneKey, 'DISCIPLE')).toBe(
      truc.discipleRewardLinhThach,
    );
  });

  it('getMentorMilestoneReward throws on unknown key', () => {
    expect(() => getMentorMilestoneReward('unknown_key', 'MENTOR')).toThrow();
  });

  it('mentorMilestonesEarnedAt filters by realmOrder', () => {
    expect(mentorMilestonesEarnedAt(0)).toHaveLength(0);
    expect(mentorMilestonesEarnedAt(2)).toContain('mentor_milestone_truc_co');
    expect(mentorMilestonesEarnedAt(3)).toContain('mentor_milestone_kim_dan');
    expect(mentorMilestonesEarnedAt(9)).toHaveLength(MENTOR_MILESTONES.length);
  });
});
