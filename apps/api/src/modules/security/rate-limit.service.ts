import { Inject, Injectable, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  RATE_LIMIT_POLICIES,
  buildRateLimitKey,
  type RateLimitPolicy,
  type RateLimitPolicyKey,
} from '@xuantoi/shared';
import type { Redis } from 'ioredis';
import { REDIS_CONNECTION } from '../../common/redis.module';

/**
 * Phase 18.1 — RateLimitService (Redis-backed, fail-soft).
 *
 * Mỗi `consume(policy, subject)` ghi nhận 1 hit, dọn hit cũ > windowSec,
 * trả `{ allowed, remaining, resetAt, retryAfterSec }`.
 *
 * Backend:
 *   - Redis (sliding window qua ZSET): default cho production.
 *   - In-memory fallback: khi Redis throw / undefined / env disabled.
 *
 * Fail-open behavior (`RATE_LIMIT_FAIL_OPEN=true`, mặc định true): nếu
 * Redis throw → tạm thời dùng in-memory + log warn → request hiện tại
 * vẫn pass theo per-instance counter. KHÔNG block toàn hệ thống nếu
 * Redis down. Lý do: rate-limit là defense-in-depth, không phải primary
 * security barrier. Mất rate-limit tạm thời ≠ mất authn/authz.
 *
 * Fail-closed mode (`RATE_LIMIT_FAIL_OPEN=false`): khi Redis throw →
 * trả `allowed=false` (treat as rate-limited). Dùng khi muốn paranoia
 * cao hơn — risk: Redis blip → user bị block oan.
 */

export interface RateLimitCheckResult {
  allowed: boolean;
  remaining: number;
  /** Epoch ms khi window reset (window mới bắt đầu nếu user không tiếp tục hit). */
  resetAt: number;
  /** Số giây client nên đợi trước khi retry. 0 nếu allowed. */
  retryAfterSec: number;
  policy: RateLimitPolicy;
  /** Hit count hiện tại trong window. */
  count: number;
  /** true nếu rate-limit bị skip do RATE_LIMIT_ENABLED=false. */
  skipped: boolean;
  /** true nếu primary backend fail, đã fallback. */
  degraded: boolean;
}

/** Cap in-memory store để không leak memory. */
const IN_MEMORY_KEY_CAP = 50_000;

@Injectable()
export class RateLimitService {
  private readonly enabled: boolean;
  private readonly failOpen: boolean;
  private readonly memStore = new Map<string, number[]>();
  private redisWarned = false;

