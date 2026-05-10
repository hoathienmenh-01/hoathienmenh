/**
 * Phase 15.6 — Config Version module.
 *
 * Provides `ConfigVersionService` (persist version snapshot + rollback
 * run audit). KHÔNG có controller — admin endpoints thuộc
 * `ConfigVersionAdminModule` (file riêng) để tránh circular import với
 * AdminModule (mirror Phase 15.4 split FeatureFlag/FeatureFlagAdmin).
 *
 * Exports `ConfigVersionService` để các module gameplay/liveops/feature
 * flag/maintenance import + inject `recordVersion(...)` sau mutation.
 *
 * Module này KHÔNG import service nào khác (không cycle): chỉ persist
 * version row. Logic apply rollback nằm ở orchestrator trong admin
 * module (import ngược các service entity).
 */
import { Module } from '@nestjs/common';
import { PrismaService } from '../../common/prisma.service';
import { ConfigVersionService } from './config-version.service';

@Module({
  providers: [PrismaService, ConfigVersionService],
  exports: [ConfigVersionService],
})
export class ConfigVersionModule {}
