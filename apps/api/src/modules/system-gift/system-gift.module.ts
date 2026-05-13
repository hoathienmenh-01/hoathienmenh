import { Module } from '@nestjs/common';
import { PrismaService } from '../../common/prisma.service';
import { AdminModule } from '../admin/admin.module';
import { AuthModule } from '../auth/auth.module';
import { MailModule } from '../mail/mail.module';
import { SystemGiftAdminController } from './system-gift.controller';
import { SystemGiftService } from './system-gift.service';

/**
 * Phase 31.0 — System Gift module. Admin endpoints chỉ ADMIN role
 * (RequireAdmin) gọi được — MOD reject.
 *
 * Fanout qua MailService (đã có ledger / CAS idempotency); tránh
 * duplicate qua `SystemGiftClaim` unique constraint.
 */
@Module({
  imports: [AuthModule, AdminModule, MailModule],
  controllers: [SystemGiftAdminController],
  providers: [SystemGiftService, PrismaService],
  exports: [SystemGiftService],
})
export class SystemGiftModule {}
