/**
 * Phase 44.1 — WebPushTriggerService integration tests.
 *
 * Tests cover required scenarios #1-5 từ PR brief:
 *   1. Boss spawn gửi đúng user bật `bossSpawnEnabled`.
 *   2. Không gửi nếu prefs OFF.
 *   3. Cooldown chống spam (dedupe + cooldown).
 *   4. Mail mới push nếu bật.
 *   5. Daily reminder cron không gửi trùng.
 *
 * Sử dụng Postgres test DB + dry-run mode (PUSH_DRY_RUN=true) — không gọi
 * gateway thật.
 */
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PrismaService } from '../../common/prisma.service';
import { TEST_DATABASE_URL, makeUserChar, wipeAll } from '../../test-helpers';
import { WebPushService } from './web-push.service';
import { WebPushTriggerService } from './web-push-trigger.service';
import { WebPushDailyReminderScheduler } from './web-push-daily-reminder.scheduler';

const VALID_P256DH = 'BNcRdreALRFXTkOOUHK1EtK2wtaz5Z_test_pad';
const VALID_AUTH = 'k8JV6sjdbMQuKofd2Y_test';

let prisma: PrismaService;
let svc: WebPushService;
let trigger: WebPushTriggerService;

beforeAll(() => {
  process.env.DATABASE_URL = TEST_DATABASE_URL;
  prisma = new PrismaService();
  svc = new WebPushService(prisma);
  trigger = new WebPushTriggerService(prisma, svc);
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

async function makeUser(): Promise<string> {
  const u = await makeUserChar(prisma);
  return u.userId;
}

async function subscribeWithPrefs(
  userId: string,
  prefs: Partial<{
    bossSpawnEnabled: boolean;
    mailEnabled: boolean;
    staminaFullEnabled: boolean;
    dailyReminderEnabled: boolean;
    quietHoursStart: string | null;
    quietHoursEnd: string | null;
  }> = {},
) {
  await svc.subscribe(userId, {
    endpoint: `https://fcm.googleapis.com/fcm/send/${userId}-ep`,
    keys: { p256dh: VALID_P256DH, auth: VALID_AUTH },
    userAgent: 'Mozilla/5.0 (test)',
  });
  await svc.updatePreferences(userId, prefs);
}

describe('Phase 44.1 — WebPushTriggerService', () => {
  describe('notifyBossSpawn', () => {
    it('gửi push cho user opt-in `bossSpawnEnabled` (#1)', async () => {
      const user = await makeUser();
      await subscribeWithPrefs(user, { bossSpawnEnabled: true });

      const res = await trigger.notifyBossSpawn({
        id: 'boss-1',
        bossKey: 'huyet_lang',
        name: 'Huyết Lang',
        level: 30,
        regionKey: 'hac_lam',
      });
      expect(res.sentUserCount).toBe(1);

      const log = await prisma.webPushSendLog.findUnique({
        where: { userId_type: { userId: user, type: 'BOSS_SPAWN' } },
      });
      expect(log).not.toBeNull();
      expect(log?.dedupeKey).toBe('boss:boss-1');
      expect(log?.lastStatus).toBe('DRY_RUN');
    });

    it('KHÔNG gửi nếu user tắt `bossSpawnEnabled` (#2)', async () => {
      const user = await makeUser();
      await subscribeWithPrefs(user, { bossSpawnEnabled: false });

      const res = await trigger.notifyBossSpawn({
        id: 'boss-2',
        bossKey: 'huyet_lang',
        name: 'Huyết Lang',
        level: 30,
        regionKey: 'hac_lam',
      });
      expect(res.sentUserCount).toBe(0);
      const log = await prisma.webPushSendLog.findUnique({
        where: { userId_type: { userId: user, type: 'BOSS_SPAWN' } },
      });
      // sendToUser sẽ short-circuit `DISABLED` trước khi ghi log.
      expect(log).toBeNull();
    });

    it('dedupe cùng `bossId` → gọi 2 lần không gửi trùng (#3)', async () => {
      const user = await makeUser();
      await subscribeWithPrefs(user, { bossSpawnEnabled: true });

      const r1 = await trigger.notifyBossSpawn({
        id: 'boss-3',
        bossKey: 'k',
        name: 'B',
        level: 10,
        regionKey: 'r',
      });
      const r2 = await trigger.notifyBossSpawn({
        id: 'boss-3',
        bossKey: 'k',
        name: 'B',
        level: 10,
        regionKey: 'r',
      });
      expect(r1.sentUserCount).toBe(1);
      expect(r2.sentUserCount).toBe(0);
    });
  });

  describe('notifyMailNew', () => {
    it('gửi push cho user opt-in `mailEnabled` (#4)', async () => {
      const user = await makeUser();
      await subscribeWithPrefs(user, { mailEnabled: true });

      await trigger.notifyMailNew({
        userId: user,
        mailId: 'mail-1',
        subject: 'Quà tân thủ',
        senderName: 'GM',
      });

      const log = await prisma.webPushSendLog.findUnique({
        where: { userId_type: { userId: user, type: 'MAIL_NEW' } },
      });
      expect(log).not.toBeNull();
      expect(log?.dedupeKey).toBe('mail:mail-1');
    });

    it('không gửi nếu `mailEnabled=false`', async () => {
      const user = await makeUser();
      await subscribeWithPrefs(user, { mailEnabled: false });

      await trigger.notifyMailNew({
        userId: user,
        mailId: 'mail-2',
        subject: 'X',
        senderName: 'Y',
      });
      const log = await prisma.webPushSendLog.findUnique({
        where: { userId_type: { userId: user, type: 'MAIL_NEW' } },
      });
      expect(log).toBeNull();
    });
  });

  describe('runDailyReminder', () => {
    it('cron chỉ gửi 1 lần / `dateKey` (#5)', async () => {
      const user = await makeUser();
      await subscribeWithPrefs(user, { dailyReminderEnabled: true });

      const r1 = await trigger.runDailyReminder({ dateKey: '2026-05-14' });
      const r2 = await trigger.runDailyReminder({ dateKey: '2026-05-14' });
      expect(r1.sentUserCount).toBe(1);
      // Lần 2 cùng dateKey → dedupeKey hit → 0 send.
      expect(r2.sentUserCount).toBe(0);
    });

    it('không gửi cho user `dailyReminderEnabled=false`', async () => {
      const user = await makeUser();
      // Default `dailyReminderEnabled` = false (xem DEFAULT_WEB_PUSH_PREFERENCES).
      await subscribeWithPrefs(user, { dailyReminderEnabled: false });

      const res = await trigger.runDailyReminder({ dateKey: '2026-05-14' });
      // user không trong candidate list → candidateCount=0.
      expect(res.candidateCount).toBe(0);
      expect(res.sentUserCount).toBe(0);
    });
  });

  describe('fail-soft', () => {
    it('push gate OFF → notifyBossSpawn không crash', async () => {
      svc.setEnvSnapshotForTesting({ pushEnabled: false });
      const res = await trigger.notifyBossSpawn({
        id: 'boss-x',
        bossKey: 'k',
        name: 'B',
        level: 10,
        regionKey: 'r',
      });
      expect(res.sentUserCount).toBe(0);
    });
  });

  describe('WebPushDailyReminderScheduler', () => {
    it('runOnce skip ngoài giờ target', async () => {
      const sch = new WebPushDailyReminderScheduler(trigger);
      process.env.WEB_PUSH_DAILY_REMINDER_HOUR_UTC = '12';
      // 2026-05-14 00:00 UTC = hour 0 ≠ target 12.
      const res = await sch.runOnce(Date.UTC(2026, 4, 14, 0, 0, 0));
      expect(res.skipped).toBe(true);
    });

    it('runOnce 2 lần cùng ngày target hour → lần 2 skipped (in-memory guard)', async () => {
      const user = await makeUser();
      await subscribeWithPrefs(user, { dailyReminderEnabled: true });
      const sch = new WebPushDailyReminderScheduler(trigger);
      process.env.WEB_PUSH_DAILY_REMINDER_HOUR_UTC = '12';
      const t = Date.UTC(2026, 4, 14, 12, 0, 0);
      const r1 = await sch.runOnce(t);
      const r2 = await sch.runOnce(t);
      expect(r1.skipped).toBe(false);
      expect(r2.skipped).toBe(true);
    });
  });
});
