import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PrismaService } from '../../common/prisma.service';
import { LeaderboardService } from './leaderboard.service';
import { TEST_DATABASE_URL, makeUserChar, wipeAll } from '../../test-helpers';

let prisma: PrismaService;
let svc: LeaderboardService;

beforeAll(() => {
  process.env.DATABASE_URL = TEST_DATABASE_URL;
  prisma = new PrismaService();
  svc = new LeaderboardService(prisma);
});

beforeEach(async () => {
  await wipeAll(prisma);
});

describe('LeaderboardService.topByPower', () => {
  it('rỗng khi chưa có character', async () => {
    const rows = await svc.topByPower();
    expect(rows).toEqual([]);
  });

  it('sort theo realm order desc → realmStage desc → power desc', async () => {
    // A: phamnhan stage=1 power=999 (realm thấp nhất, power cao)
    const a = await makeUserChar(prisma, {
      realmKey: 'phamnhan',
      realmStage: 1,
      power: 999,
    });
    // B: luyenkhi stage=1 power=10 (realm cao hơn, power thấp)
    const b = await makeUserChar(prisma, {
      realmKey: 'luyenkhi',
      realmStage: 1,
      power: 10,
    });
    // C: luyenkhi stage=5 power=5 (realm cao + stage cao)
    const c = await makeUserChar(prisma, {
      realmKey: 'luyenkhi',
      realmStage: 5,
      power: 5,
    });
    const rows = await svc.topByPower(10);
    expect(rows.map((r) => r.characterId)).toEqual([
      c.characterId, // luyenkhi stage 5
      b.characterId, // luyenkhi stage 1
      a.characterId, // phamnhan stage 1
    ]);
    expect(rows[0].rank).toBe(1);
    expect(rows[1].rank).toBe(2);
    expect(rows[2].rank).toBe(3);
  });

  it('exclude banned user', async () => {
    const banned = await makeUserChar(prisma, {
      realmKey: 'kim_dan',
      realmStage: 9,
      power: 9999,
    });
    await prisma.user.update({
      where: { id: banned.userId },
      data: { banned: true },
    });
    const ok = await makeUserChar(prisma, {
      realmKey: 'phamnhan',
      realmStage: 1,
      power: 5,
    });
    const rows = await svc.topByPower();
    expect(rows.map((r) => r.characterId)).toEqual([ok.characterId]);
  });

  it('limit clamp: nhập <1 → trả về 1, nhập >100 → cap 100', async () => {
    // Tạo 5 char để test slice
    for (let i = 0; i < 5; i += 1) {
      await makeUserChar(prisma, {
        realmKey: 'phamnhan',
        realmStage: 1,
        power: 10 + i,
      });
    }
    const tiny = await svc.topByPower(0); // → clamp to 1
    expect(tiny).toHaveLength(1);
    const big = await svc.topByPower(200); // → cap 100, only 5 chars exist
    expect(big.length).toBeLessThanOrEqual(100);
    expect(big).toHaveLength(5);
  });

  it('default limit = 50 khi không truyền', async () => {
    const rows = await svc.topByPower();
    expect(rows.length).toBeLessThanOrEqual(50);
  });

  it('row contains expected fields', async () => {
    const fix = await makeUserChar(prisma, {
      realmKey: 'truc_co',
      realmStage: 3,
      power: 250,
    });
    const rows = await svc.topByPower(1);
    expect(rows).toHaveLength(1);
    const r = rows[0];
    expect(r).toMatchObject({
      rank: 1,
      characterId: fix.characterId,
      name: fix.name,
      realmKey: 'truc_co',
      realmStage: 3,
      power: 250,
      sectKey: null,
    });
    expect(typeof r.level).toBe('number');
  });

  it('sectKey populated khi character có sect', async () => {
    const sect = await prisma.sect.upsert({
      where: { name: 'Thanh Vân Môn' },
      create: { name: 'Thanh Vân Môn' },
      update: {},
    });
    const fix = await makeUserChar(prisma, {
      realmKey: 'luyenkhi',
      realmStage: 2,
      power: 50,
      sectId: sect.id,
    });
    const rows = await svc.topByPower(1);
    expect(rows[0].characterId).toBe(fix.characterId);
    expect(rows[0].sectKey).toBe('thanh_van');
  });
});

