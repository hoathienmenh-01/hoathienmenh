import { Injectable, Logger } from '@nestjs/common';
import {
  MAP_REGIONS,
  REGION_KEYS,
  currentTerritoryPeriodKey,
  isMapRegionKey,
  isTerritoryPeriodKey,
  nextTerritoryResetAt,
  previousTerritoryPeriodKey,
  territoryPeriodWindow,
  type RegionKey,
  type TerritoryRegionOwnerSnapshotView,
  type TerritoryRegionWarStandingView,
  type TerritoryRegionWarStatusView,
  type TerritoryRegionWarSummaryView,
  type TerritorySettlementSnapshotView,
  type TerritoryWarHistoryEntry,
  type TerritoryWarHistoryView,
  type TerritoryWarSettleCurrentResult,
  type TerritoryWarStateView,
} from '@xuantoi/shared';
import { PrismaService } from '../../common/prisma.service';
import { TerritoryError } from './territory.service';
import { TerritorySettlementService } from './territory-settlement.service';

/**
 * Phase 14.0.D — Territory Weekly War Loop runtime service.
 *
 * Server-authoritative invariants:
 *   - Period key dùng UTC ISO week (`territoryPeriodKeyForDate`). FE
 *     countdown đọc từ `nextTerritoryResetAt(now)` server-side để tránh
 *     drift / cheat.
 *   - Settlement chỉ chốt 1 lần / `(regionKey, periodKey)` (UNIQUE ở DB).
 *     `settleCurrentPeriod()` chốt period HIỆN TẠI — chỉ admin/cron gọi
 *     khi muốn "cắt" giữa tuần (test / fast-forward); cron production
 *     thường gọi `settlePreviousPeriod()` (chốt period vừa kết thúc).
 *   - "No-influence rule": region không có sect nào có điểm > 0 trong
 *     period → snapshot KHÔNG được ghi (skipped) → `SectTerritoryRegionState`
 *     KHÔNG đổi → owner cũ giữ nguyên (sticky ownership). Region chưa
 *     từng settle thì vẫn unclaimed.
 *   - Tie-break deterministic: cùng điểm → `sectId.localeCompare()` ASC
 *     (reuse rule với `TerritorySettlementService.settleRegion`).
 *   - Idempotency race-safe: 2 caller settle cùng period → 1 thắng race
 *     (P2002 swallow), cả 2 trả cùng snapshot (consistent).
 *
 * Phase 14.0.D KHÔNG xử lý:
 *   - Cron auto-settle (defer ops setup — cần Redis lease / DB guard).
 *     Hiện tại admin trigger qua `POST /admin/territory/war/settle-current`.
 *   - Decay điểm tự động trước/sau settlement (Phase 14.0.C đã có admin
 *     trigger riêng `POST /admin/territory/decay`; tách rời).
 *   - Reward / mail cho owner sect (defer 14.0.E+).
 *   - PvP siege / diplomacy (out of scope).
 */
@Injectable()
export class TerritoryWarService {
  private readonly logger = new Logger(TerritoryWarService.name);

  // Top N standings cho overview / region detail.
  private readonly TOP_OVERVIEW = 3;
  private readonly TOP_REGION = 10;

  // History page size cho `getWarHistory()` và `getRegionWarStatus()`.
  private readonly HISTORY_DEFAULT = 8;
  private readonly HISTORY_MAX = 32;
  private readonly REGION_RECENT_SETTLEMENTS = 5;

  constructor(
    private readonly prisma: PrismaService,
    private readonly settlement: TerritorySettlementService,
  ) {}

  // ────────────────────────────────────────────────────────────────────
  // Read APIs
  // ────────────────────────────────────────────────────────────────────

