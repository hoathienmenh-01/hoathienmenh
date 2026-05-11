import { Injectable, Logger } from '@nestjs/common';
import {
  CoopWeeklyRewardClaimStatus as PrismaCoopWeeklyRewardClaimStatus,
  CoopWeeklySeasonStatus as PrismaCoopWeeklySeasonStatus,
  CurrencyKind,
  Prisma,
} from '@prisma/client';
import {
  applyLeechRiskDowngrade,
  buildCoopRewardDayKey,
  buildCoopRewardWeekKey,
  buildCoopWeeklyRewardRefId,
  buildWeekEndDate,
  buildWeekStartDate,
  canClaimCoopRewardWithinCap,
  canClaimCoopWeeklyReward,
  classifyCoopLeechRisk,
  classifyWeeklyRewardTier,
  computeWeeklyContributionPoints,
  computeWeeklyReward,
  COOP_REWARD_CAP_LIMITS,
  COOP_WEEKLY_BASE_REWARD,
  type CoopLeechRiskLevel,
  type CoopRewardCapCounterDto,
  type CoopRewardSource,
  type CoopRewardStatusDto,
  type CoopWeeklyLeaderboardEntryDto,
  type CoopWeeklyLeaderboardResponse,
  type CoopWeeklyRewardClaimDto,
  type CoopWeeklyRewardTier,
  type CoopWeeklySeasonDto,
  type CoopWeeklySeasonStatus,
  isCoopRewardSource,
  isCoopWeeklyRewardTier,
} from '@xuantoi/shared';
import { PrismaService } from '../../common/prisma.service';
import { CurrencyService } from '../character/currency.service';

/**
 * Phase 20.3 — Co-op Reward Cap / Anti-leech / Weekly Contribution
 * Season runtime service.
 *
 * Trách nhiệm:
 *   1. **Cap gate** trước khi grant reward từ `CoopBoss` (Phase 20.2)
 *      hoặc `PartyDungeon` (Phase 20.1) — `checkDailyWeeklyCap`. Hết
 *      cap → throw `CapReachedError` để caller skip grant + ghi
 *      anomaly. KHÔNG tự bypass ledger.
 *   2. **Cap increment** sau grant thành công — `incrementRewardCapCounterTx`
 *      (upsert UNIQUE `(userId, source, dayKey)` + index weekKey).
 *      Phải gọi inside cùng transaction với grant để rollback an toàn.
 *   3. **Anti-leech classification** — `classifyAndAuditLeechRisk`
 *      dùng helper shared + ghi `GameplayAnomaly` `COOP_LEECH_HIGH`
 *      khi tier=HIGH. KHÔNG auto-ban — chỉ informational.
 *   4. **Weekly contribution record** — `recordWeeklyContribution`
 *      upsert `CoopWeeklyContributionEntry` cộng dồn points. Tự
 *      auto-create `CoopWeeklyContributionSeason` ACTIVE nếu chưa
 *      có (cron-less foundation).
 *   5. **Settle weekly season** — `settleWeeklySeason` rank entries
 *      theo `totalPoints` DESC + map tier qua
 *      `classifyWeeklyRewardTier` + tạo `CoopWeeklyRewardClaim`
 *      PENDING.
 *   6. **Claim weekly reward** — `claimWeeklyReward` atomic CAS
 *      `PENDING → CLAIMED` + ledger grant qua `CurrencyService.applyTx`
 *      (reason `COOP_WEEKLY_REWARD`).
 *   7. **Status query** — `getMyCoopRewardStatus` (user) +
 *      `getAdminSummary` (admin).
 *
 * KHÔNG làm:
 *   - Auto-ban / auto-rollback.
 *   - Modify reward đã nhận.
 *   - Cross-server query.
 *   - Skip cap khi admin grant (admin path không gọi service này).
 *
 * Race-safe pattern:
 *   - Counter upsert UNIQUE composite `(userId, source, dayKey)` +
 *     atomic upsert. 2 grant concurrent → upsert lần 2 increment.
 *   - Weekly claim CAS guard `status='PENDING'` → đúng 1 winner.
 *   - Season settle bao bọc trong $transaction để rank snapshot
 *     deterministic.
 */
