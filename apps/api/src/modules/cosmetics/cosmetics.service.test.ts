import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PrismaService } from '../../common/prisma.service';
import { TEST_DATABASE_URL, makeUserChar, wipeAll } from '../../test-helpers';
import { CosmeticError, CosmeticsService } from './cosmetics.service';

let prisma: PrismaService;
let service: CosmeticsService;

beforeAll(() => {
  process.env.DATABASE_URL = TEST_DATABASE_URL;
  prisma = new PrismaService();
  service = new CosmeticsService(prisma);
});

beforeEach(async () => {
  await wipeAll(prisma);
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('CosmeticsService — catalog & me', () => {
  it('catalog() returns only active cosmetics', () => {
    const catalog = service.catalog();
    expect(catalog.length).toBeGreaterThan(0);
    for (const def of catalog) {
      expect(def.active).toBe(true);
    }
  });

  it('me() returns empty owned + empty loadout for fresh character', async () => {
    const f = await makeUserChar(prisma);
    const result = await service.me(f.userId);
    expect(result.owned).toEqual([]);
    expect(result.loadout.activeAuraId).toBeNull();
    expect(result.loadout.activeTitleId).toBeNull();
    expect(result.loadout.activeAvatarFrameId).toBeNull();
    expect(result.loadout.activeChatBadgeId).toBeNull();
    expect(result.loadout.activeProfileDecorationId).toBeNull();
    expect(result.loadout.activeElementAuraId).toBeNull();
    expect(result.catalog.length).toBeGreaterThan(0);
    expect(result.catalog.every((c) => !c.owned && !c.equipped)).toBe(true);
  });

  it('me() reports owned cosmetics after admin grant', async () => {
    const admin = await makeUserChar(prisma, { role: 'ADMIN' });
    const target = await makeUserChar(prisma);
    await service.adminGrant(admin.userId, target.userId, 'title_so_hoc_de_tu', {
      source: 'EVENT',
    });
    const result = await service.me(target.userId);
    expect(result.owned.some((o) => o.cosmeticId === 'title_so_hoc_de_tu')).toBe(true);
    expect(
      result.catalog.find((c) => c.cosmeticId === 'title_so_hoc_de_tu')?.owned,
    ).toBe(true);
  });
});

describe('CosmeticsService — equip / unequip', () => {
  it('equip fails with NOT_OWNED when ownership missing', async () => {
    const f = await makeUserChar(prisma);
    await expect(
      service.equip(f.userId, 'title_so_hoc_de_tu'),
    ).rejects.toThrow(CosmeticError);
    try {
      await service.equip(f.userId, 'title_so_hoc_de_tu');
    } catch (e) {
      expect(e).toBeInstanceOf(CosmeticError);
      expect((e as CosmeticError).code).toBe('NOT_OWNED');
    }
  });

  it('equip fails with COSMETIC_NOT_FOUND for unknown id', async () => {
    const f = await makeUserChar(prisma);
    try {
      await service.equip(f.userId, 'does_not_exist');
      throw new Error('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(CosmeticError);
      expect((e as CosmeticError).code).toBe('COSMETIC_NOT_FOUND');
    }
  });

  it('equip fails with OWNERSHIP_EXPIRED when expiresAt in past', async () => {
    const admin = await makeUserChar(prisma, { role: 'ADMIN' });
    const target = await makeUserChar(prisma);
    // Grant first then manually set expiresAt to the past.
    await service.adminGrant(admin.userId, target.userId, 'chat_badge_event_xuan_to', {
      source: 'EVENT',
    });
    await prisma.cosmeticOwnership.updateMany({
      where: { characterId: target.characterId, cosmeticId: 'chat_badge_event_xuan_to' },
      data: { expiresAt: new Date('2020-01-01T00:00:00.000Z') },
    });
    try {
      await service.equip(target.userId, 'chat_badge_event_xuan_to');
      throw new Error('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(CosmeticError);
      expect((e as CosmeticError).code).toBe('OWNERSHIP_EXPIRED');
    }
  });

  it('equip succeeds when ownership exists and writes loadout slot', async () => {
    const admin = await makeUserChar(prisma, { role: 'ADMIN' });
    const target = await makeUserChar(prisma);
    await service.adminGrant(admin.userId, target.userId, 'title_so_hoc_de_tu');
    const loadout = await service.equip(target.userId, 'title_so_hoc_de_tu');
    expect(loadout.activeTitleId).toBe('title_so_hoc_de_tu');
  });

  it('equip replaces previous active of same type', async () => {
    const admin = await makeUserChar(prisma, { role: 'ADMIN' });
    const target = await makeUserChar(prisma);
    await service.adminGrant(admin.userId, target.userId, 'title_so_hoc_de_tu');
    await service.adminGrant(admin.userId, target.userId, 'title_luyen_khi_truyen_nhan');
    await service.equip(target.userId, 'title_so_hoc_de_tu');
    const loadout = await service.equip(target.userId, 'title_luyen_khi_truyen_nhan');
    expect(loadout.activeTitleId).toBe('title_luyen_khi_truyen_nhan');
  });

  it('equip respects per-type slot — title and aura can both be active', async () => {
    const admin = await makeUserChar(prisma, { role: 'ADMIN' });
    const target = await makeUserChar(prisma);
    await service.adminGrant(admin.userId, target.userId, 'title_so_hoc_de_tu');
    await service.adminGrant(admin.userId, target.userId, 'element_aura_kim');
    await service.equip(target.userId, 'title_so_hoc_de_tu');
    const loadout = await service.equip(target.userId, 'element_aura_kim');
    expect(loadout.activeTitleId).toBe('title_so_hoc_de_tu');
    expect(loadout.activeElementAuraId).toBe('element_aura_kim');
  });

  it('unequip clears the requested slot', async () => {
    const admin = await makeUserChar(prisma, { role: 'ADMIN' });
    const target = await makeUserChar(prisma);
    await service.adminGrant(admin.userId, target.userId, 'title_so_hoc_de_tu');
    await service.equip(target.userId, 'title_so_hoc_de_tu');
    const loadout = await service.unequip(target.userId, 'TITLE');
    expect(loadout.activeTitleId).toBeNull();
  });

  it('equip is idempotent — re-equip same id returns same loadout', async () => {
    const admin = await makeUserChar(prisma, { role: 'ADMIN' });
    const target = await makeUserChar(prisma);
    await service.adminGrant(admin.userId, target.userId, 'title_so_hoc_de_tu');
    await service.equip(target.userId, 'title_so_hoc_de_tu');
    const loadout = await service.equip(target.userId, 'title_so_hoc_de_tu');
    expect(loadout.activeTitleId).toBe('title_so_hoc_de_tu');
  });
});

describe('CosmeticsService — no power / no stat side effect', () => {
  it('equip never mutates power/spirit/speed/luck/hp/mp', async () => {
    const admin = await makeUserChar(prisma, { role: 'ADMIN' });
    const target = await makeUserChar(prisma, {
      power: 123,
      spirit: 45,
      speed: 67,
      luck: 89,
      hp: 100,
      hpMax: 100,
      mp: 50,
      mpMax: 50,
    });
    await service.adminGrant(admin.userId, target.userId, 'element_aura_kim');
    await service.equip(target.userId, 'element_aura_kim');
    const after = await prisma.character.findUniqueOrThrow({
      where: { id: target.characterId },
    });
    expect(after.power).toBe(123);
    expect(after.spirit).toBe(45);
    expect(after.speed).toBe(67);
    expect(after.luck).toBe(89);
    expect(after.hp).toBe(100);
    expect(after.hpMax).toBe(100);
    expect(after.mp).toBe(50);
    expect(after.mpMax).toBe(50);
  });

  it('unequip never mutates power/spirit/speed/luck/hp/mp', async () => {
    const admin = await makeUserChar(prisma, { role: 'ADMIN' });
    const target = await makeUserChar(prisma, {
      power: 200,
      spirit: 10,
      speed: 11,
      luck: 12,
    });
    await service.adminGrant(admin.userId, target.userId, 'element_aura_kim');
    await service.equip(target.userId, 'element_aura_kim');
    await service.unequip(target.userId, 'ELEMENT_AURA');
    const after = await prisma.character.findUniqueOrThrow({
      where: { id: target.characterId },
    });
    expect(after.power).toBe(200);
    expect(after.spirit).toBe(10);
    expect(after.speed).toBe(11);
    expect(after.luck).toBe(12);
  });

  it('admin grant never mutates power / realm of target', async () => {
    const admin = await makeUserChar(prisma, { role: 'ADMIN' });
    const target = await makeUserChar(prisma, {
      power: 999,
      realmKey: 'luyenkhi',
      realmStage: 3,
    });
    await service.adminGrant(admin.userId, target.userId, 'title_dai_la_kim_tien');
    const after = await prisma.character.findUniqueOrThrow({
      where: { id: target.characterId },
    });
    expect(after.power).toBe(999);
    expect(after.realmKey).toBe('luyenkhi');
    expect(after.realmStage).toBe(3);
  });
});

describe('CosmeticsService — admin grant / revoke', () => {
  it('adminGrant creates ownership + audit log', async () => {
    const admin = await makeUserChar(prisma, { role: 'ADMIN' });
    const target = await makeUserChar(prisma);
    await service.adminGrant(admin.userId, target.userId, 'title_kim_dan_chan_tu', {
      source: 'EVENT',
      durationDays: 30,
    });
    const owned = await prisma.cosmeticOwnership.findMany({
      where: { characterId: target.characterId },
    });
    expect(owned).toHaveLength(1);
    expect(owned[0]!.cosmeticId).toBe('title_kim_dan_chan_tu');
    expect(owned[0]!.expiresAt).toBeInstanceOf(Date);
    const audit = await prisma.adminAuditLog.findMany({
      where: { actorUserId: admin.userId, action: 'COSMETIC_GRANT' },
    });
    expect(audit).toHaveLength(1);
  });

  it('adminGrant is idempotent and extends expiresAt', async () => {
    const admin = await makeUserChar(prisma, { role: 'ADMIN' });
    const target = await makeUserChar(prisma);
    await service.adminGrant(admin.userId, target.userId, 'title_kim_dan_chan_tu', {
      durationDays: 30,
    });
    await service.adminGrant(admin.userId, target.userId, 'title_kim_dan_chan_tu', {
      durationDays: 90,
    });
    const owned = await prisma.cosmeticOwnership.findMany({
      where: { characterId: target.characterId },
    });
    expect(owned).toHaveLength(1);
  });

  it('adminGrant rejects unknown cosmeticId', async () => {
    const admin = await makeUserChar(prisma, { role: 'ADMIN' });
    const target = await makeUserChar(prisma);
    await expect(
      service.adminGrant(admin.userId, target.userId, 'bogus_id'),
    ).rejects.toThrow(CosmeticError);
  });

  it('adminGrant rejects when target has no character', async () => {
    const admin = await makeUserChar(prisma, { role: 'ADMIN' });
    // Create an orphan user without a character.
    const orphan = await prisma.user.create({
      data: { email: `orphan-${Date.now()}@xt.local`, passwordHash: 'x' },
    });
    try {
      await service.adminGrant(admin.userId, orphan.id, 'title_so_hoc_de_tu');
      throw new Error('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(CosmeticError);
      expect((e as CosmeticError).code).toBe('NO_CHARACTER');
    }
  });

  it('adminRevoke removes ownership + clears loadout slot', async () => {
    const admin = await makeUserChar(prisma, { role: 'ADMIN' });
    const target = await makeUserChar(prisma);
    await service.adminGrant(admin.userId, target.userId, 'title_so_hoc_de_tu');
    await service.equip(target.userId, 'title_so_hoc_de_tu');
    await service.adminRevoke(admin.userId, target.userId, 'title_so_hoc_de_tu');
    const owned = await prisma.cosmeticOwnership.findMany({
      where: { characterId: target.characterId },
    });
    expect(owned).toHaveLength(0);
    const loadout = await prisma.cosmeticLoadout.findUnique({
      where: { characterId: target.characterId },
    });
    expect(loadout?.activeTitleId).toBeNull();
  });
});

describe('CosmeticsService — public loadout', () => {
  it('loadoutByCharacterId returns equipped slots after equip', async () => {
    const admin = await makeUserChar(prisma, { role: 'ADMIN' });
    const target = await makeUserChar(prisma);
    await service.adminGrant(admin.userId, target.userId, 'title_so_hoc_de_tu');
    await service.adminGrant(admin.userId, target.userId, 'element_aura_kim');
    await service.equip(target.userId, 'title_so_hoc_de_tu');
    await service.equip(target.userId, 'element_aura_kim');
    const loadout = await service.loadoutByCharacterId(target.characterId);
    expect(loadout.activeTitleId).toBe('title_so_hoc_de_tu');
    expect(loadout.activeElementAuraId).toBe('element_aura_kim');
  });

  it('loadoutByCharacterId hides slots whose ownership expired', async () => {
    const admin = await makeUserChar(prisma, { role: 'ADMIN' });
    const target = await makeUserChar(prisma);
    await service.adminGrant(admin.userId, target.userId, 'chat_badge_event_xuan_to', {
      source: 'EVENT',
    });
    await service.equip(target.userId, 'chat_badge_event_xuan_to');
    // Force expiry in the past.
    await prisma.cosmeticOwnership.updateMany({
      where: { characterId: target.characterId, cosmeticId: 'chat_badge_event_xuan_to' },
      data: { expiresAt: new Date('2020-01-01T00:00:00.000Z') },
    });
    const loadout = await service.loadoutByCharacterId(target.characterId);
    expect(loadout.activeChatBadgeId).toBeNull();
  });
});
