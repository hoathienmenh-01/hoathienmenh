/**
 * Phase 14.0.C — TerritoryDecayService integration tests.
 *
 * Cover:
 *   - decay scale điểm theo formula `floor(points * (10000 - bps) / 10000)`.
 *   - idempotency theo `periodKey` — gọi lại trả `skipped: true`.
 *   - validation: `PERIOD_INVALID` và `DECAY_BPS_INVALID`.
 *   - empty DB → no-op nhưng vẫn ghi log (idempotency).
 *   - không có row có points > 0 → no-op.
 *   - decay max bps = 5000 (50%) — không vượt.
 *   - getDecayHistory ordering.
 *   - audit trail: `triggeredBy` ghi đúng + `pointsBefore`/`pointsAfter`
 *     match aggregate.
 */
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from 'vitest';
import {
  TERRITORY_DECAY_DEFAULT_BPS,
  TERRITORY_DECAY_MAX_BPS,
} from '@xuantoi/shared';
import { PrismaService } from '../../common/prisma.service';
import { TerritoryDecayService } from './territory-decay.service';
import { TerritoryError, TerritoryService } from './territory.service';
import { TerritorySettlementService } from './territory-settlement.service';
import {
  TEST_DATABASE_URL,
  makeUserChar,
  nextSuffix,
  wipeAll,
} from '../../test-helpers';

let prisma: PrismaService;
let decay: TerritoryDecayService;
let settlement: TerritorySettlementService;

beforeAll(() => {
  process.env.DATABASE_URL = TEST_DATABASE_URL;
  prisma = new PrismaService();
  settlement = new TerritorySettlementService(prisma);
  // territory service constructed for type-checking but not exercised here.
  void new TerritoryService(prisma, settlement);
  decay = new TerritoryDecayService(prisma);
});

beforeEach(async () => {
  await wipeAll(prisma);
  // Phase 14.0.C — decay log không thuộc Character/Sect FK chain nên
  // wipeAll không xoá; xoá thủ công ở đây để mỗi test bắt đầu sạch.
  await prisma.sectTerritoryDecayLog.deleteMany({});
});

afterAll(async () => {
  await prisma.$disconnect();
});

async function makeSect(leaderId: string | null = null) {
  return prisma.sect.create({
    data: {
      name: `S-${nextSuffix()}`,
      description: 'Test',
      leaderId,
    },
  });
}

async function seedInfluence(args: {
  sectId: string;
  characterId: string;
  regionKey: string;
  sourceId: string;
  points?: number;
}) {
  const points = args.points ?? 8;
  return prisma.sectTerritoryInfluence.create({
    data: {
      regionKey: args.regionKey,
      characterId: args.characterId,
      sectId: args.sectId,
      sourceKey: 'dungeon_clear',
      sourceType: 'DungeonRun',
      sourceId: args.sourceId,
      points,
    },
  });
}

