/**
 * Phase 17.2 — BackupService unit tests.
 *
 * Cover (KHÔNG spawn shell thật để không phụ thuộc pg_dump/psql trong
 * Vitest CI runner):
 *   - getStatus() empty DB → backup/verify DISABLED khi cron tắt (mặc định).
 *   - getStatus() enabled cron + lastSuccess gần → OK.
 *   - getStatus() enabled cron + lastSuccess > 8d → STALE.
 *   - getStatus() enabled cron + lastError > lastSuccess → DEGRADED.
 *   - parseBackupDoneLine extract đúng filename + bytes.
 *   - parseVerifyOutput extract đúng table count + migration name.
 */
import { describe, expect, it, vi } from 'vitest';
import {
  BACKUP_CRON_MAX_SILENCE_MS,
  type BackupRunStatus,
} from '@xuantoi/shared';
import {
  BackupService,
  parseBackupDoneLine,
  parseVerifyOutput,
} from './backup.service';
import type { PrismaService } from '../../common/prisma.service';
import type { BackupConfig } from './backup.config';

interface FakeBackupRow {
  id: string;
  status: BackupRunStatus;
  startedAt: Date;
  finishedAt: Date | null;
  fileName: string | null;
  fileSizeBytes: bigint | null;
  checksumSha256: string | null;
  storage: string;
  errorMessage: string | null;
  triggeredBy: string;
  actorUserId: string | null;
}

interface FakeVerifyRow {
  id: string;
  backupRunId: string | null;
  status: BackupRunStatus;
  startedAt: Date;
  finishedAt: Date | null;
  checkedTables: number | null;
  latestMigration: string | null;
  errorMessage: string | null;
  triggeredBy: string;
  actorUserId: string | null;
}

interface FakeStore {
  backupRuns: FakeBackupRow[];
  verifyRuns: FakeVerifyRow[];
}

function makePrismaStub(store: FakeStore): PrismaService {
  return {
    backupRun: {
      findFirst: vi.fn(async ({ where, orderBy }: any) => {
        let rows = [...store.backupRuns];
        if (where?.status) rows = rows.filter((r) => r.status === where.status);
        if (where?.finishedAt?.not === null) {
          rows = rows.filter((r) => r.finishedAt !== null);
        }
        // Order by finishedAt desc fallback startedAt desc.
        rows.sort((a, b) => {
          const af = a.finishedAt?.getTime() ?? a.startedAt.getTime();
          const bf = b.finishedAt?.getTime() ?? b.startedAt.getTime();
          return bf - af;
        });
        // Order by finishedAt desc (when filter applied).
        if (
          Array.isArray(orderBy) === false &&
          orderBy?.finishedAt === 'desc'
        ) {
          rows.sort(
            (a, b) =>
              (b.finishedAt?.getTime() ?? 0) - (a.finishedAt?.getTime() ?? 0),
          );
        }
        return rows[0] ?? null;
      }),
      create: vi.fn(async ({ data }: any) => {
        const row: FakeBackupRow = {
          id: `b-${store.backupRuns.length + 1}`,
          status: data.status ?? 'RUNNING',
          startedAt: new Date(),
          finishedAt: null,
          fileName: null,
          fileSizeBytes: null,
          checksumSha256: null,
          storage: data.storage ?? 'LOCAL',
          errorMessage: null,
          triggeredBy: data.triggeredBy,
          actorUserId: data.actorUserId ?? null,
        };
        store.backupRuns.push(row);
        return row;
      }),
      update: vi.fn(async ({ where, data }: any) => {
        const row = store.backupRuns.find((r) => r.id === where.id);
        if (!row) throw new Error(`row not found: ${where.id}`);
        Object.assign(row, data);
        return row;
      }),
    },
    backupVerifyRun: {
      findFirst: vi.fn(async ({ where, orderBy }: any) => {
        let rows = [...store.verifyRuns];
        if (where?.status) rows = rows.filter((r) => r.status === where.status);
        if (where?.finishedAt?.not === null) {
          rows = rows.filter((r) => r.finishedAt !== null);
        }
        rows.sort((a, b) => {
          const af = a.finishedAt?.getTime() ?? a.startedAt.getTime();
          const bf = b.finishedAt?.getTime() ?? b.startedAt.getTime();
          return bf - af;
        });
        if (
          Array.isArray(orderBy) === false &&
          orderBy?.finishedAt === 'desc'
        ) {
          rows.sort(
            (a, b) =>
              (b.finishedAt?.getTime() ?? 0) - (a.finishedAt?.getTime() ?? 0),
          );
        }
        return rows[0] ?? null;
      }),
      create: vi.fn(async ({ data }: any) => {
        const row: FakeVerifyRow = {
          id: `v-${store.verifyRuns.length + 1}`,
          backupRunId: data.backupRunId ?? null,
          status: data.status ?? 'RUNNING',
          startedAt: new Date(),
          finishedAt: null,
          checkedTables: null,
          latestMigration: null,
          errorMessage: null,
          triggeredBy: data.triggeredBy,
          actorUserId: data.actorUserId ?? null,
        };
        store.verifyRuns.push(row);
        return row;
      }),
      update: vi.fn(async ({ where, data }: any) => {
        const row = store.verifyRuns.find((r) => r.id === where.id);
        if (!row) throw new Error(`row not found: ${where.id}`);
        Object.assign(row, data);
        return row;
      }),
    },
  } as unknown as PrismaService;
}

