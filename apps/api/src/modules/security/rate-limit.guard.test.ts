/**
 * Phase 18.1 — RateLimitGuard unit tests.
 *
 * Coverage:
 *   - `@SkipRateLimit()` (healthcheck) → bypass guard, return true.
 *   - No policy metadata → return true (opt-in design).
 *   - Allowed request: sets X-RateLimit-* headers.
 *   - Denied request: throws 429 with policy + retryAfterSec.
 *   - Sets Retry-After header when limit exceeded.
 *   - Abuse-blocked IP → throws 429 ABUSE_BLOCKED before consume.
 *   - Sensitive policy violation → calls recordRateLimitViolation.
 */
import { describe, expect, it, vi } from 'vitest';
import { HttpException, HttpStatus } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { ExecutionContext } from '@nestjs/common';
import { RateLimitGuard } from './rate-limit.guard';
import type { RateLimitService } from './rate-limit.service';
import type { SecurityAbuseService } from './security-abuse.service';
import type { IpHashService } from './ip-hash.service';
import type { AuthService } from '../auth/auth.service';
import {
  RATE_LIMIT_POLICY_KEY,
  SKIP_RATE_LIMIT_KEY,
} from './rate-limit-policy.decorator';

function makeReflector(handlerMeta: Record<string, unknown>): Reflector {
  return {
    getAllAndOverride: (key: string) => handlerMeta[key],
  } as unknown as Reflector;
}

interface FakeRes {
  headers: Record<string, string>;
  setHeader: (k: string, v: string) => void;
}

function makeRes(): FakeRes {
  const headers: Record<string, string> = {};
  return {
    headers,
    setHeader(k: string, v: string) {
      headers[k] = v;
    },
  };
}

function makeCtx(
  reflectorMeta: Record<string, unknown>,
  req: Record<string, unknown> = {},
  res: FakeRes = makeRes(),
): { ctx: ExecutionContext; res: FakeRes; reflector: Reflector } {
  const reflector = makeReflector(reflectorMeta);
  const ctx = {
    switchToHttp: () => ({
      getRequest: () => req,
      getResponse: () => res,
    }),
    getHandler: () => () => undefined,
    getClass: () => class X {},
  } as unknown as ExecutionContext;
  return { ctx, res, reflector };
}

function makeGuard(
  reflector: Reflector,
  overrides: Partial<{
    rateLimit: RateLimitService;
    abuse: SecurityAbuseService;
    ipHash: IpHashService;
    auth: AuthService;
  }> = {},
): RateLimitGuard {
  return new RateLimitGuard(
    reflector,
    overrides.rateLimit ??
      ({
        consume: vi.fn(),
      } as unknown as RateLimitService),
    overrides.abuse ??
      ({
        isBlocked: vi.fn().mockResolvedValue({ blocked: false }),
        recordRateLimitViolation: vi.fn().mockResolvedValue(false),
      } as unknown as SecurityAbuseService),
    overrides.ipHash ??
      ({
        hashIp: (ip: string) => `h-${ip}`,
      } as unknown as IpHashService),
    overrides.auth ??
      ({
        userIdFromAccess: vi.fn().mockResolvedValue(null),
      } as unknown as AuthService),
  );
}

