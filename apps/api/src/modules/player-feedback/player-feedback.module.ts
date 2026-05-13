import { Module } from '@nestjs/common';
import { PrismaService } from '../../common/prisma.service';
import { AuthModule } from '../auth/auth.module';
import { AdminModule } from '../admin/admin.module';
import {
  AdminFeedbackController,
  PlayerFeedbackController,
} from './player-feedback.controller';
import { PlayerFeedbackService } from './player-feedback.service';

/**
 * Phase 41.0 — Player Feedback module.
 *
 * Both player-facing and admin-facing controllers share the same service.
 * `AdminGuard` từ `AdminModule` enforce MOD/ADMIN ở admin controller.
 */
@Module({
  imports: [AuthModule, AdminModule],
  controllers: [PlayerFeedbackController, AdminFeedbackController],
  providers: [PlayerFeedbackService, PrismaService],
  exports: [PlayerFeedbackService],
})
export class PlayerFeedbackModule {}
