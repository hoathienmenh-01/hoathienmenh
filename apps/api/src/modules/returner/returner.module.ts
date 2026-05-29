import { Module, forwardRef } from '@nestjs/common';
import { PrismaService } from '../../common/prisma.service';
import { AuthModule } from '../auth/auth.module';
import { MailModule } from '../mail/mail.module';
import { ReturnerController } from './returner.controller';
import { ReturnerService } from './returner.service';

/**
 * Phase 31.0 — Returner Support module.
 *
 * Service exposed cho `auth.service` (Phase 32) inject vào login flow.
 * Phase 31: FE/admin có thể trigger qua `POST /returner/check`.
 */
@Module({
  imports: [forwardRef(() => AuthModule), MailModule],
  controllers: [ReturnerController],
  providers: [ReturnerService, PrismaService],
  exports: [ReturnerService],
})
export class ReturnerModule {}
