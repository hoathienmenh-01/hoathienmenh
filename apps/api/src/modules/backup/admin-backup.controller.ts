/**
 * Phase 17.2 — Admin endpoints cho Backup / Restore tracking.
 *
 * Endpoints (tất cả `@RequireAdmin` — MOD bị reject `ADMIN_ONLY` 403):
 *   - `GET  /admin/backup/status` — health snapshot (backup + verify
 *     enabled?, status OK/STALE/DEGRADED/DISABLED, last run/success/error,
 *     latest backup file metadata, latest verify result).
 *   - `POST /admin/backup/run`    — manual trigger backup. Spawn shell.
 *     Audit `ADMIN_BACKUP_RUN`.
 *   - `POST /admin/backup/verify` — manual trigger verify-restore.
 *     Audit `ADMIN_BACKUP_VERIFY`.
 *
 * Rate-limit policy `ADMIN_MUTATION` (Phase 18.1) áp lên controller.
 *
 * Restore production:
 *   - **KHÔNG** có endpoint trigger restore — destructive ops phải làm
 *     tay theo `docs/RUNBOOK.md`. API không expose `restore-db.sh`.
 */
import {
  Body,
  Controller,
  Get,
  HttpException,
  HttpStatus,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import type {
  BackupRunSummary,
  BackupStatusResponse,
  BackupVerifyRunSummary,
} from '@xuantoi/shared';
import { AdminGuard } from '../admin/admin.guard';
import { RateLimitPolicy } from '../security/rate-limit-policy.decorator';
import { RequireAdmin } from '../admin/require-admin.decorator';
import { PrismaService } from '../../common/prisma.service';
import { BackupService } from './backup.service';

interface AdminReq extends Request {
  userId: string;
  role: 'ADMIN' | 'MOD' | 'PLAYER';
}

function fail(code: string, status = HttpStatus.BAD_REQUEST): never {
  throw new HttpException(
    { ok: false, error: { code, message: code } },
    status,
  );
}

/**
 * Body cho POST /admin/backup/verify — optional `backupRunId` để gắn
 * verify với 1 row backup cụ thể. Nếu khách không truyền → verify
 * ad-hoc (`backupRunId=null`).
 */
const VerifyBodyZ = z
  .object({
    backupRunId: z.string().min(1).max(50).optional(),
  })
  .strict();

@UseGuards(AdminGuard)
@Controller()
@RateLimitPolicy('ADMIN_MUTATION')
export class AdminBackupController {
  constructor(
    private readonly service: BackupService,
    private readonly prisma: PrismaService,
  ) {}

  @Get('admin/backup/status')
  @RequireAdmin()
  async status(): Promise<{ ok: true; data: BackupStatusResponse }> {
    const data = await this.service.getStatus();
    return { ok: true, data };
  }

  @Post('admin/backup/run')
  @RequireAdmin()
  async runBackup(
    @Req() req: AdminReq,
  ): Promise<{ ok: true; data: BackupRunSummary }> {
    const summary = await this.service.runBackup('ADMIN', req.userId);

    await this.audit(req.userId, 'ADMIN_BACKUP_RUN', {
      backupRunId: summary.id,
      status: summary.status,
      fileName: summary.fileName,
      fileSizeBytes: summary.fileSizeBytes,
      storage: summary.storage,
      errorMessage: summary.errorMessage,
    });

    if (summary.status === 'FAILED') {
      fail('BACKUP_RUN_FAILED', HttpStatus.INTERNAL_SERVER_ERROR);
    }
    return { ok: true, data: summary };
  }

  @Post('admin/backup/verify')
  @RequireAdmin()
  async runVerify(
    @Req() req: AdminReq,
    @Body() rawBody: unknown,
  ): Promise<{ ok: true; data: BackupVerifyRunSummary }> {
    const parsed = VerifyBodyZ.safeParse(rawBody ?? {});
    if (!parsed.success) fail('INVALID_INPUT');

    const summary = await this.service.runVerify('ADMIN', req.userId, {
      backupRunId: parsed.data.backupRunId ?? null,
    });

    await this.audit(req.userId, 'ADMIN_BACKUP_VERIFY', {
      verifyRunId: summary.id,
      backupRunId: summary.backupRunId,
      status: summary.status,
      checkedTables: summary.checkedTables,
      latestMigration: summary.latestMigration,
      errorMessage: summary.errorMessage,
    });

    if (summary.status === 'FAILED') {
      fail('BACKUP_VERIFY_FAILED', HttpStatus.INTERNAL_SERVER_ERROR);
    }
    return { ok: true, data: summary };
  }

  private async audit(
    actorUserId: string,
    action: string,
    meta: Record<string, unknown>,
  ): Promise<void> {
    await this.prisma.adminAuditLog.create({
      data: { actorUserId, action, meta: meta as Prisma.InputJsonValue },
    });
  }
}
