/**
 * Phase QOL-2 — Loadout Preset shared module unit tests.
 *
 * Test pure-function parser + validator. Không cần DB / Nest.
 */
import { describe, expect, it } from 'vitest';
import {
  LOADOUT_PRESET_MODES,
  LOADOUT_PRESET_NAME_MAX,
  LoadoutPresetValidationError,
  MAX_ACTIVE_SKILLS,
  defaultFlagFieldForMode,
  isArtifactEquipSlot,
  isEquipSlot,
  isLoadoutPresetMode,
  parseLoadoutPresetPayload,
  validatePresetMode,
  validatePresetName,
} from './loadout-presets';

describe('isLoadoutPresetMode', () => {
  it('accept enum members', () => {
    for (const m of LOADOUT_PRESET_MODES) {
      expect(isLoadoutPresetMode(m)).toBe(true);
    }
  });
  it('reject unknown', () => {
    expect(isLoadoutPresetMode('FARM')).toBe(false);
    expect(isLoadoutPresetMode(null)).toBe(false);
    expect(isLoadoutPresetMode(123)).toBe(false);
  });
});

describe('isEquipSlot', () => {
  it('accept WEAPON / ARMOR / ARTIFACT_1', () => {
    expect(isEquipSlot('WEAPON')).toBe(true);
    expect(isEquipSlot('ARMOR')).toBe(true);
    expect(isEquipSlot('ARTIFACT_1')).toBe(true);
  });
  it('reject MAIN_ARTIFACT_V2 (artifact v2 slot, không phải EquipSlot)', () => {
    expect(isEquipSlot('MAIN_ARTIFACT_V2')).toBe(false);
  });
});

describe('isArtifactEquipSlot', () => {
  it('accept MAIN_ARTIFACT_V2 / DEFENSE_ARTIFACT_V2', () => {
    expect(isArtifactEquipSlot('MAIN_ARTIFACT_V2')).toBe(true);
    expect(isArtifactEquipSlot('DEFENSE_ARTIFACT_V2')).toBe(true);
  });
  it('reject WEAPON (equipment slot)', () => {
    expect(isArtifactEquipSlot('WEAPON')).toBe(false);
  });
});

describe('validatePresetName', () => {
  it('trim + accept hợp lệ', () => {
    expect(validatePresetName('  PvE Build  ')).toBe('PvE Build');
  });
  it('reject empty hoặc whitespace-only', () => {
    expect(() => validatePresetName('')).toThrow(LoadoutPresetValidationError);
    expect(() => validatePresetName('   ')).toThrow(LoadoutPresetValidationError);
  });
  it('reject quá dài', () => {
    expect(() => validatePresetName('x'.repeat(LOADOUT_PRESET_NAME_MAX + 1))).toThrow(
      LoadoutPresetValidationError,
    );
  });
  it('reject non-string', () => {
    expect(() => validatePresetName(42 as unknown as string)).toThrow(
      LoadoutPresetValidationError,
    );
  });
});

describe('validatePresetMode', () => {
  it('accept PVE / PVP / BOSS / CUSTOM', () => {
    expect(validatePresetMode('PVE')).toBe('PVE');
    expect(validatePresetMode('CUSTOM')).toBe('CUSTOM');
  });
  it('reject lowercase / unknown', () => {
    expect(() => validatePresetMode('pve')).toThrow(LoadoutPresetValidationError);
    expect(() => validatePresetMode('FARM')).toThrow(LoadoutPresetValidationError);
  });
});

