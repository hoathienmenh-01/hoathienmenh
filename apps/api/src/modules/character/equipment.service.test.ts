/**
 * Phase 15.0.A — EquipmentService runtime tests.
 *
 * Covers:
 *   - reforge success: substats reroll, ledger, history.
 *   - enchant success: element + level apply, ledger, history.
 *   - reject: NOT_OWNER, INVALID_EQUIPMENT (consumable), INSUFFICIENT_FUNDS,
 *     INSUFFICIENT_MATERIAL, MAX_ENCHANT_REACHED, ELEMENT_LOCKED.
 *   - concurrent reforge: 2 thread → 1 thread thắng (single ledger row),
 *     thread kia rollback (not double spend).
 *   - combat derived stats (qua InventoryService.equipBonus): substats +
 *     enchant cộng vào tổng bonus.
 *   - upgradePreview: trả config + cost step tiếp theo.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { CurrencyKind } from '@prisma/client';
import {
  ELEMENTAL_ENCHANT_EFFECTS,
  MAX_ENCHANT_LEVEL,
  composeEnchantBonus,
  composeSubstatBonus,
  getEnchantCost,
  getReforgeCost,
} from '@xuantoi/shared';
import { PrismaService } from '../../common/prisma.service';
import { TEST_DATABASE_URL, makeUserChar, wipeAll } from '../../test-helpers';
import { CurrencyService } from './currency.service';
import { EquipmentError, EquipmentService } from './equipment.service';
import { InventoryService } from '../inventory/inventory.service';
import { RealtimeService } from '../realtime/realtime.service';
import { CharacterService } from './character.service';

describe('EquipmentService — Phase 15.0.A reforge / enchant', () => {
  const prisma = new PrismaService({
    datasources: { db: { url: TEST_DATABASE_URL } },
  } as ConstructorParameters<typeof PrismaService>[0]);
  const currency = new CurrencyService(prisma);
  const equipment = new EquipmentService(prisma, currency);
  const realtime = new RealtimeService();
  const characters = new CharacterService(prisma, realtime);
  const inventory = new InventoryService(prisma, realtime, characters);

  beforeAll(async () => {
    await prisma.$connect();
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });
  beforeEach(async () => {
    await wipeAll(prisma);
  });

  // ----------------------------------------------------------------------
  // Helpers
  // ----------------------------------------------------------------------

  /**
   * Tạo character + 1 weapon LINH (huyen_kiem) + đủ material `tinh_thiet`
   * + đủ linhThach. Default cost LINH = 240 linhThach + 1 tinh_thiet.
   */
  async function setupCharWithEquipment(opts?: {
    linhThach?: bigint;
    materialQty?: number;
    itemKey?: string; // default 'huyen_kiem'
    materialKey?: string; // default 'tinh_thiet'
  }) {
    const fixture = await makeUserChar(prisma, {
      linhThach: opts?.linhThach ?? 100000n,
    });
    const equipmentRow = await prisma.inventoryItem.create({
      data: {
        characterId: fixture.characterId,
        itemKey: opts?.itemKey ?? 'huyen_kiem',
        qty: 1,
        equippedSlot: 'WEAPON',
      },
    });
    if (opts?.materialQty !== 0) {
      await prisma.inventoryItem.create({
        data: {
          characterId: fixture.characterId,
          itemKey: opts?.materialKey ?? 'tinh_thiet',
          qty: opts?.materialQty ?? 100,
          equippedSlot: null,
        },
      });
    }
    return { ...fixture, equipmentId: equipmentRow.id };
  }

  // ----------------------------------------------------------------------
  // Reforge
  // ----------------------------------------------------------------------

  describe('reforge', () => {
    it('success → substats overwrite + linhThach + material consumed + ledger ghi đúng', async () => {
      const f = await setupCharWithEquipment();
      const seed = stepRng([0.1, 0.5, 0.9]);
      const result = await equipment.reforge(f.characterId, f.equipmentId, seed);

      expect(result.before).toEqual([]);
      expect(result.after.length).toBeGreaterThan(0);
      expect(result.cost.linhThachCost).toBeGreaterThan(0);
      expect(result.cost.materialKey).toBe('tinh_thiet');
      expect(result.cost.materialQty).toBeGreaterThan(0);

      const eq = await prisma.inventoryItem.findUnique({
        where: { id: f.equipmentId },
      });
      expect(eq?.substatsJson).toEqual(result.after);

      const c = await prisma.character.findUnique({
        where: { id: f.characterId },
      });
      expect(c?.linhThach).toBe(100000n - BigInt(result.cost.linhThachCost));

      const matRow = await prisma.inventoryItem.findFirst({
        where: { characterId: f.characterId, itemKey: 'tinh_thiet' },
      });
      expect(matRow?.qty).toBe(100 - result.cost.materialQty);

      const itemLedger = await prisma.itemLedger.findMany({
        where: { characterId: f.characterId, reason: 'EQUIPMENT_REFORGE_COST' },
      });
      expect(itemLedger).toHaveLength(1);
      expect(itemLedger[0].qtyDelta).toBe(-result.cost.materialQty);
      expect(itemLedger[0].refType).toBe('InventoryItem');
      expect(itemLedger[0].refId).toBe(f.equipmentId);

      const currLedger = await prisma.currencyLedger.findMany({
        where: { characterId: f.characterId, reason: 'EQUIPMENT_REFORGE' },
      });
      expect(currLedger).toHaveLength(1);
      expect(currLedger[0].delta).toBe(BigInt(-result.cost.linhThachCost));
      expect(currLedger[0].currency).toBe(CurrencyKind.LINH_THACH);

      const history = await prisma.equipmentReforgeHistory.findMany({
        where: { characterId: f.characterId },
      });
      expect(history).toHaveLength(1);
      expect(history[0].inventoryItemId).toBe(f.equipmentId);
      expect(history[0].afterJson).toEqual(result.after);
    });

    it('reject NOT_OWNER → khác character không sửa được trang bị', async () => {
      const owner = await setupCharWithEquipment();
      const intruder = await makeUserChar(prisma, { linhThach: 100000n });
      await expect(
        equipment.reforge(intruder.characterId, owner.equipmentId),
      ).rejects.toBeInstanceOf(EquipmentError);
      // Equipment substats vẫn empty.
      const eq = await prisma.inventoryItem.findUnique({
        where: { id: owner.equipmentId },
      });
      expect(eq?.substatsJson).toEqual([]);
    });

    it('reject INVALID_EQUIPMENT → consumable / non-equipment không reforge được', async () => {
      const fixture = await makeUserChar(prisma, { linhThach: 100000n });
      const pillRow = await prisma.inventoryItem.create({
        data: {
          characterId: fixture.characterId,
          itemKey: 'tinh_thiet', // ore, not weapon/armor
          qty: 5,
          equippedSlot: null,
        },
      });
      await expect(
        equipment.reforge(fixture.characterId, pillRow.id),
      ).rejects.toMatchObject({ code: 'INVALID_EQUIPMENT' });
    });

    it('reject INSUFFICIENT_FUNDS → linhThach < cost', async () => {
      const f = await setupCharWithEquipment({ linhThach: 1n });
      await expect(
        equipment.reforge(f.characterId, f.equipmentId),
      ).rejects.toMatchObject({ code: 'INSUFFICIENT_FUNDS' });
      // Material không bị consume khi rollback.
      const matRow = await prisma.inventoryItem.findFirst({
        where: { characterId: f.characterId, itemKey: 'tinh_thiet' },
      });
      expect(matRow?.qty).toBe(100);
    });

    it('reject INSUFFICIENT_MATERIAL → không có tinh_thiet', async () => {
      const f = await setupCharWithEquipment({ materialQty: 0 });
      await expect(
        equipment.reforge(f.characterId, f.equipmentId),
      ).rejects.toMatchObject({ code: 'INSUFFICIENT_MATERIAL' });
      // LinhThach không bị consume khi rollback.
      const c = await prisma.character.findUnique({
        where: { id: f.characterId },
      });
      expect(c?.linhThach).toBe(100000n);
    });

    it('concurrent reforge → 1 thread thắng, thread kia INSUFFICIENT_FUNDS hoặc INSUFFICIENT_MATERIAL (không double spend)', async () => {
      // Setup: linhThach + material chỉ vừa đủ 1 reforge.
      const cost = getReforgeCost('LINH');
      const f = await setupCharWithEquipment({
        linhThach: BigInt(cost.linhThachCost),
        materialQty: cost.materialQty,
      });

      const rng = stepRng([0.1, 0.5, 0.9]);
      const settled = await Promise.allSettled([
        equipment.reforge(f.characterId, f.equipmentId, rng),
        equipment.reforge(f.characterId, f.equipmentId, rng),
      ]);
      const successCount = settled.filter((r) => r.status === 'fulfilled').length;
      const failCount = settled.filter((r) => r.status === 'rejected').length;
      expect(successCount).toBe(1);
      expect(failCount).toBe(1);

      // Verify NO double spend: linhThach = 0, material = 0, exactly 1 ledger row.
      const c = await prisma.character.findUnique({
        where: { id: f.characterId },
      });
      expect(c?.linhThach).toBe(0n);
      const itemLedger = await prisma.itemLedger.findMany({
        where: { characterId: f.characterId, reason: 'EQUIPMENT_REFORGE_COST' },
      });
      expect(itemLedger).toHaveLength(1);
      const currLedger = await prisma.currencyLedger.findMany({
        where: { characterId: f.characterId, reason: 'EQUIPMENT_REFORGE' },
      });
      expect(currLedger).toHaveLength(1);
    });

    it('reforge nhiều lần → ghi nhiều history rows + sub stats overwrite mỗi lần', async () => {
      const f = await setupCharWithEquipment();
      const rng1 = stepRng([0.1, 0.2, 0.3]);
      const rng2 = stepRng([0.7, 0.8, 0.9]);
      const r1 = await equipment.reforge(f.characterId, f.equipmentId, rng1);
      const r2 = await equipment.reforge(f.characterId, f.equipmentId, rng2);
      expect(r1.after).not.toEqual(r2.after);
      const eq = await prisma.inventoryItem.findUnique({
        where: { id: f.equipmentId },
      });
      expect(eq?.substatsJson).toEqual(r2.after);
      const history = await prisma.equipmentReforgeHistory.findMany({
        where: { characterId: f.characterId },
        orderBy: { createdAt: 'asc' },
      });
      expect(history).toHaveLength(2);
    });
  });

  // ----------------------------------------------------------------------
  // Enchant
  // ----------------------------------------------------------------------

  describe('enchant', () => {
    it('success first level → element + level=1 + ledger ghi đúng', async () => {
      const f = await setupCharWithEquipment({ linhThach: 100000n });
      const result = await equipment.enchant(f.characterId, f.equipmentId, 'hoa');
      expect(result.beforeElement).toBeNull();
      expect(result.beforeLevel).toBe(0);
      expect(result.afterElement).toBe('hoa');
      expect(result.afterLevel).toBe(1);

      const eq = await prisma.inventoryItem.findUnique({
        where: { id: f.equipmentId },
      });
      expect(eq?.enchantElement).toBe('hoa');
      expect(eq?.enchantLevel).toBe(1);

      const expectedCost = getEnchantCost('LINH', 0);
      const itemLedger = await prisma.itemLedger.findMany({
        where: { characterId: f.characterId, reason: 'EQUIPMENT_ENCHANT_COST' },
      });
      expect(itemLedger).toHaveLength(1);
      expect(itemLedger[0].qtyDelta).toBe(-expectedCost.materialQty);
      const currLedger = await prisma.currencyLedger.findMany({
        where: { characterId: f.characterId, reason: 'EQUIPMENT_ENCHANT' },
      });
      expect(currLedger[0].delta).toBe(BigInt(-expectedCost.linhThachCost));

      const history = await prisma.equipmentEnchantHistory.findMany({
        where: { characterId: f.characterId },
      });
      expect(history).toHaveLength(1);
      expect(history[0].afterElement).toBe('hoa');
      expect(history[0].afterLevel).toBe(1);
      expect(history[0].beforeLevel).toBe(0);
    });

    it('success level-up → cùng element + level + 1, cost tăng theo level', async () => {
      const f = await setupCharWithEquipment({ linhThach: 1000000n });
      await equipment.enchant(f.characterId, f.equipmentId, 'moc');
      const r2 = await equipment.enchant(f.characterId, f.equipmentId, 'moc');
      expect(r2.afterLevel).toBe(2);
      // Cost thứ 2 (currentLevel=1 → next=2) > cost thứ 1.
      const cost1 = getEnchantCost('LINH', 0);
      const cost2 = getEnchantCost('LINH', 1);
      expect(cost2.linhThachCost).toBeGreaterThan(cost1.linhThachCost);
    });

    it('reject ELEMENT_LOCKED → đã enchant element X, request element Y khác', async () => {
      const f = await setupCharWithEquipment({ linhThach: 1000000n });
      await equipment.enchant(f.characterId, f.equipmentId, 'kim');
      await expect(
        equipment.enchant(f.characterId, f.equipmentId, 'thuy'),
      ).rejects.toMatchObject({ code: 'ELEMENT_LOCKED' });
    });

    it('reject MAX_ENCHANT_REACHED → level đã = MAX_ENCHANT_LEVEL', async () => {
      const f = await setupCharWithEquipment({ linhThach: 100000000n });
      for (let i = 0; i < MAX_ENCHANT_LEVEL; i++) {
        await equipment.enchant(f.characterId, f.equipmentId, 'tho');
      }
      await expect(
        equipment.enchant(f.characterId, f.equipmentId, 'tho'),
      ).rejects.toMatchObject({ code: 'MAX_ENCHANT_REACHED' });
    });

    it('reject NOT_OWNER → character khác không enchant được', async () => {
      const owner = await setupCharWithEquipment();
      const intruder = await makeUserChar(prisma, { linhThach: 100000n });
      await expect(
        equipment.enchant(intruder.characterId, owner.equipmentId, 'hoa'),
      ).rejects.toBeInstanceOf(EquipmentError);
    });

    it('reject INSUFFICIENT_FUNDS → linhThach < cost', async () => {
      const f = await setupCharWithEquipment({ linhThach: 1n });
      await expect(
        equipment.enchant(f.characterId, f.equipmentId, 'hoa'),
      ).rejects.toMatchObject({ code: 'INSUFFICIENT_FUNDS' });
    });

    it('reject INSUFFICIENT_MATERIAL → không có material', async () => {
      const f = await setupCharWithEquipment({ materialQty: 0 });
      await expect(
        equipment.enchant(f.characterId, f.equipmentId, 'hoa'),
      ).rejects.toMatchObject({ code: 'INSUFFICIENT_MATERIAL' });
    });
  });

  // ----------------------------------------------------------------------
  // Combat derived stats — equipBonus()
  // ----------------------------------------------------------------------

  describe('equipBonus integration — Phase 15.0.A reforge/enchant cộng vào combat stats', () => {
    it('reforge substats cộng additive vào equipBonus', async () => {
      const f = await setupCharWithEquipment();
      const baseline = await inventory.equipBonus(f.characterId);

      const seed = stepRng([0.1, 0.5, 0.9]);
      const r = await equipment.reforge(f.characterId, f.equipmentId, seed);
      const expected = composeSubstatBonus(r.after);

      const after = await inventory.equipBonus(f.characterId);
      expect(after.atk).toBe(baseline.atk + expected.atk);
      expect(after.def).toBe(baseline.def + expected.def);
      expect(after.hpMaxBonus).toBe(baseline.hpMaxBonus + expected.hpMax);
      expect(after.mpMaxBonus).toBe(baseline.mpMaxBonus + expected.mpMax);
      expect(after.spiritBonus).toBe(baseline.spiritBonus + expected.spirit);
    });

    it('enchant element cộng additive vào equipBonus theo statKind', async () => {
      const f = await setupCharWithEquipment({ linhThach: 100000n });
      const baseline = await inventory.equipBonus(f.characterId);

      await equipment.enchant(f.characterId, f.equipmentId, 'hoa');
      const expected = composeEnchantBonus('hoa', 1);

      const after = await inventory.equipBonus(f.characterId);
      // hoa → atk bonus.
      expect(expected.atk).toBeGreaterThan(0);
      expect(after.atk).toBe(baseline.atk + expected.atk);
    });

    it('reforge + enchant cộng dồn cùng item', async () => {
      const f = await setupCharWithEquipment({ linhThach: 1000000n });
      const baseline = await inventory.equipBonus(f.characterId);
      const seed = stepRng([0.1, 0.5, 0.9]);
      const r = await equipment.reforge(f.characterId, f.equipmentId, seed);
      await equipment.enchant(f.characterId, f.equipmentId, 'tho');

      const sub = composeSubstatBonus(r.after);
      const enc = composeEnchantBonus('tho', 1);
      const after = await inventory.equipBonus(f.characterId);
      expect(after.def).toBe(baseline.def + sub.def + enc.def);
    });
  });

  // ----------------------------------------------------------------------
  // upgradePreview
  // ----------------------------------------------------------------------

  describe('upgradePreview', () => {
    it('trả config + cost step tiếp theo cho cả reforge + enchant', async () => {
      const f = await setupCharWithEquipment();
      const preview = await equipment.upgradePreview(f.characterId, f.equipmentId);
      expect(preview.quality).toBe('LINH');
      expect(preview.reforge.nextCost.linhThachCost).toBeGreaterThan(0);
      expect(preview.reforge.slots).toBeGreaterThan(0);
      expect(preview.enchant.maxLevel).toBe(MAX_ENCHANT_LEVEL);
      expect(preview.enchant.nextCost).not.toBeNull();
      expect(preview.enchant.elements).toHaveLength(5);
      expect(preview.enchant.elements.map((e) => e.element).sort()).toEqual(
        ['hoa', 'kim', 'moc', 'tho', 'thuy'],
      );
      // Effect references match shared catalog.
      const moc = preview.enchant.elements.find((e) => e.element === 'moc');
      expect(moc?.effect).toEqual(ELEMENTAL_ENCHANT_EFFECTS.moc);
    });

    it('khi enchant đã ở MAX_ENCHANT_LEVEL → nextCost null', async () => {
      const f = await setupCharWithEquipment({ linhThach: 100000000n });
      for (let i = 0; i < MAX_ENCHANT_LEVEL; i++) {
        await equipment.enchant(f.characterId, f.equipmentId, 'kim');
      }
      const preview = await equipment.upgradePreview(f.characterId, f.equipmentId);
      expect(preview.enchant.currentLevel).toBe(MAX_ENCHANT_LEVEL);
      expect(preview.enchant.nextCost).toBeNull();
    });

    it('non-owner → EQUIPMENT_NOT_FOUND', async () => {
      const owner = await setupCharWithEquipment();
      const intruder = await makeUserChar(prisma, { linhThach: 100000n });
      await expect(
        equipment.upgradePreview(intruder.characterId, owner.equipmentId),
      ).rejects.toMatchObject({ code: 'EQUIPMENT_NOT_FOUND' });
    });
  });
});

/**
 * Step RNG helper — trả phần tử kế tiếp trong values, loop về đầu khi hết.
 * Dùng cho tests deterministic mà không cần seed library.
 */
function stepRng(values: number[]): () => number {
  let i = 0;
  return () => {
    const v = values[i % values.length];
    i++;
    return v;
  };
}
