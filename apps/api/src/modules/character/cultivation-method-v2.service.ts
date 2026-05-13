import { Injectable } from '@nestjs/common';
import { CurrencyKind, type Prisma } from '@prisma/client';
import {
  CULTIVATION_METHODS_V2,
  STARTER_METHOD_V2_KEYS,
  aggregateEquippedMethods,
  canEquipMethod,
  canStarUpMethod,
  canUpgradeMethod,
  computeMethodCultivationRateBonus,
  computeMethodBodyRateBonus,
  computeMethodStatBonus,
  getBodyRealmByKey,
  getMethodV2Def,
  methodUpgradeExpCost,
  methodUpgradeLinhThachCost,
  realmByKey,
  type AggregatedMethodBonuses,
  type CharacterEquipContext,
  type EquippedMethodSnapshotEntry,
  type MethodEquipSlot,
} from '@xuantoi/shared';
import { PrismaService } from '../../common/prisma.service';
import { CurrencyService } from './currency.service';
import { InventoryService } from '../inventory/inventory.service';

/**
 * Phase 26.3 — Cultivation Method V2 service. Server-authoritative cho
 * mọi flow unlock/equip/upgrade/star-up của hệ công pháp V2.
 *
 * Trách nhiệm:
 *  - `getV2State(characterId)` — đọc trạng thái V2 (unlocked methods +
 *    levels/stars/methodExp + slot occupancy + computed bonuses).
 *  - `unlock(characterId, methodKey)` — consume fragments + linh thạch
 *    (nếu cost > 0), tạo CharacterCultivationMethod row level=1 star=0.
 *  - `equipV2(characterId, methodKey, slot)` — set `equippedSlot` trên
 *    row tương ứng. Mirror QI_MAIN slot vào
 *    `Character.equippedCultivationMethodKey` cho backward-compat Phase
 *    11.1.B.
 *  - `unequipV2(characterId, slot)` — clear equippedSlot.
 *  - `upgrade(characterId, methodKey)` — consume material + linhThach +
 *    methodExp; tăng level.
 *  - `starUp(characterId, methodKey)` — consume fragments; tăng sao.
 *  - `grantStarterV2IfMissing(characterId)` — idempotent grant starter
 *    methods (`STARTER_METHOD_V2_KEYS`), gọi từ `CharacterService.onboard`.
 *
 * Anti-P2W: KHÔNG cung cấp endpoint mua method bằng tiền nạp / VIP. Toàn
 * bộ unlock đều cần fragment farm + (đôi khi) linhThach (tiền in-game).
 *
 * Atomic: tất cả mutation đều inside `prisma.$transaction` cùng với
 * inventory consume + currency apply + ledger write.
 */
@Injectable()
export class CultivationMethodV2Service {
  constructor(
    private readonly prisma: PrismaService,
    private readonly inventory: InventoryService,
    private readonly currency: CurrencyService,
  ) {}

