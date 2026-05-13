/**
 * Phase QOL-2 — Loadout Preset PvE / PvP / Boss service.
 *
 * Server-authoritative CRUD + apply. Apply là `$transaction` atomic:
 *   1. Validate ownership (gear inventoryItemId, skillKey learned, artifactId).
 *   2. Unequip TẤT CẢ slot tương ứng (gear, skill, artifact) cho character.
 *   3. Equip lại theo preset.
 *
 * Nếu thiếu reference (item bị xoá / skill chưa học / artifact bị xoá) →
 * KHÔNG apply một phần, trả warnings cho UI + giữ trạng thái cũ.
 *
 * Lưu ý: KHÔNG đụng combat formula, KHÔNG đụng Reward/Currency/Quest,
 * KHÔNG đụng Story V2.
 */
import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  LOADOUT_PRESET_PER_CHARACTER_MAX,
  LoadoutPresetValidationError,
  parseLoadoutPresetPayload,
  validatePresetMode,
  validatePresetName,
  type LoadoutApplyResult,
  type LoadoutApplyWarning,
  type LoadoutPresetMode,
  type LoadoutPresetView,
} from '@xuantoi/shared';
import type { EquipSlot } from '@xuantoi/shared';
import type { ArtifactEquipSlot } from '@xuantoi/shared';
import { PrismaService } from '../../common/prisma.service';

export type LoadoutPresetErrorCode =
  | 'LOADOUT_PRESET_NOT_FOUND'
  | 'LOADOUT_PRESET_NAME_TAKEN'
  | 'LOADOUT_PRESET_NAME_INVALID'
  | 'LOADOUT_PRESET_MODE_INVALID'
  | 'LOADOUT_PRESET_PAYLOAD_INVALID'
  | 'LOADOUT_PRESET_LIMIT_REACHED';

export class LoadoutPresetError extends Error {
  constructor(public readonly code: LoadoutPresetErrorCode) {
    super(code);
    this.name = 'LoadoutPresetError';
  }
}

/** Input nhận từ controller cho create/update. */
export interface LoadoutPresetWriteInput {
  name: string;
  mode: LoadoutPresetMode;
  equipmentSlots?: Partial<Record<EquipSlot, string>> | null;
  skillSlots?: readonly string[] | null;
  artifactSlots?: Partial<Record<ArtifactEquipSlot, string>> | null;
}

@Injectable()
export class LoadoutPresetService {
  constructor(private readonly prisma: PrismaService) {}

  // -----------------------------------------------------------------------
  // CRUD
  // -----------------------------------------------------------------------

  async list(characterId: string): Promise<LoadoutPresetView[]> {
    const rows = await this.prisma.characterLoadoutPreset.findMany({
      where: { characterId },
      orderBy: [
        { isDefaultForPve: 'desc' },
        { isDefaultForPvp: 'desc' },
        { isDefaultForBoss: 'desc' },
        { updatedAt: 'desc' },
      ],
    });
    return rows.map(toView);
  }

  async get(characterId: string, id: string): Promise<LoadoutPresetView> {
    const row = await this.prisma.characterLoadoutPreset.findUnique({
      where: { id },
    });
    if (!row || row.characterId !== characterId) {
      throw new LoadoutPresetError('LOADOUT_PRESET_NOT_FOUND');
    }
    return toView(row);
  }

  async create(
    characterId: string,
    raw: LoadoutPresetWriteInput,
  ): Promise<LoadoutPresetView> {
    const { name, mode, payload } = this.parseWriteInput(raw);

    const existingCount = await this.prisma.characterLoadoutPreset.count({
      where: { characterId },
    });
    if (existingCount >= LOADOUT_PRESET_PER_CHARACTER_MAX) {
      throw new LoadoutPresetError('LOADOUT_PRESET_LIMIT_REACHED');
    }

    try {
      const row = await this.prisma.characterLoadoutPreset.create({
        data: {
          characterId,
          name,
          mode,
          equipmentSlotJson: payload.equipmentSlots as Prisma.InputJsonValue,
          skillSlotJson:
            payload.skillSlots === null
              ? Prisma.JsonNull
              : (payload.skillSlots as Prisma.InputJsonValue),
          artifactSlotJson:
            payload.artifactSlots === null
              ? Prisma.JsonNull
              : (payload.artifactSlots as Prisma.InputJsonValue),
        },
      });
      return toView(row);
    } catch (e) {
      if (
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === 'P2002'
      ) {
        throw new LoadoutPresetError('LOADOUT_PRESET_NAME_TAKEN');
      }
      throw e;
    }
  }