  /**
   * Trả về war state cho period HIỆN TẠI:
   *   - periodKey / startsAt / endsAt / countdown.
   *   - 9 region với top 3 standings + leader/runner-up margin.
   *   - Owner snapshot từ kỳ trước (`SectTerritoryRegionState`).
   *
   * Public endpoint — không cần auth.
   */
  async getCurrentTerritoryWarState(
    now: Date = new Date(),
  ): Promise<TerritoryWarStateView> {
    const periodKey = currentTerritoryPeriodKey(now);
    const previousPeriodKey = previousTerritoryPeriodKey(now);
    const window = territoryPeriodWindow(periodKey);
    const startsAt = window?.startsAt ?? now;
    const endsAt = window?.endsAt ?? nextTerritoryResetAt(now);
    const nextResetAt = endsAt;
    const timeRemainingMs = Math.max(0, endsAt.getTime() - now.getTime());

    // Aggregate điểm per (regionKey, sectId) cho period hiện tại.
    // Phase 14.0.A invariant: influence là cumulative (không reset theo
    // period) — current war state nhìn toàn bộ điểm hiện có (decay tách
    // riêng admin trigger). Filter theo `createdAt >= startsAt` để FE
    // hiển thị "đóng góp tuần này" thay vì cumulative.
    const grouped = await this.prisma.sectTerritoryInfluence.groupBy({
      by: ['regionKey', 'sectId'],
      where: { createdAt: { gte: startsAt } },
      _sum: { points: true },
    });

    // Distinct contributors per (region, sect) — count distinct characterId.
    const contribRows = await this.prisma.sectTerritoryInfluence.groupBy({
      by: ['regionKey', 'sectId', 'characterId'],
      where: { createdAt: { gte: startsAt } },
    });
    const contribByRegionSect = new Map<string, number>();
    for (const r of contribRows) {
      const key = `${r.regionKey}::${r.sectId}`;
      contribByRegionSect.set(key, (contribByRegionSect.get(key) ?? 0) + 1);
    }

    // Bucket grouped rows theo region.
    const byRegion = new Map<string, Array<{ sectId: string; points: number }>>();
    for (const g of grouped) {
      const arr = byRegion.get(g.regionKey) ?? [];
      arr.push({ sectId: g.sectId, points: g._sum.points ?? 0 });
      byRegion.set(g.regionKey, arr);
    }

    // Resolve sect names cho top sect mỗi region (1 batch query).
    const sectIds = new Set<string>();
    for (const [, rows] of byRegion) {
      for (const r of rows.slice(0, this.TOP_OVERVIEW)) {
        sectIds.add(r.sectId);
      }
    }
    const sectNames = await this.resolveSectNames([...sectIds]);

    // Owner snapshot per region (kỳ trước).
    const ownerStateMap = await this.settlement.getOwnerStateMap();

    const regions: TerritoryRegionWarSummaryView[] = MAP_REGIONS.map((r) => {
      const rows = byRegion.get(r.key) ?? [];
      // Filter > 0 + tie-break.
      const sorted = rows
        .filter((x) => x.points > 0)
        .sort(
          (a, b) =>
            b.points - a.points || a.sectId.localeCompare(b.sectId),
        );
      const totalPoints = sorted.reduce((a, b) => a + b.points, 0);
      const top = sorted.slice(0, this.TOP_OVERVIEW);
      const leader = top[0] ?? null;
      const runnerUp = top[1] ?? null;
      const leadMargin = leader
        ? leader.points - (runnerUp?.points ?? 0)
        : 0;
      const topStandings: TerritoryRegionWarStandingView[] = top.map(
        (g, i) => ({
          rank: i + 1,
          sectId: g.sectId,
          sectName: sectNames.get(g.sectId) ?? g.sectId,
          points: g.points,
          contributors:
            contribByRegionSect.get(`${r.key}::${g.sectId}`) ?? 0,
          isLeader: i === 0,
        }),
      );
      const owner = ownerStateMap.get(r.key) ?? null;
      return {
        regionKey: r.key,
        nameVi: r.nameVi,
        nameEn: r.nameEn,
        sortOrder: r.sortOrder,
        totalPoints,
        contestedSectCount: sorted.length,
        leaderSectId: leader?.sectId ?? null,
        leaderSectName: leader
          ? sectNames.get(leader.sectId) ?? leader.sectId
          : null,
        leaderPoints: leader?.points ?? 0,
        leadMargin,
        contested: sorted.length >= 2,
        currentOwnerSectId: owner?.ownerSectId ?? null,
        currentOwnerSectName: owner?.ownerSectName ?? null,
        currentOwnerPeriodKey: owner?.periodKey ?? null,
        topStandings,
      };
    });

    regions.sort((a, b) => a.sortOrder - b.sortOrder);

    return {
      periodKey,
      previousPeriodKey,
      startsAt: startsAt.toISOString(),
      endsAt: endsAt.toISOString(),
      nextResetAt: nextResetAt.toISOString(),
      serverNow: now.toISOString(),
      timeRemainingMs,
      regions,
    };
  }

