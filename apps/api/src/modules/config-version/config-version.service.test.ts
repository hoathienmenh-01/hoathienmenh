/**
 * Phase 15.6 — ConfigVersionService unit tests.
 *
 * Cover:
 *   - recordVersion gọi DB create với version = max+1.
 *   - no-op skip không tạo row.
 *   - sanitizeSnapshot strip secret-like fields.
 *   - listVersions trả về desc by version.
 *   - diffVersions tính changedFields.
 *   - recordRollbackRun ghi row audit.
 *   - invalid entityType / action throw error.
 */
import { describe, it, expect, vi } from 'vitest';
import { Prisma } from '@prisma/client';
import {
  ConfigVersionError,
  ConfigVersionService,
  type RecordRollbackRunInput,
  type RecordVersionInput,
} from './config-version.service';
import type { PrismaService } from '../../common/prisma.service';

// Cast helper — stub object có shape `prisma.configVersion.{...}` đủ cho
// service test, không cần full PrismaService surface.
function asPrisma(stub: PrismaStub): PrismaService {
  return stub as unknown as PrismaService;
}

// ---------------------------------------------------------------------------
// Prisma stub
// ---------------------------------------------------------------------------

interface VersionRow {
  id: string;
  entityType: string;
  entityId: string;
  version: number;
  action: string;
  beforeJson: Prisma.JsonValue | null;
  afterJson: Prisma.JsonValue;
  changedByAdminId: string | null;
  reason: string | null;
  createdAt: Date;
}

interface PrismaStub {
  configVersion: {
    findFirst: ReturnType<typeof vi.fn>;
    findUnique: ReturnType<typeof vi.fn>;
    findMany: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
  };
  configRollbackRun: {
    create: ReturnType<typeof vi.fn>;
  };
  __versions: () => VersionRow[];
  __rollbackRuns: () => Array<{
    id: string;
    entityType: string;
    entityId: string;
    fromVersion: number;
    toVersion: number;
    targetVersionId: string | null;
    status: string;
    safetyLevel: string;
    performedByAdminId: string | null;
    reason: string | null;
    resultJson: Prisma.JsonValue | null;
    createdAt: Date;
  }>;
}

