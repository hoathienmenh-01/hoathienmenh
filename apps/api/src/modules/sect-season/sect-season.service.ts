import { Injectable } from '@nestjs/common';
import {
  SECT_SEASONS,
  SECT_SEASON_MILESTONES,
  currentSectSeason,
  sectSeasonAchievedMilestones,
  sectSeasonByKey,
  sectSeasonNextMilestone,
  sectSeasonWeekKeys,
  type SectSeasonDef,
  type SectSeasonLeaderboardRow,
  type SectSeasonLeaderboardView,
  type SectSeasonMilestoneDef,
  type SectSeasonMyStatusView,
} from '@xuantoi/shared';
import { PrismaService } from '../../common/prisma.service';

/**
 * Phase 13.2.A — Sect Season (Mùa Tông Môn) read-only aggregation service.
 *
 * Read-only invariants:
 *   - KHÔNG ghi DB. KHÔNG mutate `SectWarContribution`. KHÔNG grant reward.
 *     Phase 13.2.A chỉ aggregate `SectWarContribution` qua nhiều tuần
 *     (default 4) → derive season points / leaderboard / milestone progress.
 *   - Server-authoritative compute: season window (startsAt/endsAt) đến từ
 *     shared catalog `SECT_SEASONS`. FE KHÔNG self-derive milestone status.
 *   - Aggregation key: `weekKey IN (sectSeasonWeekKeys(season))`. Stable
 *     dù row insert trễ (vd boss claim retry sang tuần sau, weekKey row giữ
 *     nguyên theo `createdAt` lúc tx) — chính xác hơn `createdAt BETWEEN ...`.
 *   - Leaderboard top N (10) — sort points DESC, tie-break sectId ASC để
 *     deterministic. Re-rank dùng index 0-based + 1.
 *
 * Out-of-scope (Phase 13.2.B+):
 *   - Season reward claim runtime (CurrencyService grant + ledger row).
 *     Phase 13.2.A chỉ trả `achievedMilestoneKeys` để FE preview — chưa có
 *     button claim, chưa có table audit.
 *   - Season cron rollover (snapshot cuối season → archive). Phase 13.2.A
 *     read live mỗi request — OK ở scale hiện tại; sau này nếu nặng có thể
 *     cache 5-15 phút.
 *   - Custom milestone per-season. Hiện tại mọi season share `SECT_SEASON_MILESTONES`.
 */

export interface SectSeasonCurrentView {
  /** seasonKey hiện hành — null nếu `now` ngoài catalog. */
  readonly seasonKey: string | null;
  /** Season def — null nếu ngoài catalog. */
  readonly season: SectSeasonDef | null;
  /** Common milestone catalog — gửi catalog snapshot để FE không phụ thuộc shared. */
  readonly milestones: ReadonlyArray<SectSeasonMilestoneDef>;
  /** Top N sect leaderboard cho season hiện tại (rỗng nếu không trong season). */
  readonly leaderboard: ReadonlyArray<SectSeasonLeaderboardRow>;
  /** My personal season status — null nếu không trong season. */
  readonly me: SectSeasonMyStatusView | null;
}

export type SectSeasonErrorCode = 'NO_CHARACTER' | 'SEASON_NOT_FOUND';

export class SectSeasonError extends Error {
  readonly code: SectSeasonErrorCode;
  constructor(code: SectSeasonErrorCode, message?: string) {
    super(message ?? code);
    this.name = 'SectSeasonError';
    this.code = code;
  }
}

const LEADERBOARD_TOP = 10;

@Injectable()
export class SectSeasonService {
  constructor(private readonly prisma: PrismaService) {}

  // ────────────────────────────────────────────────────────────────────
  // Resolve helpers
  // ────────────────────────────────────────────────────────────────────

  /**
   * Resolve season cho query: nếu `seasonKey` truyền vào → lookup catalog;
   * nếu null → dùng `currentSectSeason(now)`. Return `null` nếu không tìm thấy
   * (caller render fallback "out of season" thay vì throw).
   */
  resolveSeason(seasonKey: string | undefined, now: Date = new Date()): SectSeasonDef | null {
    if (seasonKey) {
      return sectSeasonByKey(seasonKey) ?? null;
    }
    return currentSectSeason(now) ?? null;
  }

  // ────────────────────────────────────────────────────────────────────
  // Read APIs
  // ────────────────────────────────────────────────────────────────────

