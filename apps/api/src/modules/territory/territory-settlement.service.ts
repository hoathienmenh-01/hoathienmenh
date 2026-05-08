import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  MAP_REGIONS,
  isMapRegionKey,
  isTerritoryPeriodKey,
  type RegionKey,
  type TerritoryRegionHistoryView,
  type TerritorySettlementRunResult,
  type TerritorySettlementSnapshotView,
} from '@xuantoi/shared';
import { PrismaService } from '../../common/prisma.service';
import { TerritoryError } from './territory.service';

/**
 * Phase 14.0.B — Territory Settlement runtime service.
 *
 * Server-authoritative invariants:
 *   - Settlement chỉ chốt từ điểm influence hiện tại (cumulative). Phase
 *     14.0.B KHÔNG xóa influence cũ — period mới settlement vẫn nhìn
 *     toàn bộ điểm tích lũy. Decay / reset điểm theo period defer 14.0.C+.
 *   - Idempotency qua UNIQUE `(regionKey, periodKey)` trên
 *     `SectTerritorySettlementSnapshot`. Gọi {@link settleRegion} nhiều
 *     lần với cùng `(regionKey, periodKey)` → chỉ ghi 1 row, các lần
 *     sau return existing snapshot. Tương tự {@link settleAllRegions}
 *     idempotent từng region.
 *   - Race-safety: 2 caller concurrent settle cùng `(regionKey, periodKey)`
 *     → 1 thắng race (insert OK), caller còn lại P2002 → fall through đọc
 *     existing. Cả 2 trả cùng 1 snapshot (consistent).
 *   - Tie-break deterministic: cùng điểm → `sectId.localeCompare()` ASC.
 *     Reuse rule với `TerritoryService.getRegionLeaderboard` để
 *     leaderboard top khớp settlement winner.
 *   - Skip empty: region không có sect đủ điểm (`points > 0`) → KHÔNG
 *     ghi snapshot, KHÔNG đụng `SectTerritoryRegionState` (region vẫn
 *     unclaimed). Region được liệt kê trong `skippedRegions[]`.
 *
 * Region state (`SectTerritoryRegionState`):
 *   - 1 row / region. Snapshot owner hiện tại (`ownerSectId`,
 *     `ownerSectName` denormalized) + period key của settlement gần nhất.
 *   - Cập nhật cùng transaction với insert snapshot. Last-write-wins
 *     giữa 2 settlement khác period (cron W22 vs admin manual_xx) — admin
 *     không nên settle ngược thời gian.
 *
 * Phase 14.0.B KHÔNG xử lý:
 *   - Cron schedule (defer ops setup — chỉ expose admin trigger).
 *   - Region buff theo owner (defer 14.0.C).
 *   - Reward / mail cho owner sect (defer 14.0.C).
 */