  /**
   * War status cho 1 region: top 10 standings + 5 settlement gần nhất.
   *
   * Throw `TerritoryError('REGION_INVALID')` nếu regionKey không hợp lệ.
   */
  async getRegionWarStatus(
    regionKey: string,
    now: Date = new Date(),
  ): Promise<TerritoryRegionWarStatusView> {
    if (!isMapRegionKey(regionKey)) {
      throw new TerritoryError('REGION_INVALID');
    }
    const region = MAP_REGIONS.find((r) => r.key === regionKey);
    if (!region) throw new TerritoryError('REGION_INVALID');

    const periodKey = currentTerritoryPeriodKey(now);
    const previousPeriodKey = previousTerritoryPeriodKey(now);
    const window = territoryPeriodWindow(periodKey);
    const startsAt = window?.startsAt ?? now;
    const endsAt = window?.endsAt ?? nextTerritoryResetAt(now);
    const timeRemainingMs = Math.max(0, endsAt.getTime() - now.getTime());

    const grouped = await this.prisma.sectTerritoryInfluence.groupBy({
      by: ['sectId'],
      where: { regionKey, createdAt: { gte: startsAt } },
      _sum: { points: true },
    });
    const sorted = grouped
      .map((g) => ({ sectId: g.sectId, points: g._sum.points ?? 0 }))
      .filter((x) => x.points > 0)
      .sort(
        (a, b) =>
          b.points - a.points || a.sectId.localeCompare(b.sectId),
      );

    const totalPoints = sorted.reduce((a, b) => a + b.points, 0);
    const top = sorted.slice(0, this.TOP_REGION);
    const sectIds = top.map((g) => g.sectId);

    const sectNames = await this.resolveSectNames(sectIds);

    // Distinct contributors per sect.
    const contribCounts =
      sectIds.length > 0
        ? await this.prisma.sectTerritoryInfluence.groupBy({
            by: ['sectId', 'characterId'],
            where: {
              regionKey,
              sectId: { in: sectIds },
              createdAt: { gte: startsAt },
            },
          })
        : [];
    const contribBySect = new Map<string, number>();
    for (const r of contribCounts) {
      contribBySect.set(r.sectId, (contribBySect.get(r.sectId) ?? 0) + 1);
    }

    const standings: TerritoryRegionWarStandingView[] = top.map((g, i) => ({
      rank: i + 1,
      sectId: g.sectId,
      sectName: sectNames.get(g.sectId) ?? g.sectId,
      points: g.points,
      contributors: contribBySect.get(g.sectId) ?? 0,
      isLeader: i === 0,
    }));

    const leader = top[0] ?? null;
    const runnerUp = top[1] ?? null;
    const leadMargin = leader
      ? leader.points - (runnerUp?.points ?? 0)
      : 0;

    const ownerStateMap = await this.settlement.getOwnerStateMap();
    const owner = ownerStateMap.get(regionKey) ?? null;

    // Recent settlements (last 5) for region detail panel.
    const history = await this.settlement.getRegionHistory(
      regionKey,
      this.REGION_RECENT_SETTLEMENTS,
    );

    return {
      regionKey: regionKey as RegionKey,
      nameVi: region.nameVi,
      nameEn: region.nameEn,
      sortOrder: region.sortOrder,
      periodKey,
      previousPeriodKey,
      startsAt: startsAt.toISOString(),
      endsAt: endsAt.toISOString(),
      serverNow: now.toISOString(),
      timeRemainingMs,
      totalPoints,
      contestedSectCount: sorted.length,
      leaderSectId: leader?.sectId ?? null,
      leaderSectName: leader
        ? sectNames.get(leader.sectId) ?? leader.sectId
        : null,
      leaderPoints: leader?.points ?? 0,
      leadMargin,
      contested: sorted.length >= 2,
      currentOwnerSectId: owner?.ownerSectId ?? null,
      currentOwnerSectName: owner?.ownerSectName ?? null,
      currentOwnerPeriodKey: owner?.periodKey ?? null,
      currentOwnerSettledAt: owner?.settledAt
        ? owner.settledAt.toISOString()
        : null,
      standings,
      recentSettlements: history.snapshots,
    };
  }

