/**
 * Phase PWA-1 — WebPushService integration tests.
 *
 * Cần Postgres (CI provisions postgres:16-alpine).
 */
import { HttpException } from '@nestjs/common';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PrismaService } from '../../common/prisma.service';
import { TEST_DATABASE_URL, makeUserChar, wipeAll } from '../../test-helpers';
import { WebPushService, type WebPushClient } from './web-push.service';

const VALID_P256DH = 'BNcRdreALRFXTkOOUHK1EtK2wtaz5Z_test_pad';
const VALID_AUTH = 'k8JV6sjdbMQuKofd2Y_test';

let prisma: PrismaService;
let svc: WebPushService;

beforeAll(() => {
  process.env.DATABASE_URL = TEST_DATABASE_URL;
  prisma = new PrismaService();
  svc = new WebPushService(prisma);
});

beforeEach(async () => {
  await wipeAll(prisma);
  svc.setEnvSnapshotForTesting({
    vapidPublicKey: 'pub-key-test',
    vapidPrivateKey: 'priv-key-test',
    vapidSubject: 'mailto:test@example.com',
    pushEnabled: true,
    pushDryRun: true,
  });
});

async function makeUser() {
  const u = await makeUserChar(prisma);
  return u.userId;
}

function subPayload(endpointSuffix = 'abc') {
  return {
    endpoint: `https://fcm.googleapis.com/fcm/send/${endpointSuffix}`,
    keys: { p256dh: VALID_P256DH, auth: VALID_AUTH },
    userAgent: 'Mozilla/5.0 (test)',
  };
}

