import { Injectable } from '@nestjs/common';
import { CurrencyKind, type Prisma } from '@prisma/client';
import {
  ARTIFACT_BLUEPRINT_CATALOG,
  ARTIFACT_CATALOG_V2,
  aggregateArtifactV2Snapshot,
  allowedSlotsForArtifactType,
  artifactAwakenSuccessRate,
  artifactRefineSuccessRate,
  artifactStarUpSuccessRate,
  artifactTierForRealmOrder,
  canCraftArtifact,
  canEquipArtifact,
  computeArtifactCraftSuccessRate,
  computeArtifactAwakenCost,
  computeArtifactLevelUpCost,
  computeArtifactPowerScore,
  computeArtifactRefineCost,
  computeArtifactStarUpCost,
  computeArtifactStats,
  defaultSlotForArtifactType,
  emptyArtifactSnapshot,
  getArtifactBlueprint,
  getArtifactDef,
  getBodyRealmByKey,
  isArtifactV2EquipSlot,
  maxAwakenForArtifactTier,
  maxLevelForArtifactTier,
  maxRefineForArtifactTier,
  maxStarForArtifactTier,
  realmByKey,
  rollArtifactGrade,
  rollArtifactSubStats,
  subStatSlotsForGrade,
  type ArtifactBlueprintDef,
  type ArtifactDef,
  type ArtifactEquipSlot,
  type ArtifactGrade,
  type ArtifactSubStatRoll,
  type ArtifactTier,
  type ArtifactV2Snapshot,
  type CharacterArtifactState,
  type EquippedArtifactEntry,
} from '@xuantoi/shared';
import { PrismaService } from '../../common/prisma.service';
import { CurrencyService } from './currency.service';
import { InventoryService } from '../inventory/inventory.service';

/**
 * Phase 26.4 — Artifact / Pháp Bảo V2 server-authoritative service.
 *
 * Phụ trách toàn bộ flow:
 *   - `getState(characterId)` — list owned + blueprints + craftability +
 *     missing materials + sourceHint + statPreview snapshot.
 *   - `craft(characterId, blueprintKey, externalBonus?)` — validate realm
 *     + tier + materials → consume materials + linhThach (atomic) → roll
 *     success/fail/grade/substats → tạo `CharacterArtifactV2` row khi
 *     success → ghi `ArtifactCraftAttemptLog`.
 *   - `equip` / `unequip` — set/clear `equippedSlot` (partial-unique 1
 *     artifact per slot enforced bởi index Postgres).
 *   - `upgradeLevel` / `starUp` / `refine` / `awaken` — consume materials
 *     + roll RNG cho star/refine/awaken (level: 100% success) → cập nhật
 *     row + ghi `ArtifactUpgradeLogV2`.
 *
 * Anti-cheat / anti-P2W:
 *   - Mọi check (realm, tier, materials, linhThach) đều server-side.
 *   - DAO_VAN cap cứng trong `rollArtifactGrade` (≤2% tier ≤7, ≤5% tier
 *     8-9). Không có endpoint mua DAO_VAN.
 *   - External success bonus được clamp ≤0.15 trong
 *     `computeArtifactCraftSuccessRate`.
 *   - Star/refine/awaken fail mất nguyên liệu nhưng KHÔNG mất artifact
 *     (fail-soft).
 *   - Tất cả mutation inside `prisma.$transaction` cùng với inventory
 *     consume + currency apply → no duplicate grant nếu retry.
 *
 * UI / combat layer chỉ đọc `statsJson` đã clamp. Combat snapshot wiring
 * sống ở `combat.service.ts` qua helper `aggregateArtifactV2Snapshot`.
 */
@Injectable()
export class ArtifactV2Service {
  constructor(
    private readonly prisma: PrismaService,
    private readonly inventory: InventoryService,
    private readonly currency: CurrencyService,
  ) {}

  // ────────────────────────────────────────────────────────────────────
  // State queries.
  // ────────────────────────────────────────────────────────────────────