export class CoopCapError extends Error {
  constructor(
    public readonly code:
      | 'INVALID_SOURCE'
      | 'DAILY_CAP_REACHED'
      | 'WEEKLY_CAP_REACHED'
      | 'SEASON_NOT_FOUND'
      | 'SEASON_NOT_SETTLED'
      | 'SEASON_ALREADY_SETTLED'
      | 'SEASON_NOT_CLOSED'
      | 'REWARD_NOT_FOUND'
      | 'REWARD_TIER_NONE'
      | 'REWARD_ALREADY_CLAIMED'
      | 'REWARD_SKIPPED'
      | 'CHARACTER_NOT_FOUND',
  ) {
    super(code);
    this.name = 'CoopCapError';
  }
}

@Injectable()
export class CoopRewardCapService {
  private readonly logger = new Logger(CoopRewardCapService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly currency: CurrencyService,
  ) {}

  // ---------------------------------------------------------------------------
  // Cap gate + increment
  // ---------------------------------------------------------------------------

  /**
   * Kiểm tra cap daily + weekly cho 1 (userId, source) tại thời điểm
   * `now`. Trả `{ ok, dailyClaims, weeklyClaims }` cho caller log /
   * audit. **Không** tự throw — caller quyết định.
   *
   * Đọc snapshot từ `CoopRewardCapCounter`. KHÔNG mutate.
   */
  async checkDailyWeeklyCap(input: {
    userId: string;
    source: CoopRewardSource;
    now?: Date;
  }): Promise<{
    ok: boolean;
    code?: 'DAILY_CAP_REACHED' | 'WEEKLY_CAP_REACHED' | 'INVALID_SOURCE';
    dailyClaims: number;
    weeklyClaims: number;
    dayKey: string;
    weekKey: string;
  }> {
    if (!isCoopRewardSource(input.source)) {
      return {
        ok: false,
        code: 'INVALID_SOURCE',
        dailyClaims: 0,
        weeklyClaims: 0,
        dayKey: '',
        weekKey: '',
      };
    }
    const now = input.now ?? new Date();
    const dayKey = buildCoopRewardDayKey(now);
    const weekKey = buildCoopRewardWeekKey(now);

    const todayCounter = await this.prisma.coopRewardCapCounter.findUnique({
      where: {
        userId_source_dayKey: {
          userId: input.userId,
          source: input.source,
          dayKey,
        },
      },
      select: { claimCount: true },
    });

    const weekRows = await this.prisma.coopRewardCapCounter.findMany({
      where: { userId: input.userId, source: input.source, weekKey },
      select: { claimCount: true },
    });
    const weeklyClaims = weekRows.reduce((acc, r) => acc + r.claimCount, 0);

    const dailyClaims = todayCounter?.claimCount ?? 0;
    const decision = canClaimCoopRewardWithinCap({
      source: input.source,
      dailyClaims,
      weeklyClaims,
    });
    if (decision.ok) {
      return { ok: true, dailyClaims, weeklyClaims, dayKey, weekKey };
    }
    return {
      ok: false,
      code: decision.code,
      dailyClaims,
      weeklyClaims,
      dayKey,
      weekKey,
    };
  }

  /**
   * Increment counter sau khi grant thành công. Phải gọi inside cùng
   * transaction với grant để rollback consistent. Upsert UNIQUE
   * `(userId, source, dayKey)`.
   *
   * `rewardValueApprox` BigInt — caller convert linhThach amount.
   */
  async incrementRewardCapCounterTx(
    tx: Prisma.TransactionClient,
    input: {
      userId: string;
      characterId: string;
      source: CoopRewardSource;
      rewardValueApprox: bigint;
      now?: Date;
    },
  ): Promise<void> {
    const now = input.now ?? new Date();
    const dayKey = buildCoopRewardDayKey(now);
    const weekKey = buildCoopRewardWeekKey(now);
    await tx.coopRewardCapCounter.upsert({
      where: {
        userId_source_dayKey: {
          userId: input.userId,
          source: input.source,
          dayKey,
        },
      },
      create: {
        userId: input.userId,
        characterId: input.characterId,
        source: input.source,
        dayKey,
        weekKey,
        claimCount: 1,
        rewardValueApprox: input.rewardValueApprox,
      },
      update: {
        claimCount: { increment: 1 },
        rewardValueApprox: { increment: input.rewardValueApprox },
        // weekKey stable per (userId, source, dayKey) — không update.
        characterId: input.characterId,
      },
    });
  }

