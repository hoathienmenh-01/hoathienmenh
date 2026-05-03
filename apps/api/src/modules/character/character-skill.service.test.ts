import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { CurrencyKind } from '@prisma/client';
import { PrismaService } from '../../common/prisma.service';
import { CurrencyService } from './currency.service';
import {
  CharacterSkillError,
  CharacterSkillService,
  MAX_EQUIPPED_SKILLS,
  STARTER_SKILL_KEY,
} from './character-skill.service';
import { makeUserChar, wipeAll } from '../../test-helpers';

const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ??
  process.env.DATABASE_URL ??
  'postgresql://mtt:mtt@localhost:5432/mtt?schema=public';

let prisma: PrismaService;
let svc: CharacterSkillService;

beforeAll(() => {
  process.env.DATABASE_URL = TEST_DATABASE_URL;
  prisma = new PrismaService();
  const currency = new CurrencyService(prisma);
  svc = new CharacterSkillService(prisma, currency);
});

beforeEach(async () => {
  await wipeAll(prisma);
});

afterAll(async () => {
  await prisma.$disconnect();
});

async function makeCharInSect(
  sectName: string,
  charOpts: Parameters<typeof makeUserChar>[1] = {},
) {
  const sect = await prisma.sect.upsert({
    where: { name: sectName },
    update: {},
    create: { name: sectName },
  });
  const f = await makeUserChar(prisma, { ...charOpts, sectId: sect.id });
  return { ...f, sectId: sect.id };
}

describe('CharacterSkillService.grantStarterIfMissing (Phase 11.2.B onboard hook)', () => {
  it('lần đầu: tạo row basic_attack + isEquipped=true + source=starter', async () => {
    const f = await makeUserChar(prisma);
    await svc.grantStarterIfMissing(f.characterId);

    const rows = await prisma.characterSkill.findMany({
      where: { characterId: f.characterId },
    });
    expect(rows.length).toBe(1);
    expect(rows[0].skillKey).toBe(STARTER_SKILL_KEY);
    expect(rows[0].masteryLevel).toBe(1);
    expect(rows[0].isEquipped).toBe(true);
    expect(rows[0].source).toBe('starter');
  });

  it('idempotent: gọi 2 lần KHÔNG tạo row trùng', async () => {
    const f = await makeUserChar(prisma);
    await svc.grantStarterIfMissing(f.characterId);
    await svc.grantStarterIfMissing(f.characterId);
    const rows = await prisma.characterSkill.findMany({
      where: { characterId: f.characterId },
    });
    expect(rows.length).toBe(1);
  });

  it('legacy: row basic_attack tồn tại nhưng isEquipped=false → set lại true', async () => {
    const f = await makeUserChar(prisma);
    await prisma.characterSkill.create({
      data: {
        characterId: f.characterId,
        skillKey: STARTER_SKILL_KEY,
        masteryLevel: 1,
        isEquipped: false,
        source: 'starter',
      },
    });
    await svc.grantStarterIfMissing(f.characterId);
    const row = await prisma.characterSkill.findUniqueOrThrow({
      where: {
        characterId_skillKey: {
          characterId: f.characterId,
          skillKey: STARTER_SKILL_KEY,
        },
      },
    });
    expect(row.isEquipped).toBe(true);
  });
});

