import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  MAP_REGIONS,
  REGION_KEYS,
  TERRITORY_INFLUENCE_SOURCES,
  isMapRegionKey,
  territoryRegionByKey,
  territorySourceByKey,
  type RegionKey,
  type TerritoryInfluenceSourceKey,
  type TerritoryInfluenceSourceType,
  type TerritoryLeaderboardRow,
  type TerritoryLeaderboardView,
  type TerritoryMyRegionRow,
  type TerritoryMyView,
  type TerritoryRegionView,
  type TerritoryRegionsView,
} from '@xuantoi/shared';
import { PrismaService } from '../../common/prisma.service';
import { startOfLocalDay } from '../combat/combat.service';
import { getMissionResetTz } from '../mission/mission.service';
import { TerritorySettlementService } from './territory-settlement.service';

/**
 * Phase 14.0.A — Sect Territory Influence Foundation runtime service.
 *
 * Server-authoritative invariants:
 *   - {@link addInfluenceTx} là entry point duy nhất cho mọi gameplay
 *     hook (dungeon claim, boss reward). Caller truyền `tx` vì side-effect
 *     ghi điểm phải atomic với gameplay flow parent (claim / reward / etc.).
 *     Nếu character không thuộc sect → no-op (skip safely).
 *   - Idempotency qua composite UNIQUE
 *     `(regionKey, characterId, sourceKey, sourceType, sourceId)`. Cùng
 *     entity (vd cùng dungeonRunId / `bossId:characterId`) gọi nhiều lần
 *     chỉ ghi 1 row → P2002 swallow.
 *   - Cap enforcement (daily/weekly) compute TRƯỚC khi insert: query
 *     existing sum cho character + sourceKey + region trong cửa sổ → reject
 *     nếu vượt cap. Cap reject KHÔNG raise error — chỉ return null
 *     (no-op, gameplay flow vẫn thành công).
 *
 * Đọc API:
 *   - {@link getRegions}: list 9 region + total influence + top sect snapshot.
 *   - {@link getRegionLeaderboard}: top N sect trong region.
 *   - {@link getMyTerritory}: per-region rank/points của sect user + personal
 *     contribution.
 *
 * Phase 14.0.A KHÔNG xử lý:
 *   - Decay điểm theo thời gian (defer 14.0.B+).
 *   - Settlement capture / siege / region buff (defer 14.x).
 *   - Sect mission hook (mission không gắn region — defer).
 */

const LEADERBOARD_TOP = 10;

/**
 * Aggregate row của 1 sect trong 1 region trước khi enrich tên.
 */
interface RegionAggRow {
  sectId: string;
  points: number;
}

@Injectable()
export class TerritoryService {
  private readonly logger = new Logger(TerritoryService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly settlement: TerritorySettlementService,
  ) {}

  // ────────────────────────────────────────────────────────────────────
  // Contribution hook (server-authoritative entry point)
  // ────────────────────────────────────────────────────────────────────

