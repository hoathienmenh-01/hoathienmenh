import { HttpException, HttpStatus, Injectable, Logger } from '@nestjs/common';
import {
  DEFAULT_WEB_PUSH_PREFERENCES,
  WEB_PUSH_LIMITS,
  WEB_PUSH_NOTIFICATION_TYPES,
  buildWebPushPayload,
  isWebPushNotificationType,
  parsePushPreferencesPatch,
  shouldSendPushNotification,
  validatePushSubscriptionInput,
  type NormalizedWebPushPreferencesPatch,
  type WebPushNotificationType,
  type WebPushPayload,
  type WebPushPreferencesView,
  type WebPushSubscriptionView,
} from '@xuantoi/shared';
import { PrismaService } from '../../common/prisma.service';

/**
 * Phase PWA-1 — Web Push service.
 *
 * Responsibilities:
 *   - VAPID public key getter (FE đọc để register subscription).
 *   - Subscribe / unsubscribe / preferences CRUD.
 *   - `sendToUser(userId, type, payload)`:
 *     1. Gate `PUSH_ENABLED` env.
 *     2. Load prefs + last-sent log → `shouldSendPushNotification`.
 *     3. Foreach enabled subscription, dynamic-import `web-push`,
 *        sign + POST. `PUSH_DRY_RUN=true` ⇒ log only.
 *     4. 410/404/403 ⇒ mark `enabled=false` + bump failureCount; cap
 *        ≥ `FAILURE_HARD_DELETE_THRESHOLD` ⇒ hard-delete.
 *     5. Update `WebPushSendLog` per type.
 *
 * Out-of-scope here: trigger wiring (boss spawn / stamina-tick /
 * mail-create / daily reminder) — see follow-up PRs.
 */

interface SendOutcome {
  ok: boolean;
  reason?: 'DISABLED' | 'COOLDOWN' | 'QUIET_HOURS' | 'GATE_OFF' | 'NO_SUB';
  /** Dry-run mode ⇒ true if would-send. */
  dryRun?: boolean;
  /** Number of successful gateway POSTs. */
  sentCount?: number;
  /** Number of subscriptions invalidated (410/404/403). */
  invalidatedCount?: number;
}

function fail(code: string, status = HttpStatus.BAD_REQUEST): never {
  throw new HttpException(
    { ok: false, error: { code, message: code } },
    status,
  );
}

@Injectable()
export class WebPushService {
  private readonly logger = new Logger(WebPushService.name);
  private vapidConfigured = false;
  private vapidPublicKey = '';
  private vapidPrivateKey = '';
  private vapidSubject = '';
  private pushEnabled = false;
  private pushDryRun = true;

  constructor(private readonly prisma: PrismaService) {
    this.reloadEnvSnapshot();
  }

  // -------------------------------------------------------------------------
  // Env
  // -------------------------------------------------------------------------

  /**
   * Re-read env vars. Public + invoked at constructor; tests inject via
   * `setEnvSnapshotForTesting`.
   */
  reloadEnvSnapshot(): void {
    this.vapidPublicKey = (process.env.VAPID_PUBLIC_KEY ?? '').trim();
    this.vapidPrivateKey = (process.env.VAPID_PRIVATE_KEY ?? '').trim();
    this.vapidSubject = (
      process.env.VAPID_SUBJECT ?? 'mailto:ops@example.com'
    ).trim();
    this.pushEnabled = String(process.env.PUSH_ENABLED ?? 'false') === 'true';
    this.pushDryRun = String(process.env.PUSH_DRY_RUN ?? 'true') === 'true';
    this.vapidConfigured = Boolean(
      this.vapidPublicKey && this.vapidPrivateKey,
    );
  }

