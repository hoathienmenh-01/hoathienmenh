import { Module } from '@nestjs/common';
import { SectSeasonService } from './sect-season.service';
import { SectSeasonHistoryService } from './sect-season-history.service';
import { SectSeasonController } from './sect-season.controller';
import { PrismaService } from '../../common/prisma.service';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [AuthModule],
  controllers: [SectSeasonController],
  providers: [SectSeasonService, SectSeasonHistoryService, PrismaService],
  exports: [SectSeasonService, SectSeasonHistoryService],
})
export class SectSeasonModule {}