function makePrismaStub(initial: VersionRow[] = []): PrismaStub {
  let next = 0;
  const versions: VersionRow[] = [...initial];
  const rollbackRuns: Array<{
    id: string;
    entityType: string;
    entityId: string;
    fromVersion: number;
    toVersion: number;
    targetVersionId: string | null;
    status: string;
    safetyLevel: string;
    performedByAdminId: string | null;
    reason: string | null;
    resultJson: Prisma.JsonValue | null;
    createdAt: Date;
  }> = [];

  const stub: PrismaStub = {
    configVersion: {
      findFirst: vi.fn(async ({ where, orderBy }: any) => {
        const filtered = versions.filter(
          (v) =>
            (!where?.entityType || v.entityType === where.entityType) &&
            (!where?.entityId || v.entityId === where.entityId),
        );
        if (orderBy?.version === 'desc') {
          filtered.sort((a, b) => b.version - a.version);
        }
        return filtered[0] ?? null;
      }),
      findUnique: vi.fn(async ({ where }: any) => {
        return versions.find((v) => v.id === where.id) ?? null;
      }),
      findMany: vi.fn(async ({ where, orderBy, take }: any) => {
        let filtered = versions.filter(
          (v) =>
            (!where?.entityType || v.entityType === where.entityType) &&
            (!where?.entityId || v.entityId === where.entityId),
        );
        if (orderBy?.version === 'desc') {
          filtered = filtered.slice().sort((a, b) => b.version - a.version);
        }
        if (take) filtered = filtered.slice(0, take);
        return filtered;
      }),
      create: vi.fn(async ({ data }: any) => {
        // Simulate unique constraint on (entityType, entityId, version).
        const dup = versions.find(
          (v) =>
            v.entityType === data.entityType &&
            v.entityId === data.entityId &&
            v.version === data.version,
        );
        if (dup) {
          const err = new Prisma.PrismaClientKnownRequestError(
            'duplicate',
            { code: 'P2002', clientVersion: 'test' },
          );
          throw err;
        }
        next += 1;
        const row: VersionRow = {
          id: `v_${next}`,
          entityType: data.entityType,
          entityId: data.entityId,
          version: data.version,
          action: data.action,
          beforeJson: data.beforeJson === Prisma.DbNull ? null : data.beforeJson,
          afterJson: data.afterJson,
          changedByAdminId: data.changedByAdminId ?? null,
          reason: data.reason ?? null,
          createdAt: new Date(),
        };
        versions.push(row);
        return row;
      }),
    },
    configRollbackRun: {
      create: vi.fn(async ({ data, select }: any) => {
        next += 1;
        const row = {
          id: `rr_${next}`,
          entityType: data.entityType,
          entityId: data.entityId,
          fromVersion: data.fromVersion,
          toVersion: data.toVersion,
          targetVersionId: data.targetVersionId,
          status: data.status,
          safetyLevel: data.safetyLevel,
          performedByAdminId: data.performedByAdminId,
          reason: data.reason ?? null,
          resultJson: data.resultJson === Prisma.DbNull ? null : data.resultJson,
          createdAt: new Date(),
        };
        rollbackRuns.push(row);
        if (select) {
          return { id: row.id, createdAt: row.createdAt };
        }
        return row;
      }),
    },
    __versions: () => versions,
    __rollbackRuns: () => rollbackRuns,
  };
  return stub;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ConfigVersionService.recordVersion', () => {
  it('tạo row version 1 cho CREATE (beforeJson null)', async () => {
    const stub = makePrismaStub();
    const svc = new ConfigVersionService(asPrisma(stub));
    const input: RecordVersionInput = {
      entityType: 'FEATURE_FLAG',
      entityId: 'ARENA_ENABLED',
      action: 'CREATE',
      beforeJson: null,
      afterJson: { key: 'ARENA_ENABLED', enabled: true },
      changedByAdminId: 'admin1',
      reason: 'initial seed',
    };
    const out = await svc.recordVersion(input);
    expect(out).not.toBeNull();
    expect(out?.version).toBe(1);
    expect(out?.action).toBe('CREATE');
    expect(stub.configVersion.create).toHaveBeenCalledOnce();
  });

  it('tăng version tuần tự cho cùng entity', async () => {
    const stub = makePrismaStub();
    const svc = new ConfigVersionService(asPrisma(stub));
    await svc.recordVersion({
      entityType: 'FEATURE_FLAG',
      entityId: 'KEY',
      action: 'CREATE',
      beforeJson: null,
      afterJson: { enabled: false },
      changedByAdminId: 'a1',
    });
    const v2 = await svc.recordVersion({
      entityType: 'FEATURE_FLAG',
      entityId: 'KEY',
      action: 'UPDATE',
      beforeJson: { enabled: false },
      afterJson: { enabled: true },
      changedByAdminId: 'a1',
    });
    expect(v2?.version).toBe(2);
  });

  it('skip no-op (before deep-equal after) — không gọi create', async () => {
    const stub = makePrismaStub();
    const svc = new ConfigVersionService(asPrisma(stub));
    const out = await svc.recordVersion({
      entityType: 'FEATURE_FLAG',
      entityId: 'KEY',
      action: 'UPDATE',
      beforeJson: { enabled: true },
      afterJson: { enabled: true },
      changedByAdminId: 'a1',
    });
    expect(out).toBeNull();
    expect(stub.configVersion.create).not.toHaveBeenCalled();
  });

  it('strip secret-like key trong afterJson trước khi persist', async () => {
    const stub = makePrismaStub();
    const svc = new ConfigVersionService(asPrisma(stub));
    await svc.recordVersion({
      entityType: 'FEATURE_FLAG',
      entityId: 'KEY',
      action: 'CREATE',
      beforeJson: null,
      afterJson: { enabled: true, secretKey: 'leaky', token: 'tok' } as any,
      changedByAdminId: 'a1',
    });
    const persisted = stub.configVersion.create.mock.calls[0][0].data
      .afterJson as Record<string, unknown>;
    expect(persisted.secretKey).toBe('[REDACTED]');
    expect(persisted.token).toBe('[REDACTED]');
    expect(persisted.enabled).toBe(true);
  });

  it('reject entityType ngoài catalog', async () => {
    const stub = makePrismaStub();
    const svc = new ConfigVersionService(asPrisma(stub));
    await expect(
      svc.recordVersion({
        entityType: 'NOT_REAL' as any,
        entityId: 'x',
        action: 'CREATE',
        beforeJson: null,
        afterJson: { a: 1 },
        changedByAdminId: null,
      }),
    ).rejects.toThrowError(ConfigVersionError);
  });

  it('reject action ngoài catalog', async () => {
    const stub = makePrismaStub();
    const svc = new ConfigVersionService(asPrisma(stub));
    await expect(
      svc.recordVersion({
        entityType: 'FEATURE_FLAG',
        entityId: 'x',
        action: 'PATCH' as any,
        beforeJson: null,
        afterJson: { a: 1 },
        changedByAdminId: null,
      }),
    ).rejects.toThrowError(ConfigVersionError);
  });
});

