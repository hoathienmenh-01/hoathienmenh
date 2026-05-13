/**
 * Phase 43 — SystemStatusController pure-unit tests.
 *
 * Bypass AdminGuard (guard logic test riêng ở `admin.guard.test.ts`).
 * Cover:
 *   - getStatus passes through service shape.
 *   - listErrors validates limit + severity + filters.
 *   - listErrors rejects invalid input (limit=NaN, severity unknown).
 *   - getError 404 khi không match id.
 *   - lastIntegrityRun returns null when artefact missing.
 */
import { describe, expect, it, vi } from 'vitest';
import { HttpException } from '@nestjs/common';
import { SystemStatusController } from './system-status.controller';
import type {
  SystemErrorListResult,
  SystemIntegrityLastRun,
  SystemStatusService,
  SystemStatusSnapshot,
} from './system-status.service';

function makeSvc(
  overrides: Partial<{
    getStatus: () => Promise<SystemStatusSnapshot>;
    listErrors: () => Promise<SystemErrorListResult>;
    getIntegrityLastRun: () => Promise<SystemIntegrityLastRun | null>;
  }> = {},
): SystemStatusService {
  return {
    getStatus:
      overrides.getStatus ??
      (async () =>
        ({
          status: 'ok',
          serviceName: 'xuantoi-api',
          environment: 'test',
          uptimeSeconds: 5,
          timestamp: new Date().toISOString(),
          version: '0.0.1',
          buildCommit: 'unknown',
          node: process.version,
          checks: {
            api: { status: 'ok' },
            db: { status: 'ok' },
            redis: { status: 'ok' },
          },
          recentErrors: {
            last24h: 0,
            bySeverity: { INFO: 0, WARN: 0, ERROR: 0, FATAL: 0 },
          },
          adminActivity: { last24h: 0 },
          integrity: null,
        }) satisfies SystemStatusSnapshot),
    listErrors:
      overrides.listErrors ??
      (async () => ({ rows: [], total: 0 }) as SystemErrorListResult),
    getIntegrityLastRun:
      overrides.getIntegrityLastRun ?? (async () => null),
  } as unknown as SystemStatusService;
}

describe('Phase 43 — SystemStatusController.getStatus', () => {
  it('wraps service snapshot in {ok, data}', async () => {
    const ctrl = new SystemStatusController(makeSvc());
    const out = await ctrl.getStatus();
    expect(out.ok).toBe(true);
    expect(out.data.serviceName).toBe('xuantoi-api');
    expect(out.data.status).toBe('ok');
  });
});

describe('Phase 43 — SystemStatusController.listErrors', () => {
  it('accepts valid query', async () => {
    const fn = vi.fn(async () => ({ rows: [], total: 0 }) as SystemErrorListResult);
    const ctrl = new SystemStatusController(makeSvc({ listErrors: fn }));
    const out = await ctrl.listErrors({ limit: 50, severity: 'WARN' });
    expect(out.ok).toBe(true);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn.mock.calls[0][0].limit).toBe(50);
    expect(fn.mock.calls[0][0].severity).toBe('WARN');
  });

  it('rejects unknown severity', async () => {
    const ctrl = new SystemStatusController(makeSvc());
    await expect(ctrl.listErrors({ severity: 'NOPE' })).rejects.toBeInstanceOf(
      HttpException,
    );
  });

  it('rejects limit > 100', async () => {
    const ctrl = new SystemStatusController(makeSvc());
    await expect(ctrl.listErrors({ limit: 9999 })).rejects.toBeInstanceOf(
      HttpException,
    );
  });

  it('rejects negative limit', async () => {
    const ctrl = new SystemStatusController(makeSvc());
    await expect(ctrl.listErrors({ limit: -5 })).rejects.toBeInstanceOf(
      HttpException,
    );
  });
});

describe('Phase 43 — SystemStatusController.getError', () => {
  it('returns 404 when id not in recent list', async () => {
    const ctrl = new SystemStatusController(makeSvc());
    await expect(ctrl.getError('unknown-id')).rejects.toMatchObject({
      status: 404,
    });
  });

  it('returns row when id matches', async () => {
    const row = {
      id: 'evt_1',
      type: 'AUTH_RATE_LIMIT',
      severity: 'WARN',
      policy: null,
      userId: null,
      characterId: null,
      createdAt: new Date().toISOString(),
      detailJson: {},
    };
    const ctrl = new SystemStatusController(
      makeSvc({
        listErrors: async () => ({ rows: [row], total: 1 }) as SystemErrorListResult,
      }),
    );
    const out = await ctrl.getError('evt_1');
    expect(out.ok).toBe(true);
    expect(out.data.id).toBe('evt_1');
  });

  it('rejects empty id', async () => {
    const ctrl = new SystemStatusController(makeSvc());
    await expect(ctrl.getError('')).rejects.toBeInstanceOf(HttpException);
  });
});

describe('Phase 43 — SystemStatusController.lastIntegrityRun', () => {
  it('returns null when no artefact', async () => {
    const ctrl = new SystemStatusController(makeSvc());
    const out = await ctrl.lastIntegrityRun();
    expect(out.ok).toBe(true);
    expect(out.data).toBeNull();
  });

  it('passes through artefact when present', async () => {
    const artefact = {
      runAt: '2025-01-15T08:00:00Z',
      status: 'CLEAN',
      scopes: ['currency'],
      issueCount: 0,
      issues: [],
    } as SystemIntegrityLastRun;
    const ctrl = new SystemStatusController(
      makeSvc({ getIntegrityLastRun: async () => artefact }),
    );
    const out = await ctrl.lastIntegrityRun();
    expect(out.data?.status).toBe('CLEAN');
  });
});
