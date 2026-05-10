/**
 * Phase 15.5 — AdminMaintenanceWindowController unit tests.
 *
 * Cover:
 *   - GET /admin/maintenance-windows returns service.listWindows()
 *   - POST /admin/maintenance-windows happy → audit ADMIN_MAINTENANCE_CREATE
 *   - POST với body sai schema → 400 INVALID_INPUT
 *   - POST với key trùng → 409 MAINTENANCE_KEY_DUPLICATE
 *   - POST với time invalid → 400 (validator code)
 *   - PATCH /admin/maintenance-windows/:id → audit ADMIN_MAINTENANCE_UPDATE
 *   - PATCH not found → 404
 *   - POST /:id/disable → audit ADMIN_MAINTENANCE_DISABLE
 *   - POST /recompute-status → audit ADMIN_MAINTENANCE_RECOMPUTE
 *
 * AdminGuard không enforce trong unit test — mirror feature-flag-admin
 * pattern. E2E ADMIN_ONLY test có ở admin/admin.guard tests.
 */
import { describe, expect, it, vi } from 'vitest';
import type {
  MaintenanceWindowAdminView,
  MaintenanceSeverity,
  MaintenanceTarget,
} from '@xuantoi/shared';
import { AdminMaintenanceWindowController } from './admin-maintenance-window.controller';
import {
  MaintenanceWindowError,
  type MaintenanceWindowService,
} from '../maintenance-window/maintenance-window.service';
import type { PrismaService } from '../../common/prisma.service';

function makeView(over: Partial<MaintenanceWindowAdminView> = {}): MaintenanceWindowAdminView {
  return {
    id: over.id ?? 'mw-id-1',
    key: over.key ?? 'mw-2026-08-01',
    status: over.status ?? 'DRAFT',
    severity: over.severity ?? ('WARNING' as MaintenanceSeverity),
    target: over.target ?? ('ALL_PLAYERS' as MaintenanceTarget),
    titleVi: over.titleVi ?? 'Bảo trì',
    titleEn: over.titleEn ?? null,
    messageVi: over.messageVi ?? 'Hệ thống đang bảo trì.',
    messageEn: over.messageEn ?? null,
    startsAt: over.startsAt ?? '2026-08-01T01:00:00.000Z',
    endsAt: over.endsAt ?? '2026-08-01T02:00:00.000Z',
    allowAdminBypass: over.allowAdminBypass ?? true,
    allowHealthcheck: over.allowHealthcheck ?? true,
    allowMetrics: over.allowMetrics ?? true,
    createdByAdminId: over.createdByAdminId ?? 'admin-1',
    disabledAt: over.disabledAt ?? null,
    createdAt: over.createdAt ?? '2026-07-30T00:00:00.000Z',
    updatedAt: over.updatedAt ?? '2026-07-30T00:00:00.000Z',
  };
}

function makeStubs(opts: Partial<{
  list: () => Promise<MaintenanceWindowAdminView[]>;
  create: (
    adminUserId: string,
    input: unknown,
  ) => Promise<MaintenanceWindowAdminView>;
  update: (
    id: string,
    input: unknown,
  ) => Promise<MaintenanceWindowAdminView>;
  disable: (id: string) => Promise<MaintenanceWindowAdminView>;
  recompute: () => Promise<{
    scannedAt: string;
    activatedKeys: string[];
    endedKeys: string[];
  }>;
}> = {}) {
  const auditCalls: Array<{ action: string; meta: unknown; actor: string }> =
    [];
  const prisma = {
    adminAuditLog: {
      create: vi.fn(async ({ data }: {
        data: { actorUserId: string; action: string; meta: unknown };
      }) => {
        auditCalls.push({
          action: data.action,
          meta: data.meta,
          actor: data.actorUserId,
        });
        return data;
      }),
    },
  } as unknown as PrismaService;

  const service = {
    listWindows: opts.list ?? (async () => []),
    createWindow: opts.create ?? (async () => makeView()),
    updateWindow: opts.update ?? (async () => makeView()),
    disableWindow: opts.disable ?? (async () => makeView({ status: 'DISABLED' })),
    recomputeStatuses:
      opts.recompute ??
      (async () => ({
        scannedAt: '2026-08-01T01:00:00.000Z',
        activatedKeys: [],
        endedKeys: [],
      })),
  } as unknown as MaintenanceWindowService;

  return { service, prisma, auditCalls };
}

const adminReq = { userId: 'admin-1', role: 'ADMIN' as const } as unknown as Parameters<
  AdminMaintenanceWindowController['create']
>[0];

const validCreateBody = {
  key: 'mw-2026-08-01',
  severity: 'WARNING',
  target: 'ALL_PLAYERS',
  titleVi: 'Bảo trì',
  messageVi: 'Hệ thống đang bảo trì.',
  startsAt: '2026-08-01T01:00:00.000Z',
  endsAt: '2026-08-01T02:00:00.000Z',
};

describe('AdminMaintenanceWindowController.list', () => {
  it('returns service result in envelope', async () => {
    const view = makeView();
    const { service, prisma } = makeStubs({ list: async () => [view] });
    const c = new AdminMaintenanceWindowController(service, prisma);
    const r = await c.list();
    expect(r.ok).toBe(true);
    expect(r.data.windows).toEqual([view]);
  });
});