describe('parseLoadoutPresetPayload', () => {
  it('empty payload → all defaults', () => {
    const out = parseLoadoutPresetPayload({});
    expect(out).toEqual({
      equipmentSlots: {},
      skillSlots: null,
      artifactSlots: null,
    });
  });

  it('normalize equipmentSlots: trim + lọc slot hợp lệ', () => {
    const out = parseLoadoutPresetPayload({
      equipmentSlots: { WEAPON: '  inv_w  ', ARMOR: 'inv_a' },
    });
    expect(out.equipmentSlots).toEqual({ WEAPON: 'inv_w', ARMOR: 'inv_a' });
  });

  it('reject equipmentSlots với slot key sai', () => {
    expect(() =>
      parseLoadoutPresetPayload({
        equipmentSlots: { FAKE_SLOT: 'x' } as never,
      }),
    ).toThrow(/EQUIPMENT_SLOT_INVALID/);
  });

  it('reject equipmentSlots với id rỗng', () => {
    expect(() =>
      parseLoadoutPresetPayload({ equipmentSlots: { WEAPON: '   ' } }),
    ).toThrow(/EQUIPMENT_ID_INVALID/);
  });

  it('reject equipmentSlots với cùng inventoryItemId ở 2 slot', () => {
    expect(() =>
      parseLoadoutPresetPayload({
        equipmentSlots: { WEAPON: 'inv_x', ARMOR: 'inv_x' },
      }),
    ).toThrow(/EQUIPMENT_DUPLICATE_ITEM/);
  });

  it('skillSlots dedupe + trim', () => {
    const out = parseLoadoutPresetPayload({
      skillSlots: ['  skill_a  ', 'skill_b'],
    });
    expect(out.skillSlots).toEqual(['skill_a', 'skill_b']);
  });

  it('skillSlots reject duplicate (post-trim)', () => {
    expect(() =>
      parseLoadoutPresetPayload({ skillSlots: ['skill_a', 'skill_a'] }),
    ).toThrow(/SKILL_DUPLICATE/);
  });

  it('skillSlots reject quá MAX_ACTIVE_SKILLS', () => {
    const too = Array.from({ length: MAX_ACTIVE_SKILLS + 1 }, (_, i) => `s_${i}`);
    expect(() => parseLoadoutPresetPayload({ skillSlots: too })).toThrow(
      /SKILL_TOO_MANY/,
    );
  });

  it('skillSlots = null → null (không thay đổi skill khi apply)', () => {
    expect(parseLoadoutPresetPayload({ skillSlots: null }).skillSlots).toBeNull();
  });

  it('skillSlots reject element non-string', () => {
    expect(() =>
      parseLoadoutPresetPayload({ skillSlots: [42 as unknown as string] }),
    ).toThrow(/SKILL_KEY_INVALID/);
  });

  it('artifactSlots trim + reject slot invalid', () => {
    const out = parseLoadoutPresetPayload({
      artifactSlots: { MAIN_ARTIFACT_V2: '  art_1  ' },
    });
    expect(out.artifactSlots).toEqual({ MAIN_ARTIFACT_V2: 'art_1' });
  });

  it('artifactSlots reject slot key sai', () => {
    expect(() =>
      parseLoadoutPresetPayload({
        artifactSlots: { WEAPON: 'art_1' } as never,
      }),
    ).toThrow(/ARTIFACT_SLOT_INVALID/);
  });

  it('artifactSlots reject duplicate ids', () => {
    expect(() =>
      parseLoadoutPresetPayload({
        artifactSlots: {
          MAIN_ARTIFACT_V2: 'art_x',
          DEFENSE_ARTIFACT_V2: 'art_x',
        },
      }),
    ).toThrow(/ARTIFACT_DUPLICATE_ITEM/);
  });

  it('artifactSlots = null → null (không thay đổi artifact khi apply)', () => {
    expect(parseLoadoutPresetPayload({ artifactSlots: null }).artifactSlots).toBeNull();
  });
});

describe('defaultFlagFieldForMode', () => {
  it('map mỗi mode sang field default', () => {
    expect(defaultFlagFieldForMode('PVE')).toBe('isDefaultForPve');
    expect(defaultFlagFieldForMode('PVP')).toBe('isDefaultForPvp');
    expect(defaultFlagFieldForMode('BOSS')).toBe('isDefaultForBoss');
    expect(defaultFlagFieldForMode('CUSTOM')).toBeNull();
  });
});