  /**
   * Ghi anomaly `COOP_REWARD_CAP_HIT` khi cap reject. KHÔNG throw — chỉ
   * best-effort write. Window-based dedup qua UNIQUE
   * `(type, characterId, windowKey)` trong DB schema.
   */
  async auditCapBypassAttempt(input: {
    userId: string;
    characterId: string;
    source: CoopRewardSource;
    code: 'DAILY_CAP_REACHED' | 'WEEKLY_CAP_REACHED' | 'INVALID_SOURCE';
    dailyClaims: number;
    weeklyClaims: number;
    now?: Date;
  }): Promise<void> {
    try {
      const now = input.now ?? new Date();
      const windowKey = `1h:${now.toISOString().slice(0, 13)}`;
      await this.prisma.gameplayAnomaly.create({
        data: {
          type: 'COOP_REWARD_CAP_HIT',
          source: 'COOP_REWARD',
          severity: 'WARN',
          characterId: input.characterId,
          userId: input.userId,
          windowKey,
          detailsJson: {
            source: input.source,
            code: input.code,
            dailyClaims: input.dailyClaims,
            weeklyClaims: input.weeklyClaims,
          } as Prisma.InputJsonValue,
          status: 'OPEN',
        },
      });
    } catch (e) {
      this.logger.debug(`auditCapBypassAttempt skip: ${(e as Error).message}`);
    }
  }

  // ---------------------------------------------------------------------------
  // Leech risk classify
  // ---------------------------------------------------------------------------

  /**
   * Classify leech risk cho 1 member sau khi run resolved. Audit
   * `COOP_LEECH_HIGH` nếu tier=HIGH. Return downgraded reward tier.
   *
   * Caller (CoopBossService.finishRun) tự dùng kết quả để override
   * `rewardTier` trước khi tạo `CoopBossRewardClaim`.
   */
  async classifyAndAuditLeechRisk<
    T extends 'NONE' | 'LOW' | 'NORMAL' | 'HIGH' | 'MVP',
  >(input: {
    userId: string;
    characterId: string;
    contributionScore: number;
    survivalSeconds: number;
    actionCount: number;
    originalTier: T;
    source: CoopRewardSource;
    now?: Date;
  }): Promise<{ tier: T; leechRisk: CoopLeechRiskLevel }> {
    const leechRisk = classifyCoopLeechRisk({
      contributionScore: input.contributionScore,
      survivalSeconds: input.survivalSeconds,
      actionCount: input.actionCount,
    });
    const tier = applyLeechRiskDowngrade<T>({
      tier: input.originalTier,
      leechRisk,
    });
    if (leechRisk === 'HIGH') {
      try {
        const now = input.now ?? new Date();
        const windowKey = `24h:${buildCoopRewardDayKey(now)}`;
        await this.prisma.gameplayAnomaly.create({
          data: {
            type: 'COOP_LEECH_HIGH',
            source: 'COOP_REWARD',
            severity: 'WARN',
            characterId: input.characterId,
            userId: input.userId,
            windowKey,
            detailsJson: {
              source: input.source,
              contributionScore: input.contributionScore,
              survivalSeconds: input.survivalSeconds,
              actionCount: input.actionCount,
              originalTier: input.originalTier,
              downgradedTier: tier,
            } as Prisma.InputJsonValue,
            status: 'OPEN',
          },
        });
      } catch (e) {
        this.logger.debug(
          `classifyAndAuditLeechRisk anomaly skip: ${(e as Error).message}`,
        );
      }
    }
    return { tier, leechRisk };
  }

  // ---------------------------------------------------------------------------
  // Weekly contribution record
  // ---------------------------------------------------------------------------

