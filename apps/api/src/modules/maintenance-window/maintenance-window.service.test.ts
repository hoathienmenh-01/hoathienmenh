/**
 * Phase 15.5 — MaintenanceWindowService unit tests.
 *
 * Cover:
 *   - createWindow validation reject (delegate to validator)
 *   - createWindow happy path → DB create + cache invalidate
 *   - createWindow unique-key collision → MAINTENANCE_KEY_DUPLICATE
 *   - updateWindow merges fields + revalidates + cache invalidate
 *   - updateWindow on missing id → MAINTENANCE_NOT_FOUND
 *   - disableWindow idempotent (giữ disabledAt cũ)
 *   - recomputeStatuses SCHEDULED → ACTIVE
 *   - recomputeStatuses ACTIVE → ENDED
 *   - recomputeStatuses idempotent (run 2 lần → lần 2 trống)
 *   - getActiveWindow cache 10s + invalidate sau create
 *   - publicStatus active=false / true (server-time stamp)
 *   - isMaintenanceActiveForRequest:
 *     - no active → null
 *     - status route bypass
 *     - healthcheck bypass
 *     - metrics bypass
 *     - auth route bypass (trừ FULL_LOCKDOWN)
 *     - FULL_LOCKDOWN block admin
 *     - target=NON_ADMIN_USERS admin pass
 *     - allowAdminBypass=false admin block
 *     - API_WRITE_ONLY GET pass / POST block
 *     - PLAYER block (errorCode = MAINTENANCE_ACTIVE)
 */
import { describe, expect, it, vi } from 'vitest';
import { Prisma } from '@prisma/client';
import {
  MAINTENANCE_BLOCK_ERROR_CODE,
  type MaintenanceSeverity,
  type MaintenanceTarget,
  type MaintenanceWindowStatus,
} from '@xuantoi/shared';
import {
  MaintenanceWindowError,
  MaintenanceWindowService,
} from './maintenance-window.service';
import type { PrismaService } from '../../common/prisma.service';

// ---------------------------------------------------------------------------
// In-memory Prisma stub
// ---------------------------------------------------------------------------

