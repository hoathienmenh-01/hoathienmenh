import { Injectable } from '@nestjs/common';
import {
  LONG_TERM_GOALS,
  getLongTermGoalDef,
  type LongTermGoalDef,
  type MissionGoalKind,
} from '@xuantoi/shared';
import { PrismaService } from '../../common/prisma.service';

export interface LongTermGoalRowView {
  goalKey: string;
  progress: number;
  completedAt: Date | null;
  def: LongTermGoalDef;
}

export interface LongTermGoalProgressResult extends LongTermGoalRowView {
  justCompleted: boolean;
}

@Injectable()
export class LongTermGoalService {
  constructor(private readonly prisma: PrismaService) {}

  async incrementProgress(
    characterId: string,
    goalKey: string,
    amount = 1,
  ): Promise<LongTermGoalProgressResult> {
    if (!Number.isInteger(amount) || amount <= 0) {
      throw new LongTermGoalError('INVALID_AMOUNT');
    }
    const def = getLongTermGoalDef(goalKey);
    if (!def) throw new LongTermGoalError('GOAL_NOT_FOUND');

    return this.prisma.$transaction(async (tx) => {
      const character = await tx.character.findUnique({
        where: { id: characterId },
        select: { id: true },
      });
      if (!character) throw new LongTermGoalError('CHARACTER_NOT_FOUND');

      const existing = await tx.characterLongTermGoal.findUnique({
        where: { characterId_goalKey: { characterId, goalKey } },
      });
      if (existing?.completedAt) {
        return {
          goalKey,
          progress: existing.progress,
          completedAt: existing.completedAt,
          def,
          justCompleted: false,
        };
      }

      const nextProgress = Math.min(
        def.goalAmount,
        (existing?.progress ?? 0) + amount,
      );
      const justCompleted = nextProgress >= def.goalAmount;
      const completedAt = justCompleted ? new Date() : null;
      const row = existing
        ? await tx.characterLongTermGoal.update({
            where: { id: existing.id },
            data: {
              progress: nextProgress,
              completedAt: completedAt ?? existing.completedAt,
            },
          })
        : await tx.characterLongTermGoal.create({
            data: {
              characterId,
              goalKey,
              progress: nextProgress,
              completedAt,
            },
          });

      return {
        goalKey,
        progress: row.progress,
        completedAt: row.completedAt,
        def,
        justCompleted,
      };
    });
  }

  async trackEvent(
    characterId: string,
    goalKind: MissionGoalKind,
    amount = 1,
  ): Promise<LongTermGoalProgressResult[]> {
    if (!Number.isInteger(amount) || amount <= 0) {
      throw new LongTermGoalError('INVALID_AMOUNT');
    }
    const matching = LONG_TERM_GOALS.filter((goal) => goal.goalKind === goalKind);
    const out: LongTermGoalProgressResult[] = [];
    for (const goal of matching) {
      out.push(await this.incrementProgress(characterId, goal.key, amount));
    }
    return out;
  }

  async list(characterId: string): Promise<LongTermGoalRowView[]> {
    const rows = await this.prisma.characterLongTermGoal.findMany({
      where: { characterId },
    });
    const byKey = new Map(rows.map((r) => [r.goalKey, r] as const));
    return LONG_TERM_GOALS.map((def) => {
      const row = byKey.get(def.key);
      return {
        goalKey: def.key,
        progress: row?.progress ?? 0,
        completedAt: row?.completedAt ?? null,
        def,
      };
    });
  }
}

export type LongTermGoalErrorCode =
  | 'GOAL_NOT_FOUND'
  | 'CHARACTER_NOT_FOUND'
  | 'INVALID_AMOUNT';

export class LongTermGoalError extends Error {
  readonly name = 'LongTermGoalError';
  constructor(public readonly code: LongTermGoalErrorCode, message?: string) {
    super(message ?? code);
  }
}