  /**
   * Find-or-create season ACTIVE cho tuần hiện tại (deterministic
   * weekKey). Race-safe qua UNIQUE weekKey + upsert.
   */
  async ensureCurrentSeason(now?: Date): Promise<CoopWeeklySeasonDto> {
    const n = now ?? new Date();
    const weekKey = buildCoopRewardWeekKey(n);
    const startsAt = buildWeekStartDate(weekKey);
    const endsAt = buildWeekEndDate(weekKey);
    const row = await this.prisma.coopWeeklyContributionSeason.upsert({
      where: { weekKey },
      create: {
        weekKey,
        startsAt,
        endsAt,
        status: PrismaCoopWeeklySeasonStatus.ACTIVE,
      },
      update: {},
    });
    return this.toSeasonDto(row);
  }

  /**
   * Upsert `CoopWeeklyContributionEntry` cộng dồn points cho 1 user
   * trong season hiện tại. Gọi từ:
   *   - `CoopBossService.finishRun` cho mỗi eligible participant với
   *     `bossContributionScore` + `isMvp` snapshot.
   *   - `PartyDungeonService.claimReward` cho mỗi member CLEARED với
   *     `dungeonContributionScore`.
   *
   * `dungeonContributionScore` ở foundation chưa có (Phase 20.1 không
   * track contribution per-member) — caller pass 0 cho `bossOnly`
   * record. Phase 20.3+ có thể wire dungeon contribution.
   */
  async recordWeeklyContribution(input: {
    userId: string;
    characterId: string;
    bossContributionScore: number;
    dungeonContributionScore: number;
    isMvp: boolean;
    now?: Date;
  }): Promise<{ totalPoints: number; seasonId: string }> {
    const season = await this.ensureCurrentSeason(input.now);
    const delta = computeWeeklyContributionPoints({
      bossContributionScore: input.bossContributionScore,
      dungeonContributionScore: input.dungeonContributionScore,
      isMvp: input.isMvp,
    });
    const row = await this.prisma.coopWeeklyContributionEntry.upsert({
      where: {
        seasonId_userId: { seasonId: season.id, userId: input.userId },
      },
      create: {
        seasonId: season.id,
        userId: input.userId,
        characterId: input.characterId,
        bossContributionPoints: input.bossContributionScore,
        dungeonContributionPoints: input.dungeonContributionScore,
        totalPoints: delta,
      },
      update: {
        bossContributionPoints: {
          increment: input.bossContributionScore,
        },
        dungeonContributionPoints: {
          increment: input.dungeonContributionScore,
        },
        totalPoints: { increment: delta },
        characterId: input.characterId,
      },
    });
    return { totalPoints: row.totalPoints, seasonId: row.seasonId };
  }

  // ---------------------------------------------------------------------------
  // Leaderboard query
  // ---------------------------------------------------------------------------

  /**
   * Get weekly leaderboard cho season chỉ định (hoặc current ACTIVE
   * nếu không truyền `weekKey`). Filter rank IS NOT NULL ưu tiên
   * (settled). Nếu chưa settle, sort theo `totalPoints` DESC + assign
   * rank tạm thời (preview).
   */
  async getWeeklyLeaderboard(input?: {
    weekKey?: string;
    limit?: number;
  }): Promise<CoopWeeklyLeaderboardResponse> {
    const weekKey = input?.weekKey ?? buildCoopRewardWeekKey(new Date());
    const limit = Math.min(Math.max(input?.limit ?? 50, 1), 200);
    const season = await this.prisma.coopWeeklyContributionSeason.findUnique({
      where: { weekKey },
    });
    if (!season) {
      return { seasonId: '', weekKey, entries: [], total: 0 };
    }
    const rows = await this.prisma.coopWeeklyContributionEntry.findMany({
      where: { seasonId: season.id },
      orderBy: [{ totalPoints: 'desc' }, { updatedAt: 'asc' }],
      take: limit,
    });
    const total = await this.prisma.coopWeeklyContributionEntry.count({
      where: { seasonId: season.id },
    });
    // Preview rank if not settled (deterministic by query order).
    const entries: CoopWeeklyLeaderboardEntryDto[] = rows.map((r, idx) => {
      const previewRank = r.rank ?? idx + 1;
      const previewTier =
        r.rewardTier ??
        classifyWeeklyRewardTier({
          rank: r.totalPoints >= COOP_REWARD_CAP_LIMITS.minPointsForRank
            ? previewRank
            : null,
          totalPoints: r.totalPoints,
        });
      return {
        seasonId: r.seasonId,
        userId: r.userId,
        characterId: r.characterId,
        displayName: null,
        bossContributionPoints: r.bossContributionPoints,
        dungeonContributionPoints: r.dungeonContributionPoints,
        totalPoints: r.totalPoints,
        rank: r.rank ?? previewRank,
        rewardTier: isCoopWeeklyRewardTier(previewTier)
          ? previewTier
          : null,
      };
    });
    return { seasonId: season.id, weekKey, entries, total };
  }

