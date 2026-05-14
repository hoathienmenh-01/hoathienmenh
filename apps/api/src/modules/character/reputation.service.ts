import { Injectable } from '@nestjs/common';
import {
  REPUTATION_GROUPS,
  getReputationGroupDef,
  type ReputationGroup,
  type ReputationGroupDef,
} from '@xuantoi/shared';
import { PrismaService } from '../../common/prisma.service';

function todayKey(d = new Date()): string {
  return d.toISOString().slice(0, 10);
}

export interface ReputationRowView {
  group: ReputationGroup;
  score: number;
  dailyGain: number;
  dailyCap: number;
  lastGainedAt: Date | null;
  def: ReputationGroupDef;
}

export interface ReputationGainResult extends ReputationRowView {
  requestedAmount: number;
  appliedAmount: number;
  capped: boolean;
}

@Injectable()
export class ReputationService {
  constructor(private readonly prisma: PrismaService) {}

  async addReputation(
    characterId: string,
    group: ReputationGroup,
    amount: number,
  ): Promise<ReputationGainResult> {
    if (!Number.isInteger(amount) || amount <= 0) {
      throw new ReputationError('INVALID_AMOUNT');
    }
    const def = getReputationGroupDef(group);
    if (!def) throw new ReputationError('REPUTATION_GROUP_NOT_FOUND');

    return this.prisma.$transaction(async (tx) => {
      const character = await tx.character.findUnique({
        where: { id: characterId },
        select: { id: true },
      });
      if (!character) throw new ReputationError('CHARACTER_NOT_FOUND');

      const now = new Date();
      const key = todayKey(now);
      const existing = await tx.characterReputation.findUnique({
        where: {
          characterId_reputationGroup: { characterId, reputationGroup: group },
        },
      });
      const currentDaily =
        existing && existing.dailyKey === key ? existing.dailyGain : 0;
      const remaining = Math.max(0, def.dailyCap - currentDaily);
      const appliedAmount = Math.min(amount, remaining);
      const score = (existing?.score ?? 0) + appliedAmount;
      const dailyGain = currentDaily + appliedAmount;

      const row = existing
        ? await tx.characterReputation.update({
            where: { id: existing.id },
            data: {
              score,
              dailyGain,
              dailyKey: key,
              lastGainedAt: appliedAmount > 0 ? now : existing.lastGainedAt,
            },
          })
        : await tx.characterReputation.create({
            data: {
              characterId,
              reputationGroup: group,
              score,
              dailyGain,
              dailyKey: key,
              lastGainedAt: appliedAmount > 0 ? now : null,
            },
          });

      return {
        group,
        score: row.score,
        dailyGain: row.dailyGain,
        dailyCap: def.dailyCap,
        lastGainedAt: row.lastGainedAt,
        def,
        requestedAmount: amount,
        appliedAmount,
        capped: appliedAmount < amount,
      };
    });
  }

  async list(characterId: string): Promise<ReputationRowView[]> {
    const rows = await this.prisma.characterReputation.findMany({
      where: { characterId },
    });
    const byGroup = new Map(rows.map((r) => [r.reputationGroup, r] as const));
    return REPUTATION_GROUPS.map((def) => {
      const row = byGroup.get(def.key);
      return {
        group: def.key,
        score: row?.score ?? 0,
        dailyGain: row?.dailyGain ?? 0,
        dailyCap: def.dailyCap,
        lastGainedAt: row?.lastGainedAt ?? null,
        def,
      };
    });
  }
}

export type ReputationErrorCode =
  | 'REPUTATION_GROUP_NOT_FOUND'
  | 'CHARACTER_NOT_FOUND'
  | 'INVALID_AMOUNT';

export class ReputationError extends Error {
  readonly name = 'ReputationError';
  constructor(public readonly code: ReputationErrorCode, message?: string) {
    super(message ?? code);
  }
}
