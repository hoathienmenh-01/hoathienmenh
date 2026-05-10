/**
 * Phase 15.5 — MaintenanceWindowGuardMiddleware unit tests.
 *
 * Cover:
 *   - no active window → next() called, không 503
 *   - active window + admin cookie + bypass → next()
 *   - active window + player cookie + ALL_PLAYERS → 503 envelope
 *   - service throws → fail-open (next() called)
 *   - cookie thiếu → role=ANONYMOUS, blocked nếu maintenance ACTIVE
 */
import { describe, expect, it, vi } from 'vitest';
import type { Request, Response, NextFunction } from 'express';
import { MAINTENANCE_BLOCK_ERROR_CODE } from '@xuantoi/shared';
import { MaintenanceWindowGuardMiddleware } from './maintenance-window.middleware';
import type { MaintenanceWindowService } from './maintenance-window.service';
import type { AuthService } from '../auth/auth.service';
import type { PrismaService } from '../../common/prisma.service';

function makeReqRes(opts: {
  path: string;
  method?: string;
  cookie?: string;
}) {
  const cookies: Record<string, string | undefined> = opts.cookie
    ? { xt_access: opts.cookie }
    : {};
  const req = {
    path: opts.path,
    originalUrl: opts.path,
    method: opts.method ?? 'GET',
    cookies,
  } as unknown as Request;
  const status = vi.fn(() => res);
  const header = vi.fn(() => res);
  const json = vi.fn(() => res);
  const res = { status, header, json } as unknown as Response;
  const next: NextFunction = vi.fn();
  return { req, res, next, status, header, json };
}

function makeAuth(opts: { userId?: string | null } = {}) {
  return {
    userIdFromAccess: vi.fn(async () => opts.userId ?? null),
  } as unknown as AuthService;
}

function makePrisma(role?: 'ADMIN' | 'MOD' | 'PLAYER', banned = false) {
  return {
    user: {
      findUnique: vi.fn(async () =>
        role ? { role, banned } : null,
      ),
    },
  } as unknown as PrismaService;
}

describe('MaintenanceWindowGuardMiddleware', () => {
  it('no active window → next()', async () => {
    const svc = {
      getActiveWindow: vi.fn(async () => null),
      isMaintenanceActiveForRequest: vi.fn(async () => null),
    } as unknown as MaintenanceWindowService;
    const mw = new MaintenanceWindowGuardMiddleware(svc, makeAuth(), makePrisma());
    const { req, res, next, status, json } = makeReqRes({
      path: '/api/character/me',
    });
    await mw.use(req, res, next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(status).not.toHaveBeenCalled();
    expect(json).not.toHaveBeenCalled();
  });

  it('active window + bypass → next()', async () => {
    const svc = {
      getActiveWindow: vi.fn(async () => ({
        endsAt: new Date('2026-08-01T02:00:00Z'),
      })),
      isMaintenanceActiveForRequest: vi.fn(async () => null),
    } as unknown as MaintenanceWindowService;
    const mw = new MaintenanceWindowGuardMiddleware(
      svc,
      makeAuth({ userId: 'u1' }),
      makePrisma('ADMIN'),
    );
    const { req, res, next } = makeReqRes({
      path: '/api/admin/users',
      method: 'POST',
      cookie: 'xyz',
    });
    await mw.use(req, res, next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(svc.isMaintenanceActiveForRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        role: 'ADMIN',
        path: '/api/admin/users',
        method: 'POST',
      }),
      expect.any(Date),
    );
  });

  it('active window + player blocked → 503 envelope', async () => {
    const svc = {
      getActiveWindow: vi.fn(async () => ({
        endsAt: new Date('2026-08-01T02:00:00Z'),
      })),
      isMaintenanceActiveForRequest: vi.fn(async () => ({
        errorCode: MAINTENANCE_BLOCK_ERROR_CODE,
        payload: {
          code: MAINTENANCE_BLOCK_ERROR_CODE,
          message: 'down',
          meta: {
            severity: 'WARNING',
            target: 'ALL_PLAYERS',
            titleVi: 'Bảo trì',
            titleEn: null,
            messageVi: 'M',
            messageEn: null,
            endsAt: '2026-08-01T02:00:00.000Z',
            serverTime: '2026-08-01T01:00:00.000Z',
          },
        },
      })),
    } as unknown as MaintenanceWindowService;
    const mw = new MaintenanceWindowGuardMiddleware(
      svc,
      makeAuth({ userId: 'u1' }),
      makePrisma('PLAYER'),
    );
    const { req, res, next, status, json } = makeReqRes({
      path: '/api/character/me',
      cookie: 'xyz',
    });
    await mw.use(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(status).toHaveBeenCalledWith(503);
    expect(json).toHaveBeenCalledWith({
      ok: false,
      error: expect.objectContaining({
        code: MAINTENANCE_BLOCK_ERROR_CODE,
      }),
    });
  });

  it('cookie missing → role=ANONYMOUS, blocked', async () => {
    const svc = {
      getActiveWindow: vi.fn(async () => ({
        endsAt: new Date('2026-08-01T02:00:00Z'),
      })),
      isMaintenanceActiveForRequest: vi.fn(async () => ({
        errorCode: MAINTENANCE_BLOCK_ERROR_CODE,
        payload: {
          code: MAINTENANCE_BLOCK_ERROR_CODE,
          message: 'down',
          meta: {
            severity: 'WARNING',
            target: 'ALL_PLAYERS',
            titleVi: 't',
            titleEn: null,
            messageVi: 'm',
            messageEn: null,
            endsAt: '2026-08-01T02:00:00.000Z',
            serverTime: '2026-08-01T01:00:00.000Z',
          },
        },
      })),
    } as unknown as MaintenanceWindowService;
    const auth = makeAuth();
    const mw = new MaintenanceWindowGuardMiddleware(svc, auth, makePrisma());
    const { req, res, next } = makeReqRes({ path: '/api/character/me' });
    await mw.use(req, res, next);
    expect(auth.userIdFromAccess).not.toHaveBeenCalled();
    expect(svc.isMaintenanceActiveForRequest).toHaveBeenCalledWith(
      expect.objectContaining({ role: 'ANONYMOUS' }),
      expect.any(Date),
    );
    expect(next).not.toHaveBeenCalled();
  });

  it('service throws → fail-open (next called)', async () => {
    const svc = {
      getActiveWindow: vi.fn(async () => {
        throw new Error('db down');
      }),
      isMaintenanceActiveForRequest: vi.fn(),
    } as unknown as MaintenanceWindowService;
    const mw = new MaintenanceWindowGuardMiddleware(svc, makeAuth(), makePrisma());
    const { req, res, next, status } = makeReqRes({
      path: '/api/character/me',
    });
    await mw.use(req, res, next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(status).not.toHaveBeenCalled();
  });

  it('banned user → role=ANONYMOUS', async () => {
    const svc = {
      getActiveWindow: vi.fn(async () => ({
        endsAt: new Date('2026-08-01T02:00:00Z'),
      })),
      isMaintenanceActiveForRequest: vi.fn(async () => null),
    } as unknown as MaintenanceWindowService;
    const mw = new MaintenanceWindowGuardMiddleware(
      svc,
      makeAuth({ userId: 'u1' }),
      makePrisma('PLAYER', true),
    );
    const { req, res, next } = makeReqRes({
      path: '/api/character/me',
      cookie: 'xyz',
    });
    await mw.use(req, res, next);
    expect(svc.isMaintenanceActiveForRequest).toHaveBeenCalledWith(
      expect.objectContaining({ role: 'ANONYMOUS' }),
      expect.any(Date),
    );
  });
});
