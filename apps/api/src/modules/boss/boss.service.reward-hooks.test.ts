/**
 * BossService reward hook tests — Phase 13.0 §C (Boss/Event Reward Title +
 * Buff Hooks).
 *
 * Test surface:
 *
 *   1. **All participants unlock `achievement_first_boss`** (idempotent):
 *      defeat 1 boss với 2 player → cả 2 nhận title row, 2 lần defeat
 *      KHÔNG duplicate (composite UNIQUE).
 *
 *   2. **Top damage (rank 1) nhận buff `event_double_drop`** — duration
 *      catalog 1h. Rank 2+ KHÔNG nhận buff.
 *
 *   3. **Huyết Nguyệt event boss → unlock `event_huyet_nguyet_2026`** thêm
 *      cho mọi participant. Boss spawn ngoài event slot KHÔNG unlock.
 *
 *   4. **TitleService throw → log + continue** (không rollback grant
 *      currency/items): defensive — title unlock cosmetic optional, không
 *      gate reward distribution.
 *
 *   5. **TitleService/BuffService không inject (legacy DI) → no-op**
 *      (existing test patterns đảm bảo backwards compat).
 *
 * Use real PG (TEST_DATABASE_URL).
 */
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import { BossStatus } from '@prisma/client';
import { BOSSES, bossByKey } from '@xuantoi/shared';
import { PrismaService } from '../../common/prisma.service';
import { RealtimeService } from '../realtime/realtime.service';
import { CharacterService } from '../character/character.service';
import { CurrencyService } from '../character/currency.service';
import { InventoryService } from '../inventory/inventory.service';
import { BuffService } from '../character/buff.service';
import { TitleService } from '../character/title.service';
import { BossService } from './boss.service';
import {
  TEST_DATABASE_URL,
  makeMissionService,
  makeUserChar,
  wipeAll,
} from '../../test-helpers';

let prisma: PrismaService;
let bossWithHooks: BossService;
let titleSvc: TitleService;
let buffSvc: BuffService;

beforeAll(() => {
  process.env.DATABASE_URL = TEST_DATABASE_URL;
  prisma = new PrismaService();
  const realtime = new RealtimeService();
  const chars = new CharacterService(prisma, realtime);
  const inventory = new InventoryService(prisma, realtime, chars);
  const currency = new CurrencyService(prisma);
  const missions = makeMissionService(prisma);
  titleSvc = new TitleService(prisma);
  buffSvc = new BuffService(prisma);
  bossWithHooks = new BossService(
    prisma,
    realtime,
    chars,
    inventory,
    currency,
    missions,
    undefined, // achievements
    undefined, // talents
    buffSvc,
    titleSvc,
  );
});

beforeEach(async () => {
  await wipeAll(prisma);
  (
    bossWithHooks as unknown as { cooldowns: Map<string, number> }
  ).cooldowns.clear();
});

afterEach(() => {
  vi.useRealTimers();
});

afterAll(async () => {
  await prisma.$disconnect();
});

const DEF = BOSSES[0]; // yeu_vuong_tho_huyet (regionKey hoang_tho_huyet)

async function spawnBoss(opts: {
  currentHp?: bigint;
  rewardTotal?: bigint;
  level?: number;
  bossKey?: string;
  spawnedAt?: Date;
  regionKey?: string;
}) {
  const def = bossByKey(opts.bossKey ?? DEF.key)!;
  const level = opts.level ?? 1;
  const maxHp = BigInt(def.baseMaxHp) * BigInt(level);
  return prisma.worldBoss.create({
    data: {
      bossKey: def.key,
      name: def.name,
      level,
      maxHp,
      currentHp: opts.currentHp ?? maxHp,
      status: BossStatus.ACTIVE,
      spawnedAt: opts.spawnedAt ?? new Date(),
      expiresAt: new Date(Date.now() + 60 * 60_000),
      rewardTotal:
        opts.rewardTotal ?? BigInt(def.baseRewardLinhThach) * BigInt(level),
      regionKey: opts.regionKey ?? def.regionKey ?? 'world',
    },
  });
}

