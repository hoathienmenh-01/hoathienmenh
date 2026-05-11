import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { RateLimitPolicyKey, RateLimitSeverity } from '@xuantoi/shared';
import { PrismaService } from '../../common/prisma.service';
import { IpHashService } from './ip-hash.service';

/**
 * Phase 18.1 — SecurityAbuseService (Prisma-backed).
 *
 * Fail2ban-style temporary block layer trên rate-limit. Khi 1 subject
 * (IP hoặc user) vượt rate-limit / login fail / admin route forbidden
 * nhiều lần → block tạm thời theo severity.
 *
 * Persistence:
 *   - `SecurityEvent` row mỗi violation/critical signal (audit/forensic).
 *   - `SecurityBlock` row khi quyết định block subject. Active condition
 *     = `liftedAt IS NULL AND expiresAt > now()`.
 *
 * Counter abuse signal: count `SecurityEvent` cùng `subjectHash` trong
 * window severity. Không phụ thuộc Redis cho persistence — restart vẫn
 * giữ counter. Index `ipHash + type + createdAt` đảm bảo query nhanh.
 *
 * Fail-safe: nếu DB throw → log warn + skip persistence + KHÔNG crash
 * caller. Rate-limit guard vẫn deny request hiện tại.
 *
 * **Privacy**:
 *   - IP hashed qua `IpHashService` trước khi persist.
 *   - `detailJson` KHÔNG chứa raw password/token/cookie — service chỉ
 *     truyền field đã sanitize.
 */

export type SecurityEventType =
  | 'RATE_LIMIT_VIOLATION'
  | 'LOGIN_FAILED'
  | 'REGISTER_SPAM'
  | 'INVALID_TOKEN'
  | 'ADMIN_FORBIDDEN'
  | 'IP_BLOCKED'
  | 'USER_BLOCKED'
  | 'BLOCK_LIFTED'
  /** Phase 18.2 — UserSession created on login/register. */
  | 'SESSION_CREATED'
  /** Phase 18.2 — UserSession revoked (user/admin/reuse/password-change). */
  | 'SESSION_REVOKED'
  /**
   * Phase 18.2 — refresh token đã rotate được present lại → defensive
   * revoke cả session family. CRITICAL severity.
   */
  | 'REFRESH_TOKEN_REUSED'
  /**
   * Phase 18.2 — heuristic suspicious (reserve cho phase sau wire
   * heuristic; KHÔNG enforce ở 18.2).
   */
  | 'SESSION_SUSPICIOUS';

export interface IsBlockedResult {
  blocked: boolean;
  expiresAt?: Date;
  retryAfterSec?: number;
  reason?: string;
  blockId?: string;
}

export interface RecordRateLimitViolationInput {
  policy: RateLimitPolicyKey;
  ip: string;
  userId: string | null;
  severity: RateLimitSeverity;
}

export interface RecordLoginFailedInput {
  ip: string;
  email: string;
}

export interface RecordAdminForbiddenInput {
  ip: string;
  userId: string | null;
  path: string;
}

/** Threshold abuse → block, dựa trên severity policy. */
const ABUSE_THRESHOLD: Record<RateLimitSeverity, number> = {
  LOW: 0,
  MEDIUM: 10,
  HIGH: 5,
};

/** Cửa sổ đếm abuse signal, giây. */
const ABUSE_WINDOW_SEC: Record<RateLimitSeverity, number> = {
  LOW: 5 * 60,
  MEDIUM: 15 * 60,
  HIGH: 15 * 60,
};

/** Login failed dedicated threshold (chặt hơn rate-limit). */
const LOGIN_FAILED_THRESHOLD = 10;
const LOGIN_FAILED_WINDOW_SEC = 15 * 60;
const LOGIN_FAILED_BLOCK_SEC = 30 * 60;

@Injectable()
export class SecurityAbuseService {
  private readonly enabled: boolean;

  constructor(
    private readonly prisma: PrismaService,
    private readonly ipHash: IpHashService,
    cfg: ConfigService,
  ) {
    this.enabled = cfg.get<string>('ABUSE_BLOCK_ENABLED') !== 'false';
  }

  isAbuseBlockEnabled(): boolean {
    return this.enabled;
  }

