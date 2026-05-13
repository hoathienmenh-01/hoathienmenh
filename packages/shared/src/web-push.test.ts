import { describe, expect, it } from 'vitest';
import {
  DEFAULT_WEB_PUSH_PREFERENCES,
  WEB_PUSH_COOLDOWN_MS,
  WEB_PUSH_LIMITS,
  WEB_PUSH_NOTIFICATION_TYPES,
  buildWebPushPayload,
  isInQuietHours,
  isWebPushNotificationType,
  parsePushPreferencesPatch,
  shouldSendPushNotification,
  validatePushSubscriptionInput,
} from './web-push';

const VALID_P256DH = 'BNcRdreALRFXTkOOUHK1EtK2wtaz5Z__test__-_pad=';
const VALID_AUTH = 'k8JV6sjdbMQuKofd2Y_test=';

function basePrefs() {
  return {
    bossSpawnEnabled: true,
    staminaFullEnabled: true,
    mailEnabled: true,
    dailyReminderEnabled: true,
    quietHoursStart: null,
    quietHoursEnd: null,
  };
}

describe('Phase PWA-1 — web-push catalog', () => {
  describe('WEB_PUSH_NOTIFICATION_TYPES', () => {
    it('exposes 4 types', () => {
      expect(WEB_PUSH_NOTIFICATION_TYPES).toEqual([
        'BOSS_SPAWN',
        'STAMINA_FULL',
        'MAIL_NEW',
        'DAILY_REMINDER',
      ]);
    });

    it('isWebPushNotificationType narrows known and rejects unknown', () => {
      expect(isWebPushNotificationType('BOSS_SPAWN')).toBe(true);
      expect(isWebPushNotificationType('STAMINA_FULL')).toBe(true);
      expect(isWebPushNotificationType('UNKNOWN')).toBe(false);
      expect(isWebPushNotificationType(null)).toBe(false);
      expect(isWebPushNotificationType(123)).toBe(false);
    });
  });

  describe('WEB_PUSH_COOLDOWN_MS', () => {
    it('declares cooldown for every type, all positive', () => {
      for (const t of WEB_PUSH_NOTIFICATION_TYPES) {
        const cd = WEB_PUSH_COOLDOWN_MS[t];
        expect(cd).toBeGreaterThan(0);
      }
    });

    it('daily reminder cooldown is ~23h to avoid skip on day boundary', () => {
      expect(WEB_PUSH_COOLDOWN_MS.DAILY_REMINDER).toBe(23 * 60 * 60_000);
    });
  });

  describe('validatePushSubscriptionInput', () => {
    it('accepts a well-formed Web Push subscription JSON', () => {
      const r = validatePushSubscriptionInput({
        endpoint: 'https://fcm.googleapis.com/fcm/send/abc',
        keys: { p256dh: VALID_P256DH, auth: VALID_AUTH },
        userAgent: 'Mozilla/5.0',
      });
      expect(r.ok).toBe(true);
      expect(r.value?.endpoint).toBe('https://fcm.googleapis.com/fcm/send/abc');
      expect(r.value?.p256dh).toBe(VALID_P256DH);
      expect(r.value?.auth).toBe(VALID_AUTH);
      expect(r.value?.userAgent).toBe('Mozilla/5.0');
    });

    it('rejects null / non-object', () => {
      expect(validatePushSubscriptionInput(null).ok).toBe(false);
      expect(validatePushSubscriptionInput('abc').ok).toBe(false);
      expect(validatePushSubscriptionInput(42).ok).toBe(false);
    });

    it('rejects insecure endpoints (no https / not localhost)', () => {
      const r = validatePushSubscriptionInput({
        endpoint: 'ftp://evil.example/push',
        keys: { p256dh: VALID_P256DH, auth: VALID_AUTH },
      });
      expect(r.ok).toBe(false);
      expect(r.code).toBe('ENDPOINT_INVALID');
    });

    it('accepts http://localhost endpoint (dev only)', () => {
      const r = validatePushSubscriptionInput({
        endpoint: 'http://localhost:3000/push',
        keys: { p256dh: VALID_P256DH, auth: VALID_AUTH },
      });
      expect(r.ok).toBe(true);
    });

    it('rejects endpoint too long', () => {
      const longUrl =
        'https://fcm.googleapis.com/fcm/send/' +
        'a'.repeat(WEB_PUSH_LIMITS.ENDPOINT_MAX_CHARS + 1);
      const r = validatePushSubscriptionInput({
        endpoint: longUrl,
        keys: { p256dh: VALID_P256DH, auth: VALID_AUTH },
      });
      expect(r.ok).toBe(false);
      expect(r.code).toBe('ENDPOINT_TOO_LONG');
    });

    it('rejects missing or malformed p256dh / auth', () => {
      const e1 = validatePushSubscriptionInput({
        endpoint: 'https://fcm.googleapis.com/fcm/send/x',
        keys: {},
      });
      expect(e1.code).toBe('P256DH_INVALID');
      const e2 = validatePushSubscriptionInput({
        endpoint: 'https://fcm.googleapis.com/fcm/send/x',
        keys: { p256dh: '!!!not-base64!!!', auth: VALID_AUTH },
      });
      expect(e2.code).toBe('P256DH_INVALID');
      const e3 = validatePushSubscriptionInput({
        endpoint: 'https://fcm.googleapis.com/fcm/send/x',
        keys: { p256dh: VALID_P256DH, auth: '!!bad!!' },
      });
      expect(e3.code).toBe('AUTH_INVALID');
    });

    it('sanitizes control characters from userAgent', () => {
      const r = validatePushSubscriptionInput({
        endpoint: 'https://fcm.googleapis.com/fcm/send/x',
        keys: { p256dh: VALID_P256DH, auth: VALID_AUTH },
        userAgent: 'Mozilla/5.0\u0000\u001f',
      });
      expect(r.ok).toBe(true);
      expect(r.value?.userAgent).toBe('Mozilla/5.0');
    });

    it('truncates very long userAgent', () => {
      const r = validatePushSubscriptionInput({
        endpoint: 'https://fcm.googleapis.com/fcm/send/x',
        keys: { p256dh: VALID_P256DH, auth: VALID_AUTH },
        userAgent: 'A'.repeat(WEB_PUSH_LIMITS.USER_AGENT_MAX_CHARS + 30),
      });
      expect(r.ok).toBe(true);
      expect(r.value?.userAgent?.length).toBe(
        WEB_PUSH_LIMITS.USER_AGENT_MAX_CHARS,
      );
    });
  });

  describe('parsePushPreferencesPatch', () => {
    it('returns null for empty / non-object', () => {
      expect(parsePushPreferencesPatch(null)).toBeNull();
      expect(parsePushPreferencesPatch({})).toBeNull();
      expect(parsePushPreferencesPatch('x')).toBeNull();
    });

    it('rejects non-boolean for boolean keys', () => {
      expect(
        parsePushPreferencesPatch({ bossSpawnEnabled: 'yes' as unknown }),
      ).toBeNull();
    });

    it('accepts a single boolean field', () => {
      const r = parsePushPreferencesPatch({ mailEnabled: false });
      expect(r).toEqual({ mailEnabled: false });
    });

    it('accepts quietHours HH:mm and timezone IANA-ish', () => {
      const r = parsePushPreferencesPatch({
        quietHoursStart: '22:00',
        quietHoursEnd: '06:30',
        timezone: 'Asia/Ho_Chi_Minh',
      });
      expect(r).toEqual({
        quietHoursStart: '22:00',
        quietHoursEnd: '06:30',
        timezone: 'Asia/Ho_Chi_Minh',
      });
    });

    it('accepts explicit null to clear quietHours / timezone', () => {
      const r = parsePushPreferencesPatch({
        quietHoursStart: null,
        quietHoursEnd: null,
        timezone: null,
      });
      expect(r).toEqual({
        quietHoursStart: null,
        quietHoursEnd: null,
        timezone: null,
      });
    });

    it('rejects malformed quietHours / timezone', () => {
      expect(
        parsePushPreferencesPatch({ quietHoursStart: '25:00' }),
      ).toBeNull();
      expect(
        parsePushPreferencesPatch({ timezone: 'evil; drop table' }),
      ).toBeNull();
    });
  });

  describe('isInQuietHours', () => {
    const baseTs = Date.UTC(2030, 0, 1, 12, 0, 0); // 12:00 UTC

    it('returns false when start/end null', () => {
      expect(isInQuietHours(baseTs, null, null)).toBe(false);
      expect(isInQuietHours(baseTs, '22:00', null)).toBe(false);
    });

    it('returns false when start == end (zero-window)', () => {
      expect(isInQuietHours(baseTs, '08:00', '08:00')).toBe(false);
    });

    it('handles same-day window (start < end)', () => {
      // 12:00 UTC, window 09:00–13:00 ⇒ inside
      expect(isInQuietHours(baseTs, '09:00', '13:00')).toBe(true);
      // 12:00 UTC, window 13:00–15:00 ⇒ outside
      expect(isInQuietHours(baseTs, '13:00', '15:00')).toBe(false);
    });

    it('handles wrap-around midnight (start > end)', () => {
      const at23 = Date.UTC(2030, 0, 1, 23, 30, 0);
      const at03 = Date.UTC(2030, 0, 1, 3, 30, 0);
      const at12 = Date.UTC(2030, 0, 1, 12, 0, 0);
      // window 22:00 → 06:00 ⇒ 23:30 ✔, 03:30 ✔, 12:00 ✘
      expect(isInQuietHours(at23, '22:00', '06:00')).toBe(true);
      expect(isInQuietHours(at03, '22:00', '06:00')).toBe(true);
      expect(isInQuietHours(at12, '22:00', '06:00')).toBe(false);
    });
  });

  describe('shouldSendPushNotification', () => {
    const now = Date.UTC(2030, 0, 1, 12, 0, 0);

    it('allows first send when enabled and no prior history', () => {
      const r = shouldSendPushNotification({
        type: 'MAIL_NEW',
        nowMs: now,
        prefs: basePrefs(),
      });
      expect(r.ok).toBe(true);
    });

    it('blocks DISABLED if pref toggled off', () => {
      const r = shouldSendPushNotification({
        type: 'MAIL_NEW',
        nowMs: now,
        prefs: { ...basePrefs(), mailEnabled: false },
      });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.reason).toBe('DISABLED');
    });

    it('blocks COOLDOWN when lastSentAtMs within window', () => {
      const r = shouldSendPushNotification({
        type: 'MAIL_NEW',
        nowMs: now,
        prefs: basePrefs(),
        lastSentAtMs: now - 1_000,
      });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.reason).toBe('COOLDOWN');
    });

    it('allows send after cooldown', () => {
      const r = shouldSendPushNotification({
        type: 'MAIL_NEW',
        nowMs: now,
        prefs: basePrefs(),
        lastSentAtMs: now - WEB_PUSH_COOLDOWN_MS.MAIL_NEW - 100,
      });
      expect(r.ok).toBe(true);
    });

    it('respects quiet hours for non-critical types', () => {
      const r = shouldSendPushNotification({
        type: 'STAMINA_FULL',
        nowMs: Date.UTC(2030, 0, 1, 23, 30, 0),
        prefs: {
          ...basePrefs(),
          quietHoursStart: '22:00',
          quietHoursEnd: '06:00',
        },
      });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.reason).toBe('QUIET_HOURS');
    });

    it('BOSS_SPAWN bypasses quiet hours (game-critical event)', () => {
      const r = shouldSendPushNotification({
        type: 'BOSS_SPAWN',
        nowMs: Date.UTC(2030, 0, 1, 23, 30, 0),
        prefs: {
          ...basePrefs(),
          quietHoursStart: '22:00',
          quietHoursEnd: '06:00',
        },
      });
      expect(r.ok).toBe(true);
    });
  });

  describe('buildWebPushPayload', () => {
    it('builds payload and clamps title/body', () => {
      const r = buildWebPushPayload({
        type: 'BOSS_SPAWN',
        title: 'A'.repeat(200),
        body: 'B'.repeat(500),
        url: '/world',
        tag: 'boss-1',
        nowIso: '2030-01-01T00:00:00.000Z',
      });
      expect(r.type).toBe('BOSS_SPAWN');
      expect(r.title.length).toBe(WEB_PUSH_LIMITS.PAYLOAD_TITLE_MAX_CHARS);
      expect(r.body.length).toBe(WEB_PUSH_LIMITS.PAYLOAD_BODY_MAX_CHARS);
      expect(r.url).toBe('/world');
      expect(r.tag).toBe('boss-1');
      expect(r.ts).toBe('2030-01-01T00:00:00.000Z');
    });
  });

  describe('DEFAULT_WEB_PUSH_PREFERENCES', () => {
    it('boss/stamina/mail default ON; daily reminder default OFF (opt-in)', () => {
      expect(DEFAULT_WEB_PUSH_PREFERENCES.bossSpawnEnabled).toBe(true);
      expect(DEFAULT_WEB_PUSH_PREFERENCES.staminaFullEnabled).toBe(true);
      expect(DEFAULT_WEB_PUSH_PREFERENCES.mailEnabled).toBe(true);
      expect(DEFAULT_WEB_PUSH_PREFERENCES.dailyReminderEnabled).toBe(false);
    });
  });
});
