import {
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request, Response } from 'express';
import {
  getRateLimitPolicy,
  isSensitivePolicy,
  type RateLimitPolicyKey,
} from '@xuantoi/shared';
import { AuthService } from '../auth/auth.service';
import {
  RATE_LIMIT_POLICY_KEY,
  SKIP_RATE_LIMIT_KEY,
} from './rate-limit-policy.decorator';
import { RateLimitService } from './rate-limit.service';
import { SecurityAbuseService } from './security-abuse.service';
import { IpHashService } from './ip-hash.service';

const ACCESS_COOKIE = 'xt_access';

/**
 * Phase 18.1 — RateLimitGuard.
 *
 * Opt-in: chỉ enforce trên route có `@RateLimitPolicy(...)`. Route có
 * `@SkipRateLimit()` (vd healthcheck) sẽ skip hoàn toàn.
 *
 * Steps:
 *   1. Check `@SkipRateLimit()` → return true ngay.
 *   2. Đọc policy key từ metadata. Không có → skip (giữ behavior cũ).
 *   3. Derive subject theo scope (IP/USER/CHARACTER/IP_USER).
 *   4. Check abuse block: nếu subject hash đang bị block → throw 429
 *      với `code='ABUSE_BLOCKED'`.
 *   5. Consume rate-limit. Vượt → throw 429 với `code='RATE_LIMITED'`.
 *      Đồng thời record SecurityEvent (sensitive policy mới persist).
 *   6. Set X-RateLimit-* + Retry-After headers (cả allowed và denied).
 */
@Injectable()
export class RateLimitGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly rateLimit: RateLimitService,
    private readonly abuse: SecurityAbuseService,
    private readonly ipHash: IpHashService,
    private readonly auth: AuthService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const skip = this.reflector.getAllAndOverride<boolean>(SKIP_RATE_LIMIT_KEY, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (skip) return true;

    const policyKey = this.reflector.getAllAndOverride<
      RateLimitPolicyKey | undefined
    >(RATE_LIMIT_POLICY_KEY, [ctx.getHandler(), ctx.getClass()]);
    if (!policyKey) return true;

    const policy = getRateLimitPolicy(policyKey);

    const req = ctx.switchToHttp().getRequest<
      Request & {
        userId?: string;
        role?: 'PLAYER' | 'MOD' | 'ADMIN';
      }
    >();
    const res = ctx.switchToHttp().getResponse<Response>();

    const ip = clientIp(req);

    // userId: ưu tiên req.userId (AdminGuard đã set), fallback decode cookie.
    let userId = req.userId ?? '';
    if (!userId) {
      try {
        const u = await this.auth.userIdFromAccess(req.cookies?.[ACCESS_COOKIE]);
        if (u) userId = u;
      } catch {
        userId = '';
      }
    }

    const subject = this.deriveSubject(policy.scope, { ip, userId });

    // Abuse block check (sensitive policy only — LOW policy không tạo block).
    if (policy.sensitive) {
      const ipBlocked = await this.abuse.isBlocked('IP', this.ipHash.hashIp(ip));
      if (ipBlocked.blocked) {
        setHeaders(res, {
          limit: policy.maxRequests,
          remaining: 0,
          resetAt: ipBlocked.expiresAt?.getTime() ?? Date.now(),
          retryAfterSec: ipBlocked.retryAfterSec ?? policy.blockSec,
        });
        throw new HttpException(
          {
            ok: false,
            error: {
              code: 'ABUSE_BLOCKED',
              message: 'ABUSE_BLOCKED',
              policy: policy.key,
              retryAfterSec: ipBlocked.retryAfterSec ?? policy.blockSec,
              resetAt: ipBlocked.expiresAt?.toISOString(),
            },
          },
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }
      if (userId) {
        const userBlocked = await this.abuse.isBlocked('USER', userId);
        if (userBlocked.blocked) {
          setHeaders(res, {
            limit: policy.maxRequests,
            remaining: 0,
            resetAt: userBlocked.expiresAt?.getTime() ?? Date.now(),
            retryAfterSec: userBlocked.retryAfterSec ?? policy.blockSec,
          });
          throw new HttpException(
            {
              ok: false,
              error: {
                code: 'ABUSE_BLOCKED',
                message: 'ABUSE_BLOCKED',
                policy: policy.key,
                retryAfterSec: userBlocked.retryAfterSec ?? policy.blockSec,
                resetAt: userBlocked.expiresAt?.toISOString(),
              },
            },
            HttpStatus.TOO_MANY_REQUESTS,
          );
        }
      }
    }

    const result = await this.rateLimit.consume(policy.key, policy.scope, subject);

    setHeaders(res, {
      limit: policy.maxRequests,
      remaining: result.remaining,
      resetAt: result.resetAt,
      retryAfterSec: result.retryAfterSec,
    });

    if (!result.allowed) {
      // Record + potentially escalate to block
      if (isSensitivePolicy(policy.key)) {
        await this.abuse.recordRateLimitViolation({
          policy: policy.key,
          ip,
          userId: userId || null,
          severity: policy.severity,
        });
      }
      throw new HttpException(
        {
          ok: false,
          error: {
            code: 'RATE_LIMITED',
            message: 'RATE_LIMITED',
            policy: policy.key,
            retryAfterSec: result.retryAfterSec,
            resetAt: new Date(result.resetAt).toISOString(),
          },
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    return true;
  }

  private deriveSubject(
    scope: 'IP' | 'USER' | 'CHARACTER' | 'IP_USER',
    ctx: { ip: string; userId: string },
  ): string {
    switch (scope) {
      case 'IP':
        return `ip:${ctx.ip}`;
      case 'USER':
        return `user:${ctx.userId || 'anon-' + ctx.ip}`;
      case 'CHARACTER':
        // 1 user = 1 character (Character.userId unique). Dùng userId
        // làm character subject để tránh extra DB lookup ở guard.
        return `char:${ctx.userId || 'anon-' + ctx.ip}`;
      case 'IP_USER':
        return ctx.userId ? `ipu:${ctx.ip}|${ctx.userId}` : `ip:${ctx.ip}`;
      default:
        return `ip:${ctx.ip}`;
    }
  }
}

function clientIp(req: Request): string {
  const fwd = req.headers['x-forwarded-for'];
  if (typeof fwd === 'string' && fwd.length > 0) return fwd.split(',')[0]!.trim();
  if (Array.isArray(fwd) && fwd[0]) return fwd[0];
  return req.ip ?? 'unknown';
}

function setHeaders(
  res: Response,
  info: {
    limit: number;
    remaining: number;
    resetAt: number;
    retryAfterSec: number;
  },
): void {
  try {
    res.setHeader('X-RateLimit-Limit', String(info.limit));
    res.setHeader('X-RateLimit-Remaining', String(Math.max(0, info.remaining)));
    res.setHeader('X-RateLimit-Reset', String(Math.floor(info.resetAt / 1000)));
    if (info.retryAfterSec > 0) {
      res.setHeader('Retry-After', String(info.retryAfterSec));
    }
  } catch {
    // ignore — non-fatal if headers can't be set (e.g. response already sent)
  }
}
