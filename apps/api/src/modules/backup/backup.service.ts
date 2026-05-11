/**
 * Phase 17.2 — BackupService.
 *
 * Responsibilities:
 *   - Spawn `scripts/backup-db.sh` qua child_process + ghi 1 row
 *     `BackupRun` (status RUNNING → SUCCESS|FAILED).
 *   - Spawn `scripts/verify-restore.sh` qua child_process + ghi 1 row
 *     `BackupVerifyRun`.
 *   - Compute `BackupStatusResponse` từ DB (latest backup + latest
 *     verify + health status reuse `computeLiveOpsCronHealth`).
 *
 * Constraint:
 *   - **KHÔNG** expose `restore-db.sh` qua service / API (destructive).
 *     Restore production phải làm tay theo `docs/RUNBOOK.md` §2.10.
 *   - Spawn shell với `BACKUP_DIR` env injected, KHÔNG concat shell
 *     command (avoid shell injection — luôn dùng `spawn` với args
 *     array).
 *   - `errorMessage` truncate 2048 char để không nổ DB.
 *
 * Idempotency:
 *   - Cron weekly có thể fire trùng (2 worker chạy cùng lúc) nhưng
 *     mỗi spawn shell tạo file `xuantoi-<TIMESTAMP>.sql.gz` riêng →
 *     không corrupt nhau. 2 row tracking riêng. Acceptable cho closed
 *     beta — không cần Redis lease.
 */
import { spawn } from 'node:child_process';
import * as path from 'node:path';
import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  BACKUP_CRON_MAX_SILENCE_MS,
  BACKUP_VERIFY_CRON_MAX_SILENCE_MS,
  computeLiveOpsCronHealth,
  type BackupRunSummary,
  type BackupStatusEntry,
  type BackupStatusResponse,
  type BackupTriggeredBy,
  type BackupVerifyRunSummary,
} from '@xuantoi/shared';
import { PrismaService } from '../../common/prisma.service';
import { readBackupConfig, type BackupConfig } from './backup.config';

const MAX_ERROR_MESSAGE_LEN = 2048;

/** Repo root tương đối với `apps/api/dist/...` runtime. */
const REPO_ROOT = path.resolve(__dirname, '..', '..', '..', '..', '..');

/**
 * Path tới shell script. Resolve qua `path.resolve` để không bị
 * shell-expand. Inject env qua child_process — không concat string.
 */
const BACKUP_SCRIPT_PATH = path.join(REPO_ROOT, 'scripts', 'backup-db.sh');
const VERIFY_SCRIPT_PATH = path.join(REPO_ROOT, 'scripts', 'verify-restore.sh');

interface SpawnResult {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}

/**
 * Spawn child_process với args array (không shell concat → safe khỏi
 * injection). Capture stdout/stderr cap 16KB mỗi luồng để tránh nổ
 * memory nếu shell verbose. Timeout default 10 phút (backup lớn có
 * thể chạy lâu trên DB ~1GB).
 */
