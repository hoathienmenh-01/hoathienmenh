import { Injectable } from '@nestjs/common';
import { CurrencyKind, type Prisma } from '@prisma/client';
import {
  composeEnchantBonus,
  composeSubstatBonus,
  ELEMENTAL_ENCHANT_EFFECTS,
  ELEMENTS,
  EQUIPMENT_ENCHANT_CONFIG,
  EQUIPMENT_REFORGE_CONFIG,
  getEnchantCost,
  getReforgeCost,
  isUpgradableItemKind,
  itemByKey,
  MAX_ENCHANT_LEVEL,
  parseEnchantElement,
  rollReforgedSubstats,
  type ElementKey,
  type EquipmentSubstat,
  type EquipmentSubstatKind,
  type Quality,
} from '@xuantoi/shared';
import { PrismaService } from '../../common/prisma.service';
import { CurrencyService } from './currency.service';

/**
 * Phase 15.0.A — Equipment Reforge / Enchant Foundation runtime service.
 *
 * Hai sink mới song song refine (Phase 11.5) / gem (Phase 11.4):
 *
 *   - {@link reforge}: re-roll substat phụ của trang bị (`InventoryItem.
 *     substatsJson`). Cost linhThach + material (`tinh_thiet` / `yeu_dan` /
 *     `han_ngoc` theo quality). Overwrite hoàn toàn substats cũ.
 *   - {@link enchant}: nâng cấp enchant Ngũ Hành (`InventoryItem.enchant
 *     Element` + `enchantLevel`). Lần đầu chọn element (1 trong 5); các lần
 *     sau buộc cùng element + level + 1.
 *   - {@link upgradePreview}: read-only — trả config + cost preview cho cả 2
 *     op + current substats/enchant.
 *
 * **Atomicity**: tất cả 3 step (consume currency + consume material + update
 * equipment + write history) chạy trong cùng `prisma.$transaction`. Nếu bất
 * kỳ step fail (insufficient currency / material race) → rollback toàn bộ,
 * không có nửa-state.
 *
 * **Concurrent safety**: dùng `updateMany` với `gte` guard cho material;
 * `CurrencyService.applyTx` đã có `gte` guard cho linhThach. 2 thread reforge
 * cùng item song song → 1 thread thắng (count=1), thread kia thấy material
 * count=0 hoặc currency throw `INSUFFICIENT_FUNDS` → rollback an toàn.
 *
 * **Error codes**:
 *   - `EQUIPMENT_NOT_FOUND` — id sai hoặc characterId không match (NOT_OWNER).
 *   - `INVALID_EQUIPMENT` — item không nằm trong upgradable kinds (PILL/ORE).
 *   - `INSUFFICIENT_FUNDS` — linhThach < cost.
 *   - `INSUFFICIENT_MATERIAL` — material qty < required.
 *   - `MAX_ENCHANT_REACHED` — enchant level đã = MAX_ENCHANT_LEVEL.
 *   - `INVALID_ELEMENT` — element key không phải `kim/moc/thuy/hoa/tho`.
 *   - `ELEMENT_LOCKED` — đã enchant element X nhưng caller request element
 *     Y khác (foundation phase chưa hỗ trợ chuyển hệ).
 */
