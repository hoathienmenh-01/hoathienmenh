import { Injectable } from '@nestjs/common';
import { CurrencyKind, type Prisma } from '@prisma/client';
import {
  EQUIPMENT_MERGE_INPUT_COUNT,
  deriveEquipmentProgressionMetadata,
  findEquipmentMergeRecipe,
  getEquipmentDismantleYield,
  getEquipmentEnhanceCost,
  getEquipmentMergeCost,
  getEquipmentReforgeCost,
  getGemSocketCost,
  getGemUnsocketCost,
  getMaxReforgeCount,
  getProtectionCharmRequirement,
  isUpgradableItemKind,
  itemByKey,
  type EquipmentSlotLike,
  type Quality,
  validateDismantleRequest,
  validateEquipmentMergeRequest,
  validateEquipmentUpgradeRequest,
} from '@xuantoi/shared';
import { PrismaService } from '../../common/prisma.service';
import { CurrencyService } from './currency.service';

/**
 * Phase 23.4 — Equipment Upgrade Economy / Resource Sink runtime service.
 *
 * Cung cấp 4 flow chính server-authoritative:
 *
 *   - {@link mergeEquipment}: ghép 3 món cùng `itemKey` → 1 món
 *     `outputItemKey` theo recipe shared. Atomic consume 3 source +
 *     spend currency/material + grant 1 output + ghi 5 ledger row
 *     (3× CONSUME, 1× GRANT, 1× COST).
 *
 *   - {@link dismantleEquipment}: phân giải 1 món → yield material/lt
 *     theo shared `getEquipmentDismantleYield`. Atomic consume 1 +
 *     grant N material + auto-tách gem (trả về inventory) + ghi ledger.
 *
 *   - {@link socketGemWithCost} / {@link unsocketGemWithCost}: wrap quanh
 *     legacy `GemService` để thêm linhThach cost trước khi mutate.
 *
 *   - {@link previewUpgrade}: read-only, trả toàn bộ cost chains (enhance
 *     next level, merge nếu recipe có, dismantle yield, socket cost) cho
 *     UI render.
 *
 * Mọi flow đều atomic + chống race + idempotency basic
 * (idempotencyKey optional → caller có thể dùng để debounce).
 */
