import { Injectable, Logger } from '@nestjs/common';
import {
  type EconomyAnomalySeverity,
  type EconomyIssueStatus,
} from '@xuantoi/shared';
import { auditLedger } from '../admin/ledger-audit';
import { PrismaService } from '../../common/prisma.service';
import { dayBucketFor } from './reward-cap.service';

/**
 * Phase 16.6 — Ledger Checker Cron service.
 *
 * Daily invariant scan trên DB economy:
 *   1. `checkCurrencyLedgerConsistency()` — `Σ CurrencyLedger.delta` per
 *      character & currency phải khớp `Character.linhThach` / `tienNgoc`.
 *   2. `checkItemLedgerConsistency()` — `Σ ItemLedger.qtyDelta` per
 *      `(character, itemKey)` phải khớp `Σ InventoryItem.qty` cùng key.
 *   3. `checkRewardCapConsistency()` — `Σ CharacterDailyRewardBucket.linhThachAccum`
 *      ≤ daily cap theo realm. Sanity check Phase 16.5 cap không bị bypass.
 *   4. `checkNegativeBalances()` — `Character.linhThach < 0n` /
 *      `Character.tienNgoc < 0` / `InventoryItem.qty < 0` (race-condition
 *      hoặc bug nào đó để lọt giá trị âm).
 *   5. `checkSuspiciousDelta24h()` — character có 1 row CurrencyLedger
 *      đơn lẻ |delta| > Phase 16.5 cap × 10 (anomaly hint, scanner
 *      sẽ verify chi tiết).
 *
 * Idempotency: 1 run = 1 row `EconomyLedgerCheckRun` UNIQUE
 * `dayBucket`. Gọi `runCheck()` lại trong cùng ngày trả existing run +
 * summary (KHÔNG re-scan toàn bộ DB cho rẻ — admin force-rerun bằng
 * `forceRerun=true` flag).
 *
 * Read-only cho DB economy data (chỉ ghi vào table audit của Phase 16.6).
 * KHÔNG auto-fix data, KHÔNG ban user, KHÔNG gửi mail. Chỉ phát hiện và
 * báo cáo qua admin panel.
 */

export interface LedgerCheckRunSummary {
  runId: string;
  dayBucket: string;
  status: 'OK' | 'ISSUES_FOUND' | 'ERROR';
  charactersScanned: number;
  itemKeysScanned: number;
  currencyDiscrepancies: number;
  inventoryDiscrepancies: number;
  rewardCapInconsistencies: number;
  negativeBalances: number;
  suspiciousDeltas: number;
  issuesCreated: number;
  startedAt: Date;
  finishedAt: Date | null;
  alreadyDone: boolean;
}

export interface RunCheckOptions {
  /** Override `now` cho test reproducible. */
  now?: Date;
  /** Override TZ cho dayBucket — default `getDailyRewardCapTz()`. */
  tz?: string;
  /** Trigger từ admin endpoint (userId) hoặc cron (`null`). */
  triggeredBy?: string | null;
  /**
   * Bỏ qua early-return khi đã có run cùng `dayBucket`. Admin có thể
   * force-rerun để verify lại sau khi fix data tay.
   *
   * KHÔNG mặc định true — rerun expensive query cho character lớn.
   * Force-rerun delete issue OPEN cũ + tạo issue mới.
   */
  forceRerun?: boolean;
}

