/**
 * Phase 16.3 — AdminGameplayAntiCheatController unit tests.
 *
 * Test pure-unit: instantiate controller trực tiếp, bypass `AdminGuard`
 * (guard logic test riêng ở `admin.guard.test.ts`). Cover:
 *   - getSummary: returns counts.
 *   - runScan: calls service + writes AdminAuditLog.
 *   - listAnomalies: filter validation, severity/status/type/source
 *     normalization, invalid filter ignored.
 *   - ackAnomaly: 200 + audit; not found → 404.
 *   - resolveAnomaly: 200 + audit; not found → 404; note length cap.
 *   - PLAYER role không reach controller (guard layer test riêng).
 */
import { describe, expect, it } from 'vitest';
import { HttpException } from '@nestjs/common';
import type { Request } from 'express';
import { AdminGameplayAntiCheatController } from './admin-gameplay-anticheat.controller';
import type {
  GameplayAntiCheatService,
  GameplayScanSummary,
} from './gameplay-anticheat.service';

type AdminReq = Request & { userId: string; role: 'ADMIN' | 'MOD' | 'PLAYER' };

function makeReq(userId = 'admin1'): AdminReq {
  return {
    userId,
    role: 'ADMIN',
    cookies: {},
  } as unknown as AdminReq;
}

interface AnomalyRow {
  id: string;
  type: string;
  severity: string;
  status: string;
  source: string;
  characterId: string | null;
  userId: string | null;
  windowKey: string;
  detailsJson: unknown;
  createdAt: Date;
  updatedAt: Date;
  acknowledgedAt: Date | null;
  acknowledgedByAdminId: string | null;
  resolvedAt: Date | null;
  resolvedByAdminId: string | null;
  resolutionNote: string | null;
}

interface ControllerStubs {
  scanAll?: GameplayAntiCheatService['scanAll'];
  anomalies?: AnomalyRow[];
  auditCreated?: { count: number; actions: string[] };
}

function makeController(stubs: ControllerStubs = {}): {
  c: AdminGameplayAntiCheatController;
  audit: { count: number; actions: string[] };
  anomalies: AnomalyRow[];
} {
  const audit = stubs.auditCreated ?? { count: 0, actions: [] };
  const anomalies = stubs.anomalies ?? [];

  const scanner = {
    scanAll:
      stubs.scanAll ??
      (async (): Promise<GameplayScanSummary> => ({
        windowKeysByType: {} as never,
        totalCreated: 0,
        totalSkipped: 0,
        totalErrored: 0,
        rules: [],
        scannedAt: '2026-05-15T12:00:00.000Z',
      })),
  } as unknown as GameplayAntiCheatService;

  const prisma = {
    gameplayAnomaly: {
      count: async (args?: { where?: Record<string, unknown> }) => {
        const where = args?.where ?? {};
        return anomalies.filter((a) => {
          for (const [k, v] of Object.entries(where)) {
            if ((a as unknown as Record<string, unknown>)[k] !== v) return false;
          }
          return true;
        }).length;
      },
      findFirst: async (args?: {
        where?: Record<string, unknown>;
        orderBy?: unknown;
        select?: { createdAt?: boolean; resolvedAt?: boolean };
      }) => {
        const where = args?.where ?? {};
        const items = anomalies.filter((a) => {
          for (const [k, v] of Object.entries(where)) {
            if ((a as unknown as Record<string, unknown>)[k] !== v) return false;
          }
          return true;
        });
        if (items.length === 0) return null;
        return items[0];
      },
      findMany: async (args?: {
        where?: Record<string, unknown>;
        take?: number;
      }) => {
        const where = args?.where ?? {};
        return anomalies
          .filter((a) => {
            for (const [k, v] of Object.entries(where)) {
              if (k === 'createdAt') continue; // skip range
              if ((a as unknown as Record<string, unknown>)[k] !== v) return false;
            }
            return true;
          })
          .slice(0, args?.take ?? 50);
      },
      updateMany: async (args: {
        where: { id: string; status?: unknown };
        data: Record<string, unknown>;
      }) => {
        const target = anomalies.find((a) => a.id === args.where.id);
        if (!target) return { count: 0 };
        const expected = args.where.status;
        if (
          expected &&
          typeof expected === 'object' &&
          'in' in (expected as Record<string, unknown>)
        ) {
          const allowed = (expected as { in: string[] }).in;
          if (!allowed.includes(target.status)) return { count: 0 };
        } else if (typeof expected === 'string' && target.status !== expected) {
          return { count: 0 };
        }
        Object.assign(target, args.data);
        return { count: 1 };
      },
    },
    adminAuditLog: {
      create: async (input: { data: { action: string } }) => {
        audit.count++;
        audit.actions.push(input.data.action);
        return {};
      },
    },
  } as unknown as ConstructorParameters<typeof AdminGameplayAntiCheatController>[0];

  return {
    c: new AdminGameplayAntiCheatController(prisma, scanner),
    audit,
    anomalies,
  };
}