@Injectable()
export class EquipmentService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly currency: CurrencyService,
  ) {}

  /**
   * Re-roll substats trang bị (`InventoryItem.substatsJson`).
   *
   * Algorithm:
   *   1. Verify ownership + upgradable kind.
   *   2. Compute cost qua quality (`getReforgeCost`).
   *   3. Verify enough material qty + linhThach.
   *   4. Roll substats deterministic theo `rng`.
   *   5. Atomic transaction:
   *      - decrement material via `updateMany` (gte guard).
   *      - write `ItemLedger` reason `EQUIPMENT_REFORGE_COST` (qtyDelta < 0).
   *      - write `CurrencyLedger` reason `EQUIPMENT_REFORGE` (delta < 0) qua
   *        `CurrencyService.applyTx` (gte guard).
   *      - update `InventoryItem.substatsJson`.
   *      - write `EquipmentReforgeHistory` (audit replay).
   */
  async reforge(
    characterId: string,
    inventoryItemId: string,
    rng: () => number = Math.random,
  ): Promise<EquipmentReforgeOutcome> {
    return this.prisma.$transaction(async (tx) => {
      const equipment = await tx.inventoryItem.findUnique({
        where: { id: inventoryItemId },
      });
      if (!equipment || equipment.characterId !== characterId) {
        throw new EquipmentError('EQUIPMENT_NOT_FOUND');
      }
      const def = itemByKey(equipment.itemKey);
      if (!def) throw new EquipmentError('EQUIPMENT_NOT_FOUND');
      if (!isUpgradableItemKind(def.kind) || !def.slot) {
        throw new EquipmentError('INVALID_EQUIPMENT');
      }

      const quality = def.quality as Quality;
      const cost = getReforgeCost(quality);

      // Verify material qty (race-safe atomic decrement bên dưới qua updateMany).
      const materialRow = await tx.inventoryItem.findFirst({
        where: {
          characterId,
          itemKey: cost.materialKey,
          equippedSlot: null,
          qty: { gte: cost.materialQty },
        },
      });
      if (!materialRow) {
        throw new EquipmentError('INSUFFICIENT_MATERIAL');
      }

      // Atomic decrement material via updateMany (gte guard chống race).
      const decResult = await tx.inventoryItem.updateMany({
        where: { id: materialRow.id, qty: { gte: cost.materialQty } },
        data: { qty: { decrement: cost.materialQty } },
      });
      if (decResult.count === 0) {
        throw new EquipmentError('INSUFFICIENT_MATERIAL');
      }
      // Cleanup: nếu qty về 0 thì xoá row.
      const post = await tx.inventoryItem.findUnique({
        where: { id: materialRow.id },
        select: { qty: true },
      });
      if (post && post.qty === 0) {
        await tx.inventoryItem.delete({ where: { id: materialRow.id } });
      }
      await tx.itemLedger.create({
        data: {
          characterId,
          itemKey: cost.materialKey,
          qtyDelta: -cost.materialQty,
          reason: 'EQUIPMENT_REFORGE_COST',
          refType: 'InventoryItem',
          refId: equipment.id,
        },
      });

      // Spend linhThach (atomic gte guard inside applyTx → throws INSUFFICIENT_FUNDS).
      try {
        await this.currency.applyTx(tx, {
          characterId,
          currency: CurrencyKind.LINH_THACH,
          delta: BigInt(-cost.linhThachCost),
          reason: 'EQUIPMENT_REFORGE',
          refType: 'InventoryItem',
          refId: equipment.id,
        });
      } catch (err: unknown) {
        if (
          err &&
          typeof err === 'object' &&
          'message' in err &&
          (err as { message: string }).message === 'INSUFFICIENT_FUNDS'
        ) {
          throw new EquipmentError('INSUFFICIENT_FUNDS');
        }
        throw err;
      }

      // Roll substats.
      const before = parseSubstatsJson(equipment.substatsJson);
      const after = rollReforgedSubstats(quality, rng);

      // Update equipment substats.
      await tx.inventoryItem.update({
        where: { id: equipment.id },
        data: { substatsJson: after as unknown as Prisma.InputJsonValue },
      });

      // Write reforge history.
      await tx.equipmentReforgeHistory.create({
        data: {
          characterId,
          inventoryItemId: equipment.id,
          itemKey: equipment.itemKey,
          beforeJson: before as unknown as Prisma.InputJsonValue,
          afterJson: after as unknown as Prisma.InputJsonValue,
          costJson: {
            linhThachCost: cost.linhThachCost,
            materialKey: cost.materialKey,
            materialQty: cost.materialQty,
          } as Prisma.InputJsonValue,
        },
      });

      return {
        inventoryItemId: equipment.id,
        before,
        after,
        cost,
      };
    });
  }

  /**
   * Enchant level-up cho trang bị. Lần đầu (`enchantLevel=0`) caller phải
   * pass `element` để chọn 1 trong 5 hệ. Các lần sau (`enchantLevel >= 1`)
   * caller pass cùng element đã chọn — pass element khác = `ELEMENT_LOCKED`.
   *
   * Atomic flow tương tự reforge: verify → consume material/currency →
   * update equipment → write history.
   */
  async enchant(
    characterId: string,
    inventoryItemId: string,
    element: ElementKey,
  ): Promise<EquipmentEnchantOutcome> {
    if (!(ELEMENTS as readonly string[]).includes(element)) {
      throw new EquipmentError('INVALID_ELEMENT');
    }
    return this.prisma.$transaction(async (tx) => {
      const equipment = await tx.inventoryItem.findUnique({
        where: { id: inventoryItemId },
      });
      if (!equipment || equipment.characterId !== characterId) {
        throw new EquipmentError('EQUIPMENT_NOT_FOUND');
      }
      const def = itemByKey(equipment.itemKey);
      if (!def) throw new EquipmentError('EQUIPMENT_NOT_FOUND');
      if (!isUpgradableItemKind(def.kind) || !def.slot) {
        throw new EquipmentError('INVALID_EQUIPMENT');
      }

      const currentLevel = equipment.enchantLevel ?? 0;
      const currentElement = parseEnchantElement(equipment.enchantElement);

      if (currentLevel >= MAX_ENCHANT_LEVEL) {
        throw new EquipmentError('MAX_ENCHANT_REACHED');
      }
      if (currentLevel >= 1 && currentElement !== null && currentElement !== element) {
        throw new EquipmentError('ELEMENT_LOCKED');
      }

      const quality = def.quality as Quality;
      const cost = getEnchantCost(quality, currentLevel);

      // Verify material.
      const materialRow = await tx.inventoryItem.findFirst({
        where: {
          characterId,
          itemKey: cost.materialKey,
          equippedSlot: null,
          qty: { gte: cost.materialQty },
        },
      });
      if (!materialRow) {
        throw new EquipmentError('INSUFFICIENT_MATERIAL');
      }
      const decResult = await tx.inventoryItem.updateMany({
        where: { id: materialRow.id, qty: { gte: cost.materialQty } },
        data: { qty: { decrement: cost.materialQty } },
      });
      if (decResult.count === 0) {
        throw new EquipmentError('INSUFFICIENT_MATERIAL');
      }
      const post = await tx.inventoryItem.findUnique({
        where: { id: materialRow.id },
        select: { qty: true },
      });
      if (post && post.qty === 0) {
        await tx.inventoryItem.delete({ where: { id: materialRow.id } });
      }
      await tx.itemLedger.create({
        data: {
          characterId,
          itemKey: cost.materialKey,
          qtyDelta: -cost.materialQty,
          reason: 'EQUIPMENT_ENCHANT_COST',
          refType: 'InventoryItem',
          refId: equipment.id,
        },
      });

      // Spend linhThach.
      try {
        await this.currency.applyTx(tx, {
          characterId,
          currency: CurrencyKind.LINH_THACH,
          delta: BigInt(-cost.linhThachCost),
          reason: 'EQUIPMENT_ENCHANT',
          refType: 'InventoryItem',
          refId: equipment.id,
        });
      } catch (err: unknown) {
        if (
          err &&
          typeof err === 'object' &&
          'message' in err &&
          (err as { message: string }).message === 'INSUFFICIENT_FUNDS'
        ) {
          throw new EquipmentError('INSUFFICIENT_FUNDS');
        }
        throw err;
      }

      const newLevel = currentLevel + 1;
      await tx.inventoryItem.update({
        where: { id: equipment.id },
        data: {
          enchantElement: element,
          enchantLevel: newLevel,
        },
      });

      await tx.equipmentEnchantHistory.create({
        data: {
          characterId,
          inventoryItemId: equipment.id,
          itemKey: equipment.itemKey,
          beforeElement: currentElement,
          beforeLevel: currentLevel,
          afterElement: element,
          afterLevel: newLevel,
          costJson: {
            linhThachCost: cost.linhThachCost,
            materialKey: cost.materialKey,
            materialQty: cost.materialQty,
          } as Prisma.InputJsonValue,
        },
      });

      return {
        inventoryItemId: equipment.id,
        beforeElement: currentElement,
        beforeLevel: currentLevel,
        afterElement: element,
        afterLevel: newLevel,
        cost,
      };
    });
  }

  /**
   * Read-only preview cho UI: trả config reforge + enchant + cost step
   * tiếp theo + current state. KHÔNG mutate, KHÔNG ghi ledger.
   */
  async upgradePreview(
    characterId: string,
    inventoryItemId: string,
  ): Promise<EquipmentUpgradePreview> {
    const equipment = await this.prisma.inventoryItem.findUnique({
      where: { id: inventoryItemId },
    });
    if (!equipment || equipment.characterId !== characterId) {
      throw new EquipmentError('EQUIPMENT_NOT_FOUND');
    }
    const def = itemByKey(equipment.itemKey);
    if (!def) throw new EquipmentError('EQUIPMENT_NOT_FOUND');
    if (!isUpgradableItemKind(def.kind) || !def.slot) {
      throw new EquipmentError('INVALID_EQUIPMENT');
    }

    const quality = def.quality as Quality;
    const reforgeCost = getReforgeCost(quality);
    const reforgeRule = EQUIPMENT_REFORGE_CONFIG[quality];
    const enchantRule = EQUIPMENT_ENCHANT_CONFIG[quality];
    const currentLevel = equipment.enchantLevel ?? 0;
    const currentElement = parseEnchantElement(equipment.enchantElement);
    const currentSubstats = parseSubstatsJson(equipment.substatsJson);

    const reforgeBonusPreview = composeSubstatBonus(currentSubstats);
    const enchantBonusPreview = composeEnchantBonus(currentElement, currentLevel);

    const enchantNextCost =
      currentLevel >= MAX_ENCHANT_LEVEL
        ? null
        : getEnchantCost(quality, currentLevel);

    return {
      inventoryItemId: equipment.id,
      itemKey: equipment.itemKey,
      quality,
      reforge: {
        slots: reforgeRule.slots,
        currentSubstats,
        currentBonus: reforgeBonusPreview,
        nextCost: reforgeCost,
      },
      enchant: {
        currentElement,
        currentLevel,
        maxLevel: MAX_ENCHANT_LEVEL,
        currentBonus: enchantBonusPreview,
        nextCost: enchantNextCost,
        baseLinhThachCost: enchantRule.baseLinhThachCost,
        materialKey: enchantRule.material.itemKey,
        materialQty: enchantRule.material.qty,
        elements: ELEMENTS.map((e) => ({
          element: e,
          effect: ELEMENTAL_ENCHANT_EFFECTS[e],
        })),
      },
    };
  }
}

