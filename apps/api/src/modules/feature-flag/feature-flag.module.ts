/**
 * Phase 15.4 — Feature Flag DB-backed module.
 *
 * Provides:
 *   - `FeatureFlagService` — runtime gate (`isEnabled` / `requireEnabled`),
 *     admin CRUD, cache 2-tier (in-memory + Redis).
 *   - `FeatureFlagPublicController` — `GET /feature-flags/public`
 *     (public-safe whitelist, không yêu cầu auth).
 *
 * Note: Admin endpoints (`/admin/feature-flags*`) thuộc
 * `FeatureFlagAdminModule` (file riêng) để tránh cycle:
 *   AppModule → CharacterModule → FeatureFlagModule → AdminModule →
 *   CharacterModule (back). Pattern mirror `ArenaAntiWintradeAdminModule`.
 *
 * Exports `FeatureFlagService` để các module gameplay (arena, character,
 * inventory, liveops-event-scheduler, market, ...) inject runtime gate
 * mà KHÔNG kéo theo AdminModule cycle.
 *
 * Cache: Redis qua `REDIS_CONNECTION` (global module). Nếu Redis lỗi,
 * service fallback in-memory + log warn.
 */
import { Module } from '@nestjs/common';
import { PrismaService } from '../../common/prisma.service';
import { FeatureFlagPublicController } from './feature-flag-public.controller';
import { FeatureFlagService } from './feature-flag.service';
import { ConfigVersionModule } from '../config-version/config-version.module';

@Module({
  // Phase 15.6 — ConfigVersion persistence cho setFlag/ensureDefaultFlags.
  imports: [ConfigVersionModule],
  controllers: [FeatureFlagPublicController],
  providers: [PrismaService, FeatureFlagService],
  exports: [FeatureFlagService],
})
export class FeatureFlagModule {}
