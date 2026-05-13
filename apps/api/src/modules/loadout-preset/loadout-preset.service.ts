import { Injectable } from '@nestjs/common';
import {
  canEquipItemAtRealm,
  itemByKeyWithProgression,
  realmByKey,
  type EquipSlot,
} from '@xuantoi/shared';
import { PrismaService } from '../../common/prisma.service';

/**
 * Phase 34.4 — Loadout Preset PvE/PvP/Boss/Cultivation.
 *
 * Lưu/nạp bộ trang bị nhanh cho từng context. Snapshot lưu ID-only — apply
 * path resolve ID tại runtime để bắt buộc validate ownership + realm gate.
 *
 * Reward guardrails:
 *  - KHÔNG mint currency / item — preset chỉ là chuyển equippedSlot trên các
 *    `InventoryItem` đã thuộc character.
 *  - Apply atomic via `$transaction` — nếu 1 slot fail thì ROLLBACK toàn bộ
 *    (no partial apply).
 *  - Validate: item exists, owns item, đủ realm/level, không locked-out.
 *  - Idempotency: apply lại preset cũ ⇒ skip slot đã đúng item.
 */
export const LOADOUT_PRESET_TYPES = [
  'PVE',
  'PVP',
  'BOSS',
  'CULTIVATION',
  'CUSTOM',
] as const;
export type LoadoutPresetType = (typeof LOADOUT_PRESET_TYPES)[number];

export const LOADOUT_PRESET_MAX_PER_CHARACTER = 5;
export const LOADOUT_PRESET_NAME_MAX = 32;

const LOADOUT_EQUIP_SLOTS: readonly EquipSlot[] = [
  'WEAPON',
  'ARMOR',
  'BELT',
  'BOOTS',
  'HAT',
  'TRAM',
  'ARTIFACT_1',
  'ARTIFACT_2',
  'ARTIFACT_3',
];

export interface LoadoutPresetEquipmentEntry {
  slot: EquipSlot;
  inventoryItemId: string;
}

export interface LoadoutPresetView {
  id: string;
  characterId: string;
  presetType: LoadoutPresetType;
  name: string;
  equipment: LoadoutPresetEquipmentEntry[];
  isActiveForPve: boolean;
  isActiveForPvp: boolean;
  isActiveForBoss: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface LoadoutPresetApplyReport {
  preset: LoadoutPresetView;
  applied: LoadoutPresetEquipmentEntry[];
  skipped: { slot: EquipSlot; reason: string }[];
}

export class LoadoutPresetError extends Error {
  constructor(public readonly code: string) {
    super(code);
    this.name = 'LoadoutPresetError';
  }
}

@Injectable()
export class LoadoutPresetService {
  constructor(private readonly prisma: PrismaService) {}

  private async getCharacterIdByUser(userId: string): Promise<string> {
    const c = await this.prisma.character.findUnique({
      where: { userId },
      select: { id: true },
    });
    if (!c) throw new LoadoutPresetError('NO_CHARACTER');
    return c.id;
  }

  /** List all presets for the current character. */
  async list(userId: string): Promise<LoadoutPresetView[]> {
    const characterId = await this.getCharacterIdByUser(userId);
    const rows = await this.prisma.characterLoadoutPreset.findMany({
      where: { characterId },
      orderBy: [{ presetType: 'asc' }, { createdAt: 'asc' }],
    });
    return rows.map((r) => this.toView(r));
  }

  async findOne(userId: string, presetId: string): Promise<LoadoutPresetView> {
    const characterId = await this.getCharacterIdByUser(userId);
    const row = await this.prisma.characterLoadoutPreset.findUnique({
      where: { id: presetId },
    });
    if (!row || row.characterId !== characterId) {
      throw new LoadoutPresetError('LOADOUT_PRESET_NOT_FOUND');
    }
    return this.toView(row);
  }

