import { Injectable } from '@nestjs/common';
import { CurrencyKind, Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma.service';

/**
 * Phase 27.0 — Mapping từ `CurrencyKind` (Int variants) → tên cột
 * `Character`. `LINH_THACH` (BigInt) xử lý riêng. Spread thêm currency
 * mới ở đây nếu thêm field.
 */
const INT_CURRENCY_FIELD: Partial<Record<CurrencyKind, keyof Prisma.CharacterUncheckedUpdateInput>> = {
  [CurrencyKind.TIEN_NGOC]: 'tienNgoc',
  [CurrencyKind.TIEN_NGOC_KHOA]: 'tienNgocKhoa',
  [CurrencyKind.CONG_HIEN_TONG_MON]: 'sectContribBalance',
  [CurrencyKind.TRIAL_POINT]: 'trialPoint',
  [CurrencyKind.EVENT_TOKEN]: 'eventToken',
};

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
  | 'HOMESTEAD_UPGRADE'
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
  | 'COOP_WEEKLY_REWARD'
  // Phase 23.4 — Equipment Upgrade Economy / Resource Sink. linhThach
  // sink khi merge / dismantle / khảm / tháo gem. refType='InventoryItem'
  // + refId của target equipment id.
  | 'EQUIPMENT_MERGE'
  | 'EQUIPMENT_DISMANTLE'
  | 'GEM_SOCKET_COST'
  | 'GEM_UNSOCKET_COST'
  | 'PHAP_BAO_STAR_UP'
  | 'PHAP_BAO_AWAKEN'
  | 'PHAP_BAO_REFINE'
  | 'BATTLE_PASS_REWARD'
  | 'MONTHLY_CARD_REWARD'
  | 'SHOP_PACK_PURCHASE'
  | 'SHOP_PACK_REWARD'
  // Phase 26.3 — Cultivation Method V2 unlock/upgrade/star-up consume
  // linhThach (chỉ với method có `unlockLinhThachCost` hoặc upgrade cost
  // tier-scaling theo `methodUpgradeLinhThachCost()`). refType='CharacterCultivationMethod'
  // + refId=methodKey. Pure sink — không grant lại tiền cho fragment.
  | 'METHOD_UNLOCK'
  | 'METHOD_UPGRADE'
  | 'METHOD_STAR_UP'
  // Phase 26.4 — Artifact / Pháp Bảo V2 currency sinks. Wire qua
  // `ArtifactV2Service.craft / upgradeLevel / starUp / refine / awaken`.
  // refType='ArtifactCraftAttemptLog' (craft) hoặc 'ArtifactUpgradeLogV2'
  // (upgrade/star/refine/awaken). Pure sink (delta < 0); KHÔNG có grant.
  | 'ARTIFACT_V2_CRAFT'
  | 'ARTIFACT_V2_UPGRADE'
  | 'ARTIFACT_V2_STAR_UP'
  | 'ARTIFACT_V2_REFINE'
  | 'ARTIFACT_V2_AWAKEN'
  // Phase 26.5 — World Content V2 reward sources. Server-authoritative
  // grant linhThach qua `applyTx`. refType='FarmSession' / 'TrialTowerAttempt'
  // tương ứng farm session claim / tower floor first-clear. Anti-P2W enforce
  // qua `WorldCapService.consumeDailyTx`/`consumeWeeklyTx` (premium KHÔNG
  // bypass).
  | 'FARM_SESSION_REWARD'
  | 'TRIAL_TOWER_REWARD'
  // Phase 27.0 — Monetization Foundation. Shop purchase (debit), reward
  // grant (credit), entitlement purchase, paid extra attempt, sweep ticket
  // consume, growth fund purchase / claim, monthly card upfront / daily.
  // refType ∈ { 'MonetizationShopPurchase' | 'PremiumEntitlement' |
  // 'MonthlyCardSubscription' | 'PaidLimitPurchase' | 'SweepTicketLog' |
  // 'GrowthFundState' }. Idempotency lấy từ UNIQUE constraint của bảng
  // tương ứng + CAS guard trong service.
  | 'MONETIZATION_SHOP_BUY'
  | 'MONETIZATION_SHOP_REFUND'
  | 'MONETIZATION_ENTITLEMENT_GRANT'
  | 'MONETIZATION_EXTRA_ATTEMPT_BUY'
  | 'MONETIZATION_SWEEP_TICKET_USE'
  | 'MONETIZATION_GROWTH_FUND_BUY'
  | 'MONETIZATION_GROWTH_FUND_CLAIM'
  | 'MONETIZATION_MONTHLY_CARD_BUY'
  | 'MONETIZATION_LIMITED_SHOP_BUY'
  // Phase 30.0 — Market V2 / Auction / Sect Treasury claim flow.
  | 'MARKET_AUCTION_BID_ESCROW'
  | 'MARKET_AUCTION_BID_REFUND'
  | 'MARKET_AUCTION_SELLER_PAYOUT'
  | 'MARKET_AUCTION_WIN_PAY'
  | 'MARKET_LISTING_FEE'
  | 'MARKET_TRANSACTION_TAX'
  | 'MARKET_REFUND'
  | 'CLAIM_BOX_LISTING_SOLD'
  | 'CLAIM_BOX_LISTING_EXPIRED'
  | 'CLAIM_BOX_AUCTION_WON'
  | 'CLAIM_BOX_AUCTION_REFUND'
  | 'CLAIM_BOX_AUCTION_SELLER_PAYOUT'
  | 'CLAIM_BOX_ADMIN_REFUND'
  | 'CLAIM_BOX_ADMIN_GRANT'
  | 'CLAIM_BOX_SECT_AUCTION_WON'
  | 'CLAIM_BOX_SECT_AUCTION_REFUND'
  | 'SECT_AUCTION_BID_ESCROW'
  | 'SECT_AUCTION_BID_REFUND'
  | 'SECT_TREASURY_WITHDRAW'
  // Phase 33.1 — Story V2 (Phase 33 catalog) quest claim. Wire qua
  // `Phase33StoryService.claimReward` → `applyTx` cho linhThach/tienNgoc
  // với `refType='Phase33Quest'` + `refId=questKey`. Idempotency lấy từ
  // `CharacterStoryV2QuestProgress.claimedAt` CAS guard + `CharacterStory
  // V2RewardClaim` UNIQUE `(characterId, questKey)` — race-safe winner duy
  // nhất ghi 1 ledger row / questKey. Reward bound bởi
  // `phase33RewardCap(rewardPolicyKey)` snapshot vào quest catalog.
  | 'STORY_V2_QUEST_CLAIM'
  // Phase 34.0 — 7-Day Onboarding task claim. Wire qua
  // `OnboardingQuestService.claimTask` → `applyTx` cho linhThach với
  // `refType='OnboardingTask'` + `refId=taskKey`. Idempotency lấy từ
  // `CharacterOnboardingTaskProgress.status='CLAIMED'` CAS guard — race-safe
  // winner duy nhất ghi 1 ledger row / taskKey. Reward bound bởi catalog
  // `OnboardingTaskRewardDef.linhThach` snapshot — KHÔNG mint Tien Ngoc.
  | 'ONBOARDING_TASK_CLAIM'
  // Phase 34.1 — Daily Random Encounter claim. Wire qua
  // `DailyEncounterService.claim` → `applyTx` cho linhThach với
  // `refType='DailyEncounter'` + `refId=<characterId>:<dateKey>`.
  // Idempotency lấy từ `CharacterDailyEncounter.status='CLAIMED'` CAS guard.
  // Reward bound bởi catalog `DailyEncounterRewardDef` snapshot — KHÔNG mint
  // Tien Ngoc.
  | 'ENCOUNTER_CLAIM'
  // Phase 34.2 — Secret Realm clear claim. Wire qua
  // `SecretRealmService.claimRun` → `applyTx` cho linhThach với
  // `refType='SecretRealmRun'` + `refId=runId`. Idempotency lấy từ
  // `CharacterSecretRealmRun.status='CLAIMED'` CAS guard. Reward bound bởi
  // catalog `SecretRealmRewardDef` snapshot — KHÔNG mint Tien Ngoc.
  | 'SECRET_REALM_CLAIM'
  // Phase 35.0 — Pet / Linh Thú. Wire qua PetBoxService.open (cost) /
  // PetUpgradeService (star/break/evolve/skill cost) / PetAdminService.
  // refType thường `'PetBox'` (cost mở hộp) / `'CharacterPet'` (upgrade
  // sink) / `'PetAdmin'` (admin grant currency reverse).
  | 'PET_BOX_OPEN_COST'
  | 'PET_UPGRADE_COST'
  | 'PET_EVOLUTION_COST'
  | 'PET_BREAKTHROUGH_COST'
  | 'PET_SKILL_UPGRADE_COST'
  | 'PET_ADMIN_GRANT';

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
      // Int currency: TIEN_NGOC | TIEN_NGOC_KHOA | CONG_HIEN_TONG_MON |
      // TRIAL_POINT | EVENT_TOKEN.
      const deltaNum = Number(input.delta);
      if (!Number.isSafeInteger(deltaNum)) {
        throw new CurrencyError('INVALID_INPUT');
      }
      const fieldName = INT_CURRENCY_FIELD[input.currency];
      if (!fieldName) {
        throw new CurrencyError('INVALID_INPUT');
      }
      const where: Prisma.CharacterWhereInput =
        deltaNum < 0
          ? { ...baseWhere, [fieldName]: { gte: -deltaNum } }
          : baseWhere;
      const upd = await tx.character.updateMany({
        where,
        data: { [fieldName]: { increment: deltaNum } },
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