// ---------------------------------------------------------------------------
// Helper — local copy để tránh import cycle với InventoryService.
// ---------------------------------------------------------------------------

function parseSubstatsJson(input: unknown): EquipmentSubstat[] {
  if (!Array.isArray(input)) return [];
  const out: EquipmentSubstat[] = [];
  const valid: ReadonlySet<EquipmentSubstatKind> = new Set<EquipmentSubstatKind>([
    'atk',
    'def',
    'hpMax',
    'mpMax',
    'spirit',
  ]);
  for (const raw of input) {
    if (!raw || typeof raw !== 'object') continue;
    const o = raw as Record<string, unknown>;
    if (typeof o.kind !== 'string' || !valid.has(o.kind as EquipmentSubstatKind)) continue;
    if (typeof o.value !== 'number' || !Number.isFinite(o.value) || o.value <= 0) continue;
    out.push({ kind: o.kind as EquipmentSubstatKind, value: Math.floor(o.value) });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface EquipmentReforgeOutcome {
  inventoryItemId: string;
  before: EquipmentSubstat[];
  after: EquipmentSubstat[];
  cost: { linhThachCost: number; materialKey: string; materialQty: number };
}

export interface EquipmentEnchantOutcome {
  inventoryItemId: string;
  beforeElement: ElementKey | null;
  beforeLevel: number;
  afterElement: ElementKey;
  afterLevel: number;
  cost: { linhThachCost: number; materialKey: string; materialQty: number };
}

export interface EquipmentUpgradePreview {
  inventoryItemId: string;
  itemKey: string;
  quality: Quality;
  reforge: {
    slots: number;
    currentSubstats: EquipmentSubstat[];
    currentBonus: Record<EquipmentSubstatKind, number>;
    nextCost: { linhThachCost: number; materialKey: string; materialQty: number };
  };
  enchant: {
    currentElement: ElementKey | null;
    currentLevel: number;
    maxLevel: number;
    currentBonus: Record<EquipmentSubstatKind, number>;
    nextCost: { linhThachCost: number; materialKey: string; materialQty: number } | null;
    baseLinhThachCost: number;
    materialKey: string;
    materialQty: number;
    elements: Array<{
      element: ElementKey;
      effect: (typeof ELEMENTAL_ENCHANT_EFFECTS)[ElementKey];
    }>;
  };
}

export class EquipmentError extends Error {
  constructor(
    public code:
      | 'EQUIPMENT_NOT_FOUND'
      | 'INVALID_EQUIPMENT'
      | 'INSUFFICIENT_FUNDS'
      | 'INSUFFICIENT_MATERIAL'
      | 'MAX_ENCHANT_REACHED'
      | 'INVALID_ELEMENT'
      | 'ELEMENT_LOCKED',
  ) {
    super(code);
  }
}