describe('ConfigVersionService.listVersions/getVersion/getLatestVersion', () => {
  it('list newest-first và getLatestVersion trả top', async () => {
    const stub = makePrismaStub();
    const svc = new ConfigVersionService(asPrisma(stub));
    await svc.recordVersion({
      entityType: 'MAINTENANCE_WINDOW',
      entityId: 'm1',
      action: 'CREATE',
      beforeJson: null,
      afterJson: { status: 'DRAFT' },
      changedByAdminId: 'a1',
    });
    await svc.recordVersion({
      entityType: 'MAINTENANCE_WINDOW',
      entityId: 'm1',
      action: 'UPDATE',
      beforeJson: { status: 'DRAFT' },
      afterJson: { status: 'SCHEDULED' },
      changedByAdminId: 'a1',
    });
    const list = await svc.listVersions('MAINTENANCE_WINDOW', 'm1');
    expect(list.map((v) => v.version)).toEqual([2, 1]);
    const latest = await svc.getLatestVersion('MAINTENANCE_WINDOW', 'm1');
    expect(latest?.version).toBe(2);
  });

  it('getVersion throw NOT_FOUND nếu id sai', async () => {
    const stub = makePrismaStub();
    const svc = new ConfigVersionService(asPrisma(stub));
    await expect(svc.getVersion('missing')).rejects.toThrowError(
      ConfigVersionError,
    );
  });
});

describe('ConfigVersionService.diffVersions', () => {
  it('changedFields phản ánh field khác nhau', async () => {
    const stub = makePrismaStub();
    const svc = new ConfigVersionService(asPrisma(stub));
    const v1 = await svc.recordVersion({
      entityType: 'LIVEOPS_EVENT',
      entityId: 'e1',
      action: 'CREATE',
      beforeJson: null,
      afterJson: { title: 'A', status: 'SCHEDULED', configJson: { multiplier: 1.5 } },
      changedByAdminId: 'a1',
    });
    const v2 = await svc.recordVersion({
      entityType: 'LIVEOPS_EVENT',
      entityId: 'e1',
      action: 'UPDATE',
      beforeJson: { title: 'A', status: 'SCHEDULED', configJson: { multiplier: 1.5 } },
      afterJson: { title: 'B', status: 'SCHEDULED', configJson: { multiplier: 1.8 } },
      changedByAdminId: 'a1',
    });
    const d = await svc.diffVersions(v1!.id, v2!.id);
    expect(d.changedFields).toContain('title');
    expect(d.changedFields).toContain('configJson');
    expect(d.changedFields).not.toContain('status');
  });
});

describe('ConfigVersionService.recordRollbackRun', () => {
  it('ghi row với status/safety chính xác', async () => {
    const stub = makePrismaStub();
    const svc = new ConfigVersionService(asPrisma(stub));
    const input: RecordRollbackRunInput = {
      entityType: 'FEATURE_FLAG',
      entityId: 'MARKET_ENABLED',
      fromVersion: 5,
      toVersion: 2,
      targetVersionId: 'v_target',
      status: 'BLOCKED',
      safetyLevel: 'BLOCKED',
      performedByAdminId: 'admin1',
      reason: 'test rollback',
      resultJson: { warnings: ['rollback.warning.featureFlagCritical'] },
    };
    const out = await svc.recordRollbackRun(input);
    expect(out.id).toBeTruthy();
    expect(stub.__rollbackRuns()[0].status).toBe('BLOCKED');
    expect(stub.__rollbackRuns()[0].safetyLevel).toBe('BLOCKED');
  });

  it('reject status / safety level ngoài catalog', async () => {
    const stub = makePrismaStub();
    const svc = new ConfigVersionService(asPrisma(stub));
    await expect(
      svc.recordRollbackRun({
        entityType: 'FEATURE_FLAG',
        entityId: 'x',
        fromVersion: 1,
        toVersion: 1,
        targetVersionId: null,
        status: 'WAT' as any,
        safetyLevel: 'SAFE',
        performedByAdminId: null,
      }),
    ).rejects.toThrowError(ConfigVersionError);
  });
});
