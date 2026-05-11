/**
 * Phase 18.2 — SessionService.
 *
 * Quản lý lifecycle `UserSession` (1 device login, group nhiều
 * `RefreshToken` cùng family):
 *
 *   - `createSession`     khi login/register thành công.
 *   - `touchSession`      mỗi lần refresh rotation thành công.
 *   - `revokeSession`     khi user logout / user revoke / admin revoke
 *                         / change-password / detect reuse.
 *   - `handleReuseDetected`  defensive revoke + emit SecurityEvent
 *                            `REFRESH_TOKEN_REUSED`.
 *   - `listForUser`       user xem session của chính mình.
 *   - `listForAdmin`      admin xem session paginated (filter user/status).
 *
 * Privacy:
 *   - `ipHash` luôn hash qua `IpHashService` ở caller TRƯỚC khi gọi
 *     service (service KHÔNG nhận raw IP).
 *   - `userAgent` luôn sanitize qua `sanitizeUserAgent` ở caller TRƯỚC
 *     khi gọi service (service KHÔNG strip/truncate lại).
 *
 * Fail-safe:
 *   - Emit SecurityEvent fail → log warn, KHÔNG throw (giữ refresh
 *     flow). Theo style `SecurityAbuseService.recordRateLimitViolation`.
 *
 * Không phụ thuộc `SecurityModule` để tránh circular dep với
 * `AuthModule` (SecurityModule import AuthModule cho AdminGuard).
 */
import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import type { Prisma, UserSession } from '@prisma/client';
import {
  computeSessionStatus,
  type SessionRevokeReason,
  type SessionStatusFilter,
  type UserSessionSummary,
} from '@xuantoi/shared';
import { PrismaService } from '../../common/prisma.service';

/**
 * Detail JSON tối thiểu khi ghi SecurityEvent SESSION_*. Sanitized —
 * KHÔNG chứa raw token/cookie/password.
 */
interface SessionEventDetail {
  sessionId: string;
  reason?: SessionRevokeReason;
  revokedById?: string | null;
  refreshTokenId?: string;
}

export interface CreateSessionInput {
  userId: string;
  /** sha256(salt || ip). Caller hash trước; service KHÔNG nhận raw IP. */
  ipHash: string | null;
  /** Sanitized UA. Caller dùng `sanitizeUserAgent` trước khi gọi. */
  userAgent: string | null;
  expiresAt: Date;
}

export interface RevokeSessionInput {
  sessionId: string;
  reason: SessionRevokeReason;
  /** userId của admin/user thực hiện revoke; null nếu hết hạn / system. */
  revokedById: string | null;
}

export interface HandleReuseInput {
  /** Refresh token row đã rotate (revokedAt set) bị present lại. */
  refreshTokenId: string;
  /** sessionId của token đó (nếu có). Null cho row issued trước migration. */
  sessionId: string | null;
  userId: string;
  /** sha256(salt || ip) khi reuse được present. */
  ipHash: string | null;
}

export interface ListUserSessionsResult {
  sessions: UserSessionSummary[];
}

export interface ListAdminSessionsInput {
  userId?: string;
  status?: SessionStatusFilter;
  limit: number;
  cursor?: string;
}

export interface ListAdminSessionsResult {
  sessions: UserSessionSummary[];
  nextCursor: string | null;
}

/**
 * Injection token cho `SecurityAlertService` (Phase 18.3) khi wire vào
 * `SessionService`. Tách token để tránh circular import: SecurityModule
 * imports AuthModule (để dùng SessionService trong admin endpoint); nếu
 * AuthModule import trực tiếp SecurityAlertService thì tạo cò cò.
 *
 * Production wiring (ở `SecurityModule`) provide instance thật. Test
 * cũ instantiate `SessionService` qua `new SessionService(prisma)`
 * vẫn pass vì collaborator là `@Optional`.
 */
export const SESSION_SECURITY_ALERT_SERVICE = 'SESSION_SECURITY_ALERT_SERVICE';

