import { describe, it, expect } from 'vitest';
import {
  DEFAULT_MAIL_TYPE,
  MAIL_TYPES,
  MAIL_STATUSES,
  deriveMailStatus,
  isMailClaimable,
  isMailType,
  mailTypeLabelKey,
} from './mail-types';

describe('Phase 31 — mail-types', () => {
  it('exposes all 10 MailType values including reserved PVP', () => {
    expect(MAIL_TYPES).toEqual([
      'SYSTEM',
      'ADMIN',
      'REWARD',
      'EVENT',
      'MAINTENANCE',
      'PURCHASE',
      'SECT',
      'FRIEND',
      'RETURNER',
      'PVP',
    ]);
    expect(DEFAULT_MAIL_TYPE).toBe('SYSTEM');
  });

  it('isMailType narrows correctly', () => {
    expect(isMailType('ADMIN')).toBe(true);
    expect(isMailType('FRIEND')).toBe(true);
    expect(isMailType('GARBAGE')).toBe(false);
    expect(isMailType(undefined)).toBe(false);
  });

  it('mailTypeLabelKey builds stable i18n keys', () => {
    expect(mailTypeLabelKey('ADMIN')).toBe('mail.type.ADMIN');
    expect(mailTypeLabelKey('RETURNER')).toBe('mail.type.RETURNER');
  });

  it('MAIL_STATUSES contains UNREAD/READ/CLAIMED/EXPIRED/DELETED', () => {
    expect([...MAIL_STATUSES].sort()).toEqual([
      'CLAIMED',
      'DELETED',
      'EXPIRED',
      'READ',
      'UNREAD',
    ]);
  });

  describe('deriveMailStatus', () => {
    const now = '2026-05-13T17:00:00.000Z';

    it('returns UNREAD for fresh row', () => {
      expect(
        deriveMailStatus({
          readAt: null,
          claimedAt: null,
          expiresAt: null,
          now,
          hasReward: false,
        }),
      ).toBe('UNREAD');
    });

    it('returns READ when read but not claimed', () => {
      expect(
        deriveMailStatus({
          readAt: '2026-05-13T16:00:00.000Z',
          claimedAt: null,
          expiresAt: null,
          now,
          hasReward: true,
        }),
      ).toBe('READ');
    });

    it('returns CLAIMED when claimedAt set', () => {
      expect(
        deriveMailStatus({
          readAt: '2026-05-13T16:00:00.000Z',
          claimedAt: '2026-05-13T16:30:00.000Z',
          expiresAt: null,
          now,
          hasReward: true,
        }),
      ).toBe('CLAIMED');
    });

    it('returns EXPIRED when expiresAt <= now and not claimed', () => {
      expect(
        deriveMailStatus({
          readAt: null,
          claimedAt: null,
          expiresAt: '2026-05-13T16:00:00.000Z',
          now,
          hasReward: true,
        }),
      ).toBe('EXPIRED');
    });

    it('returns DELETED when deletedAt is present', () => {
      expect(
        deriveMailStatus({
          readAt: '2026-05-13T16:00:00.000Z',
          claimedAt: null,
          expiresAt: null,
          now,
          hasReward: false,
          deletedAt: '2026-05-13T16:30:00.000Z',
        }),
      ).toBe('DELETED');
    });
  });

  describe('isMailClaimable', () => {
    const now = '2026-05-13T17:00:00.000Z';

    it('returns false when no reward', () => {
      expect(
        isMailClaimable({
          readAt: null,
          claimedAt: null,
          expiresAt: null,
          now,
          hasReward: false,
        }),
      ).toBe(false);
    });

    it('returns false when already claimed', () => {
      expect(
        isMailClaimable({
          readAt: null,
          claimedAt: '2026-05-13T16:30:00.000Z',
          expiresAt: null,
          now,
          hasReward: true,
        }),
      ).toBe(false);
    });

    it('returns false when expired', () => {
      expect(
        isMailClaimable({
          readAt: null,
          claimedAt: null,
          expiresAt: '2026-05-13T16:00:00.000Z',
          now,
          hasReward: true,
        }),
      ).toBe(false);
    });

    it('returns true when reward and unread & not expired', () => {
      expect(
        isMailClaimable({
          readAt: null,
          claimedAt: null,
          expiresAt: '2027-01-01T00:00:00.000Z',
          now,
          hasReward: true,
        }),
      ).toBe(true);
    });
  });
});
