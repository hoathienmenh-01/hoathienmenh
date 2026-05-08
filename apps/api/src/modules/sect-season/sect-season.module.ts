import { Module } from '@nestjs/common';
import { SectSeasonService } from './sect-season.service';
import { SectSeasonController } from './sect-season.controller';
import { PrismaService } from '../../common/prisma.service';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [AuthModule],
  controllers: [SectSeasonController],
  providers: [SectSeasonService, PrismaService],
  exports: [SectSeasonService],
})
export class SectSeasonModule {}