@Injectable()
export class LedgerCheckerService {
  private readonly logger = new Logger(LedgerCheckerService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Chạy 1 lượt check đầy đủ. Idempotent qua `dayBucket` UNIQUE.
   *
   * Flow:
   *   1. `findUnique({ dayBucket })` — nếu existing & !forceRerun → return summary.
   *   2. Tạo `EconomyLedgerCheckRun(status='RUNNING')`.
   *   3. Gọi 5 check method, gom issues vào array.
   *   4. Bulk-insert `EconomyLedgerCheckIssue` rows.
   *   5. Update run `finishedAt + status + summaryJson`.
   *
   * Fail-soft: nếu 1 check throw, log + ghi 1 issue severity=CRITICAL
   * type=`CHECK_ERROR` và tiếp tục các check khác. Status finalrun
   * = `ISSUES_FOUND` nếu ≥ 1 issue, `OK` nếu 0.
   */
  async runCheck(
    options: RunCheckOptions = {},
  ): Promise<LedgerCheckRunSummary> {
    const now = options.now ?? new Date();
    const dayBucket = dayBucketFor(now, options.tz);

    const existing = await this.prisma.economyLedgerCheckRun.findUnique({
      where: { dayBucket },
    });

    if (existing && !options.forceRerun) {
      const summaryJson = (existing.summaryJson ??
        {}) as Record<string, unknown>;
      return {
        runId: existing.id,
        dayBucket: existing.dayBucket,
        status: this.coerceStatus(existing.status),
        charactersScanned: this.numberFromMeta(
          summaryJson,
          'charactersScanned',
        ),
        itemKeysScanned: this.numberFromMeta(summaryJson, 'itemKeysScanned'),
        currencyDiscrepancies: this.numberFromMeta(
          summaryJson,
          'currencyDiscrepancies',
        ),
        inventoryDiscrepancies: this.numberFromMeta(
          summaryJson,
          'inventoryDiscrepancies',
        ),
        rewardCapInconsistencies: this.numberFromMeta(
          summaryJson,
          'rewardCapInconsistencies',
        ),
        negativeBalances: this.numberFromMeta(summaryJson, 'negativeBalances'),
        suspiciousDeltas: this.numberFromMeta(summaryJson, 'suspiciousDeltas'),
        issuesCreated: this.numberFromMeta(summaryJson, 'issuesCreated'),
        startedAt: existing.startedAt,
        finishedAt: existing.finishedAt,
        alreadyDone: true,
      };
    }

    let runRow;
    if (existing && options.forceRerun) {
      // Force-rerun: clear issues OPEN cũ + reset run row sang RUNNING.
      await this.prisma.economyLedgerCheckIssue.deleteMany({
        where: { runId: existing.id },
      });
      runRow = await this.prisma.economyLedgerCheckRun.update({
        where: { id: existing.id },
        data: {
          status: 'RUNNING',
          startedAt: now,
          finishedAt: null,
          triggeredBy: options.triggeredBy ?? null,
        },
      });
    } else {
      runRow = await this.prisma.economyLedgerCheckRun.create({
        data: {
          dayBucket,
          status: 'RUNNING',
          startedAt: now,
          triggeredBy: options.triggeredBy ?? null,
        },
      });
    }

    const issues: PendingIssue[] = [];
    let charactersScanned = 0;
    let itemKeysScanned = 0;

    try {
      const a = await this.checkCurrencyLedgerConsistency();
      charactersScanned = a.charactersScanned;
      issues.push(...a.issues);
    } catch (e) {
      this.logger.error(`checkCurrencyLedgerConsistency failed: ${(e as Error).message}`);
      issues.push({
        severity: 'CRITICAL',
        type: 'CHECK_ERROR',
        characterId: null,
        details: { phase: 'CURRENCY', error: (e as Error).message },
      });
    }

    try {
      const b = await this.checkItemLedgerConsistency();
      itemKeysScanned = b.itemKeysScanned;
      issues.push(...b.issues);
    } catch (e) {
      this.logger.error(`checkItemLedgerConsistency failed: ${(e as Error).message}`);
      issues.push({
        severity: 'CRITICAL',
        type: 'CHECK_ERROR',
        characterId: null,
        details: { phase: 'ITEM', error: (e as Error).message },
      });
    }

    try {
      issues.push(...(await this.checkRewardCapConsistency()));
    } catch (e) {
      this.logger.error(`checkRewardCapConsistency failed: ${(e as Error).message}`);
      issues.push({
        severity: 'WARN',
        type: 'CHECK_ERROR',
        characterId: null,
        details: { phase: 'REWARD_CAP', error: (e as Error).message },
      });
    }

    try {
      issues.push(...(await this.checkNegativeBalances()));
    } catch (e) {
      this.logger.error(`checkNegativeBalances failed: ${(e as Error).message}`);
      issues.push({
        severity: 'CRITICAL',
        type: 'CHECK_ERROR',
        characterId: null,
        details: { phase: 'NEGATIVE_BALANCE', error: (e as Error).message },
      });
    }

    try {
      issues.push(...(await this.checkSuspiciousDelta24h(now)));
    } catch (e) {
      this.logger.error(`checkSuspiciousDelta24h failed: ${(e as Error).message}`);
      issues.push({
        severity: 'WARN',
        type: 'CHECK_ERROR',
        characterId: null,
        details: { phase: 'SUSPICIOUS_DELTA', error: (e as Error).message },
      });
    }

    if (issues.length > 0) {
      await this.prisma.economyLedgerCheckIssue.createMany({
        data: issues.map((i) => ({
          runId: runRow.id,
          severity: i.severity,
          type: i.type,
          characterId: i.characterId,
          detailsJson: i.details as never,
          status: 'OPEN' as EconomyIssueStatus,
        })),
      });
    }

    const counts = countByType(issues);
    const summary: LedgerCheckRunSummary = {
      runId: runRow.id,
      dayBucket,
      status: issues.length > 0 ? 'ISSUES_FOUND' : 'OK',
      charactersScanned,
      itemKeysScanned,
      currencyDiscrepancies: counts['CURRENCY_LEDGER_MISMATCH'] ?? 0,
      inventoryDiscrepancies: counts['ITEM_LEDGER_MISMATCH'] ?? 0,
      rewardCapInconsistencies: counts['REWARD_CAP_INCONSISTENT'] ?? 0,
      negativeBalances:
        (counts['NEGATIVE_CURRENCY'] ?? 0) + (counts['NEGATIVE_INVENTORY'] ?? 0),
      suspiciousDeltas: counts['SUSPICIOUS_DELTA_24H'] ?? 0,
      issuesCreated: issues.length,
      startedAt: runRow.startedAt,
      finishedAt: new Date(),
      alreadyDone: false,
    };

    await this.prisma.economyLedgerCheckRun.update({
      where: { id: runRow.id },
      data: {
        finishedAt: summary.finishedAt ?? new Date(),
        status: summary.status,
        summaryJson: {
          charactersScanned: summary.charactersScanned,
          itemKeysScanned: summary.itemKeysScanned,
          currencyDiscrepancies: summary.currencyDiscrepancies,
          inventoryDiscrepancies: summary.inventoryDiscrepancies,
          rewardCapInconsistencies: summary.rewardCapInconsistencies,
          negativeBalances: summary.negativeBalances,
          suspiciousDeltas: summary.suspiciousDeltas,
          issuesCreated: summary.issuesCreated,
          countsByType: counts,
        } as never,
      },
    });

    return summary;
  }

  /**
   * Check 1 — Currency ledger sum vs Character balance.
   *
   * Reuse `auditLedger` đã có ở `admin/ledger-audit.ts` (Phase 11.X).
   * Mỗi discrepancy 1 row issue severity `CRITICAL` (mismatch ledger
   * = sự kiện economy nghiêm trọng).
   */
  async checkCurrencyLedgerConsistency(): Promise<{
    charactersScanned: number;
    issues: PendingIssue[];
  }> {
    const r = await auditLedger(this.prisma);
    const issues: PendingIssue[] = r.currencyDiscrepancies.map((d) => ({
      severity: 'CRITICAL',
      type: 'CURRENCY_LEDGER_MISMATCH',
      characterId: d.characterId,
      details: {
        field: d.field,
        ledgerSum: d.ledgerSum.toString(),
        characterValue: d.characterValue.toString(),
        diff: d.diff.toString(),
      },
    }));
    // `auditLedger` cũng trả invDiscrepancies — tách sang check 2.
    return { charactersScanned: r.charactersScanned, issues };
  }

  /**
   * Check 2 — Item ledger sum vs Inventory total per (char, itemKey).
   *
   * Reuse `auditLedger.inventoryDiscrepancies` (đã group sẵn).
   */
  async checkItemLedgerConsistency(): Promise<{
    itemKeysScanned: number;
    issues: PendingIssue[];
  }> {
    const r = await auditLedger(this.prisma);
    const issues: PendingIssue[] = r.inventoryDiscrepancies.map((d) => ({
      severity: 'CRITICAL',
      type: 'ITEM_LEDGER_MISMATCH',
      characterId: d.characterId,
      details: {
        itemKey: d.itemKey,
        ledgerSum: d.ledgerSum,
        inventorySum: d.inventorySum,
        diff: d.diff,
      },
    }));
    return { itemKeysScanned: r.itemKeysScanned, issues };
  }

  /**
   * Check 3 — RewardCap consistency: nếu `CharacterDailyRewardBucket` của
   * 1 character vượt quá total cap kỳ vọng (theo Phase 16.5 daily-reward-cap),
   * cảnh báo. Đây là sanity check phụ; cap thật sự enforce ở runtime.
   *
   * Trong scope Phase 16.6 chỉ check: với mỗi bucket row, `linhThachAccum +
   * expAccum` không phải số âm. Bypass real cap (player thực sự vượt cap)
   * sẽ được scanner theo dõi — KHÔNG check ở đây để tránh false positive
   * khi cap realm khác nhau.
   */
  async checkRewardCapConsistency(): Promise<PendingIssue[]> {
    const buckets = await this.prisma.characterDailyRewardBucket.findMany({
      where: {
        OR: [{ linhThachAccum: { lt: 0n } }, { expAccum: { lt: 0n } }],
      },
      select: {
        characterId: true,
        dayBucket: true,
        source: true,
        linhThachAccum: true,
        expAccum: true,
      },
    });
    return buckets.map((b) => ({
      severity: 'WARN' as EconomyAnomalySeverity,
      type: 'REWARD_CAP_INCONSISTENT',
      characterId: b.characterId,
      details: {
        dayBucket: b.dayBucket,
        source: b.source,
        linhThachAccum: b.linhThachAccum.toString(),
        expAccum: b.expAccum.toString(),
      },
    }));
  }

  /**
   * Check 4 — Negative balances. `Character.linhThach < 0n`,
   * `Character.tienNgoc < 0`, hoặc `InventoryItem.qty < 0`.
   *
   * Thường KHÔNG nên xảy ra (CurrencyService có CAS guard `gte`), nhưng
   * race condition / data corruption / migration lỗi vẫn có thể tạo. Là
   * dấu hiệu CRITICAL — admin coi ngay.
   */
  async checkNegativeBalances(): Promise<PendingIssue[]> {
    const negativeCurrency = await this.prisma.character.findMany({
      where: {
        OR: [{ linhThach: { lt: 0n } }, { tienNgoc: { lt: 0 } }],
      },
      select: {
        id: true,
        linhThach: true,
        tienNgoc: true,
      },
    });
    const negativeInventory = await this.prisma.inventoryItem.findMany({
      where: { qty: { lt: 0 } },
      select: { id: true, characterId: true, itemKey: true, qty: true },
    });

    const issues: PendingIssue[] = [];
    for (const c of negativeCurrency) {
      issues.push({
        severity: 'CRITICAL',
        type: 'NEGATIVE_CURRENCY',
        characterId: c.id,
        details: {
          linhThach: c.linhThach.toString(),
          tienNgoc: c.tienNgoc,
        },
      });
    }
    for (const i of negativeInventory) {
      issues.push({
        severity: 'CRITICAL',
        type: 'NEGATIVE_INVENTORY',
        characterId: i.characterId,
        details: {
          inventoryItemId: i.id,
          itemKey: i.itemKey,
          qty: i.qty,
        },
      });
    }
    return issues;
  }

  /**
   * Check 5 — Suspicious 24h delta.
   *
   * Tìm các `CurrencyLedger` row đơn lẻ có |delta| ≥ 5_000_000 (5M LT)
   * trong 24h gần nhất. Threshold này cố ý cao để hạn chế false positive
   * — admin grant compensation lớn (hợp lệ) sẽ được hook anomaly riêng
   * (`ADMIN_GRANT_OVER_LIMIT`) cảnh báo trong real-time.
   */
  async checkSuspiciousDelta24h(now: Date): Promise<PendingIssue[]> {
    const cutoff = new Date(now.getTime() - 24 * 3600 * 1000);
    const threshold = 5_000_000n;
    const rows = await this.prisma.currencyLedger.findMany({
      where: {
        createdAt: { gte: cutoff },
        OR: [{ delta: { gte: threshold } }, { delta: { lte: -threshold } }],
      },
      select: {
        id: true,
        characterId: true,
        currency: true,
        delta: true,
        reason: true,
        actorUserId: true,
        createdAt: true,
      },
    });
    return rows.map((r) => ({
      severity: 'WARN' as EconomyAnomalySeverity,
      type: 'SUSPICIOUS_DELTA_24H',
      characterId: r.characterId,
      details: {
        ledgerId: r.id,
        currency: r.currency,
        delta: r.delta.toString(),
        reason: r.reason,
        actorUserId: r.actorUserId,
        createdAt: r.createdAt.toISOString(),
      },
    }));
  }

  // ----- helpers -----

  private coerceStatus(s: string): 'OK' | 'ISSUES_FOUND' | 'ERROR' {
    if (s === 'OK' || s === 'ISSUES_FOUND' || s === 'ERROR') return s;
    return 'ERROR';
  }

  private numberFromMeta(
    meta: Record<string, unknown>,
    key: string,
  ): number {
    const v = meta[key];
    if (typeof v === 'number' && Number.isFinite(v)) return v;
    return 0;
  }
}

interface PendingIssue {
  severity: EconomyAnomalySeverity;
  type: string;
  characterId: string | null;
  details: Record<string, unknown>;
}

function countByType(issues: PendingIssue[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const i of issues) {
    out[i.type] = (out[i.type] ?? 0) + 1;
  }
  return out;
}