  async getV2State(characterId: string): Promise<CultivationMethodV2StateOut> {
    const c = await this.prisma.character.findUnique({
      where: { id: characterId },
      include: { sect: true },
    });
    if (!c) throw new CultivationMethodV2Error('CHARACTER_NOT_FOUND');

    const ownedRows = await this.prisma.characterCultivationMethod.findMany({
      where: { characterId },
      orderBy: { learnedAt: 'asc' },
    });

    const ownedByKey = new Map(ownedRows.map((r) => [r.methodKey, r]));
    const equippedBySlot = new Map<MethodEquipSlot, string>();
    for (const r of ownedRows) {
      if (r.equippedSlot && isMethodEquipSlot(r.equippedSlot)) {
        equippedBySlot.set(r.equippedSlot, r.methodKey);
      }
    }

    const realmOrder = realmByKey(c.realmKey)?.order ?? 0;
    const bodyRealmOrder = getBodyRealmByKey(c.bodyRealmKey)?.order ?? 0;
    const sectKey = sectNameToKey(c.sect?.name ?? null);

    // Fragment ownership.
    const fragmentItemKeys = CULTIVATION_METHODS_V2.map((m) => m.fragmentItemKey);
    const fragRows = await this.prisma.inventoryItem.findMany({
      where: { characterId, itemKey: { in: fragmentItemKeys } },
      select: { itemKey: true, qty: true },
    });
    const fragmentsOwnedByKey = new Map<string, number>();
    for (const r of fragRows) {
      fragmentsOwnedByKey.set(
        r.itemKey,
        (fragmentsOwnedByKey.get(r.itemKey) ?? 0) + r.qty,
      );
    }

    // Build catalog summary.
    const catalog: CultivationMethodV2CatalogEntry[] =
      CULTIVATION_METHODS_V2.filter((m) => m.enabled).map((def) => {
        const ownedRow = ownedByKey.get(def.key);
        const unlocked = !!ownedRow;
        const level = ownedRow?.level ?? 0;
        const star = ownedRow?.star ?? 0;
        const methodExp = ownedRow?.methodExp ?? 0n;
        const fragmentsOwned = fragmentsOwnedByKey.get(def.fragmentItemKey) ?? 0;
        const equippedSlot = (ownedRow?.equippedSlot ?? null) as
          | MethodEquipSlot
          | null;
        const ctx: CharacterEquipContext = {
          realmOrder,
          bodyRealmOrder,
          sectKey,
          unlocked,
          occupyingMethodKey: null,
        };
        const canEquipResult = canEquipMethod(def, def.primarySlot, {
          ...ctx,
          occupyingMethodKey: equippedBySlot.get(def.primarySlot) ?? null,
        });
        const canUpgradeResult = canUpgradeMethod(def, {
          unlocked,
          level: level || 1,
          methodExp,
        });
        const canStarUpResult = canStarUpMethod(def, {
          unlocked,
          star,
          fragmentsOwned,
        });
        const upgradeLinhThachCost = unlocked
          ? methodUpgradeLinhThachCost(def.tier, level)
          : 0;
        const upgradeExpCost = unlocked
          ? methodUpgradeExpCost(def.tier, level).toString()
          : '0';
        return {
          methodKey: def.key,
          unlocked,
          level,
          star,
          methodExp: methodExp.toString(),
          equippedSlot,
          fragmentsOwned,
          fragmentsRequiredToUnlock: def.fragmentsRequired,
          fragmentsPerStar: def.fragmentsPerStar,
          unlockLinhThachCost: def.unlockLinhThachCost,
          upgradeLinhThachCost,
          upgradeExpCost,
          canUnlock: !unlocked &&
            (def.fragmentsRequired === 0 || fragmentsOwned >= def.fragmentsRequired) &&
            realmOrder >= def.unlockRealmOrder,
          canEquip: canEquipResult.ok,
          canEquipReason: canEquipResult.ok ? null : canEquipResult.code,
          canUpgrade: canUpgradeResult.ok,
          canUpgradeReason: canUpgradeResult.ok ? null : canUpgradeResult.code,
          canStarUp: canStarUpResult.ok,
          canStarUpReason: canStarUpResult.ok ? null : canStarUpResult.code,
        };
      });

    // Computed bonuses from equipped methods.
    const equipped: EquippedMethodSnapshotEntry[] = [];
    for (const r of ownedRows) {
      if (!r.equippedSlot || !isMethodEquipSlot(r.equippedSlot)) continue;
      const def = getMethodV2Def(r.methodKey);
      if (!def || !def.enabled) continue;
      equipped.push({ def, level: r.level, star: r.star, slot: r.equippedSlot });
    }

    const aggregated: AggregatedMethodBonuses = aggregateEquippedMethods(equipped);
    const cultivationRateMul = computeMethodCultivationRateBonus(equipped);
    const bodyRateMul = computeMethodBodyRateBonus(equipped);

    return {
      catalog,
      equippedSlots: Array.from(equippedBySlot.entries()).map(([slot, methodKey]) => ({
        slot,
        methodKey,
      })),
      aggregatedBonuses: aggregated,
      cultivationRateMul,
      bodyRateMul,
    };
  }

  /**
   * Idempotent — grant starter V2 methods (chỉ tạo row, không equip).
   * Wire vào `CharacterService.onboard` để mỗi character V2 có
   * `dan_khi_quyet` + `toi_than_quyet` từ đầu.
   *
   * Cũng auto-equip `dan_khi_quyet` vào slot QI_MAIN + mirror sang
   * `Character.equippedCultivationMethodKey` legacy (cho cultivation
   * processor cũ).
   */
  async grantStarterV2IfMissing(characterId: string): Promise<void> {
    for (const key of STARTER_METHOD_V2_KEYS) {
      const def = getMethodV2Def(key);
      if (!def) continue;
      const existing = await this.prisma.characterCultivationMethod.findUnique({
        where: { characterId_methodKey: { characterId, methodKey: key } },
      });
      if (existing) continue;
      try {
        await this.prisma.characterCultivationMethod.create({
          data: {
            characterId,
            methodKey: key,
            source: 'starter',
            level: 1,
            star: 0,
            methodExp: 0n,
          },
        });
      } catch (e: unknown) {
        // Ignore P2002 (concurrent grant).
        if (!isPrismaUniqueError(e)) throw e;
      }
    }
  }

