/**
 * Phase 35.0B — Pet Box / Egg / Pity service.
 *
 * Server-authoritative box open flow:
 *   1. Validate boxKey + characterId.
 *   2. Atomic transaction:
 *      a. Read pity counters (lock row qua `findUnique` + `update`).
 *      b. Apply cost qua InventoryService (vé) hoặc CurrencyService
 *         (LINH_THACH / TIEN_NGOC / EVENT_TOKEN).
 *      c. RNG roll rarity (deterministic seed = `requestId` hoặc cuid mới).
 *      d. Increment counters, apply pity → maybe upgrade rarity.
 *      e. Roll entry in bucket, decide PET / SHARD / MATERIAL / TICKET_REFUND.
 *      f. Grant pet (qua PetCollectionService) hoặc shard (PetShardService)
 *         hoặc material (InventoryService.grantTx).
 *      g. Reset counters cho rule đã trigger.
 *      h. Insert PetBoxOpenLog idempotent (UNIQUE characterId+boxKey+requestId).
 *
 *   3. Idempotency: nếu client gửi cùng `requestId` → trả log cũ (early return
 *      pre-transaction để tránh consume cost lần 2).
 *
 * **Forbidden invariants enforce ở đây**:
 *   - KHÔNG có open free unlimited — mọi mở có cost.
 *   - KHÔNG có result type khác PET / SHARD / MATERIAL / TICKET_REFUND.
 *   - KHÔNG bypass InventoryService / CurrencyService.
 */
import { Injectable } from '@nestjs/common';
import {
  PET_BOXES,
  petBoxByKey,
  rollRarity,
  rollEntry,
  applyPity,
  advanceCounters,
  petByKey,
  PET_RARITIES,
  type PetBoxCostType,
  type PetBoxDef,
  type PetBoxPoolEntry,
  type PetBoxPityRule,
  type PetPityCounters,
  type PetRarity,
} from '@xuantoi/shared';
import type { Prisma } from '@prisma/client';
import { randomBytes, createHash } from 'crypto';

import { PrismaService } from '../../common/prisma.service';
import { InventoryService } from '../inventory/inventory.service';
import { CurrencyService } from '../character/currency.service';
import { CurrencyKind } from '@prisma/client';
import { PetCollectionService } from './pet-collection.service';
import { PetShardService } from './pet-shard.service';

export class PetBoxError extends Error {
  constructor(public code: string) {
    super(code);
  }
}

export interface OpenBoxInput {
  characterId: string;
  boxKey: string;
  /** Idempotency key. Server tự gen nếu thiếu (single-shot non-idempotent). */
  requestId?: string;
}

export interface OpenBoxResult {
  logId: string;
  boxKey: string;
  poolKey: string;
  rarity: PetRarity;
  pityTriggered: boolean;
  resultType: 'PET' | 'SHARD' | 'MATERIAL' | 'TICKET_REFUND';
  resultKey: string;
  resultAmount: number;
  /** Pet detail nếu resultType=PET (mới grant). */
  petInstanceId?: string;
  /** Pity counters sau lần mở. */
  countersAfter: PetPityCounters;
}