const DISABLED_CFG: BackupConfig = {
  backupEnabled: false,
  backupSchedule: '0 3 * * 0',
  verifyEnabled: false,
  verifySchedule: '0 4 * * 0',
  timezone: 'Asia/Ho_Chi_Minh',
  backupDir: './backups',
  retentionDays: 0,
};

const ENABLED_CFG: BackupConfig = {
  ...DISABLED_CFG,
  backupEnabled: true,
  verifyEnabled: true,
};

describe('Phase 17.2 — parseBackupDoneLine', () => {
  it('extract fileName + bytes from real backup-db.sh output', () => {
    const sample =
      '[backup-db] Strategy: docker exec xuantoi-pg\n' +
      '[backup-db] Done: ./backups/xuantoi-20260711-030000.sql.gz (12M, 12345678 bytes)\n' +
      '[backup-db] Verified PostgreSQL header marker.\n';
    const r = parseBackupDoneLine(sample);
    expect(r.fileName).toBe('./backups/xuantoi-20260711-030000.sql.gz');
    expect(r.fileSizeBytes).toBe(12345678n);
  });

  it('no match → both null', () => {
    expect(parseBackupDoneLine('garbage')).toEqual({
      fileName: null,
      fileSizeBytes: null,
    });
  });
});

describe('Phase 17.2 — parseVerifyOutput', () => {
  it('extract tableCount + latestMigration from verify-restore.sh output', () => {
    const sample =
      '[verify-restore] Step 2: public schema table count = 51\n' +
      '[verify-restore]   OK (≥ 21 baseline)\n' +
      '[verify-restore] Step 4: latest applied prisma migration = 20260628000000_phase_17_2_backup_run\n' +
      '[verify-restore] PASS\n';
    const r = parseVerifyOutput(sample);
    expect(r.checkedTables).toBe(51);
    expect(r.latestMigration).toBe('20260628000000_phase_17_2_backup_run');
  });

  it('partial output (no step 4) → migration null but checkedTables present', () => {
    const sample =
      '[verify-restore] Step 2: public schema table count = 51\n';
    const r = parseVerifyOutput(sample);
    expect(r.checkedTables).toBe(51);
    expect(r.latestMigration).toBeNull();
  });
});