  async getState(characterId: string): Promise<ArtifactV2StateOut> {
    const c = await this.prisma.character.findUnique({ where: { id: characterId } });
    if (!c) throw new ArtifactV2Error('CHARACTER_NOT_FOUND');

    const realmOrder = realmByKey(c.realmKey)?.order ?? 0;
    const bodyRealmOrder = getBodyRealmByKey(c.bodyRealmKey)?.order ?? 0;

    const ownedRows = await this.prisma.characterArtifactV2.findMany({
      where: { characterId },
      orderBy: [{ tier: 'desc' }, { createdAt: 'asc' }],
    });

    // Inventory snapshot for material gating.
    const materialKeys = new Set<string>();
    for (const bp of ARTIFACT_BLUEPRINT_CATALOG) {
      if (!bp.enabled) continue;
      for (const inp of bp.inputs) materialKeys.add(inp.itemKey);
    }
    const invRows = await this.prisma.inventoryItem.findMany({
      where: {
        characterId,
        itemKey: { in: Array.from(materialKeys) },
        equippedSlot: null,
      },
      select: { itemKey: true, qty: true },
    });
    const ownedQtyByItem = new Map<string, number>();
    for (const r of invRows) {
      ownedQtyByItem.set(
        r.itemKey,
        (ownedQtyByItem.get(r.itemKey) ?? 0) + r.qty,
      );
    }
    const linhThachOwned = c.linhThach;

    const owned: ArtifactV2OwnedEntry[] = ownedRows.map((r) => {
      const def = getArtifactDef(r.artifactKey);
      const slot = (r.equippedSlot ?? null) as ArtifactEquipSlot | null;
      return {
        id: r.id,
        artifactKey: r.artifactKey,
        name: r.name,
        type: r.type,
        element: r.element,
        tier: r.tier,
        grade: r.grade as ArtifactGrade,
        level: r.level,
        star: r.star,
        refineLevel: r.refineLevel,
        awakenLevel: r.awakenLevel,
        spiritLevel: r.spiritLevel,
        equippedSlot: slot,
        locked: r.locked,
        stats: r.statsJson as Record<string, unknown>,
        subStats: (r.subStatsJson ?? []) as unknown as readonly ArtifactSubStatRoll[],
        skills: (r.skillsJson ?? []) as readonly string[],
        powerScore: def
          ? computeArtifactPowerScore(def, this.stateFromRow(r))
          : 0,
      };
    });

    const blueprints: ArtifactV2BlueprintEntry[] = ARTIFACT_BLUEPRINT_CATALOG.filter(
      (bp) => bp.enabled,
    ).map((bp) => {
      const art = getArtifactDef(bp.artifactKey);
      const ctx = {
        playerRealmOrder: realmOrder,
        playerBodyRealmOrder: bodyRealmOrder,
        playerAlchemyLevel: 0,
      };
      const canResult = canCraftArtifact(bp, ctx);
      const successRate = computeArtifactCraftSuccessRate(bp, ctx);
      const missingMaterials: ArtifactV2MissingMaterialEntry[] = [];
      for (const inp of bp.inputs) {
        const have = ownedQtyByItem.get(inp.itemKey) ?? 0;
        if (have < inp.qty) {
          missingMaterials.push({
            itemKey: inp.itemKey,
            required: inp.qty,
            owned: have,
          });
        }
      }
      const linhThachMissing = Math.max(
        0,
        bp.linhThachCost - Number(linhThachOwned),
      );
      return {
        key: bp.key,
        artifactKey: bp.artifactKey,
        artifactName: art?.nameVi ?? bp.key,
        artifactType: bp.artifactType,
        artifactElement: bp.artifactElement,
        artifactTier: bp.artifactTier,
        requiredRealmOrder: bp.requiredRealmOrder,
        successRate,
        possibleGrades: bp.possibleGrades,
        maxGrade: bp.maxGrade,
        sourceHint: bp.sourceHint,
        inputs: bp.inputs,
        linhThachCost: bp.linhThachCost,
        linhThachMissing,
        missingMaterials,
        canCraft:
          canResult.ok && missingMaterials.length === 0 && linhThachMissing === 0,
        errors: canResult.errors,
      };
    });

    const equippedEntries: EquippedArtifactEntry[] = [];
    for (const r of ownedRows) {
      if (!r.equippedSlot) continue;
      if (!isArtifactV2EquipSlot(r.equippedSlot)) continue;
      const def = getArtifactDef(r.artifactKey);
      if (!def) continue;
      equippedEntries.push({
        def,
        state: this.stateFromRow(r),
      });
    }
    const statPreview = aggregateArtifactV2Snapshot(equippedEntries);

    return {
      realmOrder,
      bodyRealmOrder,
      linhThachOwned: Number(linhThachOwned),
      owned,
      blueprints,
      statPreview,
    };
  }

