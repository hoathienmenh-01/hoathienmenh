/**
 * Phase 16.1.B — Integration test cho `EconomyRangeReportService`.
 *
 * Cover:
 *   - DB rỗng → tổng 0, bySource empty, top empty.
 *   - Aggregate in/out theo source bucket (market / shop / sect shop /
 *     reforge-enchant / admin grant / topup / liveops / daily login /
 *     dungeon / boss / sect season).
 *   - Top 10 character delta theo |net| linhThach.
 *   - Top giới hạn 10 dù > 10 character có activity.
 *   - generatedAt + latestLedgerCheckRun + anomalySummary inject.
 *   - Range exclude ledger ngoài cửa sổ.
 *   - Unknown reason → bucket OTHER (fail-soft, không crash).
 */
import { CurrencyKind } from '@prisma/client';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { parseEconomyReportRange } from '@xuantoi/shared';
import { PrismaService } from '../../common/prisma.service';
import { TEST_DATABASE_URL, makeUserChar, wipeAll } from '../../test-helpers';
import { EconomyRangeReportService } from './economy-range-report.service';

let prisma: PrismaService;
let svc: EconomyRangeReportService;

beforeAll(() => {
  process.env.DATABASE_URL = TEST_DATABASE_URL;
  prisma = new PrismaService();
  svc = new EconomyRangeReportService(prisma);
});

beforeEach(async () => {
  await wipeAll(prisma);
});

afterAll(async () => {
  await prisma.$disconnect();
});

const NOW = new Date('2026-05-11T05:00:00.000Z');

function range(from = '2026-05-05', to = '2026-05-11') {
  const r = parseEconomyReportRange(from, to, NOW);
  if (!r.ok || !r.range) throw new Error('range invalid');
  return r.range;
}

async function writeLedger(opts: {
  characterId: string;
  delta: bigint | number;
  reason: string;
  currency?: CurrencyKind;
  createdAt?: Date;
}) {
  const delta = typeof opts.delta === 'bigint' ? opts.delta : BigInt(opts.delta);
  await prisma.currencyLedger.create({
    data: {
      characterId: opts.characterId,
      currency: opts.currency ?? CurrencyKind.LINH_THACH,
      delta,
      reason: opts.reason,
      createdAt: opts.createdAt ?? new Date('2026-05-08T00:00:00.000Z'),
    },
  });
}

