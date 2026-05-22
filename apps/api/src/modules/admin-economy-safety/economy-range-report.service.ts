import { Injectable, Logger } from '@nestjs/common';
import { CurrencyKind } from '@prisma/client';
import {
  type EconomyReportRange,
  type EconomyReportResponse,
  type EconomyReportSource,
  type EconomyReportSourceRow,
  type EconomyReportTopDeltaRow,
  type EconomyReportLatestRun,
  type EconomyReportAnomalySummary,
  type EconomyReportWeekOverWeek,
  ECONOMY_REPORT_SOURCES,
  reasonToReportSource,
} from '@xuantoi/shared';
import { PrismaService } from '../../common/prisma.service';

/**
 * Phase 16.1.B — Economy Range Report service.
 *
 * Đọc `CurrencyLedger` trong [fromDate, toDateExclusive), gom theo
 * `reason` → `EconomyReportSource` bucket (mapping ở shared
 * `economy-report.ts`). Trả:
 *   - Σ in (delta > 0) / Σ out (delta < 0) per source per currency.
 *   - Net by source.
 *   - Top 10 character net delta linhThach (sorted DESC theo |net|).
 *   - Tổng per high-level category (market volume, shop spend,
 *     reforge-enchant, admin grant, topup, liveops reward, daily login,
 *     dungeon, boss, territory, sect season).
 *   - Anomaly summary (Σ open/ack/resolved + latest severity/createdAt).
 *   - Latest `EconomyLedgerCheckRun` (id, dayBucket, status, startedAt, finishedAt).
 *   - `generatedAt` ISO.
 *
 * Read-only — KHÔNG mutate DB economy table. Audit log
 * `ADMIN_ECONOMY_REPORT_VIEW` ghi ở controller layer (giữ service pure).
 *
 * Performance: 1 query `groupBy(['reason','currency'])` + 1 query
 * `groupBy(['characterId','currency'])` (LINH_THACH only) + meta queries.
 * Index `CurrencyLedger(reason, createdAt)` + `(characterId, createdAt)`
 * cover. Max range 31 ngày (validate ở shared) → query nặng tối đa
 * ~hàng triệu row scan với index — OK closed beta.
 */
@Injectable()
export class EconomyRangeReportService {
  private readonly logger = new Logger(EconomyRangeReportService.name);