  // ────────────────────────────────────────────────────────────────────
  // Craft.
  // ────────────────────────────────────────────────────────────────────

  async craft(
    characterId: string,
    blueprintKey: string,
    externalSuccessBonus?: number,
    rng: () => number = Math.random,
  ): Promise<ArtifactV2CraftOut> {
    const bp = getArtifactBlueprint(blueprintKey);
    if (!bp) throw new ArtifactV2Error('BLUEPRINT_NOT_FOUND');
    if (!bp.enabled) throw new ArtifactV2Error('BLUEPRINT_DISABLED');
    const art = getArtifactDef(bp.artifactKey);
    if (!art || !art.enabled) throw new ArtifactV2Error('ARTIFACT_NOT_FOUND');

    const c = await this.prisma.character.findUnique({ where: { id: characterId } });
    if (!c) throw new ArtifactV2Error('CHARACTER_NOT_FOUND');
    const realmOrder = realmByKey(c.realmKey)?.order ?? 0;
    const bodyRealmOrder = getBodyRealmByKey(c.bodyRealmKey)?.order ?? 0;
    const craftCtx = {
      playerRealmOrder: realmOrder,
      playerBodyRealmOrder: bodyRealmOrder,
      playerAlchemyLevel: 0,
      externalSuccessBonus,
    };
    const canResult = canCraftArtifact(bp, craftCtx);
    if (!canResult.ok) {
      const firstError = canResult.errors[0];
      throw new ArtifactV2Error(firstError);
    }

    const successRate = computeArtifactCraftSuccessRate(bp, craftCtx);
    // H1+H2 fix: roll ALL RNG before transaction for determinism + consistency.
    const rollValue = rng();
    const success = rollValue <= successRate;

    let createdRowId: string | null = null;
    let resolvedGrade: ArtifactGrade | null = null;
    let resolvedSubStats: ArtifactSubStatRoll[] = [];
    let initialStats: ReturnType<typeof computeArtifactStats> | null = null;

    // Pre-roll grade + substats outside transaction (deterministic).
    if (success) {
      resolvedGrade = rollArtifactGrade(bp, rng);
      resolvedSubStats = rollArtifactSubStats(art, resolvedGrade, rng);
      initialStats = computeArtifactStats(art, {
        grade: resolvedGrade,
        level: 1,
        star: 0,
        refineLevel: 0,
        awakenLevel: 0,
        spiritLevel: 0,
        subStats: resolvedSubStats,
      });
    }
    await this.prisma.$transaction(async (tx) => {
      for (const inp of bp.inputs) {
        await this.inventory.consumeManyByItemKeyTx(
          tx,
          characterId,
          inp.itemKey,
          inp.qty,
          {
            reason: 'ARTIFACT_V2_CRAFT_CONSUME',
            refType: 'ArtifactCraftAttemptLog',
            refId: bp.key,
            extra: { action: 'CRAFT', blueprintKey: bp.key, qty: inp.qty },
          },
        );
      }
      if (bp.linhThachCost > 0) {
        await this.currency.applyTx(tx, {
          characterId,
          currency: CurrencyKind.LINH_THACH,
          delta: BigInt(-bp.linhThachCost),
          reason: 'ARTIFACT_V2_CRAFT',
          refType: 'ArtifactCraftAttemptLog',
          refId: bp.key,
        });
      }
      if (success && resolvedGrade && resolvedSubStats.length > 0 && initialStats) {
        // Use pre-rolled grade + substats (rolled before transaction).
        const created = await tx.characterArtifactV2.create({
          data: {
            characterId,
            artifactKey: art.key,
            name: art.nameVi,
            type: art.type,
            element: art.element,
            tier: art.tier,
            grade: resolvedGrade,
            level: 1,
            star: 0,
            refineLevel: 0,
            awakenLevel: 0,
            spiritExp: 0n,
            spiritLevel: 0,
            locked: false,
            equippedSlot: null,
            statsJson: initialStats as unknown as Prisma.InputJsonValue,
            subStatsJson: resolvedSubStats as unknown as Prisma.InputJsonValue,
            skillsJson: [] as unknown as Prisma.InputJsonValue,
          },
        });
        createdRowId = created.id;
      }
      await tx.artifactCraftAttemptLog.create({
        data: {
          characterId,
          blueprintKey: bp.key,
          success,
          successRate,
          rollValue,
          artifactKey: success ? art.key : null,
          artifactTier: art.tier,
          artifactGrade: success ? resolvedGrade : null,
          materialsJson: {
            items: bp.inputs.map((inp) => ({ key: inp.itemKey, qty: inp.qty })),
            linhThach: bp.linhThachCost,
          } as Prisma.InputJsonValue,
          linhThachConsumed: bp.linhThachCost,
        },
      });
    });

    return {
      success,
      successRate,
      rollValue,
      grade: resolvedGrade,
      artifactId: createdRowId,
      stats: initialStats,
      consumed: {
        items: bp.inputs.map((inp) => ({ key: inp.itemKey, qty: inp.qty })),
        linhThach: bp.linhThachCost,
      },
    };
  }