  /**
   * War history grouped by `periodKey` (recent N periods first).
   *
   * Mỗi entry chứa list snapshot của 9 region (region nào skip period đó
   * không có entry trong array). Order DESC theo `periodKey` (lexicographic
   * ISO week giảm dần — đủ cho 99% case khi periodKey toàn ISO week).
   */
  async getWarHistory(limit?: number): Promise<TerritoryWarHistoryView> {
    const cap = Math.max(
      1,
      Math.min(limit ?? this.HISTORY_DEFAULT, this.HISTORY_MAX),
    );

    // Distinct periodKeys mới nhất.
    const periodRows = await this.prisma.sectTerritorySettlementSnapshot.findMany(
      {
        select: { periodKey: true, settledAt: true },
        orderBy: { settledAt: 'desc' },
      },
    );
    const seen = new Map<string, Date>();
    for (const r of periodRows) {
      if (!seen.has(r.periodKey)) seen.set(r.periodKey, r.settledAt);
    }
    const periods = [...seen.entries()]
      .sort((a, b) => b[1].getTime() - a[1].getTime())
      .slice(0, cap)
      .map((e) => e[0]);

    if (periods.length === 0) return { entries: [] };

    const snaps = await this.prisma.sectTerritorySettlementSnapshot.findMany({
      where: { periodKey: { in: periods } },
      orderBy: [
        { periodKey: 'desc' },
        { regionKey: 'asc' },
      ],
    });

    const byPeriod = new Map<string, typeof snaps>();
    for (const s of snaps) {
      const arr = byPeriod.get(s.periodKey) ?? [];
      arr.push(s);
      byPeriod.set(s.periodKey, arr);
    }

    const entries: TerritoryWarHistoryEntry[] = [];
    for (const pk of periods) {
      const rows = byPeriod.get(pk) ?? [];
      if (rows.length === 0) continue;
      const window = territoryPeriodWindow(pk);
      // Settlement gần nhất trong period = max settledAt across rows.
      const settledAt = rows
        .map((r) => r.settledAt.getTime())
        .reduce((a, b) => Math.max(a, b), 0);
      const snapshots: TerritorySettlementSnapshotView[] = rows.map((r) =>
        this.toSnapshotView(r),
      );
      entries.push({
        periodKey: pk,
        startsAt: window?.startsAt.toISOString() ?? null,
        endsAt: window?.endsAt.toISOString() ?? null,
        settledAt: new Date(settledAt).toISOString(),
        snapshots,
      });
    }

    return { entries };
  }