  /** Limit top character delta — match spec "top 10". */
  static readonly TOP_DELTA_LIMIT = 10;

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Generate full report. Caller (controller) validate `range` qua
   * `parseEconomyReportRange()` shared trước.
   */
  async generate(range: EconomyReportRange): Promise<EconomyReportResponse> {
    const where = {
      createdAt: {
        gte: range.fromDate,
        lt: range.toDateExclusive,
      },
    };

    // 1. Aggregate by (reason, currency) — 1 query lấy đủ data cho
    // bySource + tổng. Pure SQL groupBy, không pull dòng raw vào RAM.
    const groupedByReason = await this.prisma.currencyLedger.groupBy({
      by: ['reason', 'currency'],
      where,
      _sum: { delta: true },
      _count: { _all: true },
    });

    // 2. Per-character net LINH_THACH (for top-10 sort by |net|).
    // SECT_CONTRIBUTE has both in/out so net captures real impact.
    // Limit pull = scan groupBy result (could be many — apply RAM sort).
    const groupedByCharacter = await this.prisma.currencyLedger.groupBy({
      by: ['characterId'],
      where: { ...where, currency: CurrencyKind.LINH_THACH },
      _sum: { delta: true },
    });

    // 3. Latest ledger check run.
    const latestRunRaw = await this.prisma.economyLedgerCheckRun.findFirst({
      orderBy: { startedAt: 'desc' },
      select: {
        id: true,
        dayBucket: true,
        status: true,
        startedAt: true,
        finishedAt: true,
      },
    });

    // 4. Anomaly summary (across all time — admin always wants current
    // open count; not filtered by report range to avoid hiding hot issues
    // outside window).
    const [openCount, ackCount, resolvedCount, latestAnomaly] =
      await Promise.all([
        this.prisma.economyAnomaly.count({ where: { status: 'OPEN' } }),
        this.prisma.economyAnomaly.count({
          where: { status: 'ACKNOWLEDGED' },
        }),
        this.prisma.economyAnomaly.count({ where: { status: 'RESOLVED' } }),
        this.prisma.economyAnomaly.findFirst({
          orderBy: { createdAt: 'desc' },
          select: { severity: true, createdAt: true },
        }),
      ]);

    // 5. Build per-source aggregate.
    const sourceMap = new Map<EconomyReportSource, MutableSourceRow>();
    function ensure(s: EconomyReportSource): MutableSourceRow {
      let row = sourceMap.get(s);
      if (!row) {
        row = {
          source: s,
          inLinhThach: 0n,
          outLinhThach: 0n,
          inTienNgoc: 0,
          outTienNgoc: 0,
          entryCount: 0,
        };
        sourceMap.set(s, row);
      }
      return row;
    }

    let unknownReasonCount = 0;
    for (const g of groupedByReason) {
      const source = reasonToReportSource(g.reason);
      if (source === 'OTHER' && !KNOWN_OTHER_REASONS.has(g.reason)) {
        unknownReasonCount += 1;
      }
      const row = ensure(source);
      const delta = g._sum.delta ?? 0n;
      const count = g._count?._all ?? 0;
      row.entryCount += count;
      if (g.currency === CurrencyKind.LINH_THACH) {
        if (delta >= 0n) row.inLinhThach += delta;
        else row.outLinhThach += -delta;
      } else if (g.currency === CurrencyKind.TIEN_NGOC) {
        const n = Number(delta);
        if (n >= 0) row.inTienNgoc += n;
        else row.outTienNgoc += -n;
      }
    }

    if (unknownReasonCount > 0) {
      this.logger.warn(
        `economy-range-report range=${range.from}..${range.to} unknownReasons=${unknownReasonCount} — bucketed into OTHER`,
      );
    }

    // 6. Sort + serialize bySource.
    const bySource: EconomyReportSourceRow[] = [];
    let totalInLinhThach = 0n;
    let totalOutLinhThach = 0n;
    let totalInTienNgoc = 0;
    let totalOutTienNgoc = 0;
    for (const source of ECONOMY_REPORT_SOURCES) {
      const row = sourceMap.get(source);
      if (!row) continue;
      totalInLinhThach += row.inLinhThach;
      totalOutLinhThach += row.outLinhThach;
      totalInTienNgoc += row.inTienNgoc;
      totalOutTienNgoc += row.outTienNgoc;
      bySource.push({
        source: row.source,
        inLinhThach: row.inLinhThach.toString(),
        outLinhThach: row.outLinhThach.toString(),
        netLinhThach: (row.inLinhThach - row.outLinhThach).toString(),
        inTienNgoc: row.inTienNgoc,
        outTienNgoc: row.outTienNgoc,
        netTienNgoc: row.inTienNgoc - row.outTienNgoc,
        entryCount: row.entryCount,
      });
    }
    // Stable sort: |net linhThach| desc, then |net tienNgoc|, then source.
    bySource.sort((a, b) => {
      const an = absBigIntFromString(a.netLinhThach);
      const bn = absBigIntFromString(b.netLinhThach);
      if (bn !== an) return bn > an ? 1 : -1;
      const at = Math.abs(a.netTienNgoc);
      const bt = Math.abs(b.netTienNgoc);
      if (bt !== at) return bt - at;
      return a.source.localeCompare(b.source);
    });

    // 7. Top character delta — need char/user names for top N.
    const charNetSorted = groupedByCharacter
      .map((g) => ({ characterId: g.characterId, net: g._sum.delta ?? 0n }))
      .filter((c) => c.net !== 0n)
      .sort((a, b) => {
        const an = a.net < 0n ? -a.net : a.net;
        const bn = b.net < 0n ? -b.net : b.net;
        return bn > an ? 1 : bn < an ? -1 : 0;
      })
      .slice(0, EconomyRangeReportService.TOP_DELTA_LIMIT);

    const topCharacterDelta: EconomyReportTopDeltaRow[] = [];
    if (charNetSorted.length > 0) {
      const topCharIds = charNetSorted.map((c) => c.characterId);
      const [chars, signedRaw] = await Promise.all([
        this.prisma.character.findMany({
          where: { id: { in: topCharIds } },
          select: {
            id: true,
            name: true,
            user: { select: { email: true } },
          },
        }),
        this.prisma.currencyLedger.groupBy({
          by: ['characterId', 'currency'],
          where: { ...where, currency: CurrencyKind.LINH_THACH, characterId: { in: topCharIds } },
          _sum: { delta: true },
        }),
      ]);
      // Build per-character in/out separately (groupBy above only gave net).
      const inOutMap = new Map<string, { in: bigint; out: bigint }>();
      // Need separate query for in/out — groupBy doesn't support
      // conditional sum. Do 2 lightweight follow-up queries.
      const [posSums, negSums] = await Promise.all([
        this.prisma.currencyLedger.groupBy({
          by: ['characterId'],
          where: {
            ...where,
            currency: CurrencyKind.LINH_THACH,
            characterId: { in: topCharIds },
            delta: { gt: 0n },
          },
          _sum: { delta: true },
        }),
        this.prisma.currencyLedger.groupBy({
          by: ['characterId'],
          where: {
            ...where,
            currency: CurrencyKind.LINH_THACH,
            characterId: { in: topCharIds },
            delta: { lt: 0n },
          },
          _sum: { delta: true },
        }),
      ]);
      for (const p of posSums) {
        const cur = inOutMap.get(p.characterId) ?? { in: 0n, out: 0n };
        cur.in = p._sum.delta ?? 0n;
        inOutMap.set(p.characterId, cur);
      }
      for (const n of negSums) {
        const cur = inOutMap.get(n.characterId) ?? { in: 0n, out: 0n };
        cur.out = -(n._sum.delta ?? 0n);
        inOutMap.set(n.characterId, cur);
      }
      // Silence unused var warning for signedRaw — kept for future extension.
      void signedRaw;
      const charByIdMap = new Map(chars.map((c) => [c.id, c]));
      for (const cn of charNetSorted) {
        const ch = charByIdMap.get(cn.characterId);
        const io = inOutMap.get(cn.characterId) ?? { in: 0n, out: 0n };
        topCharacterDelta.push({
          characterId: cn.characterId,
          characterName: ch?.name ?? null,
          userEmail: ch?.user?.email ?? null,
          netLinhThach: cn.net.toString(),
          inLinhThach: io.in.toString(),
          outLinhThach: io.out.toString(),
        });
      }
    }

    // 8. High-level category totals — pre-defined buckets that admins
    // most care about. Source map ensures consistency with bySource.
    const totalsBySource = sourceMap;
    const marketVolume =
      sumOutLinhThach(totalsBySource, 'MARKET') +
      sumInLinhThach(totalsBySource, 'MARKET');
    const shopSpend = sumOutLinhThach(totalsBySource, 'SHOP');
    const sectShopSpend = sumOutLinhThach(totalsBySource, 'SECT_SHOP');
    const reforgeEnchantSpend = sumOutLinhThach(
      totalsBySource,
      'REFORGE_ENCHANT',
    );
    const adminGrantTotal = sumInLinhThach(totalsBySource, 'ADMIN_GRANT');
    const topupTotal = sumInLinhThach(totalsBySource, 'TOPUP');
    const liveOpsRewardTotal = sumInLinhThach(totalsBySource, 'LIVEOPS_REWARD');
    const dailyLoginRewardTotal = sumInLinhThach(
      totalsBySource,
      'DAILY_LOGIN',
    );
    const dungeonRewardTotal =
      sumInLinhThach(totalsBySource, 'DUNGEON_REWARD') +
      sumInLinhThach(totalsBySource, 'COMBAT_LOOT');
    const bossRewardTotal = sumInLinhThach(totalsBySource, 'BOSS_REWARD');
    const territoryRewardTotal = sumInLinhThach(
      totalsBySource,
      'TERRITORY_REWARD',
    );
    const sectSeasonRewardTotal =
      sumInLinhThach(totalsBySource, 'SECT_SEASON_REWARD') +
      sumInLinhThach(totalsBySource, 'SECT_WAR_REWARD');

    const anomalySummary: EconomyReportAnomalySummary = {
      openCount,
      acknowledgedCount: ackCount,
      resolvedCount,
      latestSeverity:
        latestAnomaly && (latestAnomaly.severity === 'INFO' ||
          latestAnomaly.severity === 'WARN' ||
          latestAnomaly.severity === 'CRITICAL')
          ? latestAnomaly.severity
          : null,
      latestCreatedAt: latestAnomaly?.createdAt.toISOString() ?? null,
    };

    const latestLedgerCheckRun: EconomyReportLatestRun | null = latestRunRaw
      ? {
          id: latestRunRaw.id,
          dayBucket: latestRunRaw.dayBucket,
          status: latestRunRaw.status,
          startedAt: latestRunRaw.startedAt.toISOString(),
          finishedAt: latestRunRaw.finishedAt?.toISOString() ?? null,
        }
      : null;

    return {
      range: { from: range.from, to: range.to, days: range.days },
      bySource,
      totalInLinhThach: totalInLinhThach.toString(),
      totalOutLinhThach: totalOutLinhThach.toString(),
      totalNetLinhThach: (totalInLinhThach - totalOutLinhThach).toString(),
      totalInTienNgoc,
      totalOutTienNgoc,
      totalNetTienNgoc: totalInTienNgoc - totalOutTienNgoc,
      topCharacterDelta,
      marketVolume: marketVolume.toString(),
      shopSpend: shopSpend.toString(),
      sectShopSpend: sectShopSpend.toString(),
      reforgeEnchantSpend: reforgeEnchantSpend.toString(),
      adminGrantTotal: adminGrantTotal.toString(),
      topupTotal: topupTotal.toString(),
      liveOpsRewardTotal: liveOpsRewardTotal.toString(),
      dailyLoginRewardTotal: dailyLoginRewardTotal.toString(),
      dungeonRewardTotal: dungeonRewardTotal.toString(),
      bossRewardTotal: bossRewardTotal.toString(),
      territoryRewardTotal: territoryRewardTotal.toString(),
      sectSeasonRewardTotal: sectSeasonRewardTotal.toString(),
      anomalySummary,
      latestLedgerCheckRun,
      generatedAt: new Date().toISOString(),
    };
  }