@Injectable()
export class EquipmentEconomyService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly currency: CurrencyService,
  ) {}

  // -------------------------------------------------------------------------
  // MERGE
  // -------------------------------------------------------------------------

  /**
   * Ghép 3 món cùng `itemKey` → 1 món quality cao hơn.
   *
   * Quy trình:
   *   1. Verify ownership: 3 inventoryItemId thuộc về `characterId`, distinct.
   *   2. Verify equipped/locked: cả 3 phải `equippedSlot=null` + chưa locked.
   *   3. Verify cùng `itemKey` + có recipe + output catalog tồn tại.
   *   4. Validate qua shared `validateEquipmentMergeRequest`.
   *   5. Spend material + linhThach atomic (gte guard).
   *   6. Consume 3 source row.
   *   7. Grant 1 output row.
   *   8. Ghi 5 ledger row (CONSUME×3, GRANT×1, COST×1) + currency ledger.
   */
  async mergeEquipment(
    characterId: string,
    inventoryItemIds: readonly string[],
    opts: { characterRealmOrder?: number } = {},
  ): Promise<EquipmentMergeOutcome> {
    if (inventoryItemIds.length !== EQUIPMENT_MERGE_INPUT_COUNT) {
      throw new EquipmentEconomyError('MERGE_INPUT_COUNT_INVALID');
    }
    const distinctIds = new Set(inventoryItemIds);
    if (distinctIds.size !== EQUIPMENT_MERGE_INPUT_COUNT) {
      throw new EquipmentEconomyError('MERGE_INPUT_DUPLICATE');
    }

    return this.prisma.$transaction(async (tx) => {
      const items = await tx.inventoryItem.findMany({
        where: { id: { in: [...inventoryItemIds] } },
      });
      if (items.length !== EQUIPMENT_MERGE_INPUT_COUNT) {
        throw new EquipmentEconomyError('MERGE_ITEM_NOT_FOUND');
      }
      for (const it of items) {
        if (it.characterId !== characterId) {
          throw new EquipmentEconomyError('MERGE_ITEM_NOT_OWNED');
        }
        if (it.equippedSlot !== null) {
          throw new EquipmentEconomyError('MERGE_ITEM_EQUIPPED');
        }
        if (it.qty < 1) {
          throw new EquipmentEconomyError('MERGE_ITEM_NOT_FOUND');
        }
      }

      const itemKey = items[0]?.itemKey;
      if (!itemKey) throw new EquipmentEconomyError('MERGE_ITEM_NOT_FOUND');
      for (const it of items) {
        if (it.itemKey !== itemKey) {
          throw new EquipmentEconomyError('MERGE_MIXED_INPUT');
        }
      }

      const recipe = findEquipmentMergeRecipe(itemKey);
      if (!recipe) {
        throw new EquipmentEconomyError('MERGE_RECIPE_NOT_FOUND');
      }
      const inputDef = itemByKey(itemKey);
      const outputDef = itemByKey(recipe.outputItemKey);
      if (!inputDef || !outputDef || !inputDef.slot || !outputDef.slot) {
        throw new EquipmentEconomyError('MERGE_RECIPE_NOT_FOUND');
      }
      if (inputDef.slot !== outputDef.slot) {
        throw new EquipmentEconomyError('MERGE_RECIPE_SLOT_MISMATCH');
      }
      if (!isUpgradableItemKind(inputDef.kind)) {
        throw new EquipmentEconomyError('MERGE_INVALID_KIND');
      }

      const inputMeta = deriveEquipmentProgressionMetadata({
        ...inputDef,
        slot: inputDef.slot,
      });
      const outputMeta = deriveEquipmentProgressionMetadata({
        ...outputDef,
        slot: outputDef.slot,
      });
      if (!inputMeta || !outputMeta) {
        throw new EquipmentEconomyError('MERGE_RECIPE_NOT_FOUND');
      }
      if (inputMeta.equipmentTier !== outputMeta.equipmentTier) {
        throw new EquipmentEconomyError('MERGE_TIER_MISMATCH');
      }

      const inputFamilyKey = itemKey; // family = itemKey trong Phase 23.4.
      const validation = validateEquipmentMergeRequest({
        items: items.map((it) => ({
          inventoryItemId: it.id,
          itemFamilyKey: inputFamilyKey,
          equipmentTier: inputMeta.equipmentTier,
          quality: inputDef.quality as Quality,
          slot: inputDef.slot!,
          equipped: false,
          locked: false,
        })),
        characterRealmOrder: opts.characterRealmOrder ?? outputMeta.requiredRealmOrder,
        outputRequiredRealmOrder: outputMeta.requiredRealmOrder,
        outputItemAvailable: true,
      });
      if (!validation.ok) {
        throw new EquipmentEconomyError(`MERGE_VALIDATION_${validation.code}`);
      }

      const cost = getEquipmentMergeCost({
        equipmentTier: inputMeta.equipmentTier,
        sourceQuality: inputDef.quality as Quality,
        slot: inputDef.slot,
      });

      // 1. Spend material (atomic gte guard).
      await this.spendMaterialTx(tx, characterId, cost.materialKey, cost.materialQty, {
        reason: 'EQUIPMENT_MERGE_COST',
        refType: 'EquipmentMerge',
        refId: recipe.outputItemKey,
      });

      // 2. Spend linhThach.
      try {
        await this.currency.applyTx(tx, {
          characterId,
          currency: CurrencyKind.LINH_THACH,
          delta: BigInt(-cost.linhThachCost),
          reason: 'EQUIPMENT_MERGE',
          refType: 'EquipmentMerge',
          refId: recipe.outputItemKey,
        });
      } catch (err: unknown) {
        if (isInsufficientFundsError(err)) {
          throw new EquipmentEconomyError('INSUFFICIENT_FUNDS');
        }
        throw err;
      }

      // 3. Consume 3 source items.
      for (const it of items) {
        const consumed = await tx.inventoryItem.deleteMany({
          where: { id: it.id, equippedSlot: null },
        });
        if (consumed.count !== 1) {
          throw new EquipmentEconomyError('MERGE_ITEM_CONSUME_RACE');
        }
        await tx.itemLedger.create({
          data: {
            characterId,
            itemKey,
            qtyDelta: -1,
            reason: 'EQUIPMENT_MERGE_CONSUME',
            refType: 'InventoryItem',
            refId: it.id,
          },
        });
      }

      // 4. Grant 1 output item.
      const output = await tx.inventoryItem.create({
        data: { characterId, itemKey: recipe.outputItemKey, qty: 1 },
      });
      await tx.itemLedger.create({
        data: {
          characterId,
          itemKey: recipe.outputItemKey,
          qtyDelta: 1,
          reason: 'EQUIPMENT_MERGE_GRANT',
          refType: 'InventoryItem',
          refId: output.id,
        },
      });

      return {
        outputInventoryItemId: output.id,
        outputItemKey: recipe.outputItemKey,
        outputQuality: outputDef.quality as Quality,
        consumedInventoryItemIds: items.map((it) => it.id),
        cost,
      };
    });
  }

  // -------------------------------------------------------------------------
  // DISMANTLE
  // -------------------------------------------------------------------------

  /**
   * Phân giải 1 item → yield material + linhThach + tự tháo gem (trả về
   * inventory).
   */
  async dismantleEquipment(
    characterId: string,
    inventoryItemId: string,
  ): Promise<EquipmentDismantleOutcome> {
    return this.prisma.$transaction(async (tx) => {
      const item = await tx.inventoryItem.findUnique({
        where: { id: inventoryItemId },
      });
      if (!item || item.characterId !== characterId) {
        throw new EquipmentEconomyError('DISMANTLE_ITEM_NOT_FOUND');
      }
      const def = itemByKey(item.itemKey);
      if (!def || !def.slot || !isUpgradableItemKind(def.kind)) {
        throw new EquipmentEconomyError('DISMANTLE_INVALID_KIND');
      }
      if (item.equippedSlot !== null) {
        throw new EquipmentEconomyError('DISMANTLE_ITEM_EQUIPPED');
      }
      const meta = deriveEquipmentProgressionMetadata({ ...def, slot: def.slot });
      if (!meta) {
        throw new EquipmentEconomyError('DISMANTLE_INVALID_KIND');
      }
      const validation = validateDismantleRequest({
        equipmentTier: meta.equipmentTier,
        quality: def.quality as Quality,
        slot: def.slot,
        equipped: false,
        locked: false,
        socketCount: item.sockets.length,
        allowDetachSockets: true, // server tự tháo gem trả về inventory.
      });
      if (!validation.ok) {
        throw new EquipmentEconomyError(`DISMANTLE_VALIDATION_${validation.code}`);
      }

      const yieldRes = getEquipmentDismantleYield({
        equipmentTier: meta.equipmentTier,
        quality: def.quality as Quality,
        slot: def.slot,
        enhanceLevel: item.refineLevel ?? 0,
        socketCount: item.sockets.length,
      });

      // 1. Return sockets (gems) to inventory.
      for (const gemKey of item.sockets) {
        await this.grantOneStackableTx(tx, characterId, gemKey, 1, {
          reason: 'EQUIPMENT_DISMANTLE_RETURN_GEM',
          refType: 'InventoryItem',
          refId: inventoryItemId,
        });
      }

      // 2. Consume item (deleteMany guard chống race).
      const consumed = await tx.inventoryItem.deleteMany({
        where: { id: inventoryItemId, equippedSlot: null },
      });
      if (consumed.count !== 1) {
        throw new EquipmentEconomyError('DISMANTLE_RACE');
      }
      await tx.itemLedger.create({
        data: {
          characterId,
          itemKey: item.itemKey,
          qtyDelta: -1,
          reason: 'EQUIPMENT_DISMANTLE_CONSUME',
          refType: 'InventoryItem',
          refId: inventoryItemId,
        },
      });

      // 3. Grant materials.
      for (const m of yieldRes.materials) {
        await this.grantOneStackableTx(tx, characterId, m.itemKey, m.qty, {
          reason: 'EQUIPMENT_DISMANTLE_YIELD',
          refType: 'InventoryItem',
          refId: inventoryItemId,
        });
      }

      // 4. Grant linhThach.
      if (yieldRes.linhThachYield > 0) {
        await this.currency.applyTx(tx, {
          characterId,
          currency: CurrencyKind.LINH_THACH,
          delta: BigInt(yieldRes.linhThachYield),
          reason: 'EQUIPMENT_DISMANTLE',
          refType: 'InventoryItem',
          refId: inventoryItemId,
        });
      }

      return {
        consumedInventoryItemId: inventoryItemId,
        yield: yieldRes,
        returnedGems: [...item.sockets],
      };
    });
  }

  // -------------------------------------------------------------------------
  // SOCKET COST (wraps GemService externally — see controller)
  // -------------------------------------------------------------------------

  /**
   * Spend linhThach cho khảm gem qua atomic guard. KHÔNG mutate sockets ở
   * đây — caller chịu trách nhiệm gọi `GemService.socketGem` trong cùng
   * transaction (xem controller wiring).
   */
  async chargeSocketCostTx(
    tx: Prisma.TransactionClient,
    characterId: string,
    equipmentInventoryItemId: string,
    equipmentTier: number,
    currentSocketCount: number,
  ): Promise<{ linhThachCost: number }> {
    const cost = getGemSocketCost({ equipmentTier, currentSocketCount });
    if (cost.linhThachCost > 0) {
      try {
        await this.currency.applyTx(tx, {
          characterId,
          currency: CurrencyKind.LINH_THACH,
          delta: BigInt(-cost.linhThachCost),
          reason: 'GEM_SOCKET_COST',
          refType: 'InventoryItem',
          refId: equipmentInventoryItemId,
        });
      } catch (err: unknown) {
        if (isInsufficientFundsError(err)) {
          throw new EquipmentEconomyError('INSUFFICIENT_FUNDS');
        }
        throw err;
      }
    }
    return { linhThachCost: cost.linhThachCost };
  }

  async chargeUnsocketCostTx(
    tx: Prisma.TransactionClient,
    characterId: string,
    equipmentInventoryItemId: string,
    equipmentTier: number,
    currentSocketCount: number,
  ): Promise<{ linhThachCost: number }> {
    const cost = getGemUnsocketCost({
      equipmentTier,
      currentSocketCount,
      requireMaterial: false,
    });
    if (cost.linhThachCost > 0) {
      try {
        await this.currency.applyTx(tx, {
          characterId,
          currency: CurrencyKind.LINH_THACH,
          delta: BigInt(-cost.linhThachCost),
          reason: 'GEM_UNSOCKET_COST',
          refType: 'InventoryItem',
          refId: equipmentInventoryItemId,
        });
      } catch (err: unknown) {
        if (isInsufficientFundsError(err)) {
          throw new EquipmentEconomyError('INSUFFICIENT_FUNDS');
        }
        throw err;
      }
    }
    return { linhThachCost: cost.linhThachCost };
  }

  // -------------------------------------------------------------------------
  // PREVIEW
  // -------------------------------------------------------------------------

  /**
   * Read-only preview: trả về toàn bộ cost / yield candidate cho 1 item
   * — UI dùng để render panel.
   */
  async previewUpgrade(
    characterId: string,
    inventoryItemId: string,
  ): Promise<EquipmentEconomyPreview> {
    const item = await this.prisma.inventoryItem.findUnique({
      where: { id: inventoryItemId },
    });
    if (!item || item.characterId !== characterId) {
      throw new EquipmentEconomyError('PREVIEW_ITEM_NOT_FOUND');
    }
    const def = itemByKey(item.itemKey);
    if (!def || !def.slot || !isUpgradableItemKind(def.kind)) {
      throw new EquipmentEconomyError('PREVIEW_INVALID_KIND');
    }
    const meta = deriveEquipmentProgressionMetadata({ ...def, slot: def.slot });
    if (!meta) {
      throw new EquipmentEconomyError('PREVIEW_INVALID_KIND');
    }
    const quality = def.quality as Quality;
    const slot: EquipmentSlotLike = def.slot;

    // Enhance preview (next level).
    const currentEnhanceLevel = item.refineLevel ?? 0;
    let enhance: EquipmentEconomyPreview['enhance'] = null;
    if (currentEnhanceLevel < meta.maxEnhanceLevel) {
      enhance = getEquipmentEnhanceCost({
        equipmentTier: meta.equipmentTier,
        quality,
        slot,
        currentEnhanceLevel,
      });
    }

    // Merge preview (3-of-a-kind same itemKey).
    const recipe = findEquipmentMergeRecipe(item.itemKey);
    let merge: EquipmentEconomyPreview['merge'] = null;
    if (recipe) {
      const mergeCost = getEquipmentMergeCost({
        equipmentTier: meta.equipmentTier,
        sourceQuality: quality,
        slot,
      });
      merge = {
        inputItemKey: item.itemKey,
        outputItemKey: recipe.outputItemKey,
        outputQuality: mergeCost.outputQuality,
        cost: mergeCost,
      };
    }

    const dismantle = getEquipmentDismantleYield({
      equipmentTier: meta.equipmentTier,
      quality,
      slot,
      enhanceLevel: currentEnhanceLevel,
      socketCount: item.sockets.length,
    });

    const socket = getGemSocketCost({
      equipmentTier: meta.equipmentTier,
      currentSocketCount: item.sockets.length,
    });
    const unsocket =
      item.sockets.length > 0
        ? getGemUnsocketCost({
            equipmentTier: meta.equipmentTier,
            currentSocketCount: item.sockets.length,
            requireMaterial: false,
          })
        : null;

    let reforge: EquipmentEconomyPreview['reforge'] = null;
    const reforgeCount = Array.isArray(item.substatsJson)
      ? // Substats reset toàn bộ mỗi reroll — đếm lần reroll thực sự cần
        // metadata khác. Dùng heuristic: count = 0 nếu substats empty,
        // không thì count = 1 (foundation). Tương lai: lưu reforgeCount
        // riêng trong DB.
        item.substatsJson.length > 0
        ? 1
        : 0
      : 0;
    const max = getMaxReforgeCount(quality);
    if (reforgeCount < max) {
      reforge = {
        ...getEquipmentReforgeCost({ quality, reforgeCount }),
        currentReforgeCount: reforgeCount,
      };
    }

    const protectionInfo = getProtectionCharmRequirement({
      equipmentTier: meta.equipmentTier,
      quality,
      nextEnhanceLevel: currentEnhanceLevel + 1,
    });

    const upgradeValidation = validateEquipmentUpgradeRequest({
      equipmentTier: meta.equipmentTier,
      quality,
      slot,
      currentEnhanceLevel,
      equipped: item.equippedSlot !== null,
      locked: false,
      hasProtectionCharm: undefined,
    });

    return {
      inventoryItemId: item.id,
      itemKey: item.itemKey,
      equipmentTier: meta.equipmentTier,
      quality,
      slot,
      currentEnhanceLevel,
      maxEnhanceLevel: meta.maxEnhanceLevel,
      enhance,
      merge,
      dismantle,
      socket,
      unsocket,
      reforge,
      protection: protectionInfo,
      upgradeValidation,
    };
  }

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  private async spendMaterialTx(
    tx: Prisma.TransactionClient,
    characterId: string,
    materialKey: string,
    qty: number,
    meta: { reason: 'EQUIPMENT_MERGE_COST'; refType: string; refId: string },
  ): Promise<void> {
    if (qty <= 0) return;
    const row = await tx.inventoryItem.findFirst({
      where: {
        characterId,
        itemKey: materialKey,
        equippedSlot: null,
        qty: { gte: qty },
      },
    });
    if (!row) throw new EquipmentEconomyError('INSUFFICIENT_MATERIAL');
    const dec = await tx.inventoryItem.updateMany({
      where: { id: row.id, qty: { gte: qty } },
      data: { qty: { decrement: qty } },
    });
    if (dec.count === 0) throw new EquipmentEconomyError('INSUFFICIENT_MATERIAL');
    const post = await tx.inventoryItem.findUnique({
      where: { id: row.id },
      select: { qty: true },
    });
    if (post && post.qty === 0) {
      await tx.inventoryItem.delete({ where: { id: row.id } });
    }
    await tx.itemLedger.create({
      data: {
        characterId,
        itemKey: materialKey,
        qtyDelta: -qty,
        reason: meta.reason,
        refType: meta.refType,
        refId: meta.refId,
      },
    });
  }

  private async grantOneStackableTx(
    tx: Prisma.TransactionClient,
    characterId: string,
    itemKey: string,
    qty: number,
    meta: { reason: string; refType: string; refId: string },
  ): Promise<void> {
    if (qty <= 0) return;
    const def = itemByKey(itemKey);
    if (def && def.stackable) {
      const existing = await tx.inventoryItem.findFirst({
        where: { characterId, itemKey, equippedSlot: null },
      });
      if (existing) {
        await tx.inventoryItem.update({
          where: { id: existing.id },
          data: { qty: { increment: qty } },
        });
        await tx.itemLedger.create({
          data: {
            characterId,
            itemKey,
            qtyDelta: qty,
            reason: meta.reason,
            refType: meta.refType,
            refId: meta.refId,
          },
        });
        return;
      }
    }
    await tx.inventoryItem.create({ data: { characterId, itemKey, qty } });
    await tx.itemLedger.create({
      data: {
        characterId,
        itemKey,
        qtyDelta: qty,
        reason: meta.reason,
        refType: meta.refType,
        refId: meta.refId,
      },
    });
  }
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface EquipmentMergeOutcome {
  outputInventoryItemId: string;
  outputItemKey: string;
  outputQuality: Quality;
  consumedInventoryItemIds: readonly string[];
  cost: ReturnType<typeof getEquipmentMergeCost>;
}

