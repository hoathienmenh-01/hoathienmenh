import { Injectable, Logger } from '@nestjs/common';
import { CurrencyKind } from '@prisma/client';
import {
  GAMEPLAY_ANOMALY_TYPES,
  buildGameplayAnomalyWindowKey,
  classifyGameplaySeverity,
  coerceGameplayAnomalySource,
  getGameplayAnomalyRule,
  type GameplayAnomalySeverity,
  type GameplayAnomalySource,
  type GameplayAnomalyType,
} from '@xuantoi/shared';
import { PrismaService } from '../../common/prisma.service';

/**
 * Phase 16.3 — Gameplay Anti-cheat Deep Detection.
 *
 * Detection-only service: rà soát log gameplay (currency / item /
 * dungeon-run / boss / mission / arena / territory / RewardCap) trong
 * cửa sổ thời gian, đối chiếu `GAMEPLAY_ANOMALY_RULES` (shared catalog)
 * và CREATE rows `GameplayAnomaly` để admin xem panel.
 *
 * Khác `EconomyAnomalyScannerService` (Phase 16.6):
 *   - Service này tập trung **gameplay behaviour** (farm dungeon, farm
 *     boss, farm mission, farm arena WIN, EXP gain spike) — không trộn
 *     dòng tiền tổng thể.
 *   - Idempotency qua `GameplayAnomaly @@unique([type, characterId,
 *     windowKey])` (mirror Phase 16.6 pattern).
 *
 * **Detection-only**:
 *   - KHÔNG auto-ban.
 *   - KHÔNG auto-rollback.
 *   - KHÔNG tự trừ currency / item / EXP.
 *   - KHÔNG khóa tài khoản.
 *   - Chỉ tạo row → admin xem panel + tự quyết định (refund / ban /
 *     whitelist) qua endpoint khác.
 *
 * Fail-soft: từng rule scan trong `try/catch` riêng — 1 rule throw
 * KHÔNG lật ngược các rule khác.
 */

export interface GameplayScanOptions {
  /** Override `now` cho test reproducible. */
  now?: Date;
  /**
   * Force-override windowKey CHUNG (mọi rule). Caller thường để
   * default — scanner tự derive windowKey theo `windowMs` của rule.
   *
   * Khi truyền, mọi rule sẽ dùng key này — admin debug force re-scan.
   */
  windowKey?: string;
  /**
   * Override `windowMs` cho toàn bộ rule (vd test). Default = lấy từ
   * `rule.windowMs` (1h / 24h / 7d).
   */
  windowMs?: number;
}

/** Per-rule result summary cho UI admin + audit log. */
export interface GameplayRuleScanResult {
  type: GameplayAnomalyType;
  created: number;
  skipped: number;
  /** Có lỗi runtime — set khi rule throw + scanner catch. */
  errored: boolean;
  /** Message lỗi (best-effort) khi `errored=true`. */
  errorMessage: string | null;
}

export interface GameplayScanSummary {
  /** Window keys derived per rule — mapping type → windowKey. */
  windowKeysByType: Record<GameplayAnomalyType, string>;
  /** Tổng created + skipped + errored. */
  totalCreated: number;
  totalSkipped: number;
  totalErrored: number;
  /** Per-rule breakdown. */
  rules: GameplayRuleScanResult[];
  /** Iso timestamp thời điểm scan. */
  scannedAt: string;
}

