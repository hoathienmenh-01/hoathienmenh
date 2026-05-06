import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import IORedis, { Redis } from 'ioredis';
import {
  FailoverRateLimiter,
  InMemorySlidingWindowRateLimiter,
  RateLimiter,
  RateLimitResult,
  RedisSlidingWindowRateLimiter,
} from './rate-limiter';

const REDIS_URL = process.env.REDIS_URL ?? 'redis://localhost:6379';

describe('InMemorySlidingWindowRateLimiter', () => {
  it('cho phép đủ max hit, từ chối hit thứ (max+1)', async () => {
    const rl = new InMemorySlidingWindowRateLimiter(1000, 3);
    const a1 = await rl.check('k');
    await rl.check('k');
    const a3 = await rl.check('k');
    const a4 = await rl.check('k');
    expect(a1.allowed).toBe(true);
    expect(a3.allowed).toBe(true);
    expect(a3.count).toBe(3);
    expect(a4.allowed).toBe(false);
    expect(a4.count).toBe(4);
  });

  it('window trượt: sau khi timeout hit cũ được dọn', async () => {
    const rl = new InMemorySlidingWindowRateLimiter(30, 2);
    await rl.check('k');
    await rl.check('k');
    expect((await rl.check('k')).allowed).toBe(false);
    await new Promise((r) => setTimeout(r, 50));
    const after = await rl.check('k');
    expect(after.allowed).toBe(true);
    expect(after.count).toBe(1);
  });

  it('key khác nhau đếm riêng', async () => {
    const rl = new InMemorySlidingWindowRateLimiter(1000, 1);
    expect((await rl.check('a')).allowed).toBe(true);
    expect((await rl.check('a')).allowed).toBe(false);
    expect((await rl.check('b')).allowed).toBe(true);
  });
});

describe('RedisSlidingWindowRateLimiter (real Redis)', () => {
  let redis: Redis;

  beforeAll(() => {
    redis = new IORedis(REDIS_URL, { maxRetriesPerRequest: null });
  });

  beforeEach(async () => {
    await redis.flushdb();
  });

  afterAll(async () => {
    await redis.quit();
  });

  it('cho phép đủ max hit, từ chối hit thứ (max+1) qua Redis', async () => {
    const rl = new RedisSlidingWindowRateLimiter(redis, 1000, 3, 'rl:test');
    expect((await rl.check('k')).allowed).toBe(true);
    expect((await rl.check('k')).allowed).toBe(true);
    const a3 = await rl.check('k');
    expect(a3.allowed).toBe(true);
    expect(a3.count).toBe(3);
    const a4 = await rl.check('k');
    expect(a4.allowed).toBe(false);
    expect(a4.count).toBe(4);
  });

  it('window trượt qua Redis: hit cũ bị ZREMRANGEBYSCORE dọn', async () => {
    const rl = new RedisSlidingWindowRateLimiter(redis, 40, 2, 'rl:test');
    await rl.check('k');
    await rl.check('k');
    expect((await rl.check('k')).allowed).toBe(false);
    await new Promise((r) => setTimeout(r, 60));
    const after = await rl.check('k');
    expect(after.allowed).toBe(true);
    expect(after.count).toBe(1);
  });

  it('set expire để key không tồn tại mãi (pexpire)', async () => {
    const rl = new RedisSlidingWindowRateLimiter(redis, 80, 5, 'rl:test');
    await rl.check('k');
    const ttl = await redis.pttl('rl:test:k');
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(80 + 1000);
  });

  it('prefix cách ly giữa các limiter', async () => {
    const rlA = new RedisSlidingWindowRateLimiter(redis, 1000, 1, 'rl:a');
    const rlB = new RedisSlidingWindowRateLimiter(redis, 1000, 1, 'rl:b');
    expect((await rlA.check('same')).allowed).toBe(true);
    expect((await rlA.check('same')).allowed).toBe(false);
    // rlB có prefix khác nên key độc lập.
    expect((await rlB.check('same')).allowed).toBe(true);
  });
});

