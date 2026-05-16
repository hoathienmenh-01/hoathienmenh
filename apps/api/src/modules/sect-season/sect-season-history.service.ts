import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  SECT_SEASON_CHAMPION_MEMBER_CAP,
  SECT_SEASON_TOP_MEMBERS,
  sectSeasonByKey,
  sectSeasonWeekKeys,
  type SectHallOfFameMemberEntry,
  type SectHallOfFameSectEntry,
  type SectHallOfFameView,
  type SectSeasonDef,
  type SectSeasonHistoryListView,
  type SectSeasonHistoryMemberEntry,
  type SectSeasonHistorySectEntry,
  type SectSeasonHistorySummary,
  type SectSeasonHistoryView,
} from '@xuantoi/shared';
import { PrismaService } from '../../common/prisma.service';

/**
 * Phase 13.2.C — Sect Season History + Hall of Fame service.
 *
 * Responsibility:
 *   - Snapshot 1 season đã chốt từ live `SectWarContribution` aggregation
 *     vào 3 bảng persisted: `SectSeasonSnapshot` + `SectSeasonSectRank` +
 *     `SectSeasonTopMember`. Idempotent qua `seasonKey` PRIMARY KEY.
 *   - Read history list (`listHistory`) + detail per season (`getHistory`).
 *   - Aggregate Hall of Fame (`getHallOfFame`) từ `SectSeasonSectRank` +
 *     `SectSeasonTopMember` cộng dồn qua mọi season đã chốt.
 *
 * Idempotency contract:
 *   - `snapshotSeason(seasonKey)` lần đầu → INSERT thành công.
 *   - Lần thứ 2 cùng seasonKey → return existing snapshot (no-op).
 *   - Race-safe qua UNIQUE PRIMARY KEY `seasonKey` + try/catch P2002 trong
 *     tx — concurrent caller cùng seasonKey chỉ 1 thắng, lần lose return
 *     existing.
 *   - KHÔNG re-aggregate / re-rank khi snapshot đã tồn tại — đây là
 *     "freeze final result" semantic, không phải "always recompute".
 *
 * Out-of-scope (Phase 13.2.D+):
 *   - Reward grant từ snapshot (champion title, mvp buff, etc.).
 *   - Cron auto-snapshot khi season kết thúc — Phase 13.2.C để admin/dev
 *     trigger thủ công qua endpoint hoặc test fixture.
 *   - Per-season custom milestone snapshot — hiện tại chỉ snapshot
 *     leaderboard + top members, không snapshot milestone state per
 *     character (volume O(N_chars), không cần cho UX history).
 */

export type SectSeasonHistoryErrorCode =
  | 'SEASON_NOT_FOUND'
  | 'SEASON_NOT_ENDED'
  | 'SNAPSHOT_NOT_FOUND'
  | 'CHAMPION_SNAPSHOT_NOT_FOUND';

/**
 * Phase 15.8 — Champion membership snapshot detail dùng cho admin
 * inspect / audit. Trả `memberCharacterIds` đầy đủ + denormalized
 * `memberCount` để cross-check với reward grant rows.
 *
 * Empty (`memberCharacterIds=[]`) khi season chốt nhưng champion sect
 * không có member nào tại finalize time — KHÔNG phải lỗi, chỉ là
 * edge case (vd sect bị disband ngay trước boundary).
 */
export interface SectSeasonChampionSnapshotDetail {
  readonly seasonKey: string;
  readonly sectId: string;
  readonly rank: number;
  readonly memberCount: number;
  readonly memberCharacterIds: ReadonlyArray<string>;
  readonly createdAt: string;
}

/**
 * Phase 15.8 — Per-season summary cho Admin Hall of Fame view. Mở
 * rộng public summary với:
 *   - `rewardStatus`: số CHAMPION/MVP grant đã chốt + thời điểm grant
 *     gần nhất (đọc từ `SectSeasonRewardGrant`). Admin dùng để phát
 *     hiện season finalize xong nhưng reward grant chưa chạy.
 *   - `championSnapshot`: meta (sectId + memberCount) của bản
 *     champion membership snapshot (`SectSeasonChampionSnapshot`).
 *     `null` cho legacy season pre-15.8 (chưa có snapshot row).
 *
 * KHÔNG expose `memberCharacterIds` — admin muốn full list phải gọi
 * riêng `GET /admin/sect-season/:seasonKey/champion-snapshot`.
 */