  // ---------------------------------------------------------------------------
  // Settle season
  // ---------------------------------------------------------------------------

  /**
   * Settle 1 season: rank entries theo `totalPoints` DESC + map tier +
   * tạo `CoopWeeklyRewardClaim` PENDING cho mỗi entry tier ≠ NONE.
   *
   * Idempotent: chỉ chạy nếu `status='ACTIVE'` hoặc `'CLOSED'`. Nếu
   * `SETTLED` → throw `SEASON_ALREADY_SETTLED`.
   *
   * Wrapped trong $transaction để rank snapshot consistent. KHÔNG
   * grant reward (claim mới grant qua `claimWeeklyReward`).
   */
  async settleWeeklySeason(input: {
    seasonId: string;
    actorUserId: string;
  }): Promise<{ rankedEntries: number; claimRows: number }> {
    const season = await this.prisma.coopWeeklyContributionSeason.findUnique({
      where: { id: input.seasonId },
    });
    if (!season) {
      throw new CoopCapError('SEASON_NOT_FOUND');
    }
    if (season.status === PrismaCoopWeeklySeasonStatus.SETTLED) {
      throw new CoopCapError('SEASON_ALREADY_SETTLED');
    }
    return this.prisma.$transaction(async (tx) => {
      const entries = await tx.coopWeeklyContributionEntry.findMany({
        where: { seasonId: input.seasonId },
        orderBy: [{ totalPoints: 'desc' }, { updatedAt: 'asc' }],
      });
      let rankedEntries = 0;
      let claimRows = 0;
      for (let i = 0; i < entries.length; i++) {
        const e = entries[i];
        const rank =
          e.totalPoints >= COOP_REWARD_CAP_LIMITS.minPointsForRank
            ? i + 1
            : null;
        const tier = classifyWeeklyRewardTier({
          rank,
          totalPoints: e.totalPoints,
        });
        await tx.coopWeeklyContributionEntry.update({
          where: { id: e.id },
          data: { rank, rewardTier: tier },
        });
        rankedEntries += 1;
        if (tier === 'NONE') continue;
        const reward = computeWeeklyReward(tier);
        await tx.coopWeeklyRewardClaim.create({
          data: {
            seasonId: input.seasonId,
            userId: e.userId,
            characterId: e.characterId,
            rewardTier: tier,
            rewardJson: reward as unknown as Prisma.InputJsonValue,
            status: PrismaCoopWeeklyRewardClaimStatus.PENDING,
          },
        });
        claimRows += 1;
      }
      await tx.coopWeeklyContributionSeason.update({
        where: { id: input.seasonId },
        data: {
          status: PrismaCoopWeeklySeasonStatus.SETTLED,
          settledAt: new Date(),
          settledByAdminId: input.actorUserId,
        },
      });
      return { rankedEntries, claimRows };
    });
  }

  // ---------------------------------------------------------------------------
  // Claim weekly reward
  // ---------------------------------------------------------------------------

