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
  | 'SECT_SEASON_REWARD'
  // Phase 12.10.C — NPC Affinity Shop purchase. Wire
  // `NpcAffinityShopService.buyTx` qua `applyTx` cho linhThach/tienNgoc với
  // `refType='NpcAffinityShop'` + `refId='${npcKey}:${itemKey}'`. Daily/weekly
  // limit enforce qua `ItemLedger` aggregate (mirror reason). Atomic
  // transaction: spend currency + grant inventory + write ledger 1-shot.
  | 'NPC_SHOP_BUY'
  // Phase 12.10.D — NPC Relationship Quest Chain claim. Wire qua
  // `NpcRelationshipChainService.claimChain → applyTx` cho linhThach/tienNgoc
  // với `refType='NpcRelationshipChain'` + `refId=chainKey`. Idempotency lấy
  // từ `Character.storyFlags['relchain_<chainKey>_claimed']` JSON-path CAS
  // guard — race-safe: 2 concurrent claim cùng chainKey, đúng 1 winner ghi
  // ledger row. Reward cap thấp hơn quest (linhThach ≤ 500, tienNgoc ≤ 10)
  // theo `NPC_RELATIONSHIP_CHAIN_*_CAP` (shared catalog).
  | 'NPC_RELATIONSHIP_CHAIN_REWARD'
  // Phase 15.0.A — Equipment Reforge / Enchant Foundation. Wire qua
  // `EquipmentService.reforge` / `enchant` qua `applyTx` cho linhThach với
  // `refType='InventoryItem'` + `refId=inventoryItemId`. KHÔNG idempotent —
  // mỗi reroll/level-up = 1 ledger row. Pure sink (delta < 0). Mirror
  // `ItemLedger` reason `EQUIPMENT_REFORGE_COST` / `EQUIPMENT_ENCHANT_COST`
  // cho material consume cùng `refId`.
  | 'EQUIPMENT_REFORGE'
  | 'EQUIPMENT_ENCHANT'
  // Phase 15.3.A — LiveOps `FESTIVAL_GIFT` one-time claim reward grant.
  // Wire qua `LiveOpsEventSchedulerService.claimEventReward` → `applyTx`
  // cho linhThach/tienNgoc với `refType='LiveOpsScheduledEvent'` +
  // `refId=eventId`. Idempotency lấy từ `LiveOpsEventRewardClaim` UNIQUE
  // (eventId, characterId) — duplicate claim P2002 → throw
  // `EVENT_ALREADY_CLAIMED`, ledger row chỉ ghi đúng 1 lần / character /
  // event. Reward bound bởi shared cap `FESTIVAL_GIFT_*_CAP`.
  | 'LIVEOPS_FESTIVAL_GIFT_REWARD'
  // Phase 20.1 — Party Dungeon Co-op reward claim. Wire qua
  // `PartyDungeonService.claimReward` → `applyTx` cho linhThach/tienNgoc
  // với `refType='PartyDungeonRewardClaim'` + `refId=claimId`.
  // Idempotency lấy từ `PartyDungeonRewardClaim` UNIQUE
  // `(runId, characterId)` + CAS guard `status='PENDING'` → `'CLAIMED'`
  // — race-safe: 2 concurrent claim cùng row, đúng 1 winner ghi ledger.
  // Reward source = `DUNGEONS[].runReward` từ shared catalog (Phase
  // 20.1 foundation: mỗi participant nhận đủ runReward solo, KHÔNG
  // share pool — xem `computePartyDungeonRewardSplit`).
  | 'PARTY_DUNGEON_REWARD'
  // Phase 20.2 — Co-op Boss reward grant qua `CoopBossService.claimReward`.
  // Idempotent semantics: `CoopBossRewardClaim` UNIQUE `(runId, userId)` +
  // `(runId, characterId)` + CAS guard `status='PENDING' → 'CLAIMED'` —
  // 2 concurrent claim trên cùng row → đúng 1 winner ghi ledger.
  // Reward source = `computeCoopBossRewardTier(tier)` deterministic
  // theo tier (NONE/LOW/NORMAL/HIGH/MVP) snapshot tại `finishRun`.
  | 'COOP_BOSS_REWARD'
  // Phase 20.3 — Co-op Weekly Reward grant qua
  // `CoopRewardCapService.claimWeeklyReward`. Idempotent semantics:
  // `CoopWeeklyRewardClaim` UNIQUE `(seasonId, userId)` + CAS guard
  // `status='PENDING' → 'CLAIMED'` — 2 concurrent claim trên cùng
  // row → đúng 1 winner ghi ledger. Reward source =
  // `computeWeeklyReward(tier)` deterministic theo tier
  // (NONE/BRONZE/SILVER/GOLD/LEGEND) snapshot tại settle.
  | 'COOP_WEEKLY_REWARD';

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
