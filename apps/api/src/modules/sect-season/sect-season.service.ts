import { Injectable, Optional } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  SECT_SEASONS,
  SECT_SEASON_MILESTONES,
  currentSectSeason,
  sectSeasonAchievedMilestones,
  sectSeasonByKey,
  sectSeasonClaimableMilestones,
  sectSeasonMilestoneByKey,
  sectSeasonNextMilestone,
  sectSeasonRewardSummary,
  sectSeasonWeekKeys,
  type SectSeasonClaimResult,
  type SectSeasonDef,
  type SectSeasonLeaderboardRow,
  type SectSeasonLeaderboardView,
  type SectSeasonMilestoneDef,
  type SectSeasonMyStatusView,
} from '@xuantoi/shared';
import { PrismaService } from '../../common/prisma.service';
import { BuffService } from '../character/buff.service';
import { CurrencyKind } from '@prisma/client';
import { CurrencyService } from '../character/currency.service';
import { TitleService } from '../character/title.service';
import { InventoryService } from '../inventory/inventory.service';

/**
 * Phase 13.2.A — Sect Season (Mùa Tông Môn) read aggregation +
 * Phase 13.2.B — milestone claim runtime.
 *
 * Read-only invariants (Phase 13.2.A):
 *   - KHÔNG mutate `SectWarContribution`. Aggregate read-only qua
 *     `weekKey IN sectSeasonWeekKeys(season)`.
 *   - Server-authoritative compute: season window đến từ shared catalog
 *     `SECT_SEASONS`. FE KHÔNG self-derive milestone status.
 *   - Leaderboard top N (10) — sort points DESC, tie-break sectId ASC.
 *
 * Claim runtime (Phase 13.2.B):
 *   - {@link claimMilestone} chống double-claim qua DB UNIQUE
 *     `(characterId, seasonKey, milestoneKey)` (CAS guard idiom: insert
 *     `SectSeasonClaim` trước, currency/inventory/title/buff grant sau,
 *     fail bất kỳ bước nào → rollback toàn bộ tx).
 *   - Race-safe: 2 promise concurrent ⇒ promise thứ 2 nhận
 *     `Prisma P2002 → ALREADY_CLAIMED` thay vì grant 2 lần.
 *   - Server-side `personalPoints` snapshot ở commit time — chống FE
 *     spoof requiredPoints (server tự aggregate `SectWarContribution`).
 *   - Reward grant qua `CurrencyService.applyTx` / `InventoryService.grantTx`
 *     / `TitleService.unlockTitleTx` / `BuffService.applyBuffTx` cùng
 *     ledger reason `SECT_SEASON_REWARD` + `refType='SectSeasonClaim'`.
 *
 * Out-of-scope (Phase 13.2.C+):
 *   - Sect-aggregate milestone (sect-wide reward thay vì personal).
 *   - Season cron rollover (snapshot cuối season → archive).
 *   - Custom milestone per-season. Hiện tại mọi season share
 *     `SECT_SEASON_MILESTONES`.
 *   - PvP realtime, auction, diplomacy, alliance, sect-vs-sect war.
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

export type SectSeasonErrorCode =
  | 'NO_CHARACTER'
  | 'SEASON_NOT_FOUND'
  | 'SECT_SEASON_MILESTONE_NOT_FOUND'
  | 'SECT_SEASON_NOT_ELIGIBLE'
  | 'SECT_SEASON_ALREADY_CLAIMED';

export class SectSeasonError extends Error {
  readonly code: SectSeasonErrorCode;
  constructor(code: SectSeasonErrorCode, message?: string) {
    super(message ?? code);
    this.name = 'SectSeasonError';
    this.code = code;
  }
}

const LEADERBOARD_TOP = 10;

// Phase 13.2.B — ledger/audit ref constants. Dùng nhất quán cho cả
// CurrencyLedger / ItemLedger / SectSeasonClaim.rewardSnapshot meta.
const REWARD_REASON = 'SECT_SEASON_REWARD' as const;
const REWARD_REF_TYPE = 'SectSeasonClaim' as const;

@Injectable()
export class SectSeasonService {
  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly currency?: CurrencyService,
    @Optional() private readonly inventory?: InventoryService,
    @Optional() private readonly title?: TitleService,
    @Optional() private readonly buff?: BuffService,
  ) {}

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
   * Phase 13.2.B: thêm `claimedMilestoneKeys` (đọc từ `SectSeasonClaim`) +
   * `claimableMilestoneKeys` (achieved \ claimed). FE dùng để render claim
   * button enabled/disabled.
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

    // Phase 13.2.B — load đã claim row cho season này.
    const claims = await this.prisma.sectSeasonClaim.findMany({
      where: { characterId: char.id, seasonKey: season.key },
      select: { milestoneKey: true },
    });
    const claimedMilestoneKeys = claims.map((c) => c.milestoneKey);
    const claimable = sectSeasonClaimableMilestones(personalPoints, claimedMilestoneKeys);

    return {
      seasonKey: season.key,
      hasSect: !!char.sectId,
      sectId: char.sectId,
      sectName,
      personalPoints,
      weeksContributed,
      achievedMilestoneKeys: achieved.map((m) => m.key),
      nextMilestoneKey: next?.key ?? null,
      claimedMilestoneKeys,
      claimableMilestoneKeys: claimable.map((m) => m.key),
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

  /**
   * Snapshot common milestone catalog — `GET /sect-season/milestones`.
   * KHÔNG gọi DB; chỉ wrap shared `SECT_SEASON_MILESTONES`.
   */
  listMilestones(): ReadonlyArray<SectSeasonMilestoneDef> {
    return SECT_SEASON_MILESTONES;
  }

  // ────────────────────────────────────────────────────────────────────
  // Phase 13.2.B — Claim runtime
  // ────────────────────────────────────────────────────────────────────

  /**
   * Claim milestone reward cho user trong season. Idempotent + race-safe:
   *
   *   1. Resolve season (lookup catalog) + milestone (lookup catalog) —
   *      throw `SEASON_NOT_FOUND` / `SECT_SEASON_MILESTONE_NOT_FOUND` nếu
   *      không tồn tại.
   *   2. Resolve character từ `userId` — throw `NO_CHARACTER` nếu chưa tạo.
   *   3. Aggregate `SectWarContribution.points` qua `weekKeys` của season —
   *      ra `personalPoints` snapshot. Kiểm `personalPoints >=
   *      milestone.requiredPoints` → throw `SECT_SEASON_NOT_ELIGIBLE`.
   *   4. Cheap pre-check `SectSeasonClaim` UNIQUE — throw
   *      `SECT_SEASON_ALREADY_CLAIMED` nếu đã claim (giúp client thấy
   *      error sớm trước khi vào tx).
   *   5. Mở `$transaction`:
   *      a) `prisma.sectSeasonClaim.create({...})` — UNIQUE catch P2002 →
   *         ALREADY_CLAIMED (race winner determined ở đây).
   *      b) `currency.applyTx(LINH_THACH, +reward.linhThach)` nếu > 0.
   *      c) `currency.applyTx(TIEN_NGOC, +reward.tienNgoc)` nếu > 0.
   *      d) `inventory.grantTx(reward.items)` nếu non-empty.
   *      e) `title.unlockTitleTx(titleKey)` nếu set.
   *      f) `buff.applyBuffTx(buffKey)` nếu set.
   *   6. Trả `SectSeasonClaimResult` snapshot reward thực tế đã grant +
   *      `pointsAtClaim` snapshot + `claimedAtIso`.
   *
   * Error semantics:
   *   - `NO_CHARACTER` → 404 (handled bởi controller).
   *   - `SEASON_NOT_FOUND` / `SECT_SEASON_MILESTONE_NOT_FOUND` → 404.
   *   - `SECT_SEASON_NOT_ELIGIBLE` → 400 (chưa đủ điểm).
   *   - `SECT_SEASON_ALREADY_CLAIMED` → 409 (P2002 hoặc pre-check).
   *
   * Phase 13.2.B chấp nhận claim cho **mọi season trong catalog** (cả
   * past + current) — server-authoritative kiểm `personalPoints` snapshot
   * tại commit time. Nếu sau này thêm "season expire" rule sẽ bổ sung
   * `SECT_SEASON_EXPIRED` code (Phase 13.2.C+).
   */
  async claimMilestone(
    userId: string,
    seasonKey: string,
    milestoneKey: string,
    now: Date = new Date(),
  ): Promise<SectSeasonClaimResult> {
    const season = sectSeasonByKey(seasonKey);
    if (!season) throw new SectSeasonError('SEASON_NOT_FOUND');

    const milestone = sectSeasonMilestoneByKey(milestoneKey);
    if (!milestone) throw new SectSeasonError('SECT_SEASON_MILESTONE_NOT_FOUND');

    const char = await this.prisma.character.findUnique({
      where: { userId },
      select: { id: true },
    });
    if (!char) throw new SectSeasonError('NO_CHARACTER');

    // Aggregate personal points qua weekKeys (server-side authority).
    const weekKeys = sectSeasonWeekKeys(season);
    const agg = await this.prisma.sectWarContribution.aggregate({
      where: { weekKey: { in: weekKeys }, characterId: char.id },
      _sum: { points: true },
    });
    const personalPoints = agg._sum.points ?? 0;
    if (personalPoints < milestone.requiredPoints) {
      throw new SectSeasonError('SECT_SEASON_NOT_ELIGIBLE');
    }

    // Cheap pre-check (skip vào tx nếu đã claim).
    const existing = await this.prisma.sectSeasonClaim.findUnique({
      where: {
        characterId_seasonKey_milestoneKey: {
          characterId: char.id,
          seasonKey: season.key,
          milestoneKey: milestone.key,
        },
      },
      select: { id: true },
    });
    if (existing) throw new SectSeasonError('SECT_SEASON_ALREADY_CLAIMED');

    const reward = sectSeasonRewardSummary(milestone.reward);
    const refId = `${season.key}:${milestone.key}`;
    const ledgerMeta = {
      seasonKey: season.key,
      milestoneKey: milestone.key,
      pointsAtClaim: personalPoints,
    };

    try {
      await this.prisma.$transaction(async (tx) => {
        // INSERT trước — P2002 sẽ rollback toàn bộ tx (race-safe winner).
        await tx.sectSeasonClaim.create({
          data: {
            characterId: char.id,
            seasonKey: season.key,
            milestoneKey: milestone.key,
            pointsAtClaim: personalPoints,
            rewardSnapshot: reward as unknown as Prisma.InputJsonValue,
          },
        });

        if (reward.linhThach > 0 && this.currency) {
          await this.currency.applyTx(tx, {
            characterId: char.id,
            currency: CurrencyKind.LINH_THACH,
            delta: BigInt(reward.linhThach),
            reason: REWARD_REASON,
            refType: REWARD_REF_TYPE,
            refId,
            meta: ledgerMeta,
          });
        }
        if (reward.tienNgoc > 0 && this.currency) {
          await this.currency.applyTx(tx, {
            characterId: char.id,
            currency: CurrencyKind.TIEN_NGOC,
            delta: BigInt(reward.tienNgoc),
            reason: REWARD_REASON,
            refType: REWARD_REF_TYPE,
            refId,
            meta: ledgerMeta,
          });
        }
        if (reward.items.length > 0 && this.inventory) {
          await this.inventory.grantTx(
            tx,
            char.id,
            reward.items.map((it) => ({
              itemKey: it.itemKey,
              qty: it.qty,
            })),
            {
              reason: REWARD_REASON,
              refType: REWARD_REF_TYPE,
              refId,
              extra: ledgerMeta,
            },
          );
        }
        if (reward.titleKey && this.title) {
          await this.title.unlockTitleTx(
            tx,
            char.id,
            reward.titleKey,
            'sect_season',
          );
        }
        if (reward.buffKey && this.buff) {
          await this.buff.applyBuffTx(tx, char.id, reward.buffKey, 'sect_season', now);
        }
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new SectSeasonError('SECT_SEASON_ALREADY_CLAIMED');
      }
      throw e;
    }

    return {
      seasonKey: season.key,
      milestoneKey: milestone.key,
      granted: reward,
      pointsAtClaim: personalPoints,
      claimedAtIso: now.toISOString(),
    };
  }
}