describe('AdminMaintenanceWindowController.create', () => {
  it('happy path → audit ADMIN_MAINTENANCE_CREATE', async () => {
    const { service, prisma, auditCalls } = makeStubs();
    const c = new AdminMaintenanceWindowController(service, prisma);
    const r = await c.create(adminReq, validCreateBody);
    expect(r.ok).toBe(true);
    expect(auditCalls).toHaveLength(1);
    expect(auditCalls[0].action).toBe('ADMIN_MAINTENANCE_CREATE');
    expect(auditCalls[0].actor).toBe('admin-1');
  });

  it('strict body — extra field → INVALID_INPUT', async () => {
    const { service, prisma } = makeStubs();
    const c = new AdminMaintenanceWindowController(service, prisma);
    await expect(
      c.create(adminReq, { ...validCreateBody, evil: 1 }),
    ).rejects.toMatchObject({
      response: { error: { code: 'INVALID_INPUT' } },
    });
  });

  it('missing required field → INVALID_INPUT', async () => {
    const { service, prisma } = makeStubs();
    const c = new AdminMaintenanceWindowController(service, prisma);
    const { titleVi: _omit, ...rest } = validCreateBody;
    await expect(c.create(adminReq, rest)).rejects.toMatchObject({
      response: { error: { code: 'INVALID_INPUT' } },
    });
  });

  it('service throws KEY_DUPLICATE → 409', async () => {
    const { service, prisma } = makeStubs({
      create: async () => {
        throw new MaintenanceWindowError('MAINTENANCE_KEY_DUPLICATE');
      },
    });
    const c = new AdminMaintenanceWindowController(service, prisma);
    await expect(c.create(adminReq, validCreateBody)).rejects.toMatchObject({
      response: { error: { code: 'MAINTENANCE_KEY_DUPLICATE' } },
      status: 409,
    });
  });

  it('service throws validator code → 400', async () => {
    const { service, prisma } = makeStubs({
      create: async () => {
        throw new MaintenanceWindowError('MAINTENANCE_WINDOW_INVALID');
      },
    });
    const c = new AdminMaintenanceWindowController(service, prisma);
    await expect(c.create(adminReq, validCreateBody)).rejects.toMatchObject({
      response: { error: { code: 'MAINTENANCE_WINDOW_INVALID' } },
      status: 400,
    });
  });
});

describe('AdminMaintenanceWindowController.update', () => {
  it('happy path → audit ADMIN_MAINTENANCE_UPDATE', async () => {
    const { service, prisma, auditCalls } = makeStubs({
      update: async () => makeView({ titleVi: 'updated' }),
    });
    const c = new AdminMaintenanceWindowController(service, prisma);
    const r = await c.update(adminReq, 'mw-id-1', { titleVi: 'updated' });
    expect(r.ok).toBe(true);
    expect(auditCalls[0].action).toBe('ADMIN_MAINTENANCE_UPDATE');
  });

  it('NOT_FOUND → 404', async () => {
    const { service, prisma } = makeStubs({
      update: async () => {
        throw new MaintenanceWindowError('MAINTENANCE_NOT_FOUND');
      },
    });
    const c = new AdminMaintenanceWindowController(service, prisma);
    await expect(
      c.update(adminReq, 'nope', { titleVi: 'x' }),
    ).rejects.toMatchObject({
      status: 404,
      response: { error: { code: 'MAINTENANCE_NOT_FOUND' } },
    });
  });

  it('strict body — extra field → INVALID_INPUT', async () => {
    const { service, prisma } = makeStubs();
    const c = new AdminMaintenanceWindowController(service, prisma);
    await expect(
      c.update(adminReq, 'id', { evil: 1 }),
    ).rejects.toMatchObject({
      response: { error: { code: 'INVALID_INPUT' } },
    });
  });
});

describe('AdminMaintenanceWindowController.disable', () => {
  it('happy path → audit ADMIN_MAINTENANCE_DISABLE', async () => {
    const { service, prisma, auditCalls } = makeStubs();
    const c = new AdminMaintenanceWindowController(service, prisma);
    const r = await c.disable(adminReq, 'mw-id-1');
    expect(r.ok).toBe(true);
    expect(auditCalls[0].action).toBe('ADMIN_MAINTENANCE_DISABLE');
  });

  it('NOT_FOUND → 404', async () => {
    const { service, prisma } = makeStubs({
      disable: async () => {
        throw new MaintenanceWindowError('MAINTENANCE_NOT_FOUND');
      },
    });
    const c = new AdminMaintenanceWindowController(service, prisma);
    await expect(c.disable(adminReq, 'nope')).rejects.toMatchObject({
      status: 404,
    });
  });
});

describe('AdminMaintenanceWindowController.recompute', () => {
  it('happy path → audit ADMIN_MAINTENANCE_RECOMPUTE with summary', async () => {
    const { service, prisma, auditCalls } = makeStubs({
      recompute: async () => ({
        scannedAt: '2026-08-01T01:00:00.000Z',
        activatedKeys: ['mw-1'],
        endedKeys: [],
      }),
    });
    const c = new AdminMaintenanceWindowController(service, prisma);
    const r = await c.recompute(adminReq);
    expect(r.ok).toBe(true);
    expect(r.data.activatedKeys).toEqual(['mw-1']);
    expect(auditCalls[0].action).toBe('ADMIN_MAINTENANCE_RECOMPUTE');
    expect(auditCalls[0].meta).toMatchObject({ activatedKeys: ['mw-1'] });
  });
});
