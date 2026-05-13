/**
 * Phase 35.0 — Pet collection service.
 *
 * Ownership-side CRUD cho `CharacterPet`. Server-authoritative — mọi mutate
 * (equip/unequip/lock/rename) đi qua đây để guard invariants:
 *   - 1 equipped slot mặc định (`PET_EQUIP_SLOT_MAX_DEFAULT = 1`), bằng cách
 *     unequip pet đang equip ở slot tương ứng trước khi equip pet mới (atomic
 *     trong `$transaction`).
 *   - Pet locked → KHÔNG cho rename (mã safety) + KHÔNG cho admin force-revoke
 *     trừ khi force-unlock trước.
 *   - Custom name validate qua shared `validatePetCustomName` (profanity +
 *     length).
 *
 * Mọi grant pet (initial / box reward / shard exchange) đi qua
 * `grantPet(...)` để guarantee snapshot quality/rarity/element/source.
 */
import { Injectable } from '@nestjs/common';
import {
  petByKey,
  validatePetCustomName,
  PET_EQUIP_SLOT_MAX_DEFAULT,
  type PetCatalogEntry,
} from '@xuantoi/shared';
import type { Prisma } from '@prisma/client';

import { PrismaService } from '../../common/prisma.service';

export class PetCollectionError extends Error {
  constructor(public code: string) {
    super(code);
  }
}

export interface GrantPetInput {
  characterId: string;
  petKey: string;
  /**
   * Source ngữ nghĩa: `BOX` | `EVENT` | `DUNGEON` | `BOSS` | `ACHIEVEMENT`
   * | `ADMIN_GRANT` | `SHARD_EXCHANGE` | …
   */
  source: string;
}

export interface PetView {
  id: string;
  petKey: string;
  customName: string | null;
  level: number;
  exp: number;
  star: number;
  quality: string;
  rarity: string;
  element: string;
  evolutionStage: number;
  isLocked: boolean;
  isEquipped: boolean;
  equippedSlot: number | null;
  skillLevels: Record<string, number>;
  sourceType: string;
  obtainedAt: string;
}

@Injectable()
export class PetCollectionService {
  constructor(private readonly prisma: PrismaService) {}

  /** Grant 1 instance pet mới. Idempotency tuỳ caller (vd box log requestId). */
  async grantPet(
    input: GrantPetInput,
    tx?: Prisma.TransactionClient,
  ): Promise<PetView> {
    const def = petByKey(input.petKey);
    if (!def) throw new PetCollectionError('PET_NOT_FOUND');
    const db = tx ?? this.prisma;
    const row = await db.characterPet.create({
      data: {
        characterId: input.characterId,
        petKey: def.petKey,
        quality: def.quality,
        rarity: def.rarity,
        element: def.element,
        sourceType: input.source,
        skillLevelsJson: {},
      },
    });
    return this.toView(row);
  }

  async list(characterId: string): Promise<PetView[]> {
    const rows = await this.prisma.characterPet.findMany({
      where: { characterId },
      orderBy: [{ isEquipped: 'desc' }, { quality: 'desc' }, { obtainedAt: 'desc' }],
    });
    return rows.map((r) => this.toView(r));
  }

  async get(characterId: string, characterPetId: string): Promise<PetView> {
    const row = await this.prisma.characterPet.findUnique({
      where: { id: characterPetId },
    });
    if (!row || row.characterId !== characterId) {
      throw new PetCollectionError('PET_INSTANCE_NOT_FOUND');
    }
    return this.toView(row);
  }

  async equip(
    characterId: string,
    characterPetId: string,
    slotInput?: number,
  ): Promise<PetView> {
    const slot = slotInput ?? 0;
    if (slot < 0 || slot >= PET_EQUIP_SLOT_MAX_DEFAULT) {
      throw new PetCollectionError('PET_SLOT_OUT_OF_RANGE');
    }
    return this.prisma.$transaction(async (tx) => {
      const row = await tx.characterPet.findUnique({
        where: { id: characterPetId },
      });
      if (!row || row.characterId !== characterId) {
        throw new PetCollectionError('PET_INSTANCE_NOT_FOUND');
      }
      // Unequip pet đang ở slot này (nếu khác).
      await tx.characterPet.updateMany({
        where: {
          characterId,
          isEquipped: true,
          equippedSlot: slot,
          id: { not: characterPetId },
        },
        data: { isEquipped: false, equippedSlot: null },
      });
      const updated = await tx.characterPet.update({
        where: { id: characterPetId },
        data: { isEquipped: true, equippedSlot: slot },
      });
      return this.toView(updated);
    });
  }