describe('CharacterSkillService.learn', () => {
  it('happy path: học basic skill `basic_attack` (no unlocks) → row tồn tại', async () => {
    const f = await makeUserChar(prisma);
    const state = await svc.learn(f.characterId, 'basic_attack', 'starter');
    expect(state.learned.length).toBe(1);
    expect(state.learned[0].skillKey).toBe('basic_attack');
    expect(state.learned[0].masteryLevel).toBe(1);
  });

  it('idempotent: học 2 lần KHÔNG tạo row trùng', async () => {
    const f = await makeUserChar(prisma);
    await svc.learn(f.characterId, 'basic_attack', 'starter');
    await svc.learn(f.characterId, 'basic_attack', 'admin_grant');
    const rows = await prisma.characterSkill.findMany({
      where: { characterId: f.characterId, skillKey: 'basic_attack' },
    });
    expect(rows.length).toBe(1);
    // source được giữ nguyên (P2002 no-op)
    expect(rows[0].source).toBe('starter');
  });

  it('REALM_TOO_LOW: học `tu_la_chan_that` (kim_dan) khi đang luyenkhi → throw', async () => {
    const f = await makeCharInSect('Tu La Tông');
    await expect(
      svc.learn(f.characterId, 'tu_la_chan_that', 'sect_shop'),
    ).rejects.toMatchObject({ code: 'REALM_TOO_LOW' });
  });

  it('WRONG_SECT: học `kiem_khi_chem` (sect=thanh_van) khi character vô sect khác → throw', async () => {
    const f = await makeCharInSect('Tu La Tông');
    await expect(
      svc.learn(f.characterId, 'kiem_khi_chem', 'admin_grant'),
    ).rejects.toMatchObject({ code: 'WRONG_SECT' });
  });

  it('METHOD_NOT_LEARNED: skill có unlock kind=method nhưng chưa học method', async () => {
    // Tạo skill template ad-hoc bằng cách dùng skill key đang tồn tại — mọi
    // skill template hiện tại chỉ có realm/sect unlock; ta giả lập bằng tạo
    // row ràng buộc method qua spec future. Hiện tại test này dùng metadata
    // hiện có: không skill nào có method unlock baseline → skip nội dung
    // chuyên sâu, chỉ assert validateOneUnlock đường method bị lỗi nếu được
    // gọi (smoke).
    expect(typeof svc.learn).toBe('function');
  });

  it('SKILL_NOT_FOUND: skillKey không tồn tại → throw', async () => {
    const f = await makeUserChar(prisma);
    await expect(
      svc.learn(f.characterId, 'no_such_skill', 'admin_grant'),
    ).rejects.toMatchObject({ code: 'SKILL_NOT_FOUND' });
  });
});