  async update(
    characterId: string,
    id: string,
    raw: Partial<LoadoutPresetWriteInput>,
  ): Promise<LoadoutPresetView> {
    const existing = await this.prisma.characterLoadoutPreset.findUnique({
      where: { id },
    });
    if (!existing || existing.characterId !== characterId) {
      throw new LoadoutPresetError('LOADOUT_PRESET_NOT_FOUND');
    }

    const data: Prisma.CharacterLoadoutPresetUpdateInput = {};
    if (raw.name !== undefined) {
      try {
        data.name = validatePresetName(raw.name);
      } catch (e) {
        if (e instanceof LoadoutPresetValidationError) {
          throw new LoadoutPresetError('LOADOUT_PRESET_NAME_INVALID');
        }
        throw e;
      }
    }
    if (raw.mode !== undefined) {
      try {
        data.mode = validatePresetMode(raw.mode);
      } catch (e) {
        if (e instanceof LoadoutPresetValidationError) {
          throw new LoadoutPresetError('LOADOUT_PRESET_MODE_INVALID');
        }
        throw e;
      }
    }
    if (
      raw.equipmentSlots !== undefined ||
      raw.skillSlots !== undefined ||
      raw.artifactSlots !== undefined
    ) {
      let parsed;
      try {
        parsed = parseLoadoutPresetPayload({
          equipmentSlots: raw.equipmentSlots ?? null,
          skillSlots: raw.skillSlots ?? null,
          artifactSlots: raw.artifactSlots ?? null,
        });
      } catch (e) {
        if (e instanceof LoadoutPresetValidationError) {
          throw new LoadoutPresetError('LOADOUT_PRESET_PAYLOAD_INVALID');
        }
        throw e;
      }
      if (raw.equipmentSlots !== undefined) {
        data.equipmentSlotJson = parsed.equipmentSlots as Prisma.InputJsonValue;
      }
      if (raw.skillSlots !== undefined) {
        data.skillSlotJson =
          parsed.skillSlots === null
            ? Prisma.JsonNull
            : (parsed.skillSlots as Prisma.InputJsonValue);
      }
      if (raw.artifactSlots !== undefined) {
        data.artifactSlotJson =
          parsed.artifactSlots === null
            ? Prisma.JsonNull
            : (parsed.artifactSlots as Prisma.InputJsonValue);
      }
    }

    try {
      const row = await this.prisma.characterLoadoutPreset.update({
        where: { id },
        data,
      });
      return toView(row);
    } catch (e) {
      if (
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === 'P2002'
      ) {
        throw new LoadoutPresetError('LOADOUT_PRESET_NAME_TAKEN');
      }
      throw e;
    }
  }

  async delete(characterId: string, id: string): Promise<void> {
    const existing = await this.prisma.characterLoadoutPreset.findUnique({
      where: { id },
    });
    if (!existing || existing.characterId !== characterId) {
      throw new LoadoutPresetError('LOADOUT_PRESET_NOT_FOUND');
    }
    await this.prisma.characterLoadoutPreset.delete({ where: { id } });
  }

  /**
   * Set-default cho mode: chỉ 1 preset đang default per mode per character.
   * Nếu `presetId` không tương ứng mode (e.g. mode=CUSTOM) → reject.
   */
  async setDefault(
    characterId: string,
    id: string,
    mode: LoadoutPresetMode,
  ): Promise<LoadoutPresetView> {
    const existing = await this.prisma.characterLoadoutPreset.findUnique({
      where: { id },
    });
    if (!existing || existing.characterId !== characterId) {
      throw new LoadoutPresetError('LOADOUT_PRESET_NOT_FOUND');
    }
    if (mode === 'CUSTOM') {
      throw new LoadoutPresetError('LOADOUT_PRESET_MODE_INVALID');
    }
    const field =
      mode === 'PVE'
        ? 'isDefaultForPve'
        : mode === 'PVP'
          ? 'isDefaultForPvp'
          : 'isDefaultForBoss';

    await this.prisma.$transaction(async (tx) => {
      // Bỏ default cờ trên các preset khác cùng character, cùng mode.
      await tx.characterLoadoutPreset.updateMany({
        where: { characterId, [field]: true } as never,
        data: { [field]: false } as never,
      });
      await tx.characterLoadoutPreset.update({
        where: { id },
        data: { [field]: true } as never,
      });
    });

    const row = await this.prisma.characterLoadoutPreset.findUnique({
      where: { id },
    });
    if (!row) throw new LoadoutPresetError('LOADOUT_PRESET_NOT_FOUND');
    return toView(row);
  }