  /**
   * Aggregate leaderboard top N sect cho season.
   *
   * Trả `rows: []` nếu season không có row contribution nào (vd season
   * tương lai chưa khởi động, hoặc season ngoài catalog).
   */
  async getLeaderboard(
    seasonKeyOrUndefined?: string,
    now: Date = new Date(),
  ): Promise<SectSeasonLeaderboardView> {
    const season = this.resolveSeason(seasonKeyOrUndefined, now);
    if (!season) {
      return { seasonKey: seasonKeyOrUndefined ?? '', rows: [] };
    }
    const weekKeys = sectSeasonWeekKeys(season);
    const grouped = await this.prisma.sectWarContribution.groupBy({
      by: ['sectId'],
      where: { weekKey: { in: weekKeys } },
      _sum: { points: true },
    });
    grouped.sort(
      (a, b) =>
        (b._sum.points ?? 0) - (a._sum.points ?? 0) || a.sectId.localeCompare(b.sectId),
    );
    const top = grouped.slice(0, LEADERBOARD_TOP);
    if (top.length === 0) return { seasonKey: season.key, rows: [] };

    const sects = await this.prisma.sect.findMany({
      where: { id: { in: top.map((g) => g.sectId) } },
      select: { id: true, name: true },
    });
    const nameMap = new Map(sects.map((s) => [s.id, s.name]));

    // Distinct contributors per sect.
    const contribCounts = await this.prisma.sectWarContribution.groupBy({
      by: ['sectId', 'characterId'],
      where: { weekKey: { in: weekKeys }, sectId: { in: top.map((g) => g.sectId) } },
    });
    const contribByS = new Map<string, number>();
    for (const r of contribCounts) {
      contribByS.set(r.sectId, (contribByS.get(r.sectId) ?? 0) + 1);
    }

    // Distinct weeks contributed per sect.
    const weekRows = await this.prisma.sectWarContribution.groupBy({
      by: ['sectId', 'weekKey'],
      where: { weekKey: { in: weekKeys }, sectId: { in: top.map((g) => g.sectId) } },
    });
    const weeksByS = new Map<string, number>();
    for (const r of weekRows) {
      weeksByS.set(r.sectId, (weeksByS.get(r.sectId) ?? 0) + 1);
    }

    const rows: SectSeasonLeaderboardRow[] = top.map((g, i) => ({
      rank: i + 1,
      sectId: g.sectId,
      sectName: nameMap.get(g.sectId) ?? g.sectId,
      points: g._sum.points ?? 0,
      contributors: contribByS.get(g.sectId) ?? 0,
      weeksContributed: weeksByS.get(g.sectId) ?? 0,
    }));
    return { seasonKey: season.key, rows };
  }

  /**
   * Compute personal season status cho `userId`.
   *
   * Trả achievement/next milestone derive từ `personalPoints`. Nếu
   * character không có sect → `hasSect=false` (vẫn render personal points
   * = 0 vì contribution row require sectId).
   *
   * Throws `NO_CHARACTER` nếu user không có character.
   */
  async getMyStatus(
    userId: string,
    seasonKeyOrUndefined?: string,
    now: Date = new Date(),
  ): Promise<SectSeasonMyStatusView | null> {
    const season = this.resolveSeason(seasonKeyOrUndefined, now);
    if (!season) return null;

    const char = await this.prisma.character.findUnique({
      where: { userId },
      select: { id: true, sectId: true },
    });
    if (!char) throw new SectSeasonError('NO_CHARACTER');

    const weekKeys = sectSeasonWeekKeys(season);

    const agg = await this.prisma.sectWarContribution.aggregate({
      where: { weekKey: { in: weekKeys }, characterId: char.id },
      _sum: { points: true },
    });
    const personalPoints = agg._sum.points ?? 0;

    const weekRows = await this.prisma.sectWarContribution.groupBy({
      by: ['weekKey'],
      where: { weekKey: { in: weekKeys }, characterId: char.id },
    });
    const weeksContributed = weekRows.length;

    let sectName: string | null = null;
    if (char.sectId) {
      const s = await this.prisma.sect.findUnique({
        where: { id: char.sectId },
        select: { name: true },
      });
      sectName = s?.name ?? null;
    }

    const achieved = sectSeasonAchievedMilestones(personalPoints);
    const next = sectSeasonNextMilestone(personalPoints);

    return {
      seasonKey: season.key,
      hasSect: !!char.sectId,
      sectId: char.sectId,
      sectName,
      personalPoints,
      weeksContributed,
      achievedMilestoneKeys: achieved.map((m) => m.key),
      nextMilestoneKey: next?.key ?? null,
    };
  }

  /**
   * Compose state cho `GET /sect-season/current`. Trả `seasonKey=null` nếu
   * `now` ngoài catalog (FE render fallback "no active season").
   */
  async getCurrent(userId: string, now: Date = new Date()): Promise<SectSeasonCurrentView> {
    const season = currentSectSeason(now) ?? null;
    if (!season) {
      return {
        seasonKey: null,
        season: null,
        milestones: SECT_SEASON_MILESTONES,
        leaderboard: [],
        me: null,
      };
    }
    const lb = await this.getLeaderboard(season.key, now);
    const me = await this.getMyStatus(userId, season.key, now);
    return {
      seasonKey: season.key,
      season,
      milestones: SECT_SEASON_MILESTONES,
      leaderboard: lb.rows,
      me,
    };
  }

  /**
   * List toàn bộ season catalog — debug/admin preview helper. KHÔNG gọi DB.
   */
  listSeasons(): ReadonlyArray<SectSeasonDef> {
    return SECT_SEASONS;
  }
}
