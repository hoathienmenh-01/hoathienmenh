/**
 * Phase QOL-2 — LoadoutPresetService integration tests.
 *
 * Cần Postgres (CI provisions postgres:16-alpine).
 */
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PrismaService } from '../../common/prisma.service';
import { TEST_DATABASE_URL, makeUserChar, wipeAll } from '../../test-helpers';
import {
  LoadoutPresetError,
  LoadoutPresetService,
} from './loadout-preset.service';

let prisma: PrismaService;
let svc: LoadoutPresetService;

beforeAll(() => {
  process.env.DATABASE_URL = TEST_DATABASE_URL;
  prisma = new PrismaService();
  svc = new LoadoutPresetService(prisma);
});

beforeEach(async () => {
  await wipeAll(prisma);
});

async function makeWeapon(characterId: string, itemKey = 'long_huyen_kiem') {
  return prisma.inventoryItem.create({
    data: { characterId, itemKey, qty: 1 },
  });
}

async function makeSkill(characterId: string, skillKey: string) {
  return prisma.characterSkill.create({
    data: {
      characterId,
      skillKey,
      masteryLevel: 1,
      source: 'starter',
      isEquipped: false,
    },
  });
}

async function makeArtifact(characterId: string, artifactKey = 'flying_sword_basic') {
  return prisma.characterArtifactV2.create({
    data: {
      characterId,
      artifactKey,
      name: 'Test Artifact',
      type: 'FLYING_SWORD',
      element: 'NONE',
      tier: 1,
      grade: 'HA_PHAM',
      level: 1,
      statsJson: { atk: 0, def: 0, hp: 0, mp: 0, spirit: 0 },
    },
  });
}

