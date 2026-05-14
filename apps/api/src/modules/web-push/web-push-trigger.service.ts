import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../common/prisma.service';
import { WebPushService } from './web-push.service';

/**
 * Phase 44.1 — Web Push trigger composer.
 *
 * Mục đích: cung cấp các method cao tầng để các module gameplay (Boss, Mail,
 * Stamina cron, Daily reminder cron) trigger push notification mà KHÔNG cần
 * biết chi tiết VAPID / dedupe / cooldown.
 *
 * Tất cả method ở đây đều **fail-soft**: nếu push fail (gateway lỗi, prefs
 * tắt, cooldown chưa hết, env chưa cấu hình) → log warning + return, KHÔNG
 * throw. Caller không cần wrap try-catch.
 *
 * Dedupe key strategy (để 1 event KHÔNG gửi trùng cho cùng user):
 *   - `boss:{bossId}`
 *   - `mail:{mailId}`
 *   - `stamina-full:{userId}:{dateKey}`
 *   - `daily-reminder:{dateKey}`
 */
@Injectable()
export class WebPushTriggerService {
  private readonly logger = new Logger(WebPushTriggerService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly webPush: WebPushService,
  ) {}

  // ---------------------------------------------------------------------------
  // Boss spawn — broadcast tới mọi user bật `bossSpawnEnabled`.
  // ---------------------------------------------------------------------------
  /**
   * Gửi push cho mọi user đã opt-in `bossSpawnEnabled`. Dedupe theo `bossId`
   * — 1 boss spawn chỉ gửi 1 lần per user.
   */
  async notifyBossSpawn(boss: {
    id: string;
    bossKey: string;
    name: string;
    level: number;
    regionKey: string | null;
  }): Promise<{ sentUserCount: number }> {
    if (!this.webPush.isPushEnabled()) {
      this.logger.debug('notifyBossSpawn: push disabled, skip');
      return { sentUserCount: 0 };
    }
    let users: { userId: string }[];
    try {
      users = await this.prisma.userPushPreferences.findMany({
        where: { bossSpawnEnabled: true },
        select: { userId: true },
      });
    } catch (e) {
      this.logger.warn(
        `notifyBossSpawn: prisma error ${(e as Error).message}, skip`,
      );
      return { sentUserCount: 0 };
    }
    let sent = 0;
    for (const u of users) {
      const ok = await this.safeSend(u.userId, 'BOSS_SPAWN', {
        title: `Boss ${boss.name} xuất hiện!`,
        body: `Boss ${boss.name} Lv${boss.level} đã xuất hiện. Vào đánh ngay!`,
        url: '/boss',
        tag: `boss-${boss.bossKey}`,
        dedupeKey: `boss:${boss.id}`,
      });
      if (ok) sent += 1;
    }
    return { sentUserCount: sent };
  }

  // ---------------------------------------------------------------------------
  // Mail new — gửi push cho recipient khi có thư mới.
  // ---------------------------------------------------------------------------
  async notifyMailNew(input: {
    userId: string;
    mailId: string;
    subject: string;
    senderName: string;
  }): Promise<void> {
    await this.safeSend(input.userId, 'MAIL_NEW', {
      title: `Thư mới từ ${input.senderName}`,
      body: input.subject,
      url: '/mail',
      tag: `mail-${input.mailId}`,
      dedupeKey: `mail:${input.mailId}`,
    });
  }

  // ---------------------------------------------------------------------------
  // Stamina full — gửi push khi player stamina = max và `staminaFullEnabled`.
  // ---------------------------------------------------------------------------
  /**
   * Stamina full notification. Dedupe theo `(userId, dateKey)` để mỗi user
   * tối đa 1 stamina-full push/ngày — tránh spam khi player liên tục đầy.
   */
  async notifyStaminaFull(input: {
    userId: string;
    dateKey: string;
  }): Promise<void> {
    await this.safeSend(input.userId, 'STAMINA_FULL', {
      title: 'Thể lực đã đầy',
      body: 'Thể lực của bạn đã hồi đầy. Vào đánh quái / bí cảnh thôi!',
      url: '/home',
      tag: 'stamina-full',
      dedupeKey: `stamina-full:${input.userId}:${input.dateKey}`,
    });
  }

  // ---------------------------------------------------------------------------
  // Daily reminder cron — gửi push cho mọi user bật `dailyReminderEnabled`.
  // ---------------------------------------------------------------------------
  /**
   * Run daily reminder pass. Dedupe theo `dateKey` → mỗi user chỉ nhận 1
   * reminder/ngày. Cooldown 23h ở `WEB_PUSH_COOLDOWN_MS.DAILY_REMINDER`
   * cung cấp lớp guard thứ hai (chạy cron lệch giờ → vẫn không spam).
   */
  async runDailyReminder(input: { dateKey: string }): Promise<{
    sentUserCount: number;
    candidateCount: number;
  }> {
    if (!this.webPush.isPushEnabled()) {
      this.logger.debug('runDailyReminder: push disabled, skip');
      return { sentUserCount: 0, candidateCount: 0 };
    }
    let users: { userId: string }[];
    try {
      users = await this.prisma.userPushPreferences.findMany({
        where: { dailyReminderEnabled: true },
        select: { userId: true },
      });
    } catch (e) {
      this.logger.warn(
        `runDailyReminder: prisma error ${(e as Error).message}, skip`,
      );
      return { sentUserCount: 0, candidateCount: 0 };
    }
    let sent = 0;
    for (const u of users) {
      const ok = await this.safeSend(u.userId, 'DAILY_REMINDER', {
        title: 'Tu sĩ ơi, đã điểm danh hôm nay chưa?',
        body: 'Vào nhận thưởng điểm danh + tu luyện thêm chút nào.',
        url: '/daily-login',
        tag: 'daily-reminder',
        dedupeKey: `daily-reminder:${input.dateKey}`,
      });
      if (ok) sent += 1;
    }
    return { sentUserCount: sent, candidateCount: users.length };
  }

  // ---------------------------------------------------------------------------
  // Internal: fail-soft wrapper.
  // ---------------------------------------------------------------------------
  private async safeSend(
    userId: string,
    type: 'BOSS_SPAWN' | 'STAMINA_FULL' | 'MAIL_NEW' | 'DAILY_REMINDER',
    payload: {
      title: string;
      body: string;
      url: string;
      tag: string;
      dedupeKey: string;
    },
  ): Promise<boolean> {
    try {
      const outcome = await this.webPush.sendToUser(userId, type, payload);
      return outcome.ok;
    } catch (e) {
      // sendToUser KHÔNG được throw, nhưng phòng hờ — đảm bảo cron/boss spawn
      // KHÔNG bao giờ crash do push gateway lỗi.
      this.logger.warn(
        `safeSend: unexpected throw type=${type} user=${userId}: ${(e as Error).message}`,
      );
      return false;
    }
  }
}
