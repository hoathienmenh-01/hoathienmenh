import { Injectable, Logger } from '@nestjs/common';
import { CurrencyKind } from '@prisma/client';
import {
  type EconomyAnomalySeverity,
  type EconomyAnomalySource,
  deriveSeverityForValue,
  getEconomyAnomalyRule,
  getMarketPriceBandForItem,
  itemByKey,
} from '@xuantoi/shared';
import { PrismaService } from '../../common/prisma.service';

/**
 * Phase 16.6 — Economy Anomaly Scanner.
 *
 * Detection-only service: rà soát log economy 24h gần nhất, đối chiếu
 * `ECONOMY_ANOMALY_RULES` (thresholds shared catalog) và CREATE rows
 * `EconomyAnomaly` để admin xem panel.
 *
 * Idempotency:
 *   - `EconomyAnomaly @@unique([source, characterId, windowKey])` —
 *     scanner gọi lại trên cùng cửa sổ KHÔNG tạo anomaly trùng cho
 *     cùng character.
 *   - Caller (cron / admin endpoint) tự derive `windowKey` (vd
 *     `'24h:2026-05-09'` cho daily, `'6h:2026-05-09T12'` cho 6h block).
 *
 * Policy: detection + reporting only. KHÔNG ban / KHÔNG rollback /
 * KHÔNG public notify. Admin tự xem panel + quyết định.
 */

export interface ScanOptions {
  /** Override `now` cho test reproducible. */
  now?: Date;
  /**
   * Window key nguồn — vd `'24h:2026-05-09'`. Caller tự build cho
   * deterministic. Nếu missing, scanner derive `24h:<YYYY-MM-DD>` từ
   * `now` UTC.
   */
  windowKey?: string;
  /**
   * Cửa sổ thời gian rà soát (ms). Default 24h. Phải > 0.
   */
  windowMs?: number;
}

export interface AnomalyScanSummary {
  windowKey: string;
  topCurrencyDelta: number;
  rareItemGain: number;
  rewardCapBypass: number;
  marketOutlier: number;
  totalAnomaliesCreated: number;
  totalAnomaliesSkipped: number;
}

const DEFAULT_WINDOW_MS = 24 * 3600 * 1000;
const RARE_QUALITIES = new Set(['TIEN', 'THAN']);