async function spawnScript(
  scriptPath: string,
  env: NodeJS.ProcessEnv,
  timeoutMs = 10 * 60 * 1000,
): Promise<SpawnResult> {
  return await new Promise<SpawnResult>((resolve) => {
    const child = spawn('bash', [scriptPath], {
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    const STDIO_CAP = 16 * 1024;

    child.stdout?.on('data', (chunk: Buffer) => {
      if (stdout.length < STDIO_CAP) {
        stdout += chunk.toString('utf-8').slice(0, STDIO_CAP - stdout.length);
      }
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      if (stderr.length < STDIO_CAP) {
        stderr += chunk.toString('utf-8').slice(0, STDIO_CAP - stderr.length);
      }
    });

    let resolved = false;
    const finish = (exitCode: number) => {
      if (resolved) return;
      resolved = true;
      resolve({ exitCode, stdout, stderr });
    };

    const timeoutId = setTimeout(() => {
      try {
        child.kill('SIGTERM');
      } catch {
        /* noop */
      }
      finish(-1);
    }, timeoutMs);

    child.on('close', (code) => {
      clearTimeout(timeoutId);
      finish(code ?? -1);
    });
    child.on('error', (err) => {
      clearTimeout(timeoutId);
      stderr += `\nspawn error: ${err.message}`;
      finish(-1);
    });
  });
}

/**
 * Parse stdout của `backup-db.sh` để extract `fileName` +
 * `fileSizeBytes`. Script in dòng:
 *
 *   [backup-db] Done: ./backups/xuantoi-20260711-030000.sql.gz (12M, 12345678 bytes)
 *
 * Best-effort: nếu không match → trả null (vẫn coi backup SUCCESS nếu
 * exitCode 0).
 */
export function parseBackupDoneLine(stdout: string): {
  fileName: string | null;
  fileSizeBytes: bigint | null;
} {
  const m = stdout.match(
    /\[backup-db\] Done: (\S+) \([^,]+, (\d+) bytes\)/,
  );
  if (!m) return { fileName: null, fileSizeBytes: null };
  return {
    fileName: m[1],
    fileSizeBytes: BigInt(m[2]),
  };
}

/**
 * Parse stdout của `verify-restore.sh` để extract `checkedTables` +
 * `latestMigration`. Script in dòng:
 *
 *   [verify-restore] Step 2: public schema table count = 51
 *   [verify-restore] Step 4: latest applied prisma migration = 20260628000000_phase_17_2_backup_run
 */
export function parseVerifyOutput(stdout: string): {
  checkedTables: number | null;
  latestMigration: string | null;
} {
  let checkedTables: number | null = null;
  let latestMigration: string | null = null;

  const tableMatch = stdout.match(
    /\[verify-restore\] Step 2: public schema table count = (\d+)/,
  );
  if (tableMatch) checkedTables = Number.parseInt(tableMatch[1], 10);

  const migMatch = stdout.match(
    /\[verify-restore\] Step 4: latest applied prisma migration = (\S+)/,
  );
  if (migMatch) latestMigration = migMatch[1];

  return { checkedTables, latestMigration };
}

function truncateErr(err: unknown, cap = MAX_ERROR_MESSAGE_LEN): string {
  const msg =
    err instanceof Error ? err.message : typeof err === 'string' ? err : String(err);
  return msg.length > cap ? msg.slice(0, cap) : msg;
}

/**
 * Convert BigInt -> number safe cho JSON serialize. Backup file size
 * cap practical < 2^53 (PetaBytes) nên không overflow.
 */
function bigIntToNumber(b: bigint | null): number | null {
  return b == null ? null : Number(b);
}

@Injectable()
export class BackupService {
  private readonly logger = new Logger(BackupService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Chạy 1 lần backup (spawn `scripts/backup-db.sh`), record row.
   *
   * @param triggeredBy ai trigger run (`CRON` / `ADMIN` / `MANUAL` / `CI`).
   * @param actorUserId admin userId nếu `ADMIN`; null cho cron.
   * @param config env config (default đọc từ `process.env`).
   */
  async runBackup(
    triggeredBy: BackupTriggeredBy,
    actorUserId: string | null,
    config: BackupConfig = readBackupConfig(),
  ): Promise<BackupRunSummary> {
    const row = await this.prisma.backupRun.create({
      data: {
        status: 'RUNNING',
        triggeredBy,
        actorUserId,
        storage: 'LOCAL',
      },
    });
    this.logger.log(
      `backup START id=${row.id} triggeredBy=${triggeredBy} actor=${actorUserId ?? '-'}`,
    );

    try {
      const result = await spawnScript(BACKUP_SCRIPT_PATH, {
        ...process.env,
        BACKUP_DIR: config.backupDir,
        BACKUP_RETENTION_DAYS: String(config.retentionDays),
      });

      if (result.exitCode === 0) {
        const parsed = parseBackupDoneLine(result.stdout);
        const updated = await this.prisma.backupRun.update({
          where: { id: row.id },
          data: {
            status: 'SUCCESS',
            finishedAt: new Date(),
            fileName: parsed.fileName,
            fileSizeBytes: parsed.fileSizeBytes,
          },
        });
        this.logger.log(
          `backup DONE  id=${row.id} file=${parsed.fileName ?? '-'} size=${parsed.fileSizeBytes ?? '-'}`,
        );
        return this.toBackupSummary(updated);
      }

      const errMsg = truncateErr(
        result.stderr || result.stdout || `exit=${result.exitCode}`,
      );
      const updated = await this.prisma.backupRun.update({
        where: { id: row.id },
        data: {
          status: 'FAILED',
          finishedAt: new Date(),
          errorMessage: errMsg,
        },
      });
      this.logger.error(
        `backup FAIL  id=${row.id} exit=${result.exitCode} err=${errMsg.slice(0, 200)}`,
      );
      return this.toBackupSummary(updated);
    } catch (e) {
      const errMsg = truncateErr(e);
      const updated = await this.prisma.backupRun.update({
        where: { id: row.id },
        data: {
          status: 'FAILED',
          finishedAt: new Date(),
          errorMessage: errMsg,
        },
      });
      this.logger.error(`backup THROW id=${row.id} err=${errMsg.slice(0, 200)}`);
      return this.toBackupSummary(updated);
    }
  }

  /**
   * Chạy 1 lần verify-restore (spawn `scripts/verify-restore.sh`),
   * record row. Verify script READ-ONLY — không đụng row DB target.
   */
  async runVerify(
    triggeredBy: BackupTriggeredBy,
    actorUserId: string | null,
    options: { backupRunId?: string | null } = {},
    _config: BackupConfig = readBackupConfig(),
  ): Promise<BackupVerifyRunSummary> {
    const row = await this.prisma.backupVerifyRun.create({
      data: {
        status: 'RUNNING',
        triggeredBy,
        actorUserId,
        backupRunId: options.backupRunId ?? null,
      },
    });
    this.logger.log(
      `verify START id=${row.id} triggeredBy=${triggeredBy} actor=${actorUserId ?? '-'}`,
    );

    try {
      const result = await spawnScript(VERIFY_SCRIPT_PATH, {
        ...process.env,
      });

      if (result.exitCode === 0) {
        const parsed = parseVerifyOutput(result.stdout);
        const updated = await this.prisma.backupVerifyRun.update({
          where: { id: row.id },
          data: {
            status: 'SUCCESS',
            finishedAt: new Date(),
            checkedTables: parsed.checkedTables,
            latestMigration: parsed.latestMigration,
          },
        });
        this.logger.log(
          `verify DONE  id=${row.id} tables=${parsed.checkedTables ?? '-'} mig=${parsed.latestMigration ?? '-'}`,
        );
        return this.toVerifySummary(updated);
      }

      const errMsg = truncateErr(
        result.stderr || result.stdout || `exit=${result.exitCode}`,
      );
      const updated = await this.prisma.backupVerifyRun.update({
        where: { id: row.id },
        data: {
          status: 'FAILED',
          finishedAt: new Date(),
          errorMessage: errMsg,
        },
      });
      this.logger.error(
        `verify FAIL  id=${row.id} exit=${result.exitCode} err=${errMsg.slice(0, 200)}`,
      );
      return this.toVerifySummary(updated);
    } catch (e) {
      const errMsg = truncateErr(e);
      const updated = await this.prisma.backupVerifyRun.update({
        where: { id: row.id },
        data: {
          status: 'FAILED',
          finishedAt: new Date(),
          errorMessage: errMsg,
        },
      });
      this.logger.error(`verify THROW id=${row.id} err=${errMsg.slice(0, 200)}`);
      return this.toVerifySummary(updated);
    }
  }

  /**
   * Compute status response. Thu thập:
   *   - Latest 1 row backup (theo `finishedAt DESC` fallback `startedAt`).
   *   - Latest 1 row verify (same).
   *   - Health entry cho cả 2 cron qua `computeLiveOpsCronHealth`.
   *
   * Fail-soft: nếu DB query throw (table missing pre-migration) →
   * trả entry với `lastRunAt=null` (treat "never recorded").
   */
  async getStatus(
    now: Date = new Date(),
    config: BackupConfig = readBackupConfig(),
  ): Promise<BackupStatusResponse> {
    const [latestBackupRow, latestVerifyRow] = await Promise.all([
      this.prisma.backupRun
        .findFirst({
          orderBy: [{ finishedAt: 'desc' }, { startedAt: 'desc' }],
        })
        .catch(() => null),
      this.prisma.backupVerifyRun
        .findFirst({
          orderBy: [{ finishedAt: 'desc' }, { startedAt: 'desc' }],
        })
        .catch(() => null),
    ]);

    const backupEntry = await this.computeEntry(
      'backup',
      config.backupEnabled,
      config.backupSchedule,
      config.timezone,
      BACKUP_CRON_MAX_SILENCE_MS,
      now,
    );
    const verifyEntry = await this.computeEntry(
      'verify',
      config.verifyEnabled,
      config.verifySchedule,
      config.timezone,
      BACKUP_VERIFY_CRON_MAX_SILENCE_MS,
      now,
    );

    return {
      backup: backupEntry,
      verify: verifyEntry,
      latestBackup: latestBackupRow ? this.toBackupSummary(latestBackupRow) : null,
      latestVerify: latestVerifyRow ? this.toVerifySummary(latestVerifyRow) : null,
      generatedAt: now.toISOString(),
    };
  }

  /**
   * Tính entry health cho 1 kind (backup hoặc verify) — đọc 3 row
   * (last, last success, last error) song song rồi gọi shared helper.
   */
  private async computeEntry(
    kind: 'backup' | 'verify',
    enabled: boolean,
    cronExpression: string,
    timezone: string,
    maxSilenceMs: number,
    now: Date,
  ): Promise<BackupStatusEntry> {
    let lastRunAt: Date | null = null;
    let lastSuccessAt: Date | null = null;
    let lastErrorAt: Date | null = null;
    try {
      if (kind === 'backup') {
        const [lastRow, successRow, errorRow] = await Promise.all([
          this.prisma.backupRun.findFirst({
            orderBy: [{ finishedAt: 'desc' }, { startedAt: 'desc' }],
            select: { finishedAt: true, startedAt: true },
          }),
          this.prisma.backupRun.findFirst({
            where: { status: 'SUCCESS', finishedAt: { not: null } },
            orderBy: { finishedAt: 'desc' },
            select: { finishedAt: true },
          }),
          this.prisma.backupRun.findFirst({
            where: { status: 'FAILED', finishedAt: { not: null } },
            orderBy: { finishedAt: 'desc' },
            select: { finishedAt: true },
          }),
        ]);
        lastRunAt = lastRow?.finishedAt ?? lastRow?.startedAt ?? null;
        lastSuccessAt = successRow?.finishedAt ?? null;
        lastErrorAt = errorRow?.finishedAt ?? null;
      } else {
        const [lastRow, successRow, errorRow] = await Promise.all([
          this.prisma.backupVerifyRun.findFirst({
            orderBy: [{ finishedAt: 'desc' }, { startedAt: 'desc' }],
            select: { finishedAt: true, startedAt: true },
          }),
          this.prisma.backupVerifyRun.findFirst({
            where: { status: 'SUCCESS', finishedAt: { not: null } },
            orderBy: { finishedAt: 'desc' },
            select: { finishedAt: true },
          }),
          this.prisma.backupVerifyRun.findFirst({
            where: { status: 'FAILED', finishedAt: { not: null } },
            orderBy: { finishedAt: 'desc' },
            select: { finishedAt: true },
          }),
        ]);
        lastRunAt = lastRow?.finishedAt ?? lastRow?.startedAt ?? null;
        lastSuccessAt = successRow?.finishedAt ?? null;
        lastErrorAt = errorRow?.finishedAt ?? null;
      }
    } catch (e) {
      this.logger.warn(
        `${kind} status query fail-soft: ${(e as Error).message}`,
      );
    }

    const health = computeLiveOpsCronHealth({
      enabled,
      lastRunAt,
      lastSuccessAt,
      lastErrorAt,
      maxSilenceMs,
      now,
    });

    return {
      enabled,
      status: health.status,
      staleReason: health.staleReason,
      lastRunAt: lastRunAt ? lastRunAt.toISOString() : null,
      lastSuccessAt: lastSuccessAt ? lastSuccessAt.toISOString() : null,
      lastErrorAt: lastErrorAt ? lastErrorAt.toISOString() : null,
      cronExpression,
      timezone,
      maxSilenceMs,
    };
  }

  private toBackupSummary(row: {
    id: string;
    status: string;
    startedAt: Date;
    finishedAt: Date | null;
    fileName: string | null;
    fileSizeBytes: bigint | null;
    checksumSha256: string | null;
    storage: string;
    errorMessage: string | null;
    triggeredBy: string;
  }): BackupRunSummary {
    return {
      id: row.id,
      status: row.status as BackupRunSummary['status'],
      startedAt: row.startedAt.toISOString(),
      finishedAt: row.finishedAt?.toISOString() ?? null,
      fileName: row.fileName,
      fileSizeBytes: bigIntToNumber(row.fileSizeBytes),
      checksumSha256: row.checksumSha256,
      storage: row.storage as BackupRunSummary['storage'],
      errorMessage: row.errorMessage,
      triggeredBy: row.triggeredBy as BackupRunSummary['triggeredBy'],
    };
  }

  private toVerifySummary(row: {
    id: string;
    backupRunId: string | null;
    status: string;
    startedAt: Date;
    finishedAt: Date | null;
    checkedTables: number | null;
    latestMigration: string | null;
    errorMessage: string | null;
    triggeredBy: string;
  }): BackupVerifyRunSummary {
    return {
      id: row.id,
      backupRunId: row.backupRunId,
      status: row.status as BackupVerifyRunSummary['status'],
      startedAt: row.startedAt.toISOString(),
      finishedAt: row.finishedAt?.toISOString() ?? null,
      checkedTables: row.checkedTables,
      latestMigration: row.latestMigration,
      errorMessage: row.errorMessage,
      triggeredBy: row.triggeredBy as BackupVerifyRunSummary['triggeredBy'],
    };
  }
}

// satisfy unused import lint (Prisma type used via runtime row shapes only).
export type _Prisma = Prisma.BackupRunCreateInput;