  async unlock(characterId: string, methodKey: string): Promise<CultivationMethodV2StateOut> {
    const def = getMethodV2Def(methodKey);
    if (!def) throw new CultivationMethodV2Error('METHOD_NOT_FOUND');
    if (!def.enabled) throw new CultivationMethodV2Error('METHOD_DISABLED');

    const c = await this.prisma.character.findUnique({
      where: { id: characterId },
      include: { sect: true },
    });
    if (!c) throw new CultivationMethodV2Error('CHARACTER_NOT_FOUND');

    const realmOrder = realmByKey(c.realmKey)?.order ?? 0;
    const bodyRealmOrder = getBodyRealmByKey(c.bodyRealmKey)?.order ?? 0;
    if (realmOrder < def.unlockRealmOrder) {
      throw new CultivationMethodV2Error('REALM_TOO_LOW');
    }
    if (def.unlockBodyRealmOrder !== undefined && bodyRealmOrder < def.unlockBodyRealmOrder) {
      throw new CultivationMethodV2Error('BODY_REALM_TOO_LOW');
    }
    const sectKey = sectNameToKey(c.sect?.name ?? null);
    if (def.requiredSect && sectKey !== def.requiredSect) {
      throw new CultivationMethodV2Error('WRONG_SECT');
    }

    const existing = await this.prisma.characterCultivationMethod.findUnique({
      where: { characterId_methodKey: { characterId, methodKey } },
    });
    if (existing) throw new CultivationMethodV2Error('METHOD_ALREADY_UNLOCKED');

    await this.prisma.$transaction(async (tx) => {
      if (def.fragmentsRequired > 0) {
        await this.inventory.consumeManyByItemKeyTx(
          tx,
          characterId,
          def.fragmentItemKey,
          def.fragmentsRequired,
          {
            reason: 'METHOD_FRAGMENT_CONSUME',
            refType: 'CharacterCultivationMethod',
            refId: methodKey,
            extra: { action: 'UNLOCK', qty: def.fragmentsRequired },
          },
        );
      }
      if (def.unlockLinhThachCost > 0) {
        await this.currency.applyTx(tx, {
          characterId,
          currency: CurrencyKind.LINH_THACH,
          delta: BigInt(-def.unlockLinhThachCost),
          reason: 'METHOD_UNLOCK',
          refType: 'CharacterCultivationMethod',
          refId: methodKey,
        });
      }
      try {
        await tx.characterCultivationMethod.create({
          data: {
            characterId,
            methodKey,
            source: 'fragment_combine',
            level: 1,
            star: 0,
            methodExp: 0n,
          },
        });
      } catch (e: unknown) {
        if (isPrismaUniqueError(e)) {
          throw new CultivationMethodV2Error('METHOD_ALREADY_UNLOCKED');
        }
        throw e;
      }
      await tx.methodUpgradeLog.create({
        data: {
          characterId,
          methodKey,
          action: 'UNLOCK',
          fromLevel: 0,
          toLevel: 1,
          fromStar: 0,
          toStar: 0,
          success: true,
          materialsJson: {
            fragments: def.fragmentsRequired,
            linhThach: def.unlockLinhThachCost,
          },
        },
      });
    });

    return this.getV2State(characterId);
  }