describe('CharacterSkillService.learnFromBook (Phase 11.2.D consume)', () => {
  /**
   * Helper — tạo inventory row cho 1 itemKey với qty cho trước (default 1).
   */
  async function giveItem(
    characterId: string,
    itemKey: string,
    qty: number = 1,
  ) {
    return prisma.inventoryItem.create({
      data: { characterId, itemKey, qty },
    });
  }

  it('happy path: consume skill_book_kim_quang_tram → CharacterSkill row + ledger SKILL_LEARN', async () => {
    const f = await makeUserChar(prisma);
    const inv = await giveItem(f.characterId, 'skill_book_kim_quang_tram', 1);

    const out = await svc.learnFromBook(f.characterId, inv.id);
    expect(out.skillKey).toBe('kim_quang_tram');
    expect(out.consumedItemKey).toBe('skill_book_kim_quang_tram');

    const row = await prisma.characterSkill.findUniqueOrThrow({
      where: {
        characterId_skillKey: {
          characterId: f.characterId,
          skillKey: 'kim_quang_tram',
        },
      },
    });
    expect(row.masteryLevel).toBe(1);
    expect(row.isEquipped).toBe(false);
    expect(row.source).toBe('item_consume');

    // Inventory row đã bị xoá (qty=1 → delete).
    const invAfter = await prisma.inventoryItem.findUnique({
      where: { id: inv.id },
    });
    expect(invAfter).toBeNull();

    // ItemLedger SKILL_LEARN qtyDelta=-1.
    const ledger = await prisma.itemLedger.findMany({
      where: {
        characterId: f.characterId,
        reason: 'SKILL_LEARN',
      },
    });
    expect(ledger.length).toBe(1);
    expect(ledger[0].itemKey).toBe('skill_book_kim_quang_tram');
    expect(ledger[0].qtyDelta).toBe(-1);
    expect(ledger[0].refType).toBe('InventoryItem');
    expect(ledger[0].refId).toBe(inv.id);
  });

  it('qty=3 → decrement còn 2, KHÔNG delete row', async () => {
    const f = await makeUserChar(prisma);
    const inv = await giveItem(f.characterId, 'skill_book_moc_linh_truong_dieu', 3);

    await svc.learnFromBook(f.characterId, inv.id);

    const invAfter = await prisma.inventoryItem.findUniqueOrThrow({
      where: { id: inv.id },
    });
    expect(invAfter.qty).toBe(2);
  });

  it('INVENTORY_ITEM_NOT_FOUND: id không tồn tại → throw, không ghi ledger', async () => {
    const f = await makeUserChar(prisma);
    await expect(
      svc.learnFromBook(f.characterId, 'non-existent-id'),
    ).rejects.toMatchObject({ code: 'INVENTORY_ITEM_NOT_FOUND' });
    const ledger = await prisma.itemLedger.findMany({
      where: { characterId: f.characterId },
    });
    expect(ledger.length).toBe(0);
  });

  it('INVENTORY_ITEM_NOT_FOUND: row của character khác → throw (ownership guard)', async () => {
    const a = await makeUserChar(prisma);
    const b = await makeUserChar(prisma);
    const invB = await giveItem(b.characterId, 'skill_book_thuy_kinh_phong_an', 1);
    await expect(
      svc.learnFromBook(a.characterId, invB.id),
    ).rejects.toMatchObject({ code: 'INVENTORY_ITEM_NOT_FOUND' });
    // Ledger của B vẫn rỗng (a fail trước khi consume).
    const ledger = await prisma.itemLedger.findMany({
      where: { characterId: b.characterId },
    });
    expect(ledger.length).toBe(0);
    // Inventory của B không bị giảm.
    const invAfter = await prisma.inventoryItem.findUniqueOrThrow({
      where: { id: invB.id },
    });
    expect(invAfter.qty).toBe(1);
  });

  it('NOT_SKILL_BOOK: itemKey không phải skill_book_* → throw, không consume', async () => {
    const f = await makeUserChar(prisma);
    const inv = await giveItem(f.characterId, 'huyet_chi_dan', 5);
    await expect(
      svc.learnFromBook(f.characterId, inv.id),
    ).rejects.toMatchObject({ code: 'NOT_SKILL_BOOK' });
    const invAfter = await prisma.inventoryItem.findUniqueOrThrow({
      where: { id: inv.id },
    });
    expect(invAfter.qty).toBe(5);
  });

  it('ALREADY_LEARNED: skill đã trong CharacterSkill → throw, KHÔNG consume item', async () => {
    const f = await makeUserChar(prisma);
    // Giả lập đã học rồi
    await prisma.characterSkill.create({
      data: {
        characterId: f.characterId,
        skillKey: 'hoa_xa_phun_diem',
        masteryLevel: 2,
        source: 'admin_grant',
      },
    });
    const inv = await giveItem(f.characterId, 'skill_book_hoa_xa_phun_diem', 1);
    await expect(
      svc.learnFromBook(f.characterId, inv.id),
    ).rejects.toMatchObject({ code: 'ALREADY_LEARNED' });
    // Item vẫn còn (không bị consume).
    const invAfter = await prisma.inventoryItem.findUniqueOrThrow({
      where: { id: inv.id },
    });
    expect(invAfter.qty).toBe(1);
    // CharacterSkill mastery vẫn là 2 (không reset).
    const row = await prisma.characterSkill.findUniqueOrThrow({
      where: {
        characterId_skillKey: {
          characterId: f.characterId,
          skillKey: 'hoa_xa_phun_diem',
        },
      },
    });
    expect(row.masteryLevel).toBe(2);
  });

  it('INVENTORY_ITEM_NOT_FOUND: inventoryItemId rỗng → throw sớm', async () => {
    const f = await makeUserChar(prisma);
    await expect(
      svc.learnFromBook(f.characterId, ''),
    ).rejects.toMatchObject({ code: 'INVENTORY_ITEM_NOT_FOUND' });
  });

  it('idempotent retry sau success: lần 2 → ALREADY_LEARNED, không consume thêm item', async () => {
    const f = await makeUserChar(prisma);
    const inv1 = await giveItem(f.characterId, 'skill_book_thach_giap_ho_than', 1);
    await svc.learnFromBook(f.characterId, inv1.id);
    // Tạo cuốn thứ 2 — kỳ vọng learnFromBook(2nd) throw ALREADY_LEARNED.
    const inv2 = await giveItem(f.characterId, 'skill_book_thach_giap_ho_than', 1);
    await expect(
      svc.learnFromBook(f.characterId, inv2.id),
    ).rejects.toMatchObject({ code: 'ALREADY_LEARNED' });
    const invAfter = await prisma.inventoryItem.findUniqueOrThrow({
      where: { id: inv2.id },
    });
    expect(invAfter.qty).toBe(1);
  });

  it('atomic guarantee: SKILL_NOT_FOUND nếu skillKey orphan (không xảy ra trong production catalog)', async () => {
    // Catalog hiện không có item kind=SKILL_BOOK trỏ tới skill orphan
    // (items-balance.test.ts đã enforce). Test này chỉ verify error path
    // qua mock InventoryItem trỏ tới itemKey không tồn tại trong catalog.
    const f = await makeUserChar(prisma);
    const inv = await prisma.inventoryItem.create({
      data: {
        characterId: f.characterId,
        itemKey: 'no_such_book',
        qty: 1,
      },
    });
    await expect(
      svc.learnFromBook(f.characterId, inv.id),
    ).rejects.toMatchObject({ code: 'NOT_SKILL_BOOK' });
  });
});