interface DbRow {
  id: string;
  key: string;
  status: string;
  severity: string;
  target: string;
  titleVi: string;
  titleEn: string | null;
  messageVi: string;
  messageEn: string | null;
  startsAt: Date;
  endsAt: Date;
  allowAdminBypass: boolean;
  allowHealthcheck: boolean;
  allowMetrics: boolean;
  createdByAdminId: string | null;
  disabledAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

interface MakePrismaOpts {
  initial?: DbRow[];
  failCreateUnique?: boolean;
}

let idSeq = 0;
function nextId(): string {
  idSeq += 1;
  return `mw-${idSeq.toString().padStart(4, '0')}`;
}

function clone(r: DbRow): DbRow {
  return { ...r };
}

function makeDbRow(partial: Partial<DbRow> & { key: string }): DbRow {
  const now = new Date('2026-08-01T00:00:00Z');
  return {
    id: nextId(),
    key: partial.key,
    status: partial.status ?? 'DRAFT',
    severity: partial.severity ?? 'INFO',
    target: partial.target ?? 'ALL_PLAYERS',
    titleVi: partial.titleVi ?? 'Bảo trì',
    titleEn: partial.titleEn ?? null,
    messageVi: partial.messageVi ?? 'Hệ thống đang bảo trì.',
    messageEn: partial.messageEn ?? null,
    startsAt: partial.startsAt ?? new Date('2026-08-01T01:00:00Z'),
    endsAt: partial.endsAt ?? new Date('2026-08-01T02:00:00Z'),
    allowAdminBypass: partial.allowAdminBypass ?? true,
    allowHealthcheck: partial.allowHealthcheck ?? true,
    allowMetrics: partial.allowMetrics ?? true,
    createdByAdminId: partial.createdByAdminId ?? null,
    disabledAt: partial.disabledAt ?? null,
    createdAt: partial.createdAt ?? now,
    updatedAt: partial.updatedAt ?? now,
  };
}

function makePrisma(opts: MakePrismaOpts = {}): {
  prisma: PrismaService;
  rows: DbRow[];
} {
  const rows: DbRow[] = (opts.initial ?? []).map(clone);
  return {
    rows,
    prisma: {
      maintenanceWindow: {
        findMany: vi.fn(async (args?: {
          where?: {
            status?: string;
            startsAt?: { lte?: Date; gte?: Date };
            endsAt?: { lte?: Date; gt?: Date };
          };
          select?: Record<string, boolean>;
          orderBy?: unknown;
        }) => {
          const where = args?.where ?? {};
          let out = rows.filter((r) => {
            if (where.status && r.status !== where.status) return false;
            if (where.startsAt?.lte && r.startsAt > where.startsAt.lte) return false;
            if (where.startsAt?.gte && r.startsAt < where.startsAt.gte) return false;
            if (where.endsAt?.lte && r.endsAt > where.endsAt.lte) return false;
            if (where.endsAt?.gt && r.endsAt <= where.endsAt.gt) return false;
            return true;
          });
          out = out.map(clone);
          return out;
        }),
        findUnique: vi.fn(async ({ where }: { where: { id?: string; key?: string } }) => {
          const r = rows.find(
            (x) =>
              (where.id && x.id === where.id) ||
              (where.key && x.key === where.key),
          );
          return r ? clone(r) : null;
        }),
        create: vi.fn(async ({ data }: { data: Partial<DbRow> & { key: string } }) => {
          if (rows.some((x) => x.key === data.key)) {
            const err = new Prisma.PrismaClientKnownRequestError(
              'Unique constraint failed',
              { code: 'P2002', clientVersion: '5.0.0', meta: { target: ['key'] } },
            );
            throw err;
          }
          const row = makeDbRow({
            key: data.key,
            status: data.status,
            severity: data.severity,
            target: data.target,
            titleVi: data.titleVi,
            titleEn: data.titleEn,
            messageVi: data.messageVi,
            messageEn: data.messageEn,
            startsAt: data.startsAt,
            endsAt: data.endsAt,
            allowAdminBypass: data.allowAdminBypass,
            allowHealthcheck: data.allowHealthcheck,
            allowMetrics: data.allowMetrics,
            createdByAdminId: data.createdByAdminId,
          });
          rows.push(row);
          return clone(row);
        }),
        update: vi.fn(async (
          { where, data }: { where: { id: string }; data: Partial<DbRow> },
        ) => {
          const r = rows.find((x) => x.id === where.id);
          if (!r) throw new Error('not found in stub');
          Object.assign(r, data, { updatedAt: new Date() });
          return clone(r);
        }),
        updateMany: vi.fn(async ({ where, data }: {
          where: {
            id?: { in: string[] };
            status?: string;
            startsAt?: { lte?: Date };
            endsAt?: { lte?: Date; gt?: Date };
          };
          data: Partial<DbRow>;
        }) => {
          let count = 0;
          for (const r of rows) {
            if (where.id?.in && !where.id.in.includes(r.id)) continue;
            if (where.status && r.status !== where.status) continue;
            if (where.startsAt?.lte && r.startsAt > where.startsAt.lte) continue;
            if (where.endsAt?.lte && r.endsAt > where.endsAt.lte) continue;
            if (where.endsAt?.gt && r.endsAt <= where.endsAt.gt) continue;
            Object.assign(r, data, { updatedAt: new Date() });
            count += 1;
          }
          return { count };
        }),
      },
    } as unknown as PrismaService,
  };
}

// ---------------------------------------------------------------------------
// Common input helper
// ---------------------------------------------------------------------------

function baseInput(over: Partial<{
  key: string;
  severity: MaintenanceSeverity;
  target: MaintenanceTarget;
  titleVi: string;
  titleEn: string | null;
  messageVi: string;
  messageEn: string | null;
  startsAt: Date;
  endsAt: Date;
  allowAdminBypass: boolean;
  allowHealthcheck: boolean;
  allowMetrics: boolean;
  initialStatus: 'DRAFT' | 'SCHEDULED';
}> = {}) {
  return {
    key: over.key ?? 'mw-2026-08-01',
    severity: over.severity ?? ('WARNING' as MaintenanceSeverity),
    target: over.target ?? ('ALL_PLAYERS' as MaintenanceTarget),
    titleVi: over.titleVi ?? 'Bảo trì hệ thống',
    titleEn: over.titleEn ?? 'Scheduled Maintenance',
    messageVi: over.messageVi ?? 'Hệ thống tạm dừng để nâng cấp.',
    messageEn: over.messageEn ?? 'System will be back shortly.',
    startsAt: over.startsAt ?? new Date('2026-08-01T01:00:00Z'),
    endsAt: over.endsAt ?? new Date('2026-08-01T02:00:00Z'),
    allowAdminBypass: over.allowAdminBypass,
    allowHealthcheck: over.allowHealthcheck,
    allowMetrics: over.allowMetrics,
    initialStatus: over.initialStatus,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('MaintenanceWindowService.createWindow', () => {
  it('rejects invalid window (startsAt >= endsAt)', async () => {
    const { prisma } = makePrisma();
    const svc = new MaintenanceWindowService(prisma);
    await expect(
      svc.createWindow('admin-1', baseInput({
        startsAt: new Date('2026-08-01T03:00:00Z'),
        endsAt: new Date('2026-08-01T02:00:00Z'),
      })),
    ).rejects.toBeInstanceOf(MaintenanceWindowError);
  });

  it('happy path → row created with adminId + DRAFT default', async () => {
    const { prisma, rows } = makePrisma();
    const svc = new MaintenanceWindowService(prisma);
    const view = await svc.createWindow('admin-1', baseInput());
    expect(view.key).toBe('mw-2026-08-01');
    expect(view.status).toBe('DRAFT');
    expect(view.createdByAdminId).toBe('admin-1');
    expect(rows).toHaveLength(1);
  });

  it('initialStatus=SCHEDULED publishes immediately', async () => {
    const { prisma } = makePrisma();
    const svc = new MaintenanceWindowService(prisma);
    const view = await svc.createWindow(
      'admin-1',
      baseInput({ initialStatus: 'SCHEDULED' }),
    );
    expect(view.status).toBe('SCHEDULED');
  });

  it('duplicate key → MAINTENANCE_KEY_DUPLICATE', async () => {
    const { prisma } = makePrisma({
      initial: [makeDbRow({ key: 'mw-dup' })],
    });
    const svc = new MaintenanceWindowService(prisma);
    await expect(
      svc.createWindow('admin-1', baseInput({ key: 'mw-dup' })),
    ).rejects.toMatchObject({ code: 'MAINTENANCE_KEY_DUPLICATE' });
  });
});

describe('MaintenanceWindowService.updateWindow', () => {
  it('missing id → MAINTENANCE_NOT_FOUND', async () => {
    const { prisma } = makePrisma();
    const svc = new MaintenanceWindowService(prisma);
    await expect(svc.updateWindow('does-not-exist', { titleVi: 'x' })).rejects.toMatchObject(
      { code: 'MAINTENANCE_NOT_FOUND' },
    );
  });

  it('rejects merged invalid window (endsAt < startsAt)', async () => {
    const { prisma, rows } = makePrisma({
      initial: [
        makeDbRow({
          key: 'mw-x',
          startsAt: new Date('2026-08-01T01:00:00Z'),
          endsAt: new Date('2026-08-01T02:00:00Z'),
        }),
      ],
    });
    const svc = new MaintenanceWindowService(prisma);
    await expect(
      svc.updateWindow(rows[0].id, {
        endsAt: new Date('2026-08-01T00:30:00Z'),
      }),
    ).rejects.toBeInstanceOf(MaintenanceWindowError);
  });

  it('rejects manual transition to ACTIVE/ENDED', async () => {
    const { prisma, rows } = makePrisma({
      initial: [makeDbRow({ key: 'mw-x' })],
    });
    const svc = new MaintenanceWindowService(prisma);
    await expect(
      svc.updateWindow(rows[0].id, {
        status: 'ACTIVE' as 'SCHEDULED',
      }),
    ).rejects.toMatchObject({ code: 'MAINTENANCE_INVALID_STATUS_TRANSITION' });
  });

  it('happy path patches partial fields', async () => {
    const { prisma, rows } = makePrisma({
      initial: [makeDbRow({ key: 'mw-x', titleVi: 'old' })],
    });
    const svc = new MaintenanceWindowService(prisma);
    const view = await svc.updateWindow(rows[0].id, {
      titleVi: 'new title',
    });
    expect(view.titleVi).toBe('new title');
    expect(view.key).toBe('mw-x');
  });
});

describe('MaintenanceWindowService.disableWindow', () => {
  it('sets status DISABLED + disabledAt', async () => {
    const { prisma, rows } = makePrisma({
      initial: [makeDbRow({ key: 'mw-x', status: 'ACTIVE' })],
    });
    const svc = new MaintenanceWindowService(prisma);
    const view = await svc.disableWindow(rows[0].id);
    expect(view.status).toBe('DISABLED');
    expect(view.disabledAt).not.toBeNull();
  });

  it('idempotent — disabledAt cũ giữ nguyên', async () => {
    const original = new Date('2026-07-30T00:00:00Z');
    const { prisma, rows } = makePrisma({
      initial: [
        makeDbRow({
          key: 'mw-x',
          status: 'DISABLED',
          disabledAt: original,
        }),
      ],
    });
    const svc = new MaintenanceWindowService(prisma);
    const view = await svc.disableWindow(rows[0].id);
    expect(view.status).toBe('DISABLED');
    expect(view.disabledAt).toBe(original.toISOString());
  });

  it('missing id → MAINTENANCE_NOT_FOUND', async () => {
    const { prisma } = makePrisma();
    const svc = new MaintenanceWindowService(prisma);
    await expect(svc.disableWindow('nope')).rejects.toMatchObject({
      code: 'MAINTENANCE_NOT_FOUND',
    });
  });
});

describe('MaintenanceWindowService.recomputeStatuses', () => {
  it('SCHEDULED → ACTIVE when in window', async () => {
    const { prisma, rows } = makePrisma({
      initial: [
        makeDbRow({
          key: 'mw-x',
          status: 'SCHEDULED',
          startsAt: new Date('2026-08-01T00:00:00Z'),
          endsAt: new Date('2026-08-01T02:00:00Z'),
        }),
      ],
    });
    const svc = new MaintenanceWindowService(prisma);
    const summary = await svc.recomputeStatuses(
      new Date('2026-08-01T01:00:00Z'),
    );
    expect(summary.activatedKeys).toEqual(['mw-x']);
    expect(rows[0].status).toBe('ACTIVE');
  });

  it('ACTIVE → ENDED past endsAt', async () => {
    const { prisma, rows } = makePrisma({
      initial: [
        makeDbRow({
          key: 'mw-x',
          status: 'ACTIVE',
          startsAt: new Date('2026-08-01T00:00:00Z'),
          endsAt: new Date('2026-08-01T02:00:00Z'),
        }),
      ],
    });
    const svc = new MaintenanceWindowService(prisma);
    const summary = await svc.recomputeStatuses(
      new Date('2026-08-01T03:00:00Z'),
    );
    expect(summary.endedKeys).toEqual(['mw-x']);
    expect(rows[0].status).toBe('ENDED');
  });

  it('idempotent — running twice returns empty arrays second time', async () => {
    const { prisma } = makePrisma({
      initial: [
        makeDbRow({
          key: 'mw-x',
          status: 'SCHEDULED',
          startsAt: new Date('2026-08-01T00:00:00Z'),
          endsAt: new Date('2026-08-01T02:00:00Z'),
        }),
      ],
    });
    const svc = new MaintenanceWindowService(prisma);
    const a = await svc.recomputeStatuses(new Date('2026-08-01T01:00:00Z'));
    const b = await svc.recomputeStatuses(new Date('2026-08-01T01:01:00Z'));
    expect(a.activatedKeys).toEqual(['mw-x']);
    expect(b.activatedKeys).toEqual([]);
    expect(b.endedKeys).toEqual([]);
  });

  it('SCHEDULED past endsAt → ENDED but NOT counted as activated', async () => {
    const { prisma, rows } = makePrisma({
      initial: [
        makeDbRow({
          key: 'mw-x',
          status: 'SCHEDULED',
          startsAt: new Date('2026-08-01T00:00:00Z'),
          endsAt: new Date('2026-08-01T01:00:00Z'),
        }),
      ],
    });
    const svc = new MaintenanceWindowService(prisma);
    const summary = await svc.recomputeStatuses(
      new Date('2026-08-01T02:00:00Z'),
    );
    expect(summary.activatedKeys).toEqual([]);
    expect(rows[0].status).toBe('ENDED');
  });
});

describe('MaintenanceWindowService.getActiveWindow + cache', () => {
  it('caches result for 10s', async () => {
    const { prisma, rows } = makePrisma({
      initial: [
        makeDbRow({
          key: 'mw-x',
          status: 'ACTIVE',
          startsAt: new Date('2026-08-01T00:00:00Z'),
          endsAt: new Date('2026-08-01T02:00:00Z'),
        }),
      ],
    });
    const svc = new MaintenanceWindowService(prisma);
    const t1 = new Date('2026-08-01T01:00:00Z');
    const t2 = new Date('2026-08-01T01:00:05Z');
    const r1 = await svc.getActiveWindow(t1);
    expect(r1?.key).toBe('mw-x');
    // mutate row directly — without cache invalidation result should
    // still be the cached row.
    rows[0].status = 'DISABLED';
    const r2 = await svc.getActiveWindow(t2);
    expect(r2?.key).toBe('mw-x');
  });

  it('invalidateCache forces re-read', async () => {
    const { prisma, rows } = makePrisma({
      initial: [
        makeDbRow({
          key: 'mw-x',
          status: 'ACTIVE',
          startsAt: new Date('2026-08-01T00:00:00Z'),
          endsAt: new Date('2026-08-01T02:00:00Z'),
        }),
      ],
    });
    const svc = new MaintenanceWindowService(prisma);
    const t = new Date('2026-08-01T01:00:00Z');
    await svc.getActiveWindow(t);
    rows[0].status = 'DISABLED';
    svc.invalidateCache();
    const r2 = await svc.getActiveWindow(t);
    expect(r2).toBeNull();
  });
});

describe('MaintenanceWindowService.publicStatus', () => {
  it('active=false when no ACTIVE row', async () => {
    const { prisma } = makePrisma();
    const svc = new MaintenanceWindowService(prisma);
    const view = await svc.publicStatus(new Date('2026-08-01T01:00:00Z'));
    expect(view.active).toBe(false);
    expect(view.titleVi).toBeNull();
    expect(view.serverTime).toBe('2026-08-01T01:00:00.000Z');
  });

  it('active=true with public-safe payload', async () => {
    const { prisma } = makePrisma({
      initial: [
        makeDbRow({
          key: 'mw-x',
          status: 'ACTIVE',
          severity: 'WARNING',
          target: 'ALL_PLAYERS',
          titleVi: 'Bảo trì',
          titleEn: 'Maintenance',
          startsAt: new Date('2026-08-01T00:00:00Z'),
          endsAt: new Date('2026-08-01T02:00:00Z'),
        }),
      ],
    });
    const svc = new MaintenanceWindowService(prisma);
    const view = await svc.publicStatus(new Date('2026-08-01T01:00:00Z'));
    expect(view.active).toBe(true);
    expect(view.severity).toBe('WARNING');
    expect(view.titleEn).toBe('Maintenance');
  });
});

describe('MaintenanceWindowService.isMaintenanceActiveForRequest', () => {
  function activeRow(over: Partial<{
    target: MaintenanceTarget;
    severity: MaintenanceSeverity;
    allowAdminBypass: boolean;
    allowHealthcheck: boolean;
    allowMetrics: boolean;
  }> = {}) {
    return {
      key: 'mw-active',
      status: 'ACTIVE' as MaintenanceWindowStatus,
      severity: over.severity ?? ('WARNING' as MaintenanceSeverity),
      target: over.target ?? ('ALL_PLAYERS' as MaintenanceTarget),
      startsAt: new Date('2026-08-01T00:00:00Z'),
      endsAt: new Date('2026-08-01T02:00:00Z'),
      allowAdminBypass: over.allowAdminBypass ?? true,
      allowHealthcheck: over.allowHealthcheck ?? true,
      allowMetrics: over.allowMetrics ?? true,
    };
  }

  function svcWithActive(over: Parameters<typeof activeRow>[0] = {}) {
    const { prisma } = makePrisma({
      initial: [
        makeDbRow({
          ...activeRow(over),
        }),
      ],
    });
    return new MaintenanceWindowService(prisma);
  }

  const now = new Date('2026-08-01T01:00:00Z');

  it('returns null when no ACTIVE window', async () => {
    const { prisma } = makePrisma();
    const svc = new MaintenanceWindowService(prisma);
    const r = await svc.isMaintenanceActiveForRequest(
      { role: 'PLAYER', path: '/api/character/me', method: 'GET' },
      now,
    );
    expect(r).toBeNull();
  });

  it('public maintenance status route always passes', async () => {
    const svc = svcWithActive();
    const r = await svc.isMaintenanceActiveForRequest(
      { role: 'ANONYMOUS', path: '/api/maintenance/status', method: 'GET' },
      now,
    );
    expect(r).toBeNull();
  });

  it('healthcheck bypass when allowHealthcheck=true', async () => {
    const svc = svcWithActive({ allowHealthcheck: true });
    const r = await svc.isMaintenanceActiveForRequest(
      { role: 'ANONYMOUS', path: '/api/healthz', method: 'GET' },
      now,
    );
    expect(r).toBeNull();
  });

  it('metrics bypass when allowMetrics=true', async () => {
    const svc = svcWithActive({ allowMetrics: true });
    const r = await svc.isMaintenanceActiveForRequest(
      { role: 'ADMIN', path: '/api/admin/metrics', method: 'GET' },
      now,
    );
    expect(r).toBeNull();
  });

  it('admin bypass when allowAdminBypass=true', async () => {
    const svc = svcWithActive({ allowAdminBypass: true });
    const r = await svc.isMaintenanceActiveForRequest(
      { role: 'ADMIN', path: '/api/admin/users', method: 'POST' },
      now,
    );
    expect(r).toBeNull();
  });

  it('admin BLOCKED when allowAdminBypass=false (target=ALL_PLAYERS)', async () => {
    const svc = svcWithActive({
      allowAdminBypass: false,
      target: 'ALL_PLAYERS',
    });
    const r = await svc.isMaintenanceActiveForRequest(
      { role: 'ADMIN', path: '/api/admin/users', method: 'POST' },
      now,
    );
    expect(r?.errorCode).toBe(MAINTENANCE_BLOCK_ERROR_CODE);
  });

  it('NON_ADMIN_USERS — admin bypass even if allowAdminBypass=false', async () => {
    const svc = svcWithActive({
      target: 'NON_ADMIN_USERS',
      allowAdminBypass: false,
    });
    const r = await svc.isMaintenanceActiveForRequest(
      { role: 'ADMIN', path: '/api/admin/feature-flags', method: 'GET' },
      now,
    );
    expect(r).toBeNull();
  });

  it('NON_ADMIN_USERS blocks PLAYER', async () => {
    const svc = svcWithActive({ target: 'NON_ADMIN_USERS' });
    const r = await svc.isMaintenanceActiveForRequest(
      { role: 'PLAYER', path: '/api/character/me', method: 'GET' },
      now,
    );
    expect(r?.errorCode).toBe(MAINTENANCE_BLOCK_ERROR_CODE);
  });

  it('FULL_LOCKDOWN blocks ADMIN too (except healthcheck)', async () => {
    const svc = svcWithActive({ target: 'FULL_LOCKDOWN' });
    const blocked = await svc.isMaintenanceActiveForRequest(
      { role: 'ADMIN', path: '/api/admin/users', method: 'GET' },
      now,
    );
    expect(blocked?.errorCode).toBe(MAINTENANCE_BLOCK_ERROR_CODE);
    const health = await svc.isMaintenanceActiveForRequest(
      { role: 'ADMIN', path: '/api/healthz', method: 'GET' },
      now,
    );
    expect(health).toBeNull();
  });

  it('FULL_LOCKDOWN blocks /_auth (no login during full lockdown)', async () => {
    const svc = svcWithActive({ target: 'FULL_LOCKDOWN' });
    const r = await svc.isMaintenanceActiveForRequest(
      { role: 'ANONYMOUS', path: '/api/_auth/login', method: 'POST' },
      now,
    );
    expect(r?.errorCode).toBe(MAINTENANCE_BLOCK_ERROR_CODE);
  });

  it('non-FULL_LOCKDOWN: /_auth bypass for login', async () => {
    const svc = svcWithActive({ target: 'ALL_PLAYERS' });
    const r = await svc.isMaintenanceActiveForRequest(
      { role: 'ANONYMOUS', path: '/api/_auth/login', method: 'POST' },
      now,
    );
    expect(r).toBeNull();
  });

  it('API_WRITE_ONLY: GET passes for player', async () => {
    const svc = svcWithActive({ target: 'API_WRITE_ONLY' });
    const r = await svc.isMaintenanceActiveForRequest(
      { role: 'PLAYER', path: '/api/character/me', method: 'GET' },
      now,
    );
    expect(r).toBeNull();
  });

  it('API_WRITE_ONLY: POST blocks player', async () => {
    const svc = svcWithActive({ target: 'API_WRITE_ONLY' });
    const r = await svc.isMaintenanceActiveForRequest(
      { role: 'PLAYER', path: '/api/character/levelup', method: 'POST' },
      now,
    );
    expect(r?.errorCode).toBe(MAINTENANCE_BLOCK_ERROR_CODE);
  });

  it('block payload includes title/message/endsAt/serverTime/severity', async () => {
    const svc = svcWithActive({ target: 'ALL_PLAYERS', severity: 'CRITICAL' });
    const r = await svc.isMaintenanceActiveForRequest(
      { role: 'PLAYER', path: '/api/character/me', method: 'GET' },
      now,
    );
    expect(r).not.toBeNull();
    expect(r?.payload.code).toBe('MAINTENANCE_ACTIVE');
    expect(r?.payload.meta.severity).toBe('CRITICAL');
    expect(r?.payload.meta.endsAt).toBe('2026-08-01T02:00:00.000Z');
    expect(r?.payload.meta.serverTime).toBe(now.toISOString());
  });
});
