import { CurrencyKind } from '@prisma/client';
import { PrismaService } from './common/prisma.service';
import { RealtimeService } from './modules/realtime/realtime.service';
import { CharacterService } from './modules/character/character.service';
import { CurrencyService } from './modules/character/currency.service';
import { InventoryService } from './modules/inventory/inventory.service';
import { MissionService } from './modules/mission/mission.service';
import { MissionWsEmitter } from './modules/mission/mission-ws.emitter';
import { NpcAffinityService } from './modules/npc-affinity/npc-affinity.service';
import { NpcRelationshipChainService } from './modules/npc-affinity/npc-relationship-chain.service';
import { QuestService } from './modules/quest/quest.service';
import { DungeonRunService } from './modules/dungeon-run/dungeon-run.service';
import { RewardCapService } from './modules/economy/reward-cap.service';
import { StoryDungeonService } from './modules/story-dungeon/story-dungeon.service';
import { Phase33StoryService } from './modules/story-v2/story-v2.service';
import { OnboardingQuestService } from './modules/onboarding-quest/onboarding-quest.service';
import { TitleService } from './modules/character/title.service';
import { DailyEncounterService } from './modules/daily-encounter/daily-encounter.service';
import { SecretRealmRuntimeService } from './modules/secret-realm-runtime/secret-realm-runtime.service';

/**
 * Helpers cho integration test — tạo fixture user/character nhanh, không
 * đụng tới các module phía trên (Auth/JWT/realtime). Mỗi test file dùng
 * `beforeEach(wipeAll(prisma))` để bắt đầu sạch.
 */

let counter = 0;

export function nextSuffix(): string {
  counter += 1;
  return `${Date.now().toString(36)}${counter.toString(36)}`;
}

export interface TestCharacterFixture {
  userId: string;
  characterId: string;
  email: string;
  name: string;
}

export async function makeUserChar(
  prisma: PrismaService,
  opts?: {
    linhThach?: bigint;
    tienNgoc?: number;
    sectId?: string | null;
    realmKey?: string;
    realmStage?: number;
    exp?: bigint;
    spirit?: number;
    stamina?: number;
    staminaMax?: number;
    hp?: number;
    hpMax?: number;
    mp?: number;
    mpMax?: number;
    cultivating?: boolean;
    role?: 'PLAYER' | 'MOD' | 'ADMIN';
    power?: number;
    speed?: number;
    luck?: number;
    spiritualRootGrade?: string | null;
    primaryElement?: string | null;
    secondaryElements?: string[];
    rootPurity?: number;
    equippedCultivationMethodKey?: string | null;
    bodyRealmKey?: string;
    bodyStage?: number;
    bodyExp?: bigint;
    bodyCultivating?: boolean;
    bodyInjuryUntil?: Date | null;
    alchemyLevel?: number;
    alchemyExp?: bigint;
    alchemyMastery?: number;
    alchemyFurnaceLevel?: number;
  },
): Promise<TestCharacterFixture> {
  const suffix = nextSuffix();
  const email = `it-${suffix}@xt.local`;
  const name = `IT_${suffix}`;
  const user = await prisma.user.create({
    data: {
      email,
      passwordHash: 'x',
      role: opts?.role ?? 'PLAYER',
    },
  });
  const char = await prisma.character.create({
    data: {
      userId: user.id,
      name,
      realmKey: opts?.realmKey ?? 'luyenkhi',
      realmStage: opts?.realmStage ?? 1,
      exp: opts?.exp ?? 0n,
      spirit: opts?.spirit ?? 8,
      linhThach: opts?.linhThach ?? 1000n,
      tienNgoc: opts?.tienNgoc ?? 0,
      sectId: opts?.sectId ?? null,
      cultivating: opts?.cultivating ?? false,
      stamina: opts?.stamina ?? 100,
      staminaMax: opts?.staminaMax ?? 100,
      hp: opts?.hp ?? 100,
      hpMax: opts?.hpMax ?? 100,
      mp: opts?.mp ?? 50,
      mpMax: opts?.mpMax ?? 50,
      power: opts?.power ?? 10,
      speed: opts?.speed ?? 10,
      luck: opts?.luck ?? 5,
      spiritualRootGrade: opts?.spiritualRootGrade ?? null,
      primaryElement: opts?.primaryElement ?? null,
      secondaryElements: opts?.secondaryElements ?? [],
      rootPurity: opts?.rootPurity ?? 100,
      equippedCultivationMethodKey: opts?.equippedCultivationMethodKey ?? null,
      bodyRealmKey: opts?.bodyRealmKey ?? 'pham_than',
      bodyStage: opts?.bodyStage ?? 1,
      bodyExp: opts?.bodyExp ?? 0n,
      bodyCultivating: opts?.bodyCultivating ?? false,
      bodyInjuryUntil: opts?.bodyInjuryUntil ?? null,
      alchemyLevel: opts?.alchemyLevel ?? 1,
      alchemyExp: opts?.alchemyExp ?? 0n,
      alchemyMastery: opts?.alchemyMastery ?? 0,
      alchemyFurnaceLevel: opts?.alchemyFurnaceLevel ?? 1,
    },
  });
  return { userId: user.id, characterId: char.id, email, name };
}