describe('TerritoryDecayService.decay', () => {
  it('PERIOD_INVALID khi periodKey malformed', async () => {
    let err: unknown = null;
    try {
      await decay.decay({ periodKey: 'bad-period', decayBps: 2500 });
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(TerritoryError);
    expect((err as TerritoryError).code).toBe('PERIOD_INVALID');
  });

  it('DECAY_BPS_INVALID khi decayBps = 0', async () => {
    let err: unknown = null;
    try {
      await decay.decay({ periodKey: '2026-W23', decayBps: 0 });
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(TerritoryError);
    expect((err as TerritoryError).code).toBe('DECAY_BPS_INVALID');
  });

  it('DECAY_BPS_INVALID khi decayBps > TERRITORY_DECAY_MAX_BPS', async () => {
    let err: unknown = null;
    try {
      await decay.decay({
        periodKey: '2026-W23',
        decayBps: TERRITORY_DECAY_MAX_BPS + 1,
      });
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(TerritoryError);
    expect((err as TerritoryError).code).toBe('DECAY_BPS_INVALID');
  });

  it('empty DB → no-op nhưng vẫn ghi log (idempotency)', async () => {
    const r = await decay.decay({
      periodKey: '2026-W23',
      decayBps: 2500,
      triggeredBy: 'admin1',
    });
    expect(r.skipped).toBe(false);
    expect(r.rowsAffected).toBe(0);
    expect(r.pointsBefore).toBe(0);
    expect(r.pointsAfter).toBe(0);
    expect(r.delta).toBe(0);

    // Re-call cùng period → skipped: true.
    const r2 = await decay.decay({ periodKey: '2026-W23', decayBps: 2500 });
    expect(r2.skipped).toBe(true);
    expect(r2.rowsAffected).toBe(0);

    const logs = await prisma.sectTerritoryDecayLog.findMany({});
    expect(logs).toHaveLength(1);
    expect(logs[0].triggeredBy).toBe('admin1');
  });

  it('decay 25% (default) trên row 8 pts → 6 pts (floor)', async () => {
    const sect = await makeSect();
    const u = await makeUserChar(prisma, { sectId: sect.id });
    await seedInfluence({
      sectId: sect.id,
      characterId: u.characterId,
      regionKey: 'son_coc',
      sourceId: 'dr-1',
      points: 8,
    });

    const r = await decay.decay({
      periodKey: '2026-W23',
      decayBps: TERRITORY_DECAY_DEFAULT_BPS,
    });
    expect(r.skipped).toBe(false);
    expect(r.rowsAffected).toBe(1);
    expect(r.pointsBefore).toBe(8);
    // 8 * 0.75 = 6.
    expect(r.pointsAfter).toBe(6);
    expect(r.delta).toBe(2);

    const rows = await prisma.sectTerritoryInfluence.findMany({});
    expect(rows[0].points).toBe(6);
  });

  it('idempotency: gọi lại cùng periodKey → skipped + không scale lần 2', async () => {
    const sect = await makeSect();
    const u = await makeUserChar(prisma, { sectId: sect.id });
    await seedInfluence({
      sectId: sect.id,
      characterId: u.characterId,
      regionKey: 'son_coc',
      sourceId: 'dr-1',
      points: 100,
    });

    const r1 = await decay.decay({ periodKey: '2026-W23', decayBps: 2500 });
    expect(r1.skipped).toBe(false);
    expect(r1.pointsAfter).toBe(75); // floor(100 * 0.75)

    const r2 = await decay.decay({ periodKey: '2026-W23', decayBps: 2500 });
    expect(r2.skipped).toBe(true);

    const rows = await prisma.sectTerritoryInfluence.findMany({});
    // Vẫn 75, KHÔNG scale lần 2.
    expect(rows[0].points).toBe(75);
  });

  it('different periodKey → re-apply decay (mỗi period 1 lần)', async () => {
    const sect = await makeSect();
    const u = await makeUserChar(prisma, { sectId: sect.id });
    await seedInfluence({
      sectId: sect.id,
      characterId: u.characterId,
      regionKey: 'son_coc',
      sourceId: 'dr-1',
      points: 100,
    });

    await decay.decay({ periodKey: '2026-W22', decayBps: 2500 });
    // 100 → 75.
    let rows = await prisma.sectTerritoryInfluence.findMany({});
    expect(rows[0].points).toBe(75);

    await decay.decay({ periodKey: '2026-W23', decayBps: 2500 });
    // 75 → floor(75 * 0.75) = 56.
    rows = await prisma.sectTerritoryInfluence.findMany({});
    expect(rows[0].points).toBe(56);
  });

  it('decay = 5000 (max 50%) → đúng 50% không cắt', async () => {
    const sect = await makeSect();
    const u = await makeUserChar(prisma, { sectId: sect.id });
    await seedInfluence({
      sectId: sect.id,
      characterId: u.characterId,
      regionKey: 'son_coc',
      sourceId: 'dr-1',
      points: 200,
    });

    const r = await decay.decay({ periodKey: '2026-W23', decayBps: 5000 });
    expect(r.pointsAfter).toBe(100);
    const rows = await prisma.sectTerritoryInfluence.findMany({});
    expect(rows[0].points).toBe(100);
  });

  it('floor không làm âm điểm', async () => {
    const sect = await makeSect();
    const u = await makeUserChar(prisma, { sectId: sect.id });
    // 1 pt × 25% decay = floor(1 * 0.75) = 0. Floor không âm.
    await seedInfluence({
      sectId: sect.id,
      characterId: u.characterId,
      regionKey: 'son_coc',
      sourceId: 'dr-1',
      points: 1,
    });

    const r = await decay.decay({ periodKey: '2026-W23', decayBps: 2500 });
    expect(r.pointsAfter).toBe(0);
    const rows = await prisma.sectTerritoryInfluence.findMany({});
    expect(rows[0].points).toBe(0);
  });

  it('multi-row aggregate: pointsBefore/After khớp', async () => {
    const sect = await makeSect();
    const u = await makeUserChar(prisma, { sectId: sect.id });
    await seedInfluence({
      sectId: sect.id,
      characterId: u.characterId,
      regionKey: 'son_coc',
      sourceId: 'dr-1',
      points: 12,
    });
    await seedInfluence({
      sectId: sect.id,
      characterId: u.characterId,
      regionKey: 'son_coc',
      sourceId: 'dr-2',
      points: 16,
    });
    await seedInfluence({
      sectId: sect.id,
      characterId: u.characterId,
      regionKey: 'kim_son_mach',
      sourceId: 'dr-3',
      points: 20,
    });

    const r = await decay.decay({ periodKey: '2026-W23', decayBps: 2500 });
    expect(r.rowsAffected).toBe(3);
    expect(r.pointsBefore).toBe(48);
    // floor(12*0.75)=9, floor(16*0.75)=12, floor(20*0.75)=15. Tổng 36.
    expect(r.pointsAfter).toBe(36);
    expect(r.delta).toBe(12);
  });

  it('row có points = 0 → không count rowsAffected', async () => {
    const sect = await makeSect();
    const u = await makeUserChar(prisma, { sectId: sect.id });
    await prisma.sectTerritoryInfluence.create({
      data: {
        regionKey: 'son_coc',
        characterId: u.characterId,
        sectId: sect.id,
        sourceKey: 'dungeon_clear',
        sourceType: 'DungeonRun',
        sourceId: 'dr-zero',
        points: 0,
      },
    });
    await seedInfluence({
      sectId: sect.id,
      characterId: u.characterId,
      regionKey: 'son_coc',
      sourceId: 'dr-1',
      points: 8,
    });

    const r = await decay.decay({ periodKey: '2026-W23', decayBps: 2500 });
    expect(r.rowsAffected).toBe(1); // chỉ row có points > 0.
    expect(r.pointsBefore).toBe(8);
  });

  it('triggeredBy fallback null khi không truyền', async () => {
    const sect = await makeSect();
    const u = await makeUserChar(prisma, { sectId: sect.id });
    await seedInfluence({
      sectId: sect.id,
      characterId: u.characterId,
      regionKey: 'son_coc',
      sourceId: 'dr-1',
      points: 8,
    });

    await decay.decay({ periodKey: '2026-W23', decayBps: 2500 });
    const logs = await prisma.sectTerritoryDecayLog.findMany({});
    expect(logs[0].triggeredBy).toBeNull();
  });

  it('fallback periodKey = previous khi không truyền', async () => {
    const r = await decay.decay({ decayBps: 2500 });
    expect(r.periodKey).toMatch(/^\d{4}-W\d{2}$/);
  });

  it('fallback decayBps = TERRITORY_DECAY_DEFAULT_BPS khi không truyền', async () => {
    const r = await decay.decay({ periodKey: '2026-W23' });
    expect(r.decayBps).toBe(TERRITORY_DECAY_DEFAULT_BPS);
  });
});

describe('TerritoryDecayService.getDecayHistory', () => {
  it('order desc theo triggeredAt', async () => {
    await decay.decay({ periodKey: '2026-W22', decayBps: 2500 });
    await new Promise((r) => setTimeout(r, 10));
    await decay.decay({ periodKey: '2026-W23', decayBps: 5000 });

    const history = await decay.getDecayHistory();
    expect(history).toHaveLength(2);
    expect(history[0].periodKey).toBe('2026-W23');
    expect(history[1].periodKey).toBe('2026-W22');
  });

  it('limit clamp [1..100]', async () => {
    const h0 = await decay.getDecayHistory(0); // → 20 default.
    expect(Array.isArray(h0)).toBe(true);
    const h200 = await decay.getDecayHistory(200);
    expect(Array.isArray(h200)).toBe(true);
    // Empty result OK; chỉ kiểm tra không throw.
  });
});

describe('TerritoryDecayService.computeRowDecay', () => {
  it('forward to shared computeTerritoryDecay()', () => {
    expect(decay.computeRowDecay(100, 2500)).toBe(75);
    expect(decay.computeRowDecay(0, 2500)).toBe(0);
    expect(decay.computeRowDecay(8, 2500)).toBe(6);
  });
});
