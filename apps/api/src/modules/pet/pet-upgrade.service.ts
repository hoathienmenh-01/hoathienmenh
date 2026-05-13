/**
 * Phase 35.0C — Pet upgrade / evolution service.
 *
 * Server-authoritative material + currency consume. Atomic transaction:
 *   - feed exp item → level up (cap maxLevel(quality), gated by breakthrough)
 *   - star-up → consume shard
 *   - breakthrough → consume material + linh thạch, unlock level grow
 *   - evolve → consume material + linh thạch, advance evolutionStage,
 *              unlock skill catalog ref
 *   - skill upgrade → consume material + linh thạch, increment skill level
 *
 * Mọi cost qua InventoryService / CurrencyService / PetShardService — KHÔNG
 * direct mutate.
 */
import { Injectable } from '@nestjs/common';
import {
  petByKey,
  petSkillByKey,
  petBreakthroughCost,
  petExpForItem,
  petExpRequiredForLevel,
  petStarUpShardCost,
  petSkillUpgradeCost,
  PET_EXP_ITEMS,
  PET_MAX_LEVEL_DEFAULT,
  PET_BREAKTHROUGH_LEVELS,
  PET_STAR_LIMIT_DEFAULT,
  type PetCatalogEntry,
} from '@xuantoi/shared';
import { CurrencyKind } from '@prisma/client';

import { PrismaService } from '../../common/prisma.service';
import { InventoryService } from '../inventory/inventory.service';
import { CurrencyService } from '../character/currency.service';
import { PetShardService } from './pet-shard.service';

export class PetUpgradeError extends Error {
  constructor(public code: string) {
    super(code);
  }
}