  /**
   * Tx-aware: ghi 1 influence row trong cùng transaction với gameplay flow
   * parent. Idempotent qua composite UNIQUE — caller có thể retry an toàn.
   *
   * Trả về `null` nếu:
   *   - Character không có sect (skip safely, không log).
   *   - Region key không hợp lệ (`!isMapRegionKey`).
   *   - Source key không hợp lệ.
   *   - Cap reached (daily/weekly).
   *   - Source idempotency hit (P2002 swallow).
   *
   * KHÔNG throw — gameplay flow phải continue dù territory ghi điểm fail.
   */
  async addInfluenceTx(
    tx: Prisma.TransactionClient,
    params: {
      characterId: string;
      regionKey: string;
      sourceKey: TerritoryInfluenceSourceKey;
      sourceId: string | null;
      now?: Date;
    },
  ): Promise<{
    regionKey: RegionKey;
    sectId: string;
    points: number;
  } | null> {
    if (!isMapRegionKey(params.regionKey)) return null;
    const def = territorySourceByKey(params.sourceKey);
    if (!def) return null;

    const char = await tx.character.findUnique({
      where: { id: params.characterId },
      select: { id: true, sectId: true },
    });
    if (!char || !char.sectId) return null;

    const now = params.now ?? new Date();
    const regionKey = params.regionKey;
    const sectId = char.sectId;

    // Cap check: query SUM của characterId + sourceKey + region trong window.
    if (def.weeklyCap !== undefined && def.weeklyCap > 0) {
      // Weekly window cap: rolling 7d cho Phase 14.0.A — không có season
      // reset persistence (defer 14.0.B+ decay/season). Tính 7d retro để
      // cap không bị bỏ qua nếu sect war ISO weekKey shift sang khác.
      const weekStart = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      const agg = await tx.sectTerritoryInfluence.aggregate({
        where: {
          regionKey,
          characterId: char.id,
          sourceKey: def.key,
          createdAt: { gte: weekStart },
        },
        _sum: { points: true },
      });
      const used = agg._sum.points ?? 0;
      if (used + def.points > def.weeklyCap) return null;
    }
    if (def.dailyCap !== undefined && def.dailyCap > 0) {
      // Daily window: 00:00 → 24:00 local theo `MISSION_RESET_TZ`
      // (default `Asia/Ho_Chi_Minh`). Reuse `startOfLocalDay()` từ
      // combat.service — nhất quán với dungeon dailyLimit / mission DAILY /
      // sect war daily cap, đều reset 00:00 ICT.
      const tz = getMissionResetTz();
      const dayStart = startOfLocalDay(now, tz);
      const agg = await tx.sectTerritoryInfluence.aggregate({
        where: {
          regionKey,
          characterId: char.id,
          sourceKey: def.key,
          createdAt: { gte: dayStart },
        },
        _sum: { points: true },
      });
      const used = agg._sum.points ?? 0;
      if (used + def.points > def.dailyCap) return null;
    }

    try {
      await tx.sectTerritoryInfluence.create({
        data: {
          regionKey,
          sectId,
          characterId: char.id,
          sourceKey: def.key,
          sourceType: def.sourceType as TerritoryInfluenceSourceType,
          sourceId: params.sourceId,
          points: def.points,
        },
      });
      return { regionKey, sectId, points: def.points };
    } catch (e) {
      if (
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === 'P2002'
      ) {
        // Duplicate (regionKey, characterId, sourceKey, sourceType, sourceId)
        // → already credited. Idempotent.
        return null;
      }
      throw e;
    }
  }

  // ────────────────────────────────────────────────────────────────────
  // Read APIs
  // ────────────────────────────────────────────────────────────────────