  /**
   * Generate report for `range` + optional week-over-week comparison.
   * When `compareWithPreviousWeek=true`, runs a second `generate()` for
   * the 7-day window immediately before `range.fromDate` and computes
   * key metric deltas (current - previous).
   */
  async generateWithComparison(
    range: EconomyReportRange,
    compareWithPreviousWeek: boolean,
  ): Promise<EconomyReportResponse> {
    const current = await this.generate(range);
    if (!compareWithPreviousWeek) return current;

    // Build previous-week range: same number of days ending at range.fromDate.
    const prevTo = new Date(range.fromDate);
    const prevFrom = new Date(range.fromDate);
    prevFrom.setDate(prevFrom.getDate() - range.days);

    const prevRange: EconomyReportRange = {
      from: prevFrom.toISOString().slice(0, 10),
      to: prevTo.toISOString().slice(0, 10),
      fromDate: prevFrom,
      toDateExclusive: prevTo,
      days: range.days,
    };

    let previous: EconomyReportResponse;
    try {
      previous = await this.generate(prevRange);
    } catch (e) {
      this.logger.warn(`generateWithComparison: previous week failed — ${(e as Error).message}`);
      return current;
    }

    const netDelta =
      BigInt(current.totalNetLinhThach) - BigInt(previous.totalNetLinhThach);
    const marketDelta =
      BigInt(current.marketVolume) - BigInt(previous.marketVolume);
    const adminGrantDelta =
      BigInt(current.adminGrantTotal) - BigInt(previous.adminGrantTotal);
    const anomalyDelta =
      current.anomalySummary.openCount - previous.anomalySummary.openCount;
    const inDelta =
      BigInt(current.totalInLinhThach) - BigInt(previous.totalInLinhThach);
    const outDelta =
      BigInt(current.totalOutLinhThach) - BigInt(previous.totalOutLinhThach);

    const weekOverWeek: EconomyReportWeekOverWeek = {
      previousFrom: prevRange.from,
      previousTo: prevRange.to,
      netLinhThachDelta: netDelta.toString(),
      marketVolumeDelta: marketDelta.toString(),
      adminGrantDelta: adminGrantDelta.toString(),
      anomalyOpenDelta: anomalyDelta,
      totalInDelta: inDelta.toString(),
      totalOutDelta: outDelta.toString(),
    };

    return { ...current, weekOverWeek };
  }
}

interface MutableSourceRow {
  source: EconomyReportSource;
  inLinhThach: bigint;
  outLinhThach: bigint;
  inTienNgoc: number;
  outTienNgoc: number;
  entryCount: number;
}

function sumInLinhThach(
  map: Map<EconomyReportSource, MutableSourceRow>,
  source: EconomyReportSource,
): bigint {
  return map.get(source)?.inLinhThach ?? 0n;
}

function sumOutLinhThach(
  map: Map<EconomyReportSource, MutableSourceRow>,
  source: EconomyReportSource,
): bigint {
  return map.get(source)?.outLinhThach ?? 0n;
}

function absBigIntFromString(s: string): bigint {
  const v = BigInt(s);
  return v < 0n ? -v : v;
}

/**
 * Reason strings KNOWN to be in legacy/test ledger that we WANT to count
 * as `OTHER` without warning. Reduces noisy log warnings for expected
 * fallthroughs (e.g. INITIAL tests sometimes use ad-hoc reasons).
 */
const KNOWN_OTHER_REASONS = new Set<string>([
  'A',
  'B',
  'PARTIAL',
  'TEST',
  'TEST_INFLATE',
  'TEST_TIE',
  'USE',
]);
