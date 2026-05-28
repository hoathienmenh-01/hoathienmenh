import { Module } from '@nestjs/common';
import { PrismaService } from '../../common/prisma.service';
import { AuthModule } from '../auth/auth.module';
import { OnboardingQuestModule } from '../onboarding-quest/onboarding-quest.module';
import { PlayerDashboardController } from './player-dashboard.controller';
import { PlayerDashboardService } from './player-dashboard.service';

@Module({
  imports: [AuthModule, OnboardingQuestModule],
  controllers: [PlayerDashboardController],
  providers: [PlayerDashboardService, PrismaService],
  exports: [PlayerDashboardService],
})
export class PlayerDashboardModule {}
