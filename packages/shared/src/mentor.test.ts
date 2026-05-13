import { describe, it, expect } from 'vitest';
import {
  MENTOR_LIMITS,
  MENTOR_RELATION_STATUSES,
  isMentorRelationStatus,
  sanitizeMentorIntro,
  sanitizeMentorRequestMessage,
  validateMentorRequest,
} from './mentor';

describe('Phase 31 — mentor', () => {
  it('exposes 4-state mentor relation lifecycle', () => {
    expect(MENTOR_RELATION_STATUSES).toEqual([
      'PENDING',
      'ACTIVE',
      'DECLINED',
      'ENDED',
    ]);
  });

  it('isMentorRelationStatus narrows', () => {
    expect(isMentorRelationStatus('ACTIVE')).toBe(true);
    expect(isMentorRelationStatus('GARBAGE')).toBe(false);
  });

  describe('validateMentorRequest', () => {
    const valid = {
      mentorRealmTier: 12,
      studentRealmTier: 4,
      studentPendingRequests: 0,
      mentorActiveStudents: 0,
      mentorAcceptingStudents: true,
      studentAlreadyHasActiveMentor: false,
    };

    it('returns null when input is valid', () => {
      expect(validateMentorRequest(valid)).toBeNull();
    });

    it('rejects TIER_TOO_LOW when mentor tier < MIN_MENTOR_REALM_TIER', () => {
      expect(
        validateMentorRequest({
          ...valid,
          mentorRealmTier: MENTOR_LIMITS.MIN_MENTOR_REALM_TIER - 1,
        }),
      ).toBe('TIER_TOO_LOW');
    });

    it('rejects TIER_TOO_HIGH when student tier > MAX_STUDENT_REALM_TIER', () => {
      expect(
        validateMentorRequest({
          ...valid,
          studentRealmTier: MENTOR_LIMITS.MAX_STUDENT_REALM_TIER + 1,
        }),
      ).toBe('TIER_TOO_HIGH');
    });

    it('rejects TIER_GAP_TOO_SMALL when gap < MIN_TIER_GAP', () => {
      expect(
        validateMentorRequest({
          ...valid,
          mentorRealmTier: 9,
          studentRealmTier: 7, // gap=2 < 3
        }),
      ).toBe('TIER_TOO_HIGH'); // student tier > MAX_STUDENT_REALM_TIER catches first
      expect(
        validateMentorRequest({
          ...valid,
          mentorRealmTier: 9,
          studentRealmTier: 6,
        }),
      ).toBeNull();
    });

    it('rejects STUDENT_ALREADY_HAS_MENTOR', () => {
      expect(
        validateMentorRequest({
          ...valid,
          studentAlreadyHasActiveMentor: true,
        }),
      ).toBe('STUDENT_ALREADY_HAS_MENTOR');
    });

    it('rejects NOT_AUTHORIZED when mentor not accepting', () => {
      expect(
        validateMentorRequest({
          ...valid,
          mentorAcceptingStudents: false,
        }),
      ).toBe('NOT_AUTHORIZED');
    });

    it('rejects MENTOR_STUDENT_CAP_REACHED', () => {
      expect(
        validateMentorRequest({
          ...valid,
          mentorActiveStudents: MENTOR_LIMITS.MENTOR_STUDENT_MAX,
        }),
      ).toBe('MENTOR_STUDENT_CAP_REACHED');
    });

    it('rejects PENDING_REQUEST_CAP_REACHED', () => {
      expect(
        validateMentorRequest({
          ...valid,
          studentPendingRequests: MENTOR_LIMITS.STUDENT_PENDING_REQUEST_MAX,
        }),
      ).toBe('PENDING_REQUEST_CAP_REACHED');
    });
  });

  describe('sanitizeMentorIntro', () => {
    it('trims + strips control chars', () => {
      expect(sanitizeMentorIntro('  hello\u0007world  ')).toBe('helloworld');
    });

    it('caps length at MENTOR_INTRO_MAX', () => {
      const long = 'a'.repeat(MENTOR_LIMITS.MENTOR_INTRO_MAX + 50);
      const out = sanitizeMentorIntro(long);
      expect(out!.length).toBe(MENTOR_LIMITS.MENTOR_INTRO_MAX);
    });

    it('returns null for empty or null', () => {
      expect(sanitizeMentorIntro(null)).toBeNull();
      expect(sanitizeMentorIntro('')).toBeNull();
      expect(sanitizeMentorIntro('   ')).toBeNull();
    });
  });

  describe('sanitizeMentorRequestMessage', () => {
    it('caps length at REQUEST_MESSAGE_MAX', () => {
      const long = 'b'.repeat(MENTOR_LIMITS.REQUEST_MESSAGE_MAX + 100);
      const out = sanitizeMentorRequestMessage(long);
      expect(out!.length).toBe(MENTOR_LIMITS.REQUEST_MESSAGE_MAX);
    });
  });
});
