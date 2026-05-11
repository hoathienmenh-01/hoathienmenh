/**
 * Phase 16.4 — AdminMarketAbuseController unit tests.
 *
 * Test pure-unit: instantiate controller trực tiếp, bypass `AdminGuard`
 * (guard logic test riêng ở `admin.guard.test.ts`). Cover:
 *   - getSummary: returns counts.
 *   - runScan: calls service + writes AdminAuditLog `ADMIN_MARKET_ABUSE_SCAN`.
 *   - listAnomalies: filter validation normalization.
 *   - ackAnomaly: 200 + audit `ADMIN_MARKET_ABUSE_ACK`; not found → 404.
 *   - resolveAnomaly: 200 + audit `ADMIN_MARKET_ABUSE_RESOLVE`; not
 *     found → 404; note length cap.
 *   - invalid body / id → 400 INVALID_INPUT.
 *
 * PLAYER role không reach controller (guard layer test riêng).
 */
import { describe, expect, it } from 'vitest';
import { HttpException } from '@nestjs/common';
import type { Request } from 'express';
import { AdminMarketAbuseController } from './admin-market-abuse.controller';
import type {
  MarketScanSummary,
  MarketTradeAbuseService,
} from './market-trade-abuse.service';

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
  listingId: string;
  sellerCharacterId: string | null;
  buyerCharacterId: string | null;
  itemKey: string | null;
  quantity: number | null;
  unitPrice: bigint | null;
  referencePrice: bigint | null;
  deviationRatio: number | null;
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
  scanAll?: MarketTradeAbuseService['scanAll'];
  summary?: MarketTradeAbuseService['summary'];
  anomalies?: AnomalyRow[];
}

