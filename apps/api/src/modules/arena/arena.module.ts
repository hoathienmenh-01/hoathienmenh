/**
 * Phase 14.1.B — Async Arena module + Phase 14.1.C — Arena Season + ELO +
 * Reward.
 *
 * Wire `ArenaService` + `ArenaSeasonService` + `ArenaController`. Phụ
 * thuộc `AuthModule` cho cookie resolve và `MailModule` cho settle reward.
 * Không depend `CharacterModule` để tránh forwardRef cycle (Arena chỉ
 * đọc/ghi qua Prisma).
 */
import { Module } from '@nestjs/common';
import { ArenaController } from './arena.controller';
import { ArenaService } from './arena.service';
import { ArenaSeasonService } from './arena-season.service';
import { PrismaService } from '../../common/prisma.service';
import { AuthModule } from '../auth/auth.module';
import { MailModule } from '../mail/mail.module';

@Module({
  imports: [AuthModule, MailModule],
  controllers: [ArenaController],
  providers: [ArenaService, ArenaSeasonService, PrismaService],
  exports: [ArenaService, ArenaSeasonService],
})
export class ArenaModule {}