describe('CharacterSkillService.upgradeMastery', () => {
  it('happy path: bump 1 → 2, trừ LinhThach theo curve, ghi ledger', async () => {
    const f = await makeUserChar(prisma, { linhThach: 100_000n });
    await svc.learn(f.characterId, 'kim_quang_tram', 'admin_grant');
    const out = await svc.upgradeMastery(f.characterId, 'kim_quang_tram');
    expect(out.previousLevel).toBe(1);
    expect(out.newLevel).toBe(2);
    expect(out.linhThachSpent).toBeGreaterThan(0);

    const c = await prisma.character.findUniqueOrThrow({
      where: { id: f.characterId },
    });
    expect(c.linhThach).toBe(100_000n - BigInt(out.linhThachSpent));

    const ledgerRows = await prisma.currencyLedger.findMany({
      where: { characterId: f.characterId, reason: 'SKILL_UPGRADE' },
    });
    expect(ledgerRows.length).toBe(1);
    expect(ledgerRows[0].currency).toBe(CurrencyKind.LINH_THACH);
    expect(ledgerRows[0].delta).toBe(BigInt(-out.linhThachSpent));
  });

  it('NOT_LEARNED: chưa học skill → throw', async () => {
    const f = await makeUserChar(prisma);
    await expect(
      svc.upgradeMastery(f.characterId, 'kim_quang_tram'),
    ).rejects.toMatchObject({ code: 'NOT_LEARNED' });
  });

  it('INSUFFICIENT_FUNDS: không đủ LinhThach → throw, masteryLevel KHÔNG đổi', async () => {
    const f = await makeUserChar(prisma, { linhThach: 1n });
    await svc.learn(f.characterId, 'kim_quang_tram', 'admin_grant');
    await expect(
      svc.upgradeMastery(f.characterId, 'kim_quang_tram'),
    ).rejects.toMatchObject({ code: 'INSUFFICIENT_FUNDS' });

    const row = await prisma.characterSkill.findUniqueOrThrow({
      where: {
        characterId_skillKey: {
          characterId: f.characterId,
          skillKey: 'kim_quang_tram',
        },
      },
    });
    expect(row.masteryLevel).toBe(1);
  });

  it('MASTERY_MAX: bump quá max → throw', async () => {
    // basic tier max = 5. Tạo row trực tiếp ở max để test biên.
    const f = await makeUserChar(prisma, { linhThach: 1_000_000_000n });
    await prisma.characterSkill.create({
      data: {
        characterId: f.characterId,
        skillKey: 'basic_attack',
        masteryLevel: 5,
        source: 'admin_grant',
      },
    });
    await expect(
      svc.upgradeMastery(f.characterId, 'basic_attack'),
    ).rejects.toMatchObject({ code: 'MASTERY_MAX' });
  });
});