  // ────────────────────────────────────────────────────────────────────
  // Mutation APIs (admin / cron)
  // ────────────────────────────────────────────────────────────────────

  /**
   * Settle MỌI region cho period HIỆN TẠI (cắt sớm — admin trigger /
   * test). Idempotent qua UNIQUE `(regionKey, periodKey)`.
   *
   * Khác `TerritorySettlementService.settleAllRegions(prevPeriodKey)`:
   *   - settle current period (FE thấy ngay snapshot tuần này).
   *   - trả thêm `ownersAfter` cho FE refresh không cần round-trip.
   *
   * No-influence rule: region không có sect đủ điểm → KHÔNG ghi snapshot,
   * KHÔNG đổi owner state → region listed in `skippedRegions`.
   */
  async settleCurrentPeriod(opts: {
    settledBy?: string | null;
    now?: Date;
  } = {}): Promise<TerritoryWarSettleCurrentResult> {
    const now = opts.now ?? new Date();
    const periodKey = currentTerritoryPeriodKey(now);
    if (!isTerritoryPeriodKey(periodKey)) {
      // Defensive — currentTerritoryPeriodKey luôn ISO week format hợp lệ.
      throw new TerritoryError('PERIOD_INVALID');
    }

    const run = await this.settlement.settleAllRegions(periodKey, {
      settledBy: opts.settledBy ?? null,
    });

    // Snapshot owner state SAU settlement (kể cả region skip).
    const ownerStateMap = await this.settlement.getOwnerStateMap();
    const ownersAfter: TerritoryRegionOwnerSnapshotView[] = REGION_KEYS.map(
      (regionKey) => {
        const owner = ownerStateMap.get(regionKey) ?? null;
        return {
          regionKey,
          ownerSectId: owner?.ownerSectId ?? null,
          ownerSectName: owner?.ownerSectName ?? null,
          periodKey: owner?.periodKey ?? null,
          settledAt: owner?.settledAt
            ? owner.settledAt.toISOString()
            : null,
        };
      },
    );

    this.logger.log(
      `settleCurrentPeriod period=${periodKey} settled=${run.snapshots.length} skipped=${run.skippedRegions.length} by=${opts.settledBy ?? 'null'}`,
    );

    return {
      periodKey: run.periodKey,
      settledAt: run.settledAt,
      snapshots: run.snapshots,
      skippedRegions: run.skippedRegions,
      ownersAfter,
    };
  }

  // ────────────────────────────────────────────────────────────────────
  // Helpers
  // ────────────────────────────────────────────────────────────────────

  private async resolveSectNames(
    sectIds: string[],
  ): Promise<Map<string, string>> {
    if (sectIds.length === 0) return new Map();
    const sects = await this.prisma.sect.findMany({
      where: { id: { in: sectIds } },
      select: { id: true, name: true },
    });
    return new Map(sects.map((s) => [s.id, s.name]));
  }

  private toSnapshotView(row: {
    id: string;
    regionKey: string;
    periodKey: string;
    winnerSectId: string | null;
    winnerSectName: string | null;
    winnerPoints: number;
    runnerUpSectId: string | null;
    runnerUpSectName: string | null;
    runnerUpPoints: number;
    totalSects: number;
    totalPoints: number;
    settledAt: Date;
    settledBy: string | null;
  }): TerritorySettlementSnapshotView {
    return {
      id: row.id,
      regionKey: row.regionKey as RegionKey,
      periodKey: row.periodKey,
      winnerSectId: row.winnerSectId,
      winnerSectName: row.winnerSectName,
      winnerPoints: row.winnerPoints,
      runnerUpSectId: row.runnerUpSectId,
      runnerUpSectName: row.runnerUpSectName,
      runnerUpPoints: row.runnerUpPoints,
      totalSects: row.totalSects,
      totalPoints: row.totalPoints,
      settledAt: row.settledAt.toISOString(),
      settledBy: row.settledBy,
    };
  }
}
