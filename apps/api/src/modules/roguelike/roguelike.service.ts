import { Injectable } from '@nestjs/common';
import {
  CurrencyKind,
  RoguelikeRunStatus,
  type Prisma,
  type RoguelikeRun,
} from '@prisma/client';
import {
  ROGUELIKE_LIMITS,
  ROGUELIKE_REALMS,
  computeRoguelikeRewardPreview,
  getRoguelikeChoicesForFloor,
  hashToUint32,
  isRoguelikeMilestoneFloor,
  realmByKey,
  roguelikeBuffByKey,
  roguelikeChoiceByKey,
  roguelikeFloorByNumber,
  roguelikeRealmByKey,
  roguelikeRealmUnlocked,
  type RoguelikeBuffDef,
  type RoguelikeChoiceDef,
  type RoguelikeFloorDef,
  type RoguelikeRealmDef,
  type RoguelikeRewardPreview,
} from '@xuantoi/shared';
import { PrismaService } from '../../common/prisma.service';
import { CurrencyService } from '../character/currency.service';
import { RewardCapService } from '../economy/reward-cap.service';
import { InventoryService } from '../inventory/inventory.service';
import { RemoteConfigService } from '../remote-config/remote-config.service';
import { WorldCapError, WorldCapService } from '../world-content/world-cap.service';

export interface RoguelikeRealmView {
  realm: RoguelikeRealmDef;
  unlocked: boolean;
  activeRunId: string | null;
  dailyUsed: number;
  dailyLimit: number;
  weeklyClaimsUsed: number;
  weeklyClaimLimit: number;
}

export interface RoguelikeActiveBuffView {
  key: string;
  nameVi: string;
  nameEn: string;
  stat: RoguelikeBuffDef['stat'];
  valuePct: number;
  remainingFloors: number;
}

export interface RoguelikeFloorLogEntry {
  floorNumber: number;
  floorType: RoguelikeFloorDef['floorType'];
  choiceKey: string;
  outcomeVi: string;
  outcomeEn: string;
  hpAfter: number;
  resourceAfter: number;
  scoreAfter: number;
  rewardMultiplierAfter: number;
}

export interface RoguelikeRunView {
  id: string;
  realmKey: string;
  status: keyof typeof RoguelikeRunStatus;
  seed: string;
  currentFloor: number;
  hp: number;
  hpMax: number;
  resource: number;
  score: number;
  rewardMultiplier: number;
  activeBuffs: RoguelikeActiveBuffView[];
  floorHistory: RoguelikeFloorLogEntry[];
  currentFloorDef: RoguelikeFloorDef | null;
  choices: readonly RoguelikeChoiceDef[];
  rewardPreview: RoguelikeRewardPreview;
  startedAt: string;
  completedAt: string | null;
  failedAt: string | null;
  abandonedAt: string | null;
  claimedAt: string | null;
  expiresAt: string | null;
}

export interface RoguelikeClaimResult {
  runId: string;
  claimedAt: string;
  granted: {
    linhThach: number;
    exp: number;
    items: { itemKey: string; qty: number }[];
  };
  run: RoguelikeRunView;
}

export interface RoguelikeLeaderboardEntry {
  characterId: string;
  characterName: string;
  bestFloor: number;
  bestScore: number;
  fastestClearMs: number | null;
  weekBucket: string;
  monthBucket: string;
  updatedAt: string;
}

type RoguelikeErrorCode =
  | 'NO_CHARACTER'
  | 'REALM_NOT_FOUND'
  | 'REALM_LOCKED'
  | 'ALREADY_IN_RUN'
  | 'RUN_NOT_FOUND'
  | 'RUN_NOT_OWNED'
  | 'RUN_NOT_ACTIVE'
  | 'RUN_NOT_COMPLETED'
  | 'RUN_ALREADY_CLAIMED'
  | 'CHOICE_NOT_FOUND'
  | 'DAILY_LIMIT_REACHED'
  | 'WEEKLY_CAP_REACHED'
  | 'FEATURE_DISABLED';

