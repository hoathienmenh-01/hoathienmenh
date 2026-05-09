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
import { StoryDungeonService } from './modules/story-dungeon/story-dungeon.service';

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
  // Phase 14.0.E — Territory Owner Reward grant audit (xoá trước Mail/
  // Character — `mailId` nullable không có FK, nhưng explicit cho rõ).
  await prisma.territoryOwnerRewardGrant.deleteMany({});
  await prisma.itemLedger.deleteMany({});
  await prisma.currencyLedger.deleteMany({});
  // Phase 14.3.D — encounter session rows (nullable resolvedAttemptLogId
  // pointer; xoá trước attempt log vì pointer không có FK constraint).
  await prisma.tribulationEncounter.deleteMany({});
  await prisma.tribulationAttemptLog.deleteMany({});
  await prisma.characterBuff.deleteMany({});
  await prisma.characterTalent.deleteMany({});
  await prisma.characterTitleUnlock.deleteMany({});
  await prisma.characterAchievement.deleteMany({});
  await prisma.characterCultivationMethod.deleteMany({});
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
  await prisma.giftCodeRedemption.deleteMany({});
  await prisma.giftCode.deleteMany({});
  await prisma.mail.deleteMany({});
  await prisma.topupOrder.deleteMany({});
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
  return new MissionService(prisma, currency, inventory, emitter);
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
  const runs = new DungeonRunService(prisma, currency, inventory, quests);
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

export const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ??
  process.env.DATABASE_URL ??
  'postgresql://mtt:mtt@localhost:5432/mtt?schema=public';

export { CurrencyKind };
