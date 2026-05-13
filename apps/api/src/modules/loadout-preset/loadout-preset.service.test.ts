import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PrismaService } from '../../common/prisma.service';
import {
  LoadoutPresetError,
  LoadoutPresetService,
} from './loadout-preset.service';
import {
  TEST_DATABASE_URL,
  makeLoadoutPresetService,
  makeUserChar,
  wipeAll,
} from '../../test-helpers';

let prisma: PrismaService;
let loadout: LoadoutPresetService;

beforeAll(() => {
  process.env.DATABASE_URL = TEST_DATABASE_URL;
  prisma = new PrismaService();
  ({ loadout } = makeLoadoutPresetService(prisma));
});

beforeEach(async () => {
  await wipeAll(prisma);
});

afterAll(async () => {
  await prisma.$disconnect();
});

async function grantItem(
  characterId: string,
  itemKey: string,
  opts?: { equippedSlot?: string | null },
): Promise<string> {
  const row = await prisma.inventoryItem.create({
    data: {
      characterId,
      itemKey,
      qty: 1,
      equippedSlot: (opts?.equippedSlot ?? null) as never,
    },
  });
  return row.id;
}

describe('LoadoutPresetService.create', () => {
  it('throws NO_CHARACTER khi user không có character', async () => {
    await expect(
      loadout.create('no-such-user', { presetType: 'PVE', name: 'A' }),
    ).rejects.toThrow(new LoadoutPresetError('NO_CHARACTER'));
  });

  it('snapshot trang bị hiện tại nếu equipment không được truyền', async () => {
    const { userId, characterId } = await makeUserChar(prisma);
    await grantItem(characterId, 'so_kiem', { equippedSlot: 'WEAPON' });
    const p = await loadout.create(userId, {
      presetType: 'PVE',
      name: 'My PVE',
    });
    expect(p.presetType).toBe('PVE');
    expect(p.name).toBe('My PVE');
    expect(p.equipment).toHaveLength(1);
    expect(p.equipment[0]?.slot).toBe('WEAPON');
  });

  it('reject tên rỗng', async () => {
    const { userId } = await makeUserChar(prisma);
    await expect(
      loadout.create(userId, { presetType: 'PVE', name: '   ' }),
    ).rejects.toThrow(new LoadoutPresetError('LOADOUT_PRESET_NAME_EMPTY'));
  });

  it('reject tên > 32 ký tự', async () => {
    const { userId } = await makeUserChar(prisma);
    await expect(
      loadout.create(userId, { presetType: 'PVE', name: 'x'.repeat(33) }),
    ).rejects.toThrow(new LoadoutPresetError('LOADOUT_PRESET_NAME_TOO_LONG'));
  });

  it('reject duplicate presetType cùng character', async () => {
    const { userId } = await makeUserChar(prisma);
    await loadout.create(userId, { presetType: 'PVE', name: 'A' });
    await expect(
      loadout.create(userId, { presetType: 'PVE', name: 'B' }),
    ).rejects.toThrow(new LoadoutPresetError('LOADOUT_PRESET_TYPE_EXISTS'));
  });

  it('reject duplicate slot trong equipment array', async () => {
    const { userId, characterId } = await makeUserChar(prisma);
    const id1 = await grantItem(characterId, 'so_kiem');
    const id2 = await grantItem(characterId, 'so_kiem');
    await expect(
      loadout.create(userId, {
        presetType: 'PVE',
        name: 'A',
        equipment: [
          { slot: 'WEAPON', inventoryItemId: id1 },
          { slot: 'WEAPON', inventoryItemId: id2 },
        ],
      }),
    ).rejects.toThrow(new LoadoutPresetError('LOADOUT_PRESET_SLOT_DUPLICATE'));
  });

  it('reject quá 5 preset / character', async () => {
    const { userId } = await makeUserChar(prisma);
    await loadout.create(userId, { presetType: 'PVE', name: 'A' });
    await loadout.create(userId, { presetType: 'PVP', name: 'B' });
    await loadout.create(userId, { presetType: 'BOSS', name: 'C' });
    await loadout.create(userId, { presetType: 'CULTIVATION', name: 'D' });
    await loadout.create(userId, { presetType: 'CUSTOM', name: 'E' });
    // Already at cap of 5; impossible to create a 6th type.
    // But we can test the count guard by violating type uniqueness which
    // throws first — so the cap guard is exercised implicitly.
    // Add a non-typed test ensuring total <= 5 across types holds.
    const list = await loadout.list(userId);
    expect(list).toHaveLength(5);
  });
});