export class RoguelikeError extends Error {
  constructor(public readonly code: RoguelikeErrorCode) {
    super(code);
    this.name = 'RoguelikeError';
  }
}

interface BalanceConfig {
  enabled: boolean;
  dailyEntryLimit: number;
  weeklyRewardClaimLimit: number;
  rewardMultiplier: number;
  maxCompletionFloor: number;
}

interface StoredBuff {
  key: string;
  remainingFloors: number;
}

@Injectable()
export class RoguelikeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly currency: CurrencyService,
    private readonly inventory: InventoryService,
    private readonly rewardCap: RewardCapService,
    private readonly worldCap: WorldCapService,
    private readonly remoteConfig: RemoteConfigService,
  ) {}

  async listRealms(userId: string): Promise<{
    realms: RoguelikeRealmView[];
    activeRun: RoguelikeRunView | null;
  }> {
    const char = await this.getCharacter(userId);
    const activeRun = await this.prisma.roguelikeRun.findFirst({
      where: { characterId: char.id, status: RoguelikeRunStatus.ACTIVE },
      orderBy: { startedAt: 'desc' },
    });
    const balance = await this.getBalanceConfig();
    const realms = await Promise.all(
      ROGUELIKE_REALMS.map(async (realm) => {
        const dailyLimit = this.dailyLimitFor(realm, balance);
        const weeklyClaimLimit = this.weeklyLimitFor(realm, balance);
        const daily = await this.worldCap.getDailyUsage(
          char.id,
          this.dailyCapKey(realm.key),
        );
        const weekly = await this.worldCap.getWeeklyUsage(
          char.id,
          this.weeklyCapKey(realm.key),
        );
        return {
          realm,
          unlocked: roguelikeRealmUnlocked(realm.key, char.realmKey),
          activeRunId: activeRun?.id ?? null,
          dailyUsed: daily?.usedCount ?? 0,
          dailyLimit,
          weeklyClaimsUsed: weekly?.usedCount ?? 0,
          weeklyClaimLimit,
        };
      }),
    );
    return {
      realms,
      activeRun: activeRun ? this.toRunView(activeRun) : null,
    };
  }

  async start(userId: string, realmKey: string): Promise<RoguelikeRunView> {
    const char = await this.getCharacter(userId);
    const realm = roguelikeRealmByKey(realmKey);
    if (!realm) throw new RoguelikeError('REALM_NOT_FOUND');
    if (!roguelikeRealmUnlocked(realmKey, char.realmKey)) {
      throw new RoguelikeError('REALM_LOCKED');
    }
    const balance = await this.getBalanceConfig();
    if (!balance.enabled) throw new RoguelikeError('FEATURE_DISABLED');
    const dailyLimit = this.dailyLimitFor(realm, balance);
    const active = await this.prisma.roguelikeRun.findFirst({
      where: { characterId: char.id, status: RoguelikeRunStatus.ACTIVE },
      select: { id: true },
    });
    if (active) throw new RoguelikeError('ALREADY_IN_RUN');

    const run = await this.prisma.$transaction(async (tx) => {
      await this.worldCap.consumeDailyTx(tx, {
        characterId: char.id,
        capKey: this.dailyCapKey(realm.key),
        source: 'ROGUELIKE_ENTRY',
        limitCount: dailyLimit,
        countDelta: 1,
      });
      const seed = this.makeSeed(char.id, realm.key);
      return tx.roguelikeRun.create({
        data: {
          characterId: char.id,
          realmKey: realm.key,
          seed,
          hp: realm.baseHp,
          hpMax: realm.baseHp,
          resource: realm.baseResource,
          rewardMul: this.rewardMultiplierFor(realm, balance),
          expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
          rewardPreview: computeRoguelikeRewardPreview({
            realmKey: realm.key,
            floorReached: 0,
            rewardMultiplier: this.rewardMultiplierFor(realm, balance),
          }) as unknown as Prisma.InputJsonValue,
        },
      });
    }).catch((e) => mapRoguelikeCapError(e));
    return this.toRunView(run);
  }

  async getCurrent(userId: string): Promise<RoguelikeRunView | null> {
    const char = await this.getCharacter(userId);
    const run = await this.prisma.roguelikeRun.findFirst({
      where: { characterId: char.id, status: RoguelikeRunStatus.ACTIVE },
      orderBy: { startedAt: 'desc' },
    });
    return run ? this.toRunView(run) : null;
  }

  async getRun(userId: string, runId: string): Promise<RoguelikeRunView> {
    const { run } = await this.getOwnedRun(userId, runId);
    return this.toRunView(run);
  }

  async choose(
    userId: string,
    runId: string,
    choiceKey: string,
  ): Promise<RoguelikeRunView> {
    const { char, run } = await this.getOwnedRun(userId, runId);
    if (run.status !== RoguelikeRunStatus.ACTIVE) {
      throw new RoguelikeError('RUN_NOT_ACTIVE');
    }
    const nextFloor = run.currentFloor + 1;
    const choices = getRoguelikeChoicesForFloor(nextFloor, run.seed);
    const choice = choices.find((c) => c.key === choiceKey);
    if (!choice) throw new RoguelikeError('CHOICE_NOT_FOUND');

    const floor = roguelikeFloorByNumber(nextFloor);
    const balance = await this.getBalanceConfig();
    const maxFloor = Math.max(
      1,
      Math.min(balance.maxCompletionFloor, ROGUELIKE_LIMITS.rewardFloorCap),
    );
    const resolved = this.resolveChoice(run, floor, choice);
    const status =
      resolved.hp <= 0
        ? RoguelikeRunStatus.FAILED
        : nextFloor >= maxFloor
          ? RoguelikeRunStatus.COMPLETED
          : RoguelikeRunStatus.ACTIVE;
    const now = new Date();
    const rewardPreview = computeRoguelikeRewardPreview({
      realmKey: run.realmKey,
      floorReached: nextFloor,
      rewardMultiplier: resolved.rewardMul,
    });
    const updated = await this.prisma.roguelikeRun.update({
      where: { id: run.id },
      data: {
        status,
        currentFloor: nextFloor,
        hp: resolved.hp,
        resource: resolved.resource,
        score: resolved.score,
        rewardMul: resolved.rewardMul,
        activeBuffs: resolved.activeBuffs as unknown as Prisma.InputJsonValue,
        floorHistory: resolved.history as unknown as Prisma.InputJsonValue,
        rewardPreview: rewardPreview as unknown as Prisma.InputJsonValue,
        lastChoiceKey: choice.key,
        completedAt: status === RoguelikeRunStatus.COMPLETED ? now : run.completedAt,
        failedAt: status === RoguelikeRunStatus.FAILED ? now : run.failedAt,
      },
    });
    if (status !== RoguelikeRunStatus.ACTIVE) {
      await this.updateLeaderboard(char.id, updated);
    }
    return this.toRunView(updated);
  }

  async abandon(userId: string, runId: string): Promise<RoguelikeRunView> {
    const { run } = await this.getOwnedRun(userId, runId);
    if (run.status !== RoguelikeRunStatus.ACTIVE) {
      throw new RoguelikeError('RUN_NOT_ACTIVE');
    }
    const updated = await this.prisma.roguelikeRun.update({
      where: { id: run.id },
      data: { status: RoguelikeRunStatus.ABANDONED, abandonedAt: new Date() },
    });
    return this.toRunView(updated);
  }

  async claim(userId: string, runId: string): Promise<RoguelikeClaimResult> {
    const { char, run } = await this.getOwnedRun(userId, runId);
    if (run.status === RoguelikeRunStatus.CLAIMED || run.claimedAt) {
      throw new RoguelikeError('RUN_ALREADY_CLAIMED');
    }
    if (run.status !== RoguelikeRunStatus.COMPLETED) {
      throw new RoguelikeError('RUN_NOT_COMPLETED');
    }
    const realm = roguelikeRealmByKey(run.realmKey) ?? ROGUELIKE_REALMS[0]!;
    const balance = await this.getBalanceConfig();
    const weeklyLimit = this.weeklyLimitFor(realm, balance);
    const requested = computeRoguelikeRewardPreview({
      realmKey: run.realmKey,
      floorReached: run.currentFloor,
      rewardMultiplier: run.rewardMul,
    });

    const result = await this.prisma.$transaction(async (tx) => {
      const claimedAt = new Date();
      const upd = await tx.roguelikeRun.updateMany({
        where: {
          id: run.id,
          characterId: char.id,
          status: RoguelikeRunStatus.COMPLETED,
          claimedAt: null,
        },
        data: { status: RoguelikeRunStatus.CLAIMED, claimedAt },
      });
      if (upd.count !== 1) throw new RoguelikeError('RUN_ALREADY_CLAIMED');
      await this.worldCap.consumeWeeklyTx(tx, {
        characterId: char.id,
        capKey: this.weeklyCapKey(run.realmKey),
        source: 'ROGUELIKE_REWARD',
        limitCount: weeklyLimit,
        countDelta: 1,
      });
      const cap = await this.rewardCap.applyCapTx(tx, {
        characterId: char.id,
        source: 'ROGUELIKE',
        requestedExp: BigInt(requested.exp),
        requestedLinhThach: BigInt(requested.linhThach),
        realmKey: char.realmKey,
        refType: 'RoguelikeRun',
        refId: run.id,
        meta: {
          realmKey: run.realmKey,
          floorReached: run.currentFloor,
          score: run.score,
          milestoneFloors: requested.milestoneFloors,
        },
      });
      const linhThach = Number(cap.grantedLinhThach);
      const exp = Number(cap.grantedExp);
      if (linhThach > 0) {
        await this.currency.applyTx(tx, {
          characterId: char.id,
          currency: CurrencyKind.LINH_THACH,
          delta: BigInt(linhThach),
          reason:
            requested.milestoneFloors.length > 0
              ? 'ROGUELIKE_MILESTONE_REWARD'
              : 'ROGUELIKE_FLOOR_REWARD',
          refType: 'RoguelikeRun',
          refId: run.id,
          meta: { floorReached: run.currentFloor, score: run.score },
        });
      }
      if (exp > 0) {
        await tx.character.update({
          where: { id: char.id },
          data: { exp: { increment: BigInt(exp) } },
        });
      }
      const items = [...requested.items];
      if (items.length > 0) {
        await this.inventory.grantTx(tx, char.id, items, {
          reason: 'ROGUELIKE_MILESTONE_REWARD',
          refType: 'RoguelikeRun',
          refId: run.id,
          extra: { milestoneFloors: requested.milestoneFloors },
        });
      }
      const claimed = await tx.roguelikeRun.findUniqueOrThrow({
        where: { id: run.id },
      });
      return {
        run: claimed,
        claimedAt,
        granted: { linhThach, exp, items },
      };
    }).catch((e) => mapRoguelikeCapError(e));
    return {
      runId: run.id,
      claimedAt: result.claimedAt.toISOString(),
      granted: result.granted,
      run: this.toRunView(result.run),
    };
  }

  async leaderboard(limit = 50): Promise<RoguelikeLeaderboardEntry[]> {
    const rows = await this.prisma.roguelikeLeaderboard.findMany({
      orderBy: [{ bestFloor: 'desc' }, { bestScore: 'desc' }, { updatedAt: 'asc' }],
      take: Math.max(1, Math.min(limit, 100)),
      include: { character: { select: { id: true, name: true } } },
    });
    return rows.map((r) => ({
      characterId: r.characterId,
      characterName: r.character.name,
      bestFloor: r.bestFloor,
      bestScore: r.bestScore,
      fastestClearMs: r.fastestClearMs,
      weekBucket: r.weekBucket,
      monthBucket: r.monthBucket,
      updatedAt: r.updatedAt.toISOString(),
    }));
  }

  private async getCharacter(userId: string): Promise<{
    id: string;
    realmKey: string;
    power: number;
    spirit: number;
    speed: number;
    hpMax: number;
  }> {
    const c = await this.prisma.character.findUnique({
      where: { userId },
      select: {
        id: true,
        realmKey: true,
        power: true,
        spirit: true,
        speed: true,
        hpMax: true,
      },
    });
    if (!c) throw new RoguelikeError('NO_CHARACTER');
    return c;
  }

  private async getOwnedRun(
    userId: string,
    runId: string,
  ): Promise<{
    char: Awaited<ReturnType<RoguelikeService['getCharacter']>>;
    run: RoguelikeRun;
  }> {
    const char = await this.getCharacter(userId);
    const run = await this.prisma.roguelikeRun.findUnique({ where: { id: runId } });
    if (!run) throw new RoguelikeError('RUN_NOT_FOUND');
    if (run.characterId !== char.id) throw new RoguelikeError('RUN_NOT_OWNED');
    return { char, run };
  }

  private resolveChoice(
    run: RoguelikeRun,
    floor: RoguelikeFloorDef,
    choice: RoguelikeChoiceDef,
  ): {
    hp: number;
    resource: number;
    score: number;
    rewardMul: number;
    activeBuffs: StoredBuff[];
    history: RoguelikeFloorLogEntry[];
  } {
    const activeBuffs = this.parseStoredBuffs(run.activeBuffs)
      .map((b) => ({ ...b, remainingFloors: b.remainingFloors - 1 }))
      .filter((b) => b.remainingFloors > 0);
    const buffAtk = this.statPct(activeBuffs, 'atkPct');
    const buffDef = this.statPct(activeBuffs, 'defPct');
    const hpDelta = Math.round(choice.hpDeltaPct * (1 - buffDef / 200));
    const floorPressure = Math.max(
      0,
      Math.floor(floor.powerMultiplier * 2 - buffAtk / 20),
    );
    const hp = Math.max(0, Math.min(run.hpMax, run.hp + hpDelta - floorPressure));
    const resource = Math.max(0, run.resource + choice.resourceDelta);
    const rewardMul = Number(
      Math.min(3, run.rewardMul * choice.rewardMultiplier).toFixed(3),
    );
    if (choice.buffKey) {
      const buff = roguelikeBuffByKey(choice.buffKey);
      if (buff) activeBuffs.push({ key: buff.key, remainingFloors: buff.durationFloors });
    }
    if (choice.debuffKey) {
      const debuff = roguelikeBuffByKey(choice.debuffKey);
      if (debuff) {
        activeBuffs.push({
          key: debuff.key,
          remainingFloors: debuff.durationFloors,
        });
      }
    }
    const milestoneBonus = isRoguelikeMilestoneFloor(floor.floorNumber) ? 25 : 0;
    const score =
      run.score +
      choice.scoreDelta +
      Math.floor(floor.floorNumber * floor.powerMultiplier) +
      milestoneBonus;
    const history = this.parseHistory(run.floorHistory);
    history.push({
      floorNumber: floor.floorNumber,
      floorType: floor.floorType,
      choiceKey: choice.key,
      outcomeVi: choice.outcomeVi,
      outcomeEn: choice.outcomeEn,
      hpAfter: hp,
      resourceAfter: resource,
      scoreAfter: score,
      rewardMultiplierAfter: rewardMul,
    });
    return { hp, resource, score, rewardMul, activeBuffs, history };
  }

  private async updateLeaderboard(
    characterId: string,
    run: RoguelikeRun,
  ): Promise<void> {
    const now = new Date();
    const weekBucket = weekBucketFor(now);
    const monthBucket = now.toISOString().slice(0, 7);
    const fastestClearMs =
      run.completedAt && run.startedAt
        ? Math.max(0, run.completedAt.getTime() - run.startedAt.getTime())
        : null;
    const existing = await this.prisma.roguelikeLeaderboard.findUnique({
      where: { characterId },
    });
    const better =
      !existing ||
      run.currentFloor > existing.bestFloor ||
      (run.currentFloor === existing.bestFloor && run.score > existing.bestScore);
    if (!better) return;
    await this.prisma.roguelikeLeaderboard.upsert({
      where: { characterId },
      create: {
        characterId,
        bestFloor: run.currentFloor,
        bestScore: run.score,
        fastestClearMs,
        bestRunId: run.id,
        weekBucket,
        monthBucket,
      },
      update: {
        bestFloor: run.currentFloor,
        bestScore: run.score,
        fastestClearMs,
        bestRunId: run.id,
        weekBucket,
        monthBucket,
      },
    });
  }

  private toRunView(
    run: RoguelikeRun,
  ): RoguelikeRunView {
    const floorNumber =
      run.status === RoguelikeRunStatus.ACTIVE
        ? run.currentFloor + 1
        : run.currentFloor;
    const choices =
      run.status === RoguelikeRunStatus.ACTIVE
        ? getRoguelikeChoicesForFloor(floorNumber, run.seed)
        : [];
    return {
      id: run.id,
      realmKey: run.realmKey,
      status: run.status,
      seed: run.seed,
      currentFloor: run.currentFloor,
      hp: run.hp,
      hpMax: run.hpMax,
      resource: run.resource,
      score: run.score,
      rewardMultiplier: run.rewardMul,
      activeBuffs: this.parseStoredBuffs(run.activeBuffs).map((b) => {
        const def = roguelikeBuffByKey(b.key);
        return {
          key: b.key,
          nameVi: def?.nameVi ?? b.key,
          nameEn: def?.nameEn ?? b.key,
          stat: def?.stat ?? 'atkPct',
          valuePct: def?.valuePct ?? 0,
          remainingFloors: b.remainingFloors,
        };
      }),
      floorHistory: this.parseHistory(run.floorHistory),
      currentFloorDef:
        run.status === RoguelikeRunStatus.ACTIVE
          ? roguelikeFloorByNumber(floorNumber)
          : null,
      choices,
      rewardPreview: computeRoguelikeRewardPreview({
        realmKey: run.realmKey,
        floorReached: run.currentFloor,
        rewardMultiplier: run.rewardMul,
      }),
      startedAt: run.startedAt.toISOString(),
      completedAt: run.completedAt?.toISOString() ?? null,
      failedAt: run.failedAt?.toISOString() ?? null,
      abandonedAt: run.abandonedAt?.toISOString() ?? null,
      claimedAt: run.claimedAt?.toISOString() ?? null,
      expiresAt: run.expiresAt?.toISOString() ?? null,
    };
  }

  private async getBalanceConfig(): Promise<BalanceConfig> {
    const rawValue = await this.remoteConfig.getValue<unknown>(
      'roguelike_balance',
    );
    const raw =
      rawValue && typeof rawValue === 'object'
        ? (rawValue as Partial<BalanceConfig>)
        : {};
    return {
      enabled: raw.enabled ?? true,
      dailyEntryLimit: this.clampInt(raw.dailyEntryLimit, 1, 10, 3),
      weeklyRewardClaimLimit: this.clampInt(
        raw.weeklyRewardClaimLimit,
        1,
        30,
        14,
      ),
      rewardMultiplier: this.clampNumber(raw.rewardMultiplier, 0.5, 2, 1),
      maxCompletionFloor: this.clampInt(
        raw.maxCompletionFloor,
        1,
        ROGUELIKE_LIMITS.rewardFloorCap,
        ROGUELIKE_LIMITS.runCompletionFloor,
      ),
    };
  }

  private dailyLimitFor(realm: RoguelikeRealmDef, cfg: BalanceConfig): number {
    return Math.min(realm.dailyEntryLimit, cfg.dailyEntryLimit);
  }

  private weeklyLimitFor(realm: RoguelikeRealmDef, cfg: BalanceConfig): number {
    return Math.min(realm.weeklyRewardClaimLimit, cfg.weeklyRewardClaimLimit);
  }

  private rewardMultiplierFor(
    realm: RoguelikeRealmDef,
    cfg: BalanceConfig,
  ): number {
    return this.clampNumber(realm.rewardMultiplier * cfg.rewardMultiplier, 0.5, 2.5, 1);
  }

  private dailyCapKey(realmKey: string): string {
    return `roguelike_entry:${realmKey}`;
  }

  private weeklyCapKey(realmKey: string): string {
    return `roguelike_claim:${realmKey}`;
  }

  private makeSeed(characterId: string, realmKey: string): string {
    return `${realmKey}:${characterId}:${Date.now().toString(36)}:${hashToUint32(
      `${characterId}:${realmKey}:${Math.random()}`,
    ).toString(36)}`;
  }

  private parseStoredBuffs(value: Prisma.JsonValue): StoredBuff[] {
    if (!Array.isArray(value)) return [];
    return value
      .map((v) => {
        if (!v || typeof v !== 'object') return null;
        const obj = v as { key?: unknown; remainingFloors?: unknown };
        if (typeof obj.key !== 'string') return null;
        const remainingFloors =
          typeof obj.remainingFloors === 'number'
            ? Math.floor(obj.remainingFloors)
            : 0;
        return { key: obj.key, remainingFloors };
      })
      .filter((v): v is StoredBuff => !!v && v.remainingFloors > 0);
  }

  private parseHistory(value: Prisma.JsonValue): RoguelikeFloorLogEntry[] {
    if (!Array.isArray(value)) return [];
    return value
      .map((v) => {
        if (!v || typeof v !== 'object') return null;
        const obj = v as Partial<RoguelikeFloorLogEntry>;
        if (
          typeof obj.floorNumber !== 'number' ||
          typeof obj.choiceKey !== 'string'
        ) {
          return null;
        }
        const floor = roguelikeFloorByNumber(obj.floorNumber);
        const choice = roguelikeChoiceByKey(obj.choiceKey);
        return {
          floorNumber: obj.floorNumber,
          floorType: floor.floorType,
          choiceKey: obj.choiceKey,
          outcomeVi: typeof obj.outcomeVi === 'string' ? obj.outcomeVi : choice?.outcomeVi ?? '',
          outcomeEn: typeof obj.outcomeEn === 'string' ? obj.outcomeEn : choice?.outcomeEn ?? '',
          hpAfter: typeof obj.hpAfter === 'number' ? obj.hpAfter : 0,
          resourceAfter:
            typeof obj.resourceAfter === 'number' ? obj.resourceAfter : 0,
          scoreAfter: typeof obj.scoreAfter === 'number' ? obj.scoreAfter : 0,
          rewardMultiplierAfter:
            typeof obj.rewardMultiplierAfter === 'number'
              ? obj.rewardMultiplierAfter
              : 1,
        };
      })
      .filter((v): v is RoguelikeFloorLogEntry => !!v);
  }

  private statPct(buffs: StoredBuff[], stat: RoguelikeBuffDef['stat']): number {
    return buffs.reduce((sum, buff) => {
      const def = roguelikeBuffByKey(buff.key);
      return def?.stat === stat ? sum + def.valuePct : sum;
    }, 0);
  }

  private clampInt(
    value: unknown,
    min: number,
    max: number,
    fallback: number,
  ): number {
    if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
    return Math.max(min, Math.min(max, Math.floor(value)));
  }

  private clampNumber(
    value: unknown,
    min: number,
    max: number,
    fallback: number,
  ): number {
    if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
    return Math.max(min, Math.min(max, value));
  }
}

export function mapRoguelikeCapError(e: unknown): never {
  if (e instanceof WorldCapError) {
    if (e.code === 'DAILY_CAP_REACHED') {
      throw new RoguelikeError('DAILY_LIMIT_REACHED');
    }
    throw new RoguelikeError('WEEKLY_CAP_REACHED');
  }
  throw e;
}

function weekBucketFor(d: Date): string {
  const date = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((date.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `${date.getUTCFullYear()}-W${week.toString().padStart(2, '0')}`;
}