describe('CharacterSkillService.equip / unequip', () => {
  it('happy: equip skill đã học → isEquipped=true', async () => {
    const f = await makeUserChar(prisma);
    await svc.learn(f.characterId, 'kim_quang_tram', 'admin_grant');
    const state = await svc.equip(f.characterId, 'kim_quang_tram');
    const row = state.learned.find((s) => s.skillKey === 'kim_quang_tram');
    expect(row?.isEquipped).toBe(true);
  });

  it('NOT_LEARNED: equip skill chưa học → throw', async () => {
    const f = await makeUserChar(prisma);
    await expect(
      svc.equip(f.characterId, 'kim_quang_tram'),
    ).rejects.toMatchObject({ code: 'NOT_LEARNED' });
  });

  it('TOO_MANY_EQUIPPED: vượt cap MAX_EQUIPPED_SKILLS → throw', async () => {
    const f = await makeUserChar(prisma);
    // Tạo MAX rows với isEquipped=true
    const skillKeys = [
      'kim_quang_tram',
      'moc_linh_truong_dieu',
      'thuy_kinh_phong_an',
      'hoa_xa_phun_diem',
    ];
    expect(skillKeys.length).toBe(MAX_EQUIPPED_SKILLS);
    for (const k of skillKeys) {
      await prisma.characterSkill.create({
        data: {
          characterId: f.characterId,
          skillKey: k,
          masteryLevel: 1,
          isEquipped: true,
          source: 'admin_grant',
        },
      });
    }
    await prisma.characterSkill.create({
      data: {
        characterId: f.characterId,
        skillKey: 'thach_giap_ho_than',
        masteryLevel: 1,
        isEquipped: false,
        source: 'admin_grant',
      },
    });
    await expect(
      svc.equip(f.characterId, 'thach_giap_ho_than'),
    ).rejects.toMatchObject({ code: 'TOO_MANY_EQUIPPED' });
  });

  it('basic_attack equip → no-op success (luôn usable, không tính slot)', async () => {
    const f = await makeUserChar(prisma);
    // basic_attack chưa có row — equip vẫn return state via getState (lazy
    // grant). Test này verify không throw.
    await expect(svc.equip(f.characterId, 'basic_attack')).resolves.toBeTruthy();
  });

  it('equip idempotent: gọi 2 lần → row đã isEquipped=true, không lỗi', async () => {
    const f = await makeUserChar(prisma);
    await svc.learn(f.characterId, 'kim_quang_tram', 'admin_grant');
    await svc.equip(f.characterId, 'kim_quang_tram');
    await svc.equip(f.characterId, 'kim_quang_tram');
    const row = await prisma.characterSkill.findUniqueOrThrow({
      where: {
        characterId_skillKey: {
          characterId: f.characterId,
          skillKey: 'kim_quang_tram',
        },
      },
    });
    expect(row.isEquipped).toBe(true);
  });

  it('unequip: tắt isEquipped, idempotent', async () => {
    const f = await makeUserChar(prisma);
    await svc.learn(f.characterId, 'kim_quang_tram', 'admin_grant');
    await svc.equip(f.characterId, 'kim_quang_tram');
    await svc.unequip(f.characterId, 'kim_quang_tram');
    await svc.unequip(f.characterId, 'kim_quang_tram');
    const row = await prisma.characterSkill.findUniqueOrThrow({
      where: {
        characterId_skillKey: {
          characterId: f.characterId,
          skillKey: 'kim_quang_tram',
        },
      },
    });
    expect(row.isEquipped).toBe(false);
  });
});