function makeAnomaly(overrides: Partial<AnomalyRow> = {}): AnomalyRow {
  return {
    id: overrides.id ?? 'a1',
    type: 'CURRENCY_GAIN_SPIKE',
    severity: 'WARN',
    status: 'OPEN',
    source: 'CURRENCY_LEDGER',
    characterId: 'c1',
    userId: null,
    windowKey: '1h:2026-05-15T12',
    detailsJson: {},
    createdAt: new Date('2026-05-15T12:00:00.000Z'),
    updatedAt: new Date('2026-05-15T12:00:00.000Z'),
    acknowledgedAt: null,
    acknowledgedByAdminId: null,
    resolvedAt: null,
    resolvedByAdminId: null,
    resolutionNote: null,
    ...overrides,
  };
}

describe('AdminGameplayAntiCheatController.getSummary', () => {
  it('empty DB → all 0', async () => {
    const { c } = makeController();
    const r = await c.getSummary();
    expect(r.ok).toBe(true);
    expect(r.data.openCount).toBe(0);
    expect(r.data.openCriticalCount).toBe(0);
    expect(r.data.openWarnCount).toBe(0);
    expect(r.data.openInfoCount).toBe(0);
    expect(r.data.totalCount).toBe(0);
    expect(r.data.latestCreatedAt).toBeNull();
    expect(r.data.latestResolvedAt).toBeNull();
  });

  it('có anomaly → đếm theo severity', async () => {
    const { c } = makeController({
      anomalies: [
        makeAnomaly({ id: 'a1', status: 'OPEN', severity: 'CRITICAL' }),
        makeAnomaly({ id: 'a2', status: 'OPEN', severity: 'WARN' }),
        makeAnomaly({ id: 'a3', status: 'RESOLVED', severity: 'WARN' }),
      ],
    });
    const r = await c.getSummary();
    expect(r.data.openCount).toBe(2);
    expect(r.data.openCriticalCount).toBe(1);
    expect(r.data.openWarnCount).toBe(1);
    expect(r.data.totalCount).toBe(3);
  });
});

describe('AdminGameplayAntiCheatController.runScan', () => {
  it('ok → gọi scanner + audit row', async () => {
    let scanCallCount = 0;
    const { c, audit } = makeController({
      scanAll: async () => {
        scanCallCount++;
        return {
          windowKeysByType: {} as never,
          totalCreated: 3,
          totalSkipped: 1,
          totalErrored: 0,
          rules: [],
          scannedAt: '2026-05-15T12:00:00.000Z',
        };
      },
    });
    const req = makeReq('admin1');
    const r = await c.runScan(req, {});
    expect(r.ok).toBe(true);
    expect(r.data.totalCreated).toBe(3);
    expect(scanCallCount).toBe(1);
    expect(audit.count).toBe(1);
    expect(audit.actions).toEqual(['ADMIN_ANTICHEAT_GAMEPLAY_SCAN']);
  });

  it('windowKey override pass-through', async () => {
    let receivedKey: string | undefined;
    const { c } = makeController({
      scanAll: async (opts) => {
        receivedKey = opts?.windowKey;
        return {
          windowKeysByType: {} as never,
          totalCreated: 0,
          totalSkipped: 0,
          totalErrored: 0,
          rules: [],
          scannedAt: '2026-05-15T12:00:00.000Z',
        };
      },
    });
    await c.runScan(makeReq(), { windowKey: 'force-test-key' });
    expect(receivedKey).toBe('force-test-key');
  });

  it('body không hợp lệ → 400', async () => {
    const { c } = makeController();
    await expect(
      c.runScan(makeReq(), { windowMs: -100 } as unknown),
    ).rejects.toBeInstanceOf(HttpException);
  });
});

