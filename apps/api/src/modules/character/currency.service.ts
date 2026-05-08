import { Injectable } from '@nestjs/common';
import { CurrencyKind, Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma.service';

export class CurrencyError extends Error {
  constructor(
    public code: 'INSUFFICIENT_FUNDS' | 'NOT_FOUND' | 'INVALID_INPUT',
  ) {
    super(code);
  }
}

/**
 * Lý do thay đổi tiền — string constant để query dễ + ổn định khi đổi enum.
 * Khi thêm reason mới, mở rộng union này (nhờ `as const` ở các caller).
 */
export type LedgerReason =
  | 'MARKET_BUY'
  | 'MARKET_SELL'
  | 'SECT_CONTRIBUTE'
  | 'ADMIN_GRANT'
  | 'ADMIN_TOPUP_APPROVE'
  | 'BOSS_REWARD'
  | 'COMBAT_LOOT'
  | 'MISSION_CLAIM'
  | 'GIFTCODE_REDEEM'
  | 'MAIL_CLAIM'
  | 'SHOP_BUY'
  | 'DAILY_LOGIN'
  | 'SKILL_UPGRADE'
  | 'REFINE'
  | 'TRIBULATION_REWARD'
  | 'ACHIEVEMENT_REWARD'
  | 'ALCHEMY_COST'
  | 'ALCHEMY_FURNACE_UPGRADE'
  // Phase 12 Story PR-3 — Quest claim reward. Wire `QuestService.claim` qua
  // `applyTx` cho linhThach/tienNgoc với `refType='Quest'` + `refId=questKey`.
  // Idempotency lấy từ `QuestProgress.claimedAt` CAS guard (race-safe winner
  // duy nhất ghi 1 ledger row / questKey).
  | 'QUEST_CLAIM'
  // Phase 12.2.B — DungeonRun completion reward bonus. Wire
  // `DungeonRunService.claim` qua `applyTx` cho linhThach/tienNgoc với
  // `refType='DungeonRun'` + `refId=runId`. Idempotency lấy từ
  // `DungeonRun.claimedAt` CAS guard (race-safe winner duy nhất ghi 1 ledger
  // row / runId). Khác `COMBAT_LOOT` (per-encounter random drop loot table).
  | 'DUNGEON_RUN_REWARD'
  // Phase 13.1.A — Sect War weekly reward claim. Wire
  // `SectWarService.claimWeeklyReward` qua `applyTx` cho linhThach/tienNgoc
  // với `refType='SectWarWeeklyRewardClaim'` + `refId=weekKey`. Idempotency
  // lấy từ `SectWarWeeklyRewardClaim` UNIQUE `(weekKey, characterId)` CAS
  // guard — race-safe 2 concurrent claim chỉ 1 ledger row.
  | 'SECT_WAR_REWARD'
  // Phase 12 Story Dialogue Foundation — small reward grant từ choice effect
  // `give_reward`. Wire `StoryDialogueService.applyChoice` qua `applyTx` cho
  // linhThach/tienNgoc với `refType='StoryDialogueNode'` + `refId=nodeId`.
  // Idempotency lấy từ `Character.storyDialogueSeen` (mark_seen + grant ALWAYS
  // đi đôi → choice grant chỉ chạy 1 lần / node). Reward cap STORY_DIALOGUE_REWARD_CAP.
  | 'STORY_DIALOGUE_REWARD'
  // Phase 12.8.B — Story Dungeon claim reward bonus. Wire
  // `StoryDungeonService.claim` qua `applyTx` cho linhThach/tienNgoc với
  // `refType='StoryDungeonRun'` + `refId=runId`. Idempotency lấy từ
  // `StoryDungeonRun.claimedAt` CAS guard (race-safe winner duy nhất ghi 1
  // ledger row / runId). Khác `DUNGEON_RUN_REWARD` (farm dungeon catalog
  // `DUNGEONS`) ở catalog source + refType.
  | 'STORY_DUNGEON_REWARD'
  // Phase 13.2.B — Sect Season milestone claim reward. Wire
  // `SectSeasonService.claimMilestone` qua `applyTx` cho linhThach/tienNgoc
  // với `refType='SectSeasonClaim'` + `refId={seasonKey}:{milestoneKey}`.
  // Idempotency lấy từ `SectSeasonClaim` UNIQUE `(characterId, seasonKey,
  // milestoneKey)` CAS guard — race-safe 2 concurrent claim chỉ 1 ledger row.
  // Khác `SECT_WAR_REWARD` (weekly tier) ở scope: season aggregate 4-week
  // window personal points → 5 milestone tier monotonic increasing.
  | 'SECT_SEASON_REWARD';

export interface CurrencyApplyInput {
  characterId: string;
  currency: CurrencyKind;
  /** Có dấu: dương = cộng, âm = trừ. Phải khác 0. */
  delta: bigint;
  reason: LedgerReason;
  /**
   * WHERE phụ cho atomic guard (vd `{ sectId }` để chống race với rời tông
   * khi đóng góp). Sẽ được merge cùng id + balance >= |delta| guard.
   */
  extraWhere?: Prisma.CharacterWhereInput;
  refType?: string;
  refId?: string;
  meta?: Record<string, unknown>;
  actorUserId?: string;
}

@Injectable()
export class CurrencyService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Áp dụng thay đổi tiền + ghi 1 dòng `CurrencyLedger`.
   * Gọi từ INSIDE 1 `$transaction` đã có sẵn (Prisma.TransactionClient).
   * Atomic: dùng `updateMany` với guard `gte |delta|` khi trừ, kèm `extraWhere`.
   */
  async applyTx(
    tx: Prisma.TransactionClient,
    input: CurrencyApplyInput,
  ): Promise<void> {
    if (input.delta === 0n) throw new CurrencyError('INVALID_INPUT');

    const baseWhere: Prisma.CharacterWhereInput = {
      id: input.characterId,
      ...(input.extraWhere ?? {}),
    };

    if (input.currency === CurrencyKind.LINH_THACH) {
      const where: Prisma.CharacterWhereInput =
        input.delta < 0n
          ? { ...baseWhere, linhThach: { gte: -input.delta } }
          : baseWhere;
      const upd = await tx.character.updateMany({
        where,
        data: { linhThach: { increment: input.delta } },
      });
      if (upd.count === 0) {
        await this.throwBecauseNoUpdate(tx, input.characterId);
      }
    } else {
      const deltaNum = Number(input.delta);
      if (!Number.isSafeInteger(deltaNum)) {
        throw new CurrencyError('INVALID_INPUT');
      }
      const where: Prisma.CharacterWhereInput =
        deltaNum < 0
          ? { ...baseWhere, tienNgoc: { gte: -deltaNum } }
          : baseWhere;
      const upd = await tx.character.updateMany({
        where,
        data: { tienNgoc: { increment: deltaNum } },
      });
      if (upd.count === 0) {
        await this.throwBecauseNoUpdate(tx, input.characterId);
      }
    }

    await tx.currencyLedger.create({
      data: {
        characterId: input.characterId,
        currency: input.currency,
        delta: input.delta,
        reason: input.reason,
        refType: input.refType ?? null,
        refId: input.refId ?? null,
        meta: (input.meta ?? {}) as Prisma.InputJsonValue,
        actorUserId: input.actorUserId ?? null,
      },
    });
  }

  /** Bao 1 transaction quanh `applyTx`. Dùng khi caller không có sẵn tx. */
  async apply(input: CurrencyApplyInput): Promise<void> {
    await this.prisma.$transaction((tx) => this.applyTx(tx, input));
  }

  private async throwBecauseNoUpdate(
    tx: Prisma.TransactionClient,
    characterId: string,
  ): Promise<never> {
    const exists = await tx.character.findUnique({
      where: { id: characterId },
      select: { id: true },
    });
    throw new CurrencyError(exists ? 'INSUFFICIENT_FUNDS' : 'NOT_FOUND');
  }
}
