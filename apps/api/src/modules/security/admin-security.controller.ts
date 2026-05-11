/**
 * Phase 18.1 — Admin Security monitoring controller.
 *
 * Endpoints (`@RequireAdmin` — MOD bị reject `ADMIN_ONLY` 403):
 *   - `GET    /admin/security/rate-limit/status?subjectType=&subject=`
 *   - `GET    /admin/security/events?from=&to=&severity=&type=&limit=&cursor=`
 *   - `GET    /admin/security/blocks?type=&limit=&cursor=`
 *   - `POST   /admin/security/blocks/:id/lift`
 *
 * Audit:
 *   - `ADMIN_SECURITY_EVENTS_VIEW`  — list events.
 *   - `ADMIN_SECURITY_BLOCKS_VIEW`  — list blocks.
 *   - `ADMIN_SECURITY_BLOCK_LIFT`   — lift block (success).
 *   - `ADMIN_SECURITY_BLOCK_LIFT_FAILED` — lift block (not found/already lifted).
 *
 * Privacy:
 *   - Raw IP KHÔNG bao giờ được trả về — chỉ `ipHash` (sha256 với
 *     `SECURITY_IP_HASH_SALT`).
 *   - `detailJson` đã sanitize ở `SecurityAbuseService` — không chứa
 *     password/token/cookie.
 *
 * Rate-limit:
 *   - GET → `ADMIN_REPORT_VIEW` (cao hơn vì admin tooling poll).
 *   - POST → `ADMIN_MUTATION` (moderate).
 *
 * Bypass:
 *   - Endpoint healthcheck/readiness/version + metrics polling KHÔNG
 *     bypass admin security view: chỉ admin được call (auth gate ở
 *     `AdminGuard`).
 */