  /**
   * Check whether a subject (IP or USER) is currently blocked.
   *
   * For IP scope, pass `ip` as the raw IP (we hash internally).
   * For USER scope, pass raw `userId` (we DON'T hash — stored as-is).
   */
  async isBlocked(
    type: 'IP' | 'USER',
    rawSubject: string,
  ): Promise<IsBlockedResult> {
    if (!this.enabled) return { blocked: false };
    const subjectHash =
      type === 'IP' ? this.ipHash.hashIp(rawSubject) : rawSubject;
    try {
      const now = new Date();
      const block = await this.prisma.securityBlock.findFirst({
        where: {
          type,
          subjectHash,
          liftedAt: null,
          expiresAt: { gt: now },
        },
        orderBy: { createdAt: 'desc' },
      });
      if (!block) return { blocked: false };
      return {
        blocked: true,
        blockId: block.id,
        expiresAt: block.expiresAt,
        retryAfterSec: Math.max(
          1,
          Math.ceil((block.expiresAt.getTime() - now.getTime()) / 1000),
        ),
        reason: block.reason,
      };
    } catch (err) {
      console.warn(
        `[SecurityAbuseService] isBlocked failed (fail-open): ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      return { blocked: false };
    }
  }

  /**
   * Record rate-limit violation. Khi đủ threshold → escalate to block.
   * Return true nếu tạo block mới ở call này.
   */
  async recordRateLimitViolation(
    input: RecordRateLimitViolationInput,
  ): Promise<boolean> {
    if (!this.enabled) return false;
    const ipHash = this.ipHash.hashIp(input.ip);
    const severityLabel = this.toEventSeverity(input.severity);
    try {
      await this.prisma.securityEvent.create({
        data: {
          type: 'RATE_LIMIT_VIOLATION',
          severity: severityLabel,
          ipHash,
          userId: input.userId,
          policy: input.policy,
          detailJson: { policy: input.policy, severity: input.severity },
        },
      });

      const threshold = ABUSE_THRESHOLD[input.severity];
      if (threshold === 0) return false;
      const windowSec = ABUSE_WINDOW_SEC[input.severity];
      const since = new Date(Date.now() - windowSec * 1000);

      const ipCount = await this.prisma.securityEvent.count({
        where: {
          type: 'RATE_LIMIT_VIOLATION',
          ipHash,
          createdAt: { gte: since },
        },
      });
      let created = false;
      if (ipCount >= threshold) {
        created =
          (await this.createBlock({
            type: 'IP',
            subjectHash: ipHash,
            reason: `RATE_LIMIT_VIOLATION:${input.policy}:${input.severity}`,
            blockSec: this.severityBlockSec(input.severity),
          })) || created;
      }
      if (input.userId) {
        const userCount = await this.prisma.securityEvent.count({
          where: {
            type: 'RATE_LIMIT_VIOLATION',
            userId: input.userId,
            createdAt: { gte: since },
          },
        });
        if (userCount >= threshold) {
          created =
            (await this.createBlock({
              type: 'USER',
              subjectHash: input.userId,
              reason: `RATE_LIMIT_VIOLATION:${input.policy}:${input.severity}`,
              blockSec: this.severityBlockSec(input.severity),
            })) || created;
        }
      }
      return created;
    } catch (err) {
      console.warn(
        `[SecurityAbuseService] recordRateLimitViolation failed: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      return false;
    }
  }

  async recordLoginFailed(input: RecordLoginFailedInput): Promise<boolean> {
    if (!this.enabled) return false;
    const ipHash = this.ipHash.hashIp(input.ip);
    try {
      // detailJson chỉ chứa email (đã là identifier, không phải secret) —
      // KHÔNG lưu password.
      await this.prisma.securityEvent.create({
        data: {
          type: 'LOGIN_FAILED',
          severity: 'WARN',
          ipHash,
          detailJson: { email: input.email },
        },
      });
      const since = new Date(Date.now() - LOGIN_FAILED_WINDOW_SEC * 1000);
      const ipCount = await this.prisma.securityEvent.count({
        where: { type: 'LOGIN_FAILED', ipHash, createdAt: { gte: since } },
      });
      if (ipCount >= LOGIN_FAILED_THRESHOLD) {
        return await this.createBlock({
          type: 'IP',
          subjectHash: ipHash,
          reason: 'LOGIN_FAILED_SPAM',
          blockSec: LOGIN_FAILED_BLOCK_SEC,
        });
      }
      return false;
    } catch (err) {
      console.warn(
        `[SecurityAbuseService] recordLoginFailed failed: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      return false;
    }
  }

  async recordAdminForbidden(
    input: RecordAdminForbiddenInput,
  ): Promise<boolean> {
    if (!this.enabled) return false;
    const ipHash = this.ipHash.hashIp(input.ip);
    try {
      await this.prisma.securityEvent.create({
        data: {
          type: 'ADMIN_FORBIDDEN',
          severity: 'WARN',
          ipHash,
          userId: input.userId,
          detailJson: { path: input.path },
        },
      });
      return false;
    } catch (err) {
      console.warn(
        `[SecurityAbuseService] recordAdminForbidden failed: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      return false;
    }
  }

  /**
   * Tạo block subject. Idempotent: nếu đã có block active (chưa lift,
   * chưa hết hạn) → không tạo thêm.
   * Return true nếu block mới được tạo.
   */
  async createBlock(input: {
    type: 'IP' | 'USER';
    subjectHash: string;
    reason: string;
    blockSec: number;
  }): Promise<boolean> {
    try {
      const now = new Date();
      const existing = await this.prisma.securityBlock.findFirst({
        where: {
          type: input.type,
          subjectHash: input.subjectHash,
          liftedAt: null,
          expiresAt: { gt: now },
        },
      });
      if (existing) return false;
      const expiresAt = new Date(now.getTime() + input.blockSec * 1000);
      await this.prisma.securityBlock.create({
        data: {
          type: input.type,
          subjectHash: input.subjectHash,
          reason: input.reason,
          expiresAt,
        },
      });
      await this.prisma.securityEvent.create({
        data: {
          type: input.type === 'IP' ? 'IP_BLOCKED' : 'USER_BLOCKED',
          severity: 'CRITICAL',
          ipHash: input.type === 'IP' ? input.subjectHash : null,
          userId: input.type === 'USER' ? input.subjectHash : null,
          detailJson: { reason: input.reason, blockSec: input.blockSec },
        },
      });
      return true;
    } catch (err) {
      console.warn(
        `[SecurityAbuseService] createBlock failed: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      return false;
    }
  }

  /**
   * Lift block (admin action). Records BLOCK_LIFTED event for audit.
   * Returns lifted block info, or null if not found / already lifted.
   */
  async liftBlock(
    blockId: string,
    adminUserId: string,
  ): Promise<{
    id: string;
    type: 'IP' | 'USER';
    subjectHash: string;
    reason: string;
  } | null> {
    try {
      const block = await this.prisma.securityBlock.findUnique({
        where: { id: blockId },
      });
      if (!block || block.liftedAt) return null;
      await this.prisma.securityBlock.update({
        where: { id: blockId },
        data: { liftedAt: new Date(), liftedById: adminUserId },
      });
      await this.prisma.securityEvent.create({
        data: {
          type: 'BLOCK_LIFTED',
          severity: 'INFO',
          ipHash: block.type === 'IP' ? block.subjectHash : null,
          userId: block.type === 'USER' ? block.subjectHash : null,
          detailJson: {
            reason: block.reason,
            blockId,
            liftedBy: adminUserId,
          },
        },
      });
      return {
        id: block.id,
        type: block.type as 'IP' | 'USER',
        subjectHash: block.subjectHash,
        reason: block.reason,
      };
    } catch (err) {
      console.warn(
        `[SecurityAbuseService] liftBlock failed: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      return null;
    }
  }

  /**
   * Admin query — list active blocks (paginated).
   */
  async listActiveBlocks(opts: {
    limit?: number;
    cursor?: string;
    type?: 'IP' | 'USER';
  }): Promise<
    Array<{
      id: string;
      type: 'IP' | 'USER';
      subjectHash: string;
      reason: string;
      expiresAt: Date;
      createdAt: Date;
    }>
  > {
    const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200);
    const now = new Date();
    const blocks = await this.prisma.securityBlock.findMany({
      where: {
        liftedAt: null,
        expiresAt: { gt: now },
        ...(opts.type ? { type: opts.type } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
      ...(opts.cursor ? { skip: 1, cursor: { id: opts.cursor } } : {}),
    });
    return blocks.map((b) => ({
      id: b.id,
      type: b.type as 'IP' | 'USER',
      subjectHash: b.subjectHash,
      reason: b.reason,
      expiresAt: b.expiresAt,
      createdAt: b.createdAt,
    }));
  }

  /**
   * Admin query — list recent security events (paginated, filtered).
   */
  async listRecentEvents(opts: {
    limit?: number;
    from?: Date;
    to?: Date;
    severity?: 'INFO' | 'WARN' | 'CRITICAL';
    type?: SecurityEventType;
    cursor?: string;
  }): Promise<
    Array<{
      id: string;
      type: string;
      severity: string;
      ipHash: string | null;
      userId: string | null;
      characterId: string | null;
      policy: string | null;
      detailJson: unknown;
      createdAt: Date;
    }>
  > {
    const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200);
    const where: Record<string, unknown> = {};
    if (opts.type) where.type = opts.type;
    if (opts.severity) where.severity = opts.severity;
    const createdAtFilter: Record<string, Date> = {};
    if (opts.from) createdAtFilter.gte = opts.from;
    if (opts.to) createdAtFilter.lte = opts.to;
    if (Object.keys(createdAtFilter).length > 0) {
      where.createdAt = createdAtFilter;
    }
    const events = await this.prisma.securityEvent.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: limit,
      ...(opts.cursor ? { skip: 1, cursor: { id: opts.cursor } } : {}),
    });
    return events.map((e) => ({
      id: e.id,
      type: e.type,
      severity: e.severity,
      ipHash: e.ipHash,
      userId: e.userId,
      characterId: e.characterId,
      policy: e.policy,
      detailJson: e.detailJson,
      createdAt: e.createdAt,
    }));
  }

  private severityBlockSec(severity: RateLimitSeverity): number {
    switch (severity) {
      case 'HIGH':
        return 30 * 60;
      case 'MEDIUM':
        return 15 * 60;
      default:
        return 5 * 60;
    }
  }

  private toEventSeverity(s: RateLimitSeverity): 'INFO' | 'WARN' | 'CRITICAL' {
    switch (s) {
      case 'HIGH':
        return 'CRITICAL';
      case 'MEDIUM':
        return 'WARN';
      default:
        return 'INFO';
    }
  }
}