  /** Test-only seam. */
  setEnvSnapshotForTesting(snapshot: {
    vapidPublicKey?: string;
    vapidPrivateKey?: string;
    vapidSubject?: string;
    pushEnabled?: boolean;
    pushDryRun?: boolean;
  }): void {
    if (snapshot.vapidPublicKey !== undefined) {
      this.vapidPublicKey = snapshot.vapidPublicKey;
    }
    if (snapshot.vapidPrivateKey !== undefined) {
      this.vapidPrivateKey = snapshot.vapidPrivateKey;
    }
    if (snapshot.vapidSubject !== undefined) {
      this.vapidSubject = snapshot.vapidSubject;
    }
    if (snapshot.pushEnabled !== undefined) {
      this.pushEnabled = snapshot.pushEnabled;
    }
    if (snapshot.pushDryRun !== undefined) {
      this.pushDryRun = snapshot.pushDryRun;
    }
    this.vapidConfigured = Boolean(
      this.vapidPublicKey && this.vapidPrivateKey,
    );
  }

  getPublicKey(): string {
    if (!this.vapidPublicKey) fail('VAPID_NOT_CONFIGURED', HttpStatus.NOT_FOUND);
    return this.vapidPublicKey;
  }

  isPushEnabled(): boolean {
    return this.pushEnabled && this.vapidConfigured;
  }

  isDryRun(): boolean {
    return this.pushDryRun;
  }

  // -------------------------------------------------------------------------
  // Subscribe / unsubscribe
  // -------------------------------------------------------------------------

  async subscribe(
    userId: string,
    rawInput: unknown,
  ): Promise<WebPushSubscriptionView> {
    const validation = validatePushSubscriptionInput(rawInput);
    if (!validation.ok || !validation.value) {
      fail(validation.code ?? 'PAYLOAD_INVALID', HttpStatus.BAD_REQUEST);
    }
    const { endpoint, p256dh, auth, userAgent } = validation.value;

    // Cap số subscription enabled per user.
    const existingCount = await this.prisma.webPushSubscription.count({
      where: { userId, enabled: true },
    });
    const existing = await this.prisma.webPushSubscription.findUnique({
      where: { endpoint },
    });
    if (
      !existing &&
      existingCount >= WEB_PUSH_LIMITS.PER_USER_SUBSCRIPTION_MAX
    ) {
      fail('SUBSCRIPTION_LIMIT_REACHED', HttpStatus.BAD_REQUEST);
    }
    if (existing && existing.userId !== userId) {
      // Endpoint reuse by a different user — defensively re-bind to current
      // user (push gateway endpoint is opaque; cross-user is operationally
      // impossible unless device changed account).
      const row = await this.prisma.webPushSubscription.update({
        where: { endpoint },
        data: {
          userId,
          p256dh,
          auth,
          userAgent,
          enabled: true,
          failureCount: 0,
        },
      });
      await this.ensurePreferencesRow(userId);
      return this.toSubscriptionView(row);
    }
    const row = await this.prisma.webPushSubscription.upsert({
      where: { endpoint },
      create: {
        userId,
        endpoint,
        p256dh,
        auth,
        userAgent,
        enabled: true,
      },
      update: {
        p256dh,
        auth,
        userAgent,
        enabled: true,
        failureCount: 0,
      },
    });
    await this.ensurePreferencesRow(userId);
    return this.toSubscriptionView(row);
  }

  async unsubscribe(userId: string, endpoint: string): Promise<void> {
    if (typeof endpoint !== 'string' || !endpoint.trim()) {
      fail('ENDPOINT_INVALID');
    }
    const existing = await this.prisma.webPushSubscription.findUnique({
      where: { endpoint },
    });
    if (!existing) return; // No-op idempotent.
    if (existing.userId !== userId) {
      fail('FORBIDDEN', HttpStatus.FORBIDDEN);
    }
    await this.prisma.webPushSubscription.update({
      where: { endpoint },
      data: { enabled: false },
    });
  }