/**
 * Shape rid khoát khỏi hàm `createFromEvent` của SecurityAlertService
 * — SessionService chỉ cần method này. Tách interface để tránh
 * type-coupled hai chiều với security module.
 */
export interface SessionAlertEmitter {
  createFromEvent(input: {
    eventId: string;
    eventType: string;
    eventSeverity: string;
    relatedUserId?: string | null;
    relatedSessionId?: string | null;
    detailsJson?: unknown;
  }): Promise<unknown>;
}

@Injectable()
export class SessionService {
  private readonly log = new Logger(SessionService.name);

  constructor(
    private readonly prisma: PrismaService,
    /**
     * Phase 18.3 — optional alert fan-out (nếu wire). Khi missing,
     * `emitEvent` chỉ ghi `SecurityEvent` như cũ (backward compat
     * cho unit test lấy `new SessionService(prisma)`).
     */
    @Optional()
    @Inject(SESSION_SECURITY_ALERT_SERVICE)
    private readonly alerts: SessionAlertEmitter | null = null,
  ) {}

  // -------------------- write --------------------

  /**
   * Tạo `UserSession` mới + emit SecurityEvent `SESSION_CREATED` (INFO).
   *
   * Caller: `AuthService.login`/`register` sau khi password verified.
   */
  async createSession(input: CreateSessionInput): Promise<UserSession> {
    const session = await this.prisma.userSession.create({
      data: {
        userId: input.userId,
        ipHash: input.ipHash,
        userAgent: input.userAgent,
        expiresAt: input.expiresAt,
      },
    });
    await this.emitEvent({
      type: 'SESSION_CREATED',
      severity: 'INFO',
      userId: input.userId,
      ipHash: input.ipHash,
      detail: { sessionId: session.id },
    });
    return session;
  }

  /**
   * Cập nhật `lastSeenAt` cho 1 session (no-op nếu session đã revoke).
   *
   * Caller: `AuthService.refresh` sau khi rotation thành công.
   */
  async touchSession(sessionId: string): Promise<void> {
    await this.prisma.userSession.updateMany({
      where: { id: sessionId, revokedAt: null },
      data: { lastSeenAt: new Date() },
    });
  }

  /**
   * Revoke 1 session + revoke tất cả `RefreshToken` con (chưa revoke).
   *
   * Idempotent: nếu session đã revoke, KHÔNG update lại, KHÔNG emit
   * event lần 2.
   *
   * Return: session row sau update (hoặc null nếu không tồn tại).
   */
  async revokeSession(input: RevokeSessionInput): Promise<UserSession | null> {
    const session = await this.prisma.userSession.findUnique({
      where: { id: input.sessionId },
    });
    if (!session) return null;
    if (session.revokedAt) return session;

    const now = new Date();
    const [updated] = await this.prisma.$transaction([
      this.prisma.userSession.update({
        where: { id: input.sessionId },
        data: {
          revokedAt: now,
          revokedReason: input.reason,
          revokedById: input.revokedById,
        },
      }),
      this.prisma.refreshToken.updateMany({
        where: { sessionId: input.sessionId, revokedAt: null },
        data: { revokedAt: now },
      }),
    ]);

    await this.emitEvent({
      type: 'SESSION_REVOKED',
      severity: 'INFO',
      userId: session.userId,
      ipHash: session.ipHash,
      detail: {
        sessionId: session.id,
        reason: input.reason,
        revokedById: input.revokedById,
      },
    });
    return updated;
  }

