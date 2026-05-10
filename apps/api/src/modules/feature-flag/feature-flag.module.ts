/**
 * Phase 15.4 — Feature Flag DB-backed module.
 *
 * Provides:
 *   - `FeatureFlagService` — runtime gate (`isEnabled` / `requireEnabled`),
 *     admin CRUD, cache 2-tier (in-memory + Redis).
 *   - `AdminFeatureFlagController` — `/admin/feature-flags*`.
 *   - `FeatureFlagPublicController` — `GET /feature-flags/public`.
 *
 * Imports:
 *   - `AdminModule` cho `AdminGuard` + `RequireAdmin` decorator.
 *   - `AuthModule`  cho controller auth resolver (admin endpoints).
 *
 * Exports `FeatureFlagService` để các module gameplay (arena, character,
 * inventory, liveops-event-scheduler, ...) inject runtime gate.
 *
 * Cache: Redis qua `REDIS_CONNECTION` (global module). Nếu Redis lỗi,
 * service fallback in-memory + log warn.
 */
import { Module } from '@nestjs/common';
import { AdminModule } from '../admin/admin.module';
import { AuthModule } from '../auth/auth.module';
import { PrismaService } from '../../common/prisma.service';
import { AdminFeatureFlagController } from './admin-feature-flag.controller';
import { FeatureFlagPublicController } from './feature-flag-public.controller';
import { FeatureFlagService } from './feature-flag.service';

@Module({
  imports: [AuthModule, AdminModule],
  controllers: [AdminFeatureFlagController, FeatureFlagPublicController],
  providers: [PrismaService, FeatureFlagService],
  exports: [FeatureFlagService],
})
export class FeatureFlagModule {}
