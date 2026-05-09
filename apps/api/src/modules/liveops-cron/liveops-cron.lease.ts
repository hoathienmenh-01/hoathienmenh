import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { REDIS_CONNECTION, type Redis } from '../../common/redis.module';

/**
 * Phase 13.2.D + 14.0.F — Redis-based distributed lease cho cron job.
 *
 * Mục tiêu (race-safety):
 *   - Khi 2+ API node cùng share Redis, BullMQ repeat job có thể trigger
 *     đồng thời ở nhiều worker. UNIQUE constraint ở DB (settlement
 *     snapshot, decay log, reward grant, season snapshot) đã block double
 *     write — nhưng vẫn tốn query + log noise.
 *   - Lease này là OPTIMISTIC barrier: chỉ 1 worker thắng `SET NX EX`,
 *     các worker còn lại nhận `false` và skip cycle (return summary
 *     `skippedAlreadyDone=true`).
 *
 * Không phải nguồn sự thật idempotency — DB unique guards mới là final
 * barrier. Lease có thể fail (Redis timeout, node death giữa chừng) →
 * fall through DB guard. KHÔNG TIN cron chạy đúng 1 lần.
 *
 * Optional Redis: nếu REDIS_CONNECTION absent (test/dev) hoặc TTL=0,
 * lease luôn `acquired=true` (no-op). Test pattern đã idempotent qua DB
 * nên không sai semantic.
 */
@Injectable()
export class LiveOpsCronLease {
  private readonly logger = new Logger(LiveOpsCronLease.name);

  constructor(
    @Optional() @Inject(REDIS_CONNECTION) private readonly redis: Redis | null,
  ) {}

  /**
   * Thử acquire lease cho `key` trong `ttlSec` giây.
   *   - Trả `{ acquired: true, owner: <random> }` nếu chiếm được.
   *   - Trả `{ acquired: false }` nếu key đã có lease holder khác.
   *   - Nếu Redis absent hoặc ttlSec ≤ 0 → luôn `acquired: true,
   *     owner: 'no-redis'`.
   *
   * Caller phải gọi {@link release} với cùng `owner` ở finally block.
   */
  async acquire(
    key: string,
    ttlSec: number,
  ): Promise<{ acquired: boolean; owner: string }> {
    if (!this.redis || ttlSec <= 0) {
      return { acquired: true, owner: 'no-redis' };
    }
    const owner = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
    try {
      const res = await this.redis.set(key, owner, 'EX', ttlSec, 'NX');
      if (res === 'OK') {
        return { acquired: true, owner };
      }
      return { acquired: false, owner };
    } catch (e) {
      // Redis lỗi → fail-open: cho cycle chạy. DB guard vẫn block double.
      this.logger.warn(
        `lease acquire failed key=${key} ${(e as Error).message} — fail-open`,
      );
      return { acquired: true, owner: 'redis-error' };
    }
  }

  /**
   * Release lease nếu `owner` khớp. Dùng Lua compare-and-delete để tránh
   * release nhầm lease đã expire + được node khác chiếm.
   *
   * No-op nếu Redis absent hoặc owner = 'no-redis' / 'redis-error'.
   */
  async release(key: string, owner: string): Promise<void> {
    if (!this.redis) return;
    if (owner === 'no-redis' || owner === 'redis-error') return;
    try {
      // Lua: chỉ del nếu value đúng owner.
      await this.redis.eval(
        "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end",
        1,
        key,
        owner,
      );
    } catch (e) {
      this.logger.warn(
        `lease release failed key=${key} ${(e as Error).message}`,
      );
    }
  }
}
