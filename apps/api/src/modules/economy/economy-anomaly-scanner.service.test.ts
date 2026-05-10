/**
 * Phase 16.6 — Integration test cho EconomyAnomalyScannerService.
 *
 * Bao phủ:
 *   - clean state → 0 anomaly created.
 *   - currency delta 24h vượt threshold → tạo anomaly.
 *   - admin grant over-limit (real-time hook) → tạo anomaly với severity.
 *   - idempotent windowKey: 2 lần scan cùng window không double anomaly.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { CurrencyKind } from '@prisma/client';
import { PrismaService } from '../../common/prisma.service';
import { TEST_DATABASE_URL, makeUserChar, wipeAll } from '../../test-helpers';
import { EconomyAnomalyScannerService } from './economy-anomaly-scanner.service';

let prisma: PrismaService;
let svc: EconomyAnomalyScannerService;

beforeAll(() => {
  process.env.DATABASE_URL = TEST_DATABASE_URL;
  prisma = new PrismaService();
  svc = new EconomyAnomalyScannerService(prisma);
});

beforeEach(async () => {
  await wipeAll(prisma);
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('EconomyAnomalyScannerService.scanAll', () => {
  it('clean state (no ledger) → 0 anomalies', async () => {
    const r = await svc.scanAll({
      now: new Date('2026-01-01T01:00:00.000Z'),
    });
    expect(r.totalAnomaliesCreated).toBe(0);
    expect(r.windowKey).toBeTruthy();
  });

  it('currency delta 24h ≥ WARN threshold (1M) → tạo anomaly CURRENCY_DELTA_24H', async () => {
    const f = await makeUserChar(prisma);
    // Tạo 1 row CurrencyLedger delta = 2_000_000n (giữa WARN 1M và
    // CRITICAL 5M).
    await prisma.currencyLedger.create({
      data: {
        characterId: f.characterId,
        currency: CurrencyKind.LINH_THACH,
        delta: 2_000_000n,
        reason: 'TEST_INFLATE',
        refType: 'Test',
        refId: 't1',
      },
    });

    const r = await svc.scanAll({
      now: new Date('2026-01-02T01:00:00.000Z'),
    });
    expect(r.totalAnomaliesCreated).toBeGreaterThanOrEqual(1);

    const anomalies = await prisma.economyAnomaly.findMany({
      where: { source: 'CURRENCY_DELTA_24H' },
    });
    expect(anomalies.length).toBeGreaterThanOrEqual(1);
    expect(anomalies[0].severity).toBe('WARN');
    expect(anomalies[0].characterId).toBe(f.characterId);
  });

  it('idempotent windowKey: 2 lần scanAll cùng windowKey → run thứ 2 KHÔNG double', async () => {
    const f = await makeUserChar(prisma);
    await prisma.currencyLedger.create({
      data: {
        characterId: f.characterId,
        currency: CurrencyKind.LINH_THACH,
        delta: 2_000_000n,
        reason: 'TEST',
        refType: 'Test',
        refId: 't1',
      },
    });
    const opts = {
      now: new Date('2026-01-03T01:00:00.000Z'),
      windowKey: '2026-01-03',
    };
    const first = await svc.scanAll(opts);
    expect(first.totalAnomaliesCreated).toBeGreaterThanOrEqual(1);

    const second = await svc.scanAll(opts);
    // Skipped >0 vì duplicate UNIQUE constraint catch.
    expect(second.totalAnomaliesSkipped).toBeGreaterThanOrEqual(1);

    const anomalies = await prisma.economyAnomaly.findMany({
      where: { source: 'CURRENCY_DELTA_24H', windowKey: '2026-01-03' },
    });
    // Vẫn chỉ 1 anomaly per character cho windowKey này.
    expect(anomalies.length).toBe(1);
  });
});

describe('EconomyAnomalyScannerService.scanAdminGrantOverLimit (real-time hook)', () => {
  it('grant < WARN threshold → KHÔNG tạo anomaly', async () => {
    const target = await makeUserChar(prisma);
    const r = await svc.scanAdminGrantOverLimit({
      actorUserId: 'admin1',
      targetCharacterId: target.characterId,
      targetUserId: target.userId,
      delta: 50_000n, // dưới WARN 100k
      reason: 'small grant',
    });
    expect(r.created).toBe(false);
    const list = await prisma.economyAnomaly.findMany({
      where: { source: 'ADMIN_GRANT_OVER_LIMIT' },
    });
    expect(list.length).toBe(0);
  });

  it('grant ≥ WARN threshold (100k) → tạo anomaly severity=WARN', async () => {
    const target = await makeUserChar(prisma);
    const r = await svc.scanAdminGrantOverLimit({
      actorUserId: 'admin1',
      targetCharacterId: target.characterId,
      targetUserId: target.userId,
      delta: 200_000n,
      reason: 'medium grant',
    });
    expect(r.created).toBe(true);
    expect(r.severity).toBe('WARN');
    const list = await prisma.economyAnomaly.findMany({
      where: { source: 'ADMIN_GRANT_OVER_LIMIT' },
    });
    expect(list.length).toBe(1);
    expect(list[0].severity).toBe('WARN');
    // userId stored = actorUserId (admin) cho audit trail.
    expect(list[0].userId).toBe('admin1');
    expect(list[0].characterId).toBe(target.characterId);
    // targetUserId nằm trong detailsJson.
    const details = list[0].detailsJson as { targetUserId?: string };
    expect(details.targetUserId).toBe(target.userId);
  });

  it('grant ≥ CRITICAL threshold (1M) → tạo anomaly severity=CRITICAL', async () => {
    const target = await makeUserChar(prisma);
    const r = await svc.scanAdminGrantOverLimit({
      actorUserId: 'admin1',
      targetCharacterId: target.characterId,
      targetUserId: target.userId,
      delta: 5_000_000n,
      reason: 'huge grant',
    });
    expect(r.created).toBe(true);
    expect(r.severity).toBe('CRITICAL');
    const list = await prisma.economyAnomaly.findMany({
      where: { source: 'ADMIN_GRANT_OVER_LIMIT' },
    });
    expect(list[0].severity).toBe('CRITICAL');
  });
});