@Injectable()
export class GameplayAntiCheatService {
  private readonly logger = new Logger(GameplayAntiCheatService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Chạy 1 lượt scan đầy đủ cho mọi rule. Fail-soft per rule.
   *
   * Caller (admin POST endpoint hoặc cron) truyền `options.now` nếu
   * muốn deterministic. Test pass `windowKey` để force key cố định.
   */
  async scanAll(
    options: GameplayScanOptions = {},
  ): Promise<GameplayScanSummary> {
    const now = options.now ?? new Date();

    const rules: GameplayRuleScanResult[] = [];
    const windowKeysByType = {} as Record<GameplayAnomalyType, string>;

    for (const type of GAMEPLAY_ANOMALY_TYPES) {
      const rule = getGameplayAnomalyRule(type);
      const windowMs = options.windowMs ?? rule.windowMs;
      const windowKey =
        options.windowKey ??
        buildGameplayAnomalyWindowKey({ type, now, windowMs });
      windowKeysByType[type] = windowKey;

      try {
        const r = await this.scanRule({ type, now, windowMs, windowKey });
        rules.push({
          type,
          created: r.created,
          skipped: r.skipped,
          errored: false,
          errorMessage: null,
        });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        this.logger.error(`scan rule ${type} failed: ${msg}`);
        rules.push({
          type,
          created: 0,
          skipped: 0,
          errored: true,
          errorMessage: msg.slice(0, 500),
        });
      }
    }

    const totalCreated = rules.reduce((a, r) => a + r.created, 0);
    const totalSkipped = rules.reduce((a, r) => a + r.skipped, 0);
    const totalErrored = rules.reduce((a, r) => a + (r.errored ? 1 : 0), 0);

    return {
      windowKeysByType,
      totalCreated,
      totalSkipped,
      totalErrored,
      rules,
      scannedAt: now.toISOString(),
    };
  }

  /**
   * Dispatch theo `type`. Method này là PUBLIC để test có thể gọi
   * 1 rule riêng cho deterministic test.
   */
  async scanRule(args: {
    type: GameplayAnomalyType;
    now: Date;
    windowMs: number;
    windowKey: string;
  }): Promise<{ created: number; skipped: number }> {
    switch (args.type) {
      case 'EXP_GAIN_SPIKE':
        return this.scanExpGainSpike(args);
      case 'CURRENCY_GAIN_SPIKE':
        return this.scanCurrencyGainSpike(args);
      case 'ITEM_GAIN_SPIKE':
        return this.scanItemGainSpike(args);
      case 'DUNGEON_REWARD_FARM':
        return this.scanDungeonRewardFarm(args);
      case 'BOSS_REWARD_FARM':
        return this.scanBossRewardFarm(args);
      case 'MISSION_REWARD_FARM':
        return this.scanMissionRewardFarm(args);
      case 'ARENA_REWARD_FARM':
        return this.scanArenaRewardFarm(args);
      case 'TERRITORY_REWARD_SPIKE':
        return this.scanTerritoryRewardSpike(args);
      case 'COMBAT_RESULT_MISMATCH':
        // Phase 16.3 chưa wire runtime combat snapshot vào ledger
        // — rule trả về 0 (no-op). Admin có thể tạo row tay qua
        // endpoint tương lai. Reserved trong catalog để FE list +
        // future hook.
        return { created: 0, skipped: 0 };
      case 'REWARD_CAP_BYPASS_ATTEMPT':
        return this.scanRewardCapBypassAttempt(args);
      default: {
        const _exhaustive: never = args.type;
        return _exhaustive;
      }
    }
  }

  // ----- Rule implementations -----

  /**
   * EXP gain spike: tổng EXP "tăng" của character trong window.
   *
   * Codebase chưa có `ExpLedger` — EXP tăng qua `tx.character.update({
   * exp: increment })` ở `DungeonRunService.claim` / `MissionService
   * .claim` / `BossService` v.v. Để không thay đổi runtime, scanner
   * dùng proxy heuristic: tổng `currentAmount` đang nắm + dò qua
   * `RewardCapEvent.grantedExp` 1h gần nhất (đại diện activity heavy).
   *
   * Phase 16.3 dùng tổng `RewardCapEvent.grantedExp` 1h — không
   * perfect nhưng signal đủ để admin nghi vấn farm bất thường (player
   * thường trigger RewardCap khi farm dày). Phase tương lai có thể
   * thêm `ExpLedger` chuyên dụng.
   */
  private async scanExpGainSpike(args: {
    now: Date;
    windowMs: number;
    windowKey: string;
  }): Promise<{ created: number; skipped: number }> {
    const rule = getGameplayAnomalyRule('EXP_GAIN_SPIKE');
    const cutoff = new Date(args.now.getTime() - args.windowMs);
    const grouped = await this.prisma.rewardCapEvent.groupBy({
      by: ['characterId'],
      where: { createdAt: { gte: cutoff } },
      _sum: { grantedExp: true },
    });

    let created = 0;
    let skipped = 0;
    for (const g of grouped) {
      const total = g._sum.grantedExp ?? 0n;
      const severity = classifyGameplaySeverity(total, rule);
      if (!severity) continue;
      const wrote = await this.upsertAnomaly({
        type: 'EXP_GAIN_SPIKE',
        source: rule.source,
        severity,
        characterId: g.characterId,
        userId: null,
        windowKey: args.windowKey,
        details: {
          totalExpGained: total.toString(),
          warnThreshold: rule.warnThreshold.toString(),
          criticalThreshold: rule.criticalThreshold.toString(),
          windowMs: args.windowMs,
          source: 'rewardCapEvent.grantedExp',
        },
      });
      if (wrote) created += 1;
      else skipped += 1;
    }
    return { created, skipped };
  }

  /**
   * Currency gain spike: tổng `delta > 0` của `CurrencyLedger` 1h cho
   * `LINH_THACH`. Phân biệt với Phase 16.6 rule (24h |delta| absolute).
   *
   * Heuristic: chỉ count `delta > 0` để bỏ qua chi tiêu (shop / market
   * sell). Player legit cày khoảng vài chục → vài trăm k LinhThạch /
   * giờ; spike 200k+ / giờ là nghi vấn.
   */
  private async scanCurrencyGainSpike(args: {
    now: Date;
    windowMs: number;
    windowKey: string;
  }): Promise<{ created: number; skipped: number }> {
    const rule = getGameplayAnomalyRule('CURRENCY_GAIN_SPIKE');
    const cutoff = new Date(args.now.getTime() - args.windowMs);
    const grouped = await this.prisma.currencyLedger.groupBy({
      by: ['characterId'],
      where: {
        createdAt: { gte: cutoff },
        currency: CurrencyKind.LINH_THACH,
        delta: { gt: 0n },
      },
      _sum: { delta: true },
    });

    let created = 0;
    let skipped = 0;
    for (const g of grouped) {
      const sum = g._sum.delta ?? 0n;
      const severity = classifyGameplaySeverity(sum, rule);
      if (!severity) continue;
      const wrote = await this.upsertAnomaly({
        type: 'CURRENCY_GAIN_SPIKE',
        source: rule.source,
        severity,
        characterId: g.characterId,
        userId: null,
        windowKey: args.windowKey,
        details: {
          sumPositiveLinhThach: sum.toString(),
          warnThreshold: rule.warnThreshold.toString(),
          criticalThreshold: rule.criticalThreshold.toString(),
          windowMs: args.windowMs,
          currency: 'LINH_THACH',
        },
      });
      if (wrote) created += 1;
      else skipped += 1;
    }
    return { created, skipped };
  }

  /**
   * Item gain spike: tổng `qtyDelta > 0` của `ItemLedger` 1h.
   *
   * Boss / dungeon / mission drop thường 1-3 item / encounter. Spike
   * 100+ / giờ = farm bất thường (multi-account / bot click loop).
   */
  private async scanItemGainSpike(args: {
    now: Date;
    windowMs: number;
    windowKey: string;
  }): Promise<{ created: number; skipped: number }> {
    const rule = getGameplayAnomalyRule('ITEM_GAIN_SPIKE');
    const cutoff = new Date(args.now.getTime() - args.windowMs);
    const grouped = await this.prisma.itemLedger.groupBy({
      by: ['characterId'],
      where: {
        createdAt: { gte: cutoff },
        qtyDelta: { gt: 0 },
      },
      _sum: { qtyDelta: true },
    });

    let created = 0;
    let skipped = 0;
    for (const g of grouped) {
      const sumNum = g._sum.qtyDelta ?? 0;
      const sum = BigInt(sumNum);
      const severity = classifyGameplaySeverity(sum, rule);
      if (!severity) continue;
      const wrote = await this.upsertAnomaly({
        type: 'ITEM_GAIN_SPIKE',
        source: rule.source,
        severity,
        characterId: g.characterId,
        userId: null,
        windowKey: args.windowKey,
        details: {
          totalQtyGained: sum.toString(),
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
   * Dungeon reward farm: count `DungeonRun` claimed (claimedAt !=
   * null) trong window. 24h default — daily reset stamina + dailyLimit
   * gate đã limit chính thức 5-10/ngày, spike 20+/ngày là exploit.
   */
  private async scanDungeonRewardFarm(args: {
    now: Date;
    windowMs: number;
    windowKey: string;
  }): Promise<{ created: number; skipped: number }> {
    const rule = getGameplayAnomalyRule('DUNGEON_REWARD_FARM');
    const cutoff = new Date(args.now.getTime() - args.windowMs);
    const grouped = await this.prisma.dungeonRun.groupBy({
      by: ['characterId'],
      where: {
        status: 'CLAIMED',
        claimedAt: { gte: cutoff },
      },
      _count: { _all: true },
    });

    let created = 0;
    let skipped = 0;
    for (const g of grouped) {
      const count = BigInt(g._count._all);
      const severity = classifyGameplaySeverity(count, rule);
      if (!severity) continue;
      const wrote = await this.upsertAnomaly({
        type: 'DUNGEON_REWARD_FARM',
        source: rule.source,
        severity,
        characterId: g.characterId,
        userId: null,
        windowKey: args.windowKey,
        details: {
          claimedRunCount: count.toString(),
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
   * Boss reward farm: count rows `CurrencyLedger` reason='BOSS_REWARD'
   * positive cho character trong window 24h. Boss spawn rate giới hạn
   * (1 active per region) — 15+ reward grant / 24h = abuse multi-region
   * / multi-account.
   */
  private async scanBossRewardFarm(args: {
    now: Date;
    windowMs: number;
    windowKey: string;
  }): Promise<{ created: number; skipped: number }> {
    const rule = getGameplayAnomalyRule('BOSS_REWARD_FARM');
    const cutoff = new Date(args.now.getTime() - args.windowMs);
    const grouped = await this.prisma.currencyLedger.groupBy({
      by: ['characterId'],
      where: {
        createdAt: { gte: cutoff },
        reason: 'BOSS_REWARD',
        delta: { gt: 0n },
      },
      _count: { _all: true },
    });

    let created = 0;
    let skipped = 0;
    for (const g of grouped) {
      const count = BigInt(g._count._all);
      const severity = classifyGameplaySeverity(count, rule);
      if (!severity) continue;
      const wrote = await this.upsertAnomaly({
        type: 'BOSS_REWARD_FARM',
        source: rule.source,
        severity,
        characterId: g.characterId,
        userId: null,
        windowKey: args.windowKey,
        details: {
          bossRewardGrantCount: count.toString(),
          warnThreshold: rule.warnThreshold.toString(),
          criticalThreshold: rule.criticalThreshold.toString(),
          windowMs: args.windowMs,
          ledgerReason: 'BOSS_REWARD',
        },
      });
      if (wrote) created += 1;
      else skipped += 1;
    }
    return { created, skipped };
  }

  /**
   * Mission reward farm: count `MissionProgress` claimed (claimedAt !=
   * null) trong window. Daily 8-10 + Weekly 4-5 + ONCE chain → 30+
   * /24h là exploit reset (vd reset bị bypass / FE self-claim).
   */
  private async scanMissionRewardFarm(args: {
    now: Date;
    windowMs: number;
    windowKey: string;
  }): Promise<{ created: number; skipped: number }> {
    const rule = getGameplayAnomalyRule('MISSION_REWARD_FARM');
    const cutoff = new Date(args.now.getTime() - args.windowMs);
    const grouped = await this.prisma.missionProgress.groupBy({
      by: ['characterId'],
      where: {
        claimed: true,
        claimedAt: { gte: cutoff },
      },
      _count: { _all: true },
    });

    let created = 0;
    let skipped = 0;
    for (const g of grouped) {
      const count = BigInt(g._count._all);
      const severity = classifyGameplaySeverity(count, rule);
      if (!severity) continue;
      const wrote = await this.upsertAnomaly({
        type: 'MISSION_REWARD_FARM',
        source: rule.source,
        severity,
        characterId: g.characterId,
        userId: null,
        windowKey: args.windowKey,
        details: {
          missionClaimCount: count.toString(),
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
   * Arena reward farm: count `ArenaMatch` WIN cho character (đếm cả
   * attacker / defender WIN) trong window 24h. Daily challenge limit
   * + arena rank gate → 30+ WIN/ngày = wintrade / exploit.
   *
   * Distinct logic với `ArenaWintradeAlert` (Phase 14.4) — đó là
   * pattern repeated opponent. Rule này detection "raw count high"
   * (orthogonal).
   */
  private async scanArenaRewardFarm(args: {
    now: Date;
    windowMs: number;
    windowKey: string;
  }): Promise<{ created: number; skipped: number }> {
    const rule = getGameplayAnomalyRule('ARENA_REWARD_FARM');
    const cutoff = new Date(args.now.getTime() - args.windowMs);
    // Đếm raw ArenaMatch RESOLVED có winnerCharacterId là character
    // — Phase 16.3 dùng raw SQL groupBy với OR điều kiện không support
    // bằng groupBy Prisma. Dùng query thay thế: groupBy theo
    // winnerCharacterId.
    const grouped = await this.prisma.arenaMatch.groupBy({
      by: ['winnerCharacterId'],
      where: {
        status: 'RESOLVED',
        resolvedAt: { gte: cutoff },
        winnerCharacterId: { not: null },
      },
      _count: { _all: true },
    });

    let created = 0;
    let skipped = 0;
    for (const g of grouped) {
      const characterId = g.winnerCharacterId;
      if (!characterId) continue;
      const count = BigInt(g._count._all);
      const severity = classifyGameplaySeverity(count, rule);
      if (!severity) continue;
      const wrote = await this.upsertAnomaly({
        type: 'ARENA_REWARD_FARM',
        source: rule.source,
        severity,
        characterId,
        userId: null,
        windowKey: args.windowKey,
        details: {
          winCount: count.toString(),
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
   * Territory reward spike: count `TerritoryOwnerRewardGrant` per
   * character trong window 7d. Region weekly cycle thường 1-2/region
   * — 10+ trong 7d = đa region.
   */
  private async scanTerritoryRewardSpike(args: {
    now: Date;
    windowMs: number;
    windowKey: string;
  }): Promise<{ created: number; skipped: number }> {
    const rule = getGameplayAnomalyRule('TERRITORY_REWARD_SPIKE');
    const cutoff = new Date(args.now.getTime() - args.windowMs);
    const grouped = await this.prisma.territoryOwnerRewardGrant.groupBy({
      by: ['characterId'],
      where: { grantedAt: { gte: cutoff } },
      _count: { _all: true },
    });

    let created = 0;
    let skipped = 0;
    for (const g of grouped) {
      const count = BigInt(g._count._all);
      const severity = classifyGameplaySeverity(count, rule);
      if (!severity) continue;
      const wrote = await this.upsertAnomaly({
        type: 'TERRITORY_REWARD_SPIKE',
        source: rule.source,
        severity,
        characterId: g.characterId,
        userId: null,
        windowKey: args.windowKey,
        details: {
          territoryRewardCount: count.toString(),
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
   * Reward cap bypass attempt: count rows `RewardCapEvent` trong
   * window 1h. Player thường chạm cap 1-2 lần/ngày — 5+ trong 1h là
   * bot click loop / multi-tab abuse.
   *
   * Phân biệt với Phase 16.6 `REWARD_CAP_BYPASS` rule (24h cumulative
   * count). Rule 16.3 này 1h grain để cảnh báo real-time hơn.
   */
  private async scanRewardCapBypassAttempt(args: {
    now: Date;
    windowMs: number;
    windowKey: string;
  }): Promise<{ created: number; skipped: number }> {
    const rule = getGameplayAnomalyRule('REWARD_CAP_BYPASS_ATTEMPT');
    const cutoff = new Date(args.now.getTime() - args.windowMs);
    const grouped = await this.prisma.rewardCapEvent.groupBy({
      by: ['characterId'],
      where: { createdAt: { gte: cutoff } },
      _count: { _all: true },
    });

    let created = 0;
    let skipped = 0;
    for (const g of grouped) {
      const count = BigInt(g._count._all);
      const severity = classifyGameplaySeverity(count, rule);
      if (!severity) continue;
      const wrote = await this.upsertAnomaly({
        type: 'REWARD_CAP_BYPASS_ATTEMPT',
        source: rule.source,
        severity,
        characterId: g.characterId,
        userId: null,
        windowKey: args.windowKey,
        details: {
          rewardCapEventCount: count.toString(),
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

  // ----- helpers -----

  /**
   * Try create row — duplicate (cùng `(type, characterId, windowKey)`)
   * sẽ raise P2002 unique violation → return `false` thay vì throw.
   * Caller increment `skipped`.
   */
  private async upsertAnomaly(args: {
    type: GameplayAnomalyType;
    source: GameplayAnomalySource | string;
    severity: GameplayAnomalySeverity;
    characterId: string | null;
    userId: string | null;
    windowKey: string;
    details: Record<string, unknown>;
  }): Promise<boolean> {
    try {
      await this.prisma.gameplayAnomaly.create({
        data: {
          type: args.type,
          source: coerceGameplayAnomalySource(args.source),
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
      return false;
    }
  }
}