  /**
   * Member claim weekly reward. Atomic CAS `PENDING→CLAIMED` + ledger
   * grant qua `CurrencyService.applyTx` (reason `COOP_WEEKLY_REWARD`).
   *
   * KHÔNG cap check ở đây (weekly reward là separate flow, không cộng
   * vào daily/weekly cap counter của boss/dungeon).
   */
  async claimWeeklyReward(input: {
    userId: string;
    seasonId: string;
  }): Promise<CoopWeeklyRewardClaimDto> {
    const season = await this.prisma.coopWeeklyContributionSeason.findUnique({
      where: { id: input.seasonId },
    });
    if (!season) throw new CoopCapError('SEASON_NOT_FOUND');
    if (season.status !== PrismaCoopWeeklySeasonStatus.SETTLED) {
      throw new CoopCapError('SEASON_NOT_SETTLED');
    }
    const claim = await this.prisma.coopWeeklyRewardClaim.findUnique({
      where: {
        seasonId_userId: { seasonId: input.seasonId, userId: input.userId },
      },
    });
    if (!claim) throw new CoopCapError('REWARD_NOT_FOUND');
    const gate = canClaimCoopWeeklyReward({
      seasonStatus: season.status as CoopWeeklySeasonStatus,
      rewardTier: claim.rewardTier as CoopWeeklyRewardTier,
      rewardStatus: claim.status as
        | 'PENDING'
        | 'CLAIMED'
        | 'SKIPPED'
        | 'FAILED',
    });
    if (!gate.ok) {
      if (gate.code === 'ALREADY_CLAIMED') {
        throw new CoopCapError('REWARD_ALREADY_CLAIMED');
      }
      if (gate.code === 'SKIPPED') throw new CoopCapError('REWARD_SKIPPED');
      if (gate.code === 'TIER_NONE') {
        throw new CoopCapError('REWARD_TIER_NONE');
      }
      throw new CoopCapError('SEASON_NOT_SETTLED');
    }
    const reward = claim.rewardJson as unknown as {
      linhThach?: number;
      exp?: number;
    };
    const refId = buildCoopWeeklyRewardRefId({
      seasonId: claim.seasonId,
      characterId: claim.characterId,
    });
    await this.prisma.$transaction(async (tx) => {
      const upd = await tx.coopWeeklyRewardClaim.updateMany({
        where: {
          id: claim.id,
          status: PrismaCoopWeeklyRewardClaimStatus.PENDING,
        },
        data: {
          status: PrismaCoopWeeklyRewardClaimStatus.CLAIMED,
          claimedAt: new Date(),
        },
      });
      if (upd.count === 0) {
        throw new CoopCapError('REWARD_ALREADY_CLAIMED');
      }
      if (reward.linhThach && reward.linhThach > 0) {
        await this.currency.applyTx(tx, {
          characterId: claim.characterId,
          currency: CurrencyKind.LINH_THACH,
          delta: BigInt(reward.linhThach),
          reason: 'COOP_WEEKLY_REWARD',
          refType: 'CoopWeeklyRewardClaim',
          refId,
          actorUserId: claim.userId,
        });
      }
      if (reward.exp && reward.exp > 0) {
        await tx.character.update({
          where: { id: claim.characterId },
          data: { exp: { increment: reward.exp } },
        });
      }
    });
    const updated = await this.prisma.coopWeeklyRewardClaim.findUnique({
      where: { id: claim.id },
    });
    if (!updated) throw new CoopCapError('REWARD_NOT_FOUND');
    return this.toRewardClaimDto(updated);
  }

  // ---------------------------------------------------------------------------
  // Status query
  // ---------------------------------------------------------------------------

