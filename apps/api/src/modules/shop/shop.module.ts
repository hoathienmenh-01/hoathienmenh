import { Module } from '@nestjs/common';
import type { Redis } from 'ioredis';
import { ShopController } from './shop.controller';
import {
  SHOP_BUY_RATE_LIMIT_MAX,
  SHOP_BUY_RATE_LIMIT_WINDOW_MS,
  SHOP_BUY_RATE_LIMITER,
  ShopService,
} from './shop.service';
import { PrismaService } from '../../common/prisma.service';
import { AuthModule } from '../auth/auth.module';
import { CharacterModule } from '../character/character.module';
import { InventoryModule } from '../inventory/inventory.module';
import {
  FailoverRateLimiter,
  InMemorySlidingWindowRateLimiter,
  RateLimiter,
  RedisSlidingWindowRateLimiter,
} from '../../common/rate-limiter';
import { REDIS_CONNECTION } from '../../common/redis.module';

/**
 * M10 — Factory cho shop buy rate limiter. Mirror chat.module pattern:
 *  - Production: Redis sliding window cho cross-instance state.
 *  - Wrap FailoverRateLimiter để Redis down runtime → fallback in-memory
 *    thay vì 500. Khi Redis recover → tự quay lại Redis path.
 *  - Test/dev không có REDIS_CONNECTION → in-memory only.
 */
const shopBuyRateLimiterProvider = {
  provide: SHOP_BUY_RATE_LIMITER,
  useFactory: (redis?: Redis): RateLimiter => {
    if (redis) {
      const primary = new RedisSlidingWindowRateLimiter(
        redis,
        SHOP_BUY_RATE_LIMIT_WINDOW_MS,
        SHOP_BUY_RATE_LIMIT_MAX,
        'rl:shop-buy',
      );
      const fallback = new InMemorySlidingWindowRateLimiter(
        SHOP_BUY_RATE_LIMIT_WINDOW_MS,
        SHOP_BUY_RATE_LIMIT_MAX,
      );
      return new FailoverRateLimiter(primary, fallback);
    }
    return new InMemorySlidingWindowRateLimiter(
      SHOP_BUY_RATE_LIMIT_WINDOW_MS,
      SHOP_BUY_RATE_LIMIT_MAX,
    );
  },
  inject: [{ token: REDIS_CONNECTION, optional: true }],
};

@Module({
  imports: [AuthModule, CharacterModule, InventoryModule],
  controllers: [ShopController],
  providers: [ShopService, PrismaService, shopBuyRateLimiterProvider],
  exports: [ShopService],
})
export class ShopModule {}
