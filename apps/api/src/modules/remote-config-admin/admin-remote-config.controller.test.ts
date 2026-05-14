/**
 * Phase 45.0 — AdminRemoteConfigController unit tests.
 *
 * Cover:
 *   - GET /admin/remote-config returns service list in envelope
 *   - PATCH happy path → service.setConfig called + audit log + reason captured
 *   - PATCH without reason → 400 INVALID_INPUT
 *   - PATCH reason < 3 chars → 400 INVALID_INPUT
 *   - PATCH unknown key → 404 REMOTE_CONFIG_KEY_INVALID
 *   - PATCH invalid value (type/cap) → 422 REMOTE_CONFIG_VALIDATION_FAILED
 *   - POST /refresh-defaults → audit
 *   - POST /clear-cache → audit
 *
 * AdminGuard không enforce trong unit test (pattern mirror Phase 15.4).
 */
import { describe, expect, it, vi } from 'vitest';
import type { RemoteConfigAdminView } from '@xuantoi/shared';
import { AdminRemoteConfigController } from './admin-remote-config.controller';
import {
  RemoteConfigInvalidKeyError,
  RemoteConfigValidationError,
  type RemoteConfigService,
} from '../remote-config/remote-config.service';
import type { PrismaService } from '../../common/prisma.service';

function makeStubs(
  opts: {
    listImpl?: () => Promise<RemoteConfigAdminView[]>;
    setImpl?: (
      adminId: string,
      key: import('@xuantoi/shared').RemoteConfigKey,
      value: unknown,
    ) => Promise<RemoteConfigAdminView>;
    ensureImpl?: () => Promise<{ created: number; existing: number }>;
    clearImpl?: () => Promise<void>;
  } = {},
) {
  const auditCalls: Array<{ action: string; meta: unknown }> = [];
  const prisma = {
    adminAuditLog: {
      create: vi.fn(async ({ data }: { data: { action: string; meta: unknown } }) => {
        auditCalls.push({ action: data.action, meta: data.meta });
        return data;
      }),
    },
  } as unknown as PrismaService;

  const defaultView = (
    key: import('@xuantoi/shared').RemoteConfigKey,
    value: unknown,
  ): RemoteConfigAdminView => ({
    key,
    valueType: 'number',
    value,
    defaultValue: 50,
    descriptionVi: 'd',
    descriptionEn: 'd',
    public: false,
    updatedByAdminId: 'admin-1',
    updatedAt: '2026-06-22T00:00:00.000Z',
  });

  const service = {
    listConfigs: opts.listImpl ?? (async () => []),
    setConfig:
      opts.setImpl ??
      (async (_a, key, value) => defaultView(key, value)),
    ensureDefaultConfigs:
      opts.ensureImpl ?? (async () => ({ created: 0, existing: 7 })),
    clearCache: opts.clearImpl ?? (async () => undefined),
  } as unknown as RemoteConfigService;
  return { service, prisma, auditCalls };
}

describe('AdminRemoteConfigController.list', () => {
  it('returns service.listConfigs() in envelope', async () => {
    const stub: RemoteConfigAdminView = {
      key: 'max_daily_claims',
      valueType: 'number',
      value: 50,
      defaultValue: 50,
      descriptionVi: 'd',
      descriptionEn: 'd',
      public: false,
      updatedByAdminId: null,
      updatedAt: null,
    };
    const { service, prisma } = makeStubs({ listImpl: async () => [stub] });
    const c = new AdminRemoteConfigController(service, prisma);
    const r = await c.list();
    expect(r.ok).toBe(true);
    expect(r.data.configs).toEqual([stub]);
  });
});