import {
  Controller,
  Get,
  HttpCode,
  HttpException,
  HttpStatus,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { PrismaService } from '../../common/prisma.service';
import { AdminGuard } from '../admin/admin.guard';
import { RequireAdmin } from '../admin/require-admin.decorator';
import { IpHashService } from './ip-hash.service';
import { RateLimitService } from './rate-limit.service';
import { RateLimitPolicy } from './rate-limit-policy.decorator';
import {
  SecurityAbuseService,
  type SecurityEventType,
} from './security-abuse.service';
import {
  isRateLimitPolicyKey,
  RATE_LIMIT_POLICY_KEYS,
  type RateLimitPolicyKey,
  type RateLimitScope,
} from '@xuantoi/shared';

type AdminReq = Request & { userId: string; role: 'ADMIN' | 'MOD' };

const EVENT_TYPES: SecurityEventType[] = [
  'RATE_LIMIT_VIOLATION',
  'LOGIN_FAILED',
  'REGISTER_SPAM',
  'INVALID_TOKEN',
  'ADMIN_FORBIDDEN',
  'IP_BLOCKED',
  'USER_BLOCKED',
  'BLOCK_LIFTED',
  // Phase 18.2 — Session lifecycle + reuse detection.
  'SESSION_CREATED',
  'SESSION_REVOKED',
  'REFRESH_TOKEN_REUSED',
  'SESSION_SUSPICIOUS',
];

function fail(code: string, status = HttpStatus.BAD_REQUEST): never {
  throw new HttpException(
    { ok: false, error: { code, message: code } },
    status,
  );
}

function parseLimit(raw: string | undefined, fallback = 50, max = 200): number {
  if (!raw) return fallback;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(n, max);
}

function parseDate(raw: string | undefined): Date | undefined {
  if (!raw) return undefined;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

@Controller('admin/security')
@UseGuards(AdminGuard)
@RateLimitPolicy('ADMIN_MUTATION')
export class AdminSecurityController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly abuse: SecurityAbuseService,
    private readonly rateLimit: RateLimitService,
    private readonly ipHash: IpHashService,
  ) {}

  /**
   * GET /admin/security/rate-limit/status
   *
   * Inspect current rate-limit counter cho 1 subject (debugging /
   * support). KHÔNG increment — chỉ peek state.
   */
  @Get('rate-limit/status')
  @RateLimitPolicy('ADMIN_REPORT_VIEW')
  async rateLimitStatus(
    @Query('policy') policyRaw: string | undefined,
    @Query('scope') scopeRaw: string | undefined,
    @Query('subject') subject: string | undefined,
  ) {
    if (!policyRaw || !isRateLimitPolicyKey(policyRaw)) {
      fail('INVALID_POLICY');
    }
    const policy: RateLimitPolicyKey = policyRaw;
    if (!subject || subject.length === 0 || subject.length > 256) {
      fail('INVALID_SUBJECT');
    }
    const scope = (scopeRaw ?? 'IP_USER') as RateLimitScope;
    if (
      scope !== 'IP' &&
      scope !== 'USER' &&
      scope !== 'CHARACTER' &&
      scope !== 'IP_USER'
    ) {
      fail('INVALID_SCOPE');
    }
    // Hash subject for IP scope; pass through for others.
    const subjectKey =
      scope === 'IP' ? this.ipHash.hashIp(subject) : subject;
    const state = await this.rateLimit.peek(policy, scope, subjectKey);
    return {
      ok: true,
      data: {
        policy,
        scope,
        count: state.count,
        remaining: state.remaining,
        resetAt: new Date(state.resetAt).toISOString(),
      },
    };
  }

  /**
   * GET /admin/security/events
   *
   * List recent SecurityEvent rows (paginated, filterable). Audit nhẹ —
   * không log từng row, chỉ log call (`ADMIN_SECURITY_EVENTS_VIEW`)
   * tránh ngập audit khi admin paginate.
   */
  @Get('events')
  @RateLimitPolicy('ADMIN_REPORT_VIEW')
  async listEvents(
    @Req() req: Request,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('severity') severityRaw?: string,
    @Query('type') typeRaw?: string,
    @Query('limit') limitRaw?: string,
    @Query('cursor') cursor?: string,
  ) {
    const adminReq = req as AdminReq;
    let severity: 'INFO' | 'WARN' | 'CRITICAL' | undefined;
    if (severityRaw) {
      if (
        severityRaw !== 'INFO' &&
        severityRaw !== 'WARN' &&
        severityRaw !== 'CRITICAL'
      ) {
        fail('INVALID_SEVERITY');
      }
      severity = severityRaw;
    }
    let type: SecurityEventType | undefined;
    if (typeRaw) {
      if (!EVENT_TYPES.includes(typeRaw as SecurityEventType)) {
        fail('INVALID_TYPE');
      }
      type = typeRaw as SecurityEventType;
    }
    const events = await this.abuse.listRecentEvents({
      from: parseDate(from),
      to: parseDate(to),
      severity,
      type,
      limit: parseLimit(limitRaw),
      cursor,
    });
    await this.audit(adminReq.userId, 'ADMIN_SECURITY_EVENTS_VIEW', {
      from,
      to,
      severity,
      type,
      count: events.length,
    });
    return {
      ok: true,
      data: {
        events: events.map((e) => ({
          id: e.id,
          type: e.type,
          severity: e.severity,
          ipHash: e.ipHash,
          userId: e.userId,
          characterId: e.characterId,
          policy: e.policy,
          detailJson: e.detailJson,
          createdAt: e.createdAt.toISOString(),
        })),
      },
    };
  }

  /**
   * GET /admin/security/blocks
   *
   * List active blocks (paginated, filter by type IP/USER).
   */
  @Get('blocks')
  @RateLimitPolicy('ADMIN_REPORT_VIEW')
  async listBlocks(
    @Req() req: Request,
    @Query('type') typeRaw?: string,
    @Query('limit') limitRaw?: string,
    @Query('cursor') cursor?: string,
  ) {
    const adminReq = req as AdminReq;
    let type: 'IP' | 'USER' | undefined;
    if (typeRaw) {
      if (typeRaw !== 'IP' && typeRaw !== 'USER') fail('INVALID_TYPE');
      type = typeRaw;
    }
    const blocks = await this.abuse.listActiveBlocks({
      type,
      limit: parseLimit(limitRaw),
      cursor,
    });
    await this.audit(adminReq.userId, 'ADMIN_SECURITY_BLOCKS_VIEW', {
      type,
      count: blocks.length,
    });
    return {
      ok: true,
      data: {
        blocks: blocks.map((b) => ({
          id: b.id,
          type: b.type,
          subjectHash: b.subjectHash,
          reason: b.reason,
          expiresAt: b.expiresAt.toISOString(),
          createdAt: b.createdAt.toISOString(),
        })),
      },
    };
  }

  /**
   * POST /admin/security/blocks/:id/lift
   *
   * Lift 1 block (admin override). Ghi audit
   * `ADMIN_SECURITY_BLOCK_LIFT`. Idempotent: nếu block không tồn tại /
   * đã lift → trả 404 `BLOCK_NOT_FOUND`.
   */
  @Post('blocks/:id/lift')
  @HttpCode(200)
  @RequireAdmin()
  async liftBlock(@Req() req: Request, @Param('id') blockId: string) {
    const adminReq = req as AdminReq;
    if (!blockId || typeof blockId !== 'string' || blockId.length > 128) {
      fail('INVALID_INPUT');
    }
    const lifted = await this.abuse.liftBlock(blockId, adminReq.userId);
    if (!lifted) {
      await this.audit(adminReq.userId, 'ADMIN_SECURITY_BLOCK_LIFT_FAILED', {
        blockId,
      });
      fail('BLOCK_NOT_FOUND', HttpStatus.NOT_FOUND);
    }
    await this.audit(adminReq.userId, 'ADMIN_SECURITY_BLOCK_LIFT', {
      blockId,
      type: lifted.type,
      subjectHash: lifted.subjectHash,
      reason: lifted.reason,
    });
    return {
      ok: true,
      data: {
        block: {
          id: lifted.id,
          type: lifted.type,
          subjectHash: lifted.subjectHash,
          reason: lifted.reason,
        },
      },
    };
  }

  /** GET /admin/security/policies → static catalog (no DB hit). */
  @Get('policies')
  @RateLimitPolicy('ADMIN_REPORT_VIEW')
  async policies() {
    return {
      ok: true,
      data: { keys: [...RATE_LIMIT_POLICY_KEYS] },
    };
  }

  private async audit(
    actorUserId: string,
    action: string,
    meta: Record<string, unknown>,
  ): Promise<void> {
    try {
      // Prisma JSON input — meta is sanitized (no IP/secrets) by callers.
      await this.prisma.adminAuditLog.create({
        data: {
          actorUserId,
          action,
          meta: meta as unknown as import('@prisma/client').Prisma.InputJsonValue,
        },
      });
    } catch (err) {
      console.warn(
        `[AdminSecurityController] audit failed: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }
}
