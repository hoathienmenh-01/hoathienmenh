import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { WebPushService } from './web-push.service';

/**
 * Phase 44.1 — Daily reminder cron scheduler (lightweight in-process timer).
 *
 * Mục tiêu:
 *   - Gọi `WebPushService.dispatchDailyReminders()` mỗi 24h (default).
 *   - Đọc env `WEB_PUSH_DAILY_REMINDER_CRON_ENABLED` (default `false`,
 *     opt-in để tránh fan-out push sai trong dev/test).
 *   - Đọc env `WEB_PUSH_DAILY_REMINDER_INTERVAL_MS` (override interval
 *     cho test, default `86_400_000` ms = 24h).
 *
 * Idempotency:
 *   - Mỗi run dùng dedupeKey `daily-reminder-<UTC-date>` ⇒ nếu cron re-fire
 *     trong cùng ngày (ví dụ restart process) thì `sendToUser` block
 *     `COOLDOWN` không gửi trùng (preference catalog đã cooldown 23h
 *     cho DAILY_REMINDER).
 *
 * Race-safety:
 *   - Single-instance khuyến nghị. Multi-instance vẫn an toàn vì
 *     dedupeKey check trong `WebPushSendLog` (unique per user/type).
 *
 * Test seam:
 *   - Toàn bộ flow logic vẫn nằm trong `WebPushService.dispatchDailyReminders()`
 *     (đã có test riêng). Scheduler class chỉ là wrapper timer.
 */
@Injectable()
export class WebPushDailyReminderScheduler
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(WebPushDailyReminderScheduler.name);
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(private readonly webPush: WebPushService) {}

  onModuleInit(): void {
    const enabled =
      String(process.env.WEB_PUSH_DAILY_REMINDER_CRON_ENABLED ?? 'false') ===
      'true';
    if (!enabled) {
      this.logger.log(
        'daily reminder cron disabled (WEB_PUSH_DAILY_REMINDER_CRON_ENABLED=false)',
      );
      return;
    }
    const intervalMsRaw = Number(
      process.env.WEB_PUSH_DAILY_REMINDER_INTERVAL_MS ?? 86_400_000,
    );
    const intervalMs =
      Number.isFinite(intervalMsRaw) && intervalMsRaw >= 60_000
        ? intervalMsRaw
        : 86_400_000;
    this.timer = setInterval(() => {
      this.runOnce().catch((e) =>
        this.logger.error('daily reminder cron error', e as Error),
      );
    }, intervalMs);
    // Run-once shortly after boot (60s) — không gọi đồng bộ trong onModuleInit
    // để không block bootstrap.
    setTimeout(() => {
      this.runOnce().catch(() => undefined);
    }, 60_000);
    this.logger.log(
      `daily reminder cron registered intervalMs=${intervalMs}`,
    );
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  /**
   * Public method (test seam) — gọi 1 lần dispatch. Bọc try/catch để 1
   * lần dispatch fail không stop timer.
   */
  async runOnce(): Promise<void> {
    try {
      const res = await this.webPush.dispatchDailyReminders();
      this.logger.log(
        `daily reminder dispatched attempted=${res.attempted} ok=${res.ok} blocked=${res.blocked} errors=${res.errors}`,
      );
    } catch (e) {
      this.logger.warn(`daily reminder dispatch failed: ${(e as Error).message}`);
    }
  }
}
