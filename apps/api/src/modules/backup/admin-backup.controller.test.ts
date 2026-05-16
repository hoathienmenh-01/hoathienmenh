/**
 * Phase 17.2 — AdminBackupController unit tests.
 *
 * Cover (KHÔNG bật AdminGuard — chỉ test method logic; e2e RBAC do
 * AdminGuard test riêng):
 *   - GET /admin/backup/status → forward service.getStatus.
 *   - POST /admin/backup/run happy path → audit log + return summary.
 *   - POST /admin/backup/run khi service trả FAILED → 500 BACKUP_RUN_FAILED + audit log (vẫn ghi).
 *   - POST /admin/backup/verify happy path → audit log + return summary.
 *   - POST /admin/backup/verify với body sai schema → 400 INVALID_INPUT.
 *   - POST /admin/backup/verify khi service trả FAILED → 500 BACKUP_VERIFY_FAILED.
 */
import { HttpException, HttpStatus } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import type {
  BackupRunSummary,
  BackupStatusResponse,
  BackupVerifyRunSummary,
} from '@xuantoi/shared';
import { AdminBackupController } from './admin-backup.controller';
import type { BackupService } from './backup.service';
import type { PrismaService } from '../../common/prisma.service';

function makeStubs(
  opts: {
    statusImpl?: () => Promise<BackupStatusResponse>;
    runImpl?: () => Promise<BackupRunSummary>;
    verifyImpl?: (opts: {
      backupRunId?: string | null;
    }) => Promise<BackupVerifyRunSummary>;
  } = {},
) {
  const auditCalls: Array<{ action: string; meta: unknown }> = [];
  const prisma = {
    adminAuditLog: {
      create: vi.fn(
        async ({ data }: { data: { action: string; meta: unknown } }) => {
          auditCalls.push({ action: data.action, meta: data.meta });
          return data;
        },
      ),
    },
  } as unknown as PrismaService;

  const baseStatus: BackupStatusResponse = {
    backup: {
      enabled: false,
      status: 'DISABLED',
      staleReason: 'cron disabled via env',
      lastRunAt: null,
      lastSuccessAt: null,
      lastErrorAt: null,
      cronExpression: '0 3 * * 0',
      timezone: 'Asia/Ho_Chi_Minh',
      maxSilenceMs: 8 * 24 * 60 * 60 * 1000,
    },
    verify: {
      enabled: false,
      status: 'DISABLED',
      staleReason: 'cron disabled via env',
      lastRunAt: null,
      lastSuccessAt: null,
      lastErrorAt: null,
      cronExpression: '0 4 * * 0',
      timezone: 'Asia/Ho_Chi_Minh',
      maxSilenceMs: 8 * 24 * 60 * 60 * 1000,
    },
    latestBackup: null,
    latestVerify: null,
    offsite: {
      enabled: false,
      status: 'DISABLED',
      staleReason: null,
      lastUploadedAt: null,
      missingEnv: [],
    },
    alert: {
      consecutiveFailures: 0,
      threshold: 3,
      triggered: false,
    },
    generatedAt: '2026-07-11T00:00:00.000Z',
  };

  const baseRun: BackupRunSummary = {
    id: 'b-1',
    status: 'SUCCESS',
    startedAt: '2026-07-11T00:00:00.000Z',
    finishedAt: '2026-07-11T00:01:00.000Z',
    fileName: './backups/xuantoi-x.sql.gz',
    fileSizeBytes: 12345,
    checksumSha256: null,
    storage: 'LOCAL',
    errorMessage: null,
    triggeredBy: 'ADMIN',
  };

  const baseVerify: BackupVerifyRunSummary = {
    id: 'v-1',
    backupRunId: null,
    status: 'SUCCESS',
    startedAt: '2026-07-11T00:00:00.000Z',
    finishedAt: '2026-07-11T00:00:30.000Z',
    checkedTables: 51,
    latestMigration: '20260628000000_phase_17_2_backup_run',
    errorMessage: null,
    triggeredBy: 'ADMIN',
  };

  const service = {
    getStatus: opts.statusImpl ?? (async () => baseStatus),
    runBackup: opts.runImpl
      ? vi.fn(opts.runImpl)
      : vi.fn(async () => baseRun),
    runVerify: opts.verifyImpl
      ? vi.fn(opts.verifyImpl)
      : vi.fn(async (_t, _a, o) => ({ ...baseVerify, backupRunId: o?.backupRunId ?? null })),
  } as unknown as BackupService;

  return { service, prisma, auditCalls };
}

const adminReq = { userId: 'admin-1', role: 'ADMIN' as const } as any;