  /**
   * Get reward status hiện tại của 1 user (cap usage + weekly points
   * + claim status). Phục vụ `GET /coop/rewards/status` UI panel.
   */
  async getMyCoopRewardStatus(input: {
    userId: string;
    characterId: string;
    now?: Date;
  }): Promise<CoopRewardStatusDto> {
    const now = input.now ?? new Date();
    const dayKey = buildCoopRewardDayKey(now);
    const weekKey = buildCoopRewardWeekKey(now);
    const [bossDaily, dungeonDaily, bossWeek, dungeonWeek, season] =
      await Promise.all([
        this.prisma.coopRewardCapCounter.findUnique({
          where: {
            userId_source_dayKey: {
              userId: input.userId,
              source: 'COOP_BOSS',
              dayKey,
            },
          },
          select: { claimCount: true },
        }),
        this.prisma.coopRewardCapCounter.findUnique({
          where: {
            userId_source_dayKey: {
              userId: input.userId,
              source: 'PARTY_DUNGEON',
              dayKey,
            },
          },
          select: { claimCount: true },
        }),
        this.prisma.coopRewardCapCounter.aggregate({
          where: { userId: input.userId, source: 'COOP_BOSS', weekKey },
          _sum: { claimCount: true },
        }),
        this.prisma.coopRewardCapCounter.aggregate({
          where: { userId: input.userId, source: 'PARTY_DUNGEON', weekKey },
          _sum: { claimCount: true },
        }),
        this.prisma.coopWeeklyContributionSeason.findUnique({
          where: { weekKey },
        }),
      ]);
    let weeklyPoints = 0;
    let weeklyRank: number | null = null;
    let weeklyRewardTier: CoopWeeklyRewardTier | null = null;
    let weeklyClaimStatus: CoopWeeklyRewardClaimDto['status'] | null = null;
    let currentSeasonId: string | null = null;
    if (season) {
      currentSeasonId = season.id;
      const entry = await this.prisma.coopWeeklyContributionEntry.findUnique({
        where: {
          seasonId_userId: { seasonId: season.id, userId: input.userId },
        },
      });
      if (entry) {
        weeklyPoints = entry.totalPoints;
        weeklyRank = entry.rank;
        weeklyRewardTier = isCoopWeeklyRewardTier(entry.rewardTier)
          ? entry.rewardTier
          : null;
      }
      const claim = await this.prisma.coopWeeklyRewardClaim.findUnique({
        where: {
          seasonId_userId: { seasonId: season.id, userId: input.userId },
        },
        select: { status: true, rewardTier: true },
      });
      if (claim) {
        weeklyClaimStatus = claim.status as CoopWeeklyRewardClaimDto['status'];
        if (isCoopWeeklyRewardTier(claim.rewardTier)) {
          weeklyRewardTier = claim.rewardTier;
        }
      }
    }
    return {
      userId: input.userId,
      characterId: input.characterId,
      dayKey,
      weekKey,
      boss: {
        dailyUsed: bossDaily?.claimCount ?? 0,
        dailyLimit: COOP_REWARD_CAP_LIMITS.maxBossClaimsPerDay,
        weeklyUsed: bossWeek._sum.claimCount ?? 0,
        weeklyLimit: COOP_REWARD_CAP_LIMITS.maxBossClaimsPerWeek,
      },
      dungeon: {
        dailyUsed: dungeonDaily?.claimCount ?? 0,
        dailyLimit: COOP_REWARD_CAP_LIMITS.maxDungeonClaimsPerDay,
        weeklyUsed: dungeonWeek._sum.claimCount ?? 0,
        weeklyLimit: COOP_REWARD_CAP_LIMITS.maxDungeonClaimsPerWeek,
      },
      currentSeasonId,
      weeklyPoints,
      weeklyRank,
      weeklyRewardTier,
      weeklyClaimStatus,
    };
  }

  // ---------------------------------------------------------------------------
  // Admin
  // ---------------------------------------------------------------------------

  /**
   * Admin summary: current season + counters 24h + cap bypass / leech
   * count 24h + settled seasons count.
   */
  async getAdminSummary(now?: Date): Promise<{
    currentSeason: CoopWeeklySeasonDto | null;
    activeCapCounters24h: number;
    capExceededAttempts24h: number;
    highLeechCount24h: number;
    settledSeasons: number;
  }> {
    const n = now ?? new Date();
    const dayKey = buildCoopRewardDayKey(n);
    const weekKey = buildCoopRewardWeekKey(n);
    const since = new Date(n.getTime() - 24 * 60 * 60 * 1000);
    const [season, counters, capHits, leech, settled] = await Promise.all([
      this.prisma.coopWeeklyContributionSeason.findUnique({
        where: { weekKey },
      }),
      this.prisma.coopRewardCapCounter.count({
        where: { dayKey },
      }),
      this.prisma.gameplayAnomaly.count({
        where: { type: 'COOP_REWARD_CAP_HIT', createdAt: { gte: since } },
      }),
      this.prisma.gameplayAnomaly.count({
        where: { type: 'COOP_LEECH_HIGH', createdAt: { gte: since } },
      }),
      this.prisma.coopWeeklyContributionSeason.count({
        where: { status: PrismaCoopWeeklySeasonStatus.SETTLED },
      }),
    ]);
    return {
      currentSeason: season ? this.toSeasonDto(season) : null,
      activeCapCounters24h: counters,
      capExceededAttempts24h: capHits,
      highLeechCount24h: leech,
      settledSeasons: settled,
    };
  }