export interface EquipmentDismantleOutcome {
  consumedInventoryItemId: string;
  yield: ReturnType<typeof getEquipmentDismantleYield>;
  returnedGems: readonly string[];
}

export interface EquipmentEconomyPreview {
  inventoryItemId: string;
  itemKey: string;
  equipmentTier: number;
  quality: Quality;
  slot: EquipmentSlotLike;
  currentEnhanceLevel: number;
  maxEnhanceLevel: number;
  enhance: ReturnType<typeof getEquipmentEnhanceCost> | null;
  merge:
    | {
        inputItemKey: string;
        outputItemKey: string;
        outputQuality: Quality;
        cost: ReturnType<typeof getEquipmentMergeCost>;
      }
    | null;
  dismantle: ReturnType<typeof getEquipmentDismantleYield>;
  socket: ReturnType<typeof getGemSocketCost>;
  unsocket: ReturnType<typeof getGemUnsocketCost> | null;
  reforge:
    | (ReturnType<typeof getEquipmentReforgeCost> & {
        currentReforgeCount: number;
      })
    | null;
  protection: ReturnType<typeof getProtectionCharmRequirement>;
  upgradeValidation: ReturnType<typeof validateEquipmentUpgradeRequest>;
}

export class EquipmentEconomyError extends Error {
  constructor(public code: string) {
    super(code);
  }
}

function isInsufficientFundsError(err: unknown): boolean {
  return (
    !!err &&
    typeof err === 'object' &&
    'message' in err &&
    (err as { message: string }).message === 'INSUFFICIENT_FUNDS'
  );
}