  async equipV2(
    characterId: string,
    methodKey: string,
    slot: MethodEquipSlot,
  ): Promise<CultivationMethodV2StateOut> {
    const def = getMethodV2Def(methodKey);
    if (!def) throw new CultivationMethodV2Error('METHOD_NOT_FOUND');
    const c = await this.prisma.character.findUnique({
      where: { id: characterId },
      include: { sect: true },
    });
    if (!c) throw new CultivationMethodV2Error('CHARACTER_NOT_FOUND');

    const owned = await this.prisma.characterCultivationMethod.findUnique({
      where: { characterId_methodKey: { characterId, methodKey } },
    });
    if (!owned) throw new CultivationMethodV2Error('METHOD_NOT_UNLOCKED');

    const realmOrder = realmByKey(c.realmKey)?.order ?? 0;
    const bodyRealmOrder = getBodyRealmByKey(c.bodyRealmKey)?.order ?? 0;
    const sectKey = sectNameToKey(c.sect?.name ?? null);

    const occupying = await this.prisma.characterCultivationMethod.findFirst({
      where: { characterId, equippedSlot: slot, NOT: { methodKey } },
    });
    const canResult = canEquipMethod(def, slot, {
      realmOrder,
      bodyRealmOrder,
      sectKey,
      unlocked: true,
      occupyingMethodKey: occupying?.methodKey ?? null,
    });
    if (!canResult.ok) throw new CultivationMethodV2Error(canResult.code);

    await this.prisma.$transaction(async (tx) => {
      // Clear old slot occupant (if different method).
      if (occupying) {
        await tx.characterCultivationMethod.update({
          where: { id: occupying.id },
          data: { equippedSlot: null },
        });
      }
      // Clear other slot on same method (if currently in different slot).
      if (owned.equippedSlot && owned.equippedSlot !== slot) {
        await tx.characterCultivationMethod.update({
          where: { id: owned.id },
          data: { equippedSlot: null },
        });
      }
      await tx.characterCultivationMethod.update({
        where: { id: owned.id },
        data: { equippedSlot: slot },
      });
      // Mirror QI_MAIN → Character.equippedCultivationMethodKey legacy field.
      if (slot === 'QI_MAIN') {
        await tx.character.update({
          where: { id: characterId },
          data: { equippedCultivationMethodKey: methodKey },
        });
      }
    });

    return this.getV2State(characterId);
  }

  async unequipV2(
    characterId: string,
    slot: MethodEquipSlot,
  ): Promise<CultivationMethodV2StateOut> {
    const row = await this.prisma.characterCultivationMethod.findFirst({
      where: { characterId, equippedSlot: slot },
    });
    if (!row) return this.getV2State(characterId);
    await this.prisma.$transaction(async (tx) => {
      await tx.characterCultivationMethod.update({
        where: { id: row.id },
        data: { equippedSlot: null },
      });
      if (slot === 'QI_MAIN') {
        await tx.character.update({
          where: { id: characterId },
          data: { equippedCultivationMethodKey: null },
        });
      }
    });
    return this.getV2State(characterId);
  }

  async upgrade(
    characterId: string,
    methodKey: string,
  ): Promise<CultivationMethodV2StateOut> {
    const def = getMethodV2Def(methodKey);
    if (!def) throw new CultivationMethodV2Error('METHOD_NOT_FOUND');
    const owned = await this.prisma.characterCultivationMethod.findUnique({
      where: { characterId_methodKey: { characterId, methodKey } },
    });
    if (!owned) throw new CultivationMethodV2Error('METHOD_NOT_UNLOCKED');

    if (owned.level >= def.maxLevel) throw new CultivationMethodV2Error('MAX_LEVEL');

    const linhThachCost = methodUpgradeLinhThachCost(def.tier, owned.level);

    // Materials per level: tier-scaled.
    const required = def.upgradeMaterials;

    // Breakthrough materials at specific atLevel mile-stones — additive
    // requirement (level+1 == atLevel).
    const nextLevel = owned.level + 1;
    const breakthroughs = def.breakthroughMaterials.filter((b) => b.atLevel === nextLevel);

    await this.prisma.$transaction(async (tx) => {
      for (const m of required) {
        await this.inventory.consumeManyByItemKeyTx(tx, characterId, m.itemKey, m.qty, {
          reason: 'METHOD_UPGRADE_MATERIAL',
          refType: 'CharacterCultivationMethod',
          refId: methodKey,
          extra: { action: 'UPGRADE', toLevel: nextLevel },
        });
      }
      for (const m of breakthroughs) {
        await this.inventory.consumeManyByItemKeyTx(tx, characterId, m.itemKey, m.qty, {
          reason: 'METHOD_UPGRADE_MATERIAL',
          refType: 'CharacterCultivationMethod',
          refId: methodKey,
          extra: { action: 'BREAKTHROUGH', atLevel: m.atLevel },
        });
      }
      if (linhThachCost > 0) {
        await this.currency.applyTx(tx, {
          characterId,
          currency: CurrencyKind.LINH_THACH,
          delta: BigInt(-linhThachCost),
          reason: 'METHOD_UPGRADE',
          refType: 'CharacterCultivationMethod',
          refId: methodKey,
        });
      }
      await tx.characterCultivationMethod.update({
        where: { id: owned.id },
        data: { level: { increment: 1 } },
      });
      await tx.methodUpgradeLog.create({
        data: {
          characterId,
          methodKey,
          action: 'UPGRADE',
          fromLevel: owned.level,
          toLevel: nextLevel,
          fromStar: owned.star,
          toStar: owned.star,
          success: true,
          materialsJson: {
            items: required.map((m) => ({ key: m.itemKey, qty: m.qty })),
            breakthroughItems: breakthroughs.map((m) => ({ key: m.itemKey, qty: m.qty, atLevel: m.atLevel })),
            linhThach: linhThachCost,
          },
        },
      });
    });

    return this.getV2State(characterId);
  }