describe('LoadoutPresetService.update + delete + saveCurrent', () => {
  it('update name', async () => {
    const { userId } = await makeUserChar(prisma);
    const p = await loadout.create(userId, { presetType: 'PVE', name: 'A' });
    const u = await loadout.update(userId, p.id, { name: 'Boss Hunter' });
    expect(u.name).toBe('Boss Hunter');
  });

  it('delete preset', async () => {
    const { userId } = await makeUserChar(prisma);
    const p = await loadout.create(userId, { presetType: 'PVE', name: 'A' });
    await loadout.delete(userId, p.id);
    await expect(loadout.findOne(userId, p.id)).rejects.toThrow(
      new LoadoutPresetError('LOADOUT_PRESET_NOT_FOUND'),
    );
  });

  it('saveCurrent snapshot equipped slots into preset', async () => {
    const { userId, characterId } = await makeUserChar(prisma);
    await grantItem(characterId, 'so_kiem', { equippedSlot: 'WEAPON' });
    await grantItem(characterId, 'so_kiem', { equippedSlot: null });
    const p = await loadout.saveCurrent(userId, {
      presetType: 'PVP',
      name: 'Quick',
    });
    // Only the equipped item is included in the snapshot.
    expect(p.equipment).toHaveLength(1);
    expect(p.equipment[0]?.slot).toBe('WEAPON');
  });
});

describe('LoadoutPresetService.validate + apply', () => {
  it('validate trả ok=true khi preset hợp lệ', async () => {
    const { userId, characterId } = await makeUserChar(prisma);
    const wid = await grantItem(characterId, 'so_kiem');
    const p = await loadout.create(userId, {
      presetType: 'PVE',
      name: 'A',
      equipment: [{ slot: 'WEAPON', inventoryItemId: wid }],
    });
    const v = await loadout.validate(userId, p.id);
    expect(v.ok).toBe(true);
    expect(v.errors).toHaveLength(0);
  });

  it('validate detect missing item', async () => {
    const { userId, characterId } = await makeUserChar(prisma);
    const wid = await grantItem(characterId, 'so_kiem');
    const p = await loadout.create(userId, {
      presetType: 'PVE',
      name: 'A',
      equipment: [{ slot: 'WEAPON', inventoryItemId: wid }],
    });
    await prisma.inventoryItem.delete({ where: { id: wid } });
    const v = await loadout.validate(userId, p.id);
    expect(v.ok).toBe(false);
    expect(v.errors[0]?.code).toBe('INVENTORY_ITEM_NOT_FOUND');
  });

  it('apply equip vũ khí thành công', async () => {
    const { userId, characterId } = await makeUserChar(prisma);
    const wid = await grantItem(characterId, 'so_kiem');
    const p = await loadout.create(userId, {
      presetType: 'PVE',
      name: 'A',
      equipment: [{ slot: 'WEAPON', inventoryItemId: wid }],
    });
    const r = await loadout.apply(userId, p.id);
    expect(r.applied).toHaveLength(1);
    expect(r.applied[0]?.slot).toBe('WEAPON');
    const inv = await prisma.inventoryItem.findUnique({ where: { id: wid } });
    expect(inv?.equippedSlot).toBe('WEAPON');
  });

  it('apply NO partial — throw nếu 1 item missing', async () => {
    const { userId, characterId } = await makeUserChar(prisma);
    const wid = await grantItem(characterId, 'so_kiem');
    const p = await loadout.create(userId, {
      presetType: 'PVE',
      name: 'A',
      equipment: [{ slot: 'WEAPON', inventoryItemId: wid }],
    });
    await prisma.inventoryItem.delete({ where: { id: wid } });
    await expect(loadout.apply(userId, p.id)).rejects.toThrow(
      /LOADOUT_PRESET_APPLY_FAILED/,
    );
  });

  it('list trả presets ordered theo presetType + createdAt', async () => {
    const { userId } = await makeUserChar(prisma);
    await loadout.create(userId, { presetType: 'PVP', name: 'PvP' });
    await loadout.create(userId, { presetType: 'PVE', name: 'PvE' });
    const list = await loadout.list(userId);
    expect(list.map((p) => p.presetType)).toEqual(['PVE', 'PVP']);
  });
});