/** Xoá hết các bảng phụ thuộc Character/User để test bắt đầu sạch. */
export async function wipeAll(prisma: PrismaService): Promise<void> {
  // Thứ tự: con trước cha (FK cascade phần lớn rồi nhưng explicit cho rõ).
  // Phase 13.2.B — Sect Season claim phải xoá trước Character/Sect (FK cascade
  // CHARACTER_ID; xoá explicit để rõ thứ tự + tránh edge case nếu future
  // migration đổi cascade).
  await prisma.sectSeasonClaim.deleteMany({});
  // Phase 13.1.B — Sect mission claims, shop purchases, contribution ledger,
  // liveops overrides phải xoá trước Character/Sect.
  await prisma.sectMissionClaim.deleteMany({});
  await prisma.sectShopPurchase.deleteMany({});
  await prisma.sectContributionLedger.deleteMany({});
  await prisma.liveOpsEventOverride.deleteMany({});
  // Phase 13.1.A — Sect War tables phải xoá trước Character/Sect.
  await prisma.sectWarWeeklyRewardClaim.deleteMany({});
  await prisma.sectWarContribution.deleteMany({});
  // Phase 14.0.A — Sect Territory Influence (xoá trước Character/Sect).
  await prisma.sectTerritoryInfluence.deleteMany({});
  // Phase 14.0.B — Sect Territory Settlement snapshots + region state
  // (xoá trước Sect; tự FK tới Sect SET NULL nhưng explicit cho rõ).
  await prisma.sectTerritorySettlementSnapshot.deleteMany({});
  await prisma.sectTerritoryRegionState.deleteMany({});
  // Phase 14.0.C — Sect Territory Decay log (UNIQUE periodKey). Phase
  // Audit-1 fix: thiếu wipe gây pollution giữa file test (vd.
  // `liveops-cron.service.test.ts` thấy `decaySkipped=true` từ run cũ).
  await prisma.sectTerritoryDecayLog.deleteMany({});
  // Phase 14.0.E — Territory Owner Reward grant audit (xoá trước Mail/
  // Character — `mailId` nullable không có FK, nhưng explicit cho rõ).
  await prisma.territoryOwnerRewardGrant.deleteMany({});
  // Phase 16.5 — Daily Reward Cap (xoá trước Character — FK cascade
  // nhưng explicit cho rõ thứ tự reset state giữa test runs).
  await prisma.rewardCapEvent.deleteMany({});
  // Phase 26.2 — Drop Economy material caps (xoá trước Character — FK
  // cascade nhưng explicit cho rõ thứ tự reset state giữa test runs).
  await prisma.dailyMaterialCap.deleteMany({});
  await prisma.weeklyMaterialCap.deleteMany({});
  // Phase 26.5 — World Content V2 (FarmSession + TrialTower + caps + sect
  // boss log). Wipe trước Character — FK Cascade nhưng explicit cho rõ thứ
  // tự reset state giữa test runs (cap unique key bị stale → trùng key).
  await prisma.farmEncounter.deleteMany({});
  await prisma.farmSession.deleteMany({});
  await prisma.dailyContentCap.deleteMany({});
  await prisma.weeklyContentCap.deleteMany({});
  await prisma.trialTowerAttemptLog.deleteMany({});
  await prisma.trialTowerProgress.deleteMany({});
  await prisma.sectBossAttemptLog.deleteMany({});
  await prisma.characterDailyRewardBucket.deleteMany({});
  await prisma.alchemyAttemptLog.deleteMany({});
  await prisma.bodyBreakthroughAttemptLog.deleteMany({});
  // Phase 16.6 — Economy Anti-cheat tables. Xoá `Issue` trước `Run` (FK
  // cascade rồi nhưng explicit cho rõ). `EconomyAnomaly` không có FK
  // tới Character (`characterId String?`) nên xoá đầu cũng OK.
  await prisma.economyLedgerCheckIssue.deleteMany({});
  await prisma.economyLedgerCheckRun.deleteMany({});
  await prisma.economyAnomaly.deleteMany({});
  // Phase 16.3 — Gameplay anomaly tracking (no FK to Character; wipe
  // explicit để reset state giữa test runs).
  await prisma.gameplayAnomaly.deleteMany({});
  // Phase 16.4 — Market trade anomaly tracking (no FK to Character /
  // Listing; wipe explicit để reset state giữa test runs).
  await prisma.marketTradeAnomaly.deleteMany({});
  // Phase 19.3 — Notification + Presence (Notification FK Cascade tới User;
  // UserPresence FK Cascade tới User. Xoá trước User để rõ order, mirror
  // các bảng audit khác).
  await prisma.notification.deleteMany({});
  await prisma.userPresence.deleteMany({});
  // Phase 19.2 — Chat moderation tables (no FK; wipe trước message
  // tables để tránh stale pointer khi message bị xoá tiếp theo).
  await prisma.chatMessageReport.deleteMany({});
  await prisma.chatMute.deleteMany({});
  // Phase 20.1 — Party Dungeon Co-op (no FK; wipe explicit). Thứ tự:
  // reward claim → run → participant → room. Soft-ref ⇒ delete an
  // toàn. Wipe trước Party để giảm dangling pointer noise.
  await prisma.partyDungeonRewardClaim.deleteMany({});
  await prisma.partyDungeonRun.deleteMany({});
  await prisma.partyDungeonParticipant.deleteMany({});
  await prisma.partyDungeonRoom.deleteMany({});
  // Phase 19.4 — Party system (no FK to User; wipe explicit). Thứ tự:
  // invite/member trước party. Soft-ref ⇒ delete an toàn.
  await prisma.partyInvite.deleteMany({});
  await prisma.partyMember.deleteMany({});
  await prisma.party.deleteMany({});
  // Phase 19.1 — Social system foundation (no FK to User; wipe explicit
  // để reset state giữa test runs). Thứ tự: message trước thread/group,
  // member trước group, request/friendship/block trước User.
  await prisma.privateChatMessage.deleteMany({});
  await prisma.privateChatThread.deleteMany({});
  await prisma.groupChatMessage.deleteMany({});
  await prisma.groupChatMember.deleteMany({});
  await prisma.groupChat.deleteMany({});
  await prisma.friendRequest.deleteMany({});
  await prisma.friendship.deleteMany({});
  await prisma.playerBlock.deleteMany({});
  // Phase 35.1 — Co-Cultivation session + daily usage (soft-ref user/character,
  // wipe trước User/Character để tránh stale state giữa test runs).
  await prisma.coCultivationSession.deleteMany({});
  await prisma.coCultivationDailyUsage.deleteMany({});
  // Phase 15.0.A — Equipment Reforge / Enchant audit history (xoá trước
  // ItemLedger/Character — FK cascade tới Character nhưng explicit cho rõ).
  await prisma.equipmentReforgeHistory.deleteMany({});
  await prisma.equipmentEnchantHistory.deleteMany({});
  // Phase 15.1–15.2 — LiveOps Event Scheduler reward claim + scheduled event
  // (xoá claim trước event vì FK cascade; xoá event trước User để
  // `createdByAdmin` SET NULL không cần wait FK cleanup).
  await prisma.liveOpsEventRewardClaim.deleteMany({});
  await prisma.liveOpsScheduledEvent.deleteMany({});
  // Phase 15.3.B — LiveOps Announcement (FK SET NULL → User; xoá trước User
  // để FK cleanup đơn giản, mirror order liveOpsScheduledEvent).
  await prisma.liveOpsAnnouncement.deleteMany({});
  await prisma.vipProfile.deleteMany({});
  // Phase 27.0 — Monetization Foundation. Xoá trước MonthlyCardSubscription
  // và CurrencyLedger để FK + cap state reset đầy đủ giữa các test.
  await prisma.growthFundState.deleteMany({});
  await prisma.sweepTicketLog.deleteMany({});
  await prisma.paidLimitPurchase.deleteMany({});
  await prisma.monetizationShopPurchase.deleteMany({});
  await prisma.premiumEntitlement.deleteMany({});
  await prisma.monthlyCardSubscription.deleteMany({});
  await prisma.battlePassProgress.deleteMany({});
  await prisma.battlePassSeason.deleteMany({});
  // Phase 25.2 — Shop Pack purchase history (FK Cascade → Character).
  await prisma.shopPackPurchase.deleteMany({});
  // Phase 25.3 — Cosmetic ownership + loadout (FK Cascade → Character).
  await prisma.cosmeticOwnership.deleteMany({});
  await prisma.cosmeticLoadout.deleteMany({});
  await prisma.itemLedger.deleteMany({});
  await prisma.currencyLedger.deleteMany({});
  // Phase 14.1.B — Async Arena foundation (matches reference Character qua
  // FK Cascade). Xoá ArenaMatch trước ArenaProfile để rõ order — cả 2 đều
  // FK → Character.
  await prisma.arenaMatch.deleteMany({});
  await prisma.arenaProfile.deleteMany({});
  // Phase 14.1.C — Arena Season + ELO + Reward (xoá grant + standing trước
  // season; cả 3 cascade tới Character/Season qua FK).
  await prisma.arenaSeasonRewardGrant.deleteMany({});
  await prisma.arenaStanding.deleteMany({});
  // Phase 14.1.D — Arena Wintrade Alert (no FK to character/season —
  // wipe explicitly để reset state giữa test runs).
  await prisma.arenaWintradeAlert.deleteMany({});
  await prisma.arenaSeason.deleteMany({});
  // Phase 29.0 — PvP Foundation V1 (battle log + defense profile + anomaly).
  // Wipe trước Character — FK Cascade nhưng explicit cho rõ thứ tự.
  await prisma.pvpBattle.deleteMany({});
  await prisma.pvpDefenseProfile.deleteMany({});
  await prisma.pvpAnomalyLog.deleteMany({});
  // Phase 30.0 — Market V2 + Codex (14 model). Wipe trước Character/Sect.
  // FK Cascade nhưng explicit để giữ deterministic test order.
  await prisma.marketBid.deleteMany({});
  await prisma.marketAuction.deleteMany({});
  await prisma.marketClaimBoxEntry.deleteMany({});
  await prisma.marketPriceSnapshot.deleteMany({});
  await prisma.marketItemPolicy.deleteMany({});
  await prisma.marketAnomaly.deleteMany({});
  await prisma.personalStall.deleteMany({});
  await prisma.sectInternalAuctionBid.deleteMany({});
  await prisma.sectInternalAuction.deleteMany({});
  await prisma.sectTreasuryItem.deleteMany({});
  await prisma.sectTreasuryLog.deleteMany({});
  // Phase 32.0 — Codex tables.
  await prisma.characterCodexProgress.deleteMany({});
  await prisma.codexAuditIssue.deleteMany({});
  await prisma.codexReindexLog.deleteMany({});
  await prisma.codexEntry.deleteMany({});
  // Phase 35.0 — Pet / Linh Thú tables (FK cascade → Character).
  await prisma.petBoxOpenLog.deleteMany({});
  await prisma.characterPetBoxPityCounter.deleteMany({});
  await prisma.characterPetShard.deleteMany({});
  await prisma.characterPet.deleteMany({});
  // Phase 14.3.E.1 — mini-battle session rows (encounterId pointer chỉ là
  // string, không FK; xoá trước encounter để giữ deterministic order).
  await prisma.tribulationMiniBattle.deleteMany({});
  // Phase 14.3.D — encounter session rows (nullable resolvedAttemptLogId
  // pointer; xoá trước attempt log vì pointer không có FK constraint).
  await prisma.tribulationEncounter.deleteMany({});
  await prisma.tribulationAttemptLog.deleteMany({});
  await prisma.characterBuff.deleteMany({});
  await prisma.characterTalent.deleteMany({});
  await prisma.characterTitleUnlock.deleteMany({});
  await prisma.characterAchievement.deleteMany({});
  await prisma.characterCultivationMethod.deleteMany({});
  // Phase 26.4 — Artifact V2 tables (FK cascade → Character; explicit wipe
  // để reset state giữa file test, mirror các bảng phase 26.x khác).
  await prisma.artifactUpgradeLogV2.deleteMany({});
  await prisma.artifactCraftAttemptLog.deleteMany({});
  await prisma.characterArtifactV2.deleteMany({});
  await prisma.characterSkill.deleteMany({});
  await prisma.spiritualRootRollLog.deleteMany({});
  await prisma.dailyLoginClaim.deleteMany({});
  await prisma.bossDamage.deleteMany({});
  await prisma.worldBoss.deleteMany({});
  await prisma.encounter.deleteMany({});
  await prisma.dungeonRun.deleteMany({});
  await prisma.storyDungeonRun.deleteMany({});
  await prisma.chatMessage.deleteMany({});
  await prisma.listing.deleteMany({});
  await prisma.inventoryItem.deleteMany({});
  await prisma.missionProgress.deleteMany({});
  await prisma.questProgress.deleteMany({});
  // Phase 33.1 — Story V2 (Phase 33 catalog) runtime. FK Cascade Character —
  // wipe explicit để integration test khởi đầu sạch.
  await prisma.characterStoryV2RewardClaim.deleteMany({});
  await prisma.characterStoryV2QuestProgress.deleteMany({});
  await prisma.characterStoryV2ChapterProgress.deleteMany({});
  await prisma.giftCodeRedemption.deleteMany({});
  await prisma.giftCode.deleteMany({});
  // Phase 31.0 — Social & Retention Foundation V1. Mail attachment
  // claim (FK soft-ref mailId — wipe trước Mail). AdminMailLog /
  // SystemGift / SystemGiftClaim / MentorProfile / MentorRelation /
  // CharacterReturnerState đều standalone tables (không FK Character)
  // — wipe explicit để reset state giữa test runs.
  await prisma.mailAttachmentClaim.deleteMany({});
  await prisma.mail.deleteMany({});
  await prisma.adminMailLog.deleteMany({});
  await prisma.systemGiftClaim.deleteMany({});
  await prisma.systemGift.deleteMany({});
  await prisma.mentorRelation.deleteMany({});
  await prisma.mentorProfile.deleteMany({});
  await prisma.characterReturnerState.deleteMany({});
  // Phase 41.0 — Player Experience QoL (FK Cascade Character; explicit wipe).
  await prisma.playerReport.deleteMany({});
  await prisma.playerFeedback.deleteMany({});
  await prisma.playerSettings.deleteMany({});
  // Phase QOL-2 — Loadout Preset PvE/PvP/Boss (FK Cascade Character; explicit wipe).
  await prisma.characterLoadoutPreset.deleteMany({});
  // Phase PWA-1 — Web Push (FK Cascade User; explicit wipe trước User).
  await prisma.webPushSendLog.deleteMany({});
  await prisma.webPushSubscription.deleteMany({});
  await prisma.userPushPreferences.deleteMany({});
  await prisma.topupOrder.deleteMany({});
  // Phase 15.6 — Config Version + Rollback Run (xoá trước User; cả 2
  // FK SET NULL khi User bị xoá, nhưng explicit cho rõ thứ tự).
  await prisma.configRollbackRun.deleteMany({});
  await prisma.configVersion.deleteMany({});
  // Phase 15.8 — LiveOps cron run audit log (no FK). Wipe để health
  // status không bị nhiễm dữ liệu giữa file test.
  await prisma.liveOpsCronRunLog.deleteMany({});
  // Phase 15.8 — Sect Season Champion membership snapshot (no FK).
  // Wipe trước Character/Sect để reward grant test khởi đầu sạch.
  await prisma.sectSeasonChampionSnapshot.deleteMany({});
  await prisma.adminAuditLog.deleteMany({});
  await prisma.refreshToken.deleteMany({});
  await prisma.loginAttempt.deleteMany({});
  await prisma.character.deleteMany({});
  await prisma.user.deleteMany({});
  await prisma.sect.deleteMany({});
}