  async starUp(
    characterId: string,
    methodKey: string,
  ): Promise<CultivationMethodV2StateOut> {
    const def = getMethodV2Def(methodKey);
    if (!def) throw new CultivationMethodV2Error('METHOD_NOT_FOUND');
    const owned = await this.prisma.characterCultivationMethod.findUnique({
      where: { characterId_methodKey: { characterId, methodKey } },
    });
    if (!owned) throw new CultivationMethodV2Error('METHOD_NOT_UNLOCKED');
    if (owned.star >= def.maxStar) throw new CultivationMethodV2Error('MAX_STAR');

    const fragmentsNeeded = def.fragmentsPerStar;

    await this.prisma.$transaction(async (tx) => {
      if (fragmentsNeeded > 0) {
        await this.inventory.consumeManyByItemKeyTx(
          tx,
          characterId,
          def.fragmentItemKey,
          fragmentsNeeded,
          {
            reason: 'METHOD_FRAGMENT_CONSUME',
            refType: 'CharacterCultivationMethod',
            refId: methodKey,
            extra: { action: 'STAR_UP', qty: fragmentsNeeded },
          },
        );
      }
      await tx.characterCultivationMethod.update({
        where: { id: owned.id },
        data: { star: { increment: 1 } },
      });
      await tx.methodUpgradeLog.create({
        data: {
          characterId,
          methodKey,
          action: 'STAR_UP',
          fromLevel: owned.level,
          toLevel: owned.level,
          fromStar: owned.star,
          toStar: owned.star + 1,
          success: true,
          materialsJson: { fragments: fragmentsNeeded },
        },
      });
    });

    return this.getV2State(characterId);
  }

  // ─────────────────────────────────────────────────────────────────────
  // Read-only helpers used by other modules (cultivation processor, body
  // processor, combat snapshot).
  // ─────────────────────────────────────────────────────────────────────

  /**
   * Compose snapshot các method đang equip (kèm def/level/star). Pure
   * read — không mutate. Dùng để pass vào `aggregateEquippedMethods` /
   * `computeMethodCultivationRateBonus` / `computeMethodBodyRateBonus`.
   */
  async getEquippedSnapshot(
    characterId: string,
  ): Promise<EquippedMethodSnapshotEntry[]> {
    const rows = await this.prisma.characterCultivationMethod.findMany({
      where: { characterId, NOT: { equippedSlot: null } },
    });
    const out: EquippedMethodSnapshotEntry[] = [];
    for (const r of rows) {
      if (!r.equippedSlot || !isMethodEquipSlot(r.equippedSlot)) continue;
      const def = getMethodV2Def(r.methodKey);
      if (!def || !def.enabled) continue;
      out.push({ def, level: r.level, star: r.star, slot: r.equippedSlot });
    }
    return out;
  }

  /**
   * Đọc snapshot từ tx — dùng trong các processor cùng `$transaction` để
   * tránh stale read.
   */
  async getEquippedSnapshotTx(
    tx: Prisma.TransactionClient,
    characterId: string,
  ): Promise<EquippedMethodSnapshotEntry[]> {
    const rows = await tx.characterCultivationMethod.findMany({
      where: { characterId, NOT: { equippedSlot: null } },
    });
    const out: EquippedMethodSnapshotEntry[] = [];
    for (const r of rows) {
      if (!r.equippedSlot || !isMethodEquipSlot(r.equippedSlot)) continue;
      const def = getMethodV2Def(r.methodKey);
      if (!def || !def.enabled) continue;
      out.push({ def, level: r.level, star: r.star, slot: r.equippedSlot });
    }
    return out;
  }
}