  async unequip(
    characterId: string,
    characterPetId: string,
  ): Promise<PetView> {
    const row = await this.prisma.characterPet.findUnique({
      where: { id: characterPetId },
    });
    if (!row || row.characterId !== characterId) {
      throw new PetCollectionError('PET_INSTANCE_NOT_FOUND');
    }
    const updated = await this.prisma.characterPet.update({
      where: { id: characterPetId },
      data: { isEquipped: false, equippedSlot: null },
    });
    return this.toView(updated);
  }

  async lock(characterId: string, characterPetId: string): Promise<PetView> {
    return this.setLock(characterId, characterPetId, true);
  }

  async unlock(characterId: string, characterPetId: string): Promise<PetView> {
    return this.setLock(characterId, characterPetId, false);
  }

  private async setLock(
    characterId: string,
    characterPetId: string,
    isLocked: boolean,
  ): Promise<PetView> {
    const row = await this.prisma.characterPet.findUnique({
      where: { id: characterPetId },
    });
    if (!row || row.characterId !== characterId) {
      throw new PetCollectionError('PET_INSTANCE_NOT_FOUND');
    }
    const updated = await this.prisma.characterPet.update({
      where: { id: characterPetId },
      data: { isLocked },
    });
    return this.toView(updated);
  }

  async rename(
    characterId: string,
    characterPetId: string,
    name: string,
  ): Promise<PetView> {
    const v = validatePetCustomName(name);
    if (!v.ok) throw new PetCollectionError(`PET_NAME_${v.reason ?? 'INVALID'}`);
    const row = await this.prisma.characterPet.findUnique({
      where: { id: characterPetId },
    });
    if (!row || row.characterId !== characterId) {
      throw new PetCollectionError('PET_INSTANCE_NOT_FOUND');
    }
    if (row.isLocked) throw new PetCollectionError('PET_LOCKED');
    const updated = await this.prisma.characterPet.update({
      where: { id: characterPetId },
      data: { customName: name.trim() },
    });
    return this.toView(updated);
  }

  /** Get pet đang equip ở slot 0 (mặc định). Trả null nếu không có. */
  async getEquipped(characterId: string): Promise<{
    row: Awaited<ReturnType<typeof this.prisma.characterPet.findFirst>>;
    catalog: PetCatalogEntry | undefined;
  } | null> {
    const row = await this.prisma.characterPet.findFirst({
      where: { characterId, isEquipped: true, equippedSlot: 0 },
    });
    if (!row) return null;
    const catalog = petByKey(row.petKey);
    return { row, catalog };
  }

  private toView(row: {
    id: string;
    petKey: string;
    customName: string | null;
    level: number;
    exp: number;
    star: number;
    quality: string;
    rarity: string;
    element: string;
    evolutionStage: number;
    isLocked: boolean;
    isEquipped: boolean;
    equippedSlot: number | null;
    skillLevelsJson: unknown;
    sourceType: string;
    obtainedAt: Date;
  }): PetView {
    return {
      id: row.id,
      petKey: row.petKey,
      customName: row.customName,
      level: row.level,
      exp: row.exp,
      star: row.star,
      quality: row.quality,
      rarity: row.rarity,
      element: row.element,
      evolutionStage: row.evolutionStage,
      isLocked: row.isLocked,
      isEquipped: row.isEquipped,
      equippedSlot: row.equippedSlot,
      skillLevels:
        (row.skillLevelsJson as Record<string, number> | null) ?? {},
      sourceType: row.sourceType,
      obtainedAt: row.obtainedAt.toISOString(),
    };
  }
}
