import { describe, expect, it } from 'vitest';
import {
  RELATIONSHIP_STATUSES,
  computePowerScore,
  computeProfileActions,
  formatJoinedYearMonth,
  isRelationshipStatus,
  type RelationshipStatus,
} from './public-profile';

describe('public-profile shared', () => {
  describe('RelationshipStatus enum', () => {
    it('contains exactly the 7 expected statuses', () => {
      expect([...RELATIONSHIP_STATUSES]).toEqual([
        'SELF',
        'FRIEND',
        'PENDING_INCOMING',
        'PENDING_OUTGOING',
        'BLOCKED_BY_ME',
        'BLOCKED_ME',
        'STRANGER',
      ]);
    });

    it.each(RELATIONSHIP_STATUSES)('isRelationshipStatus(%s) = true', (s) => {
      expect(isRelationshipStatus(s)).toBe(true);
    });

    it.each(['', 'OPEN', 'friend', null, undefined, 0, {}])(
      'isRelationshipStatus(%j) = false',
      (v) => {
        expect(isRelationshipStatus(v)).toBe(false);
      },
    );
  });

  describe('computeProfileActions', () => {
    it('SELF: all false', () => {
      expect(computeProfileActions('SELF')).toEqual({
        canSendFriendRequest: false,
        canMessage: false,
        canBlock: false,
        canReport: false,
      });
    });

    it('FRIEND: cannot send-request, can message/block/report', () => {
      expect(computeProfileActions('FRIEND')).toEqual({
        canSendFriendRequest: false,
        canMessage: true,
        canBlock: true,
        canReport: true,
      });
    });

    it('PENDING_INCOMING: cannot send-request, cannot message, can block/report', () => {
      expect(computeProfileActions('PENDING_INCOMING')).toEqual({
        canSendFriendRequest: false,
        canMessage: false,
        canBlock: true,
        canReport: true,
      });
    });

    it('PENDING_OUTGOING: same as INCOMING', () => {
      expect(computeProfileActions('PENDING_OUTGOING')).toEqual({
        canSendFriendRequest: false,
        canMessage: false,
        canBlock: true,
        canReport: true,
      });
    });

    it('BLOCKED_BY_ME: all false (FE renders unblock CTA)', () => {
      expect(computeProfileActions('BLOCKED_BY_ME')).toEqual({
        canSendFriendRequest: false,
        canMessage: false,
        canBlock: false,
        canReport: false,
      });
    });

    it('BLOCKED_ME: defensive all-false (endpoint masks 404 before reaching this)', () => {
      expect(computeProfileActions('BLOCKED_ME')).toEqual({
        canSendFriendRequest: false,
        canMessage: false,
        canBlock: false,
        canReport: false,
      });
    });

    it('STRANGER: all true', () => {
      expect(computeProfileActions('STRANGER')).toEqual({
        canSendFriendRequest: true,
        canMessage: true,
        canBlock: true,
        canReport: true,
      });
    });

    it('matrix invariant: SELF/BLOCKED_BY_ME/BLOCKED_ME never canMessage', () => {
      for (const s of [
        'SELF',
        'BLOCKED_BY_ME',
        'BLOCKED_ME',
      ] satisfies RelationshipStatus[]) {
        expect(computeProfileActions(s).canMessage).toBe(false);
      }
    });

    it('matrix invariant: only STRANGER canSendFriendRequest', () => {
      for (const s of RELATIONSHIP_STATUSES) {
        const allowed = s === 'STRANGER';
        expect(computeProfileActions(s).canSendFriendRequest).toBe(allowed);
      }
    });
  });

  describe('formatJoinedYearMonth', () => {
    it('Jan UTC → YYYY-01', () => {
      expect(formatJoinedYearMonth(new Date('2025-01-15T00:00:00Z'))).toBe(
        '2025-01',
      );
    });

    it('Dec UTC → YYYY-12 (zero-pad month)', () => {
      expect(formatJoinedYearMonth(new Date('2024-12-01T00:00:00Z'))).toBe(
        '2024-12',
      );
    });

    it('zero-pads single digit month', () => {
      expect(formatJoinedYearMonth(new Date('2024-03-30T23:59:59Z'))).toBe(
        '2024-03',
      );
    });

    it('uses UTC consistently regardless of local TZ-edge', () => {
      // Pick a UTC ISO string at start of month — should reflect exactly.
      const d = new Date('2026-09-01T00:00:00Z');
      expect(formatJoinedYearMonth(d)).toBe('2026-09');
    });
  });

  describe('computePowerScore', () => {
    it('sums power + spirit + speed', () => {
      expect(computePowerScore({ power: 10, spirit: 20, speed: 30 })).toBe(60);
    });

    it('handles zeros without NaN', () => {
      expect(computePowerScore({ power: 0, spirit: 0, speed: 0 })).toBe(0);
    });

    it('deterministic — same input → same output', () => {
      const s = { power: 7, spirit: 11, speed: 13 };
      expect(computePowerScore(s)).toBe(computePowerScore(s));
    });

    it('does NOT include luck/level/hp (intentional — see DTO contract)', () => {
      // Sanity: function signature only accepts these 3 stats. If
      // contract changes to include more, this test fails to remind
      // doc update.
      expect(computePowerScore({ power: 1, spirit: 1, speed: 1 })).toBe(3);
    });
  });
});
