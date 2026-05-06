import { Module } from '@nestjs/common';
import type { Redis } from 'ioredis';
import {
  CHAT_RATE_LIMIT_MAX,
  CHAT_RATE_LIMIT_WINDOW_MS,
  CHAT_RATE_LIMITER,
  ChatService,
} from './chat.service';
import { ChatController } from './chat.controller';
import { PrismaService } from '../../common/prisma.service';
import { RealtimeModule } from '../realtime/realtime.module';
import { AuthModule } from '../auth/auth.module';
import { MissionModule } from '../mission/mission.module';
import { CharacterModule } from '../character/character.module';
import {
  RedisSlidingWindowRateLimiter,
  InMemorySlidingWindowRateLimiter,
  FailoverRateLimiter,
  RateLimiter,
} from '../../common/rate-limiter';
import { REDIS_CONNECTION } from '../../common/redis.module';

/**
 * Factory cho chat rate limiter: ưu tiên dùng Redis (sliding window,
 * chia sẻ state giữa các api instance). Wrap trong `FailoverRateLimiter`
 * để Redis down runtime → fallback in-memory thay vì throw → user mất
 * chat. Khi Redis recover → tự quay lại Redis path. Nếu REDIS_CONNECTION
 * không inject (test setup) → in-memory only.
 */
const chatRateLimiterProvider = {
  provide: CHAT_RATE_LIMITER,
  useFactory: (redis?: Redis): RateLimiter => {
    if (redis) {
      const primary = new RedisSlidingWindowRateLimiter(
        redis,
        CHAT_RATE_LIMIT_WINDOW_MS,
        CHAT_RATE_LIMIT_MAX,
        'rl:chat',
      );
      const fallback = new InMemorySlidingWindowRateLimiter(
        CHAT_RATE_LIMIT_WINDOW_MS,
        CHAT_RATE_LIMIT_MAX,
      );
      return new FailoverRateLimiter(primary, fallback);
    }
    return new InMemorySlidingWindowRateLimiter(
      CHAT_RATE_LIMIT_WINDOW_MS,
      CHAT_RATE_LIMIT_MAX,
    );
  },
  inject: [{ token: REDIS_CONNECTION, optional: true }],
};

@Module({
  imports: [RealtimeModule, AuthModule, MissionModule, CharacterModule],
  controllers: [ChatController],
  providers: [ChatService, PrismaService, chatRateLimiterProvider],
  exports: [ChatService],
})
export class ChatModule {}