  constructor(
    cfg: ConfigService,
    @Optional() @Inject(REDIS_CONNECTION) private readonly redis?: Redis,
  ) {
    this.enabled = cfg.get<string>('RATE_LIMIT_ENABLED') !== 'false';
    this.failOpen = cfg.get<string>('RATE_LIMIT_FAIL_OPEN') !== 'false';
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  /**
   * Increment + check trong 1 call. Dùng bởi guard.
   */
  async consume(
    policyKey: RateLimitPolicyKey,
    scope: 'IP' | 'USER' | 'CHARACTER' | 'IP_USER',
    subject: string,
  ): Promise<RateLimitCheckResult> {
    const policy = RATE_LIMIT_POLICIES[policyKey];
    if (!this.enabled) {
      return {
        allowed: true,
        remaining: policy.maxRequests,
        resetAt: Date.now() + policy.windowSec * 1000,
        retryAfterSec: 0,
        policy,
        count: 0,
        skipped: true,
        degraded: false,
      };
    }
    const key = buildRateLimitKey(policyKey, scope, subject);
    const windowMs = policy.windowSec * 1000;
    const now = Date.now();

    if (this.redis) {
      try {
        const winStart = now - windowMs;
        const member = `${now}-${Math.random().toString(36).slice(2, 10)}`;
        const pipeline = this.redis.multi();
        pipeline.zremrangebyscore(key, 0, winStart);
        pipeline.zadd(key, now, member);
        pipeline.zcard(key);
        pipeline.pexpire(key, windowMs + 1000);
        const res = await pipeline.exec();
        const raw = res?.[2]?.[1];
        const count =
          typeof raw === 'number'
            ? raw
            : typeof raw === 'string'
              ? Number(raw)
              : 0;
        const allowed = count <= policy.maxRequests;
        const remaining = Math.max(0, policy.maxRequests - count);
        const resetAt = now + windowMs;
        const retryAfterSec = allowed ? 0 : Math.ceil(windowMs / 1000);
        return {
          allowed,
          remaining,
          resetAt,
          retryAfterSec,
          policy,
          count,
          skipped: false,
          degraded: false,
        };
      } catch (err) {
        if (!this.redisWarned) {
          this.redisWarned = true;
          console.warn(
            `[RateLimitService] Redis pipeline failed, falling back to in-memory: ${
              err instanceof Error ? err.message : String(err)
            }`,
          );
        }
        if (!this.failOpen) {
          // Fail-closed: treat as rate-limited để paranoia
          return {
            allowed: false,
            remaining: 0,
            resetAt: now + windowMs,
            retryAfterSec: Math.ceil(windowMs / 1000),
            policy,
            count: policy.maxRequests + 1,
            skipped: false,
            degraded: true,
          };
        }
        // Fall through to in-memory
      }
    }

    // In-memory sliding window
    const winStart = now - windowMs;
    const arr = (this.memStore.get(key) ?? []).filter((t) => t > winStart);
    arr.push(now);
    if (arr.length > policy.maxRequests * 4) {
      arr.splice(0, arr.length - policy.maxRequests * 4);
    }
    this.memStore.set(key, arr);
    if (this.memStore.size > IN_MEMORY_KEY_CAP) {
      // Drop ~10% oldest entries để tránh phình.
      const dropCount = Math.ceil(this.memStore.size * 0.1);
      let i = 0;
      for (const k of this.memStore.keys()) {
        if (i++ >= dropCount) break;
        this.memStore.delete(k);
      }
    }
    const count = arr.length;
    const allowed = count <= policy.maxRequests;
    const remaining = Math.max(0, policy.maxRequests - count);
    const resetAt = now + windowMs;
    const retryAfterSec = allowed ? 0 : Math.ceil(windowMs / 1000);
    return {
      allowed,
      remaining,
      resetAt,
      retryAfterSec,
      policy,
      count,
      skipped: false,
      degraded: !!this.redis,
    };
  }

  /**
   * Peek current count without incrementing. Dùng cho admin status endpoint.
   */
  async peek(
    policyKey: RateLimitPolicyKey,
    scope: 'IP' | 'USER' | 'CHARACTER' | 'IP_USER',
    subject: string,
  ): Promise<{ count: number; remaining: number; resetAt: number }> {
    const policy = RATE_LIMIT_POLICIES[policyKey];
    const key = buildRateLimitKey(policyKey, scope, subject);
    const windowMs = policy.windowSec * 1000;
    const now = Date.now();
    if (this.redis) {
      try {
        const winStart = now - windowMs;
        await this.redis.zremrangebyscore(key, 0, winStart);
        const count = await this.redis.zcard(key);
        const c = typeof count === 'number' ? count : Number(count);
        return {
          count: c,
          remaining: Math.max(0, policy.maxRequests - c),
          resetAt: now + windowMs,
        };
      } catch {
        // fallthrough in-memory
      }
    }
    const winStart = now - windowMs;
    const arr = (this.memStore.get(key) ?? []).filter((t) => t > winStart);
    return {
      count: arr.length,
      remaining: Math.max(0, policy.maxRequests - arr.length),
      resetAt: now + windowMs,
    };
  }

  /** TEST-ONLY — reset in-memory state. */
  __resetForTests(): void {
    this.memStore.clear();
    this.redisWarned = false;
  }
}
