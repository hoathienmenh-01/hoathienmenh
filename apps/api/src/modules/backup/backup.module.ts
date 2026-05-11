/**
 * Phase 17.2 — Backup module.
 *
 * Bao gồm:
 *   - `BackupService` — spawn shell + record `BackupRun`/`BackupVerifyRun`.
 *   - `BackupScheduler` — register BullMQ repeat job theo env config.
 *   - `BackupProcessor` — BullMQ worker xử lý job cron.
 *   - `AdminBackupController` — admin endpoints (RBAC).
 *
 * Lifecycle:
 *   - `onModuleInit` → `BackupScheduler.scheduleRecurring()` đọc env
 *     config + register repeat job nếu enabled. Default
 *     `*_ENABLED=false` → KHÔNG register.
 *
 * Phụ thuộc:
 *   - `AdminModule` cho `AdminGuard`.
 *   - `AuthModule` cho cookie session resolver (UserGuard chain).
 *   - `PrismaService` provider local.
 *   - `BullModule` setup root + register queue `BACKUP_QUEUE`.
 */
import { Module, OnModuleInit } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { AdminModule } from '../admin/admin.module';
import { AuthModule } from '../auth/auth.module';
import { PrismaService } from '../../common/prisma.service';
import { AdminBackupController } from './admin-backup.controller';
import { BackupProcessor } from './backup.processor';
import { BACKUP_QUEUE } from './backup.queue';
import { BackupScheduler } from './backup.scheduler';
import { BackupService } from './backup.service';

@Module({
  imports: [
    BullModule.forRootAsync({
      useFactory: () => ({
        connection: {
          url: process.env.REDIS_URL ?? 'redis://localhost:6379',
        },
      }),
    }),
    BullModule.registerQueue({ name: BACKUP_QUEUE }),
    AuthModule,
    AdminModule,
  ],
  controllers: [AdminBackupController],
  providers: [BackupService, BackupScheduler, BackupProcessor, PrismaService],
  exports: [BackupService],
})
export class BackupModule implements OnModuleInit {
  constructor(private readonly scheduler: BackupScheduler) {}

  async onModuleInit(): Promise<void> {
    await this.scheduler.scheduleRecurring();
  }
}