  /**
   * List mọi region (parity `MAP_REGIONS`) + total influence + top sect
   * snapshot. Order theo `MapRegionDef.sortOrder` ascending.
   *
   * Region không có influence row vẫn xuất hiện với totalPoints=0,
   * topSect=null — FE hiển thị `—` thay vì hide region.
   */
  async getRegions(): Promise<TerritoryRegionsView> {
    const grouped = await this.prisma.sectTerritoryInfluence.groupBy({
      by: ['regionKey', 'sectId'],
      _sum: { points: true },
    });

    // Distinct contributors per region (count distinct characterId).
    const contribRows = await this.prisma.sectTerritoryInfluence.groupBy({
      by: ['regionKey', 'characterId'],
    });
    const contribByRegion = new Map<string, number>();
    for (const r of contribRows) {
      contribByRegion.set(
        r.regionKey,
        (contribByRegion.get(r.regionKey) ?? 0) + 1,
      );
    }

    // Bucket grouped rows theo region.
    const byRegion = new Map<string, RegionAggRow[]>();
    for (const g of grouped) {
      const arr = byRegion.get(g.regionKey) ?? [];
      arr.push({ sectId: g.sectId, points: g._sum.points ?? 0 });
      byRegion.set(g.regionKey, arr);
    }

    // Resolve sect names cho top sect mỗi region (1 batch query).
    const topSectIds = new Set<string>();
    for (const [, rows] of byRegion) {
      if (rows.length === 0) continue;
      rows.sort(
        (a, b) =>
          b.points - a.points || a.sectId.localeCompare(b.sectId),
      );
      topSectIds.add(rows[0].sectId);
    }
    const sectNames = new Map<string, string>();
    if (topSectIds.size > 0) {
      const sects = await this.prisma.sect.findMany({
        where: { id: { in: [...topSectIds] } },
        select: { id: true, name: true },
      });
      for (const s of sects) sectNames.set(s.id, s.name);
    }

    // Phase 14.0.B — enrich owner state from `SectTerritoryRegionState`.
    // Region chưa settle → ownerSect* = null (FE hiển thị `—`).
    const ownerStateMap = await this.settlement.getOwnerStateMap();

    const regions: TerritoryRegionView[] = MAP_REGIONS.map((r) => {
      const rows = byRegion.get(r.key) ?? [];
      const totalPoints = rows.reduce((a, b) => a + b.points, 0);
      const top = rows[0];
      const owner = ownerStateMap.get(r.key) ?? null;
      return {
        regionKey: r.key,
        nameVi: r.nameVi,
        nameEn: r.nameEn,
        flavorVi: r.flavorVi,
        flavorEn: r.flavorEn,
        unlockRealmKey: r.unlockRealmKey,
        sortOrder: r.sortOrder,
        dominantElement: r.dominantElement ?? null,
        totalPoints,
        contributors: contribByRegion.get(r.key) ?? 0,
        topSectId: top?.sectId ?? null,
        topSectName: top ? sectNames.get(top.sectId) ?? top.sectId : null,
        topSectPoints: top?.points ?? 0,
        ownerSectId: owner?.ownerSectId ?? null,
        ownerSectName: owner?.ownerSectName ?? null,
        ownerPeriodKey: owner?.periodKey ?? null,
        ownerSettledAt: owner?.settledAt
          ? owner.settledAt.toISOString()
          : null,
      };
    });

    regions.sort((a, b) => a.sortOrder - b.sortOrder);
    return { regions };
  }

  /**
   * Top N sect trong 1 region. Throw `TerritoryError('REGION_INVALID')`
   * nếu regionKey không hợp lệ. Region không có influence row trả rows=[].
   */
  async getRegionLeaderboard(
    regionKey: string,
  ): Promise<TerritoryLeaderboardView> {
    if (!isMapRegionKey(regionKey)) {
      throw new TerritoryError('REGION_INVALID');
    }
    const grouped = await this.prisma.sectTerritoryInfluence.groupBy({
      by: ['sectId'],
      where: { regionKey },
      _sum: { points: true },
    });
    grouped.sort(
      (a, b) =>
        (b._sum.points ?? 0) - (a._sum.points ?? 0) ||
        a.sectId.localeCompare(b.sectId),
    );
    const top = grouped.slice(0, LEADERBOARD_TOP);
    if (top.length === 0) return { regionKey, rows: [] };

    const sects = await this.prisma.sect.findMany({
      where: { id: { in: top.map((g) => g.sectId) } },
      select: { id: true, name: true },
    });
    const nameMap = new Map(sects.map((s) => [s.id, s.name]));

    // Distinct contributors per sect.
    const contribCounts = await this.prisma.sectTerritoryInfluence.groupBy({
      by: ['sectId', 'characterId'],
      where: { regionKey, sectId: { in: top.map((g) => g.sectId) } },
    });
    const contribByS = new Map<string, number>();
    for (const r of contribCounts) {
      contribByS.set(r.sectId, (contribByS.get(r.sectId) ?? 0) + 1);
    }
    const rows: TerritoryLeaderboardRow[] = top.map((g, i) => ({
      rank: i + 1,
      sectId: g.sectId,
      sectName: nameMap.get(g.sectId) ?? g.sectId,
      points: g._sum.points ?? 0,
      contributors: contribByS.get(g.sectId) ?? 0,
    }));
    return { regionKey, rows };
  }