  // ────────────────────────────────────────────────────────────────────
  // Equip / Unequip.
  // ────────────────────────────────────────────────────────────────────

  async equip(
    characterId: string,
    artifactId: string,
    slot: ArtifactEquipSlot,
  ): Promise<ArtifactV2StateOut> {
    if (!isArtifactV2EquipSlot(slot)) throw new ArtifactV2Error('SLOT_INVALID_FOR_TYPE');

    const c = await this.prisma.character.findUnique({ where: { id: characterId } });
    if (!c) throw new ArtifactV2Error('CHARACTER_NOT_FOUND');
    const realmOrder = realmByKey(c.realmKey)?.order ?? 0;

    const row = await this.prisma.characterArtifactV2.findUnique({
      where: { id: artifactId },
    });
    if (!row || row.characterId !== characterId) {
      throw new ArtifactV2Error('ARTIFACT_NOT_FOUND');
    }
    const def = getArtifactDef(row.artifactKey);
    if (!def) throw new ArtifactV2Error('ARTIFACT_NOT_FOUND');

    const canEquip = canEquipArtifact(def, slot, { playerRealmOrder: realmOrder });
    if (!canEquip.ok) throw new ArtifactV2Error(canEquip.errors[0]);

    await this.prisma.$transaction(async (tx) => {
      // Unequip the same artifact from its current slot if different.
      if (row.equippedSlot && row.equippedSlot !== slot) {
        await tx.characterArtifactV2.update({
          where: { id: row.id },
          data: { equippedSlot: null },
        });
      }
      // Kick out occupying artifact in target slot.
      await tx.characterArtifactV2.updateMany({
        where: { characterId, equippedSlot: slot, NOT: { id: row.id } },
        data: { equippedSlot: null },
      });
      await tx.characterArtifactV2.update({
        where: { id: row.id },
        data: { equippedSlot: slot },
      });
    });

    return this.getState(characterId);
  }

