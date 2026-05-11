import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { AuthModule } from '../auth/auth.module';
import { PrismaService } from '../../common/prisma.service';
import { IpHashService } from './ip-hash.service';
import { RateLimitService } from './rate-limit.service';
import { RateLimitGuard } from './rate-limit.guard';
import { SecurityAbuseService } from './security-abuse.service';

/**
 * Phase 18.1 — SecurityModule.
 *
 * Cung cấp:
 *   - `RateLimitService`: Redis-backed counter (fail-soft → in-memory).
 *   - `SecurityAbuseService`: persist SecurityEvent + SecurityBlock,
 *     fail2ban-style temporary block.
 *   - `IpHashService`: hash IP với env salt cho privacy.
 *   - `RateLimitGuard` registered as `APP_GUARD` — guard chạy cho mọi
 *     route nhưng chỉ enforce khi có `@RateLimitPolicy(...)` metadata.
 *     Route có `@SkipRateLimit()` (healthcheck/metrics) sẽ bypass.
 *
 * Module được import sớm trong `AppModule` (sau Redis + Auth) để các
 * controller khác có thể dùng `@RateLimitPolicy(...)` decorator.
 */
@Module({
  imports: [AuthModule],
  providers: [
    PrismaService,
    IpHashService,
    RateLimitService,
    SecurityAbuseService,
    {
      provide: APP_GUARD,
      useClass: RateLimitGuard,
    },
  ],
  exports: [
    RateLimitService,
    SecurityAbuseService,
    IpHashService,
  ],
})
export class SecurityModule {}