describe('Phase 17.2 — BackupService.getStatus', () => {
  function makeService(store: FakeStore) {
    return new BackupService(makePrismaStub(store));
  }

  it('empty DB + cron DISABLED → status=DISABLED + no latest rows', async () => {
    const store: FakeStore = { backupRuns: [], verifyRuns: [] };
    const svc = makeService(store);
    const out = await svc.getStatus(new Date('2026-07-11T00:00:00Z'), DISABLED_CFG);

    expect(out.backup.enabled).toBe(false);
    expect(out.backup.status).toBe('DISABLED');
    expect(out.verify.enabled).toBe(false);
    expect(out.verify.status).toBe('DISABLED');
    expect(out.latestBackup).toBeNull();
    expect(out.latestVerify).toBeNull();
    expect(out.backup.maxSilenceMs).toBe(BACKUP_CRON_MAX_SILENCE_MS);
  });

  it('empty DB + cron ENABLED → STALE (chưa từng commit)', async () => {
    const store: FakeStore = { backupRuns: [], verifyRuns: [] };
    const svc = makeService(store);
    const out = await svc.getStatus(new Date('2026-07-11T00:00:00Z'), ENABLED_CFG);

    expect(out.backup.status).toBe('STALE');
    expect(out.verify.status).toBe('STALE');
    expect(out.backup.staleReason).toMatch(/never recorded/i);
  });

  it('cron ENABLED + lastSuccess gần (1h ago) → OK', async () => {
    const now = new Date('2026-07-11T00:00:00Z');
    const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);
    const store: FakeStore = {
      backupRuns: [
        {
          id: 'b-1',
          status: 'SUCCESS',
          startedAt: oneHourAgo,
          finishedAt: oneHourAgo,
          fileName: './backups/xuantoi-x.sql.gz',
          fileSizeBytes: 100n,
          checksumSha256: null,
          storage: 'LOCAL',
          errorMessage: null,
          triggeredBy: 'CRON',
          actorUserId: null,
        },
      ],
      verifyRuns: [],
    };
    const svc = makeService(store);
    const out = await svc.getStatus(now, ENABLED_CFG);

    expect(out.backup.status).toBe('OK');
    expect(out.backup.lastSuccessAt).toBe(oneHourAgo.toISOString());
    expect(out.latestBackup?.fileName).toBe('./backups/xuantoi-x.sql.gz');
    expect(out.latestBackup?.fileSizeBytes).toBe(100);
  });

  it('cron ENABLED + lastSuccess > 8 days → STALE', async () => {
    const now = new Date('2026-07-11T00:00:00Z');
    const tenDaysAgo = new Date(now.getTime() - 10 * 24 * 60 * 60 * 1000);
    const store: FakeStore = {
      backupRuns: [
        {
          id: 'b-1',
          status: 'SUCCESS',
          startedAt: tenDaysAgo,
          finishedAt: tenDaysAgo,
          fileName: 'old.sql.gz',
          fileSizeBytes: 100n,
          checksumSha256: null,
          storage: 'LOCAL',
          errorMessage: null,
          triggeredBy: 'CRON',
          actorUserId: null,
        },
      ],
      verifyRuns: [],
    };
    const svc = makeService(store);
    const out = await svc.getStatus(now, ENABLED_CFG);

    expect(out.backup.status).toBe('STALE');
    expect(out.backup.staleReason).toMatch(/no successful run for \d+ days/);
  });

  it('cron ENABLED + lastError > lastSuccess → DEGRADED', async () => {
    const now = new Date('2026-07-11T00:00:00Z');
    const twoHoursAgo = new Date(now.getTime() - 2 * 60 * 60 * 1000);
    const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);
    const store: FakeStore = {
      backupRuns: [
        {
          id: 'b-1',
          status: 'SUCCESS',
          startedAt: twoHoursAgo,
          finishedAt: twoHoursAgo,
          fileName: 'old.sql.gz',
          fileSizeBytes: 100n,
          checksumSha256: null,
          storage: 'LOCAL',
          errorMessage: null,
          triggeredBy: 'CRON',
          actorUserId: null,
        },
        {
          id: 'b-2',
          status: 'FAILED',
          startedAt: oneHourAgo,
          finishedAt: oneHourAgo,
          fileName: null,
          fileSizeBytes: null,
          checksumSha256: null,
          storage: 'LOCAL',
          errorMessage: 'pg_dump: connection refused',
          triggeredBy: 'CRON',
          actorUserId: null,
        },
      ],
      verifyRuns: [],
    };
    const svc = makeService(store);
    const out = await svc.getStatus(now, ENABLED_CFG);

    expect(out.backup.status).toBe('DEGRADED');
    expect(out.latestBackup?.status).toBe('FAILED');
    expect(out.latestBackup?.errorMessage).toBe('pg_dump: connection refused');
  });

  it('generatedAt = `now`.toISOString()', async () => {
    const store: FakeStore = { backupRuns: [], verifyRuns: [] };
    const svc = makeService(store);
    const now = new Date('2026-07-11T12:34:56.789Z');
    const out = await svc.getStatus(now, DISABLED_CFG);
    expect(out.generatedAt).toBe(now.toISOString());
  });
});
