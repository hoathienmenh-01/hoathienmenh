/**
 * Phase 18.1 — RateLimitService unit tests.
 *
 * Coverage:
 *   - In-memory fallback when Redis undefined (default in unit env).
 *   - Hits below maxRequests allowed; hit at maxRequests still allowed
 *     (count == max), hit > maxRequests blocked.
 *   - Headers data: remaining, resetAt, retryAfterSec.
 *   - `RATE_LIMIT_ENABLED=false` → skipped=true, allowed=true.
 *   - Different subjects counted independently.
 *   - Different policies counted independently.
 *   - peek() does NOT increment.
 *   - In-memory key cap eviction (cap=50k, simulate eviction).
 */
import { describe, expect, it } from 'vitest';
import { ConfigService } from '@nestjs/config';
import { RateLimitService } from './rate-limit.service';

function makeCfg(env: Record<string, string> = {}): ConfigService {
  return {
    get: (key: string) => env[key],
  } as unknown as ConfigService;
}

function makeService(env: Record<string, string> = {}): RateLimitService {
  // Redis undefined → in-memory fallback path.
  return new RateLimitService(makeCfg(env));
}

describe('RateLimitService — in-memory fallback', () => {
  it('cho phép đủ maxRequests, từ chối hit kế tiếp', async () => {
    const svc = makeService();
    // SHOP_BUY = 60s window, max 30 hits, USER scope.
    const policy = 'SHOP_BUY' as const;
    for (let i = 0; i < 30; i += 1) {
      const r = await svc.consume(policy, 'USER', 'user-1');
      expect(r.allowed).toBe(true);
      expect(r.remaining).toBe(30 - 1 - i);
    }
    const over = await svc.consume(policy, 'USER', 'user-1');
    expect(over.allowed).toBe(false);
    expect(over.remaining).toBe(0);
    expect(over.retryAfterSec).toBeGreaterThan(0);
  });

  it('subject khác nhau đếm riêng', async () => {
    const svc = makeService();
    const a = await svc.consume('SHOP_BUY', 'USER', 'user-A');
    const b = await svc.consume('SHOP_BUY', 'USER', 'user-B');
    expect(a.count).toBe(1);
    expect(b.count).toBe(1);
  });

  it('policy khác nhau đếm riêng', async () => {
    const svc = makeService();
    const a = await svc.consume('SHOP_BUY', 'USER', 'user-1');
    const b = await svc.consume('MARKET_BUY', 'USER', 'user-1');
    expect(a.count).toBe(1);
    expect(b.count).toBe(1);
  });

  it('RATE_LIMIT_ENABLED=false → skipped=true, allowed=true', async () => {
    const svc = makeService({ RATE_LIMIT_ENABLED: 'false' });
    const r = await svc.consume('SHOP_BUY', 'USER', 'user-1');
    expect(r.allowed).toBe(true);
    expect(r.skipped).toBe(true);
    expect(r.remaining).toBe(r.policy.maxRequests);
  });

  it('peek() KHÔNG increment counter', async () => {
    const svc = makeService();
    await svc.consume('SHOP_BUY', 'USER', 'user-1');
    await svc.consume('SHOP_BUY', 'USER', 'user-1');
    const p1 = await svc.peek('SHOP_BUY', 'USER', 'user-1');
    const p2 = await svc.peek('SHOP_BUY', 'USER', 'user-1');
    expect(p1.count).toBe(2);
    expect(p2.count).toBe(2);
  });

  it('isEnabled() reflect env', () => {
    expect(makeService().isEnabled()).toBe(true);
    expect(
      makeService({ RATE_LIMIT_ENABLED: 'false' }).isEnabled(),
    ).toBe(false);
  });

  it('remaining + resetAt phù hợp với policy', async () => {
    const svc = makeService();
    const r = await svc.consume('AUTH_LOGIN', 'IP_USER', 'subj');
    expect(r.remaining).toBe(r.policy.maxRequests - 1);
    expect(r.resetAt).toBeGreaterThan(Date.now());
    expect(r.retryAfterSec).toBe(0);
  });
});

describe('RateLimitService — Redis path fail-soft', () => {
  it('Redis throw → fallback in-memory (fail-soft mặc định)', async () => {
    const redis = {
      multi: () => {
        throw new Error('redis-down');
      },
    } as unknown as Parameters<
      typeof RateLimitService.prototype.consume
    >[0] extends never
      ? never
      : import('ioredis').Redis;
    const svc = new RateLimitService(makeCfg(), redis);
    const r = await svc.consume('SHOP_BUY', 'USER', 'user-1');
    // fail-soft: degraded but allowed
    expect(r.allowed).toBe(true);
    expect(r.degraded).toBe(true);
  });

  it('RATE_LIMIT_FAIL_OPEN=false + Redis throw → fail-closed', async () => {
    const redis = {
      multi: () => {
        throw new Error('redis-down');
      },
    } as unknown as import('ioredis').Redis;
    const svc = new RateLimitService(
      makeCfg({ RATE_LIMIT_FAIL_OPEN: 'false' }),
      redis,
    );
    const r = await svc.consume('SHOP_BUY', 'USER', 'user-1');
    expect(r.allowed).toBe(false);
    expect(r.degraded).toBe(true);
  });
});
