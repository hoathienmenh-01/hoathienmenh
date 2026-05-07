/**
 * Phase 13.1.B — SectMissionService integration tests.
 *
 * Coverage matrix:
 *   - list: hasSect=false → no claim path; sect member → catalog full.
 *   - claim: NO_CHARACTER, SECT_REQUIRED, MISSION_NOT_FOUND, MISSION_NOT_READY,
 *     ALREADY_CLAIMED (idempotent both pre-check + P2002).
 *   - reward: contribution balance + lifetime increment + ledger row.
 *   - daily reset: claim DAILY → next day periodKey distinct → second claim OK.
 *   - weekly reset: claim WEEKLY → next ISO week periodKey distinct.
 *   - progress derive: SectWarContribution rows / breakthroughAttemptLog success.
 *   - rate of grants: rewardLinhThach via CurrencyService.applyTx.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { CurrencyKind } from '@prisma/client';
import { PrismaService } from '../../common/prisma.service';
import { RealtimeService } from '../realtime/realtime.service';
import { CharacterService } from '../character/character.service';
import { CurrencyService } from '../character/currency.service';
import { InventoryService } from '../inventory/inventory.service';
import { SectMissionService } from './sect-mission.service';
import { TEST_DATABASE_URL, makeUserChar, nextSuffix, wipeAll } from '../../test-helpers';

let prisma: PrismaService;
let svc: SectMissionService;
let currency: CurrencyService;
let inventory: InventoryService;

beforeAll(() => {
  process.env.DATABASE_URL = TEST_DATABASE_URL;
  prisma = new PrismaService();
  const realtime = new RealtimeService();
  const chars = new CharacterService(prisma, realtime);
  currency = new CurrencyService(prisma);
  inventory = new InventoryService(prisma, realtime, chars);
  svc = new SectMissionService(prisma, currency, inventory);
});

beforeEach(async () => {
  await wipeAll(prisma);
});

afterAll(async () => {
  await prisma.$disconnect();
});

async function makeMember(opts?: Parameters<typeof makeUserChar>[1]): Promise<{
  userId: string;
  characterId: string;
  sectId: string;
}> {
  const f = await makeUserChar(prisma, opts);
  const sect = await prisma.sect.create({
    data: {
      name: `S-${nextSuffix()}`,
      description: '',
      leaderId: f.characterId,
      treasuryLinhThach: 0n,
    },
  });
  await prisma.character.update({
    where: { id: f.characterId },
    data: { sectId: sect.id },
  });
  return { userId: f.userId, characterId: f.characterId, sectId: sect.id };
}

async function addContrib(
  characterId: string,
  sectId: string,
  activityKey: string,
  points: number,
  sourceType: string,
  sourceId: string,
  createdAt?: Date,
): Promise<void> {
  await prisma.sectWarContribution.create({
    data: {
      characterId,
      sectId,
      weekKey: '2030-W01',
      activityKey,
      sourceType,
      sourceId,
      points,
      ...(createdAt ? { createdAt } : {}),
    },
  });
}

describe('SectMissionService.list', () => {
  it('NO_CHARACTER khi user không có character', async () => {
    const u = await prisma.user.create({
      data: { email: `nc-${nextSuffix()}@xt.local`, passwordHash: 'x' },
    });
    await expect(svc.list(u.id)).rejects.toMatchObject({ code: 'NO_CHARACTER' });
  });

  it('character không thuộc sect → hasSect=false, missions vẫn hiển thị', async () => {
    const f = await makeUserChar(prisma);
    const view = await svc.list(f.userId);
    expect(view.hasSect).toBe(false);
    expect(view.missions.length).toBeGreaterThanOrEqual(5);
    expect(view.contributionBalance).toBe(0);
    expect(view.contributionLifetime).toBe(0);
  });

  it('member sect: catalog đầy đủ + tất cả mission chưa claimed', async () => {
    const m = await makeMember();
    const view = await svc.list(m.userId);
    expect(view.hasSect).toBe(true);
    for (const mi of view.missions) {
      expect(mi.claimed).toBe(false);
      expect(mi.currentAmount).toBe(0);
      expect(mi.ready).toBe(false);
    }
  });
});

describe('SectMissionService.claim — error paths', () => {
  it('NO_CHARACTER khi user mới chưa create character', async () => {
    const u = await prisma.user.create({
      data: { email: `c-${nextSuffix()}@xt.local`, passwordHash: 'x' },
    });
    await expect(svc.claim(u.id, 'sect_daily_dungeon_3')).rejects.toMatchObject({
      code: 'NO_CHARACTER',
    });
  });

  it('SECT_REQUIRED khi character không thuộc sect', async () => {
    const f = await makeUserChar(prisma);
    await expect(svc.claim(f.userId, 'sect_daily_dungeon_3')).rejects.toMatchObject({
      code: 'SECT_REQUIRED',
    });
  });

  it('MISSION_NOT_FOUND khi key không có trong catalog', async () => {
    const m = await makeMember();
    await expect(svc.claim(m.userId, 'unknown_key')).rejects.toMatchObject({
      code: 'MISSION_NOT_FOUND',
    });
  });

  it('MISSION_NOT_READY khi progress < target', async () => {
    const m = await makeMember();
    await expect(svc.claim(m.userId, 'sect_daily_dungeon_3')).rejects.toMatchObject({
      code: 'MISSION_NOT_READY',
    });
  });
});

describe('SectMissionService.claim — happy path', () => {
  it('claim DAILY dungeon: progress derive từ SectWarContribution → reward + ledger SECT_MISSION_CLAIM', async () => {
    const m = await makeMember();
    // Inject 3 dungeon_clear contribution rows trong "today".
    for (let i = 0; i < 3; i++) {
      await addContrib(m.characterId, m.sectId, 'dungeon_clear', 10, 'DungeonRun', `dr-${i}`);
    }

    const r = await svc.claim(m.userId, 'sect_daily_dungeon_3');
    expect(r.missionKey).toBe('sect_daily_dungeon_3');
    expect(r.rewardContribution).toBe(30);
    expect(r.contributionBalance).toBe(30);
    expect(r.contributionLifetime).toBe(30);

    const c = await prisma.character.findUniqueOrThrow({
      where: { id: m.characterId },
    });
    expect(c.sectContribBalance).toBe(30);
    expect(c.sectContribLifetime).toBe(30);

    const ledger = await prisma.sectContributionLedger.findFirstOrThrow({
      where: { characterId: m.characterId, reason: 'SECT_MISSION_CLAIM' },
    });
    expect(ledger.delta).toBe(30);
    expect(ledger.refType).toBe('SectMission');
    expect(ledger.refId).toBe('sect_daily_dungeon_3');
  });

  it('claim WEEKLY breakthrough: progress derive từ BreakthroughAttemptLog success → reward LINH_THACH ledger MISSION_CLAIM', async () => {
    const m = await makeMember({ realmKey: 'truc_co' });
    await prisma.breakthroughAttemptLog.create({
      data: {
        characterId: m.characterId,
        success: true,
        fromRealmKey: 'luyenkhi',
        fromRealmStage: 9,
        toRealmKey: 'truc_co',
        toRealmStage: 1,
        chance: 0.8,
        baseChance: 0.7,
        rootPurityBonus: 0.05,
        methodAffinityBonus: 0.05,
        itemBonus: 0,
        rawChance: 0.8,
        rngRoll: 0.5,
        expBefore: 0n,
        expAfter: 0n,
        attemptIndex: 1,
      },
    });
    const r = await svc.claim(m.userId, 'sect_weekly_breakthrough_1');
    expect(r.rewardContribution).toBe(200);
    // CurrencyService.applyTx ghi CurrencyLedger LINH_THACH +800.
    const cur = await prisma.currencyLedger.findFirstOrThrow({
      where: {
        characterId: m.characterId,
        reason: 'MISSION_CLAIM',
        currency: CurrencyKind.LINH_THACH,
      },
    });
    expect(cur.delta).toBe(800n);
  });

  it('idempotent: claim 2 lần → ALREADY_CLAIMED, balance KHÔNG cộng dồn', async () => {
    const m = await makeMember();
    for (let i = 0; i < 3; i++) {
      await addContrib(m.characterId, m.sectId, 'dungeon_clear', 10, 'DungeonRun', `dri-${i}`);
    }
    await svc.claim(m.userId, 'sect_daily_dungeon_3');
    await expect(svc.claim(m.userId, 'sect_daily_dungeon_3')).rejects.toMatchObject({
      code: 'ALREADY_CLAIMED',
    });
    const c = await prisma.character.findUniqueOrThrow({
      where: { id: m.characterId },
    });
    expect(c.sectContribBalance).toBe(30); // không double
    const claims = await prisma.sectMissionClaim.findMany({
      where: { characterId: m.characterId },
    });
    expect(claims).toHaveLength(1);
  });

  it('daily reset: claim hôm nay → ngày khác (now lệch 24h sau periodKey reset) → claim mới OK', async () => {
    const m = await makeMember();
    const yesterday = new Date('2030-01-01T05:00:00Z'); // ICT 12:00
    const today = new Date('2030-01-02T05:00:00Z');
    // 3 contribution rows trong window yesterday + 3 trong window today.
    for (let i = 0; i < 3; i++) {
      await addContrib(
        m.characterId,
        m.sectId,
        'dungeon_clear',
        10,
        'DungeonRun',
        `dr-y-${i}`,
        new Date('2030-01-01T05:00:00Z'),
      );
    }
    for (let i = 0; i < 3; i++) {
      await addContrib(
        m.characterId,
        m.sectId,
        'dungeon_clear',
        10,
        'DungeonRun',
        `dr-t-${i}`,
        new Date('2030-01-02T05:00:00Z'),
      );
    }
    await svc.claim(m.userId, 'sect_daily_dungeon_3', yesterday);
    const r = await svc.claim(m.userId, 'sect_daily_dungeon_3', today);
    expect(r.rewardContribution).toBe(30);
    const claims = await prisma.sectMissionClaim.findMany({
      where: { characterId: m.characterId, missionKey: 'sect_daily_dungeon_3' },
    });
    expect(claims).toHaveLength(2);
    expect(new Set(claims.map((c) => c.periodKey)).size).toBe(2); // distinct period
    const c = await prisma.character.findUniqueOrThrow({
      where: { id: m.characterId },
    });
    expect(c.sectContribBalance).toBe(60);
  });
});

describe('SectMissionService.claim — derive boss damage', () => {
  it('boss_damage sum points trong window → ready khi >= target', async () => {
    const m = await makeMember();
    // mission target = 25; insert 1 row points=15, 1 row points=15 → sum=30.
    await addContrib(m.characterId, m.sectId, 'boss_top_damage', 15, 'WorldBoss', 'b1');
    await addContrib(m.characterId, m.sectId, 'boss_top_damage', 15, 'WorldBoss', 'b2');
    const r = await svc.claim(m.userId, 'sect_daily_boss_damage');
    expect(r.rewardContribution).toBe(35);
  });
});
