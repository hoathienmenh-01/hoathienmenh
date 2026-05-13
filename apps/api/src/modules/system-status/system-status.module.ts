/**
 * Phase 43 — System Status admin module.
 *
 * Read-only ops dashboard cho admin/mod. Reuse:
 *   - `AdminModule` cho `AdminGuard` (export sẵn) — KHÔNG kế thừa
 *     `AdminControlCenter` permission system (read-only chỉ cần
 *     ADMIN|MOD).
 *   - `AuthModule` cho `AuthService.userIdFromAccess` qua `AdminGuard`.
 *   - `RedisModule` global cho integrity last-run artefact.
 *   - `PrismaService` provider local (pattern khớp HealthModule).
 */
import { Module } from '@nestjs/common';
import { AdminModule } from '../admin/admin.module';
import { AuthModule } from '../auth/auth.module';
import { PrismaService } from '../../common/prisma.service';
import { SystemStatusController } from './system-status.controller';
import { SystemStatusService } from './system-status.service';

@Module({
  imports: [AdminModule, AuthModule],
  controllers: [SystemStatusController],
  providers: [SystemStatusService, PrismaService],
  exports: [SystemStatusService],
})
export class SystemStatusModule {}
