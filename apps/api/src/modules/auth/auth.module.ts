import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';
import type { Redis } from 'ioredis';
import { AuthController } from './auth.controller';
import {
  AuthService,
  FORGOT_PASSWORD_RATE_LIMITER,
  FORGOT_PASSWORD_RATE_LIMIT_MAX,
  FORGOT_PASSWORD_RATE_LIMIT_WINDOW_MS,
  REGISTER_RATE_LIMITER,
  REGISTER_RATE_LIMIT_MAX,
  REGISTER_RATE_LIMIT_WINDOW_MS,
} from './auth.service';
import { SessionService } from './session.service';
import { IpHashService } from '../security/ip-hash.service';
import { PrismaService } from '../../common/prisma.service';
import {
  InMemorySlidingWindowRateLimiter,
  RedisSlidingWindowRateLimiter,
  type RateLimiter,
} from '../../common/rate-limiter';
import { REDIS_CONNECTION } from '../../common/redis.module';

const registerLimiterProvider = {
  provide: REGISTER_RATE_LIMITER,
  inject: [{ token: REDIS_CONNECTION, optional: true }],
  useFactory: (redis?: Redis): RateLimiter => {
    if (redis) {
      return new RedisSlidingWindowRateLimiter(
        redis,
        REGISTER_RATE_LIMIT_WINDOW_MS,
        REGISTER_RATE_LIMIT_MAX,
        'rl:register',
      );
    }
    return new InMemorySlidingWindowRateLimiter(
      REGISTER_RATE_LIMIT_WINDOW_MS,
      REGISTER_RATE_LIMIT_MAX,
    );
  },
};

const forgotPasswordLimiterProvider = {
  provide: FORGOT_PASSWORD_RATE_LIMITER,
  inject: [{ token: REDIS_CONNECTION, optional: true }],
  useFactory: (redis?: Redis): RateLimiter => {
    if (redis) {
      return new RedisSlidingWindowRateLimiter(
        redis,
        FORGOT_PASSWORD_RATE_LIMIT_WINDOW_MS,
        FORGOT_PASSWORD_RATE_LIMIT_MAX,
        'rl:forgot-password',
      );
    }
    return new InMemorySlidingWindowRateLimiter(
      FORGOT_PASSWORD_RATE_LIMIT_WINDOW_MS,
      FORGOT_PASSWORD_RATE_LIMIT_MAX,
    );
  },
};

@Module({
  imports: [
    ConfigModule,
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (cfg: ConfigService) => ({
        secret: cfg.get<string>('JWT_ACCESS_SECRET') ?? 'dev-access-secret',
        signOptions: { expiresIn: `${cfg.get<string>('JWT_ACCESS_TTL') ?? '900'}s` },
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [
    PrismaService,
    registerLimiterProvider,
    forgotPasswordLimiterProvider,
    AuthService,
    SessionService,
    // Phase 18.2 — privacy-preserving IP hasher cho session row.
    // Stateless (just sha256 với env salt) → ok provide ở cả AuthModule
    // và SecurityModule (tránh circular import).
    IpHashService,
  ],
  exports: [AuthService, SessionService],
})
export class AuthModule {}
