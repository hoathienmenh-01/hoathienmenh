import { describe, expect, it } from 'vitest';
import {
  formatBellBadgeCount,
  isNotificationEntityType,
  isNotificationType,
  isPresenceStatus,
  NOTIFICATION_LIMITS,
  NOTIFICATION_TYPES,
  notificationBodyKey,
  notificationTitleKey,
  sanitizeNotificationData,
  sanitizeNotificationText,
} from './notification';

describe('Phase 19.3 — notification shared catalog', () => {
  describe('enum guards', () => {
    it('accepts known notification types', () => {
      for (const t of NOTIFICATION_TYPES) {
        expect(isNotificationType(t)).toBe(true);
      }
    });

    it('rejects unknown notification types', () => {
      expect(isNotificationType('foo')).toBe(false);
      expect(isNotificationType('')).toBe(false);
      expect(isNotificationType(null)).toBe(false);
      expect(isNotificationType(undefined)).toBe(false);
      expect(isNotificationType(42)).toBe(false);
    });

    it('accepts known entity types', () => {
      expect(isNotificationEntityType('FRIEND_REQUEST')).toBe(true);
      expect(isNotificationEntityType('PRIVATE_THREAD')).toBe(true);
      expect(isNotificationEntityType('GROUP_CHAT')).toBe(true);
      expect(isNotificationEntityType('CHAT_REPORT')).toBe(true);
      expect(isNotificationEntityType('SECURITY_ALERT')).toBe(true);
    });

    it('rejects unknown entity types', () => {
      expect(isNotificationEntityType('foo')).toBe(false);
      expect(isNotificationEntityType(null)).toBe(false);
    });

    it('accepts ONLINE / OFFLINE presence status', () => {
      expect(isPresenceStatus('ONLINE')).toBe(true);
      expect(isPresenceStatus('OFFLINE')).toBe(true);
    });

    it('rejects unknown presence status', () => {
      expect(isPresenceStatus('AWAY')).toBe(false);
      expect(isPresenceStatus('online')).toBe(false);
    });
  });

  describe('i18n key builders', () => {
    it('builds title + body keys deterministically', () => {
      expect(notificationTitleKey('FRIEND_REQUEST_RECEIVED')).toBe(
        'notification.FRIEND_REQUEST_RECEIVED.title',
      );
      expect(notificationBodyKey('FRIEND_REQUEST_RECEIVED')).toBe(
        'notification.FRIEND_REQUEST_RECEIVED.body',
      );
      expect(notificationTitleKey('CHAT_REPORT_RESOLVED')).toBe(
        'notification.CHAT_REPORT_RESOLVED.title',
      );
    });
  });

  describe('sanitizeNotificationText', () => {
    it('trims + strips control chars', () => {
      expect(sanitizeNotificationText('  hi\u0000there  ')).toBe('hithere');
      expect(sanitizeNotificationText('\u001Fbad')).toBe('bad');
    });

    it('returns null for empty / null / non-string', () => {
      expect(sanitizeNotificationText(null)).toBeNull();
      expect(sanitizeNotificationText(undefined)).toBeNull();
      expect(sanitizeNotificationText('   ')).toBeNull();
      // @ts-expect-error testing wrong type
      expect(sanitizeNotificationText(123)).toBeNull();
    });

    it('caps at maxLen', () => {
      const s = 'x'.repeat(NOTIFICATION_LIMITS.DATA_TEXT_MAX + 50);
      const out = sanitizeNotificationText(s);
      expect(out).not.toBeNull();
      expect(out!.length).toBe(NOTIFICATION_LIMITS.DATA_TEXT_MAX);
    });
  });

  describe('sanitizeNotificationData', () => {
    it('passes through scalar keys', () => {
      const out = sanitizeNotificationData({
        senderUserId: 'u1',
        count: 3,
        active: true,
        empty: null,
      });
      expect(out).toEqual({
        senderUserId: 'u1',
        count: 3,
        active: true,
        empty: null,
      });
    });

    it('strips reserved security-related keys', () => {
      const out = sanitizeNotificationData({
        password: 'leak',
        token: 'abc',
        secret: 'shh',
        ip: '1.2.3.4',
        cookie: 'set',
        ok: 'fine',
      });
      expect(out).toEqual({ ok: 'fine' });
    });

    it('skips nested objects / arrays', () => {
      const out = sanitizeNotificationData({
        ok: 'fine',
        nested: { a: 1 },
        arr: [1, 2, 3],
      });
      expect(out).toEqual({ ok: 'fine' });
    });

    it('caps at 12 keys', () => {
      const big: Record<string, unknown> = {};
      for (let i = 0; i < 20; i += 1) big[`k${i}`] = i;
      const out = sanitizeNotificationData(big);
      expect(Object.keys(out).length).toBe(12);
    });

    it('drops NaN / Infinity', () => {
      const out = sanitizeNotificationData({
        a: Number.NaN,
        b: Number.POSITIVE_INFINITY,
        c: 1.5,
      });
      expect(out).toEqual({ c: 1.5 });
    });

    it('returns {} for null / undefined / non-object', () => {
      expect(sanitizeNotificationData(null)).toEqual({});
      expect(sanitizeNotificationData(undefined)).toEqual({});
      // @ts-expect-error testing wrong type
      expect(sanitizeNotificationData('foo')).toEqual({});
    });

    it('drops long / empty / non-string keys', () => {
      const longKey = 'k'.repeat(80);
      const out = sanitizeNotificationData({
        '   ': 'space',
        [longKey]: 'long',
        ok: 'fine',
      });
      expect(out).toEqual({ ok: 'fine' });
    });

    it('sanitizes string values inside data', () => {
      const out = sanitizeNotificationData({
        senderName: '  alice\u0000  ',
      });
      expect(out).toEqual({ senderName: 'alice' });
    });
  });

  describe('formatBellBadgeCount', () => {
    it('returns empty for <= 0', () => {
      expect(formatBellBadgeCount(0)).toBe('');
      expect(formatBellBadgeCount(-5)).toBe('');
    });

    it('returns plain string for <= 99', () => {
      expect(formatBellBadgeCount(1)).toBe('1');
      expect(formatBellBadgeCount(42)).toBe('42');
      expect(formatBellBadgeCount(99)).toBe('99');
    });

    it('clamps > 99 to 99+', () => {
      expect(formatBellBadgeCount(100)).toBe('99+');
      expect(formatBellBadgeCount(9999)).toBe('99+');
    });

    it('handles fractional numbers (floor)', () => {
      expect(formatBellBadgeCount(3.9)).toBe('3');
    });

    it('handles non-finite', () => {
      expect(formatBellBadgeCount(Number.NaN)).toBe('');
      expect(formatBellBadgeCount(Number.POSITIVE_INFINITY)).toBe('');
    });
  });
});
