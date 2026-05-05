import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PrismaService } from '../../common/prisma.service';
import { RealtimeService } from '../realtime/realtime.service';
import { CharacterService } from '../character/character.service';
import { InventoryService, InventoryError } from './inventory.service';
import { TEST_DATABASE_URL, makeUserChar, wipeAll } from '../../test-helpers';

let prisma: PrismaService;
let inv: InventoryService;

beforeAll(() => {
  process.env.DATABASE_URL = TEST_DATABASE_URL;
  prisma = new PrismaService();
  const realtime = new RealtimeService();
  const chars = new CharacterService(prisma, realtime);
  inv = new InventoryService(prisma, realtime, chars);
});

beforeEach(async () => {
  await wipeAll(prisma);
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('InventoryService', () => {
  describe('grant + list', () => {
    it('grant non-stackable: tạo row mới mỗi lần', async () => {
      const u = await makeUserChar(prisma);
      await inv.grant(u.characterId, [{ itemKey: 'so_kiem', qty: 1 }], { reason: 'ADMIN_GRANT' });
      await inv.grant(u.characterId, [{ itemKey: 'so_kiem', qty: 1 }], { reason: 'ADMIN_GRANT' });

      const list = await inv.list(u.characterId);
      const swords = list.filter((x) => x.itemKey === 'so_kiem');
      expect(swords).toHaveLength(2);
      expect(swords.every((s) => s.qty === 1 && s.equippedSlot === null)).toBe(true);
    });

    it('grant stackable: gộp qty vào row hiện có (nếu chưa equip)', async () => {
      const u = await makeUserChar(prisma);
      await inv.grant(u.characterId, [{ itemKey: 'huyet_chi_dan', qty: 3 }], { reason: 'ADMIN_GRANT' });
      await inv.grant(u.characterId, [{ itemKey: 'huyet_chi_dan', qty: 5 }], { reason: 'ADMIN_GRANT' });

      const list = await inv.list(u.characterId);
      const pills = list.filter((x) => x.itemKey === 'huyet_chi_dan');
      expect(pills).toHaveLength(1);
      expect(pills[0].qty).toBe(8);
    });

    it('grant: itemKey không tồn tại trong catalog → bỏ qua, không tạo row', async () => {
      const u = await makeUserChar(prisma);
      await inv.grant(u.characterId, [{ itemKey: 'khong_ton_tai', qty: 1 }], { reason: 'ADMIN_GRANT' });
      const rows = await prisma.inventoryItem.findMany({ where: { characterId: u.characterId } });
      expect(rows).toHaveLength(0);
    });

    it('list: filter ra item có itemKey không khớp catalog (orphan)', async () => {
      const u = await makeUserChar(prisma);
      await prisma.inventoryItem.create({
        data: { characterId: u.characterId, itemKey: 'orphan_key', qty: 1 },
      });
      const list = await inv.list(u.characterId);
      expect(list).toHaveLength(0);
    });

    // Phase 11.4.C — gem inventory rows phải hiển trên list (trước đó bị skip
    // vì `itemByKey` chỉ search ITEMS catalog).
    it('list: gem inventory row hiện diện qua fallback gem catalog (Phase 11.4.C)', async () => {
      const u = await makeUserChar(prisma);
      await prisma.inventoryItem.create({
        data: { characterId: u.characterId, itemKey: 'gem_kim_pham', qty: 5 },
      });
      const list = await inv.list(u.characterId);
      const gemRow = list.find((x) => x.itemKey === 'gem_kim_pham');
      expect(gemRow).toBeDefined();
      expect(gemRow?.qty).toBe(5);
      // Gem synth thành ItemDef với kind='MISC', stackable, có quality+bonuses.
      expect(gemRow?.item.kind).toBe('MISC');
      expect(gemRow?.item.stackable).toBe(true);
      expect(gemRow?.item.quality).toBe('PHAM');
      expect(gemRow?.item.bonuses).toBeDefined();
    });

    it('list: gem rows không equippedSlot (gem không equip trực tiếp)', async () => {
      const u = await makeUserChar(prisma);
      await prisma.inventoryItem.create({
        data: { characterId: u.characterId, itemKey: 'gem_thuy_linh', qty: 2 },
      });
      const list = await inv.list(u.characterId);
      const gemRow = list.find((x) => x.itemKey === 'gem_thuy_linh');
      expect(gemRow?.equippedSlot).toBeNull();
      expect(gemRow?.item.slot).toBeUndefined();
    });
  });

  describe('equip / unequip', () => {
    it('equip: item có slot → set equippedSlot, list trả về đúng slot', async () => {
      const u = await makeUserChar(prisma);
      await inv.grant(u.characterId, [{ itemKey: 'so_kiem', qty: 1 }], { reason: 'ADMIN_GRANT' });
      const item = await prisma.inventoryItem.findFirstOrThrow({
        where: { characterId: u.characterId, itemKey: 'so_kiem' },
      });

      await inv.equip(u.userId, item.id);

      const list = await inv.list(u.characterId);
      const sword = list.find((x) => x.itemKey === 'so_kiem');
      expect(sword?.equippedSlot).toBe('WEAPON');
    });

    it('equip swap: trang bị mới ở cùng slot → tháo cái cũ tự động', async () => {
      const u = await makeUserChar(prisma);
      await inv.grant(u.characterId, [{ itemKey: 'so_kiem', qty: 1 }], { reason: 'ADMIN_GRANT' });
      await inv.grant(u.characterId, [{ itemKey: 'huyen_kiem', qty: 1 }], { reason: 'ADMIN_GRANT' });
      const so = await prisma.inventoryItem.findFirstOrThrow({
        where: { characterId: u.characterId, itemKey: 'so_kiem' },
      });
      const huyen = await prisma.inventoryItem.findFirstOrThrow({
        where: { characterId: u.characterId, itemKey: 'huyen_kiem' },
      });

      await inv.equip(u.userId, so.id);
      await inv.equip(u.userId, huyen.id);

      const list = await inv.list(u.characterId);
      const equippedWeapons = list.filter((x) => x.equippedSlot === 'WEAPON');
      expect(equippedWeapons).toHaveLength(1);
      expect(equippedWeapons[0].itemKey).toBe('huyen_kiem');
      const oldSword = list.find((x) => x.itemKey === 'so_kiem');
      expect(oldSword?.equippedSlot).toBeNull();
    });

    it('equip item không có slot (đan dược) → NOT_EQUIPPABLE', async () => {
      const u = await makeUserChar(prisma);
      await inv.grant(u.characterId, [{ itemKey: 'huyet_chi_dan', qty: 1 }], { reason: 'ADMIN_GRANT' });
      const pill = await prisma.inventoryItem.findFirstOrThrow({
        where: { characterId: u.characterId, itemKey: 'huyet_chi_dan' },
      });
      await expect(inv.equip(u.userId, pill.id)).rejects.toMatchObject({
        code: 'NOT_EQUIPPABLE',
      });
    });

    it('equip item của character khác → INVENTORY_ITEM_NOT_FOUND', async () => {
      const a = await makeUserChar(prisma);
      const b = await makeUserChar(prisma);
      await inv.grant(a.characterId, [{ itemKey: 'so_kiem', qty: 1 }], { reason: 'ADMIN_GRANT' });
      const sword = await prisma.inventoryItem.findFirstOrThrow({
        where: { characterId: a.characterId },
      });
      await expect(inv.equip(b.userId, sword.id)).rejects.toMatchObject({
        code: 'INVENTORY_ITEM_NOT_FOUND',
      });
    });

    it('unequip: gỡ item khỏi slot, item vẫn còn trong inventory', async () => {
      const u = await makeUserChar(prisma);
      await inv.grant(u.characterId, [{ itemKey: 'so_kiem', qty: 1 }], { reason: 'ADMIN_GRANT' });
      const sword = await prisma.inventoryItem.findFirstOrThrow({
        where: { characterId: u.characterId, itemKey: 'so_kiem' },
      });
      await inv.equip(u.userId, sword.id);

      await inv.unequip(u.userId, 'WEAPON');

      const fresh = await prisma.inventoryItem.findUniqueOrThrow({ where: { id: sword.id } });
      expect(fresh.equippedSlot).toBeNull();
    });

    it('unequip slot trống → INVENTORY_ITEM_NOT_FOUND', async () => {
      const u = await makeUserChar(prisma);
      await expect(inv.unequip(u.userId, 'WEAPON')).rejects.toMatchObject({
        code: 'INVENTORY_ITEM_NOT_FOUND',
      });
    });

    it('user không có character → equip/unequip throw NO_CHARACTER', async () => {
      const orphan = await prisma.user.create({
        data: { email: `orphan-${Date.now()}@xt.local`, passwordHash: 'x' },
      });
      await expect(inv.equip(orphan.id, 'fake-id')).rejects.toBeInstanceOf(InventoryError);
      await expect(inv.unequip(orphan.id, 'WEAPON')).rejects.toMatchObject({
        code: 'NO_CHARACTER',
      });
    });
  });

  describe('use', () => {
    it('use đan HP: hồi máu, capped at hpMax, qty giảm 1', async () => {
      const u = await makeUserChar(prisma, { hp: 50, hpMax: 100 });
      await inv.grant(u.characterId, [{ itemKey: 'huyet_chi_dan', qty: 3 }], { reason: 'ADMIN_GRANT' }); // hp +60
      const pill = await prisma.inventoryItem.findFirstOrThrow({
        where: { characterId: u.characterId, itemKey: 'huyet_chi_dan' },
      });

      await inv.use(u.userId, pill.id);

      const c = await prisma.character.findUniqueOrThrow({ where: { id: u.characterId } });
      expect(c.hp).toBe(100); // 50 + 60 = 110, capped to 100
      const fresh = await prisma.inventoryItem.findUniqueOrThrow({ where: { id: pill.id } });
      expect(fresh.qty).toBe(2);
    });

    it('use đan có qty=1: xoá hẳn record', async () => {
      const u = await makeUserChar(prisma, { hp: 10, hpMax: 100 });
      await inv.grant(u.characterId, [{ itemKey: 'huyet_chi_dan', qty: 1 }], { reason: 'ADMIN_GRANT' });
      const pill = await prisma.inventoryItem.findFirstOrThrow({
        where: { characterId: u.characterId, itemKey: 'huyet_chi_dan' },
      });

      await inv.use(u.userId, pill.id);

      const remaining = await prisma.inventoryItem.findUnique({ where: { id: pill.id } });
      expect(remaining).toBeNull();
    });

    it('use đan EXP: tăng exp', async () => {
      const u = await makeUserChar(prisma, { exp: 100n });
      await inv.grant(u.characterId, [{ itemKey: 'co_thien_dan', qty: 1 }], { reason: 'ADMIN_GRANT' }); // exp +500
      const pill = await prisma.inventoryItem.findFirstOrThrow({
        where: { characterId: u.characterId, itemKey: 'co_thien_dan' },
      });

      await inv.use(u.userId, pill.id);

      const c = await prisma.character.findUniqueOrThrow({ where: { id: u.characterId } });
      expect(c.exp).toBe(600n);
    });

    it('use item không có effect (vũ khí) → NOT_USABLE', async () => {
      const u = await makeUserChar(prisma);
      await inv.grant(u.characterId, [{ itemKey: 'so_kiem', qty: 1 }], { reason: 'ADMIN_GRANT' });
      const sword = await prisma.inventoryItem.findFirstOrThrow({
        where: { characterId: u.characterId, itemKey: 'so_kiem' },
      });
      await expect(inv.use(u.userId, sword.id)).rejects.toMatchObject({
        code: 'NOT_USABLE',
      });
    });

    it('use item của character khác → INVENTORY_ITEM_NOT_FOUND', async () => {
      const a = await makeUserChar(prisma);
      const b = await makeUserChar(prisma);
      await inv.grant(a.characterId, [{ itemKey: 'huyet_chi_dan', qty: 1 }], { reason: 'ADMIN_GRANT' });
      const pill = await prisma.inventoryItem.findFirstOrThrow({
        where: { characterId: a.characterId },
      });
      await expect(inv.use(b.userId, pill.id)).rejects.toMatchObject({
        code: 'INVENTORY_ITEM_NOT_FOUND',
      });
    });
  });

  describe('equipBonus', () => {
    it('cộng dồn bonus từ tất cả slot đang đeo', async () => {
      const u = await makeUserChar(prisma);
      await inv.grant(u.characterId, [
        { itemKey: 'so_kiem', qty: 1 }, // atk +5
        { itemKey: 'pham_giap', qty: 1 }, // def +4
      ], { reason: 'ADMIN_GRANT' });
      const sword = await prisma.inventoryItem.findFirstOrThrow({
        where: { characterId: u.characterId, itemKey: 'so_kiem' },
      });
      const armor = await prisma.inventoryItem.findFirstOrThrow({
        where: { characterId: u.characterId, itemKey: 'pham_giap' },
      });
      await inv.equip(u.userId, sword.id);
      await inv.equip(u.userId, armor.id);

      const bonus = await inv.equipBonus(u.characterId);
      expect(bonus.atk).toBe(5);
      expect(bonus.def).toBe(4);
      expect(bonus.hpMaxBonus).toBe(0);
    });

    it('item không equip không cộng vào bonus', async () => {
      const u = await makeUserChar(prisma);
      await inv.grant(u.characterId, [{ itemKey: 'so_kiem', qty: 1 }], { reason: 'ADMIN_GRANT' });
      const bonus = await inv.equipBonus(u.characterId);
      expect(bonus.atk).toBe(0);
    });

    /**
     * Phase 11.4.B Gem MVP socket bonus wire — equipBonus phải cộng thêm
     * `composeSocketBonus(item.sockets)` cho mọi equipped item. Test verify
     * gem PHAM kim (atk: 3, spirit: 1) socket vào weapon LINH stack đúng.
     */
    it('equipBonus cộng thêm socket bonus từ sockets[] của equipped item', async () => {
      const u = await makeUserChar(prisma);
      await inv.grant(
        u.characterId,
        [{ itemKey: 'huyen_kiem', qty: 1 }],
        { reason: 'ADMIN_GRANT' },
      );
      const weapon = await prisma.inventoryItem.findFirstOrThrow({
        where: { characterId: u.characterId, itemKey: 'huyen_kiem' },
      });
      await inv.equip(u.userId, weapon.id);
      // Set sockets directly (mô phỏng sau khi GemService.socketGem chạy).
      await prisma.inventoryItem.update({
        where: { id: weapon.id },
        data: { sockets: ['gem_kim_pham'] },
      });

      const bonus = await inv.equipBonus(u.characterId);
      // huyen_kiem base: atk +12, spirit +2 (per items.ts).
      // gem_kim_pham (PHAM scale 1.0): atk: 3, spirit: 1.
      // Total: atk 15, spirit 3.
      expect(bonus.atk).toBe(12 + 3);
      expect(bonus.spiritBonus).toBe(2 + 1);
    });
  });

  describe('grantTx', () => {
    it('grantTx trong $transaction: stackable gộp đúng', async () => {
      const u = await makeUserChar(prisma);
      await prisma.$transaction(async (tx) => {
        await inv.grantTx(tx, u.characterId, [
          { itemKey: 'huyet_chi_dan', qty: 2 },
          { itemKey: 'huyet_chi_dan', qty: 3 },
        ], { reason: 'ADMIN_GRANT' });
      });
      const rows = await prisma.inventoryItem.findMany({
        where: { characterId: u.characterId, itemKey: 'huyet_chi_dan' },
      });
      expect(rows).toHaveLength(1);
      expect(rows[0].qty).toBe(5);
    });
  });

  /**
   * Phase 11.6.E — equipment elemental tribulation resist composer wire.
   *
   * Verify `equipElementResistMods(characterId)` query equipped items, lookup
   * `ItemDef.bonuses.elementResist`, fold qua `composeEquippedItemElementResist`
   * cho `TribulationService.attemptTribulation` consume.
   */
  describe('equipElementResistMods', () => {
    it('character không trang bị → empty map', async () => {
      const u = await makeUserChar(prisma);
      const out = await inv.equipElementResistMods(u.characterId);
      expect(out.size).toBe(0);
    });

    it('character trang bị item không có elementResist → empty map', async () => {
      const u = await makeUserChar(prisma);
      await inv.grant(u.characterId, [{ itemKey: 'pham_giap', qty: 1 }], {
        reason: 'ADMIN_GRANT',
      });
      const armor = await prisma.inventoryItem.findFirstOrThrow({
        where: { characterId: u.characterId, itemKey: 'pham_giap' },
      });
      await inv.equip(u.userId, armor.id);
      const out = await inv.equipElementResistMods(u.characterId);
      expect(out.size).toBe(0);
    });

    it('character trang bị 1× huyen_giap_phong_kim → map { kim: 0.95 }', async () => {
      const u = await makeUserChar(prisma);
      await inv.grant(u.characterId, [{ itemKey: 'huyen_giap_phong_kim', qty: 1 }], {
        reason: 'ADMIN_GRANT',
      });
      const armor = await prisma.inventoryItem.findFirstOrThrow({
        where: { characterId: u.characterId, itemKey: 'huyen_giap_phong_kim' },
      });
      await inv.equip(u.userId, armor.id);
      const out = await inv.equipElementResistMods(u.characterId);
      expect(out.size).toBe(1);
      expect(out.get('kim')).toBeCloseTo(0.95, 6);
    });

    it('item ở inventory nhưng chưa equip → KHÔNG vào composer', async () => {
      const u = await makeUserChar(prisma);
      // grant nhưng không equip
      await inv.grant(u.characterId, [{ itemKey: 'huyen_giap_phong_hoa', qty: 1 }], {
        reason: 'ADMIN_GRANT',
      });
      const out = await inv.equipElementResistMods(u.characterId);
      expect(out.size).toBe(0);
    });

    it('character đeo cả armor resist + weapon thường → chỉ armor resist contribute', async () => {
      const u = await makeUserChar(prisma);
      await inv.grant(
        u.characterId,
        [
          { itemKey: 'huyen_giap_phong_thuy', qty: 1 },
          { itemKey: 'so_kiem', qty: 1 },
        ],
        { reason: 'ADMIN_GRANT' },
      );
      const armor = await prisma.inventoryItem.findFirstOrThrow({
        where: { characterId: u.characterId, itemKey: 'huyen_giap_phong_thuy' },
      });
      const weapon = await prisma.inventoryItem.findFirstOrThrow({
        where: { characterId: u.characterId, itemKey: 'so_kiem' },
      });
      await inv.equip(u.userId, armor.id);
      await inv.equip(u.userId, weapon.id);

      const out = await inv.equipElementResistMods(u.characterId);
      expect(out.size).toBe(1);
      expect(out.get('thuy')).toBeCloseTo(0.95, 6);
    });

    it('orphan equipped item (itemKey không có trong catalog) → bỏ qua, không throw', async () => {
      const u = await makeUserChar(prisma);
      // Tạo trực tiếp 1 row orphan (mô phỏng catalog drift / DB legacy).
      await prisma.inventoryItem.create({
        data: {
          characterId: u.characterId,
          itemKey: 'orphan_armor_phantom',
          qty: 1,
          equippedSlot: 'ARMOR',
        },
      });
      const out = await inv.equipElementResistMods(u.characterId);
      expect(out.size).toBe(0);
    });
  });
});