describe('LoadoutPresetService — Phase QOL-2', () => {
  describe('create', () => {
    it('creates preset minimal payload', async () => {
      const u = await makeUserChar(prisma);
      const p = await svc.create(u.characterId, {
        name: 'PvE Build',
        mode: 'PVE',
      });
      expect(p.name).toBe('PvE Build');
      expect(p.mode).toBe('PVE');
      expect(p.equipmentSlots).toEqual({});
      expect(p.skillSlots).toBeNull();
      expect(p.artifactSlots).toBeNull();
      expect(p.isDefaultForPve).toBe(false);
    });

    it('creates preset with equipmentSlots', async () => {
      const u = await makeUserChar(prisma);
      const w = await makeWeapon(u.characterId);
      const p = await svc.create(u.characterId, {
        name: 'Sword Build',
        mode: 'PVE',
        equipmentSlots: { WEAPON: w.id },
      });
      expect(p.equipmentSlots).toEqual({ WEAPON: w.id });
    });

    it('rejects empty name', async () => {
      const u = await makeUserChar(prisma);
      await expect(
        svc.create(u.characterId, { name: '', mode: 'PVE' }),
      ).rejects.toBeInstanceOf(LoadoutPresetError);
    });

    it('rejects unknown mode', async () => {
      const u = await makeUserChar(prisma);
      await expect(
        svc.create(u.characterId, { name: 'X', mode: 'FARM' as never }),
      ).rejects.toMatchObject({ code: 'LOADOUT_PRESET_MODE_INVALID' });
    });

    it('rejects duplicate name same character', async () => {
      const u = await makeUserChar(prisma);
      await svc.create(u.characterId, { name: 'dup', mode: 'PVE' });
      await expect(
        svc.create(u.characterId, { name: 'dup', mode: 'PVP' }),
      ).rejects.toMatchObject({ code: 'LOADOUT_PRESET_NAME_TAKEN' });
    });

    it('rejects duplicate item across slots', async () => {
      const u = await makeUserChar(prisma);
      const w = await makeWeapon(u.characterId);
      await expect(
        svc.create(u.characterId, {
          name: 'bad',
          mode: 'PVE',
          equipmentSlots: { WEAPON: w.id, ARMOR: w.id },
        }),
      ).rejects.toMatchObject({ code: 'LOADOUT_PRESET_PAYLOAD_INVALID' });
    });

    it('rejects after hitting per-character cap', async () => {
      const u = await makeUserChar(prisma);
      // Cap = 20. Tạo 20 preset hợp lệ.
      for (let i = 0; i < 20; i += 1) {
        await svc.create(u.characterId, { name: `p${i}`, mode: 'CUSTOM' });
      }
      await expect(
        svc.create(u.characterId, { name: 'over', mode: 'CUSTOM' }),
      ).rejects.toMatchObject({ code: 'LOADOUT_PRESET_LIMIT_REACHED' });
    });
  });

  describe('list / get / update', () => {
    it('list returns presets ordered by default flag + updatedAt', async () => {
      const u = await makeUserChar(prisma);
      const a = await svc.create(u.characterId, { name: 'A', mode: 'PVE' });
      const b = await svc.create(u.characterId, { name: 'B', mode: 'PVP' });
      await svc.setDefault(u.characterId, b.id, 'PVP');
      const list = await svc.list(u.characterId);
      expect(list).toHaveLength(2);
      expect(list[0].id).toBe(b.id); // default first
      expect(list[1].id).toBe(a.id);
    });

    it('get returns own preset', async () => {
      const u = await makeUserChar(prisma);
      const p = await svc.create(u.characterId, { name: 'X', mode: 'PVE' });
      const got = await svc.get(u.characterId, p.id);
      expect(got.id).toBe(p.id);
    });

    it('get rejects cross-character access', async () => {
      const u1 = await makeUserChar(prisma);
      const u2 = await makeUserChar(prisma);
      const p = await svc.create(u1.characterId, { name: 'X', mode: 'PVE' });
      await expect(svc.get(u2.characterId, p.id)).rejects.toMatchObject({
        code: 'LOADOUT_PRESET_NOT_FOUND',
      });
    });

    it('update changes name + payload', async () => {
      const u = await makeUserChar(prisma);
      const p = await svc.create(u.characterId, { name: 'orig', mode: 'PVE' });
      const w = await makeWeapon(u.characterId);
      const updated = await svc.update(u.characterId, p.id, {
        name: 'renamed',
        equipmentSlots: { WEAPON: w.id },
      });
      expect(updated.name).toBe('renamed');
      expect(updated.equipmentSlots).toEqual({ WEAPON: w.id });
    });

    it('update rejects cross-character', async () => {
      const u1 = await makeUserChar(prisma);
      const u2 = await makeUserChar(prisma);
      const p = await svc.create(u1.characterId, { name: 'p', mode: 'PVE' });
      await expect(
        svc.update(u2.characterId, p.id, { name: 'x' }),
      ).rejects.toMatchObject({ code: 'LOADOUT_PRESET_NOT_FOUND' });
    });

    it('delete removes preset', async () => {
      const u = await makeUserChar(prisma);
      const p = await svc.create(u.characterId, { name: 'p', mode: 'PVE' });
      await svc.delete(u.characterId, p.id);
      const list = await svc.list(u.characterId);
      expect(list).toHaveLength(0);
    });

    it('delete rejects cross-character', async () => {
      const u1 = await makeUserChar(prisma);
      const u2 = await makeUserChar(prisma);
      const p = await svc.create(u1.characterId, { name: 'p', mode: 'PVE' });
      await expect(svc.delete(u2.characterId, p.id)).rejects.toMatchObject({
        code: 'LOADOUT_PRESET_NOT_FOUND',
      });
    });
  });

  describe('setDefault', () => {
    it('toggles default cờ chỉ trên 1 preset mỗi mode', async () => {
      const u = await makeUserChar(prisma);
      const a = await svc.create(u.characterId, { name: 'A', mode: 'PVE' });
      const b = await svc.create(u.characterId, { name: 'B', mode: 'PVE' });
      await svc.setDefault(u.characterId, a.id, 'PVE');
      let list = await svc.list(u.characterId);
      expect(list.find((x) => x.id === a.id)?.isDefaultForPve).toBe(true);
      expect(list.find((x) => x.id === b.id)?.isDefaultForPve).toBe(false);
      // Re-assign default to B → A.isDefaultForPve = false.
      await svc.setDefault(u.characterId, b.id, 'PVE');
      list = await svc.list(u.characterId);
      expect(list.find((x) => x.id === a.id)?.isDefaultForPve).toBe(false);
      expect(list.find((x) => x.id === b.id)?.isDefaultForPve).toBe(true);
    });

    it('rejects CUSTOM mode (no default field)', async () => {
      const u = await makeUserChar(prisma);
      const p = await svc.create(u.characterId, { name: 'c', mode: 'CUSTOM' });
      await expect(
        svc.setDefault(u.characterId, p.id, 'CUSTOM'),
      ).rejects.toMatchObject({ code: 'LOADOUT_PRESET_MODE_INVALID' });
    });
  });

  describe('apply', () => {
    it('rejects non-owned inventoryItem → warnings + không apply', async () => {
      const u1 = await makeUserChar(prisma);
      const u2 = await makeUserChar(prisma);
      const wOther = await makeWeapon(u2.characterId);
      const preset = await svc.create(u1.characterId, {
        name: 'cheat',
        mode: 'PVE',
        equipmentSlots: { WEAPON: wOther.id },
      });
      const result = await svc.apply(u1.characterId, preset.id);
      expect(result.warnings).toHaveLength(1);
      expect(result.warnings[0].code).toBe('EQUIPMENT_MISSING');
      expect(result.appliedEquipmentCount).toBe(0);
      // Other character's item still untouched.
      const row = await prisma.inventoryItem.findUnique({ where: { id: wOther.id } });
      expect(row?.equippedSlot).toBeNull();
    });

    it('applies equipment: clears old equipped + sets preset slot', async () => {
      const u = await makeUserChar(prisma);
      const w1 = await makeWeapon(u.characterId);
      const w2 = await makeWeapon(u.characterId, 'huyen_thiet_dao');
      // Set w1 currently equipped WEAPON.
      await prisma.inventoryItem.update({
        where: { id: w1.id },
        data: { equippedSlot: 'WEAPON' },
      });
      const preset = await svc.create(u.characterId, {
        name: 'swap',
        mode: 'PVE',
        equipmentSlots: { WEAPON: w2.id },
      });
      const result = await svc.apply(u.characterId, preset.id);
      expect(result.warnings).toHaveLength(0);
      expect(result.appliedEquipmentCount).toBe(1);
      const after1 = await prisma.inventoryItem.findUnique({ where: { id: w1.id } });
      const after2 = await prisma.inventoryItem.findUnique({ where: { id: w2.id } });
      expect(after1?.equippedSlot).toBeNull();
      expect(after2?.equippedSlot).toBe('WEAPON');
    });

    it('applies skill: clears old isEquipped + sets preset skills', async () => {
      const u = await makeUserChar(prisma);
      const s1 = await makeSkill(u.characterId, 'basic_strike');
      await makeSkill(u.characterId, 'fire_palm');
      // s1 currently equipped.
      await prisma.characterSkill.update({
        where: { id: s1.id },
        data: { isEquipped: true },
      });
      const preset = await svc.create(u.characterId, {
        name: 'skills',
        mode: 'PVE',
        skillSlots: ['fire_palm'],
      });
      const result = await svc.apply(u.characterId, preset.id);
      expect(result.warnings).toHaveLength(0);
      expect(result.appliedSkillCount).toBe(1);
      const rows = await prisma.characterSkill.findMany({
        where: { characterId: u.characterId },
      });
      expect(rows.find((r) => r.skillKey === 'basic_strike')?.isEquipped).toBe(false);
      expect(rows.find((r) => r.skillKey === 'fire_palm')?.isEquipped).toBe(true);
    });

    it('applies artifact: rewrites equippedSlot', async () => {
      const u = await makeUserChar(prisma);
      const a1 = await makeArtifact(u.characterId);
      const preset = await svc.create(u.characterId, {
        name: 'art',
        mode: 'BOSS',
        artifactSlots: { MAIN_ARTIFACT_V2: a1.id },
      });
      const result = await svc.apply(u.characterId, preset.id);
      expect(result.warnings).toHaveLength(0);
      expect(result.appliedArtifactCount).toBe(1);
      const after = await prisma.characterArtifactV2.findUnique({
        where: { id: a1.id },
      });
      expect(after?.equippedSlot).toBe('MAIN_ARTIFACT_V2');
    });

    it('skillSlots = null → preserves existing isEquipped', async () => {
      const u = await makeUserChar(prisma);
      const s1 = await makeSkill(u.characterId, 'basic_strike');
      await prisma.characterSkill.update({
        where: { id: s1.id },
        data: { isEquipped: true },
      });
      const preset = await svc.create(u.characterId, {
        name: 'p',
        mode: 'PVE',
        // không truyền skillSlots → giữ nguyên
      });
      const result = await svc.apply(u.characterId, preset.id);
      expect(result.warnings).toHaveLength(0);
      const row = await prisma.characterSkill.findUnique({ where: { id: s1.id } });
      expect(row?.isEquipped).toBe(true);
    });

    it('apply rejects cross-character preset', async () => {
      const u1 = await makeUserChar(prisma);
      const u2 = await makeUserChar(prisma);
      const p = await svc.create(u1.characterId, { name: 'p', mode: 'PVE' });
      await expect(svc.apply(u2.characterId, p.id)).rejects.toMatchObject({
        code: 'LOADOUT_PRESET_NOT_FOUND',
      });
    });

    it('skill not learned → warning + không apply gear/skill/artifact', async () => {
      const u = await makeUserChar(prisma);
      const w = await makeWeapon(u.characterId);
      // Mark w currently NOT equipped → after apply nó phải vẫn null.
      const preset = await svc.create(u.characterId, {
        name: 'mixed',
        mode: 'PVE',
        equipmentSlots: { WEAPON: w.id },
        skillSlots: ['unlearned_skill'],
      });
      const result = await svc.apply(u.characterId, preset.id);
      expect(result.warnings.length).toBeGreaterThan(0);
      expect(result.appliedEquipmentCount).toBe(0);
      const after = await prisma.inventoryItem.findUnique({ where: { id: w.id } });
      expect(after?.equippedSlot).toBeNull();
    });
  });
});
