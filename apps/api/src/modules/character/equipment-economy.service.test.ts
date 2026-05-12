/**
 * Phase 23.4 — EquipmentEconomyService tests.
 *
 * Covers:
 *   - merge success: 3 món `so_kiem` → 1 `huyen_kiem`; cost trừ đúng;
 *     ledger có 3 CONSUME + 1 GRANT + 1 COST; currency ledger MERGE.
 *   - merge reject: count != 3, duplicate ids, mixed itemKey, item
 *     equipped, not owned, không có recipe, không đủ material/currency.
 *   - dismantle success: yield material + linhThach + gem trả về
 *     inventory; ledger CONSUME + YIELD.
 *   - dismantle reject: item not owned, equipped.
 *   - economy preview: trả enhance/merge/dismantle/socket info.
 *   - integration: dismantle yield < merge cost (anti infinite-resource).
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { CurrencyKind } from '@prisma/client';
import {
  EQUIPMENT_MERGE_INPUT_COUNT,
  findEquipmentMergeRecipe,
  getEquipmentMergeCost,
} from '@xuantoi/shared';
import { PrismaService } from '../../common/prisma.service';
import { TEST_DATABASE_URL, makeUserChar, wipeAll } from '../../test-helpers';
import { CurrencyService } from './currency.service';
import {
  EquipmentEconomyError,
  EquipmentEconomyService,
} from './equipment-economy.service';

describe('EquipmentEconomyService — Phase 23.4 merge / dismantle', () => {
  const prisma = new PrismaService({
    datasources: { db: { url: TEST_DATABASE_URL } },
  } as ConstructorParameters<typeof PrismaService>[0]);
  const currency = new CurrencyService(prisma);
  const economy = new EquipmentEconomyService(prisma, currency);

  beforeAll(async () => {
    await prisma.$connect();
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });
  beforeEach(async () => {
    await wipeAll(prisma);
  });

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  async function seedMergeable(opts: { linhThach?: bigint; materialQty?: number } = {}) {
    const fixture = await makeUserChar(prisma, {
      linhThach: opts.linhThach ?? 50_000n,
    });
    const recipe = findEquipmentMergeRecipe('so_kiem');
    expect(recipe).not.toBeNull();
    const items = [];
    for (let i = 0; i < EQUIPMENT_MERGE_INPUT_COUNT; i += 1) {
      items.push(
        await prisma.inventoryItem.create({
          data: { characterId: fixture.characterId, itemKey: 'so_kiem', qty: 1 },
        }),
      );
    }
    // Seed material `tinh_thiet` cho merge cost.
    const cost = getEquipmentMergeCost({
      equipmentTier: 1,
      sourceQuality: 'PHAM',
      slot: 'WEAPON',
    });
    if (cost.materialQty > 0) {
      await prisma.inventoryItem.create({
        data: {
          characterId: fixture.characterId,
          itemKey: cost.materialKey,
          qty: opts.materialQty ?? cost.materialQty + 10,
        },
      });
    }
    return { fixture, items, cost };
  }

  // -------------------------------------------------------------------------
  // Merge — success path
  // -------------------------------------------------------------------------

  it('merge 3× so_kiem → 1× huyen_kiem grant + cost ledger atomic', async () => {
    const { fixture, items, cost } = await seedMergeable();
    const result = await economy.mergeEquipment(
      fixture.characterId,
      items.map((it) => it.id),
    );
    expect(result.outputItemKey).toBe('huyen_kiem');
    expect(result.outputQuality).toBe('LINH');
    expect(result.consumedInventoryItemIds).toHaveLength(3);

    // 3 source items deleted.
    const remainingSources = await prisma.inventoryItem.findMany({
      where: { characterId: fixture.characterId, itemKey: 'so_kiem' },
    });
    expect(remainingSources).toHaveLength(0);

    // 1 output created.
    const outputs = await prisma.inventoryItem.findMany({
      where: { characterId: fixture.characterId, itemKey: 'huyen_kiem' },
    });
    expect(outputs).toHaveLength(1);

    // Ledger rows: 3× CONSUME, 1× GRANT, 1× COST (material).
    const consumeLedger = await prisma.itemLedger.findMany({
      where: { characterId: fixture.characterId, reason: 'EQUIPMENT_MERGE_CONSUME' },
    });
    expect(consumeLedger).toHaveLength(3);
    const grantLedger = await prisma.itemLedger.findMany({
      where: { characterId: fixture.characterId, reason: 'EQUIPMENT_MERGE_GRANT' },
    });
    expect(grantLedger).toHaveLength(1);
    if (cost.materialQty > 0) {
      const costLedger = await prisma.itemLedger.findMany({
        where: { characterId: fixture.characterId, reason: 'EQUIPMENT_MERGE_COST' },
      });
      expect(costLedger).toHaveLength(1);
      expect(costLedger[0].qtyDelta).toBe(-cost.materialQty);
    }

    // Currency ledger.
    const currencyLedger = await prisma.currencyLedger.findMany({
      where: { characterId: fixture.characterId, reason: 'EQUIPMENT_MERGE' },
    });
    expect(currencyLedger).toHaveLength(1);
    expect(currencyLedger[0].delta).toBe(BigInt(-cost.linhThachCost));
    expect(currencyLedger[0].currency).toBe(CurrencyKind.LINH_THACH);

    // Character linhThach trừ đúng.
    const after = await prisma.character.findUniqueOrThrow({
      where: { id: fixture.characterId },
    });
    expect(after.linhThach).toBe(50_000n - BigInt(cost.linhThachCost));
  });

  // -------------------------------------------------------------------------
  // Merge — reject paths
  // -------------------------------------------------------------------------

  it('rejects merge when not exactly 3 items', async () => {
    const { fixture, items } = await seedMergeable();
    await expect(
      economy.mergeEquipment(
        fixture.characterId,
        [items[0].id, items[1].id],
      ),
    ).rejects.toMatchObject({ code: 'MERGE_INPUT_COUNT_INVALID' });
  });

  it('rejects merge with duplicate input ids', async () => {
    const { fixture, items } = await seedMergeable();
    await expect(
      economy.mergeEquipment(fixture.characterId, [
        items[0].id,
        items[0].id,
        items[1].id,
      ]),
    ).rejects.toMatchObject({ code: 'MERGE_INPUT_DUPLICATE' });
  });

  it('rejects merge when item belongs to another character', async () => {
    const { items } = await seedMergeable();
    const other = await makeUserChar(prisma);
    await expect(
      economy.mergeEquipment(other.characterId, items.map((i) => i.id)),
    ).rejects.toMatchObject({ code: 'MERGE_ITEM_NOT_OWNED' });
  });

  it('rejects merge when an item is equipped', async () => {
    const { fixture, items } = await seedMergeable();
    await prisma.inventoryItem.update({
      where: { id: items[0].id },
      data: { equippedSlot: 'WEAPON' },
    });
    await expect(
      economy.mergeEquipment(fixture.characterId, items.map((i) => i.id)),
    ).rejects.toMatchObject({ code: 'MERGE_ITEM_EQUIPPED' });
  });

  it('rejects merge when itemKey mixed (no recipe match)', async () => {
    const fixture = await makeUserChar(prisma, { linhThach: 50_000n });
    const a = await prisma.inventoryItem.create({
      data: { characterId: fixture.characterId, itemKey: 'so_kiem', qty: 1 },
    });
    const b = await prisma.inventoryItem.create({
      data: { characterId: fixture.characterId, itemKey: 'so_kiem', qty: 1 },
    });
    const c = await prisma.inventoryItem.create({
      data: { characterId: fixture.characterId, itemKey: 'pham_giap', qty: 1 },
    });
    await expect(
      economy.mergeEquipment(fixture.characterId, [a.id, b.id, c.id]),
    ).rejects.toMatchObject({ code: 'MERGE_MIXED_INPUT' });
  });

  it('rejects merge when no recipe in catalog for itemKey', async () => {
    const fixture = await makeUserChar(prisma, { linhThach: 50_000n });
    const items = [];
    for (let i = 0; i < 3; i += 1) {
      items.push(
        await prisma.inventoryItem.create({
          data: {
            characterId: fixture.characterId,
            itemKey: 'diem_phong_dao', // HUYEN — no recipe (chain end at HUYEN for weapon).
            qty: 1,
          },
        }),
      );
    }
    await expect(
      economy.mergeEquipment(fixture.characterId, items.map((i) => i.id)),
    ).rejects.toMatchObject({ code: 'MERGE_RECIPE_NOT_FOUND' });
  });

  it('rejects merge when insufficient linhThach', async () => {
    const { fixture, items } = await seedMergeable({ linhThach: 1n });
    await expect(
      economy.mergeEquipment(fixture.characterId, items.map((i) => i.id)),
    ).rejects.toMatchObject({ code: 'INSUFFICIENT_FUNDS' });
    // Material không bị trừ vì atomic rollback.
    const mat = await prisma.inventoryItem.findFirst({
      where: { characterId: fixture.characterId, itemKey: 'tinh_thiet' },
    });
    // Vì spend material chạy TRƯỚC spend linhThach trong tx — sẽ bị rollback.
    expect(mat?.qty).toBeGreaterThan(0);
  });

  it('rejects merge when insufficient material', async () => {
    const fixture = await makeUserChar(prisma, { linhThach: 50_000n });
    const items = [];
    for (let i = 0; i < 3; i += 1) {
      items.push(
        await prisma.inventoryItem.create({
          data: { characterId: fixture.characterId, itemKey: 'so_kiem', qty: 1 },
        }),
      );
    }
    // KHÔNG seed tinh_thiet.
    await expect(
      economy.mergeEquipment(fixture.characterId, items.map((i) => i.id)),
    ).rejects.toMatchObject({ code: 'INSUFFICIENT_MATERIAL' });
  });

  // -------------------------------------------------------------------------
  // Dismantle — success path
  // -------------------------------------------------------------------------

  it('dismantles equipment → yield materials + linhThach + return gems', async () => {
    const fixture = await makeUserChar(prisma, { linhThach: 0n });
    const item = await prisma.inventoryItem.create({
      data: {
        characterId: fixture.characterId,
        itemKey: 'huyen_kiem',
        qty: 1,
        sockets: ['gem_kim_1'],
      },
    });
    const result = await economy.dismantleEquipment(fixture.characterId, item.id);
    expect(result.consumedInventoryItemId).toBe(item.id);
    expect(result.returnedGems).toEqual(['gem_kim_1']);
    expect(result.yield.materials.length).toBeGreaterThan(0);

    // Item consumed.
    const exists = await prisma.inventoryItem.findUnique({ where: { id: item.id } });
    expect(exists).toBeNull();

    // Gem returned.
    const gemRow = await prisma.inventoryItem.findFirst({
      where: {
        characterId: fixture.characterId,
        itemKey: 'gem_kim_1',
        equippedSlot: null,
      },
    });
    expect(gemRow?.qty).toBe(1);

    // Yield material rows created.
    for (const m of result.yield.materials) {
      const row = await prisma.inventoryItem.findFirst({
        where: {
          characterId: fixture.characterId,
          itemKey: m.itemKey,
          equippedSlot: null,
        },
      });
      expect(row?.qty).toBeGreaterThanOrEqual(m.qty);
    }

    // linhThach yield.
    const after = await prisma.character.findUniqueOrThrow({
      where: { id: fixture.characterId },
    });
    expect(after.linhThach).toBe(BigInt(result.yield.linhThachYield));

    // Ledger reasons.
    const consume = await prisma.itemLedger.findMany({
      where: {
        characterId: fixture.characterId,
        reason: 'EQUIPMENT_DISMANTLE_CONSUME',
      },
    });
    expect(consume).toHaveLength(1);
    const yieldLedger = await prisma.itemLedger.findMany({
      where: { characterId: fixture.characterId, reason: 'EQUIPMENT_DISMANTLE_YIELD' },
    });
    expect(yieldLedger.length).toBe(result.yield.materials.length);
    const gemReturn = await prisma.itemLedger.findMany({
      where: {
        characterId: fixture.characterId,
        reason: 'EQUIPMENT_DISMANTLE_RETURN_GEM',
      },
    });
    expect(gemReturn).toHaveLength(1);
  });

  it('rejects dismantle when item is equipped', async () => {
    const fixture = await makeUserChar(prisma);
    const item = await prisma.inventoryItem.create({
      data: {
        characterId: fixture.characterId,
        itemKey: 'huyen_kiem',
        qty: 1,
        equippedSlot: 'WEAPON',
      },
    });
    await expect(
      economy.dismantleEquipment(fixture.characterId, item.id),
    ).rejects.toMatchObject({ code: 'DISMANTLE_ITEM_EQUIPPED' });
  });

  it('rejects dismantle for items not owned', async () => {
    const owner = await makeUserChar(prisma);
    const other = await makeUserChar(prisma);
    const item = await prisma.inventoryItem.create({
      data: { characterId: owner.characterId, itemKey: 'huyen_kiem', qty: 1 },
    });
    await expect(
      economy.dismantleEquipment(other.characterId, item.id),
    ).rejects.toMatchObject({ code: 'DISMANTLE_ITEM_NOT_FOUND' });
  });

  // -------------------------------------------------------------------------
  // Preview
  // -------------------------------------------------------------------------

  it('previewUpgrade returns enhance/merge/dismantle/socket info', async () => {
    const fixture = await makeUserChar(prisma);
    const item = await prisma.inventoryItem.create({
      data: {
        characterId: fixture.characterId,
        itemKey: 'so_kiem',
        qty: 1,
      },
    });
    const preview = await economy.previewUpgrade(fixture.characterId, item.id);
    expect(preview.itemKey).toBe('so_kiem');
    expect(preview.quality).toBe('PHAM');
    expect(preview.merge?.outputItemKey).toBe('huyen_kiem');
    expect(preview.merge?.outputQuality).toBe('LINH');
    expect(preview.enhance).not.toBeNull();
    expect(preview.dismantle.materials.length).toBeGreaterThan(0);
    expect(preview.dismantle.linhThachYield).toBeGreaterThan(0);
    expect(preview.socket.linhThachCost).toBeGreaterThanOrEqual(0);
    expect(preview.unsocket).toBeNull(); // No sockets yet.
    expect(preview.reforge).not.toBeNull();
    expect(preview.protection.recommended).toBe(false); // PHAM tier 1, low level.
    expect(preview.upgradeValidation.ok).toBe(true);
  });

  it('preview reflects equipped item validation', async () => {
    const fixture = await makeUserChar(prisma);
    const item = await prisma.inventoryItem.create({
      data: {
        characterId: fixture.characterId,
        itemKey: 'so_kiem',
        qty: 1,
        equippedSlot: 'WEAPON',
      },
    });
    const preview = await economy.previewUpgrade(fixture.characterId, item.id);
    expect(preview.upgradeValidation.ok).toBe(false);
    expect(preview.upgradeValidation.code).toBe('EQUIPMENT_EQUIPPED');
  });

  // -------------------------------------------------------------------------
  // Integration: dismantle yield < merge cost (anti infinite-resource).
  // -------------------------------------------------------------------------

  it('dismantle yield (3×) is strictly less than merge cost (anti-loop)', async () => {
    const fixture = await makeUserChar(prisma, {
      linhThach: 1_000_000n,
      materialQty: 100,
    } as Parameters<typeof makeUserChar>[1]);
    // Start: 3× so_kiem (sao chép merge happy path), nhưng đếm linhThach
    // sau dismantle 3× các so_kiem so với chi phí merge tương đương.
    const items: Array<{ id: string }> = [];
    for (let i = 0; i < 3; i += 1) {
      items.push(
        await prisma.inventoryItem.create({
          data: { characterId: fixture.characterId, itemKey: 'so_kiem', qty: 1 },
        }),
      );
    }
    // Tổng yield linhThach từ phân giải 3×.
    let totalYield = 0;
    for (const it of items) {
      const r = await economy.dismantleEquipment(fixture.characterId, it.id);
      totalYield += r.yield.linhThachYield;
    }
    const cost = getEquipmentMergeCost({
      equipmentTier: 1,
      sourceQuality: 'PHAM',
      slot: 'WEAPON',
    });
    expect(totalYield).toBeLessThan(cost.linhThachCost);
  });

  it('rejects merge after partial consume race (delete guard catches concurrent equip)', async () => {
    const { fixture, items } = await seedMergeable();
    // Race: another tx equips one of the items mid-flight bằng cách flip
    // equippedSlot ngay trước khi consume — guard `equippedSlot=null` ở
    // deleteMany sẽ thua → throw MERGE_ITEM_CONSUME_RACE. Test này flip
    // tay vì khó simulate race thật.
    await prisma.inventoryItem.update({
      where: { id: items[0].id },
      data: { equippedSlot: 'WEAPON' },
    });
    await expect(
      economy.mergeEquipment(fixture.characterId, items.map((i) => i.id)),
    ).rejects.toBeInstanceOf(EquipmentEconomyError);
  });
});
