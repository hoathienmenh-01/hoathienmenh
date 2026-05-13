import { Module } from '@nestjs/common';
import { PrismaService } from '../../common/prisma.service';
import { AuthModule } from '../auth/auth.module';
import { MentorController } from './mentor.controller';
import { MentorService } from './mentor.service';

/**
 * Phase 31.0 — Mentor / Sư đồ foundation module.
 *
 * KHÔNG mint reward Phase 31. Chỉ track quan hệ. Reward dành cho
 * phase sau khi đã có data anti-abuse (vd: track alt-acc, replay).
 */
@Module({
  imports: [AuthModule],
  controllers: [MentorController],
  providers: [MentorService, PrismaService],
  exports: [MentorService],
})
export class MentorModule {}