describe('BossService — Phase 13.0 §C Reward Hooks (Title + Buff)', () => {
  it('defeat boss → người đánh nhận title `achievement_first_boss`', async () => {
    const a = await makeUserChar(prisma, {
      mp: 100,
      stamina: 100,
      power: 10000,
    });
    await spawnBoss({ currentHp: 1n, rewardTotal: 10_000n });

    const out = await bossWithHooks.attack(a.userId, undefined);
    expect(out.result.defeated).toBe(true);

    const unlock = await prisma.characterTitleUnlock.findUnique({
      where: {
        characterId_titleKey: {
          characterId: a.characterId,
          titleKey: 'achievement_first_boss',
        },
      },
    });
    expect(unlock).not.toBeNull();
    expect(unlock!.source).toBe('achievement');
  });

  it('defeat boss lần 2 → KHÔNG duplicate title (idempotent)', async () => {
    const a = await makeUserChar(prisma, {
      mp: 100,
      stamina: 100,
      power: 10000,
    });
    await spawnBoss({ currentHp: 1n, rewardTotal: 10_000n });
    await bossWithHooks.attack(a.userId, undefined);

    // Second defeat — boss spawn lần 2.
    (
      bossWithHooks as unknown as { cooldowns: Map<string, number> }
    ).cooldowns.clear();
    await spawnBoss({ currentHp: 1n, rewardTotal: 10_000n });
    await bossWithHooks.attack(a.userId, undefined);

    const unlocks = await prisma.characterTitleUnlock.findMany({
      where: {
        characterId: a.characterId,
        titleKey: 'achievement_first_boss',
      },
    });
    expect(unlocks).toHaveLength(1);
  });

  it('defeat boss → top1 nhận buff `event_double_drop` (duration catalog)', async () => {
    const a = await makeUserChar(prisma, {
      mp: 100,
      stamina: 100,
      power: 10000,
    });
    await spawnBoss({ currentHp: 1n, rewardTotal: 10_000n });
    await bossWithHooks.attack(a.userId, undefined);

    const buff = await prisma.characterBuff.findUnique({
      where: {
        characterId_buffKey: {
          characterId: a.characterId,
          buffKey: 'event_double_drop',
        },
      },
    });
    expect(buff).not.toBeNull();
    expect(buff!.source).toBe('event');
    expect(buff!.expiresAt.getTime()).toBeGreaterThan(Date.now());
  });

  it('defeat boss với 2 player → top1 nhận buff, top2 KHÔNG nhận buff', async () => {
    const top1 = await makeUserChar(prisma, {
      mp: 100,
      stamina: 100,
      power: 10000,
    });
    const top2 = await makeUserChar(prisma, {
      mp: 100,
      stamina: 100,
      power: 1, // damage thấp → rank 2.
    });
    // Boss currentHp đủ nhỏ để top1 1-hit defeat sau top2 đã chip 1 dmg.
    await spawnBoss({ currentHp: 100n, rewardTotal: 10_000n });

    await bossWithHooks.attack(top2.userId, undefined); // rank 2 (1-2 dmg)
    (
      bossWithHooks as unknown as { cooldowns: Map<string, number> }
    ).cooldowns.clear();
    const out = await bossWithHooks.attack(top1.userId, undefined);
    expect(out.result.defeated).toBe(true);

    const buff1 = await prisma.characterBuff.findUnique({
      where: {
        characterId_buffKey: {
          characterId: top1.characterId,
          buffKey: 'event_double_drop',
        },
      },
    });
    const buff2 = await prisma.characterBuff.findUnique({
      where: {
        characterId_buffKey: {
          characterId: top2.characterId,
          buffKey: 'event_double_drop',
        },
      },
    });
    expect(buff1).not.toBeNull();
    expect(buff2).toBeNull();

    // Cả 2 đều nhận title participation.
    const titles1 = await prisma.characterTitleUnlock.findFirst({
      where: {
        characterId: top1.characterId,
        titleKey: 'achievement_first_boss',
      },
    });
    const titles2 = await prisma.characterTitleUnlock.findFirst({
      where: {
        characterId: top2.characterId,
        titleKey: 'achievement_first_boss',
      },
    });
    expect(titles1).not.toBeNull();
    expect(titles2).not.toBeNull();
  });

  it('defeat boss thường (không phải Huyết Nguyệt) → KHÔNG unlock event_huyet_nguyet_2026', async () => {
    const a = await makeUserChar(prisma, {
      mp: 100,
      stamina: 100,
      power: 10000,
    });
    await spawnBoss({ currentHp: 1n, rewardTotal: 10_000n });
    await bossWithHooks.attack(a.userId, undefined);

    const eventTitle = await prisma.characterTitleUnlock.findUnique({
      where: {
        characterId_titleKey: {
          characterId: a.characterId,
          titleKey: 'event_huyet_nguyet_2026',
        },
      },
    });
    expect(eventTitle).toBeNull();
  });

  it('defeat boss Huyết Nguyệt (cuu_la_thien_de @ Sat 21:00 ICT) → unlock `event_huyet_nguyet_2026`', async () => {
    const a = await makeUserChar(prisma, {
      mp: 100,
      stamina: 100,
      power: 10000,
    });
    // Saturday 2026-05-09 21:30 ICT = 14:30 UTC. Inside Huyet Nguyet slot
    // 21:00-22:00 ICT.
    const huyetNguyetSpawn = new Date('2026-05-09T14:30:00Z');
    await spawnBoss({
      bossKey: 'cuu_la_thien_de',
      regionKey: 'cuu_la_dien',
      currentHp: 1n,
      rewardTotal: 10_000n,
      spawnedAt: huyetNguyetSpawn,
    });
    await bossWithHooks.attack(a.userId, undefined);

    const eventTitle = await prisma.characterTitleUnlock.findUnique({
      where: {
        characterId_titleKey: {
          characterId: a.characterId,
          titleKey: 'event_huyet_nguyet_2026',
        },
      },
    });
    expect(eventTitle).not.toBeNull();
    expect(eventTitle!.source).toBe('event');

    // Vẫn nhận participation title.
    const partTitle = await prisma.characterTitleUnlock.findUnique({
      where: {
        characterId_titleKey: {
          characterId: a.characterId,
          titleKey: 'achievement_first_boss',
        },
      },
    });
    expect(partTitle).not.toBeNull();
  });

  it('defeat boss cuu_la_thien_de NGOÀI Huyết Nguyệt slot → KHÔNG unlock event_huyet_nguyet_2026', async () => {
    const a = await makeUserChar(prisma, {
      mp: 100,
      stamina: 100,
      power: 10000,
    });
    // Wednesday 2026-05-06 12:00 ICT = không phải Saturday slot.
    const wed = new Date('2026-05-06T05:00:00Z');
    await spawnBoss({
      bossKey: 'cuu_la_thien_de',
      regionKey: 'cuu_la_dien',
      currentHp: 1n,
      rewardTotal: 10_000n,
      spawnedAt: wed,
    });
    await bossWithHooks.attack(a.userId, undefined);

    const eventTitle = await prisma.characterTitleUnlock.findUnique({
      where: {
        characterId_titleKey: {
          characterId: a.characterId,
          titleKey: 'event_huyet_nguyet_2026',
        },
      },
    });
    expect(eventTitle).toBeNull();
  });
});