describe('AdminGameplayAntiCheatController.listAnomalies', () => {
  it('filter theo severity hợp lệ', async () => {
    const { c } = makeController({
      anomalies: [
        makeAnomaly({ id: 'a1', severity: 'WARN' }),
        makeAnomaly({ id: 'a2', severity: 'CRITICAL' }),
      ],
    });
    const r = await c.listAnomalies({ severity: 'WARN' });
    expect(r.ok).toBe(true);
    expect(r.data.items.length).toBe(1);
    expect(r.data.items[0].severity).toBe('WARN');
  });

  it('invalid severity → bỏ qua filter (không 500)', async () => {
    const { c } = makeController({
      anomalies: [makeAnomaly({ id: 'a1', severity: 'WARN' })],
    });
    const r = await c.listAnomalies({ severity: 'NONSENSE' });
    expect(r.ok).toBe(true);
    expect(r.data.items.length).toBe(1);
  });

  it('filter theo type', async () => {
    const { c } = makeController({
      anomalies: [
        makeAnomaly({ id: 'a1', type: 'CURRENCY_GAIN_SPIKE' }),
        makeAnomaly({ id: 'a2', type: 'DUNGEON_REWARD_FARM' }),
      ],
    });
    const r = await c.listAnomalies({ type: 'DUNGEON_REWARD_FARM' });
    expect(r.data.items.length).toBe(1);
    expect(r.data.items[0].type).toBe('DUNGEON_REWARD_FARM');
  });

  it('limit clamp tối đa 200', async () => {
    const { c } = makeController({
      anomalies: Array.from({ length: 300 }, (_, i) =>
        makeAnomaly({ id: `a${i}` }),
      ),
    });
    const r = await c.listAnomalies({ limit: 9999 });
    expect(r.data.items.length).toBeLessThanOrEqual(200);
  });

  it('filters enum được return cho FE', async () => {
    const { c } = makeController();
    const r = await c.listAnomalies({});
    expect(r.data.filters.severities).toEqual(
      expect.arrayContaining(['INFO', 'WARN', 'CRITICAL']),
    );
    expect(r.data.filters.statuses).toEqual(
      expect.arrayContaining(['OPEN', 'ACKNOWLEDGED', 'RESOLVED']),
    );
    expect(r.data.filters.types.length).toBeGreaterThanOrEqual(10);
  });
});

describe('AdminGameplayAntiCheatController.ackAnomaly', () => {
  it('OPEN → ACKNOWLEDGED + audit row', async () => {
    const { c, audit, anomalies } = makeController({
      anomalies: [makeAnomaly({ id: 'a1', status: 'OPEN' })],
    });
    const r = await c.ackAnomaly(makeReq('admin1'), 'a1');
    expect(r.ok).toBe(true);
    expect(r.data.status).toBe('ACKNOWLEDGED');
    expect(audit.actions).toEqual(['ADMIN_ANTICHEAT_GAMEPLAY_ACK']);
    expect(anomalies[0].status).toBe('ACKNOWLEDGED');
    expect(anomalies[0].acknowledgedByAdminId).toBe('admin1');
  });

  it('already ACKNOWLEDGED → 404', async () => {
    const { c } = makeController({
      anomalies: [makeAnomaly({ id: 'a1', status: 'ACKNOWLEDGED' })],
    });
    await expect(c.ackAnomaly(makeReq(), 'a1')).rejects.toBeInstanceOf(
      HttpException,
    );
  });

  it('không tồn tại → 404', async () => {
    const { c } = makeController();
    await expect(c.ackAnomaly(makeReq(), 'missing')).rejects.toBeInstanceOf(
      HttpException,
    );
  });
});

describe('AdminGameplayAntiCheatController.resolveAnomaly', () => {
  it('OPEN → RESOLVED + audit', async () => {
    const { c, audit, anomalies } = makeController({
      anomalies: [makeAnomaly({ id: 'a1', status: 'OPEN' })],
    });
    const r = await c.resolveAnomaly(makeReq('admin2'), 'a1', {
      note: 'verified by GM',
    });
    expect(r.ok).toBe(true);
    expect(r.data.status).toBe('RESOLVED');
    expect(audit.actions).toEqual(['ADMIN_ANTICHEAT_GAMEPLAY_RESOLVE']);
    expect(anomalies[0].status).toBe('RESOLVED');
    expect(anomalies[0].resolvedByAdminId).toBe('admin2');
    expect(anomalies[0].resolutionNote).toBe('verified by GM');
  });

  it('ACKNOWLEDGED → RESOLVED OK', async () => {
    const { c, anomalies } = makeController({
      anomalies: [makeAnomaly({ id: 'a1', status: 'ACKNOWLEDGED' })],
    });
    await c.resolveAnomaly(makeReq(), 'a1', {});
    expect(anomalies[0].status).toBe('RESOLVED');
  });

  it('đã RESOLVED → 404', async () => {
    const { c } = makeController({
      anomalies: [makeAnomaly({ id: 'a1', status: 'RESOLVED' })],
    });
    await expect(
      c.resolveAnomaly(makeReq(), 'a1', {}),
    ).rejects.toBeInstanceOf(HttpException);
  });

  it('note vượt 1000 char → 400', async () => {
    const { c } = makeController({
      anomalies: [makeAnomaly({ id: 'a1', status: 'OPEN' })],
    });
    await expect(
      c.resolveAnomaly(makeReq(), 'a1', { note: 'x'.repeat(1001) }),
    ).rejects.toBeInstanceOf(HttpException);
  });
});
