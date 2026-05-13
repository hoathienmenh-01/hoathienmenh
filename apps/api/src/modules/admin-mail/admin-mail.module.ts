import { Module } from '@nestjs/common';
import { PrismaService } from '../../common/prisma.service';
import { AdminModule } from '../admin/admin.module';
import { AuthModule } from '../auth/auth.module';
import { MailModule } from '../mail/mail.module';
import { SystemGiftModule } from '../system-gift/system-gift.module';
import { AdminMailController } from './admin-mail.controller';
import { AdminMailService } from './admin-mail.service';

/**
 * Phase 31.0 — Admin Mail / Announcement module.
 *
 * Cần `SystemGiftModule` để re-use `resolveTargets` (target rule eval).
 * `RequireAdmin()` enforce role=ADMIN (MOD reject).
 */
@Module({
  imports: [AuthModule, AdminModule, MailModule, SystemGiftModule],
  controllers: [AdminMailController],
  providers: [AdminMailService, PrismaService],
  exports: [AdminMailService],
})
export class AdminMailModule {}
