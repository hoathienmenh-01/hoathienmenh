import { Module } from '@nestjs/common';
import { PrismaService } from '../../common/prisma.service';
import { AuthModule } from '../auth/auth.module';
import { AdminModule } from '../admin/admin.module';
import {
  AdminPlayerReportController,
  PlayerReportController,
} from './player-report.controller';
import { PlayerReportService } from './player-report.service';

@Module({
  imports: [AuthModule, AdminModule],
  controllers: [PlayerReportController, AdminPlayerReportController],
  providers: [PlayerReportService, PrismaService],
  exports: [PlayerReportService],
})
export class PlayerReportModule {}
