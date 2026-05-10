/**
 * Phase 15.6 — Config Version + Rollback admin module.
 *
 * Tách ra khỏi `ConfigVersionModule` để KHÔNG tạo cycle:
 *   - `ConfigVersionModule` chỉ giữ `ConfigVersionService` (persistence)
 *     và được import bởi các service mutate config (LiveOpsEvent,
 *     Announcement, FeatureFlag, MaintenanceWindow).
 *   - `ConfigVersionAdminModule` import `AdminModule` (cho `AdminGuard`)
 *     + orchestrator/rollback service + admin controller.
 *
 * Cycle nếu gộp: ConfigVersionModule → AdminModule → CharacterModule
 * → FeatureFlagModule → ConfigVersionModule (back).
 */
import { Module } from '@nestjs/common';
import { AdminModule } from '../admin/admin.module';
import { AuthModule } from '../auth/auth.module';
import { ConfigVersionModule } from '../config-version/config-version.module';
import { PrismaService } from '../../common/prisma.service';
import { AdminConfigVersionController } from './admin-config-version.controller';
import { ConfigRollbackOrchestratorService } from './config-rollback-orchestrator.service';
import { ConfigRollbackService } from './config-rollback.service';

@Module({
  imports: [AdminModule, AuthModule, ConfigVersionModule],
  controllers: [AdminConfigVersionController],
  providers: [
    PrismaService,
    ConfigRollbackOrchestratorService,
    ConfigRollbackService,
  ],
})
export class ConfigVersionAdminModule {}
