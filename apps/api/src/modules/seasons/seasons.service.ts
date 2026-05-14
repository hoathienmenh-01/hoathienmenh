import { Injectable } from '@nestjs/common';
import {
  CurrencyKind,
  SeasonLeaderboardKind,
  SeasonStatus,
  type Prisma,
  type ServerSeason,
} from '@prisma/client';
import {
  normalizeSeasonMilestones,
  normalizeSeasonPointConfig,
  normalizeSeasonRewards,
  seasonRewardByKey,
  type SeasonMilestoneMetric,
  type SeasonPointSource,
  type SeasonRewardDef,
} from '@xuantoi/shared';
import { PrismaService } from '../../common/prisma.service';
import { CurrencyService } from '../character/currency.service';
import { RewardCapService } from '../economy/reward-cap.service';
import { InventoryService } from '../inventory/inventory.service';
import { WorldCapService, WorldCapError } from '../world-content/world-cap.service';

export type SeasonPointMeta = Record<string, unknown>;

export interface SeasonView {
  seasonKey: string;
  name: string;
  description: string;
  status: SeasonStatus;
  startAt: string;
  endAt: string;
  pointConfig: ReturnType<typeof normalizeSeasonPointConfig>;
  rewards: ReturnType<typeof normalizeSeasonRewards>;
  milestones: ReturnType<typeof normalizeSeasonMilestones>;
}

export interface SeasonProgressView {
  season: SeasonView | null;
  progress: {
    points: number;
    bestRoguelikeFloor: number;
    bossDefeats: number;
    dungeonClears: number;
    craftCount: number;
    breakthroughCount: number;
    dailyUsed: number;
    dailyCap: number;
    weeklyUsed: number;
    weeklyCap: number;
    lastPointAt: string | null;
  } | null;
  rewards: Array<SeasonRewardDef & { claimable: boolean; claimed: boolean }>;
}

export interface SeasonLeaderboardView {
  season: SeasonView | null;
  kind: SeasonLeaderboardKind;
  entries: Array<{
    rank: number;
    characterId: string;
    characterName: string;
    score: number;
    tieBreaker: number;
    updatedAt: string;
  }>;
}

export interface SeasonMilestoneView {
  season: SeasonView | null;
  milestones: Array<{
    milestoneKey: string;
    metric: string;
    target: number;
    progress: number;
    unlockedAt: string | null;
    effectKey: string | null;
    titleVi: string;
    titleEn: string;
    effectVi: string;
    effectEn: string;
  }>;
}

export interface SeasonClaimResult {
  rewardKey: string;
  claimedAt: string;
  granted: {
    linhThach: number;
    exp: number;
    eventToken: number;
    items: Array<{ itemKey: string; qty: number }>;
  };
}

export class SeasonError extends Error {
  constructor(
    public readonly code:
      | 'NO_CHARACTER'
      | 'SEASON_NOT_FOUND'
      | 'NO_ACTIVE_SEASON'
      | 'SEASON_NOT_ACTIVE'
      | 'SEASON_ALREADY_ACTIVE'
      | 'SEASON_DATE_INVALID'
      | 'POINT_CAP_REACHED'
      | 'REWARD_NOT_FOUND'
      | 'REWARD_NOT_UNLOCKED'
      | 'REWARD_ALREADY_CLAIMED',
  ) {
    super(code);
    this.name = 'SeasonError';
  }
}