describe('Phase PWA-1 — WebPushService', () => {
  describe('getPublicKey', () => {
    it('returns configured VAPID_PUBLIC_KEY', () => {
      expect(svc.getPublicKey()).toBe('pub-key-test');
    });

    it('throws 404 VAPID_NOT_CONFIGURED when missing', () => {
      svc.setEnvSnapshotForTesting({ vapidPublicKey: '', vapidPrivateKey: '' });
      try {
        svc.getPublicKey();
        expect.fail('should throw');
      } catch (err) {
        expect(err).toBeInstanceOf(HttpException);
        const body = (err as HttpException).getResponse() as { error: { code: string } };
        expect(body.error.code).toBe('VAPID_NOT_CONFIGURED');
      }
    });
  });

  describe('subscribe', () => {
    it('persists a valid subscription and creates prefs lazily', async () => {
      const userId = await makeUser();
      const view = await svc.subscribe(userId, subPayload('e1'));
      expect(view.endpoint).toContain('e1');
      expect(view.enabled).toBe(true);
      expect(view.userAgent).toBe('Mozilla/5.0 (test)');
      const prefs = await prisma.userPushPreferences.findUnique({
        where: { userId },
      });
      expect(prefs).not.toBeNull();
      expect(prefs?.mailEnabled).toBe(true);
      expect(prefs?.dailyReminderEnabled).toBe(false);
    });

    it('is idempotent on same endpoint (upsert)', async () => {
      const userId = await makeUser();
      const a = await svc.subscribe(userId, subPayload('e1'));
      const b = await svc.subscribe(userId, subPayload('e1'));
      expect(a.id).toBe(b.id);
      const count = await prisma.webPushSubscription.count({
        where: { userId },
      });
      expect(count).toBe(1);
    });

    it('rejects malformed input', async () => {
      const userId = await makeUser();
      await expect(
        svc.subscribe(userId, { endpoint: 'ftp://bad', keys: {} }),
      ).rejects.toBeInstanceOf(HttpException);
    });

    it('rebinds endpoint when posted by another user (device account swap)', async () => {
      const userA = await makeUser();
      const userB = await makeUser();
      await svc.subscribe(userA, subPayload('shared'));
      const v = await svc.subscribe(userB, subPayload('shared'));
      expect(v.endpoint).toContain('shared');
      const row = await prisma.webPushSubscription.findUnique({
        where: { endpoint: v.endpoint },
      });
      expect(row?.userId).toBe(userB);
    });
  });

  describe('unsubscribe', () => {
    it('soft-disables and is idempotent', async () => {
      const userId = await makeUser();
      const view = await svc.subscribe(userId, subPayload('e1'));
      await svc.unsubscribe(userId, view.endpoint);
      const row = await prisma.webPushSubscription.findUnique({
        where: { endpoint: view.endpoint },
      });
      expect(row?.enabled).toBe(false);
      // Idempotent: unknown endpoint = no-op.
      await expect(svc.unsubscribe(userId, 'https://nope')).resolves.toBeUndefined();
    });

    it('rejects cross-user unsubscribe', async () => {
      const userA = await makeUser();
      const userB = await makeUser();
      const view = await svc.subscribe(userA, subPayload('e1'));
      await expect(svc.unsubscribe(userB, view.endpoint)).rejects.toBeInstanceOf(
        HttpException,
      );
    });
  });

  describe('preferences', () => {
    it('upserts default row on first get', async () => {
      const userId = await makeUser();
      const prefs = await svc.getPreferences(userId);
      expect(prefs.bossSpawnEnabled).toBe(true);
      expect(prefs.dailyReminderEnabled).toBe(false);
    });

    it('updates per-type flags + quietHours + timezone', async () => {
      const userId = await makeUser();
      await svc.getPreferences(userId);
      const next = await svc.updatePreferences(userId, {
        mailEnabled: false,
        dailyReminderEnabled: true,
        quietHoursStart: '22:00',
        quietHoursEnd: '06:00',
        timezone: 'Asia/Ho_Chi_Minh',
      });
      expect(next.mailEnabled).toBe(false);
      expect(next.dailyReminderEnabled).toBe(true);
      expect(next.quietHoursStart).toBe('22:00');
      expect(next.quietHoursEnd).toBe('06:00');
      expect(next.timezone).toBe('Asia/Ho_Chi_Minh');
    });

    it('rejects malformed patch', async () => {
      const userId = await makeUser();
      await expect(
        svc.updatePreferences(userId, { quietHoursStart: '99:99' }),
      ).rejects.toBeInstanceOf(HttpException);
    });
  });

  describe('sendToUser (dry-run)', () => {
    it('returns ok dry-run when prefs allow + subscription present', async () => {
      const userId = await makeUser();
      await svc.subscribe(userId, subPayload('e1'));
      const out = await svc.sendToUser(userId, 'MAIL_NEW', {
        title: 'Mail mới',
        body: 'Bạn có 1 mail mới',
      });
      expect(out.ok).toBe(true);
      expect(out.dryRun).toBe(true);
      const log = await prisma.webPushSendLog.findUnique({
        where: { userId_type: { userId, type: 'MAIL_NEW' } },
      });
      expect(log?.lastStatus).toBe('DRY_RUN');
    });

    it('returns GATE_OFF when PUSH_ENABLED=false', async () => {
      const userId = await makeUser();
      await svc.subscribe(userId, subPayload('e1'));
      svc.setEnvSnapshotForTesting({ pushEnabled: false });
      const out = await svc.sendToUser(userId, 'MAIL_NEW', {
        title: 'x',
        body: 'y',
      });
      expect(out.ok).toBe(false);
      expect(out.reason).toBe('GATE_OFF');
    });

    it('returns NO_SUB when no enabled subscription exists', async () => {
      const userId = await makeUser();
      const out = await svc.sendToUser(userId, 'MAIL_NEW', {
        title: 'x',
        body: 'y',
      });
      expect(out.ok).toBe(false);
      expect(out.reason).toBe('NO_SUB');
    });

    it('respects DISABLED preference', async () => {
      const userId = await makeUser();
      await svc.subscribe(userId, subPayload('e1'));
      await svc.updatePreferences(userId, { mailEnabled: false });
      const out = await svc.sendToUser(userId, 'MAIL_NEW', {
        title: 'x',
        body: 'y',
      });
      expect(out.ok).toBe(false);
      expect(out.reason).toBe('DISABLED');
    });

    it('respects COOLDOWN window (per type)', async () => {
      const userId = await makeUser();
      await svc.subscribe(userId, subPayload('e1'));
      // First call ok.
      const a = await svc.sendToUser(userId, 'MAIL_NEW', {
        title: 'x',
        body: 'y',
      });
      expect(a.ok).toBe(true);
      // Second call within cooldown → BLOCKED.
      const b = await svc.sendToUser(userId, 'MAIL_NEW', {
        title: 'x2',
        body: 'y2',
      });
      expect(b.ok).toBe(false);
      expect(b.reason).toBe('COOLDOWN');
    });

    it('dedupeKey blocks repeat with same key', async () => {
      const userId = await makeUser();
      await svc.subscribe(userId, subPayload('e1'));
      const a = await svc.sendToUser(userId, 'BOSS_SPAWN', {
        title: 'Boss',
        body: 'Spawned',
        dedupeKey: 'boss-zone-1-2025-01-01',
      });
      expect(a.ok).toBe(true);
      const b = await svc.sendToUser(userId, 'BOSS_SPAWN', {
        title: 'Boss',
        body: 'Spawned again',
        dedupeKey: 'boss-zone-1-2025-01-01',
      });
      expect(b.ok).toBe(false);
      expect(b.reason).toBe('COOLDOWN');
    });

    it('respects quiet hours for non-critical types', async () => {
      const userId = await makeUser();
      await svc.subscribe(userId, subPayload('e1'));
      // Set quiet hours covering "now": start 00:00 → end 23:59.
      await svc.updatePreferences(userId, {
        quietHoursStart: '00:00',
        quietHoursEnd: '23:59',
      });
      const out = await svc.sendToUser(userId, 'STAMINA_FULL', {
        title: 'Stamina',
        body: 'Full',
      });
      expect(out.ok).toBe(false);
      expect(out.reason).toBe('QUIET_HOURS');
    });
  });

  describe('sendToUser (live mode + mocked client)', () => {
    it('marks subscription invalid on 410 Gone response', async () => {
      const userId = await makeUser();
      await svc.subscribe(userId, subPayload('e1'));
      svc.setEnvSnapshotForTesting({ pushDryRun: false });
      const mockClient: WebPushClient = {
        setVapidDetails() {},
        async sendNotification() {
          const err = new Error('Gone') as unknown as { statusCode: number };
          err.statusCode = 410;
          throw err as unknown as Error;
        },
      };
      svc.setWebPushClientFactoryForTesting(() => mockClient);
      const out = await svc.sendToUser(userId, 'MAIL_NEW', {
        title: 'x',
        body: 'y',
      });
      expect(out.ok).toBe(false);
      expect(out.invalidatedCount).toBe(1);
      const row = await prisma.webPushSubscription.findFirst({
        where: { userId },
      });
      expect(row?.enabled).toBe(false);
    });

    it('logs success and updates lastUsedAt on 201/200', async () => {
      const userId = await makeUser();
      await svc.subscribe(userId, subPayload('e1'));
      svc.setEnvSnapshotForTesting({ pushDryRun: false });
      const mockClient: WebPushClient = {
        setVapidDetails() {},
        async sendNotification() {
          return { statusCode: 201, body: '', headers: {} };
        },
      };
      svc.setWebPushClientFactoryForTesting(() => mockClient);
      const out = await svc.sendToUser(userId, 'MAIL_NEW', {
        title: 'x',
        body: 'y',
      });
      expect(out.ok).toBe(true);
      expect(out.sentCount).toBe(1);
      const row = await prisma.webPushSubscription.findFirst({
        where: { userId },
      });
      expect(row?.lastUsedAt).not.toBeNull();
      expect(row?.failureCount).toBe(0);
    });
  });

  describe('cleanupStaleSubscriptions', () => {
    it('hard-deletes rows with failureCount >= threshold and disabled', async () => {
      const userId = await makeUser();
      const view = await svc.subscribe(userId, subPayload('e1'));
      await prisma.webPushSubscription.update({
        where: { id: view.id },
        data: { enabled: false, failureCount: 10 },
      });
      const res = await svc.cleanupStaleSubscriptions();
      expect(res.deleted).toBe(1);
      const count = await prisma.webPushSubscription.count({
        where: { userId },
      });
      expect(count).toBe(0);
    });
  });

  describe('listTypes / defaults', () => {
    it('exposes 4 types', () => {
      expect(svc.listTypes()).toEqual([
        'BOSS_SPAWN',
        'STAMINA_FULL',
        'MAIL_NEW',
        'DAILY_REMINDER',
      ]);
    });

    it('default prefs match catalog (mail/boss/stamina ON, daily OFF)', () => {
      const d = svc.getDefaultPreferences();
      expect(d.mailEnabled).toBe(true);
      expect(d.dailyReminderEnabled).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------
  // Phase 44.1 — broadcast helpers: eligible discovery + bulk fan-out.
  // ---------------------------------------------------------------------------
  describe('Phase 44.1 broadcast helpers', () => {
    it('findEligibleUserIds(BOSS_SPAWN) trả user opt-in + có subscription enabled', async () => {
      // u1 — opted in (default), has sub.
      const u1 = await makeUser();
      await svc.subscribe(u1, subPayload('e-u1'));
      // u2 — opted in (default), KHÔNG có sub → exclude.
      const u2 = await makeUser();
      await prisma.userPushPreferences.create({ data: { userId: u2 } });
      // u3 — opted OUT, có sub → exclude.
      const u3 = await makeUser();
      await svc.subscribe(u3, subPayload('e-u3'));
      await prisma.userPushPreferences.update({
        where: { userId: u3 },
        data: { bossSpawnEnabled: false },
      });
      const eligible = await svc.findEligibleUserIds('BOSS_SPAWN');
      expect(eligible).toContain(u1);
      expect(eligible).not.toContain(u2);
      expect(eligible).not.toContain(u3);
    });

    it('boss spawn broadcast — chỉ user bật notification nhận push (Test #1)', async () => {
      const userOptIn = await makeUser();
      const userOptOut = await makeUser();
      await svc.subscribe(userOptIn, subPayload('boss-in'));
      await svc.subscribe(userOptOut, subPayload('boss-out'));
      await prisma.userPushPreferences.update({
        where: { userId: userOptOut },
        data: { bossSpawnEnabled: false },
      });
      const eligible = await svc.findEligibleUserIds('BOSS_SPAWN');
      const res = await svc.broadcastToUsers(eligible, 'BOSS_SPAWN', {
        title: 'Boss',
        body: 'spawn',
        url: '/boss',
        dedupeKey: 'boss:spawn:test',
      });
      expect(res.attempted).toBe(1);
      expect(res.ok).toBe(1);
      const logs = await prisma.webPushSendLog.findMany();
      const ids = logs.map((l) => l.userId);
      expect(ids).toContain(userOptIn);
      expect(ids).not.toContain(userOptOut);
    });

    it('cooldown chống spam — broadcast 2 lần cùng dedupeKey, lần 2 bị COOLDOWN (Test #3)', async () => {
      const u = await makeUser();
      await svc.subscribe(u, subPayload('cd'));
      const r1 = await svc.broadcastToUsers([u], 'BOSS_SPAWN', {
        title: 'Boss',
        body: 'spawn',
        dedupeKey: 'boss:spawn:cd-test',
      });
      expect(r1.ok).toBe(1);
      const r2 = await svc.broadcastToUsers([u], 'BOSS_SPAWN', {
        title: 'Boss',
        body: 'spawn',
        dedupeKey: 'boss:spawn:cd-test', // cùng dedupeKey
      });
      // Lần 2: blocked bởi dedupeKey duplicate check.
      expect(r2.ok).toBe(0);
      expect(r2.blocked).toBe(1);
    });

    it('dispatchDailyReminders không gửi user tắt preference (Test #5)', async () => {
      // u1: bật daily reminder.
      const u1 = await makeUser();
      await svc.subscribe(u1, subPayload('d1'));
      await prisma.userPushPreferences.update({
        where: { userId: u1 },
        data: { dailyReminderEnabled: true },
      });
      // u2: tắt daily reminder (default).
      const u2 = await makeUser();
      await svc.subscribe(u2, subPayload('d2'));
      const res = await svc.dispatchDailyReminders({ limit: 10 });
      expect(res.attempted).toBe(1);
      expect(res.ok).toBe(1);
      // Re-run trong cùng dateKey: dedupeKey block → 0 send mới.
      const res2 = await svc.dispatchDailyReminders({ limit: 10 });
      expect(res2.ok).toBe(0);
    });
  });
});
