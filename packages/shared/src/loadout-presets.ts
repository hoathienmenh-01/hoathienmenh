/**
 * Phase QOL-2 — Loadout Preset PvE / PvP / Boss / CUSTOM.
 *
 * Pure-function module: parser + validator + shape helpers, không import
 * Nest / Prisma. Cả FE + BE đều dùng được.
 *
 * Mỗi preset là snapshot 3 nhóm equip:
 *   - `equipmentSlots`: `Record<EquipSlot, inventoryItemId>` cho gear
 *     (`EquipSlot` ∈ `EQUIP_SLOTS` từ `./enums`).
 *   - `skillSlots`: `string[]` skillKey active (cap 4 — `MAX_ACTIVE_SKILLS`).
 *   - `artifactSlots`: `Record<ArtifactEquipSlot, characterArtifactId>` cho
 *     Pháp Bảo V2 (`ARTIFACT_EQUIP_SLOTS` từ `./artifacts-v2`).
 *
 * `mode` ∈ `LOADOUT_PRESET_MODES`. `name` 1..40 ký tự, unique per character
 * (enforced bằng `@@unique([characterId, name])`).
 *
 * `parseLoadoutPresetPayload` chuẩn hoá payload từ client / DB JSON về
 * `NormalizedLoadoutPresetPayload` — dùng trước khi validate ownership.
 */
import { EQUIP_SLOTS, type EquipSlot } from './enums';
import { ARTIFACT_EQUIP_SLOTS, type ArtifactEquipSlot } from './artifacts-v2';

export const LOADOUT_PRESET_MODES = ['PVE', 'PVP', 'BOSS', 'CUSTOM'] as const;
export type LoadoutPresetMode = (typeof LOADOUT_PRESET_MODES)[number];

export const LOADOUT_PRESET_NAME_MIN = 1;
export const LOADOUT_PRESET_NAME_MAX = 40;
export const LOADOUT_PRESET_PER_CHARACTER_MAX = 20;

/** Phase 11.2 cap MVP — 4 active skill đồng thời (xem `CharacterSkill.isEquipped`). */
export const MAX_ACTIVE_SKILLS = 4;

export interface LoadoutPresetPayload {
  /** `Record<EquipSlot, inventoryItemId>` — slot không cần thiết có thể bỏ. */
  equipmentSlots?: Partial<Record<EquipSlot, string>> | null;
  /** `string[]` skillKey active. Cap 4. */
  skillSlots?: readonly string[] | null;
  /** `Record<ArtifactEquipSlot, characterArtifactId>`. */
  artifactSlots?: Partial<Record<ArtifactEquipSlot, string>> | null;
}

export interface NormalizedLoadoutPresetPayload {
  equipmentSlots: Partial<Record<EquipSlot, string>>;
  skillSlots: string[] | null;
  artifactSlots: Partial<Record<ArtifactEquipSlot, string>> | null;
}

export class LoadoutPresetValidationError extends Error {
  constructor(public readonly code: LoadoutPresetValidationErrorCode) {
    super(code);
    this.name = 'LoadoutPresetValidationError';
  }
}

export type LoadoutPresetValidationErrorCode =
  | 'NAME_INVALID'
  | 'MODE_INVALID'
  | 'EQUIPMENT_SLOT_INVALID'
  | 'EQUIPMENT_ID_INVALID'
  | 'EQUIPMENT_DUPLICATE_ITEM'
  | 'SKILL_KEY_INVALID'
  | 'SKILL_DUPLICATE'
  | 'SKILL_TOO_MANY'
  | 'ARTIFACT_SLOT_INVALID'
  | 'ARTIFACT_ID_INVALID'
  | 'ARTIFACT_DUPLICATE_ITEM';

export function isLoadoutPresetMode(v: unknown): v is LoadoutPresetMode {
  return typeof v === 'string' && (LOADOUT_PRESET_MODES as readonly string[]).includes(v);
}

export function isEquipSlot(v: unknown): v is EquipSlot {
  return typeof v === 'string' && (EQUIP_SLOTS as readonly string[]).includes(v);
}

export function isArtifactEquipSlot(v: unknown): v is ArtifactEquipSlot {
  return (
    typeof v === 'string' &&
    (ARTIFACT_EQUIP_SLOTS as readonly string[]).includes(v)
  );
}

export function validatePresetName(name: unknown): string {
  if (typeof name !== 'string') {
    throw new LoadoutPresetValidationError('NAME_INVALID');
  }
  const trimmed = name.trim();
  if (
    trimmed.length < LOADOUT_PRESET_NAME_MIN ||
    trimmed.length > LOADOUT_PRESET_NAME_MAX
  ) {
    throw new LoadoutPresetValidationError('NAME_INVALID');
  }
  return trimmed;
}

export function validatePresetMode(mode: unknown): LoadoutPresetMode {
  if (!isLoadoutPresetMode(mode)) {
    throw new LoadoutPresetValidationError('MODE_INVALID');
  }
  return mode;
}