describe('EconomyRangeReportService.generate', () => {
  it('DB rỗng → tổng 0, bySource empty, top empty', async () => {
    const r = await svc.generate(range());
    expect(r.range.from).toBe('2026-05-05');
    expect(r.range.to).toBe('2026-05-11');
    expect(r.range.days).toBe(7);
    expect(r.totalInLinhThach).toBe('0');
    expect(r.totalOutLinhThach).toBe('0');
    expect(r.totalNetLinhThach).toBe('0');
    expect(r.bySource).toEqual([]);
    expect(r.topCharacterDelta).toEqual([]);
    expect(r.marketVolume).toBe('0');
    expect(r.shopSpend).toBe('0');
    expect(r.sectShopSpend).toBe('0');
    expect(r.reforgeEnchantSpend).toBe('0');
    expect(r.adminGrantTotal).toBe('0');
    expect(r.topupTotal).toBe('0');
    expect(r.liveOpsRewardTotal).toBe('0');
    expect(r.dailyLoginRewardTotal).toBe('0');
    expect(r.dungeonRewardTotal).toBe('0');
    expect(r.bossRewardTotal).toBe('0');
    expect(r.sectSeasonRewardTotal).toBe('0');
    expect(r.anomalySummary.openCount).toBe(0);
    expect(r.latestLedgerCheckRun).toBeNull();
    expect(r.generatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('aggregate in/out theo source bucket', async () => {
    const c = await makeUserChar(prisma, { linhThach: 0n });
    // MARKET: 1000 in (sell), 500 out (buy)
    await writeLedger({ characterId: c.characterId, delta: 1000n, reason: 'MARKET_SELL' });
    await writeLedger({ characterId: c.characterId, delta: -500n, reason: 'MARKET_BUY' });
    // SHOP: 300 out
    await writeLedger({ characterId: c.characterId, delta: -300n, reason: 'SHOP_BUY' });
    // SECT_SHOP: 200 out
    await writeLedger({ characterId: c.characterId, delta: -200n, reason: 'SECT_SHOP_BUY' });
    // REFORGE_ENCHANT: 150 out
    await writeLedger({ characterId: c.characterId, delta: -150n, reason: 'EQUIPMENT_REFORGE' });
    // ADMIN_GRANT: 100k in
    await writeLedger({ characterId: c.characterId, delta: 100000n, reason: 'ADMIN_GRANT' });
    // TOPUP
    await writeLedger({ characterId: c.characterId, delta: 50000n, reason: 'ADMIN_TOPUP_APPROVE' });
    // LIVEOPS reward
    await writeLedger({ characterId: c.characterId, delta: 2000n, reason: 'LIVEOPS_FESTIVAL_GIFT_REWARD' });
    // DAILY_LOGIN
    await writeLedger({ characterId: c.characterId, delta: 500n, reason: 'DAILY_LOGIN' });
    // DUNGEON
    await writeLedger({ characterId: c.characterId, delta: 1500n, reason: 'DUNGEON_RUN_REWARD' });
    // BOSS
    await writeLedger({ characterId: c.characterId, delta: 3000n, reason: 'BOSS_REWARD' });
    // SECT_SEASON
    await writeLedger({ characterId: c.characterId, delta: 800n, reason: 'SECT_SEASON_REWARD' });

    const r = await svc.generate(range());

    // bySource has entries for every reason bucket we wrote (12 sources +
    // possible OTHER bucket for unknown rules — verify subset).
    const bySrc = new Map(r.bySource.map((s) => [s.source, s]));
    expect(bySrc.has('MARKET')).toBe(true);
    expect(bySrc.get('MARKET')?.inLinhThach).toBe('1000');
    expect(bySrc.get('MARKET')?.outLinhThach).toBe('500');
    expect(bySrc.get('MARKET')?.netLinhThach).toBe('500');
    expect(bySrc.get('SHOP')?.outLinhThach).toBe('300');
    expect(bySrc.get('SECT_SHOP')?.outLinhThach).toBe('200');
    expect(bySrc.get('REFORGE_ENCHANT')?.outLinhThach).toBe('150');
    expect(bySrc.get('ADMIN_GRANT')?.inLinhThach).toBe('100000');
    expect(bySrc.get('TOPUP')?.inLinhThach).toBe('50000');
    expect(bySrc.get('LIVEOPS_REWARD')?.inLinhThach).toBe('2000');
    expect(bySrc.get('DAILY_LOGIN')?.inLinhThach).toBe('500');
    expect(bySrc.get('DUNGEON_REWARD')?.inLinhThach).toBe('1500');
    expect(bySrc.get('BOSS_REWARD')?.inLinhThach).toBe('3000');
    expect(bySrc.get('SECT_SEASON_REWARD')?.inLinhThach).toBe('800');

    // High-level category totals.
    expect(r.marketVolume).toBe('1500'); // |in| + |out|
    expect(r.shopSpend).toBe('300');
    expect(r.sectShopSpend).toBe('200');
    expect(r.reforgeEnchantSpend).toBe('150');
    expect(r.adminGrantTotal).toBe('100000');
    expect(r.topupTotal).toBe('50000');
    expect(r.liveOpsRewardTotal).toBe('2000');
    expect(r.dailyLoginRewardTotal).toBe('500');
    expect(r.dungeonRewardTotal).toBe('1500');
    expect(r.bossRewardTotal).toBe('3000');
    expect(r.sectSeasonRewardTotal).toBe('800');
    expect(r.territoryRewardTotal).toBe('0');
  });

  it('top 10 character delta sorted by |net| desc', async () => {
    const charNets: Array<{ id: string; net: bigint }> = [];
    for (let i = 0; i < 12; i += 1) {
      const c = await makeUserChar(prisma, { linhThach: 0n });
      const net = BigInt(1000 * (i + 1));
      await writeLedger({ characterId: c.characterId, delta: net, reason: 'ADMIN_GRANT' });
      charNets.push({ id: c.characterId, net });
    }
    const r = await svc.generate(range());
    expect(r.topCharacterDelta).toHaveLength(10);
    // Top = 12000, then 11000, ...
    expect(r.topCharacterDelta[0]?.netLinhThach).toBe('12000');
    expect(r.topCharacterDelta[9]?.netLinhThach).toBe('3000');
  });

  it('top excludes characters with 0 net but still > 0 transactions', async () => {
    const c = await makeUserChar(prisma, { linhThach: 0n });
    await writeLedger({ characterId: c.characterId, delta: 500n, reason: 'ADMIN_GRANT' });
    await writeLedger({ characterId: c.characterId, delta: -500n, reason: 'SHOP_BUY' });
    const r = await svc.generate(range());
    expect(r.topCharacterDelta).toEqual([]);
  });

  it('range exclude ledger ngoài cửa sổ', async () => {
    const c = await makeUserChar(prisma, { linhThach: 0n });
    // Inside range
    await writeLedger({
      characterId: c.characterId,
      delta: 1000n,
      reason: 'ADMIN_GRANT',
      createdAt: new Date('2026-05-08T00:00:00.000Z'),
    });
    // Outside range (before)
    await writeLedger({
      characterId: c.characterId,
      delta: 9000n,
      reason: 'ADMIN_GRANT',
      createdAt: new Date('2026-05-01T00:00:00.000Z'),
    });
    // Outside range (after)
    await writeLedger({
      characterId: c.characterId,
      delta: 7000n,
      reason: 'ADMIN_GRANT',
      createdAt: new Date('2026-05-12T00:00:00.000Z'),
    });
    const r = await svc.generate(range('2026-05-05', '2026-05-11'));
    expect(r.adminGrantTotal).toBe('1000');
    expect(r.totalInLinhThach).toBe('1000');
  });

  it('unknown reason → bucket OTHER (no crash)', async () => {
    const c = await makeUserChar(prisma, { linhThach: 0n });
    await writeLedger({
      characterId: c.characterId,
      delta: 100n,
      reason: 'UNKNOWN_NEW_REASON_FUTURE',
    });
    const r = await svc.generate(range());
    const other = r.bySource.find((s) => s.source === 'OTHER');
    expect(other).toBeTruthy();
    expect(other?.inLinhThach).toBe('100');
    expect(r.totalInLinhThach).toBe('100');
  });

  it('anomalySummary + latestLedgerCheckRun inject', async () => {
    await prisma.economyAnomaly.create({
      data: {
        source: 'CURRENCY_DELTA_24H',
        severity: 'WARN',
        characterId: null,
        userId: null,
        windowKey: 'wk-1',
        detailsJson: {},
        status: 'OPEN',
      },
    });
    await prisma.economyAnomaly.create({
      data: {
        source: 'CURRENCY_DELTA_24H',
        severity: 'INFO',
        characterId: null,
        userId: null,
        windowKey: 'wk-2',
        detailsJson: {},
        status: 'RESOLVED',
      },
    });
    await prisma.economyLedgerCheckRun.create({
      data: {
        dayBucket: '2026-05-10',
        status: 'OK',
        startedAt: new Date('2026-05-10T01:00:00.000Z'),
        finishedAt: new Date('2026-05-10T01:00:01.000Z'),
        summaryJson: {},
      },
    });

    const r = await svc.generate(range());
    expect(r.anomalySummary.openCount).toBe(1);
    expect(r.anomalySummary.resolvedCount).toBe(1);
    expect(r.anomalySummary.acknowledgedCount).toBe(0);
    expect(r.latestLedgerCheckRun?.dayBucket).toBe('2026-05-10');
    expect(r.latestLedgerCheckRun?.status).toBe('OK');
  });

  it('tienNgoc grants tracked separately', async () => {
    const c = await makeUserChar(prisma, { linhThach: 0n });
    await prisma.currencyLedger.create({
      data: {
        characterId: c.characterId,
        currency: CurrencyKind.TIEN_NGOC,
        delta: 100n,
        reason: 'ADMIN_TOPUP_APPROVE',
        createdAt: new Date('2026-05-08T00:00:00.000Z'),
      },
    });
    const r = await svc.generate(range());
    expect(r.totalInTienNgoc).toBe(100);
    expect(r.totalOutTienNgoc).toBe(0);
    expect(r.totalNetTienNgoc).toBe(100);
    const topup = r.bySource.find((s) => s.source === 'TOPUP');
    expect(topup?.inTienNgoc).toBe(100);
  });
});
