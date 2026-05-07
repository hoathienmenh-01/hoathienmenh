import { Injectable, Optional } from '@nestjs/common';
import { CurrencyKind, Prisma } from '@prisma/client';
import {
  SECT_WAR_ACTIVITIES,
  SECT_WAR_REWARD_TIERS,
  currentSectWarSeason,
  sectWarActivityByKey,
  sectWarRewardTierForRank,
  sectWarWeekKey,
  type SectWarActivityDef,
  type SectWarActivityKey,
  type SectWarLeaderboardRow,
  type SectWarRewardTierDef,
  type SectWarRewardTierKey,
  type SectWarSeasonDef,
  type SectWarSourceType,
} from '@xuantoi/shared';
import { PrismaService } from '../../common/prisma.service';
import { CurrencyService } from '../character/currency.service';

/**
 * Phase 13.1.A — Sect War (Tông Môn Chiến) tuần lễ runtime service.
 *
 * Server-authoritative invariants:
 *   - {@link addContributionTx} là entry point duy nhất cho mọi gameplay
 *     hook (dungeon claim, boss reward, daily login, quest claim). Caller
 *     truyền `tx` vì side-effect ghi điểm phải atomic với gameplay flow
 *     parent (ledger / claim / etc.). Nếu character không thuộc sect →
 *     no-op (skip safely). FE KHÔNG tự cộng điểm.
 *   - Idempotency qua composite UNIQUE
 *     `(weekKey, characterId, activityKey, sourceType, sourceId)`. Cùng
 *     entity (vd cùng dungeonRunId) gọi nhiều lần chỉ ghi 1 row → P2002
 *     swallow. Caller hooks không cần extra try/catch idempotent.
 *   - Cap enforcement (daily/weekly) compute TRƯỚC khi insert: query
 *     existing sum cho character + activity + cửa sổ → reject nếu vượt
 *     cap. Cap reject KHÔNG raise error — chỉ log + return null (no-op,
 *     gameplay flow vẫn thành công).
 *   - {@link claimWeeklyReward} race-safe qua UNIQUE `(weekKey, characterId)`.
 *     Catch P2002 → throw `SECT_WAR_ALREADY_CLAIMED`.
 *
 * Reward grant Phase 13.1.A: chỉ linhThach + tienNgoc qua
 * `CurrencyService.applyTx(reason='SECT_WAR_REWARD', refType='SectWar', refId=
 * weekKey)`. Title/buff/item placeholder catalog — KHÔNG implement runtime
 * grant trong PR này (xem `SectWarRewardGrant` shared docs).
 */

export type SectWarErrorCode =
  | 'NO_CHARACTER'
  | 'SECT_REQUIRED'
  | 'SECT_WAR_NOT_CLAIMABLE'
  | 'SECT_WAR_ALREADY_CLAIMED'
  | 'SECT_WAR_NO_REWARD';

export class SectWarError extends Error {
  readonly code: SectWarErrorCode;
  constructor(code: SectWarErrorCode, message?: string) {
    super(message ?? code);
    this.name = 'SectWarError';
    this.code = code;
  }
}

export interface SectWarMyStatusView {
  weekKey: string;
  hasSect: boolean;
  sectId: string | null;
  sectName: string | null;
  /** Tổng điểm cá nhân tuần hiện tại. */
  personalPoints: number;
  /** Breakdown theo activityKey: tổng điểm. */
  breakdown: ReadonlyArray<{
    activityKey: SectWarActivityKey;
    points: number;
    count: number;
  }>;
  /** Sect rank của user trong tuần (null nếu không có sect / sect chưa có điểm). */
  sectRank: number | null;
  /** Tổng điểm Sect (null nếu không có sect / chưa có điểm). */
  sectPoints: number | null;
  /** Reward tier user sẽ nhận nếu claim ngay bây giờ (null = không eligible). */
  eligibleTierKey: SectWarRewardTierKey | null;
  /** True nếu user đã claim reward tuần hiện tại. */
  alreadyClaimed: boolean;
  /** True nếu user có thể claim ngay (eligible + chưa claim). */
  canClaim: boolean;
}

export interface SectWarCurrentView {
  weekKey: string;
  season: SectWarSeasonDef;
  activities: ReadonlyArray<SectWarActivityDef>;
  rewardTiers: ReadonlyArray<SectWarRewardTierDef>;
  leaderboard: ReadonlyArray<SectWarLeaderboardRow>;
  me: SectWarMyStatusView;
}