  /**
   * Admin list season — pagination + filter by status.
   */
  async listSeasons(input: {
    limit?: number;
    status?: CoopWeeklySeasonStatus;
  }): Promise<{ entries: CoopWeeklySeasonDto[]; total: number }> {
    const limit = Math.min(Math.max(input.limit ?? 50, 1), 200);
    const where: Prisma.CoopWeeklyContributionSeasonWhereInput = {};
    if (input.status) {
      where.status = input.status as PrismaCoopWeeklySeasonStatus;
    }
    const [rows, total] = await Promise.all([
      this.prisma.coopWeeklyContributionSeason.findMany({
        where,
        orderBy: { startsAt: 'desc' },
        take: limit,
      }),
      this.prisma.coopWeeklyContributionSeason.count({ where }),
    ]);
    return { entries: rows.map((r) => this.toSeasonDto(r)), total };
  }

  /**
   * Admin list cap counters cho điều tra abuse.
   */
  async listCapCounters(input: {
    userId?: string;
    source?: CoopRewardSource;
    dayKey?: string;
    weekKey?: string;
    limit?: number;
  }): Promise<{ entries: CoopRewardCapCounterDto[]; total: number }> {
    const limit = Math.min(Math.max(input.limit ?? 50, 1), 200);
    const where: Prisma.CoopRewardCapCounterWhereInput = {};
    if (input.userId) where.userId = input.userId;
    if (input.source) where.source = input.source;
    if (input.dayKey) where.dayKey = input.dayKey;
    if (input.weekKey) where.weekKey = input.weekKey;
    const [rows, total] = await Promise.all([
      this.prisma.coopRewardCapCounter.findMany({
        where,
        orderBy: { updatedAt: 'desc' },
        take: limit,
      }),
      this.prisma.coopRewardCapCounter.count({ where }),
    ]);
    return {
      entries: rows.map((r) => this.toCapCounterDto(r)),
      total,
    };
  }

  // ---------------------------------------------------------------------------
  // DTO mappers
  // ---------------------------------------------------------------------------

  private toSeasonDto(row: {
    id: string;
    weekKey: string;
    startsAt: Date;
    endsAt: Date;
    status: PrismaCoopWeeklySeasonStatus;
    createdAt: Date;
    settledAt: Date | null;
  }): CoopWeeklySeasonDto {
    return {
      id: row.id,
      weekKey: row.weekKey,
      startsAt: row.startsAt.toISOString(),
      endsAt: row.endsAt.toISOString(),
      status: row.status as CoopWeeklySeasonStatus,
      createdAt: row.createdAt.toISOString(),
      settledAt: row.settledAt ? row.settledAt.toISOString() : null,
    };
  }

  private toRewardClaimDto(row: {
    id: string;
    seasonId: string;
    userId: string;
    characterId: string;
    rewardTier: string;
    rewardJson: Prisma.JsonValue;
    status: PrismaCoopWeeklyRewardClaimStatus;
    claimedAt: Date | null;
    createdAt: Date;
  }): CoopWeeklyRewardClaimDto {
    return {
      id: row.id,
      seasonId: row.seasonId,
      userId: row.userId,
      characterId: row.characterId,
      rewardTier: isCoopWeeklyRewardTier(row.rewardTier)
        ? row.rewardTier
        : 'NONE',
      rewardJson: (row.rewardJson as { linhThach?: number; exp?: number }) ?? {},
      status: row.status as CoopWeeklyRewardClaimDto['status'],
      claimedAt: row.claimedAt ? row.claimedAt.toISOString() : null,
      createdAt: row.createdAt.toISOString(),
    };
  }

  private toCapCounterDto(row: {
    id: string;
    userId: string;
    characterId: string;
    source: string;
    dayKey: string;
    weekKey: string;
    claimCount: number;
    rewardValueApprox: bigint;
    updatedAt: Date;
  }): CoopRewardCapCounterDto {
    return {
      id: row.id,
      userId: row.userId,
      characterId: row.characterId,
      source: isCoopRewardSource(row.source) ? row.source : 'COOP_BOSS',
      dayKey: row.dayKey,
      weekKey: row.weekKey,
      claimCount: row.claimCount,
      rewardValueApprox: Number(row.rewardValueApprox),
      updatedAt: row.updatedAt.toISOString(),
    };
  }
}

// Re-export to keep API stable.
export { COOP_WEEKLY_BASE_REWARD };