@Injectable()
export class SeasonsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly currency: CurrencyService,
    private readonly inventory: InventoryService,
    private readonly rewardCap: RewardCapService,
    private readonly worldCap: WorldCapService,
  ) {}

  async current(): Promise<SeasonView | null> {
    const season = await this.getActiveSeason();
    return season ? this.toSeasonView(season) : null;
  }

  async byKey(seasonKey: string): Promise<SeasonView> {
    const season = await this.prisma.serverSeason.findUnique({
      where: { seasonKey },
    });
    if (!season) throw new SeasonError('SEASON_NOT_FOUND');
    return this.toSeasonView(season);
  }

  async progress(userId: string): Promise<SeasonProgressView> {
    const season = await this.getActiveSeason();
    if (!season) return { season: null, progress: null, rewards: [] };
    const char = await this.getCharacter(userId);
    const pointConfig = normalizeSeasonPointConfig(season.pointConfig);
    const [progress, daily, weekly, claims] = await Promise.all([
      this.prisma.seasonProgress.upsert({
        where: {
          seasonId_characterId: { seasonId: season.id, characterId: char.id },
        },
        create: { seasonId: season.id, characterId: char.id },
        update: {},
      }),
      this.worldCap.getDailyUsage(char.id, this.dailyCapKey(season.seasonKey)),
      this.worldCap.getWeeklyUsage(char.id, this.weeklyCapKey(season.seasonKey)),
      this.prisma.seasonRewardClaim.findMany({
        where: { seasonId: season.id, characterId: char.id },
        select: { rewardKey: true },
      }),
    ]);
    const claimed = new Set(claims.map((c) => c.rewardKey));
    const rewards = normalizeSeasonRewards(season.rewardConfig).map((reward) => ({
      ...reward,
      claimed: claimed.has(reward.rewardKey),
      claimable: progress.points >= reward.minPoints && !claimed.has(reward.rewardKey),
    }));
    return {
      season: this.toSeasonView(season),
      progress: {
        points: progress.points,
        bestRoguelikeFloor: progress.bestRoguelikeFloor,
        bossDefeats: progress.bossDefeats,
        dungeonClears: progress.dungeonClears,
        craftCount: progress.craftCount,
        breakthroughCount: progress.breakthroughCount,
        dailyUsed: daily.usedQty,
        dailyCap: pointConfig.dailyCap,
        weeklyUsed: weekly.usedQty,
        weeklyCap: pointConfig.weeklyCap,
        lastPointAt: progress.lastPointAt?.toISOString() ?? null,
      },
      rewards,
    };
  }

  async leaderboard(
    kind: SeasonLeaderboardKind = SeasonLeaderboardKind.POINTS,
    limit = 50,
  ): Promise<SeasonLeaderboardView> {
    const season = await this.getActiveSeason();
    if (!season) return { season: null, kind, entries: [] };
    const rows = await this.prisma.seasonLeaderboardEntry.findMany({
      where: { seasonId: season.id, kind },
      orderBy: [{ score: 'desc' }, { tieBreaker: 'desc' }, { updatedAt: 'asc' }],
      take: Math.max(1, Math.min(limit, 100)),
      include: { character: { select: { id: true, name: true } } },
    });
    return {
      season: this.toSeasonView(season),
      kind,
      entries: rows.map((row, idx) => ({
        rank: idx + 1,
        characterId: row.characterId,
        characterName: row.character.name,
        score: row.score,
        tieBreaker: row.tieBreaker,
        updatedAt: row.updatedAt.toISOString(),
      })),
    };
  }

  async serverMilestones(): Promise<SeasonMilestoneView> {
    const season = await this.getActiveSeason();
    if (!season) return { season: null, milestones: [] };
    await this.ensureMilestones(season);
    const defs = normalizeSeasonMilestones(season.milestoneConfig);
    const defByKey = new Map(defs.map((d) => [d.milestoneKey, d]));
    const rows = await this.prisma.seasonServerMilestone.findMany({
      where: { seasonId: season.id },
      orderBy: { createdAt: 'asc' },
    });
    return {
      season: this.toSeasonView(season),
      milestones: rows.map((row) => {
        const def = defByKey.get(row.milestoneKey);
        return {
          milestoneKey: row.milestoneKey,
          metric: row.metric,
          target: row.target,
          progress: row.progress,
          unlockedAt: row.unlockedAt?.toISOString() ?? null,
          effectKey: row.effectKey,
          titleVi: def?.titleVi ?? row.milestoneKey,
          titleEn: def?.titleEn ?? row.milestoneKey,
          effectVi: def?.effectVi ?? '',
          effectEn: def?.effectEn ?? '',
        };
      }),
    };
  }

  async addPoints(
    characterId: string,
    source: SeasonPointSource,
    amount: number,
    meta: SeasonPointMeta = {},
    now = new Date(),
  ): Promise<{ granted: number; points: number; capped: boolean } | null> {
    const season = await this.getActiveSeason(now);
    if (!season) return null;
    if (season.status !== SeasonStatus.ACTIVE) throw new SeasonError('SEASON_NOT_ACTIVE');
    const points = Math.max(0, Math.floor(amount));
    if (points <= 0) {
      const existing = await this.getProgressRow(season.id, characterId);
      return { granted: 0, points: existing.points, capped: false };
    }
    const config = normalizeSeasonPointConfig(season.pointConfig);
    try {
      return await this.prisma.$transaction(async (tx) => {
        const daily = await this.worldCap.consumeDailyTx(tx, {
          characterId,
          capKey: this.dailyCapKey(season.seasonKey),
          source: 'SEASON_POINTS',
          limitQty: config.dailyCap,
          qtyDelta: points,
          now,
        });
        await this.worldCap.consumeWeeklyTx(tx, {
          characterId,
          capKey: this.weeklyCapKey(season.seasonKey),
          source: 'SEASON_POINTS',
          limitQty: config.weeklyCap,
          qtyDelta: points,
          now,
        });
        const progress = await tx.seasonProgress.upsert({
          where: { seasonId_characterId: { seasonId: season.id, characterId } },
          create: this.progressCreateData(season.id, characterId, source, points, meta, now),
          update: {
            points: { increment: points },
            lastPointAt: now,
            ...this.progressUpdateData(source, meta),
          },
        });
        await tx.seasonLeaderboardEntry.upsert({
          where: {
            seasonId_kind_characterId: {
              seasonId: season.id,
              kind: SeasonLeaderboardKind.POINTS,
              characterId,
            },
          },
          create: {
            seasonId: season.id,
            characterId,
            kind: SeasonLeaderboardKind.POINTS,
            score: progress.points,
            tieBreaker: daily.usedQty,
            meta: { source, ...meta } as Prisma.InputJsonValue,
          },
          update: {
            score: progress.points,
            tieBreaker: daily.usedQty,
            meta: { source, ...meta } as Prisma.InputJsonValue,
          },
        });
        await this.upsertDerivedLeaderboardTx(tx, season.id, characterId, source, progress, meta);
        await this.incrementMilestonesTx(tx, season, source, meta);
        return { granted: points, points: progress.points, capped: false };
      });
    } catch (e) {
      if (e instanceof WorldCapError) {
        const progress = await this.getProgressRow(season.id, characterId);
        return { granted: 0, points: progress.points, capped: true };
      }
      throw e;
    }
  }

  async recordRoguelikeCompletion(
    characterId: string,
    floor: number,
    score: number,
    now = new Date(),
  ): Promise<void> {
    const season = await this.getActiveSeason(now);
    if (!season) return;
    const config = normalizeSeasonPointConfig(season.pointConfig);
    const points = Math.max(0, Math.floor(floor * config.sourcePoints.ROGUELIKE));
    await this.addPoints(characterId, 'ROGUELIKE', points, { floor, score }, now);
  }

  async claimReward(userId: string, rewardKey: string): Promise<SeasonClaimResult> {
    const season = await this.getActiveSeason();
    if (!season) throw new SeasonError('NO_ACTIVE_SEASON');
    const char = await this.getCharacter(userId);
    const rewards = normalizeSeasonRewards(season.rewardConfig);
    const reward = seasonRewardByKey(rewards, rewardKey);
    if (!reward) throw new SeasonError('REWARD_NOT_FOUND');
    const progress = await this.getProgressRow(season.id, char.id);
    if (progress.points < reward.minPoints) throw new SeasonError('REWARD_NOT_UNLOCKED');
    const existing = await this.prisma.seasonRewardClaim.findUnique({
      where: {
        seasonId_characterId_rewardKey: {
          seasonId: season.id,
          characterId: char.id,
          rewardKey,
        },
      },
    });
    if (existing) throw new SeasonError('REWARD_ALREADY_CLAIMED');

    return this.prisma.$transaction(async (tx) => {
      const claimedAt = new Date();
      const claim = await tx.seasonRewardClaim.create({
        data: {
          seasonId: season.id,
          characterId: char.id,
          rewardKey,
          claimedAt,
          grantJson: { requested: reward } as unknown as Prisma.InputJsonValue,
        },
      }).catch((e: unknown) => {
        if (isUniqueViolation(e)) throw new SeasonError('REWARD_ALREADY_CLAIMED');
        throw e;
      });
      const cap = await this.rewardCap.applyCapTx(tx, {
        characterId: char.id,
        source: 'SEASON',
        requestedExp: BigInt(reward.exp),
        requestedLinhThach: BigInt(reward.linhThach),
        realmKey: char.realmKey,
        refType: 'SeasonRewardClaim',
        refId: claim.id,
        meta: { seasonKey: season.seasonKey, rewardKey },
      });
      const linhThach = Number(cap.grantedLinhThach);
      const exp = Number(cap.grantedExp);
      if (linhThach > 0) {
        await this.currency.applyTx(tx, {
          characterId: char.id,
          currency: CurrencyKind.LINH_THACH,
          delta: BigInt(linhThach),
          reason: 'SEASON_REWARD',
          refType: 'SeasonRewardClaim',
          refId: claim.id,
          meta: { seasonKey: season.seasonKey, rewardKey },
        });
      }
      if (reward.eventToken > 0) {
        await this.currency.applyTx(tx, {
          characterId: char.id,
          currency: CurrencyKind.EVENT_TOKEN,
          delta: BigInt(reward.eventToken),
          reason: 'SEASON_REWARD',
          refType: 'SeasonRewardClaim',
          refId: claim.id,
          meta: { seasonKey: season.seasonKey, rewardKey },
        });
      }
      if (exp > 0) {
        await tx.character.update({
          where: { id: char.id },
          data: { exp: { increment: BigInt(exp) } },
        });
      }
      if (reward.items.length > 0) {
        await this.inventory.grantTx(tx, char.id, [...reward.items], {
          reason: 'SEASON_REWARD',
          refType: 'SeasonRewardClaim',
          refId: claim.id,
          extra: { seasonKey: season.seasonKey, rewardKey },
        });
      }
      const granted = {
        linhThach,
        exp,
        eventToken: reward.eventToken,
        items: [...reward.items],
      };
      await tx.seasonRewardClaim.update({
        where: { id: claim.id },
        data: {
          grantJson: { requested: reward, granted } as unknown as Prisma.InputJsonValue,
        },
      });
      return { rewardKey, claimedAt: claimedAt.toISOString(), granted };
    });
  }

  async createSeason(input: {
    seasonKey: string;
    name: string;
    description?: string;
    startAt: Date;
    endAt: Date;
    adminId?: string;
    status?: SeasonStatus;
    pointConfig?: unknown;
    rewardConfig?: unknown;
    milestoneConfig?: unknown;
  }): Promise<SeasonView> {
    this.assertDateRange(input.startAt, input.endAt);
    if (input.status === SeasonStatus.ACTIVE) await this.assertNoOtherActive();
    const season = await this.prisma.serverSeason.create({
      data: {
        seasonKey: input.seasonKey,
        name: input.name,
        description: input.description ?? '',
        startAt: input.startAt,
        endAt: input.endAt,
        status: input.status ?? SeasonStatus.UPCOMING,
        pointConfig: normalizeSeasonPointConfig(input.pointConfig) as unknown as Prisma.InputJsonValue,
        rewardConfig: normalizeSeasonRewards(input.rewardConfig) as unknown as Prisma.InputJsonValue,
        milestoneConfig: normalizeSeasonMilestones(input.milestoneConfig) as unknown as Prisma.InputJsonValue,
        createdByAdminId: input.adminId ?? null,
        updatedByAdminId: input.adminId ?? null,
      },
    });
    await this.ensureMilestones(season);
    return this.toSeasonView(season);
  }

  async updateSeason(
    seasonKey: string,
    input: {
      name?: string;
      description?: string;
      startAt?: Date;
      endAt?: Date;
      pointConfig?: unknown;
      rewardConfig?: unknown;
      milestoneConfig?: unknown;
      adminId?: string;
    },
  ): Promise<SeasonView> {
    const existing = await this.prisma.serverSeason.findUnique({ where: { seasonKey } });
    if (!existing) throw new SeasonError('SEASON_NOT_FOUND');
    const startAt = input.startAt ?? existing.startAt;
    const endAt = input.endAt ?? existing.endAt;
    this.assertDateRange(startAt, endAt);
    const season = await this.prisma.serverSeason.update({
      where: { seasonKey },
      data: {
        name: input.name ?? existing.name,
        description: input.description ?? existing.description,
        startAt,
        endAt,
        ...(input.pointConfig === undefined
          ? {}
          : {
              pointConfig: normalizeSeasonPointConfig(
                input.pointConfig,
              ) as unknown as Prisma.InputJsonValue,
            }),
        ...(input.rewardConfig === undefined
          ? {}
          : {
              rewardConfig: normalizeSeasonRewards(
                input.rewardConfig,
              ) as unknown as Prisma.InputJsonValue,
            }),
        ...(input.milestoneConfig === undefined
          ? {}
          : {
              milestoneConfig: normalizeSeasonMilestones(
                input.milestoneConfig,
              ) as unknown as Prisma.InputJsonValue,
            }),
        updatedByAdminId: input.adminId ?? existing.updatedByAdminId,
      },
    });
    await this.ensureMilestones(season);
    return this.toSeasonView(season);
  }

  async setStatus(
    seasonKey: string,
    status: SeasonStatus,
    adminId?: string,
  ): Promise<SeasonView> {
    const season = await this.prisma.serverSeason.findUnique({ where: { seasonKey } });
    if (!season) throw new SeasonError('SEASON_NOT_FOUND');
    if (status === SeasonStatus.ACTIVE) await this.assertNoOtherActive(season.id);
    const updated = await this.prisma.serverSeason.update({
      where: { seasonKey },
      data: { status, updatedByAdminId: adminId ?? season.updatedByAdminId },
    });
    return this.toSeasonView(updated);
  }

  private async getActiveSeason(now = new Date()): Promise<ServerSeason | null> {
    return this.prisma.serverSeason.findFirst({
      where: {
        status: SeasonStatus.ACTIVE,
        startAt: { lte: now },
        endAt: { gt: now },
      },
      orderBy: { startAt: 'desc' },
    });
  }

  private async getCharacter(userId: string): Promise<{ id: string; realmKey: string }> {
    const char = await this.prisma.character.findUnique({
      where: { userId },
      select: { id: true, realmKey: true },
    });
    if (!char) throw new SeasonError('NO_CHARACTER');
    return char;
  }

  private async getProgressRow(seasonId: string, characterId: string) {
    return this.prisma.seasonProgress.upsert({
      where: { seasonId_characterId: { seasonId, characterId } },
      create: { seasonId, characterId },
      update: {},
    });
  }

  private toSeasonView(season: ServerSeason): SeasonView {
    return {
      seasonKey: season.seasonKey,
      name: season.name,
      description: season.description,
      status: season.status,
      startAt: season.startAt.toISOString(),
      endAt: season.endAt.toISOString(),
      pointConfig: normalizeSeasonPointConfig(season.pointConfig),
      rewards: normalizeSeasonRewards(season.rewardConfig),
      milestones: normalizeSeasonMilestones(season.milestoneConfig),
    };
  }

  private dailyCapKey(seasonKey: string): string {
    return `season_points:${seasonKey}`;
  }

  private weeklyCapKey(seasonKey: string): string {
    return `season_points:${seasonKey}`;
  }

  private progressCreateData(
    seasonId: string,
    characterId: string,
    source: SeasonPointSource,
    points: number,
    meta: SeasonPointMeta,
    now: Date,
  ): Prisma.SeasonProgressUncheckedCreateInput {
    const data: Prisma.SeasonProgressUncheckedCreateInput = {
      seasonId,
      characterId,
      points,
      lastPointAt: now,
    };
    if (source === 'BOSS') data.bossDefeats = 1;
    if (source === 'DUNGEON') data.dungeonClears = 1;
    if (source === 'CRAFT') data.craftCount = 1;
    if (source === 'BREAKTHROUGH') data.breakthroughCount = 1;
    if (source === 'ROGUELIKE') {
      const floor = Number(meta.floor ?? 0);
      if (Number.isSafeInteger(floor) && floor > 0) data.bestRoguelikeFloor = floor;
    }
    return data;
  }

  private progressUpdateData(
    source: SeasonPointSource,
    meta: SeasonPointMeta,
  ): Prisma.SeasonProgressUpdateInput {
    if (source === 'BOSS') return { bossDefeats: { increment: 1 } };
    if (source === 'DUNGEON') return { dungeonClears: { increment: 1 } };
    if (source === 'CRAFT') return { craftCount: { increment: 1 } };
    if (source === 'BREAKTHROUGH') {
      return { breakthroughCount: { increment: 1 } };
    }
    if (source === 'ROGUELIKE') {
      const floor = Number(meta.floor ?? 0);
      return Number.isSafeInteger(floor) && floor > 0
        ? { bestRoguelikeFloor: { set: floor } }
        : {};
    }
    return {};
  }

  private async upsertDerivedLeaderboardTx(
    tx: Prisma.TransactionClient,
    seasonId: string,
    characterId: string,
    source: SeasonPointSource,
    progress: { bestRoguelikeFloor: number; bossDefeats: number; dungeonClears: number },
    meta: SeasonPointMeta,
  ): Promise<void> {
    const derived: Array<{ kind: SeasonLeaderboardKind; score: number }> = [];
    if (source === 'ROGUELIKE') {
      derived.push({
        kind: SeasonLeaderboardKind.ROGUELIKE_FLOOR,
        score: progress.bestRoguelikeFloor,
      });
    }
    if (source === 'BOSS') {
      derived.push({ kind: SeasonLeaderboardKind.BOSS_DEFEATS, score: progress.bossDefeats });
    }
    if (source === 'DUNGEON') {
      derived.push({
        kind: SeasonLeaderboardKind.DUNGEON_CLEARS,
        score: progress.dungeonClears,
      });
    }
    for (const row of derived) {
      await tx.seasonLeaderboardEntry.upsert({
        where: {
          seasonId_kind_characterId: { seasonId, kind: row.kind, characterId },
        },
        create: {
          seasonId,
          characterId,
          kind: row.kind,
          score: row.score,
          meta: meta as Prisma.InputJsonValue,
        },
        update: { score: row.score, meta: meta as Prisma.InputJsonValue },
      });
    }
  }

  private async incrementMilestonesTx(
    tx: Prisma.TransactionClient,
    season: ServerSeason,
    source: SeasonPointSource,
    meta: SeasonPointMeta,
  ): Promise<void> {
    const increments = this.milestoneIncrements(source, meta);
    if (increments.length === 0) return;
    await this.ensureMilestonesTx(tx, season);
    for (const inc of increments) {
      const rows = await tx.seasonServerMilestone.findMany({
        where: { seasonId: season.id, metric: inc.metric },
      });
      for (const row of rows) {
        const next = row.progress + inc.delta;
        await tx.seasonServerMilestone.update({
          where: { id: row.id },
          data: {
            progress: { increment: inc.delta },
            unlockedAt:
              row.unlockedAt === null && next >= row.target ? new Date() : row.unlockedAt,
          },
        });
      }
    }
  }

  private milestoneIncrements(
    source: SeasonPointSource,
    meta: SeasonPointMeta,
  ): Array<{ metric: SeasonMilestoneMetric; delta: number }> {
    if (source === 'BOSS') return [{ metric: 'BOSS_DEFEATS', delta: 1 }];
    if (source === 'DUNGEON') return [{ metric: 'DUNGEON_CLEARS', delta: 1 }];
    if (source === 'CRAFT') return [{ metric: 'CRAFT_COUNT', delta: 1 }];
    if (source === 'BREAKTHROUGH') return [{ metric: 'BREAKTHROUGHS', delta: 1 }];
    if (source === 'ROGUELIKE') {
      const floor = Number(meta.floor ?? 0);
      return Number.isSafeInteger(floor) && floor > 0
        ? [{ metric: 'ROGUELIKE_FLOORS', delta: floor }]
        : [];
    }
    return [];
  }

  private async ensureMilestones(season: ServerSeason): Promise<void> {
    await this.prisma.$transaction((tx) => this.ensureMilestonesTx(tx, season));
  }

  private async ensureMilestonesTx(
    tx: Prisma.TransactionClient,
    season: ServerSeason,
  ): Promise<void> {
    const defs = normalizeSeasonMilestones(season.milestoneConfig);
    for (const def of defs) {
      await tx.seasonServerMilestone.upsert({
        where: {
          seasonId_milestoneKey: {
            seasonId: season.id,
            milestoneKey: def.milestoneKey,
          },
        },
        create: {
          seasonId: season.id,
          milestoneKey: def.milestoneKey,
          metric: def.metric,
          target: def.target,
          effectKey: def.effectKey,
          meta: { titleVi: def.titleVi, titleEn: def.titleEn } as Prisma.InputJsonValue,
        },
        update: {
          metric: def.metric,
          target: def.target,
          effectKey: def.effectKey,
          meta: { titleVi: def.titleVi, titleEn: def.titleEn } as Prisma.InputJsonValue,
        },
      });
    }
  }

  private assertDateRange(startAt: Date, endAt: Date): void {
    if (!(startAt instanceof Date) || !(endAt instanceof Date) || startAt >= endAt) {
      throw new SeasonError('SEASON_DATE_INVALID');
    }
  }

  private async assertNoOtherActive(excludeId?: string): Promise<void> {
    const existing = await this.prisma.serverSeason.findFirst({
      where: {
        status: SeasonStatus.ACTIVE,
        ...(excludeId ? { id: { not: excludeId } } : {}),
      },
      select: { id: true },
    });
    if (existing) throw new SeasonError('SEASON_ALREADY_ACTIVE');
  }
}

function isUniqueViolation(e: unknown): boolean {
  return (
    !!e &&
    typeof e === 'object' &&
    'code' in e &&
    (e as { code?: unknown }).code === 'P2002'
  );
}