  async unequip(
    characterId: string,
    artifactId: string,
  ): Promise<ArtifactV2StateOut> {
    const row = await this.prisma.characterArtifactV2.findUnique({
      where: { id: artifactId },
    });
    if (!row || row.characterId !== characterId) {
      throw new ArtifactV2Error('ARTIFACT_NOT_FOUND');
    }
    if (row.equippedSlot) {
      await this.prisma.characterArtifactV2.update({
        where: { id: row.id },
        data: { equippedSlot: null },
      });
    }
    return this.getState(characterId);
  }

  // ────────────────────────────────────────────────────────────────────
  // Upgrade (level / star / refine / awaken).
  // ────────────────────────────────────────────────────────────────────

  async upgradeLevel(
    characterId: string,
    artifactId: string,
    rng: () => number = Math.random,
  ): Promise<ArtifactV2UpgradeOut> {
    return this.runUpgrade(characterId, artifactId, 'UPGRADE', rng);
  }

  async starUp(
    characterId: string,
    artifactId: string,
    rng: () => number = Math.random,
  ): Promise<ArtifactV2UpgradeOut> {
    return this.runUpgrade(characterId, artifactId, 'STAR_UP', rng);
  }

  async refine(
    characterId: string,
    artifactId: string,
    rng: () => number = Math.random,
  ): Promise<ArtifactV2UpgradeOut> {
    return this.runUpgrade(characterId, artifactId, 'REFINE', rng);
  }

  async awaken(
    characterId: string,
    artifactId: string,
    rng: () => number = Math.random,
  ): Promise<ArtifactV2UpgradeOut> {
    return this.runUpgrade(characterId, artifactId, 'AWAKEN', rng);
  }