  /**
   * Detect refresh-token-reuse:
   *   - Caller `AuthService.refresh` đã verify JWT + match argon2 hash
   *     nhưng row có `revokedAt` set (token cũ đã rotate trước đó).
   *   - Defensive: revoke cả session family + emit
   *     `REFRESH_TOKEN_REUSED` CRITICAL.
   *
   * Return: session đã revoke (hoặc null nếu refresh token không gắn
   * sessionId — vd row issued trước migration).
   */
  async handleReuseDetected(input: HandleReuseInput): Promise<UserSession | null> {
    // Emit event TRƯỚC khi revoke để đảm bảo audit kể cả khi revoke
    // throw (eg DB transient).
    await this.emitEvent({
      type: 'REFRESH_TOKEN_REUSED',
      severity: 'CRITICAL',
      userId: input.userId,
      ipHash: input.ipHash,
      detail: {
        refreshTokenId: input.refreshTokenId,
        sessionId: input.sessionId ?? 'unknown',
      },
    });
    if (!input.sessionId) {
      // Row issued pre-Phase-18.2 không có sessionId → defensive fallback
      // revoke TẤT CẢ refresh token của user (giống behavior cũ).
      await this.prisma.refreshToken.updateMany({
        where: { userId: input.userId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      return null;
    }
    return this.revokeSession({
      sessionId: input.sessionId,
      reason: 'REFRESH_REUSED',
      revokedById: null,
    });
  }

  /**
   * Revoke tất cả session active của user (vd change-password).
   *
   * KHÔNG emit per-session SecurityEvent (tránh ngập audit khi user
   * có nhiều session); 1 sự kiện `SESSION_REVOKED` aggregate là đủ.
   *
   * Return: số session đã revoke.
   */
  async revokeAllForUser(args: {
    userId: string;
    reason: SessionRevokeReason;
    revokedById: string | null;
  }): Promise<number> {
    const now = new Date();
    const active = await this.prisma.userSession.findMany({
      where: { userId: args.userId, revokedAt: null },
      select: { id: true },
    });
    if (active.length === 0) return 0;
    const ids = active.map((s) => s.id);
    await this.prisma.$transaction([
      this.prisma.userSession.updateMany({
        where: { id: { in: ids } },
        data: {
          revokedAt: now,
          revokedReason: args.reason,
          revokedById: args.revokedById,
        },
      }),
      this.prisma.refreshToken.updateMany({
        where: { sessionId: { in: ids }, revokedAt: null },
        data: { revokedAt: now },
      }),
    ]);
    await this.emitEvent({
      type: 'SESSION_REVOKED',
      severity: 'INFO',
      userId: args.userId,
      ipHash: null,
      detail: {
        sessionId: ids.join(','),
        reason: args.reason,
        revokedById: args.revokedById,
      },
    });
    return ids.length;
  }

  // -------------------- read --------------------

  /**
   * List session của 1 user (user-facing). Default sort: lastSeenAt DESC.
   *
   * `currentSessionId` (nếu có) sẽ được flag `current=true` ở row tương
   * ứng — giúp FE highlight session hiện tại.
   */
  async listForUser(args: {
    userId: string;
    currentSessionId?: string | null;
    /** Mặc định chỉ include ACTIVE; user request có thể bật REVOKED/EXPIRED. */
    includeRevoked?: boolean;
    limit?: number;
  }): Promise<ListUserSessionsResult> {
    const limit = Math.min(Math.max(args.limit ?? 50, 1), 100);
    const where: Prisma.UserSessionWhereInput = { userId: args.userId };
    if (!args.includeRevoked) {
      where.revokedAt = null;
    }
    const rows = await this.prisma.userSession.findMany({
      where,
      orderBy: { lastSeenAt: 'desc' },
      take: limit,
    });
    const now = new Date();
    return {
      sessions: rows.map((r) =>
        this.toSummary(r, args.currentSessionId ?? null, now),
      ),
    };
  }

  /**
   * Admin list session (paginated, filter by userId/status).
   *
   * Pagination: cursor-based theo `createdAt`/`id` (consistent với
   * `listRecentEvents` của Phase 18.1).
   */
  async listForAdmin(input: ListAdminSessionsInput): Promise<ListAdminSessionsResult> {
    const limit = Math.min(Math.max(input.limit, 1), 200);
    const where: Prisma.UserSessionWhereInput = {};
    if (input.userId) where.userId = input.userId;

    const now = new Date();
    switch (input.status) {
      case 'ACTIVE':
        where.revokedAt = null;
        where.expiresAt = { gt: now };
        break;
      case 'REVOKED':
        where.revokedAt = { not: null };
        break;
      case 'EXPIRED':
        where.revokedAt = null;
        where.expiresAt = { lte: now };
        break;
      case 'ALL':
      case undefined:
      default:
        // Không filter.
        break;
    }

    const rows = await this.prisma.userSession.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      ...(input.cursor ? { skip: 1, cursor: { id: input.cursor } } : {}),
    });
    const sliced = rows.slice(0, limit);
    const nextCursor =
      rows.length > limit ? (sliced[sliced.length - 1]?.id ?? null) : null;
    return {
      sessions: sliced.map((r) => this.toSummary(r, null, now)),
      nextCursor,
    };
  }

  /**
   * Lookup 1 session theo id (read raw row). Caller decide ownership
   * + format response.
   */
  async findById(sessionId: string): Promise<UserSession | null> {
    return this.prisma.userSession.findUnique({ where: { id: sessionId } });
  }

  /**
   * Serialize 1 UserSession row → `UserSessionSummary` cho FE.
   * Public để controller tự serialize sau khi mutate (vd revoke).
   */
  toSummary(
    row: UserSession,
    currentSessionId: string | null,
    now: Date,
  ): UserSessionSummary {
    return {
      id: row.id,
      userId: row.userId,
      ipHash: row.ipHash,
      userAgent: row.userAgent,
      createdAt: row.createdAt.toISOString(),
      lastSeenAt: row.lastSeenAt.toISOString(),
      expiresAt: row.expiresAt.toISOString(),
      revokedAt: row.revokedAt?.toISOString() ?? null,
      revokedReason:
        (row.revokedReason as UserSessionSummary['revokedReason']) ?? null,
      revokedById: row.revokedById ?? null,
      suspicious: row.suspicious,
      status: computeSessionStatus({
        revokedAt: row.revokedAt,
        expiresAt: row.expiresAt,
        now,
      }),
      current: currentSessionId !== null && row.id === currentSessionId,
    };
  }

  // -------------------- internal --------------------

  private async emitEvent(input: {
    type:
      | 'SESSION_CREATED'
      | 'SESSION_REVOKED'
      | 'REFRESH_TOKEN_REUSED'
      | 'SESSION_SUSPICIOUS';
    severity: 'INFO' | 'WARN' | 'CRITICAL';
    userId: string | null;
    ipHash: string | null;
    detail: SessionEventDetail;
  }): Promise<void> {
    let eventRow: { id: string } | null = null;
    try {
      eventRow = await this.prisma.securityEvent.create({
        data: {
          type: input.type,
          severity: input.severity,
          userId: input.userId,
          ipHash: input.ipHash,
          detailJson:
            input.detail as unknown as Prisma.InputJsonValue,
        },
        select: { id: true },
      });
    } catch (err) {
      this.log.warn(
        `[SessionService] emit ${input.type} failed: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
    // Phase 18.3 — fan-out vào SecurityAlert. INFO event bị skip; chỉ
    // WARN/CRITICAL (REFRESH_TOKEN_REUSED, SESSION_SUSPICIOUS) mới tạo
    // alert. Fail-soft: mọi error đều swallow.
    if (eventRow && this.alerts) {
      try {
        const sessionId =
          typeof (input.detail as { sessionId?: unknown }).sessionId ===
          'string'
            ? ((input.detail as { sessionId: string }).sessionId)
            : null;
        await this.alerts.createFromEvent({
          eventId: eventRow.id,
          eventType: input.type,
          eventSeverity: input.severity,
          relatedUserId: input.userId,
          relatedSessionId: sessionId,
          detailsJson: input.detail,
        });
      } catch (err) {
        this.log.warn(
          `[SessionService] emit ${input.type} alert fan-out failed: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
    }
  }
}
