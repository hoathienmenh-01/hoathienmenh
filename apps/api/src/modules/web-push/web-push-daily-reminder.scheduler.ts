import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { WebPushTriggerService } from './web-push-trigger.service';

/**
 * Phase 44.1 — Daily reminder cron scheduler (lightweight in-process timer).
 *
 * Trigger `WebPushTriggerService.runDailyReminder({ dateKey })` mỗi tick.
 * Tick gate-by-hour ở UTC (mặc định hour=12) — chỉ fire nếu giờ hiện tại
 * khớp `WEB_PUSH_DAILY_REMINDER_HOUR_UTC`. Tránh fan-out nhiều lần / ngày.
 *
 * Env:
 *   - `WEB_PUSH_DAILY_REMINDER_CRON_ENABLED` (default `false`).
 *   - `WEB_PUSH_DAILY_REMINDER_INTERVAL_MS` (default 3,600,000 ms = 1h —
 *     tick mỗi giờ, gate-by-hour quyết định có fire hay không).
 *   - `WEB_PUSH_DAILY_REMINDER_HOUR_UTC` (default 12 — giờ UTC để fire).
 *
 * Idempotency:
 *   - `lastDispatchedDateKey` in-memory guard: nếu cron re-fire trong cùng
 *     ngày UTC → `runOnce` trả về `{skipped: true}`.
 *   - Trigger layer (`WebPushTriggerService.runDailyReminder`) cũng dedupe
 *     bằng `dedupeKey = daily-reminder:${dateKey}` ở `WebPushSendLog`
 *     (defence in depth).
 */
@Injectable()
export class WebPushDailyReminderScheduler
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(WebPushDailyReminderScheduler.name);
  private timer: ReturnType<typeof setInterval> | null = null;
  private lastDispatchedDateKey: string | null = null;

  constructor(private readonly trigger: WebPushTriggerService) {}

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
      process.env.WEB_PUSH_DAILY_REMINDER_INTERVAL_MS ?? 3_600_000,
    );
    const intervalMs =
      Number.isFinite(intervalMsRaw) && intervalMsRaw >= 60_000
        ? intervalMsRaw
        : 3_600_000;
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
   * Public method (test seam) — gọi 1 lần dispatch.
   *
   * @param nowMs Optional. Default `Date.now()`. Test có thể truyền giờ cụ
   *   thể để verify hour gate.
   * @returns `{skipped: true}` nếu hour không match target hoặc đã dispatch
   *   trong cùng ngày UTC. `{skipped: false, ...}` nếu đã chạy thật.
   */
  async runOnce(
    nowMs: number = Date.now(),
  ): Promise<
    | { skipped: true; reason: 'HOUR_GATE' | 'ALREADY_DISPATCHED' }
    | { skipped: false; sentUserCount: number; candidateCount: number }
  > {
    const targetHourRaw = Number(
      process.env.WEB_PUSH_DAILY_REMINDER_HOUR_UTC ?? 12,
    );
    const targetHour =
      Number.isFinite(targetHourRaw) && targetHourRaw >= 0 && targetHourRaw <= 23
        ? Math.floor(targetHourRaw)
        : 12;
    const now = new Date(nowMs);
    if (now.getUTCHours() !== targetHour) {
      return { skipped: true, reason: 'HOUR_GATE' };
    }
    const dateKey = `${now.getUTCFullYear()}-${String(
      now.getUTCMonth() + 1,
    ).padStart(2, '0')}-${String(now.getUTCDate()).padStart(2, '0')}`;
    if (this.lastDispatchedDateKey === dateKey) {
      return { skipped: true, reason: 'ALREADY_DISPATCHED' };
    }
    try {
      const res = await this.trigger.runDailyReminder({ dateKey });
      this.lastDispatchedDateKey = dateKey;
      this.logger.log(
        `daily reminder dispatched dateKey=${dateKey} sent=${res.sentUserCount}/${res.candidateCount}`,
      );
      return {
        skipped: false,
        sentUserCount: res.sentUserCount,
        candidateCount: res.candidateCount,
      };
    } catch (e) {
      this.logger.warn(
        `daily reminder dispatch failed dateKey=${dateKey}: ${(e as Error).message}`,
      );
      // Không set lastDispatchedDateKey để cron có thể retry trong cùng giờ.
      return { skipped: false, sentUserCount: 0, candidateCount: 0 };
    }
  }
}
