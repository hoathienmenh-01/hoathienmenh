import { Module } from '@nestjs/common';
import { PrismaService } from '../../common/prisma.service';
import { AuthModule } from '../auth/auth.module';
import { MailModule } from '../mail/mail.module';
import { MentorMilestoneService } from './mentor-milestone.service';
import { MentorController } from './mentor.controller';
import { MentorService } from './mentor.service';

/**
 * Phase 31.0 — Mentor / Sư đồ foundation module.
 * Phase 35.2 extension — `MentorMilestoneService` mint reward đôi bên
 * qua `MailService.sendToCharacter` (mailType=SYSTEM, linh thạch only).
 */
@Module({
  imports: [AuthModule, MailModule],
  controllers: [MentorController],
  providers: [MentorService, MentorMilestoneService, PrismaService],
  exports: [MentorService, MentorMilestoneService],
})
export class MentorModule {}