  // -----------------------------------------------------------------------
  // Apply
  // -----------------------------------------------------------------------

  /**
   * Apply preset atomic. Validate ownership trước; chỉ rewrite trong cùng
   * `$transaction`. Item missing → warnings + KHÔNG apply.
   */
  async apply(characterId: string, id: string): Promise<LoadoutApplyResult> {
    const preset = await this.prisma.characterLoadoutPreset.findUnique({
      where: { id },
    });
    if (!preset || preset.characterId !== characterId) {
      throw new LoadoutPresetError('LOADOUT_PRESET_NOT_FOUND');
    }

    const equipmentSlots = preset.equipmentSlotJson as Partial<
      Record<EquipSlot, string>
    >;
    const skillSlots = preset.skillSlotJson as readonly string[] | null;
    const artifactSlots = preset.artifactSlotJson as Partial<
      Record<ArtifactEquipSlot, string>
    > | null;

    const warnings: LoadoutApplyWarning[] = [];

    // 1. Validate equipment ownership.
    const equipmentEntries = Object.entries(equipmentSlots).filter(
      ([, v]) => typeof v === 'string' && v.length > 0,
    ) as [EquipSlot, string][];
    const equipmentIds = equipmentEntries.map(([, id]) => id);
    const ownedEquipment = equipmentIds.length
      ? await this.prisma.inventoryItem.findMany({
          where: { id: { in: equipmentIds }, characterId },
          select: { id: true },
        })
      : [];
    const ownedEquipmentIds = new Set(ownedEquipment.map((r) => r.id));
    for (const [slot, invId] of equipmentEntries) {
      if (!ownedEquipmentIds.has(invId)) {
        warnings.push({ code: 'EQUIPMENT_MISSING', ref: invId, slot });
      }
    }

    // 2. Validate skill learned.
    const skillsToEquip = skillSlots ?? null;
    let ownedSkillKeys: Set<string> = new Set();
    if (skillsToEquip && skillsToEquip.length > 0) {
      const rows = await this.prisma.characterSkill.findMany({
        where: { characterId, skillKey: { in: skillsToEquip.slice() } },
        select: { skillKey: true },
      });
      ownedSkillKeys = new Set(rows.map((r) => r.skillKey));
      for (const k of skillsToEquip) {
        if (!ownedSkillKeys.has(k)) {
          warnings.push({ code: 'SKILL_NOT_LEARNED', ref: k });
        }
      }
    }

    // 3. Validate artifact ownership.
    const artifactEntries = artifactSlots
      ? (Object.entries(artifactSlots).filter(
          ([, v]) => typeof v === 'string' && v.length > 0,
        ) as [ArtifactEquipSlot, string][])
      : [];
    const artifactIds = artifactEntries.map(([, id]) => id);
    const ownedArtifacts = artifactIds.length
      ? await this.prisma.characterArtifactV2.findMany({
          where: { id: { in: artifactIds }, characterId },
          select: { id: true },
        })
      : [];
    const ownedArtifactIds = new Set(ownedArtifacts.map((r) => r.id));
    for (const [slot, artId] of artifactEntries) {
      if (!ownedArtifactIds.has(artId)) {
        warnings.push({ code: 'ARTIFACT_MISSING', ref: artId, slot });
      }
    }

    // Nếu có warning → KHÔNG apply (transaction-safe).
    if (warnings.length > 0) {
      return {
        preset: toView(preset),
        warnings,
        appliedEquipmentCount: 0,
        appliedSkillCount: 0,
        appliedArtifactCount: 0,
      };
    }

    // 4. Apply atomic.
    await this.prisma.$transaction(async (tx) => {
      // Equipment: clear hết equippedSlot character → set theo preset.
      await tx.inventoryItem.updateMany({
        where: { characterId, equippedSlot: { not: null } },
        data: { equippedSlot: null },
      });
      for (const [slot, invId] of equipmentEntries) {
        await tx.inventoryItem.update({
          where: { id: invId },
          data: { equippedSlot: slot },
        });
      }

      // Skill: chỉ rewrite khi preset có skillSlots field set (null = giữ nguyên).
      if (skillsToEquip !== null) {
        await tx.characterSkill.updateMany({
          where: { characterId, isEquipped: true },
          data: { isEquipped: false },
        });
        if (skillsToEquip.length > 0) {
          await tx.characterSkill.updateMany({
            where: { characterId, skillKey: { in: skillsToEquip.slice() } },
            data: { isEquipped: true },
          });
        }
      }

      // Artifact V2: tương tự.
      if (artifactSlots !== null) {
        await tx.characterArtifactV2.updateMany({
          where: { characterId, equippedSlot: { not: null } },
          data: { equippedSlot: null },
        });
        for (const [slot, artId] of artifactEntries) {
          await tx.characterArtifactV2.update({
            where: { id: artId },
            data: { equippedSlot: slot },
          });
        }
      }
    });

    return {
      preset: toView(preset),
      warnings: [],
      appliedEquipmentCount: equipmentEntries.length,
      appliedSkillCount: skillsToEquip?.length ?? 0,
      appliedArtifactCount: artifactEntries.length,
    };
  }