/**
 * Dựng `MissionService` tối thiểu cho integration test (bypass DI container).
 * Dùng lại các service khác (thường test chỉ cần prisma).
 */
export function makeMissionService(
  prisma: PrismaService,
  emitter: MissionWsEmitter | null = null,
): MissionService {
  const realtime = new RealtimeService();
  const chars = new CharacterService(prisma, realtime);
  const currency = new CurrencyService(prisma);
  const inventory = new InventoryService(prisma, realtime, chars);
  const rewardCap = new RewardCapService(prisma);
  return new MissionService(prisma, currency, inventory, rewardCap, emitter);
}

/**
 * Phase 12 PR-3 — Dựng `QuestService` cho integration test (bypass DI container).
 * Wire `CurrencyService` + `InventoryService` qua cùng pattern với
 * `makeMissionService` để claim path đi qua ledger thật.
 */
export function makeQuestService(prisma: PrismaService): QuestService {
  const realtime = new RealtimeService();
  const chars = new CharacterService(prisma, realtime);
  const currency = new CurrencyService(prisma);
  const inventory = new InventoryService(prisma, realtime, chars);
  // Phase 12.10.B — quest claim grant `rewards.affinity` qua NpcAffinityService.
  // Wire ở đây để integration test claim path đi qua npcAffinity thật (không
  // mock) — match production wiring trong QuestModule.
  const npcAffinity = new NpcAffinityService(prisma, inventory);
  return new QuestService(prisma, currency, inventory, npcAffinity);
}

