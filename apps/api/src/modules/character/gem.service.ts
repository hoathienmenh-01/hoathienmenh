import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import {
  canSocketGem,
  combineGems as catalogCombineGems,
  getGemDef,
  itemByKey,
  socketCapacityForQuality,
  type GemCompatibleSlot,
} from '@xuantoi/shared';
import { PrismaService } from '../../common/prisma.service';

/**
 * Phase 11.4.B Gem MVP runtime service.
 *
 * 3 method server-authoritative:
 *   - `socketGem(charId, equipmentInventoryItemId, gemKey)` — khảm 1 gem
 *     vào equipment slot kế tiếp. Verify capacity (`socketCapacityForQuality`),
 *     verify gem `compatibleSlots` ⊇ equipment slot, deduct 1 gem qty qua
 *     `ItemLedger` reason `GEM_SOCKET`, append gemKey vào `sockets[]`.
 *   - `unsocketGem(charId, equipmentInventoryItemId, slotIndex)` — gỡ
 *     gem ở `slots[slotIndex]`, return gem qty về inventory unequipped row
 *     (stack hoặc tạo mới), ghi `ItemLedger` reason `GEM_UNSOCKET` (qtyDelta +1).
 *   - `combineGems(charId, srcGemKey)` — verify total unequipped qty ≥ 3,
 *     deduct 3 ghi `ItemLedger` `GEM_COMBINE`, grant 1 next-tier ghi
 *     `ItemLedger` `GEM_COMBINE` (qtyDelta +1).
 *
 * Atomic guarantees: tất cả 3 method dùng `prisma.$transaction` — không
 * xảy ra phân nửa state (deduct nhưng không append, hoặc grant nhưng không
 * deduct). `@@unique` constraint `[characterId, equippedSlot]` ngăn double-equip.
 *
 * Idempotency: socket / unsocket / combine không có tự nhiên idempotent
 * key — caller phải debounce. Nhưng mỗi operation atomic + ledger đầy đủ
 * cho audit replay.
 */