  // -----------------------------------------------------------------------
  // Internals
  // -----------------------------------------------------------------------

  private parseWriteInput(raw: LoadoutPresetWriteInput): {
    name: string;
    mode: LoadoutPresetMode;
    payload: ReturnType<typeof parseLoadoutPresetPayload>;
  } {
    let name: string;
    try {
      name = validatePresetName(raw.name);
    } catch (e) {
      if (e instanceof LoadoutPresetValidationError) {
        throw new LoadoutPresetError('LOADOUT_PRESET_NAME_INVALID');
      }
      throw e;
    }
    let mode: LoadoutPresetMode;
    try {
      mode = validatePresetMode(raw.mode);
    } catch (e) {
      if (e instanceof LoadoutPresetValidationError) {
        throw new LoadoutPresetError('LOADOUT_PRESET_MODE_INVALID');
      }
      throw e;
    }
    let payload;
    try {
      payload = parseLoadoutPresetPayload({
        equipmentSlots: raw.equipmentSlots ?? null,
        skillSlots: raw.skillSlots ?? null,
        artifactSlots: raw.artifactSlots ?? null,
      });
    } catch (e) {
      if (e instanceof LoadoutPresetValidationError) {
        throw new LoadoutPresetError('LOADOUT_PRESET_PAYLOAD_INVALID');
      }
      throw e;
    }
    return { name, mode, payload };
  }
}

function toView(row: {
  id: string;
  name: string;
  mode: string;
  equipmentSlotJson: Prisma.JsonValue;
  skillSlotJson: Prisma.JsonValue;
  artifactSlotJson: Prisma.JsonValue;
  isDefaultForPve: boolean;
  isDefaultForPvp: boolean;
  isDefaultForBoss: boolean;
  createdAt: Date;
  updatedAt: Date;
}): LoadoutPresetView {
  return {
    id: row.id,
    name: row.name,
    mode: row.mode as LoadoutPresetMode,
    equipmentSlots:
      (row.equipmentSlotJson as Partial<Record<EquipSlot, string>>) ?? {},
    skillSlots:
      row.skillSlotJson === null
        ? null
        : ((row.skillSlotJson as unknown as string[]) ?? null),
    artifactSlots:
      row.artifactSlotJson === null
        ? null
        : ((row.artifactSlotJson as Partial<
            Record<ArtifactEquipSlot, string>
          >) ?? null),
    isDefaultForPve: row.isDefaultForPve,
    isDefaultForPvp: row.isDefaultForPvp,
    isDefaultForBoss: row.isDefaultForBoss,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