function makeController(stubs: ControllerStubs = {}): {
  c: AdminMarketAbuseController;
  audit: { count: number; actions: string[]; metas: unknown[] };
  anomalies: AnomalyRow[];
} {
  const audit = { count: 0, actions: [] as string[], metas: [] as unknown[] };
  const anomalies = stubs.anomalies ?? [];

  const scanner = {
    scanAll:
      stubs.scanAll ??
      (async (): Promise<MarketScanSummary> => ({
        windowKeysByType: {} as never,
        totalCreated: 0,
        totalSkipped: 0,
        totalErrored: 0,
        rules: [],
        scannedAt: '2026-08-01T12:00:00.000Z',
      })),
    summary:
      stubs.summary ??
      (async () => ({
        openCount: anomalies.filter((a) => a.status === 'OPEN').length,
        openCriticalCount: anomalies.filter(
          (a) => a.status === 'OPEN' && a.severity === 'CRITICAL',
        ).length,
        openWarnCount: anomalies.filter(
          (a) => a.status === 'OPEN' && a.severity === 'WARN',
        ).length,
        openInfoCount: anomalies.filter(
          (a) => a.status === 'OPEN' && a.severity === 'INFO',
        ).length,
        totalCount: anomalies.length,
        latestCreatedAt: anomalies.length
          ? anomalies[0].createdAt.toISOString()
          : null,
        latestResolvedAt: null,
      })),
  } as unknown as MarketTradeAbuseService;

  const prisma = {
    marketTradeAnomaly: {
      findMany: async (args?: {
        where?: Record<string, unknown>;
        take?: number;
      }) => {
        const where = args?.where ?? {};
        return anomalies
          .filter((a) => {
            for (const [k, v] of Object.entries(where)) {
              if (k === 'createdAt') continue;
              if ((a as unknown as Record<string, unknown>)[k] !== v) {
                return false;
              }
            }
            return true;
          })
          .slice(0, args?.take ?? 50);
      },
      count: async (args?: { where?: Record<string, unknown> }) => {
        const where = args?.where ?? {};
        return anomalies.filter((a) => {
          for (const [k, v] of Object.entries(where)) {
            if (k === 'createdAt') continue;
            if ((a as unknown as Record<string, unknown>)[k] !== v) {
              return false;
            }
          }
          return true;
        }).length;
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
      create: async (input: {
        data: { action: string; meta?: unknown };
      }) => {
        audit.count += 1;
        audit.actions.push(input.data.action);
        audit.metas.push(input.data.meta);
        return {};
      },
    },
  } as unknown as ConstructorParameters<typeof AdminMarketAbuseController>[0];

  return {
    c: new AdminMarketAbuseController(prisma, scanner),
    audit,
    anomalies,
  };
}

function makeAnomaly(overrides: Partial<AnomalyRow> = {}): AnomalyRow {
  return {
    id: overrides.id ?? 'a1',
    type: 'PRICE_EXTREME_LOW',
    severity: 'WARN',
    status: 'OPEN',
    source: 'SCAN_BATCH',
    listingId: 'l1',
    sellerCharacterId: 'c-seller',
    buyerCharacterId: null,
    itemKey: 'tien_huyen_kiem',
    quantity: 1,
    unitPrice: 1_000n,
    referencePrice: 22_360n,
    deviationRatio: 0.0447,
    windowKey: '1h:2026-08-01T12',
    detailsJson: {},
    createdAt: new Date('2026-08-01T12:00:00.000Z'),
    updatedAt: new Date('2026-08-01T12:00:00.000Z'),
    acknowledgedAt: null,
    acknowledgedByAdminId: null,
    resolvedAt: null,
    resolvedByAdminId: null,
    resolutionNote: null,
    ...overrides,
  };
}

describe('AdminMarketAbuseController.getSummary', () => {
  it('empty DB → all 0', async () => {
    const { c } = makeController();
    const r = await c.getSummary();
    expect(r.ok).toBe(true);
    expect(r.data.openCount).toBe(0);
    expect(r.data.totalCount).toBe(0);
    expect(r.data.latestCreatedAt).toBeNull();
  });

  it('có anomaly → đếm theo severity', async () => {
    const { c } = makeController({
      anomalies: [
        makeAnomaly({ id: 'a1', severity: 'CRITICAL' }),
        makeAnomaly({ id: 'a2', severity: 'WARN' }),
        makeAnomaly({ id: 'a3', severity: 'INFO' }),
      ],
    });
    const r = await c.getSummary();
    expect(r.data.openCriticalCount).toBe(1);
    expect(r.data.openWarnCount).toBe(1);
    expect(r.data.openInfoCount).toBe(1);
    expect(r.data.totalCount).toBe(3);
  });
});

describe('AdminMarketAbuseController.runScan', () => {
  it('scan thành công + audit log ADMIN_MARKET_ABUSE_SCAN', async () => {
    const { c, audit } = makeController();
    const r = await c.runScan(makeReq('adm1'), {});
    expect(r.ok).toBe(true);
    expect(r.data.totalCreated).toBe(0);
    expect(audit.count).toBe(1);
    expect(audit.actions).toContain('ADMIN_MARKET_ABUSE_SCAN');
  });

  it('body invalid → 400 INVALID_INPUT', async () => {
    const { c } = makeController();
    await expect(
      c.runScan(makeReq('adm1'), { windowMs: -1 }),
    ).rejects.toBeInstanceOf(HttpException);
  });

  it('body với windowMs hợp lệ → forward to scanner', async () => {
    let captured: { windowMs?: number } | null = null;
    const { c } = makeController({
      scanAll: async (opts) => {
        captured = opts ?? null;
        return {
          windowKeysByType: {} as never,
          totalCreated: 5,
          totalSkipped: 0,
          totalErrored: 0,
          rules: [],
          scannedAt: '2026-08-01T12:00:00.000Z',
        };
      },
    });
    await c.runScan(makeReq('adm1'), { windowMs: 60 * 60 * 1000 });
    expect(captured).not.toBeNull();
    expect((captured as unknown as { windowMs?: number }).windowMs).toBe(
      3_600_000,
    );
  });
});

describe('AdminMarketAbuseController.listAnomalies', () => {
  it('returns items + filters catalog', async () => {
    const { c } = makeController({
      anomalies: [
        makeAnomaly({ id: 'a1', severity: 'CRITICAL' }),
        makeAnomaly({ id: 'a2', severity: 'WARN' }),
      ],
    });
    const r = await c.listAnomalies({});
    expect(r.ok).toBe(true);
    expect(r.data.items.length).toBe(2);
    expect(r.data.filters.severities).toContain('CRITICAL');
    expect(r.data.filters.types).toContain('PRICE_EXTREME_LOW');
  });

  it('filter severity hợp lệ → lọc', async () => {
    const { c } = makeController({
      anomalies: [
        makeAnomaly({ id: 'a1', severity: 'CRITICAL' }),
        makeAnomaly({ id: 'a2', severity: 'WARN' }),
      ],
    });
    const r = await c.listAnomalies({ severity: 'CRITICAL' });
    expect(r.data.items.length).toBe(1);
    expect(r.data.items[0].id).toBe('a1');
  });

  it('filter severity không hợp lệ → ignored', async () => {
    const { c } = makeController({
      anomalies: [makeAnomaly()],
    });
    const r = await c.listAnomalies({ severity: 'INVALID' });
    expect(r.data.items.length).toBe(1);
  });

  it('itemKey filter hợp lệ', async () => {
    const { c } = makeController({
      anomalies: [
        makeAnomaly({ id: 'a1', itemKey: 'tien_huyen_kiem' }),
        makeAnomaly({ id: 'a2', itemKey: 'huyet_chi_dan' }),
      ],
    });
    const r = await c.listAnomalies({ itemKey: 'tien_huyen_kiem' });
    expect(r.data.items.length).toBe(1);
    expect(r.data.items[0].itemKey).toBe('tien_huyen_kiem');
  });

  it('serialize BigInt → string', async () => {
    const { c } = makeController({
      anomalies: [
        makeAnomaly({ unitPrice: 1_000n, referencePrice: 22_360n }),
      ],
    });
    const r = await c.listAnomalies({});
    expect(r.data.items[0].unitPrice).toBe('1000');
    expect(r.data.items[0].referencePrice).toBe('22360');
  });
});

describe('AdminMarketAbuseController.ackAnomaly', () => {
  it('OPEN → ACKNOWLEDGED + audit', async () => {
    const { c, audit, anomalies } = makeController({
      anomalies: [makeAnomaly({ id: 'a1', status: 'OPEN' })],
    });
    const r = await c.ackAnomaly(makeReq('adm1'), 'a1');
    expect(r.ok).toBe(true);
    expect(r.data.status).toBe('ACKNOWLEDGED');
    expect(anomalies[0].status).toBe('ACKNOWLEDGED');
    expect(anomalies[0].acknowledgedByAdminId).toBe('adm1');
    expect(audit.actions).toContain('ADMIN_MARKET_ABUSE_ACK');
  });

  it('already ACKNOWLEDGED → 404 ANOMALY_NOT_FOUND_OR_NOT_OPEN', async () => {
    const { c } = makeController({
      anomalies: [makeAnomaly({ id: 'a1', status: 'ACKNOWLEDGED' })],
    });
    await expect(c.ackAnomaly(makeReq('adm1'), 'a1')).rejects.toBeInstanceOf(
      HttpException,
    );
  });

  it('id empty → 400', async () => {
    const { c } = makeController();
    await expect(c.ackAnomaly(makeReq('adm1'), '')).rejects.toBeInstanceOf(
      HttpException,
    );
  });
});

describe('AdminMarketAbuseController.resolveAnomaly', () => {
  it('OPEN → RESOLVED + audit + note ghi nhớ', async () => {
    const { c, audit, anomalies } = makeController({
      anomalies: [makeAnomaly({ id: 'a1', status: 'OPEN' })],
    });
    const r = await c.resolveAnomaly(makeReq('adm1'), 'a1', {
      note: 'False positive — admin grant test event',
    });
    expect(r.ok).toBe(true);
    expect(r.data.status).toBe('RESOLVED');
    expect(anomalies[0].status).toBe('RESOLVED');
    expect(anomalies[0].resolutionNote).toContain('False positive');
    expect(audit.actions).toContain('ADMIN_MARKET_ABUSE_RESOLVE');
  });

  it('ACKNOWLEDGED → RESOLVED', async () => {
    const { c, anomalies } = makeController({
      anomalies: [makeAnomaly({ id: 'a1', status: 'ACKNOWLEDGED' })],
    });
    const r = await c.resolveAnomaly(makeReq('adm1'), 'a1', {});
    expect(r.ok).toBe(true);
    expect(anomalies[0].status).toBe('RESOLVED');
  });

  it('already RESOLVED → 404', async () => {
    const { c } = makeController({
      anomalies: [makeAnomaly({ id: 'a1', status: 'RESOLVED' })],
    });
    await expect(
      c.resolveAnomaly(makeReq('adm1'), 'a1', {}),
    ).rejects.toBeInstanceOf(HttpException);
  });

  it('note dài quá 1000 char → 400', async () => {
    const { c } = makeController({
      anomalies: [makeAnomaly({ id: 'a1', status: 'OPEN' })],
    });
    await expect(
      c.resolveAnomaly(makeReq('adm1'), 'a1', { note: 'x'.repeat(1001) }),
    ).rejects.toBeInstanceOf(HttpException);
  });

  it('id quá dài → 400', async () => {
    const { c } = makeController();
    await expect(
      c.resolveAnomaly(makeReq('adm1'), 'x'.repeat(100), {}),
    ).rejects.toBeInstanceOf(HttpException);
  });
});