@Injectable()
export class GemService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Khảm 1 gem (gemKey) vào equipment (inventoryItemId). Append vào cuối
   * `sockets[]`. Không cần slot index input vì luôn append.
   */
  async socketGem(
    characterId: string,
    equipmentInventoryItemId: string,
    gemKey: string,
  ): Promise<GemSocketResult> {
    const gemDef = getGemDef(gemKey);
    if (!gemDef) throw new GemError('GEM_NOT_FOUND');

    return this.prisma.$transaction(async (tx) => {
      const equipment = await tx.inventoryItem.findUnique({
        where: { id: equipmentInventoryItemId },
      });
      if (!equipment) throw new GemError('EQUIPMENT_NOT_FOUND');
      if (equipment.characterId !== characterId) {
        throw new GemError('EQUIPMENT_NOT_FOUND');
      }
      const equipmentDef = itemByKey(equipment.itemKey);
      if (!equipmentDef) throw new GemError('EQUIPMENT_NOT_FOUND');
      if (!equipmentDef.slot) throw new GemError('NOT_EQUIPPABLE');

      // Compatibility: gem.compatibleSlots phải chứa ANY hoặc slot khớp.
      if (!canSocketGem(gemKey, equipmentDef.slot as GemCompatibleSlot)) {
        throw new GemError('GEM_INCOMPATIBLE_SLOT');
      }

      const capacity = socketCapacityForQuality(equipmentDef.quality);
      if (capacity === 0) throw new GemError('NO_SOCKET_CAPACITY');
      if (equipment.sockets.length >= capacity) {
        throw new GemError('SOCKETS_FULL');
      }

      // Tìm row unequipped chứa gem này.
      const gemRow = await tx.inventoryItem.findFirst({
        where: { characterId, itemKey: gemKey, equippedSlot: null },
      });
      if (!gemRow || gemRow.qty < 1) {
        throw new GemError('INSUFFICIENT_QTY');
      }

      // Deduct 1 gem qty.
      if (gemRow.qty === 1) {
        await tx.inventoryItem.delete({ where: { id: gemRow.id } });
      } else {
        await tx.inventoryItem.update({
          where: { id: gemRow.id },
          data: { qty: gemRow.qty - 1 },
        });
      }

      // Append gem vào sockets[].
      const newSockets = [...equipment.sockets, gemKey];
      await tx.inventoryItem.update({
        where: { id: equipment.id },
        data: { sockets: newSockets },
      });

      // Ledger.
      await tx.itemLedger.create({
        data: {
          characterId,
          itemKey: gemKey,
          qtyDelta: -1,
          reason: 'GEM_SOCKET',
          refType: 'InventoryItem',
          refId: equipment.id,
        },
      });

      return {
        equipmentInventoryItemId: equipment.id,
        gemKey,
        slotIndex: newSockets.length - 1,
        sockets: newSockets,
      };
    });
  }

  /**
   * Gỡ gem ở slot index. Gem qty về inventory unequipped row (stack hoặc tạo mới).
   */
  async unsocketGem(
    characterId: string,
    equipmentInventoryItemId: string,
    slotIndex: number,
  ): Promise<GemUnsocketResult> {
    if (!Number.isInteger(slotIndex) || slotIndex < 0) {
      throw new GemError('INVALID_SLOT_INDEX');
    }

    return this.prisma.$transaction(async (tx) => {
      const equipment = await tx.inventoryItem.findUnique({
        where: { id: equipmentInventoryItemId },
      });
      if (!equipment) throw new GemError('EQUIPMENT_NOT_FOUND');
      if (equipment.characterId !== characterId) {
        throw new GemError('EQUIPMENT_NOT_FOUND');
      }
      if (slotIndex >= equipment.sockets.length) {
        throw new GemError('INVALID_SLOT_INDEX');
      }
      const gemKey = equipment.sockets[slotIndex];
      const gemDef = getGemDef(gemKey);
      if (!gemDef) {
        // Catalog drift — gemKey trong DB không còn tồn tại trong catalog.
        // Không throw — vẫn cho gỡ ra để user không kẹt; nhưng skip grant.
        const filtered = equipment.sockets.filter((_, i) => i !== slotIndex);
        await tx.inventoryItem.update({
          where: { id: equipment.id },
          data: { sockets: filtered },
        });
        return {
          equipmentInventoryItemId: equipment.id,
          gemKey,
          sockets: filtered,
          gemReturned: false,
        };
      }

      const filtered = equipment.sockets.filter((_, i) => i !== slotIndex);
      await tx.inventoryItem.update({
        where: { id: equipment.id },
        data: { sockets: filtered },
      });

      // Grant gem 1 qty về inventory.
      await this.grantGemTx(tx, characterId, gemKey, 1, {
        reason: 'GEM_UNSOCKET',
        refId: equipment.id,
      });

      return {
        equipmentInventoryItemId: equipment.id,
        gemKey,
        sockets: filtered,
        gemReturned: true,
      };
    });
  }

  /**
   * Combine 3× gem cùng key → 1× gem next-tier.
   * Deterministic: không RNG; THAN không combine được.
   */
  async combineGems(
    characterId: string,
    srcGemKey: string,
  ): Promise<GemCombineResultOut> {
    const plan = catalogCombineGems(srcGemKey);
    if (!plan) {
      // srcGemKey không tồn tại HOẶC THAN tier (no nextTier).
      const def = getGemDef(srcGemKey);
      if (!def) throw new GemError('GEM_NOT_FOUND');
      throw new GemError('NO_NEXT_TIER');
    }

    return this.prisma.$transaction(async (tx) => {
      // Total qty unequipped row.
      const rows = await tx.inventoryItem.findMany({
        where: { characterId, itemKey: srcGemKey, equippedSlot: null },
        orderBy: { createdAt: 'asc' },
      });
      const total = rows.reduce((s, r) => s + r.qty, 0);
      if (total < 3) throw new GemError('INSUFFICIENT_QTY');

      // Deduct 3 từ row(s) FIFO.
      let remaining = 3;
      for (const r of rows) {
        if (remaining <= 0) break;
        const take = Math.min(r.qty, remaining);
        remaining -= take;
        if (r.qty === take) {
          await tx.inventoryItem.delete({ where: { id: r.id } });
        } else {
          await tx.inventoryItem.update({
            where: { id: r.id },
            data: { qty: r.qty - take },
          });
        }
      }
      // Ledger consume.
      await tx.itemLedger.create({
        data: {
          characterId,
          itemKey: srcGemKey,
          qtyDelta: -3,
          reason: 'GEM_COMBINE',
          refType: 'GemCombine',
          refId: plan.resultKey,
        },
      });

      // Grant 1 next-tier.
      await this.grantGemTx(tx, characterId, plan.resultKey, 1, {
        reason: 'GEM_COMBINE',
        refType: 'GemCombine',
        refId: srcGemKey,
      });

      return {
        srcGemKey,
        srcQtyConsumed: 3,
        resultGemKey: plan.resultKey,
        resultQtyGained: 1,
      };
    });
  }

  /**
   * Public wrapper — grant N gem qty outside a transaction (admin use).
   */
  async grantGems(
    characterId: string,
    gemKey: string,
    qty: number,
    meta: { reason: string; refType?: string; refId?: string },
  ): Promise<void> {
    const def = getGemDef(gemKey);
    if (!def) throw new GemError('GEM_NOT_FOUND');
    await this.prisma.$transaction((tx) =>
      this.grantGemTx(tx, characterId, gemKey, qty, meta),
    );
  }

  /**
   * Grant N gem qty về inventory (stack vào row unequipped sẵn có nếu có,
   * nếu không tạo row mới). Tx-aware.
   */
  private async grantGemTx(
    tx: Prisma.TransactionClient,
    characterId: string,
    itemKey: string,
    qty: number,
    meta: { reason: string; refType?: string; refId?: string },
  ): Promise<void> {
    const existing = await tx.inventoryItem.findFirst({
      where: { characterId, itemKey, equippedSlot: null },
    });
    if (existing) {
      await tx.inventoryItem.update({
        where: { id: existing.id },
        data: { qty: { increment: qty } },
      });
    } else {
      await tx.inventoryItem.create({
        data: { characterId, itemKey, qty },
      });
    }
    await tx.itemLedger.create({
      data: {
        characterId,
        itemKey,
        qtyDelta: qty,
        reason: meta.reason,
        refType: meta.refType ?? null,
        refId: meta.refId ?? null,
      },
    });
  }
}

export interface GemSocketResult {
  equipmentInventoryItemId: string;
  gemKey: string;
  slotIndex: number;
  sockets: string[];
}

export interface GemUnsocketResult {
  equipmentInventoryItemId: string;
  gemKey: string;
  sockets: string[];
  /**
   * `false` nếu gem catalog drift — gemKey trong DB không còn trong catalog
   * → service vẫn cho gỡ nhưng không grant lại để tránh restore item invalid.
   */
  gemReturned: boolean;
}

export interface GemCombineResultOut {
  srcGemKey: string;
  srcQtyConsumed: 3;
  resultGemKey: string;
  resultQtyGained: 1;
}

export class GemError extends Error {
  constructor(
    public code:
      | 'GEM_NOT_FOUND'
      | 'EQUIPMENT_NOT_FOUND'
      | 'NOT_EQUIPPABLE'
      | 'GEM_INCOMPATIBLE_SLOT'
      | 'NO_SOCKET_CAPACITY'
      | 'SOCKETS_FULL'
      | 'INSUFFICIENT_QTY'
      | 'INVALID_SLOT_INDEX'
      | 'NO_NEXT_TIER',
  ) {
    super(code);
  }
}