// ─────────────────────────────────────────────────────────────────────
// Sect name → sect key map (mirror legacy service).
// ─────────────────────────────────────────────────────────────────────

const SECT_NAME_TO_KEY: Record<string, string> = {
  'Thanh Vân Môn': 'thanh_van',
  'Huyền Thuỷ Cung': 'huyen_thuy',
  'Tu La Tông': 'tu_la',
};

function sectNameToKey(name: string | null): string | null {
  if (!name) return null;
  return SECT_NAME_TO_KEY[name] ?? null;
}

function isMethodEquipSlot(s: string): s is MethodEquipSlot {
  return s === 'QI_MAIN' || s === 'BODY_MAIN' || s === 'SUPPORT' || s === 'SECT' || s === 'SPECIAL';
}

function isPrismaUniqueError(e: unknown): boolean {
  return (
    typeof e === 'object' &&
    e !== null &&
    'code' in e &&
    (e as { code?: string }).code === 'P2002'
  );
}

// ─────────────────────────────────────────────────────────────────────
// Types & errors.
// ─────────────────────────────────────────────────────────────────────

export type CultivationMethodV2ErrorCode =
  | 'METHOD_NOT_FOUND'
  | 'METHOD_DISABLED'
  | 'METHOD_NOT_UNLOCKED'
  | 'METHOD_ALREADY_UNLOCKED'
  | 'CHARACTER_NOT_FOUND'
  | 'REALM_TOO_LOW'
  | 'BODY_REALM_TOO_LOW'
  | 'WRONG_SECT'
  | 'SLOT_NOT_ALLOWED'
  | 'SLOT_CONFLICT'
  | 'ELEMENT_CONFLICT'
  | 'NOT_UNLOCKED'
  | 'MAX_LEVEL'
  | 'MAX_STAR'
  | 'INSUFFICIENT_FRAGMENTS'
  | 'INSUFFICIENT_MATERIALS'
  | 'INSUFFICIENT_LINH_THACH';

export class CultivationMethodV2Error extends Error {
  constructor(public code: CultivationMethodV2ErrorCode) {
    super(code);
  }
}

export interface CultivationMethodV2CatalogEntry {
  methodKey: string;
  unlocked: boolean;
  level: number;
  star: number;
  methodExp: string;
  equippedSlot: MethodEquipSlot | null;
  fragmentsOwned: number;
  fragmentsRequiredToUnlock: number;
  fragmentsPerStar: number;
  unlockLinhThachCost: number;
  upgradeLinhThachCost: number;
  upgradeExpCost: string;
  canUnlock: boolean;
  canEquip: boolean;
  canEquipReason: string | null;
  canUpgrade: boolean;
  canUpgradeReason: string | null;
  canStarUp: boolean;
  canStarUpReason: string | null;
}

export interface CultivationMethodV2EquippedSlot {
  slot: MethodEquipSlot;
  methodKey: string;
}

export interface CultivationMethodV2StateOut {
  catalog: CultivationMethodV2CatalogEntry[];
  equippedSlots: CultivationMethodV2EquippedSlot[];
  aggregatedBonuses: AggregatedMethodBonuses;
  cultivationRateMul: number;
  bodyRateMul: number;
}

/**
 * Pure helper — compose aggregated bonus từ snapshot dùng trong stat
 * service (combat). Exported để service khác không cần đụng Prisma trực
 * tiếp khi cần bonus.
 */
export function methodAggregatedBonusesFromSnapshot(
  snapshot: readonly EquippedMethodSnapshotEntry[],
): AggregatedMethodBonuses {
  return aggregateEquippedMethods(snapshot);
}

/**
 * Compute snapshot from raw rows (tx-readonly) — pure helper for use in
 * cultivation / body processors with non-Prisma input.
 */
export function methodSnapshotFromRows(
  rows: readonly { methodKey: string; level: number; star: number; equippedSlot: string | null }[],
): EquippedMethodSnapshotEntry[] {
  const out: EquippedMethodSnapshotEntry[] = [];
  for (const r of rows) {
    if (!r.equippedSlot || !isMethodEquipSlot(r.equippedSlot)) continue;
    const def = getMethodV2Def(r.methodKey);
    if (!def || !def.enabled) continue;
    out.push({ def, level: r.level, star: r.star, slot: r.equippedSlot });
  }
  return out;
}

// Re-export for module consumers.
export {
  CULTIVATION_METHODS_V2,
  computeMethodStatBonus,
};