export interface SectWarClaimResult {
  weekKey: string;
  rewardTierKey: SectWarRewardTierKey;
  granted: {
    linhThach: number;
    tienNgoc: number;
  };
  sectRank: number;
  personalPoints: number;
}

const LEADERBOARD_TOP = 10;

/** Phase 13.1.A — Reward reason cho ledger audit trail. */
const REWARD_REASON = 'SECT_WAR_REWARD';
const REWARD_REF_TYPE = 'SectWarWeeklyRewardClaim';

@Injectable()
export class SectWarService {
  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly currency?: CurrencyService,
  ) {}

  // ────────────────────────────────────────────────────────────────────
  // Contribution hook (server-authoritative entry point)
  // ────────────────────────────────────────────────────────────────────

  /**
   * Tx-aware: ghi 1 contribution row trong cùng transaction với gameplay
   * flow parent. Idempotent qua composite UNIQUE — caller có thể retry an
   * toàn (vd boss reward replay, dungeon claim retry).
   *
   * Trả về `null` nếu:
   *   - Character không có sect (skip, không log).
   *   - Activity key không hợp lệ.
   *   - Cap reached (daily/weekly).
   *   - Source idempotency hit (P2002 swallow).
   *
   * KHÔNG throw — gameplay flow phải continue dù sect war ghi điểm fail.
   */
  async addContributionTx(
    tx: Prisma.TransactionClient,
    params: {
      characterId: string;
      activityKey: SectWarActivityKey;
      sourceId: string | null;
      now?: Date;
    },
  ): Promise<{ weekKey: string; sectId: string; points: number } | null> {
    const def = sectWarActivityByKey(params.activityKey);
    if (!def) return null;
    const char = await tx.character.findUnique({
      where: { id: params.characterId },
      select: { id: true, sectId: true },
    });
    if (!char || !char.sectId) return null;

    const now = params.now ?? new Date();
    const weekKey = sectWarWeekKey(now);
    const sectId = char.sectId;

    // Cap check: query SUM của characterId + activityKey trong window.
    if (def.weeklyCap !== undefined && def.weeklyCap > 0) {
      const agg = await tx.sectWarContribution.aggregate({
        where: {
          weekKey,
          characterId: char.id,
          activityKey: def.key,
        },
        _sum: { points: true },
      });
      const used = agg._sum.points ?? 0;
      if (used + def.points > def.weeklyCap) return null;
    }
    if (def.dailyCap !== undefined && def.dailyCap > 0) {
      // Daily window: same calendar day local TZ. Dùng `createdAt` filter
      // theo UTC midnight diff (heuristic — cùng ngày trong vi-VN, có thể
      // off ±1h nhưng cap bảo thủ).
      const dayStart = new Date(now);
      dayStart.setUTCHours(0, 0, 0, 0);
      const agg = await tx.sectWarContribution.aggregate({
        where: {
          weekKey,
          characterId: char.id,
          activityKey: def.key,
          createdAt: { gte: dayStart },
        },
        _sum: { points: true },
      });
      const used = agg._sum.points ?? 0;
      if (used + def.points > def.dailyCap) return null;
    }

    try {
      await tx.sectWarContribution.create({
        data: {
          weekKey,
          sectId,
          characterId: char.id,
          activityKey: def.key,
          sourceType: def.sourceType as SectWarSourceType,
          sourceId: params.sourceId,
          points: def.points,
        },
      });
      return { weekKey, sectId, points: def.points };
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        // Duplicate (weekKey, characterId, activityKey, sourceType, sourceId)
        // → already credited. Idempotent.
        return null;
      }
      throw e;
    }
  }

  // ────────────────────────────────────────────────────────────────────
  // Read APIs
  // ────────────────────────────────────────────────────────────────────

  /** Aggregate leaderboard top N sect cho weekKey. */
  async getLeaderboard(
    weekKey?: string,
    now: Date = new Date(),
  ): Promise<{ weekKey: string; rows: SectWarLeaderboardRow[] }> {
    const wk = weekKey ?? sectWarWeekKey(now);
    const grouped = await this.prisma.sectWarContribution.groupBy({
      by: ['sectId'],
      where: { weekKey: wk },
      _sum: { points: true },
      _count: { _all: true },
    });
    grouped.sort(
      (a, b) => (b._sum.points ?? 0) - (a._sum.points ?? 0) || a.sectId.localeCompare(b.sectId),
    );
    const top = grouped.slice(0, LEADERBOARD_TOP);
    if (top.length === 0) return { weekKey: wk, rows: [] };
    const sects = await this.prisma.sect.findMany({
      where: { id: { in: top.map((g) => g.sectId) } },
      select: { id: true, name: true },
    });
    const nameMap = new Map(sects.map((s) => [s.id, s.name]));
    // Distinct contributors per sect.
    const contribCounts = await this.prisma.sectWarContribution.groupBy({
      by: ['sectId', 'characterId'],
      where: { weekKey: wk, sectId: { in: top.map((g) => g.sectId) } },
    });
    const contribByS = new Map<string, number>();
    for (const r of contribCounts) {
      contribByS.set(r.sectId, (contribByS.get(r.sectId) ?? 0) + 1);
    }
    const rows: SectWarLeaderboardRow[] = top.map((g, i) => ({
      rank: i + 1,
      sectId: g.sectId,
      sectName: nameMap.get(g.sectId) ?? g.sectId,
      points: g._sum.points ?? 0,
      contributors: contribByS.get(g.sectId) ?? 0,
    }));
    return { weekKey: wk, rows };
  }

  /**
   * Compute rank của sectId trong weekKey (1-based). Trả `null` nếu sect
   * không có row contribution nào tuần đó. Rank xác định bằng tổng điểm
   * descending, tie-break bằng sectId asc.
   */
  private async getSectRankAndPoints(
    weekKey: string,
    sectId: string,
  ): Promise<{ rank: number; points: number } | null> {
    const grouped = await this.prisma.sectWarContribution.groupBy({
      by: ['sectId'],
      where: { weekKey },
      _sum: { points: true },
    });
    grouped.sort(
      (a, b) => (b._sum.points ?? 0) - (a._sum.points ?? 0) || a.sectId.localeCompare(b.sectId),
    );
    const idx = grouped.findIndex((g) => g.sectId === sectId);
    if (idx === -1) return null;
    return { rank: idx + 1, points: grouped[idx]._sum.points ?? 0 };
  }

  /** My personal status cho weekKey (default = current). */
  async getMyStatus(
    userId: string,
    now: Date = new Date(),
    weekKeyOverride?: string,
  ): Promise<SectWarMyStatusView> {
    const char = await this.prisma.character.findUnique({
      where: { userId },
      select: { id: true, sectId: true },
    });
    if (!char) throw new SectWarError('NO_CHARACTER');
    const weekKey = weekKeyOverride ?? sectWarWeekKey(now);

    let sectName: string | null = null;
    if (char.sectId) {
      const s = await this.prisma.sect.findUnique({
        where: { id: char.sectId },
        select: { name: true },
      });
      sectName = s?.name ?? null;
    }

    const breakdownRows = await this.prisma.sectWarContribution.groupBy({
      by: ['activityKey'],
      where: { weekKey, characterId: char.id },
      _sum: { points: true },
      _count: { _all: true },
    });
    const breakdown = breakdownRows.map((r) => ({
      activityKey: r.activityKey as SectWarActivityKey,
      points: r._sum.points ?? 0,
      count: r._count._all,
    }));
    const personalPoints = breakdown.reduce((a, b) => a + b.points, 0);

    let sectRank: number | null = null;
    let sectPoints: number | null = null;
    if (char.sectId) {
      const sr = await this.getSectRankAndPoints(weekKey, char.sectId);
      if (sr) {
        sectRank = sr.rank;
        sectPoints = sr.points;
      }
    }

    const tier =
      sectRank !== null
        ? sectWarRewardTierForRank(sectRank, personalPoints) ?? null
        : null;
    const eligibleTierKey = tier?.key ?? null;

    const claim = await this.prisma.sectWarWeeklyRewardClaim.findUnique({
      where: { weekKey_characterId: { weekKey, characterId: char.id } },
      select: { id: true },
    });
    const alreadyClaimed = !!claim;
    const canClaim = !!char.sectId && !alreadyClaimed && eligibleTierKey !== null;

    return {
      weekKey,
      hasSect: !!char.sectId,
      sectId: char.sectId,
      sectName,
      personalPoints,
      breakdown,
      sectRank,
      sectPoints,
      eligibleTierKey,
      alreadyClaimed,
      canClaim,
    };
  }

  /** State tổng hợp cho `/sect-war/current`. */
  async getCurrent(userId: string, now: Date = new Date()): Promise<SectWarCurrentView> {
    const season = currentSectWarSeason(now);
    const lb = await this.getLeaderboard(season.weekKey, now);
    const me = await this.getMyStatus(userId, now, season.weekKey);
    return {
      weekKey: season.weekKey,
      season,
      activities: SECT_WAR_ACTIVITIES,
      rewardTiers: SECT_WAR_REWARD_TIERS,
      leaderboard: lb.rows,
      me,
    };
  }

  // ────────────────────────────────────────────────────────────────────
  // Claim weekly reward
  // ────────────────────────────────────────────────────────────────────

  /**
   * Claim weekly reward.
   *
   * Race-safe qua UNIQUE `(weekKey, characterId)`. Reward grant atomic
   * trong tx với insert claim row — nếu currency.applyTx fail thì rollback.
   *
   * Throws:
   *   - NO_CHARACTER: user không có character.
   *   - SECT_REQUIRED: character không thuộc sect.
   *   - SECT_WAR_NO_REWARD: rank/points không match tier nào.
   *   - SECT_WAR_NOT_CLAIMABLE: tổng quát (sect không có points / etc).
   *   - SECT_WAR_ALREADY_CLAIMED: P2002 hoặc race lose.
   */
  async claimWeeklyReward(
    userId: string,
    now: Date = new Date(),
  ): Promise<SectWarClaimResult> {
    const char = await this.prisma.character.findUnique({
      where: { userId },
      select: { id: true, sectId: true },
    });
    if (!char) throw new SectWarError('NO_CHARACTER');
    if (!char.sectId) throw new SectWarError('SECT_REQUIRED');

    const weekKey = sectWarWeekKey(now);

    // Pre-check (cheap path) — heavy compute in tx.
    const existing = await this.prisma.sectWarWeeklyRewardClaim.findUnique({
      where: { weekKey_characterId: { weekKey, characterId: char.id } },
      select: { id: true },
    });
    if (existing) throw new SectWarError('SECT_WAR_ALREADY_CLAIMED');

    const sr = await this.getSectRankAndPoints(weekKey, char.sectId);
    if (!sr) throw new SectWarError('SECT_WAR_NOT_CLAIMABLE');

    const personalAgg = await this.prisma.sectWarContribution.aggregate({
      where: { weekKey, characterId: char.id },
      _sum: { points: true },
    });
    const personalPoints = personalAgg._sum.points ?? 0;

    const tier = sectWarRewardTierForRank(sr.rank, personalPoints);
    if (!tier) throw new SectWarError('SECT_WAR_NO_REWARD');

    const linhThach = tier.reward.linhThach ?? 0;
    const tienNgoc = tier.reward.tienNgoc ?? 0;

    try {
      await this.prisma.$transaction(async (tx) => {
        // INSERT trước — P2002 sẽ rollback toàn bộ tx.
        await tx.sectWarWeeklyRewardClaim.create({
          data: {
            weekKey,
            sectId: char.sectId!,
            characterId: char.id,
            rewardTierKey: tier.key,
            pointsAtClaim: personalPoints,
            sectRankAtClaim: sr.rank,
            sectPointsAtClaim: sr.points,
          },
        });
        if (linhThach > 0 && this.currency) {
          await this.currency.applyTx(tx, {
            characterId: char.id,
            currency: CurrencyKind.LINH_THACH,
            delta: BigInt(linhThach),
            reason: REWARD_REASON,
            refType: REWARD_REF_TYPE,
            refId: weekKey,
            meta: {
              tier: tier.key,
              rank: sr.rank,
              personalPoints,
              sectPoints: sr.points,
            },
          });
        }
        if (tienNgoc > 0 && this.currency) {
          await this.currency.applyTx(tx, {
            characterId: char.id,
            currency: CurrencyKind.TIEN_NGOC,
            delta: BigInt(tienNgoc),
            reason: REWARD_REASON,
            refType: REWARD_REF_TYPE,
            refId: weekKey,
            meta: {
              tier: tier.key,
              rank: sr.rank,
              personalPoints,
              sectPoints: sr.points,
            },
          });
        }
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new SectWarError('SECT_WAR_ALREADY_CLAIMED');
      }
      throw e;
    }

    return {
      weekKey,
      rewardTierKey: tier.key,
      granted: { linhThach, tienNgoc },
      sectRank: sr.rank,
      personalPoints,
    };
  }
}