  async listSubscriptions(userId: string): Promise<WebPushSubscriptionView[]> {
    const rows = await this.prisma.webPushSubscription.findMany({
      where: { userId, enabled: true },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map((r) => this.toSubscriptionView(r));
  }

  // -------------------------------------------------------------------------
  // Preferences
  // -------------------------------------------------------------------------

  async getPreferences(userId: string): Promise<WebPushPreferencesView> {
    const row = await this.ensurePreferencesRow(userId);
    return this.toPreferencesView(row);
  }

  async updatePreferences(
    userId: string,
    rawPatch: unknown,
  ): Promise<WebPushPreferencesView> {
    const patch: NormalizedWebPushPreferencesPatch | null =
      parsePushPreferencesPatch(rawPatch);
    if (!patch) fail('PAYLOAD_INVALID');
    await this.ensurePreferencesRow(userId);
    const row = await this.prisma.userPushPreferences.update({
      where: { userId },
      data: patch,
    });
    return this.toPreferencesView(row);
  }

  private async ensurePreferencesRow(userId: string) {
    const existing = await this.prisma.userPushPreferences.findUnique({
      where: { userId },
    });
    if (existing) return existing;
    return this.prisma.userPushPreferences.upsert({
      where: { userId },
      create: { userId },
      update: {},
    });
  }

  // -------------------------------------------------------------------------
  // Send pipeline
  // -------------------------------------------------------------------------

  async sendToUser(
    userId: string,
    type: WebPushNotificationType,
    input: {
      title: string;
      body: string;
      url?: string | null;
      tag?: string | null;
      dedupeKey?: string | null;
    },
  ): Promise<SendOutcome> {
    if (!isWebPushNotificationType(type)) fail('TYPE_INVALID');

    if (!this.pushEnabled) {
      await this.upsertSendLog(userId, type, null, 'BLOCKED_GATE_OFF');
      return { ok: false, reason: 'GATE_OFF' };
    }
    if (!this.vapidConfigured) {
      await this.upsertSendLog(userId, type, null, 'BLOCKED_GATE_OFF');
      return { ok: false, reason: 'GATE_OFF' };
    }

    const prefsRow = await this.ensurePreferencesRow(userId);
    const log = await this.prisma.webPushSendLog.findUnique({
      where: { userId_type: { userId, type } },
    });

    if (
      input.dedupeKey &&
      log?.dedupeKey === input.dedupeKey &&
      log?.lastStatus === 'OK'
    ) {
      return { ok: false, reason: 'COOLDOWN' };
    }

    const decision = shouldSendPushNotification({
      type,
      nowMs: Date.now(),
      lastSentAtMs: log?.lastSentAt ? log.lastSentAt.getTime() : null,
      prefs: {
        bossSpawnEnabled: prefsRow.bossSpawnEnabled,
        staminaFullEnabled: prefsRow.staminaFullEnabled,
        mailEnabled: prefsRow.mailEnabled,
        dailyReminderEnabled: prefsRow.dailyReminderEnabled,
        quietHoursStart: prefsRow.quietHoursStart,
        quietHoursEnd: prefsRow.quietHoursEnd,
      },
    });
    if (!decision.ok) {
      await this.upsertSendLog(
        userId,
        type,
        input.dedupeKey ?? null,
        decision.reason === 'DISABLED'
          ? 'BLOCKED_DISABLED'
          : decision.reason === 'COOLDOWN'
            ? 'BLOCKED_COOLDOWN'
            : 'BLOCKED_QUIET_HOURS',
      );
      return { ok: false, reason: decision.reason };
    }

    const subs = await this.prisma.webPushSubscription.findMany({
      where: { userId, enabled: true },
    });
    if (subs.length === 0) {
      return { ok: false, reason: 'NO_SUB' };
    }

    const payload = buildWebPushPayload({
      type,
      title: input.title,
      body: input.body,
      url: input.url ?? null,
      tag: input.tag ?? null,
    });
    const payloadStr = JSON.stringify(payload);

    if (this.pushDryRun) {
      this.logger.log(
        `[dry-run] would push type=${type} to user=${userId} subs=${subs.length} bytes=${payloadStr.length}`,
      );
      await this.upsertSendLog(userId, type, input.dedupeKey ?? null, 'DRY_RUN');
      return {
        ok: true,
        dryRun: true,
        sentCount: subs.length,
        invalidatedCount: 0,
      };
    }

    // Lazy-load `web-push` to avoid loading native crypto at import time.
    const webpushMod = await this.loadWebPushClient();
    let sentCount = 0;
    let invalidatedCount = 0;
    for (const sub of subs) {
      try {
        await webpushMod.sendNotification(
          {
            endpoint: sub.endpoint,
            keys: { p256dh: sub.p256dh, auth: sub.auth },
          },
          payloadStr,
        );
        await this.prisma.webPushSubscription.update({
          where: { id: sub.id },
          data: { lastUsedAt: new Date(), failureCount: 0 },
        });
        sentCount += 1;
      } catch (err: unknown) {
        const status = this.extractStatusCode(err);
        if (status === 404 || status === 410 || status === 403) {
          await this.invalidateSubscription(sub.id, sub.failureCount + 1);
          invalidatedCount += 1;
        } else {
          await this.prisma.webPushSubscription.update({
            where: { id: sub.id },
            data: { failureCount: sub.failureCount + 1 },
          });
          this.logger.warn(
            `push send transient error sub=${sub.id} status=${status ?? 'unknown'}`,
          );
        }
      }
    }
    await this.upsertSendLog(
      userId,
      type,
      input.dedupeKey ?? null,
      sentCount > 0 ? 'OK' : 'ERROR_GATEWAY',
    );
    return {
      ok: sentCount > 0,
      sentCount,
      invalidatedCount,
    };
  }

  private async invalidateSubscription(id: string, failureCount: number) {
    if (failureCount >= WEB_PUSH_LIMITS.FAILURE_HARD_DELETE_THRESHOLD) {
      await this.prisma.webPushSubscription.delete({ where: { id } });
      return;
    }
    await this.prisma.webPushSubscription.update({
      where: { id },
      data: { enabled: false, failureCount },
    });
  }

  private async upsertSendLog(
    userId: string,
    type: WebPushNotificationType,
    dedupeKey: string | null,
    status: string,
  ) {
    const now = new Date();
    await this.prisma.webPushSendLog.upsert({
      where: { userId_type: { userId, type } },
      create: {
        userId,
        type,
        lastSentAt: now,
        dedupeKey,
        lastStatus: status,
      },
      update: {
        lastSentAt: now,
        dedupeKey,
        lastStatus: status,
      },
    });
  }

  private extractStatusCode(err: unknown): number | null {
    if (typeof err === 'object' && err !== null) {
      const maybe = err as { statusCode?: unknown };
      if (typeof maybe.statusCode === 'number') return maybe.statusCode;
    }
    return null;
  }

  // -------------------------------------------------------------------------
  // web-push lazy loader (mockable seam)
  // -------------------------------------------------------------------------

  private webpushModCache: WebPushClient | null = null;
  private webpushClientFactory:
    | (() => Promise<WebPushClient> | WebPushClient)
    | null = null;

  /** Test-only injection seam. */
  setWebPushClientFactoryForTesting(
    factory: () => Promise<WebPushClient> | WebPushClient,
  ): void {
    this.webpushClientFactory = factory;
    this.webpushModCache = null;
  }

  private async loadWebPushClient(): Promise<WebPushClient> {
    if (this.webpushModCache) return this.webpushModCache;
    if (this.webpushClientFactory) {
      this.webpushModCache = await this.webpushClientFactory();
      return this.webpushModCache;
    }
    const mod = (await import('web-push')) as unknown as
      | WebPushClient
      | { default: WebPushClient };
    const wp: WebPushClient =
      'default' in mod && mod.default ? mod.default : (mod as WebPushClient);
    wp.setVapidDetails(
      this.vapidSubject,
      this.vapidPublicKey,
      this.vapidPrivateKey,
    );
    this.webpushModCache = wp;
    return wp;
  }

  // -------------------------------------------------------------------------
  // View mappers
  // -------------------------------------------------------------------------

  private toSubscriptionView(row: {
    id: string;
    endpoint: string;
    userAgent: string | null;
    enabled: boolean;
    createdAt: Date;
    lastUsedAt: Date | null;
  }): WebPushSubscriptionView {
    return {
      id: row.id,
      endpoint: row.endpoint,
      userAgent: row.userAgent,
      enabled: row.enabled,
      createdAt: row.createdAt.toISOString(),
      lastUsedAt: row.lastUsedAt ? row.lastUsedAt.toISOString() : null,
    };
  }

  private toPreferencesView(row: {
    bossSpawnEnabled: boolean;
    staminaFullEnabled: boolean;
    mailEnabled: boolean;
    dailyReminderEnabled: boolean;
    quietHoursStart: string | null;
    quietHoursEnd: string | null;
    timezone: string | null;
    updatedAt: Date;
  }): WebPushPreferencesView {
    return {
      bossSpawnEnabled: row.bossSpawnEnabled,
      staminaFullEnabled: row.staminaFullEnabled,
      mailEnabled: row.mailEnabled,
      dailyReminderEnabled: row.dailyReminderEnabled,
      quietHoursStart: row.quietHoursStart,
      quietHoursEnd: row.quietHoursEnd,
      timezone: row.timezone,
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  // -------------------------------------------------------------------------
  // Admin / cleanup helper
  // -------------------------------------------------------------------------

  async cleanupStaleSubscriptions(): Promise<{ deleted: number }> {
    const res = await this.prisma.webPushSubscription.deleteMany({
      where: {
        enabled: false,
        failureCount: {
          gte: WEB_PUSH_LIMITS.FAILURE_HARD_DELETE_THRESHOLD,
        },
      },
    });
    return { deleted: res.count };
  }

  // -------------------------------------------------------------------------
  // Phase 44.1 — Broadcast helpers (eligible-user discovery + bulk send).
  //
  // Triggers (BossService, MailService, CultivationProcessor, daily reminder
  // scheduler) gọi 1 trong các method dưới để fan-out push tới đúng tập user
  // đã opt-in. KHÔNG thay đổi pipeline `sendToUser` — chỉ wrap loop ngoài.
  //
  // Recency filter (lastSeenAt ≥ `recentSinceMs` ago) chống spam push tới
  // account dead-cold. Default = 7 ngày, override per-trigger qua opts.
  // -------------------------------------------------------------------------

  private prefColumnForType(type: WebPushNotificationType): string {
    switch (type) {
      case 'BOSS_SPAWN':
        return 'bossSpawnEnabled';
      case 'STAMINA_FULL':
        return 'staminaFullEnabled';
      case 'MAIL_NEW':
        return 'mailEnabled';
      case 'DAILY_REMINDER':
        return 'dailyReminderEnabled';
    }
  }

  /**
   * Tìm tập userId đã opt-in cho `type` cụ thể (preference TRUE) + có
   * subscription enabled + (optional) lastSeenAt trong window. Bounded
   * bởi `limit` để chống fan-out toàn DB.
   */
  async findEligibleUserIds(
    type: WebPushNotificationType,
    opts: { recentSinceMs?: number; limit?: number } = {},
  ): Promise<string[]> {
    const col = this.prefColumnForType(type);
    const limit = Math.min(Math.max(1, opts.limit ?? 5_000), 50_000);
    const recencyCutoff =
      opts.recentSinceMs && opts.recentSinceMs > 0
        ? new Date(Date.now() - opts.recentSinceMs)
        : null;
    const prefRows = await this.prisma.userPushPreferences.findMany({
      where: { [col]: true } as Record<string, boolean>,
      select: { userId: true },
      take: limit,
    });
    if (prefRows.length === 0) return [];
    const userIds = prefRows.map((r) => r.userId);
    const subs = await this.prisma.webPushSubscription.findMany({
      where: { userId: { in: userIds }, enabled: true },
      select: { userId: true },
      distinct: ['userId'],
    });
    const subSet = new Set(subs.map((s) => s.userId));
    let eligible = userIds.filter((u) => subSet.has(u));
    if (recencyCutoff && eligible.length > 0) {
      const presence = await this.prisma.userPresence.findMany({
        where: { userId: { in: eligible }, lastSeenAt: { gte: recencyCutoff } },
        select: { userId: true },
      });
      const recentSet = new Set(presence.map((p) => p.userId));
      eligible = eligible.filter((u) => recentSet.has(u));
    }
    return eligible;
  }

  /**
   * Bulk dispatch — gọi `sendToUser` lặp với cùng payload + dedupeKey.
   * Lỗi từng user log + tiếp tục — KHÔNG throw để 1 user lỗi không phá
   * trigger boss spawn chung.
   *
   * Return aggregate counters cho audit/log.
   */
  async broadcastToUsers(
    userIds: readonly string[],
    type: WebPushNotificationType,
    input: {
      title: string;
      body: string;
      url?: string | null;
      tag?: string | null;
      dedupeKey?: string | null;
    },
  ): Promise<{ attempted: number; ok: number; blocked: number; errors: number }> {
    let ok = 0;
    let blocked = 0;
    let errors = 0;
    for (const userId of userIds) {
      try {
        const out = await this.sendToUser(userId, type, input);
        if (out.ok) ok += 1;
        else blocked += 1;
      } catch (err) {
        errors += 1;
        this.logger.warn(
          `broadcastToUsers ${type} userId=${userId} failed: ${
            (err as Error).message ?? err
          }`,
        );
      }
    }
    return { attempted: userIds.length, ok, blocked, errors };
  }

  /**
   * Daily reminder cron entry-point. Iterates over users with
   * `dailyReminderEnabled=true` (opt-in), preference cooldown 23h trong
   * shared catalog đảm bảo cron 24h không gửi trùng. Bounded.
   */
  async dispatchDailyReminders(opts: { limit?: number } = {}): Promise<{
    attempted: number;
    ok: number;
    blocked: number;
    errors: number;
  }> {
    const userIds = await this.findEligibleUserIds('DAILY_REMINDER', {
      limit: opts.limit ?? 5_000,
    });
    if (userIds.length === 0) {
      return { attempted: 0, ok: 0, blocked: 0, errors: 0 };
    }
    const dateKey = new Date().toISOString().slice(0, 10);
    return this.broadcastToUsers(userIds, 'DAILY_REMINDER', {
      title: 'Tu sĩ ơi, đã đến giờ tu luyện',
      body: 'Quay lại đại lục — phần thưởng điểm danh hôm nay đang chờ.',
      url: '/daily-login',
      tag: `daily-reminder-${dateKey}`,
      dedupeKey: `daily-reminder-${dateKey}`,
    });
  }

  // -------------------------------------------------------------------------
  // Catalog convenience
  // -------------------------------------------------------------------------

  listTypes(): readonly WebPushNotificationType[] {
    return WEB_PUSH_NOTIFICATION_TYPES;
  }

  getDefaultPreferences() {
    return DEFAULT_WEB_PUSH_PREFERENCES;
  }
}

/** Minimal shape of `web-push` module surface we use; matches `@types/web-push`. */
export interface WebPushClient {
  setVapidDetails(subject: string, publicKey: string, privateKey: string): void;
  sendNotification(
    subscription: {
      endpoint: string;
      keys: { p256dh: string; auth: string };
    },
    payload: string,
  ): Promise<{ statusCode: number; body: string; headers: unknown }>;
}

export type { WebPushPayload };