describe('LeaderboardService.topByTopup', () => {
  it('rỗng khi chưa có topup', async () => {
    await makeUserChar(prisma, { realmKey: 'phamnhan', realmStage: 1 });
    const rows = await svc.topByTopup();
    expect(rows).toEqual([]);
  });

  it('chỉ tính status=APPROVED, sort theo tổng tienNgocAmount desc', async () => {
    const a = await makeUserChar(prisma, { realmKey: 'luyenkhi', realmStage: 1 });
    const b = await makeUserChar(prisma, { realmKey: 'truc_co', realmStage: 1 });
    const c = await makeUserChar(prisma, { realmKey: 'phamnhan', realmStage: 1 });
    // a: APPROVED 100 + 200 = 300
    await prisma.topupOrder.create({
      data: {
        userId: a.userId,
        packageKey: 'p1',
        tienNgocAmount: 100,
        priceVND: 10000,
        transferCode: 'T-A1',
        status: 'APPROVED',
      },
    });
    await prisma.topupOrder.create({
      data: {
        userId: a.userId,
        packageKey: 'p1',
        tienNgocAmount: 200,
        priceVND: 20000,
        transferCode: 'T-A2',
        status: 'APPROVED',
      },
    });
    // b: APPROVED 500 (cao nhất)
    await prisma.topupOrder.create({
      data: {
        userId: b.userId,
        packageKey: 'p2',
        tienNgocAmount: 500,
        priceVND: 50000,
        transferCode: 'T-B1',
        status: 'APPROVED',
      },
    });
    // b: PENDING 9999 (không tính)
    await prisma.topupOrder.create({
      data: {
        userId: b.userId,
        packageKey: 'p2',
        tienNgocAmount: 9999,
        priceVND: 999900,
        transferCode: 'T-B2',
        status: 'PENDING',
      },
    });
    // c: REJECTED 1000 (không tính)
    await prisma.topupOrder.create({
      data: {
        userId: c.userId,
        packageKey: 'p1',
        tienNgocAmount: 1000,
        priceVND: 100000,
        transferCode: 'T-C1',
        status: 'REJECTED',
      },
    });
    const rows = await svc.topByTopup(10);
    expect(rows.map((r) => r.characterId)).toEqual([
      b.characterId, // 500
      a.characterId, // 300
    ]);
    expect(rows[0].rank).toBe(1);
    expect(rows[0].totalTienNgoc).toBe(500);
    expect(rows[1].rank).toBe(2);
    expect(rows[1].totalTienNgoc).toBe(300);
  });

  it('exclude banned user', async () => {
    const banned = await makeUserChar(prisma, { realmKey: 'kim_dan', realmStage: 1 });
    await prisma.user.update({
      where: { id: banned.userId },
      data: { banned: true },
    });
    await prisma.topupOrder.create({
      data: {
        userId: banned.userId,
        packageKey: 'p1',
        tienNgocAmount: 9999,
        priceVND: 999900,
        transferCode: 'T-BAN',
        status: 'APPROVED',
      },
    });
    const ok = await makeUserChar(prisma, { realmKey: 'phamnhan', realmStage: 1 });
    await prisma.topupOrder.create({
      data: {
        userId: ok.userId,
        packageKey: 'p1',
        tienNgocAmount: 50,
        priceVND: 5000,
        transferCode: 'T-OK',
        status: 'APPROVED',
      },
    });
    const rows = await svc.topByTopup();
    expect(rows.map((r) => r.characterId)).toEqual([ok.characterId]);
    expect(rows[0].totalTienNgoc).toBe(50);
  });

  it('skip user không có character', async () => {
    // user không có character
    const orphan = await prisma.user.create({
      data: { email: 'orphan@xt.local', passwordHash: 'x' },
    });
    await prisma.topupOrder.create({
      data: {
        userId: orphan.id,
        packageKey: 'p1',
        tienNgocAmount: 9999,
        priceVND: 999900,
        transferCode: 'T-ORPHAN',
        status: 'APPROVED',
      },
    });
    const ok = await makeUserChar(prisma, { realmKey: 'phamnhan', realmStage: 1 });
    await prisma.topupOrder.create({
      data: {
        userId: ok.userId,
        packageKey: 'p1',
        tienNgocAmount: 10,
        priceVND: 1000,
        transferCode: 'T-OK2',
        status: 'APPROVED',
      },
    });
    const rows = await svc.topByTopup();
    expect(rows).toHaveLength(1);
    expect(rows[0].characterId).toBe(ok.characterId);
  });

  it('limit clamp + default = 50', async () => {
    const small = await svc.topByTopup(0);
    expect(small).toEqual([]);
    const big = await svc.topByTopup(200);
    expect(big.length).toBeLessThanOrEqual(100);
    const def = await svc.topByTopup();
    expect(def.length).toBeLessThanOrEqual(50);
  });

  it('row contains expected fields + sectKey', async () => {
    const sect = await prisma.sect.upsert({
      where: { name: 'Huyền Thuỷ Cung' },
      create: { name: 'Huyền Thuỷ Cung' },
      update: {},
    });
    const a = await makeUserChar(prisma, {
      realmKey: 'truc_co',
      realmStage: 5,
      sectId: sect.id,
    });
    await prisma.topupOrder.create({
      data: {
        userId: a.userId,
        packageKey: 'p1',
        tienNgocAmount: 777,
        priceVND: 77700,
        transferCode: 'T-FIELD',
        status: 'APPROVED',
      },
    });
    const rows = await svc.topByTopup(1);
    expect(rows[0]).toMatchObject({
      rank: 1,
      characterId: a.characterId,
      name: a.name,
      realmKey: 'truc_co',
      realmStage: 5,
      totalTienNgoc: 777,
      sectKey: 'huyen_thuy',
    });
  });
});