export interface AdminSectSeasonRewardStatus {
  readonly championGrants: number;
  readonly mvpGrants: number;
  readonly lastChampionGrantAt: string | null;
  readonly lastMvpGrantAt: string | null;
}

export interface AdminSectSeasonChampionSnapshotMeta {
  readonly sectId: string;
  readonly rank: number;
  readonly memberCount: number;
  readonly createdAt: string;
}

export interface AdminSectSeasonSummary {
  readonly seasonKey: string;
  readonly finalizedAt: string;
  readonly totalSects: number;
  readonly totalContributors: number;
  readonly totalPoints: number;
  readonly champion: SectSeasonHistorySectEntry | null;
  readonly mvp: SectSeasonHistoryMemberEntry | null;
  readonly rewardStatus: AdminSectSeasonRewardStatus;
  readonly championSnapshot: AdminSectSeasonChampionSnapshotMeta | null;
}

export interface AdminSectSeasonHallOfFameView {
  readonly checkedAt: string;
  readonly seasons: ReadonlyArray<AdminSectSeasonSummary>;
  readonly hallOfFame: SectHallOfFameView;
}

export class SectSeasonHistoryError extends Error {
  readonly code: SectSeasonHistoryErrorCode;
  constructor(code: SectSeasonHistoryErrorCode, message?: string) {
    super(message ?? code);
    this.name = 'SectSeasonHistoryError';
    this.code = code;
  }
}

/**
 * Số sect được snapshot top per season — match Sect War / Sect Season
 * leaderboard top 10 để FE hiển thị nhất quán.
 */
const SNAPSHOT_TOP_SECTS = 10;

/**
 * Số character được snapshot top per season — re-export shared constant
 * để runtime + shared cùng giá trị (10).
 */
const SNAPSHOT_TOP_MEMBERS = SECT_SEASON_TOP_MEMBERS;

interface AggregatedSnapshot {
  readonly totalSects: number;
  readonly totalContributors: number;
  readonly totalPoints: number;
  readonly sects: ReadonlyArray<SectSeasonHistorySectEntry>;
  readonly topMembers: ReadonlyArray<SectSeasonHistoryMemberEntry>;
}

@Injectable()
export class SectSeasonHistoryService {
  constructor(private readonly prisma: PrismaService) {}

  // ────────────────────────────────────────────────────────────────────
  // Snapshot creation (idempotent)
  // ────────────────────────────────────────────────────────────────────