  /**
   * Personal view: per-region rank/points của sect user + personal
   * contribution. User không có character → throw NO_CHARACTER. User
   * có character nhưng không thuộc sect → trả `hasSect=false`,
   * regions[]=mọi region với sectPoints=0, sectRank=null,
   * personalPoints=character's own contribution (nếu có).
   */
  async getMyTerritory(userId: string): Promise<TerritoryMyView> {
    const char = await this.prisma.character.findUnique({
      where: { userId },
      select: { id: true, sectId: true },
    });
    if (!char) throw new TerritoryError('NO_CHARACTER');

    let sectName: string | null = null;
    if (char.sectId) {
      const s = await this.prisma.sect.findUnique({
        where: { id: char.sectId },
        select: { name: true },
      });
      sectName = s?.name ?? null;
    }

    // Per-region personal points (mọi region).
    const personalRows = await this.prisma.sectTerritoryInfluence.groupBy({
      by: ['regionKey'],
      where: { characterId: char.id },
      _sum: { points: true },
    });
    const personalByRegion = new Map<string, number>();
    for (const r of personalRows) {
      personalByRegion.set(r.regionKey, r._sum.points ?? 0);
    }

    // Per-region sect aggregate (chỉ cần nếu có sect).
    const sectByRegion = new Map<string, number>();
    if (char.sectId) {
      const sectRows = await this.prisma.sectTerritoryInfluence.groupBy({
        by: ['regionKey'],
        where: { sectId: char.sectId },
        _sum: { points: true },
      });
      for (const r of sectRows) {
        sectByRegion.set(r.regionKey, r._sum.points ?? 0);
      }
    }

    // Per-region rank lookup: cần SUM theo sectId trong region để compute
    // rank. Cache theo region để tránh round-trip nhiều lần.
    const rankCache = new Map<string, Map<string, number>>();
    async function getRanksForRegion(
      svc: TerritoryService,
      key: string,
    ): Promise<Map<string, number>> {
      const cached = rankCache.get(key);
      if (cached) return cached;
      const grouped =
        await svc.prisma.sectTerritoryInfluence.groupBy({
          by: ['sectId'],
          where: { regionKey: key },
          _sum: { points: true },
        });
      grouped.sort(
        (a, b) =>
          (b._sum.points ?? 0) - (a._sum.points ?? 0) ||
          a.sectId.localeCompare(b.sectId),
      );
      const map = new Map<string, number>();
      grouped.forEach((g, i) => map.set(g.sectId, i + 1));
      rankCache.set(key, map);
      return map;
    }

    const regions: TerritoryMyRegionRow[] = [];
    for (const r of [...MAP_REGIONS].sort(
      (a, b) => a.sortOrder - b.sortOrder,
    )) {
      const sectPoints = sectByRegion.get(r.key) ?? 0;
      let sectRank: number | null = null;
      if (char.sectId && sectPoints > 0) {
        const ranks = await getRanksForRegion(this, r.key);
        sectRank = ranks.get(char.sectId) ?? null;
      }
      regions.push({
        regionKey: r.key,
        nameVi: r.nameVi,
        nameEn: r.nameEn,
        sectPoints,
        sectRank,
        personalPoints: personalByRegion.get(r.key) ?? 0,
      });
    }

    return {
      hasSect: !!char.sectId,
      sectId: char.sectId,
      sectName,
      regions,
    };
  }
}

// ────────────────────────────────────────────────────────────────────────
// Errors
// ────────────────────────────────────────────────────────────────────────

export type TerritoryErrorCode =
  | 'NO_CHARACTER'
  | 'REGION_INVALID'
  | 'PERIOD_INVALID';

export class TerritoryError extends Error {
  readonly code: TerritoryErrorCode;
  constructor(code: TerritoryErrorCode, message?: string) {
    super(message ?? code);
    this.name = 'TerritoryError';
    this.code = code;
  }
}

// Re-export types for tests / controllers.
export {
  REGION_KEYS,
  TERRITORY_INFLUENCE_SOURCES,
  territoryRegionByKey,
};
