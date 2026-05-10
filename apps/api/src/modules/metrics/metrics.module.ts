/**
 * Phase 17.5 — Metrics module.
 *
 * Tách module riêng để giữ scope read-only + KHÔNG inject toàn bộ
 * Queue/Service business. Reuse:
 *   - `AdminModule` cho `AdminGuard` (export sẵn).
 *   - `RealtimeModule` cho `RealtimeService.countOnline()`.
 *   - `RedisModule` global (`REDIS_CONNECTION` token) — đã `@Global`.
 *   - `PrismaService` provider local (pattern khớp HealthModule).
 */
import { Module } from '@nestjs/common';
import { AdminModule } from '../admin/admin.module';
import { AuthModule } from '../auth/auth.module';
import { RealtimeModule } from '../realtime/realtime.module';
import { PrismaService } from '../../common/prisma.service';
import { MetricsController } from './metrics.controller';
import { MetricsService } from './metrics.service';

@Module({
  imports: [AdminModule, AuthModule, RealtimeModule],
  controllers: [MetricsController],
  providers: [MetricsService, PrismaService],
})
export class MetricsModule {}