describe('FailoverRateLimiter — Concurrency phase 2 Chat Redis failover', () => {
  function makeStub(behavior: 'ok' | 'throw' | { count: number }): RateLimiter {
    return {
      check: vi.fn(async (_key: string): Promise<RateLimitResult> => {
        if (behavior === 'throw') throw new Error('REDIS_DOWN');
        if (behavior === 'ok') return { allowed: true, count: 1 };
        return {
          allowed: behavior.count <= 3,
          count: behavior.count,
        };
      }),
    };
  }

  it('primary OK → trả primary result, không gọi fallback', async () => {
    const fallback = new InMemorySlidingWindowRateLimiter(1000, 3);
    const fallbackSpy = vi.spyOn(fallback, 'check');
    const primary = makeStub('ok');
    const failover = new FailoverRateLimiter(primary, fallback);

    const r = await failover.check('user-1');
    expect(r.allowed).toBe(true);
    expect(r.count).toBe(1);
    expect(primary.check).toHaveBeenCalledTimes(1);
    expect(fallbackSpy).not.toHaveBeenCalled();
  });

  it('primary throw → fallback check được gọi, kết quả trả từ fallback', async () => {
    const logger = { warn: vi.fn() };
    const fallback = new InMemorySlidingWindowRateLimiter(1000, 3);
    const fallbackSpy = vi.spyOn(fallback, 'check');
    const primary = makeStub('throw');
    const failover = new FailoverRateLimiter(primary, fallback, logger);

    const r = await failover.check('user-1');
    expect(r.allowed).toBe(true);
    expect(r.count).toBe(1);
    expect(primary.check).toHaveBeenCalledTimes(1);
    expect(fallbackSpy).toHaveBeenCalledWith('user-1');
    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(logger.warn.mock.calls[0][0]).toContain('REDIS_DOWN');
  });

  it('primary throw nhiều request liên tiếp → log warn chỉ 1 lần (không spam)', async () => {
    const logger = { warn: vi.fn() };
    const fallback = new InMemorySlidingWindowRateLimiter(1000, 3);
    const primary = makeStub('throw');
    const failover = new FailoverRateLimiter(primary, fallback, logger);

    for (let i = 0; i < 10; i++) {
      await failover.check(`user-${i}`);
    }
    // Tất cả 10 request đều fallback nhưng warn chỉ log 1 lần.
    expect(primary.check).toHaveBeenCalledTimes(10);
    expect(logger.warn).toHaveBeenCalledTimes(1);
  });

  it('primary recover sau khi throw → request kế tiếp dùng primary lại', async () => {
    const logger = { warn: vi.fn() };
    const fallback = new InMemorySlidingWindowRateLimiter(1000, 3);
    let throwCount = 2;
    const primary: RateLimiter = {
      check: vi.fn(async () => {
        if (throwCount > 0) {
          throwCount--;
          throw new Error('REDIS_DOWN');
        }
        return { allowed: true, count: 42 };
      }),
    };
    const failover = new FailoverRateLimiter(primary, fallback, logger);

    // 2 request đầu primary throw → fallback.
    await failover.check('user-1');
    await failover.check('user-1');
    // Request thứ 3 primary recover.
    const r3 = await failover.check('user-1');
    expect(r3.count).toBe(42);
    // Warn chỉ 1 lần (không reset khi recover, để tránh log spam).
    expect(logger.warn).toHaveBeenCalledTimes(1);
  });

  it('fallback in-memory độc lập trạng thái với primary — limit window vẫn được enforce trong khoảng Redis down', async () => {
    const logger = { warn: vi.fn() };
    const fallback = new InMemorySlidingWindowRateLimiter(1000, 3);
    const primary = makeStub('throw');
    const failover = new FailoverRateLimiter(primary, fallback, logger);

    // 4 request liên tiếp cùng key — primary throw, fallback enforce limit.
    const r1 = await failover.check('spammer');
    const r2 = await failover.check('spammer');
    const r3 = await failover.check('spammer');
    const r4 = await failover.check('spammer');
    expect(r1.allowed).toBe(true);
    expect(r2.allowed).toBe(true);
    expect(r3.allowed).toBe(true);
    expect(r4.allowed).toBe(false);
    expect(r4.count).toBe(4);
  });

  it('resetWarning() cho phép log warn lại lần kế tiếp (post-recovery probe)', async () => {
    const logger = { warn: vi.fn() };
    const fallback = new InMemorySlidingWindowRateLimiter(1000, 3);
    const primary = makeStub('throw');
    const failover = new FailoverRateLimiter(primary, fallback, logger);

    await failover.check('user-1');
    await failover.check('user-2');
    expect(logger.warn).toHaveBeenCalledTimes(1);

    failover.resetWarning();
    await failover.check('user-3');
    expect(logger.warn).toHaveBeenCalledTimes(2);
  });
});

describe('FailoverRateLimiter integration với real Redis kill scenario', () => {
  it('Redis client disconnect runtime → primary check throw → failover dùng in-memory', async () => {
    // Tạo Redis client tự destroy ngay sau khi tạo limiter (mô phỏng
    // Redis pod restart / network partition runtime). Primary check
    // sẽ throw vì connection đóng. FailoverRateLimiter phải catch và
    // return in-memory result.
    const redis = new IORedis(REDIS_URL, {
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false,
      lazyConnect: true,
    });
    await redis.connect();
    const primary = new RedisSlidingWindowRateLimiter(
      redis,
      1000,
      3,
      'rl:failover-test',
    );
    const fallback = new InMemorySlidingWindowRateLimiter(1000, 3);
    const logger = { warn: vi.fn() };
    const failover = new FailoverRateLimiter(primary, fallback, logger);

    // 1 request OK qua Redis.
    const ok = await failover.check('k');
    expect(ok.allowed).toBe(true);
    expect(logger.warn).not.toHaveBeenCalled();

    // Disconnect Redis runtime — mô phỏng Redis pod down.
    redis.disconnect();
    // Đợi 1 tick để client state cập nhật.
    await new Promise((r) => setTimeout(r, 50));

    // Primary throw → failover catch → fallback check.
    const after = await failover.check('k');
    expect(after.allowed).toBe(true);
    expect(after.count).toBe(1);
    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(logger.warn.mock.calls[0][0]).toContain('primary check failed');
  });
});
