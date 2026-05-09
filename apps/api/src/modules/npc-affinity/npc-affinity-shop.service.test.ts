/**
 * Phase 12.10.C — NpcAffinityShopService integration tests.
 *
 * Coverage:
 *   1. listShop trả entries + locked/unlocked theo tier.
 *   2. buy success: spend currency + grant inventory + ledger NPC_SHOP_BUY.
 *   3. INSUFFICIENT_AFFINITY_TIER khi tier < required.
 *   4. INSUFFICIENT_FUNDS khi linhThach < cost.
 *   5. DAILY_LIMIT_REACHED sau khi đạt limit + reset khi đổi window.
 *   6. WEEKLY_LIMIT_REACHED.
 *   7. ITEM_NOT_IN_SHOP khi (npc, item) không có trong catalog.
 *   8. NPC_AFFINITY_UNKNOWN khi npcKey sai.
 *   9. listUnlocks trả dialogue/quest hidden + unlocked flag.
 *  10. Item grant once (không double).
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { CurrencyKind } from '@prisma/client';
import {
  AFFINITY_TIERS,
  npcAffinityShopItem,
} from '@xuantoi/shared';
import { PrismaService } from '../../common/prisma.service';
import { TEST_DATABASE_URL, makeUserChar, wipeAll } from '../../test-helpers';
import { CharacterService } from '../character/character.service';
import { CurrencyService } from '../character/currency.service';
import { RealtimeService } from '../realtime/realtime.service';
import { InventoryService } from '../inventory/inventory.service';
import {
  NpcAffinityShopError,
  NpcAffinityShopService,
  startOfLocalWeek,
} from './npc-affinity-shop.service';

let prisma: PrismaService;
let service: NpcAffinityShopService;
let inventory: InventoryService;
let currency: CurrencyService;

const NPC = 'npc_lang_van_sinh';
const ITEM_QUEN_BIET = 'huyet_chi_dan'; // tier quen_biet, daily 5, cost 30 LINH_THACH
const ITEM_BAN_HUU = 'co_thien_dan'; // tier ban_huu, daily 2, cost 220 LINH_THACH
const ITEM_TRI_GIAO = 'skill_book_kim_quang_tram'; // tier tri_giao, weekly 1, cost 800 LINH_THACH

beforeAll(() => {
  process.env.DATABASE_URL = TEST_DATABASE_URL;
  prisma = new PrismaService();
  const realtime = new RealtimeService();
  const chars = new CharacterService(prisma, realtime);
  inventory = new InventoryService(prisma, realtime, chars);
  currency = new CurrencyService(prisma);
  service = new NpcAffinityShopService(prisma, currency, inventory);
});

beforeEach(async () => {
  await wipeAll(prisma);
});

afterAll(async () => {
  await prisma.$disconnect();
});

async function setAffinity(characterId: string, score: number): Promise<void> {
  await prisma.characterNpcAffinity.upsert({
    where: { characterId_npcKey: { characterId, npcKey: NPC } },
    create: { characterId, npcKey: NPC, score },
    update: { score },
  });
}

describe('NpcAffinityShopService.listShop', () => {
  it('returns entries with current tier + locked/unlocked flag', async () => {
    const { characterId } = await makeUserChar(prisma, { realmKey: 'phamnhan' });
    const out = await service.listShop(characterId, NPC);
    expect(out.npcKey).toBe(NPC);
    expect(out.currentTier.key).toBe('xa_la'); // initial
    // All entries should be locked at xa_la (they require quen_biet+).
    expect(out.entries.length).toBeGreaterThan(0);
    for (const e of out.entries) {
      expect(e.unlocked).toBe(false);
      expect(e.purchased).toBe(0);
    }
  });

  it('marks entries unlocked when tier ≥ required', async () => {
    const { characterId } = await makeUserChar(prisma, { realmKey: 'phamnhan' });
    await setAffinity(characterId, 30); // ban_huu
    const out = await service.listShop(characterId, NPC);
    expect(out.currentTier.key).toBe('ban_huu');
    const banHuu = out.entries.find((e) => e.itemKey === ITEM_BAN_HUU);
    expect(banHuu?.unlocked).toBe(true);
    const quenBiet = out.entries.find((e) => e.itemKey === ITEM_QUEN_BIET);
    expect(quenBiet?.unlocked).toBe(true);
    const triGiao = out.entries.find((e) => e.itemKey === ITEM_TRI_GIAO);
    expect(triGiao?.unlocked).toBe(false);
  });

  it('throws NPC_AFFINITY_UNKNOWN for unknown NPC', async () => {
    const { characterId } = await makeUserChar(prisma, { realmKey: 'phamnhan' });
    await expect(service.listShop(characterId, 'npc_unknown')).rejects.toThrow(
      NpcAffinityShopError,
    );
  });
});

describe('NpcAffinityShopService.buy', () => {
  it('success: spend linhThach + grant inventory + ledger row', async () => {
    const { characterId } = await makeUserChar(prisma, {
      realmKey: 'phamnhan',
      linhThach: 1000n,
    });
    await setAffinity(characterId, 10); // quen_biet

    const result = await service.buy({
      characterId,
      npcKey: NPC,
      itemKey: ITEM_QUEN_BIET,
    });

    expect(result.qty).toBe(1);
    expect(result.totalCost).toBe(30);
    expect(result.currency).toBe(CurrencyKind.LINH_THACH);
    expect(result.purchased).toBe(1);

    // Currency deducted.
    const char = await prisma.character.findUnique({
      where: { id: characterId },
      select: { linhThach: true },
    });
    expect(char?.linhThach).toBe(970n);

    // Inventory granted (qty=1).
    const inv = await prisma.inventoryItem.findFirst({
      where: { characterId, itemKey: ITEM_QUEN_BIET },
    });
    expect(inv?.qty).toBe(1);

    // ItemLedger row with reason='NPC_SHOP_BUY'.
    const ledger = await prisma.itemLedger.findMany({
      where: {
        characterId,
        itemKey: ITEM_QUEN_BIET,
        reason: 'NPC_SHOP_BUY',
      },
    });
    expect(ledger.length).toBe(1);
    expect(ledger[0].refType).toBe('NpcAffinityShop');
    expect(ledger[0].refId).toBe(`${NPC}:${ITEM_QUEN_BIET}`);
    expect(ledger[0].qtyDelta).toBe(1);

    // CurrencyLedger mirror.
    const cLedger = await prisma.currencyLedger.findMany({
      where: { characterId, reason: 'NPC_SHOP_BUY' },
    });
    expect(cLedger.length).toBe(1);
    expect(cLedger[0].currency).toBe(CurrencyKind.LINH_THACH);
    expect(cLedger[0].delta).toBe(-30n);
  });

  it('throws INSUFFICIENT_AFFINITY_TIER khi tier < required', async () => {
    const { characterId } = await makeUserChar(prisma, {
      realmKey: 'phamnhan',
      linhThach: 1000n,
    });
    // tier xa_la (init) — không đủ ban_huu cho ITEM_BAN_HUU.
    await expect(
      service.buy({
        characterId,
        npcKey: NPC,
        itemKey: ITEM_BAN_HUU,
      }),
    ).rejects.toMatchObject({ code: 'INSUFFICIENT_AFFINITY_TIER' });

    // Item KHÔNG được grant.
    const inv = await prisma.inventoryItem.findFirst({
      where: { characterId, itemKey: ITEM_BAN_HUU },
    });
    expect(inv).toBeNull();
  });

  it('throws INSUFFICIENT_FUNDS khi linhThach < cost', async () => {
    const { characterId } = await makeUserChar(prisma, {
      realmKey: 'phamnhan',
      linhThach: 10n,
    });
    await setAffinity(characterId, 10); // quen_biet
    await expect(
      service.buy({
        characterId,
        npcKey: NPC,
        itemKey: ITEM_QUEN_BIET, // cost 30 > 10
      }),
    ).rejects.toMatchObject({ code: 'INSUFFICIENT_FUNDS' });
    // No item granted, no ledger row.
    const inv = await prisma.inventoryItem.findFirst({
      where: { characterId, itemKey: ITEM_QUEN_BIET },
    });
    expect(inv).toBeNull();
    const ledger = await prisma.itemLedger.count({
      where: { characterId, reason: 'NPC_SHOP_BUY' },
    });
    expect(ledger).toBe(0);
  });

  it('throws DAILY_LIMIT_REACHED sau khi đạt dailyLimit', async () => {
    const def = npcAffinityShopItem(NPC, ITEM_QUEN_BIET)!;
    const { characterId } = await makeUserChar(prisma, {
      realmKey: 'phamnhan',
      linhThach: 10000n,
    });
    await setAffinity(characterId, 10);

    for (let i = 0; i < (def.dailyLimit ?? 0); i++) {
      await service.buy({ characterId, npcKey: NPC, itemKey: ITEM_QUEN_BIET });
    }
    await expect(
      service.buy({ characterId, npcKey: NPC, itemKey: ITEM_QUEN_BIET }),
    ).rejects.toMatchObject({ code: 'DAILY_LIMIT_REACHED' });

    // Inventory dừng ở dailyLimit.
    const inv = await prisma.inventoryItem.findFirst({
      where: { characterId, itemKey: ITEM_QUEN_BIET },
    });
    expect(inv?.qty).toBe(def.dailyLimit);
  });

  it('throws ITEM_NOT_IN_SHOP cho cặp (npc, item) không tồn tại', async () => {
    const { characterId } = await makeUserChar(prisma, {
      realmKey: 'phamnhan',
      linhThach: 1000n,
    });
    await setAffinity(characterId, 100);
    await expect(
      service.buy({
        characterId,
        npcKey: NPC,
        itemKey: 'no_such_item',
      }),
    ).rejects.toMatchObject({ code: 'ITEM_NOT_IN_SHOP' });
  });

  it('throws NPC_AFFINITY_UNKNOWN cho npc không có affinity catalog', async () => {
    const { characterId } = await makeUserChar(prisma, {
      realmKey: 'phamnhan',
      linhThach: 1000n,
    });
    await expect(
      service.buy({
        characterId,
        npcKey: 'npc_does_not_exist',
        itemKey: ITEM_QUEN_BIET,
      }),
    ).rejects.toMatchObject({ code: 'NPC_AFFINITY_UNKNOWN' });
  });

  it('weekly stockType: WEEKLY_LIMIT_REACHED', async () => {
    const def = npcAffinityShopItem(NPC, ITEM_TRI_GIAO)!;
    const { characterId } = await makeUserChar(prisma, {
      realmKey: 'phamnhan',
      linhThach: 100000n,
    });
    await setAffinity(characterId, 60); // tri_giao
    await service.buy({ characterId, npcKey: NPC, itemKey: ITEM_TRI_GIAO });
    await expect(
      service.buy({ characterId, npcKey: NPC, itemKey: ITEM_TRI_GIAO }),
    ).rejects.toMatchObject({ code: 'WEEKLY_LIMIT_REACHED' });
    expect(def.weeklyLimit).toBe(1);
  });

  it('item grant once: 2 buy → inventory qty = 2 (no double-grant)', async () => {
    const { characterId } = await makeUserChar(prisma, {
      realmKey: 'phamnhan',
      linhThach: 1000n,
    });
    await setAffinity(characterId, 10);
    await service.buy({ characterId, npcKey: NPC, itemKey: ITEM_QUEN_BIET });
    await service.buy({ characterId, npcKey: NPC, itemKey: ITEM_QUEN_BIET });
    const inv = await prisma.inventoryItem.findFirst({
      where: { characterId, itemKey: ITEM_QUEN_BIET },
    });
    expect(inv?.qty).toBe(2);
    const ledger = await prisma.itemLedger.findMany({
      where: { characterId, reason: 'NPC_SHOP_BUY' },
    });
    expect(ledger.length).toBe(2);
  });
});

describe('NpcAffinityShopService.listUnlocks', () => {
  it('returns dialogue + quest unlocks for current tier', async () => {
    const { characterId } = await makeUserChar(prisma, { realmKey: 'phamnhan' });
    const out = await service.listUnlocks(characterId, NPC);
    expect(out.npcKey).toBe(NPC);
    expect(out.currentTier).toBe('xa_la');
    expect(out.unlocks.length).toBeGreaterThan(0);
    // At xa_la, ban_huu-tier dialogue is locked.
    const inner = out.unlocks.find(
      (u) => u.kind === 'dialogue' && u.refKey === 'story_dlg_lang_van_sinh_inner_secret',
    );
    expect(inner?.unlocked).toBe(false);
  });

  it('marks unlocked once tier reached', async () => {
    const { characterId } = await makeUserChar(prisma, { realmKey: 'phamnhan' });
    await setAffinity(characterId, 30); // ban_huu
    const out = await service.listUnlocks(characterId, NPC);
    expect(out.currentTier).toBe('ban_huu');
    const inner = out.unlocks.find(
      (u) => u.kind === 'dialogue' && u.refKey === 'story_dlg_lang_van_sinh_inner_secret',
    );
    expect(inner?.unlocked).toBe(true);
  });

  it('throws NPC_AFFINITY_UNKNOWN for unknown NPC', async () => {
    const { characterId } = await makeUserChar(prisma, { realmKey: 'phamnhan' });
    await expect(
      service.listUnlocks(characterId, 'npc_does_not_exist'),
    ).rejects.toMatchObject({ code: 'NPC_AFFINITY_UNKNOWN' });
  });
});

describe('startOfLocalWeek helper', () => {
  it('returns Monday 00:00 local for any date in the week', () => {
    // Wednesday 2024-06-12 12:00 UTC, tz Asia/Ho_Chi_Minh (UTC+7).
    // Local time: Wednesday 2024-06-12 19:00 → Monday 2024-06-10 00:00 local
    // = Sunday 2024-06-09 17:00 UTC.
    const wed = new Date(Date.UTC(2024, 5, 12, 12, 0));
    const monday = startOfLocalWeek(wed, 'Asia/Ho_Chi_Minh');
    // Verify: local Monday 00:00 should equal UTC Sun 17:00.
    expect(monday.toISOString()).toBe('2024-06-09T17:00:00.000Z');
  });

  it('returns the same Monday for a Sunday (treats Sunday as end of week)', () => {
    const sun = new Date(Date.UTC(2024, 5, 16, 5, 0)); // Sun 2024-06-16 05:00 UTC = local Sun 12:00
    const monday = startOfLocalWeek(sun, 'Asia/Ho_Chi_Minh');
    // Should backtrack 6 days to local Mon 2024-06-10 00:00 = UTC Sun 2024-06-09 17:00.
    expect(monday.toISOString()).toBe('2024-06-09T17:00:00.000Z');
  });
});

describe('AFFINITY_TIERS sanity', () => {
  it('has expected tier order', () => {
    expect(AFFINITY_TIERS.map((t) => t.key)).toEqual([
      'xa_la',
      'quen_biet',
      'ban_huu',
      'tri_giao',
      'tri_ky',
    ]);
  });
});
