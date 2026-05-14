import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { WebPushTriggerService } from './web-push-trigger.service';

/**
 * Phase 44.1 — Daily reminder scheduler (Web Push).
 *
 * Sequence:
 *   - setInterval mỗi 10 phút.
 *   - Tại tick, nếu `nowUTC.hour === WEB_PUSH_DAILY_REMINDER_HOUR_UTC` thì gọi
 *     `WebPushTriggerService.runDailyReminder({ dateKey })`.
 *   - `dateKey` = `YYYY-MM-DD` UTC → mỗi ngày 1 lần (dedupeKey trùng → skip).
 *
 * Idempotency layers (defense in depth):
 *   1. dedupeKey `daily-reminder:{dateKey}` ở `WebPushSendLog` (per user/type).
 *   2. Cooldown 23h ở `WEB_PUSH_COOLDOWN_MS.DAILY_REMINDER` (per user/type).
 *   3. setInterval-only check `nowUTC.hour === targetHour` → 1 tick fire/hour
 *      (vài tick trong giờ đó vẫn no-op vì dedupeKey).
 *
 * Env gate:
 *   - `WEB_PUSH_DAILY_REMINDER_ENABLED=true` để bật scheduler.
 *   - `WEB_PUSH_DAILY_REMINDER_HOUR_UTC=12` (default → 19h VN).
 *
 * Test seam: `runOnce()` cho tests gọi trực tiếp KHÔNG cần đợi setInterval.
 */
@Injectable()
export class WebPushDailyReminderScheduler
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(WebPushDailyReminderScheduler.name);
  private timer: ReturnType<typeof setInterval> | null = null;
  private lastTriggeredDateKey: string | null = null;

  constructor(private readonly trigger: WebPushTriggerService) {}

  onModuleInit(): void {
    if (!this.isEnabled()) {
      this.logger.log(
        'daily reminder scheduler disabled (WEB_PUSH_DAILY_REMINDER_ENABLED!=true)',
      );
      return;
    }
    this.timer = setInterval(
      () => this.tick().catch(() => undefined),
      10 * 60 * 1000,
    );
    this.logger.log(
      `daily reminder scheduler enabled (hour=${this.targetHourUTC()})`,
    );
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  /** Test-only seam: trigger one pass. Returns `runDailyReminder` outcome. */
  async runOnce(nowMs: number = Date.now()): Promise<{
    sentUserCount: number;
    candidateCount: number;
    skipped: boolean;
  }> {
    const now = new Date(nowMs);
    const hour = now.getUTCHours();
    const dateKey = formatDateKeyUTC(now);
    if (hour !== this.targetHourUTC()) {
      return { sentUserCount: 0, candidateCount: 0, skipped: true };
    }
    if (this.lastTriggeredDateKey === dateKey) {
      return { sentUserCount: 0, candidateCount: 0, skipped: true };
    }
    const out = await this.trigger.runDailyReminder({ dateKey });
    this.lastTriggeredDateKey = dateKey;
    return { ...out, skipped: false };
  }

  private async tick(): Promise<void> {
    try {
      const res = await this.runOnce();
      if (!res.skipped) {
        this.logger.log(
          `daily reminder pass: sent=${res.sentUserCount} candidates=${res.candidateCount}`,
        );
      }
    } catch (e) {
      // Defensive: KHÔNG cho cron tick crash worker.
      this.logger.warn(`daily reminder tick error: ${(e as Error).message}`);
    }
  }

  private isEnabled(): boolean {
    return String(process.env.WEB_PUSH_DAILY_REMINDER_ENABLED ?? 'false') === 'true';
  }

  private targetHourUTC(): number {
    const raw = Number(process.env.WEB_PUSH_DAILY_REMINDER_HOUR_UTC ?? '12');
    if (!Number.isFinite(raw) || raw < 0 || raw > 23) return 12;
    return Math.floor(raw);
  }
}

function formatDateKeyUTC(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