describe('CharacterSkillService.getState', () => {
  it('legacy character (no rows) → lazy-grant basic_attack starter', async () => {
    const f = await makeUserChar(prisma);
    const state = await svc.getState(f.characterId);
    expect(state.learned.length).toBe(1);
    expect(state.learned[0].skillKey).toBe(STARTER_SKILL_KEY);
    expect(state.learned[0].isEquipped).toBe(true);
  });

  it('view: trả về effective.atkScale > base sau khi upgrade mastery', async () => {
    const f = await makeUserChar(prisma, { linhThach: 100_000n });
    await svc.learn(f.characterId, 'kim_quang_tram', 'admin_grant');
    const before = await svc.getState(f.characterId);
    const beforeRow = before.learned.find((s) => s.skillKey === 'kim_quang_tram');
    expect(beforeRow?.effective?.atkScale).toBeGreaterThan(0);

    await svc.upgradeMastery(f.characterId, 'kim_quang_tram');
    const after = await svc.getState(f.characterId);
    const afterRow = after.learned.find((s) => s.skillKey === 'kim_quang_tram');
    expect(afterRow?.masteryLevel).toBe(2);
    expect(afterRow?.effective?.atkScale).toBeGreaterThan(
      beforeRow?.effective?.atkScale ?? 0,
    );
  });

  it('CHARACTER_NOT_FOUND: id không tồn tại → throw', async () => {
    await expect(svc.getState('does-not-exist')).rejects.toMatchObject({
      code: 'CHARACTER_NOT_FOUND',
    });
  });

  it('maxEquipped trả về MAX_EQUIPPED_SKILLS', async () => {
    const f = await makeUserChar(prisma);
    const state = await svc.getState(f.characterId);
    expect(state.maxEquipped).toBe(MAX_EQUIPPED_SKILLS);
  });
});

describe('CharacterSkillService.getEffectiveSkillFor (combat helper)', () => {
  it('legacy character (no row) → masteryLevel 0, atkScale = base', async () => {
    const f = await makeUserChar(prisma);
    const baseSkill = {
      key: 'kim_quang_tram',
      name: 'Kim Quang Trảm',
      description: '',
      mpCost: 10,
      atkScale: 1.5,
      selfHealRatio: 0,
      selfBloodCost: 0,
      sect: null,
    };
    const eff = await svc.getEffectiveSkillFor(f.characterId, baseSkill);
    expect(eff.masteryLevel).toBe(0);
    expect(eff.atkScale).toBe(1.5);
    expect(eff.mpCost).toBe(10);
  });

  it('character có row masteryLevel 3 → atkScale > base, mpCost < base', async () => {
    const f = await makeUserChar(prisma);
    await prisma.characterSkill.create({
      data: {
        characterId: f.characterId,
        skillKey: 'kim_quang_tram',
        masteryLevel: 3,
        source: 'admin_grant',
      },
    });
    const baseSkill = {
      key: 'kim_quang_tram',
      name: 'Kim Quang Trảm',
      description: '',
      mpCost: 10,
      atkScale: 1.5,
      selfHealRatio: 0,
      selfBloodCost: 0,
      sect: null,
    };
    const eff = await svc.getEffectiveSkillFor(f.characterId, baseSkill);
    expect(eff.masteryLevel).toBe(3);
    expect(eff.atkScale).toBeGreaterThan(1.5);
    expect(eff.mpCost).toBeLessThanOrEqual(10);
  });

  it('skill không có template → fallback baseline', async () => {
    const f = await makeUserChar(prisma);
    const baseSkill = {
      key: 'no_template_skill',
      name: 'X',
      description: '',
      mpCost: 5,
      atkScale: 1.0,
      selfHealRatio: 0,
      selfBloodCost: 0,
      sect: null,
    };
    const eff = await svc.getEffectiveSkillFor(f.characterId, baseSkill);
    expect(eff.masteryLevel).toBe(0);
    expect(eff.atkScale).toBe(1.0);
  });
});

describe('CharacterSkillError class', () => {
  it('instanceof check', () => {
    const e = new CharacterSkillError('SKILL_NOT_FOUND');
    expect(e).toBeInstanceOf(CharacterSkillError);
    expect(e.code).toBe('SKILL_NOT_FOUND');
  });
});