describe('LeaderboardService.topBySect', () => {
  it('rỗng khi chưa có sect', async () => {
    const rows = await svc.topBySect();
    expect(rows).toEqual([]);
  });

  it('sort theo treasuryLinhThach desc → level desc → createdAt asc', async () => {
    const s1 = await prisma.sect.upsert({
      where: { name: 'Thanh Vân Môn' },
      create: { name: 'Thanh Vân Môn', level: 1, treasuryLinhThach: 100n },
      update: { level: 1, treasuryLinhThach: 100n },
    });
    const s2 = await prisma.sect.upsert({
      where: { name: 'Huyền Thuỷ Cung' },
      create: { name: 'Huyền Thuỷ Cung', level: 5, treasuryLinhThach: 1000n },
      update: { level: 5, treasuryLinhThach: 1000n },
    });
    const s3 = await prisma.sect.upsert({
      where: { name: 'Tu La Tông' },
      create: { name: 'Tu La Tông', level: 3, treasuryLinhThach: 500n },
      update: { level: 3, treasuryLinhThach: 500n },
    });
    const rows = await svc.topBySect(10);
    expect(rows.map((r) => r.sectId)).toEqual([s2.id, s3.id, s1.id]);
    expect(rows[0].rank).toBe(1);
    expect(rows[0].treasuryLinhThach).toBe('1000');
    expect(rows[0].sectKey).toBe('huyen_thuy');
    expect(rows[1].sectKey).toBe('tu_la');
    expect(rows[2].sectKey).toBe('thanh_van');
  });

  it('memberCount + leaderName populated', async () => {
    const sect = await prisma.sect.upsert({
      where: { name: 'Thanh Vân Môn' },
      create: { name: 'Thanh Vân Môn', treasuryLinhThach: 50n },
      update: { treasuryLinhThach: 50n },
    });
    const leader = await makeUserChar(prisma, { sectId: sect.id });
    await makeUserChar(prisma, { sectId: sect.id });
    await makeUserChar(prisma, { sectId: sect.id });
    await prisma.sect.update({
      where: { id: sect.id },
      data: { leaderId: leader.characterId },
    });
    const rows = await svc.topBySect();
    expect(rows).toHaveLength(1);
    expect(rows[0].memberCount).toBe(3);
    expect(rows[0].leaderName).toBe(leader.name);
  });

  it('sect không có leader → leaderName null', async () => {
    await prisma.sect.upsert({
      where: { name: 'Thanh Vân Môn' },
      create: { name: 'Thanh Vân Môn', treasuryLinhThach: 10n },
      update: { treasuryLinhThach: 10n },
    });
    const rows = await svc.topBySect();
    expect(rows[0].leaderName).toBeNull();
  });

  it('sect tự lập name lạ → sectKey null không crash', async () => {
    await prisma.sect.upsert({
      where: { name: 'Thiên Hỏa Tự (player-created)' },
      create: { name: 'Thiên Hỏa Tự (player-created)', treasuryLinhThach: 0n },
      update: { treasuryLinhThach: 0n },
    });
    const rows = await svc.topBySect();
    expect(rows).toHaveLength(1);
    expect(rows[0].sectKey).toBeNull();
  });

  it('limit clamp', async () => {
    for (let i = 0; i < 5; i += 1) {
      await prisma.sect.create({
        data: { name: `Sect-${i}`, treasuryLinhThach: BigInt(i * 10) },
      });
    }
    const tiny = await svc.topBySect(0);
    expect(tiny).toHaveLength(1);
    const big = await svc.topBySect(200);
    expect(big.length).toBeLessThanOrEqual(100);
    expect(big).toHaveLength(5);
  });

  it('treasuryLinhThach trả về string (BigInt-safe cho JSON)', async () => {
    await prisma.sect.create({
      data: { name: 'Mega', treasuryLinhThach: 9999999999999n },
    });
    const rows = await svc.topBySect();
    expect(typeof rows[0].treasuryLinhThach).toBe('string');
    expect(rows[0].treasuryLinhThach).toBe('9999999999999');
  });
});
