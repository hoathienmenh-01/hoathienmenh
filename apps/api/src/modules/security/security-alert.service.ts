import { Injectable } from '@nestjs/common';
import {
  classifySecurityEventForAlert,
  sanitizeSecurityAlertNote,
  shouldCreateAlertForClassification,
  type SecurityAlertClassification,
  type SecurityAlertSeverity,
  type SecurityAlertSource,
  type SecurityAlertStatus,
  type SecurityAlertSummary,
  type SecurityAlertSummaryRow,
  type SecurityAlertType,
} from '@xuantoi/shared';
import { PrismaService } from '../../common/prisma.service';

/**
 * Phase 18.3 — SecurityAlertService.
 *
 * Lớp workflow trên cùng `SecurityEvent` (Phase 18.1) + `UserSession`
 * (Phase 18.2). Mỗi event WARN/CRITICAL → tự động tạo 1 `SecurityAlert`
 * row với status `OPEN`. Admin có thể ACK/RESOLVE qua admin endpoint.
 *
 * Idempotency:
 *   - `createFromEvent(...)` dùng `eventId` làm idempotency key — nếu
 *     đã có alert cho `eventId` → trả về row cũ, không tạo mới.
 *
 * Fail-soft:
 *   - Mọi DB error trong `createFromEvent`/`createDirect` → log warn +
 *     return null, KHÔNG throw (security events là defense-in-depth
 *     monitoring, không nên block flow chính).
 *
 * **KHÔNG** ở Phase 18.3:
 *   - KHÔNG auto-ban (Phase 18.1 đã có temp block, Phase 18.3 chỉ track).
 *   - KHÔNG auto-rollback economy/data.
 *   - KHÔNG auto-xoá session (Phase 18.2 có admin revoke explicit).
 *
 * Privacy:
 *   - IP đã được caller hash thành `ipHash` trước khi truyền vào.
 *   - `detailsJson` đã sanitize ở `SecurityAbuseService` /
 *     `SessionService`. Không log raw token / cookie / password /
 *     refresh hash.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

const MAX_LIMIT = 200;
const DEFAULT_LIMIT = 50;

export interface CreateFromEventInput {
  eventId: string;
  eventType: string;
  eventSeverity: string;
  relatedUserId?: string | null;
  relatedCharacterId?: string | null;
  relatedSessionId?: string | null;
  detailsJson?: unknown;
}

export interface CreateDirectInput {
  type: SecurityAlertType;
  severity: SecurityAlertSeverity;
  source: SecurityAlertSource;
  relatedUserId?: string | null;
  relatedCharacterId?: string | null;
  relatedSessionId?: string | null;
  detailsJson?: unknown;
}

export interface ListAlertsOpts {
  severity?: SecurityAlertSeverity;
  status?: SecurityAlertStatus;
  type?: SecurityAlertType;
  source?: SecurityAlertSource;
  userId?: string;
  from?: Date;
  to?: Date;
  limit?: number;
  cursor?: string;
}

export interface AckResult {
  ok: true;
  alert: SecurityAlertSummaryRow;
}

export interface ResolveResult {
  ok: true;
  alert: SecurityAlertSummaryRow;
}

export interface AlertErrorResult {
  ok: false;
  code: 'ALERT_NOT_FOUND' | 'ALERT_ALREADY_RESOLVED' | 'INVALID_NOTE';
}

@Injectable()
export class SecurityAlertService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Idempotent: tạo `SecurityAlert` từ 1 `SecurityEvent`. Nếu đã có
   * alert với `eventId` này → trả về row cũ. Skip event INFO (theo
   * `shouldCreateAlertForClassification`).
   *
   * Returns:
   *   - `null` nếu skip (INFO) hoặc DB throw (fail-soft).
   *   - `SecurityAlertSummaryRow` cho alert mới hoặc alert đã tồn tại.
   */
  async createFromEvent(
    input: CreateFromEventInput,
  ): Promise<SecurityAlertSummaryRow | null> {
    const classification = classifySecurityEventForAlert(
      input.eventType,
      input.eventSeverity,
    );
    if (!shouldCreateAlertForClassification(classification)) {
      return null;
    }
    try {
      const existing = await this.prisma.securityAlert.findFirst({
        where: { eventId: input.eventId },
      });
      if (existing) {
        return this.toSummary(existing);
      }
      const created = await this.prisma.securityAlert.create({
        data: {
          type: classification.alertType,
          severity: classification.severity,
          status: 'OPEN',
          source: classification.source,
          eventId: input.eventId,
          relatedUserId: input.relatedUserId ?? null,
          relatedCharacterId: input.relatedCharacterId ?? null,
          relatedSessionId: input.relatedSessionId ?? null,
          // Prisma JSON input requires non-undefined; caller has already
          // sanitized at the SecurityAbuseService / SessionService layer.
          detailsJson:
            (input.detailsJson as import('@prisma/client').Prisma.InputJsonValue) ??
            {},
        },
      });
      return this.toSummary(created);
    } catch (err) {
      console.warn(
        `[SecurityAlertService] createFromEvent failed (fail-soft): ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      return null;
    }
  }

  /**
   * Tạo `SecurityAlert` không gắn với `SecurityEvent` cụ thể (vd alert
   * tạo từ batch job / cron). Fail-soft tương tự.
   */
  async createDirect(
    input: CreateDirectInput,
  ): Promise<SecurityAlertSummaryRow | null> {
    const classification: SecurityAlertClassification = {
      alertType: input.type,
      severity: input.severity,
      source: input.source,
    };
    if (!shouldCreateAlertForClassification(classification)) {
      return null;
    }
    try {
      const created = await this.prisma.securityAlert.create({
        data: {
          type: input.type,
          severity: input.severity,
          status: 'OPEN',
          source: input.source,
          eventId: null,
          relatedUserId: input.relatedUserId ?? null,
          relatedCharacterId: input.relatedCharacterId ?? null,
          relatedSessionId: input.relatedSessionId ?? null,
          detailsJson:
            (input.detailsJson as import('@prisma/client').Prisma.InputJsonValue) ??
            {},
        },
      });
      return this.toSummary(created);
    } catch (err) {
      console.warn(
        `[SecurityAlertService] createDirect failed (fail-soft): ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      return null;
    }
  }

  /**
   * Admin query: list alerts (cursor pagination, filter đa chiều).
   * Mặc định order by `createdAt` desc.
   */
  async listAlerts(
    opts: ListAlertsOpts,
  ): Promise<{ alerts: SecurityAlertSummaryRow[]; nextCursor: string | null }> {
    const limit = Math.min(Math.max(opts.limit ?? DEFAULT_LIMIT, 1), MAX_LIMIT);
    const where: Record<string, unknown> = {};
    if (opts.severity) where.severity = opts.severity;
    if (opts.status) where.status = opts.status;
    if (opts.type) where.type = opts.type;
    if (opts.source) where.source = opts.source;
    if (opts.userId) where.relatedUserId = opts.userId;
    const createdAtFilter: Record<string, Date> = {};
    if (opts.from) createdAtFilter.gte = opts.from;
    if (opts.to) createdAtFilter.lte = opts.to;
    if (Object.keys(createdAtFilter).length > 0) {
      where.createdAt = createdAtFilter;
    }
    // Take limit + 1 to detect whether there's a next page.
    const rows = await this.prisma.securityAlert.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      ...(opts.cursor ? { skip: 1, cursor: { id: opts.cursor } } : {}),
    });
    const hasMore = rows.length > limit;
    const sliced = hasMore ? rows.slice(0, limit) : rows;
    const nextCursor = hasMore ? sliced[sliced.length - 1].id : null;
    return {
      alerts: sliced.map((r) => this.toSummary(r)),
      nextCursor,
    };
  }

  /**
   * Ack 1 alert. Idempotent semantics:
   *   - Nếu alert đã ACKNOWLEDGED → no-op, return current state.
   *   - Nếu alert đã RESOLVED → reject với code `ALERT_ALREADY_RESOLVED`
   *     (admin không nên ack ngược 1 alert đã đóng).
   *   - Nếu OPEN → flip sang ACKNOWLEDGED + set acknowledgedAt/By.
   */
  async acknowledgeAlert(
    alertId: string,
    adminUserId: string,
  ): Promise<AckResult | AlertErrorResult> {
    const existing = await this.prisma.securityAlert.findUnique({
      where: { id: alertId },
    });
    if (!existing) return { ok: false, code: 'ALERT_NOT_FOUND' };
    if (existing.status === 'RESOLVED') {
      return { ok: false, code: 'ALERT_ALREADY_RESOLVED' };
    }
    if (existing.status === 'ACKNOWLEDGED') {
      return { ok: true, alert: this.toSummary(existing) };
    }
    const updated = await this.prisma.securityAlert.update({
      where: { id: alertId },
      data: {
        status: 'ACKNOWLEDGED',
        acknowledgedAt: new Date(),
        acknowledgedByAdminId: adminUserId,
      },
    });
    return { ok: true, alert: this.toSummary(updated) };
  }

  /**
   * Resolve 1 alert.
   *   - Idempotent: nếu đã RESOLVED → reject `ALERT_ALREADY_RESOLVED`.
   *   - Sanitize `resolutionNote` (strip control char + truncate).
   *     Empty sau sanitize → reject `INVALID_NOTE`.
   *   - Cho phép skip ACK (OPEN → RESOLVED trực tiếp). Khi đó
   *     `acknowledgedAt`/`acknowledgedByAdminId` cũng được set đồng
   *     thời để consistency.
   */
  async resolveAlert(
    alertId: string,
    adminUserId: string,
    rawNote: unknown,
  ): Promise<ResolveResult | AlertErrorResult> {
    const note = sanitizeSecurityAlertNote(rawNote);
    if (!note) return { ok: false, code: 'INVALID_NOTE' };
    const existing = await this.prisma.securityAlert.findUnique({
      where: { id: alertId },
    });
    if (!existing) return { ok: false, code: 'ALERT_NOT_FOUND' };
    if (existing.status === 'RESOLVED') {
      return { ok: false, code: 'ALERT_ALREADY_RESOLVED' };
    }
    const now = new Date();
    const data: Record<string, unknown> = {
      status: 'RESOLVED',
      resolvedAt: now,
      resolvedByAdminId: adminUserId,
      resolutionNote: note,
    };
    if (existing.status === 'OPEN') {
      // Skip-ack path: cũng set ack snapshot.
      data.acknowledgedAt = now;
      data.acknowledgedByAdminId = adminUserId;
    }
    const updated = await this.prisma.securityAlert.update({
      where: { id: alertId },
      data,
    });
    return { ok: true, alert: this.toSummary(updated) };
  }

  /**
   * Summary cho dashboard `GET /admin/security/summary`. Tính:
   *   - openCritical / openWarn từ `SecurityAlert` status=OPEN.
   *   - blockedSubjects từ `SecurityBlock` đang active.
   *   - tokenReuseLast24h / suspiciousSessionsLast24h /
   *     rateLimitHitsLast24h từ `SecurityEvent` 24h gần nhất.
   *   - latestCriticalEvents = top 5 event CRITICAL gần nhất.
   *
   * Mọi count fail-soft riêng: nếu 1 query throw → count đó = 0,
   * không kéo cả summary fail.
   */
  async getSummary(): Promise<SecurityAlertSummary> {
    const now = new Date();
    const since24h = new Date(now.getTime() - DAY_MS);

    const safeCount = async (
      runner: () => Promise<number>,
      label: string,
    ): Promise<number> => {
      try {
        return await runner();
      } catch (err) {
        console.warn(
          `[SecurityAlertService] summary count "${label}" failed: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
        return 0;
      }
    };

    const [
      openCritical,
      openWarn,
      blockedSubjects,
      tokenReuseLast24h,
      suspiciousSessionsLast24h,
      rateLimitHitsLast24h,
    ] = await Promise.all([
      safeCount(
        () =>
          this.prisma.securityAlert.count({
            where: { status: 'OPEN', severity: 'CRITICAL' },
          }),
        'openCritical',
      ),
      safeCount(
        () =>
          this.prisma.securityAlert.count({
            where: { status: 'OPEN', severity: 'WARN' },
          }),
        'openWarn',
      ),
      safeCount(
        () =>
          this.prisma.securityBlock.count({
            where: { liftedAt: null, expiresAt: { gt: now } },
          }),
        'blockedSubjects',
      ),
      safeCount(
        () =>
          this.prisma.securityEvent.count({
            where: {
              type: 'REFRESH_TOKEN_REUSED',
              createdAt: { gte: since24h },
            },
          }),
        'tokenReuseLast24h',
      ),
      safeCount(
        () =>
          this.prisma.securityEvent.count({
            where: {
              type: 'SESSION_SUSPICIOUS',
              createdAt: { gte: since24h },
            },
          }),
        'suspiciousSessionsLast24h',
      ),
      safeCount(
        () =>
          this.prisma.securityEvent.count({
            where: {
              type: 'RATE_LIMIT_VIOLATION',
              createdAt: { gte: since24h },
            },
          }),
        'rateLimitHitsLast24h',
      ),
    ]);

    let latestCriticalEvents: SecurityAlertSummary['latestCriticalEvents'] = [];
    try {
      const rows = await this.prisma.securityEvent.findMany({
        where: { severity: 'CRITICAL' },
        orderBy: { createdAt: 'desc' },
        take: 5,
      });
      latestCriticalEvents = rows.map((r) => ({
        id: r.id,
        type: r.type,
        severity: (r.severity as SecurityAlertSeverity) ?? 'INFO',
        ipHash: r.ipHash,
        userId: r.userId,
        createdAt: r.createdAt.toISOString(),
      }));
    } catch (err) {
      console.warn(
        `[SecurityAlertService] summary latestCriticalEvents failed: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      latestCriticalEvents = [];
    }

    return {
      openCritical,
      openWarn,
      blockedSubjects,
      tokenReuseLast24h,
      suspiciousSessionsLast24h,
      rateLimitHitsLast24h,
      latestCriticalEvents,
      generatedAt: now.toISOString(),
    };
  }

  /** Serialize Prisma row → response shape. Không expose secret. */
  toSummary(row: {
    id: string;
    type: string;
    severity: string;
    status: string;
    source: string;
    eventId: string | null;
    relatedUserId: string | null;
    relatedCharacterId: string | null;
    relatedSessionId: string | null;
    detailsJson: unknown;
    createdAt: Date;
    acknowledgedAt: Date | null;
    acknowledgedByAdminId: string | null;
    resolvedAt: Date | null;
    resolvedByAdminId: string | null;
    resolutionNote: string | null;
  }): SecurityAlertSummaryRow {
    return {
      id: row.id,
      type: row.type as SecurityAlertType,
      severity: row.severity as SecurityAlertSeverity,
      status: row.status as SecurityAlertStatus,
      source: row.source as SecurityAlertSource,
      eventId: row.eventId,
      relatedUserId: row.relatedUserId,
      relatedCharacterId: row.relatedCharacterId,
      relatedSessionId: row.relatedSessionId,
      detailsJson: row.detailsJson,
      createdAt: row.createdAt.toISOString(),
      acknowledgedAt: row.acknowledgedAt
        ? row.acknowledgedAt.toISOString()
        : null,
      acknowledgedByAdminId: row.acknowledgedByAdminId,
      resolvedAt: row.resolvedAt ? row.resolvedAt.toISOString() : null,
      resolvedByAdminId: row.resolvedByAdminId,
      resolutionNote: row.resolutionNote,
    };
  }
}