@Injectable()
export class TerritorySettlementService {
  private readonly logger = new Logger(TerritorySettlementService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Settle 1 region cho 1 period.
   *
   * Hành vi:
   *   - `regionKey` invalid → throw `TerritoryError('REGION_INVALID')`.
   *   - `periodKey` invalid (không match ISO week | manual_*) → throw
   *     `TerritoryError('PERIOD_INVALID')`.
   *   - Snapshot đã tồn tại → fast-path return existing (idempotent, no
   *     mutation).
   *   - Region rỗng (mọi sect 0 điểm) → return `{ snapshot: null,
   *     skipped: true }`. KHÔNG ghi snapshot, KHÔNG đụng region state.
   *   - Bình thường: insert snapshot + upsert region state trong 1 tx.
   *
   * `settledBy` = optional admin userId — ghi vào audit cột `settledBy`.
   * Nếu null → settled bởi cron / system.
   */
  async settleRegion(
    regionKey: string,
    periodKey: string,
    opts: { settledBy?: string | null } = {},
  ): Promise<{
    snapshot: TerritorySettlementSnapshotView | null;
    skipped: boolean;
  }> {
    if (!isMapRegionKey(regionKey)) {
      throw new TerritoryError('REGION_INVALID');
    }
    if (!isTerritoryPeriodKey(periodKey)) {
      throw new TerritoryError('PERIOD_INVALID');
    }

    // Fast path: snapshot đã tồn tại → idempotent return.
    const existing = await this.prisma.sectTerritorySettlementSnapshot.findUnique({
      where: { regionKey_periodKey: { regionKey, periodKey } },
    });
    if (existing) {
      return { snapshot: this.toSnapshotView(existing), skipped: false };
    }

    // Aggregate điểm theo sect.
    const grouped = await this.prisma.sectTerritoryInfluence.groupBy({
      by: ['sectId'],
      where: { regionKey },
      _sum: { points: true },
    });

    // Filter sect có điểm > 0 + tie-break deterministic theo `sectId`.
    const sorted = grouped
      .map((g) => ({ sectId: g.sectId, points: g._sum.points ?? 0 }))
      .filter((r) => r.points > 0)
      .sort(
        (a, b) =>
          b.points - a.points || a.sectId.localeCompare(b.sectId),
      );

    if (sorted.length === 0) {
      // Skip empty region — KHÔNG ghi snapshot/region state.
      return { snapshot: null, skipped: true };
    }

    // Resolve sect names (winner + runner-up).
    const winner = sorted[0];
    const runnerUp = sorted[1] ?? null;
    const ids = runnerUp ? [winner.sectId, runnerUp.sectId] : [winner.sectId];
    const sects = await this.prisma.sect.findMany({
      where: { id: { in: ids } },
      select: { id: true, name: true },
    });
    const nameMap = new Map(sects.map((s) => [s.id, s.name]));
    const winnerName = nameMap.get(winner.sectId) ?? winner.sectId;
    const runnerUpName = runnerUp
      ? nameMap.get(runnerUp.sectId) ?? runnerUp.sectId
      : null;

    const totalPoints = sorted.reduce((a, b) => a + b.points, 0);
    const totalSects = sorted.length;
    const settledAt = new Date();
    const settledBy = opts.settledBy ?? null;

    // Insert snapshot + upsert region state trong 1 tx.
    let inserted: Awaited<
      ReturnType<typeof this.prisma.sectTerritorySettlementSnapshot.create>
    >;
    try {
      inserted = await this.prisma.$transaction(async (tx) => {
        const snap = await tx.sectTerritorySettlementSnapshot.create({
          data: {
            regionKey,
            periodKey,
            winnerSectId: winner.sectId,
            winnerSectName: winnerName,
            winnerPoints: winner.points,
            runnerUpSectId: runnerUp?.sectId ?? null,
            runnerUpSectName: runnerUpName,
            runnerUpPoints: runnerUp?.points ?? 0,
            totalSects,
            totalPoints,
            settledAt,
            settledBy,
          },
        });
        await tx.sectTerritoryRegionState.upsert({
          where: { regionKey },
          create: {
            regionKey,
            ownerSectId: winner.sectId,
            ownerSectName: winnerName,
            periodKey,
            settledAt,
          },
          update: {
            ownerSectId: winner.sectId,
            ownerSectName: winnerName,
            periodKey,
            settledAt,
          },
        });
        return snap;
      });
    } catch (e) {
      if (
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === 'P2002'
      ) {
        // Race lose: caller khác đã insert snapshot xong → đọc existing.
        const winnerRow = await this.prisma.sectTerritorySettlementSnapshot.findUnique({
          where: { regionKey_periodKey: { regionKey, periodKey } },
        });
        if (winnerRow) {
          return { snapshot: this.toSnapshotView(winnerRow), skipped: false };
        }
      }
      throw e;
    }

    this.logger.log(
      `settled region=${regionKey} period=${periodKey} winner=${winner.sectId} pts=${winner.points}`,
    );
    return { snapshot: this.toSnapshotView(inserted), skipped: false };
  }

  /**
   * Settle MỌI region (parity `MAP_REGIONS`) cho 1 period.
   *
   * Idempotent + race-safe per-region — gọi nhiều lần cùng `periodKey`
   * an toàn. Region rỗng được liệt kê trong `skippedRegions[]`.
   *
   * Settle tuần tự (không Promise.all) — tránh stress DB và đảm bảo log
   * theo thứ tự region. 9 region × ~2 query mỗi region → ~20 query, OK.
   */
  async settleAllRegions(
    periodKey: string,
    opts: { settledBy?: string | null } = {},
  ): Promise<TerritorySettlementRunResult> {
    if (!isTerritoryPeriodKey(periodKey)) {
      throw new TerritoryError('PERIOD_INVALID');
    }

    const snapshots: TerritorySettlementSnapshotView[] = [];
    const skipped: RegionKey[] = [];
    let runStartedAt: Date | null = null;

    for (const r of [...MAP_REGIONS].sort((a, b) => a.sortOrder - b.sortOrder)) {
      const res = await this.settleRegion(r.key, periodKey, opts);
      if (res.skipped) {
        skipped.push(r.key);
        continue;
      }
      if (res.snapshot) {
        snapshots.push(res.snapshot);
        if (!runStartedAt || new Date(res.snapshot.settledAt) < runStartedAt) {
          runStartedAt = new Date(res.snapshot.settledAt);
        }
      }
    }

    return {
      periodKey,
      settledAt: (runStartedAt ?? new Date()).toISOString(),
      snapshots,
      skippedRegions: skipped,
    };
  }

  /**
   * Đọc lịch sử settlement của 1 region — current owner + N snapshot gần
   * nhất (DESC theo `settledAt`).
   *
   * `regionKey` invalid → throw `TerritoryError('REGION_INVALID')`.
   * Region chưa từng settle → trả history với `snapshots: []` và
   * `currentOwnerSectId: null`.
   */
  async getRegionHistory(
    regionKey: string,
    limit: number = 20,
  ): Promise<TerritoryRegionHistoryView> {
    if (!isMapRegionKey(regionKey)) {
      throw new TerritoryError('REGION_INVALID');
    }
    const cap = Math.max(1, Math.min(limit, 100));

    const [state, snaps] = await Promise.all([
      this.prisma.sectTerritoryRegionState.findUnique({
        where: { regionKey },
      }),
      this.prisma.sectTerritorySettlementSnapshot.findMany({
        where: { regionKey },
        orderBy: { settledAt: 'desc' },
        take: cap,
      }),
    ]);

    return {
      regionKey,
      currentOwnerSectId: state?.ownerSectId ?? null,
      currentOwnerSectName: state?.ownerSectName ?? null,
      currentPeriodKey: state?.periodKey ?? null,
      currentSettledAt: state?.settledAt
        ? state.settledAt.toISOString()
        : null,
      snapshots: snaps.map((s) => this.toSnapshotView(s)),
    };
  }

  /**
   * Snapshot owner state cho mọi region — dùng cho
   * `TerritoryService.getRegions()` để enrich `ownerSect*` fields.
   *
   * Trả Map theo `regionKey` để O(1) lookup ở caller. Region chưa settle
   * → không có entry trong map.
   */
  async getOwnerStateMap(): Promise<
    Map<
      string,
      {
        ownerSectId: string | null;
        ownerSectName: string | null;
        periodKey: string | null;
        settledAt: Date | null;
      }
    >
  > {
    const rows = await this.prisma.sectTerritoryRegionState.findMany();
    const m = new Map<
      string,
      {
        ownerSectId: string | null;
        ownerSectName: string | null;
        periodKey: string | null;
        settledAt: Date | null;
      }
    >();
    for (const r of rows) {
      m.set(r.regionKey, {
        ownerSectId: r.ownerSectId,
        ownerSectName: r.ownerSectName,
        periodKey: r.periodKey,
        settledAt: r.settledAt,
      });
    }
    return m;
  }

  // ────────────────────────────────────────────────────────────────────
  // Helpers
  // ────────────────────────────────────────────────────────────────────

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
