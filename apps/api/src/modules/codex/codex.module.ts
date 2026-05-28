/**
 * Phase 32.0 — Codex module. Indexer + read service + admin reindex/audit.
 */
import { Module } from '@nestjs/common';

import { PrismaService } from '../../common/prisma.service';
import { AuthModule } from '../auth/auth.module';
import { AdminControlCenterModule } from '../admin-control-center/admin-control-center.module';
import { FeatureFlagModule } from '../feature-flag/feature-flag.module';
import { CodexIndexerService } from './codex-indexer.service';
import { CodexService } from './codex.service';
import { CodexPlayerController } from './codex.player.controller';
import { CodexAdminController } from './codex.admin.controller';

@Module({
  imports: [AuthModule, AdminControlCenterModule, FeatureFlagModule],
  controllers: [CodexPlayerController, CodexAdminController],
  providers: [PrismaService, CodexIndexerService, CodexService],
  exports: [CodexIndexerService, CodexService],
})
export class CodexModule {}