describe('AdminBackupController.status', () => {
  it('returns service.getStatus() in envelope', async () => {
    const { service, prisma } = makeStubs();
    const ctrl = new AdminBackupController(service, prisma);
    const res = await ctrl.status();
    expect(res.ok).toBe(true);
    expect(res.data.backup.status).toBe('DISABLED');
  });
});

describe('AdminBackupController.runBackup', () => {
  it('happy path → audit log + return summary', async () => {
    const { service, prisma, auditCalls } = makeStubs();
    const ctrl = new AdminBackupController(service, prisma);
    const res = await ctrl.runBackup(adminReq);

    expect(res.ok).toBe(true);
    expect(res.data.id).toBe('b-1');
    expect(auditCalls).toHaveLength(1);
    expect(auditCalls[0].action).toBe('ADMIN_BACKUP_RUN');
    expect(auditCalls[0].meta).toMatchObject({
      backupRunId: 'b-1',
      status: 'SUCCESS',
      fileName: './backups/xuantoi-x.sql.gz',
      storage: 'LOCAL',
    });
    expect((service.runBackup as ReturnType<typeof vi.fn>)).toHaveBeenCalledWith(
      'ADMIN',
      'admin-1',
    );
  });

  it('service returns FAILED → 500 + audit log (vẫn ghi)', async () => {
    const { service, prisma, auditCalls } = makeStubs({
      runImpl: async () => ({
        id: 'b-1',
        status: 'FAILED',
        startedAt: '2026-07-11T00:00:00.000Z',
        finishedAt: '2026-07-11T00:00:01.000Z',
        fileName: null,
        fileSizeBytes: null,
        checksumSha256: null,
        storage: 'LOCAL',
        errorMessage: 'pg_dump: connection refused',
        triggeredBy: 'ADMIN',
      }),
    });
    const ctrl = new AdminBackupController(service, prisma);
    await expect(ctrl.runBackup(adminReq)).rejects.toMatchObject({
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      response: { error: { code: 'BACKUP_RUN_FAILED' } },
    });
    expect(auditCalls).toHaveLength(1);
    expect(auditCalls[0].meta).toMatchObject({
      status: 'FAILED',
      errorMessage: 'pg_dump: connection refused',
    });
  });
});

describe('AdminBackupController.runVerify', () => {
  it('happy path không body → audit + summary với backupRunId=null', async () => {
    const { service, prisma, auditCalls } = makeStubs();
    const ctrl = new AdminBackupController(service, prisma);
    const res = await ctrl.runVerify(adminReq, {});
    expect(res.ok).toBe(true);
    expect(res.data.backupRunId).toBeNull();
    expect(auditCalls).toHaveLength(1);
    expect(auditCalls[0].action).toBe('ADMIN_BACKUP_VERIFY');
  });

  it('body với backupRunId → service called với options.backupRunId', async () => {
    const { service, prisma } = makeStubs();
    const ctrl = new AdminBackupController(service, prisma);
    const res = await ctrl.runVerify(adminReq, { backupRunId: 'b-xyz' });
    expect(res.data.backupRunId).toBe('b-xyz');
    expect((service.runVerify as ReturnType<typeof vi.fn>)).toHaveBeenCalledWith(
      'ADMIN',
      'admin-1',
      { backupRunId: 'b-xyz' },
    );
  });

  it('body sai schema → 400 INVALID_INPUT', async () => {
    const { service, prisma } = makeStubs();
    const ctrl = new AdminBackupController(service, prisma);
    await expect(
      ctrl.runVerify(adminReq, { backupRunId: 123 } as any),
    ).rejects.toBeInstanceOf(HttpException);
    await expect(
      ctrl.runVerify(adminReq, { unknownField: 'x' } as any),
    ).rejects.toMatchObject({
      response: { error: { code: 'INVALID_INPUT' } },
    });
  });

  it('service returns FAILED → 500 + audit log', async () => {
    const { service, prisma, auditCalls } = makeStubs({
      verifyImpl: async (o) => ({
        id: 'v-1',
        backupRunId: o?.backupRunId ?? null,
        status: 'FAILED',
        startedAt: '2026-07-11T00:00:00.000Z',
        finishedAt: '2026-07-11T00:00:01.000Z',
        checkedTables: null,
        latestMigration: null,
        errorMessage: 'psql: connection refused',
        triggeredBy: 'ADMIN',
      }),
    });
    const ctrl = new AdminBackupController(service, prisma);
    await expect(ctrl.runVerify(adminReq, {})).rejects.toMatchObject({
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      response: { error: { code: 'BACKUP_VERIFY_FAILED' } },
    });
    expect(auditCalls).toHaveLength(1);
    expect(auditCalls[0].meta).toMatchObject({
      status: 'FAILED',
      errorMessage: 'psql: connection refused',
    });
  });
});