@Injectable()
export class PetUpgradeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly inventory: InventoryService,
    private readonly currency: CurrencyService,
    private readonly shards: PetShardService,
  ) {}

  /**
   * Feed N exp items lên pet. Lên level dần đến cap breakthrough hoặc max
   * level (theo quality).
   */
  async feed(
    characterId: string,
    characterPetId: string,
    itemKey: string,
    qty: number,
  ): Promise<{ level: number; exp: number }> {
    if (qty <= 0) throw new PetUpgradeError('PET_FEED_INVALID_QTY');
    if (!(itemKey in PET_EXP_ITEMS)) throw new PetUpgradeError('PET_FEED_INVALID_ITEM');
    return this.prisma.$transaction(async (tx) => {
      const row = await tx.characterPet.findUnique({ where: { id: characterPetId } });
      if (!row || row.characterId !== characterId) {
        throw new PetUpgradeError('PET_INSTANCE_NOT_FOUND');
      }
      const def = petByKey(row.petKey);
      if (!def) throw new PetUpgradeError('PET_NOT_FOUND');

      // Consume item.
      await this.inventory.consumeManyByItemKeyTx(tx, characterId, itemKey, qty, {
        reason: 'PET_FEED_COST',
        refType: 'CharacterPet',
        refId: characterPetId,
      });

      // Compute new level/exp. Cap by quality max level + breakthrough gate.
      const maxLevel = this.effectiveMaxLevel(def);
      const breakLevel = this.nextBreakthroughGate(row.level);
      const capLevel = Math.min(maxLevel, breakLevel);

      let level = row.level;
      let exp = row.exp + petExpForItem(itemKey, qty);
      while (level < capLevel) {
        const req = petExpRequiredForLevel(level);
        if (exp >= req) {
          exp -= req;
          level += 1;
        } else break;
      }
      if (level >= capLevel) exp = 0;

      await tx.characterPet.update({
        where: { id: characterPetId },
        data: { level, exp },
      });
      return { level, exp };
    });
  }

  async starUp(
    characterId: string,
    characterPetId: string,
  ): Promise<{ star: number }> {
    return this.prisma.$transaction(async (tx) => {
      const row = await tx.characterPet.findUnique({ where: { id: characterPetId } });
      if (!row || row.characterId !== characterId) {
        throw new PetUpgradeError('PET_INSTANCE_NOT_FOUND');
      }
      const def = petByKey(row.petKey);
      if (!def) throw new PetUpgradeError('PET_NOT_FOUND');
      const starLimit = def.starLimit ?? PET_STAR_LIMIT_DEFAULT;
      if (row.star >= starLimit) throw new PetUpgradeError('PET_STAR_AT_MAX');
      const target = row.star + 1;
      const cost = petStarUpShardCost(target);
      if (cost <= 0) throw new PetUpgradeError('PET_STAR_COST_INVALID');
      await this.shards.consumeTx(tx, characterId, row.petKey, cost);
      const upd = await tx.characterPet.update({
        where: { id: characterPetId },
        data: { star: target },
      });
      return { star: upd.star };
    });
  }

  async breakthrough(
    characterId: string,
    characterPetId: string,
  ): Promise<{ level: number }> {
    return this.prisma.$transaction(async (tx) => {
      const row = await tx.characterPet.findUnique({ where: { id: characterPetId } });
      if (!row || row.characterId !== characterId) {
        throw new PetUpgradeError('PET_INSTANCE_NOT_FOUND');
      }
      if (!(PET_BREAKTHROUGH_LEVELS as readonly number[]).includes(row.level)) {
        throw new PetUpgradeError('PET_BREAKTHROUGH_NOT_AT_GATE');
      }
      const def = petByKey(row.petKey);
      if (!def) throw new PetUpgradeError('PET_NOT_FOUND');
      if (row.level >= this.effectiveMaxLevel(def)) {
        throw new PetUpgradeError('PET_LEVEL_AT_MAX');
      }
      const cost = petBreakthroughCost(row.level);
      if (!cost) throw new PetUpgradeError('PET_BREAKTHROUGH_COST_INVALID');
      for (const m of cost.materials) {
        await this.inventory.consumeManyByItemKeyTx(
          tx,
          characterId,
          m.itemKey,
          m.qty,
          {
            reason: 'PET_UPGRADE_COST',
            refType: 'CharacterPet',
            refId: characterPetId,
            extra: { kind: 'BREAKTHROUGH', fromLevel: row.level },
          },
        );
      }
      if (cost.linhThachCost > 0) {
        await this.currency.applyTx(tx, {
          characterId,
          currency: CurrencyKind.LINH_THACH,
          delta: BigInt(-cost.linhThachCost),
          reason: 'PET_BREAKTHROUGH_COST',
          refType: 'CharacterPet',
          refId: characterPetId,
        });
      }
      const upd = await tx.characterPet.update({
        where: { id: characterPetId },
        data: { level: cost.toLevel },
      });
      return { level: upd.level };
    });
  }

  async evolve(
    characterId: string,
    characterPetId: string,
  ): Promise<{ evolutionStage: number }> {
    return this.prisma.$transaction(async (tx) => {
      const row = await tx.characterPet.findUnique({ where: { id: characterPetId } });
      if (!row || row.characterId !== characterId) {
        throw new PetUpgradeError('PET_INSTANCE_NOT_FOUND');
      }
      const def = petByKey(row.petKey);
      if (!def) throw new PetUpgradeError('PET_NOT_FOUND');
      const next = row.evolutionStage + 1;
      const stage = def.evolutionStages?.find((s) => s.stage === next);
      if (!stage) throw new PetUpgradeError('PET_EVOLUTION_AT_MAX');
      if (row.level < stage.requirements.minLevel) {
        throw new PetUpgradeError('PET_EVOLUTION_LEVEL_NOT_MET');
      }
      if (row.star < stage.requirements.minStar) {
        throw new PetUpgradeError('PET_EVOLUTION_STAR_NOT_MET');
      }
      for (const m of stage.requirements.materials) {
        await this.inventory.consumeManyByItemKeyTx(
          tx,
          characterId,
          m.itemKey,
          m.qty,
          {
            reason: 'PET_UPGRADE_COST',
            refType: 'CharacterPet',
            refId: characterPetId,
            extra: { kind: 'EVOLUTION', targetStage: next },
          },
        );
      }
      if ((stage.requirements.linhThachCost ?? 0) > 0) {
        await this.currency.applyTx(tx, {
          characterId,
          currency: CurrencyKind.LINH_THACH,
          delta: BigInt(-(stage.requirements.linhThachCost ?? 0)),
          reason: 'PET_EVOLUTION_COST',
          refType: 'CharacterPet',
          refId: characterPetId,
        });
      }
      const upd = await tx.characterPet.update({
        where: { id: characterPetId },
        data: { evolutionStage: next },
      });
      return { evolutionStage: upd.evolutionStage };
    });
  }

  async upgradeSkill(
    characterId: string,
    characterPetId: string,
    skillKey: string,
  ): Promise<{ skillKey: string; level: number }> {
    return this.prisma.$transaction(async (tx) => {
      const row = await tx.characterPet.findUnique({ where: { id: characterPetId } });
      if (!row || row.characterId !== characterId) {
        throw new PetUpgradeError('PET_INSTANCE_NOT_FOUND');
      }
      const def = petByKey(row.petKey);
      if (!def) throw new PetUpgradeError('PET_NOT_FOUND');
      if (!def.skillKeys.includes(skillKey)) {
        throw new PetUpgradeError('PET_SKILL_NOT_OWNED');
      }
      const skill = petSkillByKey(skillKey);
      if (!skill) throw new PetUpgradeError('PET_SKILL_NOT_FOUND');
      const skillLevels = (row.skillLevelsJson as Record<string, number>) ?? {};
      const cur = skillLevels[skillKey] ?? 0;
      if (cur >= skill.maxLevel) throw new PetUpgradeError('PET_SKILL_AT_MAX');
      const cost = petSkillUpgradeCost(cur);
      for (const m of cost.materials) {
        await this.inventory.consumeManyByItemKeyTx(
          tx,
          characterId,
          m.itemKey,
          m.qty,
          {
            reason: 'PET_SKILL_UPGRADE_COST',
            refType: 'CharacterPet',
            refId: characterPetId,
            extra: { skillKey, targetLevel: cur + 1 },
          },
        );
      }
      if (cost.linhThachCost > 0) {
        await this.currency.applyTx(tx, {
          characterId,
          currency: CurrencyKind.LINH_THACH,
          delta: BigInt(-cost.linhThachCost),
          reason: 'PET_SKILL_UPGRADE_COST',
          refType: 'CharacterPet',
          refId: characterPetId,
          meta: { skillKey, targetLevel: cur + 1 },
        });
      }
      const newSkillLevels = { ...skillLevels, [skillKey]: cur + 1 };
      await tx.characterPet.update({
        where: { id: characterPetId },
        data: { skillLevelsJson: newSkillLevels },
      });
      return { skillKey, level: cur + 1 };
    });
  }

  private effectiveMaxLevel(def: PetCatalogEntry): number {
    return def.maxLevelByQuality?.[def.quality] ?? PET_MAX_LEVEL_DEFAULT[def.quality];
  }

  private nextBreakthroughGate(currentLevel: number): number {
    for (const g of PET_BREAKTHROUGH_LEVELS) {
      if (currentLevel < g) return g;
    }
    return Number.POSITIVE_INFINITY;
  }
}
