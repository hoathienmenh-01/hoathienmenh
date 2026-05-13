/**
 * Phase 35.0 — Pet shard service.
 *
 * Upsert / consume shard per (character, petKey). Atomic update qua
 * `updateMany` with `amount >= qty` guard giống `CurrencyService.applyTx`.
 */
import { Injectable } from '@nestjs/common';
import { petByKey } from '@xuantoi/shared';
import type { Prisma } from '@prisma/client';

import { PrismaService } from '../../common/prisma.service';

export class PetShardError extends Error {
  constructor(public code: string) {
    super(code);
  }
}

@Injectable()
export class PetShardService {
  constructor(private readonly prisma: PrismaService) {}

  async balance(characterId: string, petKey: string): Promise<number> {
    const row = await this.prisma.characterPetShard.findUnique({
      where: { characterId_petKey: { characterId, petKey } },
    });
    return row?.amount ?? 0;
  }

  async listAll(characterId: string): Promise<{ petKey: string; amount: number }[]> {
    const rows = await this.prisma.characterPetShard.findMany({
      where: { characterId },
      orderBy: { petKey: 'asc' },
    });
    return rows.map((r) => ({ petKey: r.petKey, amount: r.amount }));
  }

  async grantTx(
    tx: Prisma.TransactionClient,
    characterId: string,
    petKey: string,
    amount: number,
  ): Promise<number> {
    if (amount <= 0) throw new PetShardError('PET_SHARD_INVALID_AMOUNT');
    if (!petByKey(petKey)) throw new PetShardError('PET_NOT_FOUND');
    const up = await tx.characterPetShard.upsert({
      where: { characterId_petKey: { characterId, petKey } },
      create: { characterId, petKey, amount },
      update: { amount: { increment: amount } },
    });
    return up.amount;
  }

  async consumeTx(
    tx: Prisma.TransactionClient,
    characterId: string,
    petKey: string,
    amount: number,
  ): Promise<number> {
    if (amount <= 0) throw new PetShardError('PET_SHARD_INVALID_AMOUNT');
    if (!petByKey(petKey)) throw new PetShardError('PET_NOT_FOUND');
    const upd = await tx.characterPetShard.updateMany({
      where: { characterId, petKey, amount: { gte: amount } },
      data: { amount: { decrement: amount } },
    });
    if (upd.count === 0) throw new PetShardError('PET_SHARD_INSUFFICIENT');
    const after = await tx.characterPetShard.findUnique({
      where: { characterId_petKey: { characterId, petKey } },
    });
    return after?.amount ?? 0;
  }
}