@Injectable()
export class PetBoxService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly inventory: InventoryService,
    private readonly currency: CurrencyService,
    private readonly collection: PetCollectionService,
    private readonly shards: PetShardService,
  ) {}

  catalog(): readonly PetBoxDef[] {
    return PET_BOXES;
  }

  get(boxKey: string): PetBoxDef | undefined {
    return petBoxByKey(boxKey);
  }

  /**
   * Open 1 lần. Atomic, idempotent qua `requestId` (UNIQUE constraint trong
   * `PetBoxOpenLog`).
   */
  async open(input: OpenBoxInput): Promise<OpenBoxResult> {
    const box = petBoxByKey(input.boxKey);
    if (!box) throw new PetBoxError('PET_BOX_NOT_FOUND');
    const reqId = input.requestId ?? randomBytes(12).toString('hex');

    // Idempotent pre-check: nếu log đã có, trả về luôn (KHÔNG consume lần 2).
    const existing = await this.prisma.petBoxOpenLog.findUnique({
      where: {
        characterId_boxKey_requestId: {
          characterId: input.characterId,
          boxKey: box.boxKey,
          requestId: reqId,
        },
      },
    });
    if (existing) {
      const counters = await this.readCounters(
        input.characterId,
        box.boxKey,
        box.poolKey,
      );
      return {
        logId: existing.id,
        boxKey: existing.boxKey,
        poolKey: existing.poolKey,
        rarity: existing.resultRarity as PetRarity,
        pityTriggered: existing.pityTriggered,
        resultType: existing.resultType as OpenBoxResult['resultType'],
        resultKey: existing.resultKey,
        resultAmount: existing.resultAmount,
        countersAfter: counters,
      };
    }

    return this.prisma.$transaction(async (tx) => {
      // 1) Lock counter row (upsert + select for guarantee row exists).
      const counterRow = await tx.characterPetBoxPityCounter.upsert({
        where: {
          characterId_boxKey_poolKey: {
            characterId: input.characterId,
            boxKey: box.boxKey,
            poolKey: box.poolKey,
          },
        },
        create: {
          characterId: input.characterId,
          boxKey: box.boxKey,
          poolKey: box.poolKey,
        },
        update: {},
      });

      // 2) Apply cost.
      await this.applyCostTx(tx, input.characterId, box, reqId);

      // 3) RNG roll. Seed = sha256(reqId || boxKey || counterRow.id).
      const u1 = this.rngFloat(reqId, box.boxKey, 'rarity', counterRow.totalOpens);
      const u2 = this.rngFloat(reqId, box.boxKey, 'entry', counterRow.totalOpens);
      const rolledRarity = rollRarity(box.rarityRates as any, u1);

      // 4) Increment counters for THIS open, then apply pity.
      const incremented = advanceCounters(
        {
          opensSinceRare: counterRow.opensSinceRare,
          opensSinceEpic: counterRow.opensSinceEpic,
          opensSinceLegendary: counterRow.opensSinceLegendary,
          opensSinceMythic: counterRow.opensSinceMythic,
        },
        rolledRarity,
      );
      const pity = applyPity(
        box.pityRules as PetBoxPityRule[],
        rolledRarity,
        incremented,
      );

      // 5) Roll entry in bucket.
      const bucket = box.pool.filter((p) => p.rarity === pity.appliedRarity);
      if (bucket.length === 0) {
        throw new PetBoxError('PET_BOX_MISSING_BUCKET');
      }
      const entry = rollEntry(bucket as PetBoxPoolEntry[], u2);

      // 6) Grant result.
      let petInstanceId: string | undefined;
      let resultAmount = entry.amount ?? 1;
      if (entry.resultType === 'PET') {
        const grantedPet = await this.collection.grantPet(
          {
            characterId: input.characterId,
            petKey: entry.resultKey,
            source: 'BOX',
          },
          tx,
        );
        petInstanceId = grantedPet.id;
        resultAmount = 1;
      } else if (entry.resultType === 'SHARD') {
        await this.shards.grantTx(tx, input.characterId, entry.resultKey, resultAmount);
      } else if (entry.resultType === 'MATERIAL') {
        await this.inventory.grantTx(
          tx,
          input.characterId,
          [{ itemKey: entry.resultKey, qty: resultAmount }],
          {
            reason: 'PET_BOX_REWARD',
            refType: 'PetBox',
            refId: box.boxKey,
            extra: { rarity: pity.appliedRarity },
          },
        );
      } else if (entry.resultType === 'TICKET_REFUND') {
        await this.inventory.grantTx(
          tx,
          input.characterId,
          [{ itemKey: entry.resultKey, qty: resultAmount }],
          {
            reason: 'PET_BOX_REWARD',
            refType: 'PetBox',
            refId: box.boxKey,
            extra: { rarity: pity.appliedRarity, ticketRefund: true },
          },
        );
      }

      // 7) Apply counter resets / writes.
      const finalCounters: PetPityCounters = { ...incremented };
      for (const k of pity.counterResets) finalCounters[k] = 0;
      const reachedAt = advanceCountersWithFinalReset(finalCounters, pity.appliedRarity);
      await tx.characterPetBoxPityCounter.update({
        where: { id: counterRow.id },
        data: {
          totalOpens: { increment: 1 },
          opensSinceRare: reachedAt.opensSinceRare,
          opensSinceEpic: reachedAt.opensSinceEpic,
          opensSinceLegendary: reachedAt.opensSinceLegendary,
          opensSinceMythic: reachedAt.opensSinceMythic,
        },
      });

      // 8) Insert audit log.
      const log = await tx.petBoxOpenLog.create({
        data: {
          characterId: input.characterId,
          boxKey: box.boxKey,
          poolKey: box.poolKey,
          costType: box.costPerOpen.costType,
          costAmount: BigInt(box.costPerOpen.amount),
          resultType: entry.resultType,
          resultKey: entry.resultKey,
          resultAmount,
          resultRarity: pity.appliedRarity,
          resultQuality: petByKey(entry.resultKey)?.quality ?? 'PHAM',
          pityTriggered: pity.pityTriggered,
          pityRuleVersion: pity.triggeredRule
            ? `pity_${pity.triggeredRule.rarityAtLeast}_${pity.triggeredRule.triggerEveryOpens}`
            : null,
          rateVersion: 1,
          requestId: reqId,
        },
      });

      return {
        logId: log.id,
        boxKey: box.boxKey,
        poolKey: box.poolKey,
        rarity: pity.appliedRarity,
        pityTriggered: pity.pityTriggered,
        resultType: entry.resultType,
        resultKey: entry.resultKey,
        resultAmount,
        petInstanceId,
        countersAfter: reachedAt,
      };
    });
  }

  private async applyCostTx(
    tx: Prisma.TransactionClient,
    characterId: string,
    box: PetBoxDef,
    requestId: string,
  ): Promise<void> {
    const cost = box.costPerOpen;
    const refId = `${box.boxKey}:${requestId}`;
    switch (cost.costType as PetBoxCostType) {
      case 'LINH_THACH':
        await this.currency.applyTx(tx, {
          characterId,
          currency: CurrencyKind.LINH_THACH,
          delta: BigInt(-cost.amount),
          reason: 'PET_BOX_OPEN_COST',
          refType: 'PetBox',
          refId,
        });
        break;
      case 'TIEN_NGOC':
        await this.currency.applyTx(tx, {
          characterId,
          currency: CurrencyKind.TIEN_NGOC,
          delta: BigInt(-cost.amount),
          reason: 'PET_BOX_OPEN_COST',
          refType: 'PetBox',
          refId,
        });
        break;
      case 'EVENT_TOKEN':
        await this.currency.applyTx(tx, {
          characterId,
          currency: CurrencyKind.EVENT_TOKEN,
          delta: BigInt(-cost.amount),
          reason: 'PET_BOX_OPEN_COST',
          refType: 'PetBox',
          refId,
        });
        break;
      case 'TICKET': {
        const itemKey = cost.itemKey;
        if (!itemKey) throw new PetBoxError('PET_BOX_INVALID_COST');
        await this.inventory.consumeManyByItemKeyTx(
          tx,
          characterId,
          itemKey,
          cost.amount,
          {
            reason: 'PET_BOX_OPEN_COST',
            refType: 'PetBox',
            refId,
          },
        );
        break;
      }
      default:
        throw new PetBoxError('PET_BOX_INVALID_COST');
    }
  }

  async readCounters(
    characterId: string,
    boxKey: string,
    poolKey: string,
  ): Promise<PetPityCounters> {
    const r = await this.prisma.characterPetBoxPityCounter.findUnique({
      where: {
        characterId_boxKey_poolKey: { characterId, boxKey, poolKey },
      },
    });
    return {
      opensSinceRare: r?.opensSinceRare ?? 0,
      opensSinceEpic: r?.opensSinceEpic ?? 0,
      opensSinceLegendary: r?.opensSinceLegendary ?? 0,
      opensSinceMythic: r?.opensSinceMythic ?? 0,
    };
  }

  async logs(
    characterId: string,
    boxKey?: string,
    limit = 50,
  ): Promise<unknown[]> {
    const where: Prisma.PetBoxOpenLogWhereInput = { characterId };
    if (boxKey) where.boxKey = boxKey;
    const rows = await this.prisma.petBoxOpenLog.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: Math.min(200, Math.max(1, limit)),
    });
    return rows.map((r) => ({
      id: r.id,
      boxKey: r.boxKey,
      resultType: r.resultType,
      resultKey: r.resultKey,
      resultAmount: r.resultAmount,
      resultRarity: r.resultRarity,
      pityTriggered: r.pityTriggered,
      createdAt: r.createdAt.toISOString(),
    }));
  }

  private rngFloat(
    requestId: string,
    boxKey: string,
    role: string,
    salt: number,
  ): number {
    const h = createHash('sha256')
      .update(`${requestId}|${boxKey}|${role}|${salt}`)
      .digest();
    const x = h.readBigUInt64BE(0);
    return Number(x % BigInt(2 ** 32)) / 2 ** 32;
  }
}

/** Helper — sau pity reset, vẫn cần đảm bảo `appliedRarity` reset đúng các
 * counter cao hơn (tránh stuck). */
function advanceCountersWithFinalReset(
  counters: PetPityCounters,
  appliedRarity: PetRarity,
): PetPityCounters {
  const next = { ...counters };
  const order = PET_RARITIES;
  const idx = order.indexOf(appliedRarity);
  if (idx >= order.indexOf('MYTHIC')) {
    next.opensSinceMythic = 0;
    next.opensSinceLegendary = 0;
    next.opensSinceEpic = 0;
    next.opensSinceRare = 0;
  } else if (idx >= order.indexOf('LEGENDARY')) {
    next.opensSinceLegendary = 0;
    next.opensSinceEpic = 0;
    next.opensSinceRare = 0;
  } else if (idx >= order.indexOf('EPIC')) {
    next.opensSinceEpic = 0;
    next.opensSinceRare = 0;
  } else if (idx >= order.indexOf('RARE')) {
    next.opensSinceRare = 0;
  }
  return next;
}