  private async runUpgrade(
    characterId: string,
    artifactId: string,
    action: 'UPGRADE' | 'STAR_UP' | 'REFINE' | 'AWAKEN',
    rng: () => number = Math.random,
  ): Promise<ArtifactV2UpgradeOut> {
    const row = await this.prisma.characterArtifactV2.findUnique({
      where: { id: artifactId },
    });
    if (!row || row.characterId !== characterId) {
      throw new ArtifactV2Error('ARTIFACT_NOT_FOUND');
    }
    const def = getArtifactDef(row.artifactKey);
    if (!def) throw new ArtifactV2Error('ARTIFACT_NOT_FOUND');

    const tier = def.tier as ArtifactTier;
    let successRate = 1.0;
    let cost: { linhThachCost: number; materials: readonly { itemKey: string; qty: number }[] } = {
      linhThachCost: 0,
      materials: [],
    };
    let nextLevel = row.level;
    let nextStar = row.star;
    let nextRefine = row.refineLevel;
    let nextAwaken = row.awakenLevel;

    if (action === 'UPGRADE') {
      if (row.level >= maxLevelForArtifactTier(tier)) {
        throw new ArtifactV2Error('MAX_LEVEL');
      }
      cost = computeArtifactLevelUpCost(def, row.level);
      nextLevel = row.level + 1;
    } else if (action === 'STAR_UP') {
      if (row.star >= maxStarForArtifactTier(tier)) {
        throw new ArtifactV2Error('MAX_STAR');
      }
      cost = computeArtifactStarUpCost(def, row.star);
      successRate = artifactStarUpSuccessRate(row.star);
      nextStar = row.star + 1;
    } else if (action === 'REFINE') {
      if (row.refineLevel >= maxRefineForArtifactTier(tier)) {
        throw new ArtifactV2Error('MAX_REFINE');
      }
      cost = computeArtifactRefineCost(def, row.refineLevel);
      successRate = artifactRefineSuccessRate(row.refineLevel);
      nextRefine = row.refineLevel + 1;
    } else {
      // AWAKEN
      if (tier < 5) throw new ArtifactV2Error('AWAKEN_NOT_AVAILABLE');
      if (row.awakenLevel >= maxAwakenForArtifactTier(tier)) {
        throw new ArtifactV2Error('MAX_AWAKEN');
      }
      cost = computeArtifactAwakenCost(def, row.awakenLevel);
      successRate = artifactAwakenSuccessRate(row.awakenLevel);
      nextAwaken = row.awakenLevel + 1;
    }

    // Roll RNG before transaction for determinism.
    const rollValue = rng();
    const success = rollValue <= successRate;

    let newStats = row.statsJson;
    let newSkills = (row.skillsJson ?? []) as string[];

    await this.prisma.$transaction(async (tx) => {
      for (const m of cost.materials) {
        await this.inventory.consumeManyByItemKeyTx(
          tx,
          characterId,
          m.itemKey,
          m.qty,
          {
            reason: this.consumeReasonForAction(action),
            refType: 'ArtifactUpgradeLogV2',
            refId: artifactId,
            extra: { action, qty: m.qty },
          },
        );
      }
      if (cost.linhThachCost > 0) {
        await this.currency.applyTx(tx, {
          characterId,
          currency: CurrencyKind.LINH_THACH,
          delta: BigInt(-cost.linhThachCost),
          reason: this.currencyReasonForAction(action),
          refType: 'ArtifactUpgradeLogV2',
          refId: artifactId,
        });
      }
      if (success) {
        if (action === 'AWAKEN' && def.skillPool[row.awakenLevel]) {
          const nextSkill = def.skillPool[row.awakenLevel].key;
          if (!newSkills.includes(nextSkill)) newSkills = [...newSkills, nextSkill];
        }
        // Recompute stats snapshot from new state.
        const recomputed = computeArtifactStats(def, {
          grade: row.grade as ArtifactGrade,
          level: nextLevel,
          star: nextStar,
          refineLevel: nextRefine,
          awakenLevel: nextAwaken,
          spiritLevel: row.spiritLevel,
          subStats: (row.subStatsJson ?? []) as unknown as readonly ArtifactSubStatRoll[],
        });
        newStats = recomputed as unknown as Prisma.JsonValue;
        await tx.characterArtifactV2.update({
          where: { id: row.id },
          data: {
            level: nextLevel,
            star: nextStar,
            refineLevel: nextRefine,
            awakenLevel: nextAwaken,
            statsJson: recomputed as unknown as Prisma.InputJsonValue,
            skillsJson: newSkills as unknown as Prisma.InputJsonValue,
          },
        });
      }
      await tx.artifactUpgradeLogV2.create({
        data: {
          characterId,
          artifactId: row.id,
          action,
          fromLevel: action === 'UPGRADE' ? row.level : null,
          toLevel: action === 'UPGRADE' && success ? nextLevel : null,
          fromStar: action === 'STAR_UP' ? row.star : null,
          toStar: action === 'STAR_UP' && success ? nextStar : null,
          fromRefineLevel: action === 'REFINE' ? row.refineLevel : null,
          toRefineLevel: action === 'REFINE' && success ? nextRefine : null,
          fromAwakenLevel: action === 'AWAKEN' ? row.awakenLevel : null,
          toAwakenLevel: action === 'AWAKEN' && success ? nextAwaken : null,
          success,
          materialsJson: {
            items: cost.materials.map((m) => ({ key: m.itemKey, qty: m.qty })),
            linhThach: cost.linhThachCost,
          } as Prisma.InputJsonValue,
        },
      });
    });

    return {
      action,
      success,
      successRate,
      rollValue,
      from: {
        level: row.level,
        star: row.star,
        refineLevel: row.refineLevel,
        awakenLevel: row.awakenLevel,
      },
      to: {
        level: nextLevel,
        star: nextStar,
        refineLevel: nextRefine,
        awakenLevel: nextAwaken,
      },
      stats: newStats,
      skills: newSkills,
      consumed: {
        items: cost.materials.map((m) => ({ key: m.itemKey, qty: m.qty })),
        linhThach: cost.linhThachCost,
      },
    };
  }

