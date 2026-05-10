import { Module } from '@nestjs/common';
import { DailyLoginController } from './daily-login.controller';
import { DailyLoginService } from './daily-login.service';
import { PrismaService } from '../../common/prisma.service';
import { AuthModule } from '../auth/auth.module';
import { CharacterModule } from '../character/character.module';
import { LiveOpsEventSchedulerModule } from '../liveops-event-scheduler/liveops-event-scheduler.module';

// Phase 15.3.A — `LiveOpsEventSchedulerModule` wire để DailyLoginService đọc
// DAILY_LOGIN_BONUS runtime modifier (Optional inject — test có thể bỏ).
@Module({
  imports: [AuthModule, CharacterModule, LiveOpsEventSchedulerModule],
  controllers: [DailyLoginController],
  providers: [DailyLoginService, PrismaService],
  exports: [DailyLoginService],
})
export class DailyLoginModule {}