/**
 * Phase 33.1 — Dựng `Phase33StoryService` cho integration test (bypass DI
 * container). Wire `CurrencyService` + `InventoryService` + `NpcAffinityService`
 * cùng pattern với `makeQuestService` để claim path đi qua ledger thật + npc
 * affinity grant thật (match production wiring trong `Phase33StoryModule`).
 */
export function makePhase33StoryService(prisma: PrismaService): Phase33StoryService {
  const realtime = new RealtimeService();
  const chars = new CharacterService(prisma, realtime);
  const currency = new CurrencyService(prisma);
  const inventory = new InventoryService(prisma, realtime, chars);
  const npcAffinity = new NpcAffinityService(prisma, inventory);
  return new Phase33StoryService(prisma, currency, inventory, npcAffinity);
}

/**
 * Phase 12.2.B — Dựng `DungeonRunService` cho integration test (bypass DI
 * container). Wire `CurrencyService` + `InventoryService` + `QuestService`
 * qua cùng pattern với `makeQuestService` để claim path đi qua ledger thật
 * và quest-track auto-progress.
 */
export function makeDungeonRunService(prisma: PrismaService): {
  runs: DungeonRunService;
  quests: QuestService;
  inventory: InventoryService;
  currency: CurrencyService;
} {
  const realtime = new RealtimeService();
  const chars = new CharacterService(prisma, realtime);
  const currency = new CurrencyService(prisma);
  const inventory = new InventoryService(prisma, realtime, chars);
  // Phase 12.10.B — quest claim grant `rewards.affinity` qua NpcAffinityService.
  const npcAffinity = new NpcAffinityService(prisma, inventory);
  const quests = new QuestService(prisma, currency, inventory, npcAffinity);
  const rewardCap = new RewardCapService(prisma);
  const runs = new DungeonRunService(
    prisma,
    currency,
    inventory,
    rewardCap,
    quests,
  );
  return { runs, quests, inventory, currency };
}

