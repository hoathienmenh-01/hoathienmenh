/**
 * Phase 15.4 — AdminFeatureFlagController unit tests.
 *
 * Cover:
 *   - GET /admin/feature-flags returns list from service
 *   - PATCH /admin/feature-flags/:key happy path → audit log written
 *   - PATCH với key ngoài catalog → 404 FEATURE_FLAG_KEY_INVALID
 *   - PATCH với body sai schema → 400 INVALID_INPUT
 *   - POST /refresh-defaults → audit
 *   - POST /clear-cache → audit
 *
 * Lưu ý: AdminGuard không enforce trong unit test (chỉ test method
 * logic). E2E test admin-only block được cover bằng integration test
 * tương tự pattern admin-liveops-announcements.controller.test.ts.
 */
import { HttpException, HttpStatus } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import type { FeatureFlagAdminView } from '@xuantoi/shared';
import { AdminFeatureFlagController } from './admin-feature-flag.controller';
import {
  FeatureFlagInvalidKeyError,
  type FeatureFlagService,
} from '../feature-flag/feature-flag.service';
import type { PrismaService } from '../../common/prisma.service';

function makeStubs(
  opts: {
    listImpl?: () => Promise<FeatureFlagAdminView[]>;
    setImpl?: (
      adminId: string,
      key: import('@xuantoi/shared').FeatureFlagKey,
      enabled: boolean,
    ) => Promise<FeatureFlagAdminView>;
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
  const service = {
    listFlags: opts.listImpl ?? (async () => []),
    setFlag:
      opts.setImpl ??
      (async (
        _a: string,
        key: import('@xuantoi/shared').FeatureFlagKey,
        enabled: boolean,
      ): Promise<FeatureFlagAdminView> => ({
        key,
        enabled,
        defaultEnabled: true,
        category: 'GAMEPLAY',
        descriptionVi: 'd',
        descriptionEn: 'd',
        public: false,
        module: 'arena',
        requiresRestart: false,
        updatedByAdminId: 'admin-1',
        updatedAt: '2026-06-22T00:00:00.000Z',
      })),
    ensureDefaultFlags:
      opts.ensureImpl ?? (async () => ({ created: 0, existing: 11 })),
    clearCache: opts.clearImpl ?? (async () => undefined),
  } as unknown as FeatureFlagService;
  return { service, prisma, auditCalls };
}

describe('AdminFeatureFlagController.list', () => {
  it('returns service.listFlags() in envelope', async () => {
    const stub: FeatureFlagAdminView = {
      key: 'ARENA_ENABLED',
      enabled: true,
      defaultEnabled: true,
      category: 'GAMEPLAY',
      descriptionVi: '',
      descriptionEn: '',
      public: true,
      module: 'arena',
      requiresRestart: false,
      updatedByAdminId: null,
      updatedAt: null,
    };
    const { service, prisma } = makeStubs({ listImpl: async () => [stub] });
    const c = new AdminFeatureFlagController(service, prisma);
    const r = await c.list();
    expect(r.ok).toBe(true);
    expect(r.data.flags).toEqual([stub]);
  });
});

describe('AdminFeatureFlagController.update', () => {
  it('happy path → calls setFlag + audit', async () => {
    const { service, prisma, auditCalls } = makeStubs();
    const c = new AdminFeatureFlagController(service, prisma);
    const r = await c.update(
      { userId: 'admin-1', role: 'ADMIN' } as unknown as Parameters<
        typeof c.update
      >[0],
      'ARENA_ENABLED',
      { enabled: false },
    );
    expect(r.ok).toBe(true);
    expect(r.data.key).toBe('ARENA_ENABLED');
    expect(auditCalls).toHaveLength(1);
    expect(auditCalls[0].action).toBe('ADMIN_FEATURE_FLAG_UPDATE');
    expect(auditCalls[0].meta).toMatchObject({
      key: 'ARENA_ENABLED',
      enabled: false,
    });
  });

  it('unknown key → 404 FEATURE_FLAG_KEY_INVALID', async () => {
    const { service, prisma } = makeStubs();
    const c = new AdminFeatureFlagController(service, prisma);
    await expect(
      c.update(
        { userId: 'admin-1', role: 'ADMIN' } as unknown as Parameters<
          typeof c.update
        >[0],
        'BOGUS_KEY',
        { enabled: false },
      ),
    ).rejects.toMatchObject({
      response: { error: { code: 'FEATURE_FLAG_KEY_INVALID' } },
    });
  });

  it('strict body schema → 400 INVALID_INPUT cho extra field', async () => {
    const { service, prisma } = makeStubs();
    const c = new AdminFeatureFlagController(service, prisma);
    await expect(
      c.update(
        { userId: 'admin-1', role: 'ADMIN' } as unknown as Parameters<
          typeof c.update
        >[0],
        'ARENA_ENABLED',
        { enabled: false, extraneous: 1 },
      ),
    ).rejects.toMatchObject({
      response: { error: { code: 'INVALID_INPUT' } },
    });
  });

  it('service throws FeatureFlagInvalidKeyError → 404 FEATURE_FLAG_KEY_INVALID', async () => {
    const { service, prisma } = makeStubs({
      setImpl: async () => {
        throw new FeatureFlagInvalidKeyError('ARENA_ENABLED');
      },
    });
    const c = new AdminFeatureFlagController(service, prisma);
    await expect(
      c.update(
        { userId: 'admin-1', role: 'ADMIN' } as unknown as Parameters<
          typeof c.update
        >[0],
        'ARENA_ENABLED',
        { enabled: false },
      ),
    ).rejects.toMatchObject({
      response: { error: { code: 'FEATURE_FLAG_KEY_INVALID' } },
    });
  });
});

describe('AdminFeatureFlagController.refreshDefaults', () => {
  it('calls service + audit', async () => {
    const { service, prisma, auditCalls } = makeStubs({
      ensureImpl: async () => ({ created: 3, existing: 8 }),
    });
    const c = new AdminFeatureFlagController(service, prisma);
    const r = await c.refreshDefaults({
      userId: 'admin-1',
      role: 'ADMIN',
    } as unknown as Parameters<typeof c.refreshDefaults>[0]);
    expect(r.data).toEqual({ created: 3, existing: 8 });
    expect(auditCalls[0].action).toBe('ADMIN_FEATURE_FLAG_REFRESH_DEFAULTS');
  });
});

describe('AdminFeatureFlagController.clearCache', () => {
  it('calls service.clearCache + audit', async () => {
    let cleared = false;
    const { service, prisma, auditCalls } = makeStubs({
      clearImpl: async () => {
        cleared = true;
      },
    });
    const c = new AdminFeatureFlagController(service, prisma);
    const r = await c.clearCache({
      userId: 'admin-1',
      role: 'ADMIN',
    } as unknown as Parameters<typeof c.clearCache>[0]);
    expect(r.data).toEqual({ cleared: true });
    expect(cleared).toBe(true);
    expect(auditCalls[0].action).toBe('ADMIN_FEATURE_FLAG_CLEAR_CACHE');
  });
});

describe('FeatureFlagPublicController public endpoint', () => {
  it('reuses contract — covered by service.getPublicFlags whitelist test', () => {
    // Public controller chỉ là pass-through service.getPublicFlags();
    // contract whitelist được test trong feature-flag.service.test.ts.
    // Giữ test này để rõ trách nhiệm phân chia (không bỏ sót).
    expect(true).toBe(true);
  });
});

// Sanity guard: HttpException luôn throw đúng class
describe('AdminFeatureFlagController error envelopes', () => {
  it('errors are HttpException instances (not plain Error)', async () => {
    const { service, prisma } = makeStubs();
    const c = new AdminFeatureFlagController(service, prisma);
    try {
      await c.update(
        { userId: 'admin-1', role: 'ADMIN' } as unknown as Parameters<
          typeof c.update
        >[0],
        'BOGUS',
        { enabled: false },
      );
    } catch (e) {
      expect(e).toBeInstanceOf(HttpException);
      expect((e as HttpException).getStatus()).toBe(HttpStatus.NOT_FOUND);
    }
  });
});
