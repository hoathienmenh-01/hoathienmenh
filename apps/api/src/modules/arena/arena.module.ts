/**
 * Phase 14.1.B — Async Arena module + Phase 14.1.C — Arena Season + ELO +
 * Reward + Phase 14.1.D — Arena Anti-Wintrade Detection (service only;
 * admin controller được wire qua `ArenaAntiWintradeAdminModule` để tránh
 * cycle với `AdminModule`).
 *
 * Wire `ArenaService` + `ArenaSeasonService` + `ArenaAntiWintradeService` +
 * `ArenaController`. Phụ thuộc `AuthModule` cho cookie resolve và
 * `MailModule` cho settle reward. Không depend `CharacterModule` để
 * tránh forwardRef cycle (Arena chỉ đọc/ghi qua Prisma).
 */
import { Module } from '@nestjs/common';
import { ArenaController } from './arena.controller';
import { ArenaService } from './arena.service';
import { ArenaSeasonService } from './arena-season.service';
import { ArenaAntiWintradeService } from './arena-anti-wintrade.service';
import { PrismaService } from '../../common/prisma.service';
import { AuthModule } from '../auth/auth.module';
import { MailModule } from '../mail/mail.module';
import { FeatureFlagModule } from '../feature-flag/feature-flag.module';

@Module({
  imports: [AuthModule, MailModule, FeatureFlagModule],
  controllers: [ArenaController],
  providers: [
    ArenaService,
    ArenaSeasonService,
    ArenaAntiWintradeService,
    PrismaService,
  ],
  exports: [ArenaService, ArenaSeasonService, ArenaAntiWintradeService],
})
export class ArenaModule {}