  // ────────────────────────────────────────────────────────────────────
  // Combat / cultivation wiring helper — used by CombatService.
  // ────────────────────────────────────────────────────────────────────

  async getEquippedSnapshot(characterId: string): Promise<ArtifactV2Snapshot> {
    const rows = await this.prisma.characterArtifactV2.findMany({
      where: { characterId, NOT: { equippedSlot: null } },
    });
    if (rows.length === 0) return emptyArtifactSnapshot();
    const entries: EquippedArtifactEntry[] = [];
    for (const r of rows) {
      if (!r.equippedSlot || !isArtifactV2EquipSlot(r.equippedSlot)) continue;
      const def = getArtifactDef(r.artifactKey);
      if (!def) continue;
      entries.push({ def, state: this.stateFromRow(r) });
    }
    return aggregateArtifactV2Snapshot(entries);
  }

  // ────────────────────────────────────────────────────────────────────
  // Helpers.
  // ────────────────────────────────────────────────────────────────────

  private consumeReasonForAction(
    action: 'UPGRADE' | 'STAR_UP' | 'REFINE' | 'AWAKEN',
  ):
    | 'ARTIFACT_V2_UPGRADE_CONSUME'
    | 'ARTIFACT_V2_STAR_UP_CONSUME'
    | 'ARTIFACT_V2_REFINE_CONSUME'
    | 'ARTIFACT_V2_AWAKEN_CONSUME' {
    switch (action) {
      case 'UPGRADE':
        return 'ARTIFACT_V2_UPGRADE_CONSUME';
      case 'STAR_UP':
        return 'ARTIFACT_V2_STAR_UP_CONSUME';
      case 'REFINE':
        return 'ARTIFACT_V2_REFINE_CONSUME';
      case 'AWAKEN':
        return 'ARTIFACT_V2_AWAKEN_CONSUME';
    }
  }

  private currencyReasonForAction(
    action: 'UPGRADE' | 'STAR_UP' | 'REFINE' | 'AWAKEN',
  ):
    | 'ARTIFACT_V2_UPGRADE'
    | 'ARTIFACT_V2_STAR_UP'
    | 'ARTIFACT_V2_REFINE'
    | 'ARTIFACT_V2_AWAKEN' {
    switch (action) {
      case 'UPGRADE':
        return 'ARTIFACT_V2_UPGRADE';
      case 'STAR_UP':
        return 'ARTIFACT_V2_STAR_UP';
      case 'REFINE':
        return 'ARTIFACT_V2_REFINE';
      case 'AWAKEN':
        return 'ARTIFACT_V2_AWAKEN';
    }
  }

  private stateFromRow(r: {
    artifactKey: string;
    grade: string;
    level: number;
    star: number;
    refineLevel: number;
    awakenLevel: number;
    spiritLevel: number;
    equippedSlot: string | null;
    subStatsJson: Prisma.JsonValue;
  }): CharacterArtifactState {
    return {
      artifactKey: r.artifactKey,
      grade: r.grade as ArtifactGrade,
      level: r.level,
      star: r.star,
      refineLevel: r.refineLevel,
      awakenLevel: r.awakenLevel,
      spiritLevel: r.spiritLevel,
      subStats: (r.subStatsJson ?? []) as unknown as readonly ArtifactSubStatRoll[],
      equippedSlot:
        r.equippedSlot && isArtifactV2EquipSlot(r.equippedSlot)
          ? (r.equippedSlot as ArtifactEquipSlot)
          : null,
    };
  }
}

// ─────────────────────────────────────────────────────────────────────
// Public DTO / error types.
// ─────────────────────────────────────────────────────────────────────