  /**
   * Create a new preset. Snapshot from current equipment is taken when
   * `equipment` is null (no input). Name max 32 chars.
   *
   * Constraints:
   *  - `presetType` UNIQUE per character ⇒ creating second PVE replaces err.
   *  - Up to LOADOUT_PRESET_MAX_PER_CHARACTER total presets per character.
   */
  async create(
    userId: string,
    input: {
      presetType: LoadoutPresetType;
      name: string;
      equipment?: LoadoutPresetEquipmentEntry[];
    },
  ): Promise<LoadoutPresetView> {
    const characterId = await this.getCharacterIdByUser(userId);
    this.validateName(input.name);
    if (!LOADOUT_PRESET_TYPES.includes(input.presetType)) {
      throw new LoadoutPresetError('LOADOUT_PRESET_TYPE_INVALID');
    }
    const existingCount = await this.prisma.characterLoadoutPreset.count({
      where: { characterId },
    });
    if (existingCount >= LOADOUT_PRESET_MAX_PER_CHARACTER) {
      throw new LoadoutPresetError('LOADOUT_PRESET_LIMIT_REACHED');
    }
    const existingByType = await this.prisma.characterLoadoutPreset.findUnique({
      where: {
        characterId_presetType: {
          characterId,
          presetType: input.presetType,
        },
      },
    });
    if (existingByType) {
      throw new LoadoutPresetError('LOADOUT_PRESET_TYPE_EXISTS');
    }
    const equipment = input.equipment
      ? this.validateEquipmentShape(input.equipment)
      : await this.snapshotCurrentEquipment(characterId);

    const created = await this.prisma.characterLoadoutPreset.create({
      data: {
        characterId,
        presetType: input.presetType,
        name: input.name.trim(),
        equipmentJson: equipment as never,
      },
    });
    return this.toView(created);
  }

  /**
   * Update name and/or equipment snapshot. Each is optional. `equipment`
   * replaces the entire snapshot — no merge semantics.
   */
  async update(
    userId: string,
    presetId: string,
    input: { name?: string; equipment?: LoadoutPresetEquipmentEntry[] },
  ): Promise<LoadoutPresetView> {
    const characterId = await this.getCharacterIdByUser(userId);
    const existing = await this.prisma.characterLoadoutPreset.findUnique({
      where: { id: presetId },
    });
    if (!existing || existing.characterId !== characterId) {
      throw new LoadoutPresetError('LOADOUT_PRESET_NOT_FOUND');
    }
    const data: Record<string, unknown> = {};
    if (input.name !== undefined) {
      this.validateName(input.name);
      data.name = input.name.trim();
    }
    if (input.equipment !== undefined) {
      data.equipmentJson = this.validateEquipmentShape(
        input.equipment,
      ) as never;
    }
    if (Object.keys(data).length === 0) {
      return this.toView(existing);
    }
    const updated = await this.prisma.characterLoadoutPreset.update({
      where: { id: presetId },
      data,
    });
    return this.toView(updated);
  }

  async delete(userId: string, presetId: string): Promise<void> {
    const characterId = await this.getCharacterIdByUser(userId);
    const existing = await this.prisma.characterLoadoutPreset.findUnique({
      where: { id: presetId },
    });
    if (!existing || existing.characterId !== characterId) {
      throw new LoadoutPresetError('LOADOUT_PRESET_NOT_FOUND');
    }
    await this.prisma.characterLoadoutPreset.delete({ where: { id: presetId } });
  }

  /**
   * Snapshot the character's current equipment into a new preset of the
   * given type. Convenience wrapper around `create()` with `equipment` =
   * derived from `InventoryItem.equippedSlot`.
   */
  async saveCurrent(
    userId: string,
    input: { presetType: LoadoutPresetType; name: string },
  ): Promise<LoadoutPresetView> {
    return this.create(userId, { presetType: input.presetType, name: input.name });
  }

  /**
   * Validate preset without applying — used by FE to grey out broken presets.
   * Returns the list of slot-level errors. Empty array ⇒ apply-safe.
   */
  async validate(
    userId: string,
    presetId: string,
  ): Promise<{ ok: boolean; errors: { slot: EquipSlot; code: string }[] }> {
    const characterId = await this.getCharacterIdByUser(userId);
    const existing = await this.prisma.characterLoadoutPreset.findUnique({
      where: { id: presetId },
    });
    if (!existing || existing.characterId !== characterId) {
      throw new LoadoutPresetError('LOADOUT_PRESET_NOT_FOUND');
    }
    const errors = await this.collectApplyErrors(
      characterId,
      this.parseEquipmentJson(existing.equipmentJson),
    );
    return { ok: errors.length === 0, errors };
  }