describe('RateLimitGuard', () => {
  it('@SkipRateLimit() → bypass guard, return true', async () => {
    const { ctx, reflector } = makeCtx({ [SKIP_RATE_LIMIT_KEY]: true });
    const guard = makeGuard(reflector);
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
  });

  it('no policy metadata → return true (opt-in)', async () => {
    const { ctx, reflector } = makeCtx({});
    const guard = makeGuard(reflector);
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
  });

  it('allowed request → set X-RateLimit-* headers', async () => {
    const { ctx, res, reflector } = makeCtx(
      { [RATE_LIMIT_POLICY_KEY]: 'SHOP_BUY' },
      { ip: '1.1.1.1', headers: {} },
    );
    const rateLimit = {
      consume: vi.fn().mockResolvedValue({
        allowed: true,
        remaining: 29,
        resetAt: Date.now() + 60_000,
        retryAfterSec: 0,
      }),
    } as unknown as RateLimitService;
    const guard = makeGuard(reflector, { rateLimit });
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(res.headers['X-RateLimit-Limit']).toBeDefined();
    expect(res.headers['X-RateLimit-Remaining']).toBe('29');
    expect(res.headers['X-RateLimit-Reset']).toBeDefined();
    expect(res.headers['Retry-After']).toBeUndefined();
  });

  it('denied request → throw 429 RATE_LIMITED + Retry-After header', async () => {
    const { ctx, res, reflector } = makeCtx(
      { [RATE_LIMIT_POLICY_KEY]: 'SHOP_BUY' },
      { ip: '1.1.1.1', headers: {} },
    );
    const recordSpy = vi.fn().mockResolvedValue(false);
    const rateLimit = {
      consume: vi.fn().mockResolvedValue({
        allowed: false,
        remaining: 0,
        resetAt: Date.now() + 60_000,
        retryAfterSec: 60,
      }),
    } as unknown as RateLimitService;
    const abuse = {
      isBlocked: vi.fn().mockResolvedValue({ blocked: false }),
      recordRateLimitViolation: recordSpy,
    } as unknown as SecurityAbuseService;
    const guard = makeGuard(reflector, { rateLimit, abuse });
    await expect(guard.canActivate(ctx)).rejects.toMatchObject({
      status: HttpStatus.TOO_MANY_REQUESTS,
    });
    expect(res.headers['Retry-After']).toBe('60');
    expect(recordSpy).toHaveBeenCalled();
  });

  it('429 body có code=RATE_LIMITED + policy + retryAfterSec', async () => {
    const { ctx, reflector } = makeCtx(
      { [RATE_LIMIT_POLICY_KEY]: 'SHOP_BUY' },
      { ip: '1.1.1.1', headers: {} },
    );
    const rateLimit = {
      consume: vi.fn().mockResolvedValue({
        allowed: false,
        remaining: 0,
        resetAt: Date.now() + 60_000,
        retryAfterSec: 30,
      }),
    } as unknown as RateLimitService;
    const guard = makeGuard(reflector, { rateLimit });
    let captured: HttpException | undefined;
    try {
      await guard.canActivate(ctx);
    } catch (err) {
      captured = err as HttpException;
    }
    expect(captured).toBeDefined();
    const body = captured!.getResponse() as {
      ok: boolean;
      error: { code: string; policy: string; retryAfterSec: number };
    };
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe('RATE_LIMITED');
    expect(body.error.policy).toBe('SHOP_BUY');
    expect(body.error.retryAfterSec).toBe(30);
  });

  it('abuse-blocked IP → throw 429 ABUSE_BLOCKED trước khi consume', async () => {
    const { ctx, reflector } = makeCtx(
      { [RATE_LIMIT_POLICY_KEY]: 'AUTH_LOGIN' },
      { ip: '1.1.1.1', headers: {} },
    );
    const consumeSpy = vi.fn();
    const rateLimit = {
      consume: consumeSpy,
    } as unknown as RateLimitService;
    const abuse = {
      isBlocked: vi.fn().mockResolvedValue({
        blocked: true,
        expiresAt: new Date(Date.now() + 60_000),
        retryAfterSec: 60,
        reason: 'LOGIN_FAILED_SPAM',
      }),
      recordRateLimitViolation: vi.fn(),
    } as unknown as SecurityAbuseService;
    const guard = makeGuard(reflector, { rateLimit, abuse });
    let captured: HttpException | undefined;
    try {
      await guard.canActivate(ctx);
    } catch (err) {
      captured = err as HttpException;
    }
    expect(captured?.getStatus()).toBe(HttpStatus.TOO_MANY_REQUESTS);
    const body = captured!.getResponse() as { error: { code: string } };
    expect(body.error.code).toBe('ABUSE_BLOCKED');
    expect(consumeSpy).not.toHaveBeenCalled();
  });
});