describe('AdminRemoteConfigController.update', () => {
  it('happy path → calls setConfig + audit with reason', async () => {
    const { service, prisma, auditCalls } = makeStubs();
    const c = new AdminRemoteConfigController(service, prisma);
    const r = await c.update(
      { userId: 'admin-1', role: 'ADMIN' } as unknown as Parameters<
        typeof c.update
      >[0],
      'max_daily_claims',
      { value: 100, reason: 'season-event boost' },
    );
    expect(r.ok).toBe(true);
    expect(r.data.value).toBe(100);
    expect(auditCalls).toHaveLength(1);
    expect(auditCalls[0].action).toBe('ADMIN_REMOTE_CONFIG_UPDATE');
    expect(auditCalls[0].meta).toMatchObject({
      key: 'max_daily_claims',
      value: 100,
      reason: 'season-event boost',
    });
  });

  it('missing reason → 400 INVALID_INPUT', async () => {
    const { service, prisma } = makeStubs();
    const c = new AdminRemoteConfigController(service, prisma);
    await expect(
      c.update(
        { userId: 'admin-1', role: 'ADMIN' } as unknown as Parameters<
          typeof c.update
        >[0],
        'max_daily_claims',
        { value: 100 },
      ),
    ).rejects.toMatchObject({
      response: { error: { code: 'INVALID_INPUT' } },
    });
  });

  it('reason too short → 400 INVALID_INPUT', async () => {
    const { service, prisma } = makeStubs();
    const c = new AdminRemoteConfigController(service, prisma);
    await expect(
      c.update(
        { userId: 'admin-1', role: 'ADMIN' } as unknown as Parameters<
          typeof c.update
        >[0],
        'max_daily_claims',
        { value: 100, reason: 'ab' },
      ),
    ).rejects.toMatchObject({
      response: { error: { code: 'INVALID_INPUT' } },
    });
  });

  it('unknown key (catalog) → 404 REMOTE_CONFIG_KEY_INVALID', async () => {
    const { service, prisma } = makeStubs();
    const c = new AdminRemoteConfigController(service, prisma);
    await expect(
      c.update(
        { userId: 'admin-1', role: 'ADMIN' } as unknown as Parameters<
          typeof c.update
        >[0],
        'NOT_A_KEY',
        { value: 1, reason: 'fixing things' },
      ),
    ).rejects.toMatchObject({
      response: { error: { code: 'REMOTE_CONFIG_KEY_INVALID' } },
    });
  });

  it('service throws RemoteConfigValidationError → 422 with violations', async () => {
    const { service, prisma } = makeStubs({
      setImpl: async () => {
        throw new RemoteConfigValidationError('max_daily_claims', [
          {
            code: 'NUMBER_ABOVE_MAX',
            message: 'value > 1000',
          },
        ]);
      },
    });
    const c = new AdminRemoteConfigController(service, prisma);
    await expect(
      c.update(
        { userId: 'admin-1', role: 'ADMIN' } as unknown as Parameters<
          typeof c.update
        >[0],
        'max_daily_claims',
        { value: 99999, reason: 'cap-bypass attempt' },
      ),
    ).rejects.toMatchObject({
      response: {
        error: { code: 'REMOTE_CONFIG_VALIDATION_FAILED' },
      },
    });
  });

  it('service throws RemoteConfigInvalidKeyError → 404', async () => {
    const { service, prisma } = makeStubs({
      setImpl: async (_a, key) => {
        throw new RemoteConfigInvalidKeyError(key);
      },
    });
    const c = new AdminRemoteConfigController(service, prisma);
    await expect(
      c.update(
        { userId: 'admin-1', role: 'ADMIN' } as unknown as Parameters<
          typeof c.update
        >[0],
        'max_daily_claims',
        { value: 100, reason: 'attempt' },
      ),
    ).rejects.toMatchObject({
      response: { error: { code: 'REMOTE_CONFIG_KEY_INVALID' } },
    });
  });

  it('extra field in body rejected by strict zod', async () => {
    const { service, prisma } = makeStubs();
    const c = new AdminRemoteConfigController(service, prisma);
    await expect(
      c.update(
        { userId: 'admin-1', role: 'ADMIN' } as unknown as Parameters<
          typeof c.update
        >[0],
        'max_daily_claims',
        { value: 100, reason: 'ok', extra: 1 },
      ),
    ).rejects.toMatchObject({
      response: { error: { code: 'INVALID_INPUT' } },
    });
  });
});

describe('AdminRemoteConfigController side-effect endpoints', () => {
  it('refresh-defaults → calls service + audits', async () => {
    const { service, prisma, auditCalls } = makeStubs();
    const c = new AdminRemoteConfigController(service, prisma);
    const r = await c.refreshDefaults({ userId: 'admin-1', role: 'ADMIN' } as unknown as Parameters<typeof c.refreshDefaults>[0]);
    expect(r.ok).toBe(true);
    expect(r.data.created).toBe(0);
    expect(auditCalls[0].action).toBe('ADMIN_REMOTE_CONFIG_REFRESH_DEFAULTS');
  });

  it('clear-cache → calls service + audits', async () => {
    const { service, prisma, auditCalls } = makeStubs();
    const c = new AdminRemoteConfigController(service, prisma);
    const r = await c.clearCache({ userId: 'admin-1', role: 'ADMIN' } as unknown as Parameters<typeof c.clearCache>[0]);
    expect(r.ok).toBe(true);
    expect(r.data.cleared).toBe(true);
    expect(auditCalls[0].action).toBe('ADMIN_REMOTE_CONFIG_CLEAR_CACHE');
  });
});