  /**
   * Atomic apply. Validates EVERY slot first; if ANY slot fails, throws
   * `LOADOUT_PRESET_APPLY_FAILED` with detail — NO partial equip.
   *
   * After validation:
   *  - For each (slot, inventoryItemId) in preset, set
   *    `inventoryItem.equippedSlot = slot`.
   *  - Items currently equipped at preset's slots BUT NOT in preset list ⇒
   *    set `equippedSlot=null` (i.e. unequip overwritten slots).
   *  - Items NOT in preset stay as-is.
   */
  async apply(
    userId: string,
    presetId: string,
  ): Promise<LoadoutPresetApplyReport> {
    const characterId = await this.getCharacterIdByUser(userId);
    const existing = await this.prisma.characterLoadoutPreset.findUnique({
      where: { id: presetId },
    });
    if (!existing || existing.characterId !== characterId) {
      throw new LoadoutPresetError('LOADOUT_PRESET_NOT_FOUND');
    }
    const entries = this.parseEquipmentJson(existing.equipmentJson);
    const errors = await this.collectApplyErrors(characterId, entries);
    if (errors.length > 0) {
      throw new LoadoutPresetError(
        `LOADOUT_PRESET_APPLY_FAILED:${errors[0]!.code}`,
      );
    }
    const skipped: { slot: EquipSlot; reason: string }[] = [];
    const applied: LoadoutPresetEquipmentEntry[] = [];
    await this.prisma.$transaction(async (tx) => {
      // Unequip current items occupying the preset's slots.
      const slotSet = new Set(entries.map((e) => e.slot));
      const currentEquipped = await tx.inventoryItem.findMany({
        where: { characterId, equippedSlot: { in: Array.from(slotSet) } },
      });
      for (const cur of currentEquipped) {
        // Only unequip if a different item takes its slot.
        const next = entries.find((e) => e.slot === cur.equippedSlot);
        if (!next || next.inventoryItemId === cur.id) continue;
        await tx.inventoryItem.update({
          where: { id: cur.id },
          data: { equippedSlot: null },
        });
      }
      // Apply each preset entry.
      for (const entry of entries) {
        const inv = await tx.inventoryItem.findUnique({
          where: { id: entry.inventoryItemId },
        });
        if (!inv || inv.characterId !== characterId) {
          skipped.push({ slot: entry.slot, reason: 'ITEM_GONE' });
          continue;
        }
        if (inv.equippedSlot === entry.slot) {
          applied.push(entry);
          continue;
        }
        await tx.inventoryItem.update({
          where: { id: inv.id },
          data: { equippedSlot: entry.slot },
        });
        applied.push(entry);
      }
    });
    const fresh = await this.prisma.characterLoadoutPreset.findUnique({
      where: { id: presetId },
    });
    return { preset: this.toView(fresh!), applied, skipped };
  }

  // ── internal helpers ───────────────────────────────────────────────────

  private validateName(name: string): void {
    const t = name?.trim?.() ?? '';
    if (t.length < 1) throw new LoadoutPresetError('LOADOUT_PRESET_NAME_EMPTY');
    if (t.length > LOADOUT_PRESET_NAME_MAX) {
      throw new LoadoutPresetError('LOADOUT_PRESET_NAME_TOO_LONG');
    }
  }

  private validateEquipmentShape(
    entries: LoadoutPresetEquipmentEntry[],
  ): LoadoutPresetEquipmentEntry[] {
    const seenSlots = new Set<EquipSlot>();
    for (const e of entries) {
      if (!LOADOUT_EQUIP_SLOTS.includes(e.slot)) {
        throw new LoadoutPresetError('LOADOUT_PRESET_SLOT_INVALID');
      }
      if (!e.inventoryItemId || typeof e.inventoryItemId !== 'string') {
        throw new LoadoutPresetError('LOADOUT_PRESET_ITEM_INVALID');
      }
      if (seenSlots.has(e.slot)) {
        throw new LoadoutPresetError('LOADOUT_PRESET_SLOT_DUPLICATE');
      }
      seenSlots.add(e.slot);
    }
    return entries.map((e) => ({
      slot: e.slot,
      inventoryItemId: e.inventoryItemId,
    }));
  }