@Injectable()
export class EconomyAnomalyScannerService {
  private readonly logger = new Logger(EconomyAnomalyScannerService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Chạy 1 lượt scan đầy đủ (4 rule tự động — `ADMIN_GRANT_OVER_LIMIT`
   * có hook real-time riêng từ `AdminService.grantCurrency`).
   *
   * Fail-soft: 1 rule throw không lật ngược các rule khác. Caller cron
   * có thể wrap thêm Sentry capture nếu cần.
   */
  async scanAll(options: ScanOptions = {}): Promise<AnomalyScanSummary> {
    const now = options.now ?? new Date();
    const windowMs = options.windowMs ?? DEFAULT_WINDOW_MS;
    const windowKey = options.windowKey ?? defaultWindowKey(now);

    let topCurrencyDelta = 0;
    let rareItemGain = 0;
    let rewardCapBypass = 0;
    let marketOutlier = 0;
    let totalAnomaliesCreated = 0;
    let totalAnomaliesSkipped = 0;

    try {
      const r = await this.scanTopCurrencyDelta24h({ now, windowKey, windowMs });
      topCurrencyDelta = r.created;
      totalAnomaliesCreated += r.created;
      totalAnomaliesSkipped += r.skipped;
    } catch (e) {
      this.logger.error(`scanTopCurrencyDelta24h failed: ${(e as Error).message}`);
    }

    try {
      const r = await this.scanRareItemGain({ now, windowKey, windowMs });
      rareItemGain = r.created;
      totalAnomaliesCreated += r.created;
      totalAnomaliesSkipped += r.skipped;
    } catch (e) {
      this.logger.error(`scanRareItemGain failed: ${(e as Error).message}`);
    }

    try {
      const r = await this.scanRewardCapBypass({ now, windowKey, windowMs });
      rewardCapBypass = r.created;
      totalAnomaliesCreated += r.created;
      totalAnomaliesSkipped += r.skipped;
    } catch (e) {
      this.logger.error(`scanRewardCapBypass failed: ${(e as Error).message}`);
    }

    try {
      const r = await this.scanMarketOutlier({ now, windowKey, windowMs });
      marketOutlier = r.created;
      totalAnomaliesCreated += r.created;
      totalAnomaliesSkipped += r.skipped;
    } catch (e) {
      this.logger.error(`scanMarketOutlier failed: ${(e as Error).message}`);
    }

    return {
      windowKey,
      topCurrencyDelta,
      rareItemGain,
      rewardCapBypass,
      marketOutlier,
      totalAnomaliesCreated,
      totalAnomaliesSkipped,
    };
  }

  /**
   * Rule 1 — Top character có |Σ delta linhThach| trong 24h vượt threshold.
   */
  async scanTopCurrencyDelta24h(args: {
    now: Date;
    windowKey: string;
    windowMs: number;
  }): Promise<{ created: number; skipped: number }> {
    const rule = getEconomyAnomalyRule('CURRENCY_DELTA_24H');
    const cutoff = new Date(args.now.getTime() - args.windowMs);

    // Group SUM(delta) per character for LINH_THACH currency.
    const grouped = await this.prisma.currencyLedger.groupBy({
      by: ['characterId'],
      where: {
        createdAt: { gte: cutoff },
        currency: CurrencyKind.LINH_THACH,
      },
      _sum: { delta: true },
    });

    let created = 0;
    let skipped = 0;
    for (const g of grouped) {
      const sum = g._sum.delta ?? 0n;
      const severity = deriveSeverityForValue(sum, rule);
      if (!severity) continue;
      const wrote = await this.upsertAnomaly({
        source: 'CURRENCY_DELTA_24H',
        severity,
        characterId: g.characterId,
        userId: null,
        windowKey: args.windowKey,
        details: {
          sumLinhThach: sum.toString(),
          warnThreshold: rule.warnThreshold.toString(),
          criticalThreshold: rule.criticalThreshold.toString(),
          windowMs: args.windowMs,
        },
      });
      if (wrote) created += 1;
      else skipped += 1;
    }
    return { created, skipped };
  }

  /**
   * Rule 2 — Character nhận quá nhiều item rarity TIEN+ trong window.
   */
  async scanRareItemGain(args: {
    now: Date;
    windowKey: string;
    windowMs: number;
  }): Promise<{ created: number; skipped: number }> {
    const rule = getEconomyAnomalyRule('RARE_ITEM_GAIN_24H');
    const cutoff = new Date(args.now.getTime() - args.windowMs);

    // Lấy tất cả item gain rows trong window (qtyDelta > 0). Sau đó filter
    // rarity ở memory (catalog item nhỏ — không phải scan toàn bộ DB).
    const rows = await this.prisma.itemLedger.findMany({
      where: {
        createdAt: { gte: cutoff },
        qtyDelta: { gt: 0 },
      },
      select: {
        characterId: true,
        itemKey: true,
        qtyDelta: true,
      },
    });

    // Tổng rare item gained per character.
    const rareGainPerChar = new Map<string, number>();
    for (const r of rows) {
      const def = itemByKey(r.itemKey);
      if (!def) continue;
      if (!RARE_QUALITIES.has(def.quality)) continue;
      rareGainPerChar.set(
        r.characterId,
        (rareGainPerChar.get(r.characterId) ?? 0) + r.qtyDelta,
      );
    }

    let created = 0;
    let skipped = 0;
    for (const [characterId, gain] of rareGainPerChar.entries()) {
      const severity = deriveSeverityForValue(BigInt(gain), rule);
      if (!severity) continue;
      const wrote = await this.upsertAnomaly({
        source: 'RARE_ITEM_GAIN_24H',
        severity,
        characterId,
        userId: null,
        windowKey: args.windowKey,
        details: {
          rareItemQtyGained: gain,
          warnThreshold: rule.warnThreshold.toString(),
          criticalThreshold: rule.criticalThreshold.toString(),
          windowMs: args.windowMs,
        },
      });
      if (wrote) created += 1;
      else skipped += 1;
    }
    return { created, skipped };
  }

  /**
   * Rule 3 — Character chạm RewardCap quá nhiều lần trong window.
   */
  async scanRewardCapBypass(args: {
    now: Date;
    windowKey: string;
    windowMs: number;
  }): Promise<{ created: number; skipped: number }> {
    const rule = getEconomyAnomalyRule('REWARD_CAP_BYPASS');
    const cutoff = new Date(args.now.getTime() - args.windowMs);

    const grouped = await this.prisma.rewardCapEvent.groupBy({
      by: ['characterId'],
      where: { createdAt: { gte: cutoff } },
      _count: { _all: true },
    });

    let created = 0;
    let skipped = 0;
    for (const g of grouped) {
      const count = BigInt(g._count?._all ?? 0);
      const severity = deriveSeverityForValue(count, rule);
      if (!severity) continue;
      const wrote = await this.upsertAnomaly({
        source: 'REWARD_CAP_BYPASS',
        severity,
        characterId: g.characterId,
        userId: null,
        windowKey: args.windowKey,
        details: {
          capEventCount: Number(count),
          warnThreshold: rule.warnThreshold.toString(),
          criticalThreshold: rule.criticalThreshold.toString(),
          windowMs: args.windowMs,
        },
      });
      if (wrote) created += 1;
      else skipped += 1;
    }
    return { created, skipped };
  }

  /**
   * Rule 4 — Listing market hiện tại có pricePerUnit ngoài band.
   *
   * Phase 16.6: market service runtime đã reject ngoài band tại post.
   * Scanner chỉ catch các listing tồn tại từ trước Phase 16.6 (legacy)
   * hoặc band thay đổi sau khi listing post. Severity WARN/CRITICAL
   * theo bội số ceiling.
   */
  async scanMarketOutlier(args: {
    now: Date;
    windowKey: string;
    windowMs: number;
  }): Promise<{ created: number; skipped: number }> {
    const cutoff = new Date(args.now.getTime() - args.windowMs);

    // Chỉ scan listing ACTIVE post trong window — listing rất cũ thường
    // đã bị filter market UI / không cần re-flag.
    const listings = await this.prisma.listing.findMany({
      where: {
        status: 'ACTIVE',
        createdAt: { gte: cutoff },
      },
      select: {
        id: true,
        sellerId: true,
        itemKey: true,
        pricePerUnit: true,
      },
    });

    const rule = getEconomyAnomalyRule('MARKET_OUTLIER');
    let created = 0;
    let skipped = 0;
    for (const l of listings) {
      const band = getMarketPriceBandForItem(l.itemKey);
      const ceiling = band.maxPrice;
      const ratio = ceiling > 0n ? l.pricePerUnit / ceiling : 0n;
      // ratio < 1 = trong band → bỏ qua. ratio ≥ warnThreshold (10x ceiling) → flag.
      const severity = deriveSeverityForValue(ratio, rule);
      if (!severity) continue;
      const wrote = await this.upsertAnomaly({
        source: 'MARKET_OUTLIER',
        severity,
        characterId: l.sellerId,
        userId: null,
        windowKey: args.windowKey,
        details: {
          listingId: l.id,
          itemKey: l.itemKey,
          pricePerUnit: l.pricePerUnit.toString(),
          bandMin: band.minPrice.toString(),
          bandMax: band.maxPrice.toString(),
          ratioToCeiling: ratio.toString(),
          windowMs: args.windowMs,
        },
      });
      if (wrote) created += 1;
      else skipped += 1;
    }
    return { created, skipped };
  }

  /**
   * Rule 5 — Hook real-time: admin grant currency vượt threshold.
   *
   * Caller `AdminService.grantCurrency` gọi trực tiếp sau khi grant
   * thành công. KHÔNG cron — chạy ngay khi event xảy ra để admin grant
   * lớn xuất hiện trong panel cùng lúc với log audit.
   *
   * Trả về anomaly đã tạo (hoặc null nếu skipped vì duplicate windowKey).
   */
  async scanAdminGrantOverLimit(args: {
    actorUserId: string;
    targetCharacterId: string;
    targetUserId: string;
    delta: bigint;
    reason: string;
    now?: Date;
  }): Promise<{ created: boolean; severity: EconomyAnomalySeverity | null }> {
    const rule = getEconomyAnomalyRule('ADMIN_GRANT_OVER_LIMIT');
    const severity = deriveSeverityForValue(args.delta, rule);
    if (!severity) return { created: false, severity: null };
    const now = args.now ?? new Date();
    // windowKey unique per grant event — dùng timestamp ms + actor + target
    // để KHÔNG dedupe các grant khác nhau cùng character.
    const windowKey = `grant:${now.getTime()}:${args.actorUserId}`;
    const wrote = await this.upsertAnomaly({
      source: 'ADMIN_GRANT_OVER_LIMIT',
      severity,
      characterId: args.targetCharacterId,
      userId: args.actorUserId,
      windowKey,
      details: {
        targetUserId: args.targetUserId,
        delta: args.delta.toString(),
        reason: args.reason.length > 200 ? args.reason.slice(0, 200) : args.reason,
        warnThreshold: rule.warnThreshold.toString(),
        criticalThreshold: rule.criticalThreshold.toString(),
      },
    });
    return { created: wrote, severity };
  }

  // ----- helpers -----

  private async upsertAnomaly(args: {
    source: EconomyAnomalySource;
    severity: EconomyAnomalySeverity;
    characterId: string | null;
    userId: string | null;
    windowKey: string;
    details: Record<string, unknown>;
  }): Promise<boolean> {
    // Idempotency qua @@unique([source, characterId, windowKey]).
    // Nếu đã tồn tại, KHÔNG tạo trùng — để admin coi anomaly đầu tiên.
    try {
      await this.prisma.economyAnomaly.create({
        data: {
          source: args.source,
          severity: args.severity,
          characterId: args.characterId,
          userId: args.userId,
          windowKey: args.windowKey,
          detailsJson: args.details as never,
          status: 'OPEN',
        },
      });
      return true;
    } catch {
      // P2002 unique violation → đã có anomaly cùng (source, character, window).
      // Skip — không cập nhật severity. Admin xem ở panel.
      return false;
    }
  }
}

/**
 * Default `windowKey` 24h theo UTC date.
 *
 * Format: `'24h:YYYY-MM-DD'`. Caller cron gọi nhiều lần trong ngày sẽ
 * dùng cùng windowKey → idempotent.
 */
function defaultWindowKey(now: Date): string {
  const y = now.getUTCFullYear();
  const m = String(now.getUTCMonth() + 1).padStart(2, '0');
  const d = String(now.getUTCDate()).padStart(2, '0');
  return `24h:${y}-${m}-${d}`;
}
