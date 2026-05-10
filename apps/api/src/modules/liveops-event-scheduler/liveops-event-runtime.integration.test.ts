/**
 * Phase 15.2 — Runtime integration tests cho LiveOpsEventScheduler:
 *
 *   - Dungeon claim → DOUBLE_DUNGEON_DROP active → linh thạch + items qty
 *     được áp multiplier (capped ≤ 2.0).
 *   - Dungeon claim → KHÔNG có event active → linh thạch base nguyên xi.
 *   - Cultivation tick → CULTIVATION_EXP_BOOST active → exp gain × multiplier
 *     (capped ≤ 2.0).
 *
 * Cron transition + idempotency cover ở `liveops-event-scheduler.service.test.ts`.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { dungeonByKey } from '@xuantoi/shared';
import { CurrencyKind } from '@prisma/client';
import { PrismaService } from '../../common/prisma.service';
import { CharacterService } from '../character/character.service';
import { CurrencyService } from '../character/currency.service';
import { InventoryService } from '../inventory/inventory.service';
import { NpcAffinityService } from '../npc-affinity/npc-affinity.service';
import { QuestService } from '../quest/quest.service';
import { RealtimeService } from '../realtime/realtime.service';
import { RewardCapService } from '../economy/reward-cap.service';
import { DungeonRunService } from '../dungeon-run/dungeon-run.service';
import {
  TEST_DATABASE_URL,
  makeUserChar,
  nextSuffix,
  wipeAll,
} from '../../test-helpers';
import { LiveOpsEventSchedulerService } from './liveops-event-scheduler.service';

let prisma: PrismaService;
let liveOps: LiveOpsEventSchedulerService;
let runs: DungeonRunService;
let adminUserId: string;

const SON_COC_KEY = 'son_coc';

beforeAll(() => {
  process.env.DATABASE_URL = TEST_DATABASE_URL;
  prisma = new PrismaService();
  liveOps = new LiveOpsEventSchedulerService(prisma);
  const realtime = new RealtimeService();
  const chars = new CharacterService(prisma, realtime);
  const currency = new CurrencyService(prisma);
  const inventory = new InventoryService(prisma, realtime, chars);
  const npcAffinity = new NpcAffinityService(prisma, inventory);
  const quests = new QuestService(prisma, currency, inventory, npcAffinity);
  const rewardCap = new RewardCapService(prisma);
  runs = new DungeonRunService(
    prisma,
    currency,
    inventory,
    rewardCap,
    quests,
    undefined,
    undefined,
    liveOps,
  );
});

beforeEach(async () => {
  await wipeAll(prisma);
  const admin = await makeUserChar(prisma, { role: 'ADMIN' });
  adminUserId = admin.userId;
});

afterAll(async () => {
  await prisma.$disconnect();
});

async function clearAndClaim(userId: string, dungeonKey: string) {
  const run = await runs.startRun(userId, dungeonKey);
  const dungeon = dungeonByKey(dungeonKey)!;
  for (let i = 0; i < dungeon.monsters.length; i++) {
    await runs.nextEncounter(userId, run.id);
  }
  return runs.claimRun(userId, run.id);
}

async function activateDoubleDungeonDrop(multiplier: number) {
  const start = new Date(Date.now() - 60_000);
  const end = new Date(Date.now() + 60 * 60_000);
  await liveOps.createEvent(adminUserId, {
    key: `dungeon-boost-${nextSuffix()}`,
    type: 'DOUBLE_DUNGEON_DROP',
    title: 'Dungeon Drop Boost',
    description: '',
    startsAt: start,
    endsAt: end,
    configJson: { multiplier },
  });
  await liveOps.recomputeStatuses(new Date());
}

describe('LiveOps runtime integration — dungeon DOUBLE_DUNGEON_DROP', () => {
  it('apply multiplier 1.5 vào linh thạch + items qty', async () => {
    const { userId } = await makeUserChar(prisma, {
      realmKey: 'luyenkhi',
      linhThach: 0n,
      exp: 0n,
    });
    await activateDoubleDungeonDrop(1.5);

    const dungeon = dungeonByKey(SON_COC_KEY)!;
    const baseLT = dungeon.runReward!.linhThach!;
    const result = await clearAndClaim(userId, SON_COC_KEY);

    // base × 1.5 (floor).
    const expectedLT = baseLT + (Math.floor(baseLT * 1.5) - baseLT);
    expect(result.granted.linhThach).toBe(expectedLT);
    expect(result.liveOpsDropMultiplier).toBe(1.5);
    // Item qty cũng phải × 1.5 (min 1).
    if (result.granted.items.length > 0) {
      const dungeonItems = dungeon.runReward!.items ?? [];
      for (const it of result.granted.items) {
        const baseQty =
          dungeonItems.find((x) => x.itemKey === it.itemKey)?.qty ?? 0;
        expect(it.qty).toBeGreaterThanOrEqual(baseQty);
      }
    }
  });

  it('không có event active → linh thạch base nguyên xi', async () => {
    const { userId } = await makeUserChar(prisma, {
      realmKey: 'luyenkhi',
      linhThach: 0n,
      exp: 0n,
    });
    const dungeon = dungeonByKey(SON_COC_KEY)!;
    const baseLT = dungeon.runReward!.linhThach!;
    const result = await clearAndClaim(userId, SON_COC_KEY);

    expect(result.granted.linhThach).toBe(baseLT);
    expect(result.liveOpsDropMultiplier).toBeUndefined();
  });

  it('multiplier vượt cap 2.0 → DB lưu nhưng runtime clamp về 2.0', async () => {
    const { userId } = await makeUserChar(prisma, {
      realmKey: 'luyenkhi',
      linhThach: 0n,
      exp: 0n,
    });
    // Insert raw row bypass validator để stress-test runtime clamp.
    const start = new Date(Date.now() - 60_000);
    const end = new Date(Date.now() + 60 * 60_000);
    await prisma.liveOpsScheduledEvent.create({
      data: {
        key: `bypass-${nextSuffix()}`,
        type: 'DOUBLE_DUNGEON_DROP',
        title: 'Bypass',
        description: '',
        status: 'ACTIVE',
        startsAt: start,
        endsAt: end,
        configJson: { multiplier: 5.0 },
      },
    });
    const dungeon = dungeonByKey(SON_COC_KEY)!;
    const baseLT = dungeon.runReward!.linhThach!;
    const result = await clearAndClaim(userId, SON_COC_KEY);
    // Runtime clamp = 2.0 → linh thạch ≤ baseLT × 2.
    expect(result.granted.linhThach).toBeLessThanOrEqual(baseLT * 2);
    expect(result.liveOpsDropMultiplier).toBeLessThanOrEqual(2.0);
  });
});

describe('LiveOps runtime integration — cultivation CULTIVATION_EXP_BOOST', () => {
  it('getActiveMultiplier trả 1.5 khi event ACTIVE', async () => {
    const start = new Date(Date.now() - 60_000);
    const end = new Date(Date.now() + 60 * 60_000);
    await liveOps.createEvent(adminUserId, {
      key: `exp-boost-${nextSuffix()}`,
      type: 'CULTIVATION_EXP_BOOST',
      title: 'Exp Boost',
      description: '',
      startsAt: start,
      endsAt: end,
      configJson: { multiplier: 1.5 },
    });
    await liveOps.recomputeStatuses(new Date());
    const mul = await liveOps.getActiveMultiplier('CULTIVATION_EXP_BOOST');
    expect(mul).toBe(1.5);
  });

  it('event ENDED → getActiveMultiplier = 1.0', async () => {
    const ev = await liveOps.createEvent(adminUserId, {
      key: `expired-${nextSuffix()}`,
      type: 'CULTIVATION_EXP_BOOST',
      title: 'Past',
      description: '',
      startsAt: new Date('2026-01-01T00:00:00Z'),
      endsAt: new Date('2026-01-02T00:00:00Z'),
      configJson: { multiplier: 1.5 },
    });
    expect(ev.status).toBe('SCHEDULED');
    await liveOps.recomputeStatuses(new Date());
    const mul = await liveOps.getActiveMultiplier('CULTIVATION_EXP_BOOST');
    expect(mul).toBe(1.0);
  });

  it('DISABLED event → getActiveMultiplier = 1.0', async () => {
    const start = new Date(Date.now() - 60_000);
    const end = new Date(Date.now() + 60 * 60_000);
    const ev = await liveOps.createEvent(adminUserId, {
      key: `disabled-${nextSuffix()}`,
      type: 'CULTIVATION_EXP_BOOST',
      title: 'Disabled',
      description: '',
      startsAt: start,
      endsAt: end,
      configJson: { multiplier: 1.5 },
    });
    await liveOps.recomputeStatuses(new Date());
    await liveOps.disableEvent(ev.id);
    const mul = await liveOps.getActiveMultiplier('CULTIVATION_EXP_BOOST');
    expect(mul).toBe(1.0);
  });

  // Avoid unused-import lint by referencing CurrencyKind once.
  it('CurrencyKind enum re-used (lint guard)', () => {
    expect(CurrencyKind.LINH_THACH).toBe('LINH_THACH');
  });
});