  private async snapshotCurrentEquipment(
    characterId: string,
  ): Promise<LoadoutPresetEquipmentEntry[]> {
    const rows = await this.prisma.inventoryItem.findMany({
      where: { characterId, equippedSlot: { not: null } },
      select: { id: true, equippedSlot: true },
    });
    return rows.map((r) => ({
      slot: r.equippedSlot as EquipSlot,
      inventoryItemId: r.id,
    }));
  }

  private parseEquipmentJson(raw: unknown): LoadoutPresetEquipmentEntry[] {
    if (!Array.isArray(raw)) return [];
    const out: LoadoutPresetEquipmentEntry[] = [];
    for (const e of raw) {
      if (
        e &&
        typeof e === 'object' &&
        typeof (e as { slot?: unknown }).slot === 'string' &&
        typeof (e as { inventoryItemId?: unknown }).inventoryItemId === 'string'
      ) {
        const slot = (e as { slot: string }).slot as EquipSlot;
        if (LOADOUT_EQUIP_SLOTS.includes(slot)) {
          out.push({
            slot,
            inventoryItemId: (e as { inventoryItemId: string }).inventoryItemId,
          });
        }
      }
    }
    return out;
  }

  /**
   * Returns the list of validation errors blocking `apply()`. Empty array
   * means the preset is apply-safe.
   */
  private async collectApplyErrors(
    characterId: string,
    entries: LoadoutPresetEquipmentEntry[],
  ): Promise<{ slot: EquipSlot; code: string }[]> {
    const char = await this.prisma.character.findUnique({
      where: { id: characterId },
      select: { realmKey: true },
    });
    if (!char) {
      return entries.map((e) => ({ slot: e.slot, code: 'NO_CHARACTER' }));
    }
    const realmOrder = (realmByKey(char.realmKey)?.order ?? -1) + 1;
    const errors: { slot: EquipSlot; code: string }[] = [];
    for (const e of entries) {
      const inv = await this.prisma.inventoryItem.findUnique({
        where: { id: e.inventoryItemId },
      });
      if (!inv) {
        errors.push({ slot: e.slot, code: 'INVENTORY_ITEM_NOT_FOUND' });
        continue;
      }
      if (inv.characterId !== characterId) {
        errors.push({ slot: e.slot, code: 'INVENTORY_ITEM_NOT_OWNED' });
        continue;
      }
      const def = itemByKeyWithProgression(inv.itemKey);
      if (!def) {
        errors.push({ slot: e.slot, code: 'ITEM_NOT_FOUND' });
        continue;
      }
      if (!def.slot) {
        errors.push({ slot: e.slot, code: 'NOT_EQUIPPABLE' });
        continue;
      }
      // For multi-artifact items, allow any ARTIFACT_* slot when def.slot is
      // 'ARTIFACT_1' (artifact items are interchangeable across the 3 slots).
      const wantsArtifactSlot = e.slot.startsWith('ARTIFACT_');
      const defIsArtifact = def.slot.startsWith('ARTIFACT_');
      const slotMatches = wantsArtifactSlot && defIsArtifact
        ? true
        : def.slot === e.slot;
      if (!slotMatches) {
        errors.push({ slot: e.slot, code: 'WRONG_SLOT' });
        continue;
      }
      if (!canEquipItemAtRealm(def, realmOrder)) {
        errors.push({ slot: e.slot, code: 'EQUIPMENT_REALM_LOCKED' });
        continue;
      }
    }
    return errors;
  }

  private toView(row: {
    id: string;
    characterId: string;
    presetType: string;
    name: string;
    equipmentJson: unknown;
    isActiveForPve: boolean;
    isActiveForPvp: boolean;
    isActiveForBoss: boolean;
    createdAt: Date;
    updatedAt: Date;
  }): LoadoutPresetView {
    return {
      id: row.id,
      characterId: row.characterId,
      presetType: row.presetType as LoadoutPresetType,
      name: row.name,
      equipment: this.parseEquipmentJson(row.equipmentJson),
      isActiveForPve: row.isActiveForPve,
      isActiveForPvp: row.isActiveForPvp,
      isActiveForBoss: row.isActiveForBoss,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }
}
