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
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  BACKUP_CRON_MAX_SILENCE_MS,
  type BackupRunStatus,
} from '@xuantoi/shared';
import {
  BackupService,
  parseBackupDoneLine,
  parseVerifyOutput,
  scriptRunner,
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
      findMany: vi.fn(async ({ where, take }: any = {}) => {
        let rows = [...store.backupRuns];
        if (where?.status?.in) {
          const allowed: string[] = where.status.in;
          rows = rows.filter((r) => allowed.includes(r.status));
        }
        rows.sort((a, b) => {
          const af = a.finishedAt?.getTime() ?? a.startedAt.getTime();
          const bf = b.finishedAt?.getTime() ?? b.startedAt.getTime();
          return bf - af;
        });
        if (typeof take === 'number') rows = rows.slice(0, take);
        return rows;
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
  offsiteUploadEnabled: false,
  alertConsecutiveFailures: 3,
};

const ENABLED_CFG: BackupConfig = {
  ...DISABLED_CFG,
  backupEnabled: true,
  verifyEnabled: true,
};

const OFFSITE_ENABLED_CFG: BackupConfig = {
  ...DISABLED_CFG,
  offsiteUploadEnabled: true,
};

/** Đủ env BACKUP_S3_* hợp lệ để `parseBackupS3Config` trả ok. */
const VALID_S3_ENV = {
  BACKUP_S3_ENDPOINT: 'https://s3.example.com',
  BACKUP_S3_BUCKET: 'xuantoi-backup',
  BACKUP_S3_ACCESS_KEY_ID: 'AKIAEXAMPLE',
  BACKUP_S3_SECRET_ACCESS_KEY: 'examplesecret',
  BACKUP_S3_REGION: 'us-east-1',
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

describe('Phase 17.3 — BackupService.getStatus offsite + alert', () => {
  function makeService(store: FakeStore) {
    return new BackupService(makePrismaStub(store));
  }

  function withEnv(env: Record<string, string | undefined>, fn: () => Promise<void>) {
    const saved: Record<string, string | undefined> = {};
    for (const k of Object.keys(env)) saved[k] = process.env[k];
    for (const [k, v] of Object.entries(env)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    return fn().finally(() => {
      for (const [k, v] of Object.entries(saved)) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
    });
  }

  it('alert: 0 backup → consecutiveFailures=0, triggered=false', async () => {
    const store: FakeStore = { backupRuns: [], verifyRuns: [] };
    const svc = makeService(store);
    const out = await svc.getStatus(new Date(), DISABLED_CFG);
    expect(out.alert.consecutiveFailures).toBe(0);
    expect(out.alert.threshold).toBe(3);
    expect(out.alert.triggered).toBe(false);
  });

  it('alert: 3 FAILED liên tiếp + threshold=3 → triggered=true', async () => {
    const now = new Date('2026-07-11T00:00:00Z');
    const store: FakeStore = {
      backupRuns: [
        makeFailedRow('b-1', new Date(now.getTime() - 3 * 60 * 60 * 1000)),
        makeFailedRow('b-2', new Date(now.getTime() - 2 * 60 * 60 * 1000)),
        makeFailedRow('b-3', new Date(now.getTime() - 1 * 60 * 60 * 1000)),
      ],
      verifyRuns: [],
    };
    const svc = makeService(store);
    const out = await svc.getStatus(now, DISABLED_CFG);
    expect(out.alert.consecutiveFailures).toBe(3);
    expect(out.alert.triggered).toBe(true);
  });

  it('alert: 2 FAILED + 1 SUCCESS + 1 FAILED (chuỗi mới nhất) → consecutiveFailures=1', async () => {
    const now = new Date('2026-07-11T00:00:00Z');
    const store: FakeStore = {
      backupRuns: [
        makeFailedRow('b-1', new Date(now.getTime() - 4 * 60 * 60 * 1000)),
        makeFailedRow('b-2', new Date(now.getTime() - 3 * 60 * 60 * 1000)),
        makeSuccessRow('b-3', new Date(now.getTime() - 2 * 60 * 60 * 1000)),
        makeFailedRow('b-4', new Date(now.getTime() - 1 * 60 * 60 * 1000)),
      ],
      verifyRuns: [],
    };
    const svc = makeService(store);
    const out = await svc.getStatus(now, DISABLED_CFG);
    expect(out.alert.consecutiveFailures).toBe(1);
    expect(out.alert.triggered).toBe(false);
  });

  it('alert: threshold=0 → triggered=false ngay cả khi nhiều FAILED', async () => {
    const now = new Date('2026-07-11T00:00:00Z');
    const cfg: BackupConfig = { ...DISABLED_CFG, alertConsecutiveFailures: 0 };
    const store: FakeStore = {
      backupRuns: [
        makeFailedRow('b-1', new Date(now.getTime() - 2 * 60 * 60 * 1000)),
        makeFailedRow('b-2', new Date(now.getTime() - 1 * 60 * 60 * 1000)),
      ],
      verifyRuns: [],
    };
    const svc = makeService(store);
    const out = await svc.getStatus(now, cfg);
    expect(out.alert.consecutiveFailures).toBe(2);
    expect(out.alert.threshold).toBe(0);
    expect(out.alert.triggered).toBe(false);
  });

  it('offsite: disabled → status=DISABLED, enabled=false', async () => {
    const store: FakeStore = { backupRuns: [], verifyRuns: [] };
    const svc = makeService(store);
    const out = await svc.getStatus(new Date(), DISABLED_CFG);
    expect(out.offsite.enabled).toBe(false);
    expect(out.offsite.status).toBe('DISABLED');
    expect(out.offsite.missingEnv).toEqual([]);
    expect(out.offsite.lastUploadedAt).toBeNull();
  });

  it('offsite: enabled + thiếu env → status=DEGRADED, missingEnv non-empty', async () => {
    await withEnv(
      {
        BACKUP_S3_ENDPOINT: undefined,
        BACKUP_S3_BUCKET: undefined,
        BACKUP_S3_ACCESS_KEY_ID: undefined,
        BACKUP_S3_SECRET_ACCESS_KEY: undefined,
      },
      async () => {
        const store: FakeStore = { backupRuns: [], verifyRuns: [] };
        const svc = makeService(store);
        const out = await svc.getStatus(new Date(), OFFSITE_ENABLED_CFG);
        expect(out.offsite.enabled).toBe(true);
        expect(out.offsite.status).toBe('DEGRADED');
        expect(out.offsite.missingEnv.length).toBeGreaterThan(0);
        expect(out.offsite.missingEnv).toContain('BACKUP_S3_ENDPOINT');
      },
    );
  });

  it('offsite: enabled + env ok + chưa có upload S3 nào → status=STALE', async () => {
    await withEnv(VALID_S3_ENV, async () => {
      const store: FakeStore = { backupRuns: [], verifyRuns: [] };
      const svc = makeService(store);
      const out = await svc.getStatus(new Date(), OFFSITE_ENABLED_CFG);
      expect(out.offsite.enabled).toBe(true);
      expect(out.offsite.status).toBe('STALE');
      expect(out.offsite.lastUploadedAt).toBeNull();
      expect(out.offsite.missingEnv).toEqual([]);
    });
  });

  it('offsite: enabled + env ok + có upload S3 SUCCESS → status=OK + lastUploadedAt', async () => {
    await withEnv(VALID_S3_ENV, async () => {
      const now = new Date('2026-07-11T00:00:00Z');
      const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);
      const store: FakeStore = {
        backupRuns: [
          {
            ...makeSuccessRow('b-1', oneHourAgo),
            storage: 'S3',
          },
        ],
        verifyRuns: [],
      };
      const svc = makeService(store);
      const out = await svc.getStatus(now, OFFSITE_ENABLED_CFG);
      expect(out.offsite.enabled).toBe(true);
      expect(out.offsite.status).toBe('OK');
      expect(out.offsite.lastUploadedAt).toBe(oneHourAgo.toISOString());
    });
  });
});

function makeSuccessRow(id: string, at: Date): FakeBackupRow {
  return {
    id,
    status: 'SUCCESS',
    startedAt: at,
    finishedAt: at,
    fileName: `./backups/${id}.sql.gz`,
    fileSizeBytes: 100n,
    checksumSha256: null,
    storage: 'LOCAL',
    errorMessage: null,
    triggeredBy: 'CRON',
    actorUserId: null,
  };
}

function makeFailedRow(id: string, at: Date): FakeBackupRow {
  return {
    id,
    status: 'FAILED',
    startedAt: at,
    finishedAt: at,
    fileName: null,
    fileSizeBytes: null,
    checksumSha256: null,
    storage: 'LOCAL',
    errorMessage: 'pg_dump: connection refused',
    triggeredBy: 'CRON',
    actorUserId: null,
  };
}

describe('Phase 17.3 — BackupService.runBackup offsite upload', () => {
  function makeService(store: FakeStore) {
    return new BackupService(makePrismaStub(store));
  }

  const BACKUP_OK_STDOUT =
    '[backup-db] Done: ./backups/xuantoi-20260711-030000.sql.gz (1M, 1234567 bytes)\n';

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('offsite disabled → KHÔNG spawn backup-to-s3.sh', async () => {
    const spawnSpy = vi
      .spyOn(scriptRunner, 'spawn')
      .mockResolvedValue({ exitCode: 0, stdout: BACKUP_OK_STDOUT, stderr: '' });
    const store: FakeStore = { backupRuns: [], verifyRuns: [] };
    const svc = makeService(store);
    const summary = await svc.runBackup('CRON', null, DISABLED_CFG);
    expect(summary.status).toBe('SUCCESS');
    expect(summary.storage).toBe('LOCAL');
    expect(spawnSpy).toHaveBeenCalledTimes(1);
    const firstCall = spawnSpy.mock.calls[0][0];
    expect(firstCall).toContain('backup-db.sh');
    expect(firstCall).not.toContain('backup-to-s3.sh');
  });

  it('offsite enabled + đủ env S3 → spawn backup-to-s3.sh, storage=S3', async () => {
    const saved = { ...process.env };
    Object.assign(process.env, {
      BACKUP_S3_ENDPOINT: 'https://s3.example.com',
      BACKUP_S3_BUCKET: 'xuantoi',
      BACKUP_S3_ACCESS_KEY_ID: 'AKIAEXAMPLE',
      BACKUP_S3_SECRET_ACCESS_KEY: 'examplesecret',
    });
    try {
      const spawnSpy = vi
        .spyOn(scriptRunner, 'spawn')
        .mockResolvedValueOnce({
          exitCode: 0,
          stdout: BACKUP_OK_STDOUT,
          stderr: '',
        })
        .mockResolvedValueOnce({
          exitCode: 0,
          stdout: '[backup-to-s3] Done.\n',
          stderr: '',
        });
      const store: FakeStore = { backupRuns: [], verifyRuns: [] };
      const svc = makeService(store);
      const summary = await svc.runBackup('CRON', null, OFFSITE_ENABLED_CFG);
      expect(summary.status).toBe('SUCCESS');
      expect(summary.storage).toBe('S3');
      expect(spawnSpy).toHaveBeenCalledTimes(2);
      expect(spawnSpy.mock.calls[0][0]).toContain('backup-db.sh');
      expect(spawnSpy.mock.calls[1][0]).toContain('backup-to-s3.sh');
    } finally {
      process.env = saved;
    }
  });

  it('offsite enabled + thiếu env → backup local SUCCESS, storage=LOCAL, KHÔNG crash', async () => {
    const saved = { ...process.env };
    for (const k of [
      'BACKUP_S3_ENDPOINT',
      'BACKUP_S3_BUCKET',
      'BACKUP_S3_ACCESS_KEY_ID',
      'BACKUP_S3_SECRET_ACCESS_KEY',
    ]) {
      delete (process.env as Record<string, string | undefined>)[k];
    }
    try {
      const spawnSpy = vi
        .spyOn(scriptRunner, 'spawn')
        .mockResolvedValue({ exitCode: 0, stdout: BACKUP_OK_STDOUT, stderr: '' });
      const store: FakeStore = { backupRuns: [], verifyRuns: [] };
      const svc = makeService(store);
      const summary = await svc.runBackup('CRON', null, OFFSITE_ENABLED_CFG);
      expect(summary.status).toBe('SUCCESS');
      expect(summary.storage).toBe('LOCAL');
      // Chỉ spawn backup-db.sh, không spawn offsite vì env thiếu.
      expect(spawnSpy).toHaveBeenCalledTimes(1);
      expect(spawnSpy.mock.calls[0][0]).toContain('backup-db.sh');
    } finally {
      process.env = saved;
    }
  });

  it('offsite enabled + env ok + offsite script fail → backup local vẫn SUCCESS storage=LOCAL', async () => {
    const saved = { ...process.env };
    Object.assign(process.env, {
      BACKUP_S3_ENDPOINT: 'https://s3.example.com',
      BACKUP_S3_BUCKET: 'xuantoi',
      BACKUP_S3_ACCESS_KEY_ID: 'AKIAEXAMPLE',
      BACKUP_S3_SECRET_ACCESS_KEY: 'examplesecret',
    });
    try {
      const spawnSpy = vi
        .spyOn(scriptRunner, 'spawn')
        .mockResolvedValueOnce({
          exitCode: 0,
          stdout: BACKUP_OK_STDOUT,
          stderr: '',
        })
        .mockResolvedValueOnce({
          exitCode: 5,
          stdout: '',
          stderr: 'aws s3 cp failed',
        });
      const store: FakeStore = { backupRuns: [], verifyRuns: [] };
      const svc = makeService(store);
      const summary = await svc.runBackup('CRON', null, OFFSITE_ENABLED_CFG);
      expect(summary.status).toBe('SUCCESS');
      expect(summary.storage).toBe('LOCAL');
      expect(spawnSpy).toHaveBeenCalledTimes(2);
    } finally {
      process.env = saved;
    }
  });
});