  /**
   * Snapshot 1 season vào persistent tables. Idempotent: lần thứ 2 cùng
   * `seasonKey` return existing detail không re-aggregate.
   *
   * Default chỉ cho phép snapshot season đã kết thúc (`endsAt <= now`) —
   * tránh chốt sớm khi season đang chạy. `options.allowOngoing` (dev/test
   * harness) bypass check này; KHÔNG set true ở production caller.
   *
   * Throws:
   *   - `SEASON_NOT_FOUND`: `seasonKey` không có trong shared catalog.
   *   - `SEASON_NOT_ENDED`: season chưa kết thúc và `allowOngoing=false`.
   */
  async snapshotSeason(
    seasonKey: string,
    options: { now?: Date; allowOngoing?: boolean } = {},
  ): Promise<SectSeasonHistoryView> {
    const season = sectSeasonByKey(seasonKey);
    if (!season) {
      throw new SectSeasonHistoryError('SEASON_NOT_FOUND');
    }
    const now = options.now ?? new Date();
    if (!options.allowOngoing) {
      const endsAt = new Date(season.endsAtIso).getTime();
      if (endsAt > now.getTime()) {
        throw new SectSeasonHistoryError('SEASON_NOT_ENDED');
      }
    }

    // Fast path: snapshot đã tồn tại → return existing detail.
    const existing = await this.prisma.sectSeasonSnapshot.findUnique({
      where: { seasonKey },
    });
    if (existing) {
      return this.readSnapshotDetail(seasonKey);
    }

    const aggregated = await this.aggregateForSnapshot(season);

    // Insert tx — UNIQUE seasonKey enforce no double snapshot. Nếu race
    // mất (P2002) → lose, return snapshot do leader đã tạo.
    // Phase 15.8 — Champion membership snapshot (read OUTSIDE tx để
    // tránh long-running query trong write tx). Snapshot lấy member
    // ID của champion sect tại finalize time, deterministic order
    // `characterId ASC`, cap {@link SECT_SEASON_CHAMPION_MEMBER_CAP}.
    const champion = aggregated.sects[0] ?? null;
    const championMemberIds: string[] = champion
      ? (
          await this.prisma.character.findMany({
            where: { sectId: champion.sectId },
            select: { id: true },
            orderBy: { id: 'asc' },
            take: SECT_SEASON_CHAMPION_MEMBER_CAP,
          })
        ).map((c) => c.id)
      : [];

    try {
      await this.prisma.$transaction(async (tx) => {
        const mvp = aggregated.topMembers[0] ?? null;
        await tx.sectSeasonSnapshot.create({
          data: {
            seasonKey,
            finalizedAt: now,
            totalSects: aggregated.totalSects,
            totalContributors: aggregated.totalContributors,
            totalPoints: aggregated.totalPoints,
            championSectId: champion?.sectId ?? null,
            championSectName: champion?.sectName ?? null,
            championPoints: champion?.points ?? null,
            mvpCharacterId: mvp?.characterId ?? null,
            mvpCharacterName: mvp?.characterName ?? null,
            mvpSectId: mvp?.sectId ?? null,
            mvpSectName: mvp?.sectName ?? null,
            mvpPoints: mvp?.points ?? null,
          },
        });
        if (aggregated.sects.length > 0) {
          await tx.sectSeasonSectRank.createMany({
            data: aggregated.sects.map((r) => ({
              seasonKey,
              sectId: r.sectId,
              sectName: r.sectName,
              rank: r.rank,
              points: r.points,
              contributors: r.contributors,
              weeksContributed: r.weeksContributed,
            })),
          });
        }
        if (aggregated.topMembers.length > 0) {
          await tx.sectSeasonTopMember.createMany({
            data: aggregated.topMembers.map((m) => ({
              seasonKey,
              characterId: m.characterId,
              characterName: m.characterName,
              sectId: m.sectId,
              sectName: m.sectName,
              rank: m.rank,
              points: m.points,
            })),
          });
        }
        if (champion) {
          // Phase 15.8 — ghi champion membership snapshot. Idempotent
          // qua UNIQUE `(seasonKey, sectId, rank)` + try/catch P2002
          // ngoài tx (cron retry không duplicate row).
          await tx.sectSeasonChampionSnapshot.create({
            data: {
              seasonKey,
              sectId: champion.sectId,
              rank: 1,
              memberCharacterIdsJson:
                championMemberIds as unknown as Prisma.InputJsonValue,
              memberCount: championMemberIds.length,
            },
          });
        }
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        // Race lose: leader đã tạo snapshot xong → fall through để read.
      } else {
        throw e;
      }
    }

    return this.readSnapshotDetail(seasonKey);
  }

  // ────────────────────────────────────────────────────────────────────
  // Read APIs
  // ────────────────────────────────────────────────────────────────────

  /**
   * Liệt kê toàn bộ season đã chốt (newest first) với summary
   * (champion + mvp denormalized). KHÔNG fetch full leaderboard — để
   * detail view (`getHistory`) trả về.
   *
   * Trả `seasons: []` nếu chưa có snapshot nào (empty state UX).
   */
  async listHistory(): Promise<SectSeasonHistoryListView> {
    const rows = await this.prisma.sectSeasonSnapshot.findMany({
      orderBy: { finalizedAt: 'desc' },
    });
    const seasons: SectSeasonHistorySummary[] = rows.map((r) => {
      const champion: SectSeasonHistorySectEntry | null =
        r.championSectId && r.championSectName !== null && r.championPoints !== null
          ? {
              rank: 1,
              sectId: r.championSectId,
              sectName: r.championSectName,
              points: r.championPoints,
              // List summary chỉ cần champion identity — chi tiết
              // contributors/weeksContributed có trong detail view.
              contributors: 0,
              weeksContributed: 0,
            }
          : null;
      const mvp: SectSeasonHistoryMemberEntry | null =
        r.mvpCharacterId && r.mvpCharacterName !== null && r.mvpPoints !== null
          ? {
              rank: 1,
              characterId: r.mvpCharacterId,
              characterName: r.mvpCharacterName,
              sectId: r.mvpSectId,
              sectName: r.mvpSectName,
              points: r.mvpPoints,
            }
          : null;
      return {
        seasonKey: r.seasonKey,
        finalizedAt: r.finalizedAt.toISOString(),
        totalSects: r.totalSects,
        totalContributors: r.totalContributors,
        totalPoints: r.totalPoints,
        champion,
        mvp,
      };
    });
    return { seasons };
  }

  /**
   * Detail 1 season đã chốt: full top-N sect + top-N cá nhân. Throws
   * `SNAPSHOT_NOT_FOUND` nếu chưa snapshot.
   */
  async getHistory(seasonKey: string): Promise<SectSeasonHistoryView> {
    return this.readSnapshotDetail(seasonKey);
  }

  /**
   * Aggregate Hall of Fame: tổng hợp championship/mvp/podium qua mọi
   * season đã chốt. KHÔNG đụng `SectWarContribution` — chỉ aggregate
   * `SectSeasonSectRank` + `SectSeasonTopMember` (đã top-N per season,
   * volume bounded).
   *
   * Trả empty arrays nếu chưa có snapshot nào.
   */
  async getHallOfFame(): Promise<SectHallOfFameView> {
    const [snapshotCount, sectRanks, memberRanks] = await Promise.all([
      this.prisma.sectSeasonSnapshot.count(),
      this.prisma.sectSeasonSectRank.findMany({}),
      this.prisma.sectSeasonTopMember.findMany({}),
    ]);

    const sectAgg = new Map<
      string,
      {
        sectId: string;
        sectName: string;
        championships: number;
        podiums: number;
        appearances: number;
        bestRank: number;
        totalPoints: number;
        latestSeasonKey: string;
      }
    >();
    for (const r of sectRanks) {
      const cur = sectAgg.get(r.sectId);
      if (cur) {
        cur.championships += r.rank === 1 ? 1 : 0;
        cur.podiums += r.rank <= 3 ? 1 : 0;
        cur.appearances += 1;
        cur.bestRank = Math.min(cur.bestRank, r.rank);
        cur.totalPoints += r.points;
        // Snapshot order không deterministic theo seasonKey lexical, nên
        // pick theo so sánh string asc → newer key (vd `season_2027_*`)
        // win. SECT_SEASONS catalog order theo niên đại.
        if (r.seasonKey > cur.latestSeasonKey) {
          cur.latestSeasonKey = r.seasonKey;
          cur.sectName = r.sectName;
        }
      } else {
        sectAgg.set(r.sectId, {
          sectId: r.sectId,
          sectName: r.sectName,
          championships: r.rank === 1 ? 1 : 0,
          podiums: r.rank <= 3 ? 1 : 0,
          appearances: 1,
          bestRank: r.rank,
          totalPoints: r.points,
          latestSeasonKey: r.seasonKey,
        });
      }
    }
    const sects: SectHallOfFameSectEntry[] = Array.from(sectAgg.values()).sort(
      (a, b) =>
        b.championships - a.championships ||
        b.podiums - a.podiums ||
        b.totalPoints - a.totalPoints ||
        a.sectName.localeCompare(b.sectName),
    );

    const memberAgg = new Map<
      string,
      {
        characterId: string;
        characterName: string;
        mvps: number;
        podiums: number;
        appearances: number;
        bestRank: number;
        totalPoints: number;
        latestSeasonKey: string;
        latestSectName: string | null;
      }
    >();
    for (const m of memberRanks) {
      const cur = memberAgg.get(m.characterId);
      if (cur) {
        cur.mvps += m.rank === 1 ? 1 : 0;
        cur.podiums += m.rank <= 3 ? 1 : 0;
        cur.appearances += 1;
        cur.bestRank = Math.min(cur.bestRank, m.rank);
        cur.totalPoints += m.points;
        if (m.seasonKey > cur.latestSeasonKey) {
          cur.latestSeasonKey = m.seasonKey;
          cur.characterName = m.characterName;
          cur.latestSectName = m.sectName;
        }
      } else {
        memberAgg.set(m.characterId, {
          characterId: m.characterId,
          characterName: m.characterName,
          mvps: m.rank === 1 ? 1 : 0,
          podiums: m.rank <= 3 ? 1 : 0,
          appearances: 1,
          bestRank: m.rank,
          totalPoints: m.points,
          latestSeasonKey: m.seasonKey,
          latestSectName: m.sectName,
        });
      }
    }
    const members: SectHallOfFameMemberEntry[] = Array.from(memberAgg.values()).sort(
      (a, b) =>
        b.mvps - a.mvps ||
        b.podiums - a.podiums ||
        b.totalPoints - a.totalPoints ||
        a.characterName.localeCompare(b.characterName),
    );

    return {
      sects,
      members,
      totalSeasonsFinalized: snapshotCount,
    };
  }

  /**
   * Phase 15.8 — Admin Hall of Fame view. Tổng hợp:
   *   - Per-season summary (champion sect, MVP, totals, finalizedAt)
   *   - Reward grant stats (số CHAMPION/MVP đã grant + thời điểm grant
   *     gần nhất) đọc từ `SectSeasonRewardGrant`.
   *   - Champion membership snapshot meta (`sectId`, `memberCount`).
   *   - Aggregate Hall of Fame qua mọi season (reuse `getHallOfFame`).
   *
   * Read-only. Volume bounded bởi số season đã finalize × top-N. Không
   * expose `memberCharacterIds` (admin gọi riêng `getChampionSnapshot`).
   */
  async getAdminHallOfFame(now: Date = new Date()): Promise<AdminSectSeasonHallOfFameView> {
    const [snapshots, grantStats, championSnapshots, hallOfFame] = await Promise.all([
      this.prisma.sectSeasonSnapshot.findMany({
        orderBy: { finalizedAt: 'desc' },
      }),
      this.prisma.sectSeasonRewardGrant.groupBy({
        by: ['seasonKey', 'rewardType'],
        _count: { _all: true },
        _max: { grantedAt: true },
      }),
      this.prisma.sectSeasonChampionSnapshot.findMany({
        where: { rank: 1 },
        select: {
          seasonKey: true,
          sectId: true,
          rank: true,
          memberCount: true,
          createdAt: true,
        },
      }),
      this.getHallOfFame(),
    ]);

    const grantByKey = new Map<string, { count: number; lastAt: Date | null }>();
    for (const g of grantStats) {
      grantByKey.set(`${g.seasonKey}::${g.rewardType}`, {
        count: g._count._all,
        lastAt: g._max.grantedAt ?? null,
      });
    }
    const championSnapshotByKey = new Map<
      string,
      { sectId: string; rank: number; memberCount: number; createdAt: Date }
    >();
    for (const cs of championSnapshots) {
      championSnapshotByKey.set(cs.seasonKey, cs);
    }

    const seasons: AdminSectSeasonSummary[] = snapshots.map((r) => {
      const champion: SectSeasonHistorySectEntry | null = r.championSectId
        ? {
            rank: 1,
            sectId: r.championSectId,
            sectName: r.championSectName ?? r.championSectId,
            points: r.championPoints ?? 0,
            // Header-level summary KHÔNG có `contributors`/`weeksContributed`
            // (chỉ có ở SectSeasonSectRank rows). Admin muốn full chi tiết
            // gọi `GET /admin/sect-season/:seasonKey/history`.
            contributors: 0,
            weeksContributed: 0,
          }
        : null;
      const mvp: SectSeasonHistoryMemberEntry | null =
        r.mvpCharacterId && r.mvpCharacterName !== null && r.mvpPoints !== null
          ? {
              rank: 1,
              characterId: r.mvpCharacterId,
              characterName: r.mvpCharacterName,
              sectId: r.mvpSectId,
              sectName: r.mvpSectName,
              points: r.mvpPoints,
            }
          : null;
      const championGrant = grantByKey.get(`${r.seasonKey}::CHAMPION`);
      const mvpGrant = grantByKey.get(`${r.seasonKey}::MVP`);
      const cs = championSnapshotByKey.get(r.seasonKey);
      return {
        seasonKey: r.seasonKey,
        finalizedAt: r.finalizedAt.toISOString(),
        totalSects: r.totalSects,
        totalContributors: r.totalContributors,
        totalPoints: r.totalPoints,
        champion,
        mvp,
        rewardStatus: {
          championGrants: championGrant?.count ?? 0,
          mvpGrants: mvpGrant?.count ?? 0,
          lastChampionGrantAt: championGrant?.lastAt
            ? championGrant.lastAt.toISOString()
            : null,
          lastMvpGrantAt: mvpGrant?.lastAt ? mvpGrant.lastAt.toISOString() : null,
        },
        championSnapshot: cs
          ? {
              sectId: cs.sectId,
              rank: cs.rank,
              memberCount: cs.memberCount,
              createdAt: cs.createdAt.toISOString(),
            }
          : null,
      };
    });

    return {
      checkedAt: now.toISOString(),
      seasons,
      hallOfFame,
    };
  }

  /**
   * Phase 15.8 — Admin inspect champion membership snapshot cho 1 season.
   *
   * Trả về danh sách `characterId` đã được snapshot tại lúc settlement —
   * dùng để audit "ai được nhận reward champion" (deterministic, không
   * phụ thuộc current sect membership).
   *
   * Throws:
   *   - `CHAMPION_SNAPSHOT_NOT_FOUND`: season chưa có snapshot rank 1
   *     (vd legacy pre-15.8, hoặc season chưa chốt).
   */
  async getChampionSnapshot(
    seasonKey: string,
  ): Promise<SectSeasonChampionSnapshotDetail> {
    // Phase 15.8 mặc định mỗi season 1 row rank=1 → findFirst đủ.
    // Composite UNIQUE `(seasonKey, sectId, rank)` đảm bảo idempotent,
    // findFirst với `seasonKey + rank: 1` trả về row duy nhất.
    const snapshot = await this.prisma.sectSeasonChampionSnapshot.findFirst({
      where: { seasonKey, rank: 1 },
      select: {
        seasonKey: true,
        sectId: true,
        rank: true,
        memberCount: true,
        memberCharacterIdsJson: true,
        createdAt: true,
      },
    });
    if (!snapshot) {
      throw new SectSeasonHistoryError('CHAMPION_SNAPSHOT_NOT_FOUND');
    }
    const raw = snapshot.memberCharacterIdsJson;
    const memberCharacterIds: string[] = Array.isArray(raw)
      ? raw.filter((v): v is string => typeof v === 'string')
      : [];
    return {
      seasonKey: snapshot.seasonKey,
      sectId: snapshot.sectId,
      rank: snapshot.rank,
      memberCount: snapshot.memberCount,
      memberCharacterIds,
      createdAt: snapshot.createdAt.toISOString(),
    };
  }

  // ────────────────────────────────────────────────────────────────────
  // Internals
  // ────────────────────────────────────────────────────────────────────

  private async readSnapshotDetail(seasonKey: string): Promise<SectSeasonHistoryView> {
    const [header, sectRows, memberRows] = await Promise.all([
      this.prisma.sectSeasonSnapshot.findUnique({ where: { seasonKey } }),
      this.prisma.sectSeasonSectRank.findMany({
        where: { seasonKey },
        orderBy: { rank: 'asc' },
      }),
      this.prisma.sectSeasonTopMember.findMany({
        where: { seasonKey },
        orderBy: { rank: 'asc' },
      }),
    ]);
    if (!header) {
      throw new SectSeasonHistoryError('SNAPSHOT_NOT_FOUND');
    }
    const sects: SectSeasonHistorySectEntry[] = sectRows.map((r) => ({
      rank: r.rank,
      sectId: r.sectId,
      sectName: r.sectName,
      points: r.points,
      contributors: r.contributors,
      weeksContributed: r.weeksContributed,
    }));
    const topMembers: SectSeasonHistoryMemberEntry[] = memberRows.map((m) => ({
      rank: m.rank,
      characterId: m.characterId,
      characterName: m.characterName,
      sectId: m.sectId,
      sectName: m.sectName,
      points: m.points,
    }));
    return {
      seasonKey: header.seasonKey,
      finalizedAt: header.finalizedAt.toISOString(),
      totalSects: header.totalSects,
      totalContributors: header.totalContributors,
      totalPoints: header.totalPoints,
      sects,
      topMembers,
    };
  }

  /**
   * Aggregate live `SectWarContribution` của season → top sect leaderboard
   * (full N) + top members (full N) + totals. Caller `snapshotSeason` ghi
   * kết quả vào persistent tables.
   *
   * Sort tie-break:
   *   - Sect: points desc → sectId asc (deterministic).
   *   - Member: points desc → characterId asc (deterministic).
   */
  private async aggregateForSnapshot(season: SectSeasonDef): Promise<AggregatedSnapshot> {
    const weekKeys = sectSeasonWeekKeys(season);

    const sectGrouped = await this.prisma.sectWarContribution.groupBy({
      by: ['sectId'],
      where: { weekKey: { in: weekKeys } },
      _sum: { points: true },
    });
    sectGrouped.sort(
      (a, b) =>
        (b._sum.points ?? 0) - (a._sum.points ?? 0) || a.sectId.localeCompare(b.sectId),
    );
    const totalSects = sectGrouped.length;
    const totalPoints = sectGrouped.reduce((acc, g) => acc + (g._sum.points ?? 0), 0);
    const topSects = sectGrouped.slice(0, SNAPSHOT_TOP_SECTS);

    const memberGrouped = await this.prisma.sectWarContribution.groupBy({
      by: ['characterId'],
      where: { weekKey: { in: weekKeys } },
      _sum: { points: true },
    });
    memberGrouped.sort(
      (a, b) =>
        (b._sum.points ?? 0) - (a._sum.points ?? 0) ||
        a.characterId.localeCompare(b.characterId),
    );
    const totalContributors = memberGrouped.length;
    const topMembersRaw = memberGrouped.slice(0, SNAPSHOT_TOP_MEMBERS);

    if (topSects.length === 0 && topMembersRaw.length === 0) {
      return {
        totalSects: 0,
        totalContributors: 0,
        totalPoints: 0,
        sects: [],
        topMembers: [],
      };
    }

    // Resolve sect names cho top sect rows.
    const sects = await this.prisma.sect.findMany({
      where: { id: { in: topSects.map((g) => g.sectId) } },
      select: { id: true, name: true },
    });
    const sectNameMap = new Map(sects.map((s) => [s.id, s.name]));

    // Distinct contributors per sect.
    const contribCounts = await this.prisma.sectWarContribution.groupBy({
      by: ['sectId', 'characterId'],
      where: { weekKey: { in: weekKeys }, sectId: { in: topSects.map((g) => g.sectId) } },
    });
    const contribByS = new Map<string, number>();
    for (const r of contribCounts) {
      contribByS.set(r.sectId, (contribByS.get(r.sectId) ?? 0) + 1);
    }

    // Distinct weeks contributed per sect.
    const weekRows = await this.prisma.sectWarContribution.groupBy({
      by: ['sectId', 'weekKey'],
      where: { weekKey: { in: weekKeys }, sectId: { in: topSects.map((g) => g.sectId) } },
    });
    const weeksByS = new Map<string, number>();
    for (const r of weekRows) {
      weeksByS.set(r.sectId, (weeksByS.get(r.sectId) ?? 0) + 1);
    }

    const sectsResult: SectSeasonHistorySectEntry[] = topSects.map((g, i) => ({
      rank: i + 1,
      sectId: g.sectId,
      sectName: sectNameMap.get(g.sectId) ?? g.sectId,
      points: g._sum.points ?? 0,
      contributors: contribByS.get(g.sectId) ?? 0,
      weeksContributed: weeksByS.get(g.sectId) ?? 0,
    }));

    // Resolve character names + sectId cho top members.
    const chars = await this.prisma.character.findMany({
      where: { id: { in: topMembersRaw.map((m) => m.characterId) } },
      select: { id: true, name: true, sectId: true },
    });
    const charMap = new Map(chars.map((c) => [c.id, c]));

    // Resolve member sect names — distinct sectIds từ top members.
    const memberSectIds = Array.from(
      new Set(
        chars
          .map((c) => c.sectId)
          .filter((id): id is string => id !== null && id !== undefined),
      ),
    );
    const memberSects =
      memberSectIds.length > 0
        ? await this.prisma.sect.findMany({
            where: { id: { in: memberSectIds } },
            select: { id: true, name: true },
          })
        : [];
    const memberSectNameMap = new Map(memberSects.map((s) => [s.id, s.name]));

    const topMembersResult: SectSeasonHistoryMemberEntry[] = topMembersRaw.map(
      (m, i) => {
        const c = charMap.get(m.characterId);
        const sectId = c?.sectId ?? null;
        return {
          rank: i + 1,
          characterId: m.characterId,
          characterName: c?.name ?? m.characterId,
          sectId,
          sectName: sectId ? memberSectNameMap.get(sectId) ?? null : null,
          points: m._sum.points ?? 0,
        };
      },
    );

    return {
      totalSects,
      totalContributors,
      totalPoints,
      sects: sectsResult,
      topMembers: topMembersResult,
    };
  }
}