/**
 * Phase 12.8.B — Dựng `StoryDungeonService` cho integration test (bypass DI
 * container). Wire `CurrencyService` + `InventoryService` + `QuestService`
 * qua cùng pattern với `makeDungeonRunService` để claim path đi qua ledger
 * thật và quest-track auto-progress qua advance/clear.
 */
export function makeStoryDungeonService(prisma: PrismaService): {
  story: StoryDungeonService;
  quests: QuestService;
  inventory: InventoryService;
  currency: CurrencyService;
} {
  const realtime = new RealtimeService();
  const chars = new CharacterService(prisma, realtime);
  const currency = new CurrencyService(prisma);
  const inventory = new InventoryService(prisma, realtime, chars);
  // Phase 12.10.B — quest claim grant `rewards.affinity` qua NpcAffinityService.
  const npcAffinity = new NpcAffinityService(prisma, inventory);
  const quests = new QuestService(prisma, currency, inventory, npcAffinity);
  const story = new StoryDungeonService(prisma, currency, inventory, quests);
  return { story, quests, inventory, currency };
}

/**
 * Phase 12.10.D — Dựng `NpcRelationshipChainService` cho integration test
 * (bypass DI). Wire `CurrencyService` + `InventoryService` + `NpcAffinityService`
 * giống production wiring để claim path đi qua ledger thật.
 */