export interface ArtifactV2OwnedEntry {
  id: string;
  artifactKey: string;
  name: string;
  type: string;
  element: string;
  tier: number;
  grade: ArtifactGrade;
  level: number;
  star: number;
  refineLevel: number;
  awakenLevel: number;
  spiritLevel: number;
  equippedSlot: ArtifactEquipSlot | null;
  locked: boolean;
  stats: Record<string, unknown>;
  subStats: readonly ArtifactSubStatRoll[];
  skills: readonly string[];
  powerScore: number;
}

export interface ArtifactV2MissingMaterialEntry {
  itemKey: string;
  required: number;
  owned: number;
}

export interface ArtifactV2BlueprintEntry {
  key: string;
  artifactKey: string;
  artifactName: string;
  artifactType: string;
  artifactElement: string;
  artifactTier: number;
  requiredRealmOrder: number;
  successRate: number;
  possibleGrades: Readonly<Partial<Record<ArtifactGrade, number>>>;
  maxGrade: ArtifactGrade;
  sourceHint: readonly string[];
  inputs: readonly { itemKey: string; qty: number }[];
  linhThachCost: number;
  linhThachMissing: number;
  missingMaterials: ArtifactV2MissingMaterialEntry[];
  canCraft: boolean;
  errors: readonly string[];
}

export interface ArtifactV2StateOut {
  realmOrder: number;
  bodyRealmOrder: number;
  linhThachOwned: number;
  owned: ArtifactV2OwnedEntry[];
  blueprints: ArtifactV2BlueprintEntry[];
  statPreview: ArtifactV2Snapshot;
}

export interface ArtifactV2CraftOut {
  success: boolean;
  successRate: number;
  rollValue: number;
  grade: ArtifactGrade | null;
  artifactId: string | null;
  stats: unknown;
  consumed: { items: { key: string; qty: number }[]; linhThach: number };
}

export interface ArtifactV2UpgradeOut {
  action: 'UPGRADE' | 'STAR_UP' | 'REFINE' | 'AWAKEN';
  success: boolean;
  successRate: number;
  rollValue: number;
  from: {
    level: number;
    star: number;
    refineLevel: number;
    awakenLevel: number;
  };
  to: {
    level: number;
    star: number;
    refineLevel: number;
    awakenLevel: number;
  };
  stats: unknown;
  skills: readonly string[];
  consumed: { items: { key: string; qty: number }[]; linhThach: number };
}

export type ArtifactV2ErrorCode =
  | 'CHARACTER_NOT_FOUND'
  | 'ARTIFACT_NOT_FOUND'
  | 'BLUEPRINT_NOT_FOUND'
  | 'BLUEPRINT_DISABLED'
  | 'ARTIFACT_DISABLED'
  | 'REALM_TOO_LOW'
  | 'BODY_REALM_TOO_LOW'
  | 'ALCHEMY_LEVEL_TOO_LOW'
  | 'TIER_TOO_HIGH'
  | 'SLOT_INVALID_FOR_TYPE'
  | 'SLOT_CONFLICT'
  | 'MAX_LEVEL'
  | 'MAX_STAR'
  | 'MAX_REFINE'
  | 'MAX_AWAKEN'
  | 'AWAKEN_NOT_AVAILABLE'
  | 'INSUFFICIENT_MATERIALS'
  | 'INSUFFICIENT_LINH_THACH'
  | 'DAILY_CAP_REACHED'
  | 'UNKNOWN';

export class ArtifactV2Error extends Error {
  constructor(public readonly code: ArtifactV2ErrorCode) {
    super(code);
    this.name = 'ArtifactV2Error';
  }
}

// Re-export catalog for controller / module tests convenience.
export {
  ARTIFACT_BLUEPRINT_CATALOG,
  ARTIFACT_CATALOG_V2,
  allowedSlotsForArtifactType,
  artifactTierForRealmOrder,
  defaultSlotForArtifactType,
  subStatSlotsForGrade,
  type ArtifactBlueprintDef,
  type ArtifactDef,
};