/**
 * Chuẩn hoá payload: trim string, lọc slot không hợp lệ, lọc id rỗng,
 * dedupe skillKey, enforce cap 4 active skill.
 *
 * Không kiểm tra ownership (cần DB). Chỉ syntactic validation.
 */
export function parseLoadoutPresetPayload(
  raw: LoadoutPresetPayload,
): NormalizedLoadoutPresetPayload {
  const equipmentSlots: Partial<Record<EquipSlot, string>> = {};
  if (raw.equipmentSlots) {
    const seen = new Set<string>();
    for (const [slotRaw, idRaw] of Object.entries(raw.equipmentSlots)) {
      if (!isEquipSlot(slotRaw)) {
        throw new LoadoutPresetValidationError('EQUIPMENT_SLOT_INVALID');
      }
      const id = typeof idRaw === 'string' ? idRaw.trim() : '';
      if (!id) {
        throw new LoadoutPresetValidationError('EQUIPMENT_ID_INVALID');
      }
      if (seen.has(id)) {
        throw new LoadoutPresetValidationError('EQUIPMENT_DUPLICATE_ITEM');
      }
      seen.add(id);
      equipmentSlots[slotRaw] = id;
    }
  }

  let skillSlots: string[] | null = null;
  if (raw.skillSlots !== undefined && raw.skillSlots !== null) {
    const cleaned: string[] = [];
    const seen = new Set<string>();
    for (const k of raw.skillSlots) {
      if (typeof k !== 'string') {
        throw new LoadoutPresetValidationError('SKILL_KEY_INVALID');
      }
      const key = k.trim();
      if (!key) {
        throw new LoadoutPresetValidationError('SKILL_KEY_INVALID');
      }
      if (seen.has(key)) {
        throw new LoadoutPresetValidationError('SKILL_DUPLICATE');
      }
      seen.add(key);
      cleaned.push(key);
    }
    if (cleaned.length > MAX_ACTIVE_SKILLS) {
      throw new LoadoutPresetValidationError('SKILL_TOO_MANY');
    }
    skillSlots = cleaned;
  }

  let artifactSlots: Partial<Record<ArtifactEquipSlot, string>> | null = null;
  if (raw.artifactSlots !== undefined && raw.artifactSlots !== null) {
    artifactSlots = {};
    const seen = new Set<string>();
    for (const [slotRaw, idRaw] of Object.entries(raw.artifactSlots)) {
      if (!isArtifactEquipSlot(slotRaw)) {
        throw new LoadoutPresetValidationError('ARTIFACT_SLOT_INVALID');
      }
      const id = typeof idRaw === 'string' ? idRaw.trim() : '';
      if (!id) {
        throw new LoadoutPresetValidationError('ARTIFACT_ID_INVALID');
      }
      if (seen.has(id)) {
        throw new LoadoutPresetValidationError('ARTIFACT_DUPLICATE_ITEM');
      }
      seen.add(id);
      artifactSlots[slotRaw] = id;
    }
  }

  return { equipmentSlots, skillSlots, artifactSlots };
}

/** View envelope dùng FE + API. */
export interface LoadoutPresetView {
  id: string;
  name: string;
  mode: LoadoutPresetMode;
  equipmentSlots: Partial<Record<EquipSlot, string>>;
  skillSlots: string[] | null;
  artifactSlots: Partial<Record<ArtifactEquipSlot, string>> | null;
  isDefaultForPve: boolean;
  isDefaultForPvp: boolean;
  isDefaultForBoss: boolean;
  createdAt: string;
  updatedAt: string;
}

/** Apply warning code (1 chuỗi mỗi phần tử thiếu / bị bỏ). */
export type LoadoutApplyWarningCode =
  | 'EQUIPMENT_MISSING'
  | 'SKILL_NOT_LEARNED'
  | 'ARTIFACT_MISSING';

export interface LoadoutApplyWarning {
  code: LoadoutApplyWarningCode;
  /** ID hoặc key bị thiếu (inventoryItemId / skillKey / characterArtifactId). */
  ref: string;
  /** Slot liên quan (nếu áp dụng). */
  slot?: string;
}

export interface LoadoutApplyResult {
  preset: LoadoutPresetView;
  warnings: LoadoutApplyWarning[];
  appliedEquipmentCount: number;
  appliedSkillCount: number;
  appliedArtifactCount: number;
}

/** Trả về cờ default tương ứng `mode`. CUSTOM → null. */
export function defaultFlagFieldForMode(
  mode: LoadoutPresetMode,
): 'isDefaultForPve' | 'isDefaultForPvp' | 'isDefaultForBoss' | null {
  if (mode === 'PVE') return 'isDefaultForPve';
  if (mode === 'PVP') return 'isDefaultForPvp';
  if (mode === 'BOSS') return 'isDefaultForBoss';
  return null;
}