export function makeNpcRelationshipChainService(prisma: PrismaService): {
  chains: NpcRelationshipChainService;
  quests: QuestService;
  affinity: NpcAffinityService;
  inventory: InventoryService;
  currency: CurrencyService;
} {
  const realtime = new RealtimeService();
  const chars = new CharacterService(prisma, realtime);
  const currency = new CurrencyService(prisma);
  const inventory = new InventoryService(prisma, realtime, chars);
  const affinity = new NpcAffinityService(prisma, inventory);
  const quests = new QuestService(prisma, currency, inventory, affinity);
  const chains = new NpcRelationshipChainService(prisma, currency, inventory, affinity);
  return { chains, quests, affinity, inventory, currency };
}

/**
 * Phase 34.0 — Dựng `OnboardingQuestService` cho integration test (bypass DI).
 * Wire `CurrencyService` cho `applyTx('ONBOARDING_TASK_CLAIM')`. KHÔNG cần
 * `InventoryService` / `NpcAffinityService` vì Phase 34.0 chỉ grant linh
 * thach + exp (cosmetic title không ghi inventory).
 */
export function makeOnboardingQuestService(prisma: PrismaService): {
  onboarding: OnboardingQuestService;
  currency: CurrencyService;
} {
  const currency = new CurrencyService(prisma);
  // Phase 44.1 — TitleService cần để Day 7 unlock title.
  const title = new TitleService(prisma);
  const onboarding = new OnboardingQuestService(prisma, currency, title);
  return { onboarding, currency };
}

/**
 * Phase 34.1 — Dựng `DailyEncounterService` cho integration test.
 */
export function makeDailyEncounterService(prisma: PrismaService): {
  daily: DailyEncounterService;
  currency: CurrencyService;
} {
  const currency = new CurrencyService(prisma);
  const daily = new DailyEncounterService(prisma, currency);
  return { daily, currency };
}

/**
 * Phase 34.2 — Dựng `SecretRealmRuntimeService` cho integration test.
 */
export function makeSecretRealmRuntimeService(prisma: PrismaService): {
  secretRealm: SecretRealmRuntimeService;
  currency: CurrencyService;
} {
  const currency = new CurrencyService(prisma);
  const secretRealm = new SecretRealmRuntimeService(prisma, currency);
  return { secretRealm, currency };
}

export const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ??
  process.env.DATABASE_URL ??
  'postgresql://mtt:mtt@localhost:5432/mtt?schema=public';

export { CurrencyKind };
