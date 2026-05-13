import { Module } from '@nestjs/common';
import { PrismaService } from '../../common/prisma.service';
import { AuthModule } from '../auth/auth.module';
import { PlayerSettingsController } from './player-settings.controller';
import { PlayerSettingsService } from './player-settings.service';

/**
 * Phase 41.0 — Player Settings module.
 *
 * Lazy default settings (no migration backfill needed). Exports
 * `PlayerSettingsService` cho Dashboard module đọc font-size /
 * notification preference cho aggregation response.
 */
@Module({
  imports: [AuthModule],
  controllers: [PlayerSettingsController],
  providers: [PlayerSettingsService, PrismaService],
  exports: [PlayerSettingsService],
})
export class PlayerSettingsModule {}
