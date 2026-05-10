/**
 * Phase 14.1.D — Arena Anti-Wintrade detection service.
 *
 * Detection-only: rà soát `ArenaMatch` trong cửa sổ thời gian gần nhất,
 * đối chiếu rules từ shared catalog (`ARENA_ANTI_WINTRADE_RULES`) và
 * CREATE rows `ArenaWintradeAlert` để admin xem panel.
 *
 * Idempotency: `ArenaWintradeAlert @@unique(type, windowKey,
 * attackerCharacterId, defenderCharacterId)` — scanner gọi lại trên
 * cùng cửa sổ KHÔNG tạo alert trùng (giảm noise admin).
 *
 * Policy:
 *   - Không tự ban / không tự rollback / không public notify.
 *   - Threshold conservative — admin xem panel + tự quyết định manual.
 *   - Lightweight check on resolve: helper `quickCheckPair()` chạy 1
 *     subset rule cho cặp hiện tại; full scan để admin/cron kích hoạt.
 *
 * Source-of-truth balance: `docs/BALANCE_MODEL.md` §Arena Anti-Wintrade
 * + `docs/ECONOMY_MODEL.md` §Anti-cheat playbook.
 */
import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  ARENA_ANTI_WINTRADE_RULES,
  arenaWintradePairKey,
  arenaWintradePeriodKey,
  arenaWintradeWindowKey,
  assertArenaAntiWintradeRulesValid,
  severityForCount,
  type ArenaAntiWintradeRules,
  type ArenaWintradeSeverity,
  type ArenaWintradeType,
} from '@xuantoi/shared';
import { PrismaService } from '../../common/prisma.service';

/* ---------------------------------------------------------------------------
 * Types
 * ------------------------------------------------------------------------- */

export interface AntiWintradeScanOptions {
  /** Override `now` cho test reproducible. */
  now?: Date;
  /**
   * Window key prefix override — caller có thể truyền để dedupe theo
   * batch riêng (vd `manual:abc`). Mặc định derive từ `now`.
   */
  periodKeyOverride?: string;
}

export interface AntiWintradeScanSummary {
  scannedMatches: number;
  alertsCreated: number;
  alertsSkippedDuplicate: number;
  criticalCount: number;
  warningCount: number;
  infoCount: number;
}

export type AntiWintradeRuleScanResult = {
  alertsCreated: number;
  alertsSkippedDuplicate: number;
  alertsBySeverity: Partial<Record<ArenaWintradeSeverity, number>>;
};

interface ArenaMatchSlim {
  id: string;
  attackerCharacterId: string;
  defenderCharacterId: string;
  result: string | null;
  status: string;
  resolvedAt: Date | null;
  createdAt: Date;
  ratingDeltaJson: Prisma.JsonValue;
}

/* ---------------------------------------------------------------------------
 * Service
 * ------------------------------------------------------------------------- */

@Injectable()
export class ArenaAntiWintradeService {
  private readonly logger = new Logger(ArenaAntiWintradeService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** Read-only rules (caller can override hoặc dùng default). */
  getRules(): ArenaAntiWintradeRules {
    const rules = readAntiWintradeRulesFromEnv();
    assertArenaAntiWintradeRulesValid(rules);
    return rules;
  }

  /**
   * Chạy 1 lượt scan đầy đủ tất cả rule. Fail-soft: 1 rule throw không
   * lật ngược các rule khác.
   *
   * Returns aggregated summary.
   */
  async scanAll(
    options: AntiWintradeScanOptions = {},
  ): Promise<AntiWintradeScanSummary> {
    const now = options.now ?? new Date();
    const rules = this.getRules();

    let scannedMatches = 0;
    let alertsCreated = 0;
    let alertsSkippedDuplicate = 0;
    const sevCount: Record<ArenaWintradeSeverity, number> = {
      INFO: 0,
      WARN: 0,
      CRITICAL: 0,
    };

    const accumulate = (r: AntiWintradeRuleScanResult): void => {
      alertsCreated += r.alertsCreated;
      alertsSkippedDuplicate += r.alertsSkippedDuplicate;
      sevCount.INFO += r.alertsBySeverity.INFO ?? 0;
      sevCount.WARN += r.alertsBySeverity.WARN ?? 0;
      sevCount.CRITICAL += r.alertsBySeverity.CRITICAL ?? 0;
    };

    // Pre-fetch matches in widest window (max of all rule windows). Cache
    // qua các rule subscan để tránh re-query.
    const widestHours = Math.max(
      rules.repeatedOpponentWindowHours,
      rules.ratingGainSpikeWindowHours,
    );
    const matches = await this.fetchRecentMatches(now, widestHours);
    scannedMatches = matches.length;

    try {
      const r = await this.scanRepeatedOpponentPairs({
        now,
        rules,
        matches,
        options,
      });
      accumulate(r);
    } catch (e) {
      this.logger.error(
        `scanRepeatedOpponentPairs failed: ${(e as Error).message}`,
      );
    }

    try {
      const r = await this.scanReciprocalWinLossPattern({
        now,
        rules,
        matches,
        options,
      });
      accumulate(r);
    } catch (e) {
      this.logger.error(
        `scanReciprocalWinLossPattern failed: ${(e as Error).message}`,
      );
    }

    try {
      const r = await this.scanRatingGainSpike({
        now,
        rules,
        matches,
        options,
      });
      accumulate(r);
    } catch (e) {
      this.logger.error(
        `scanRatingGainSpike failed: ${(e as Error).message}`,
      );
    }

    try {
      const r = await this.scanRewardFarmPattern({
        now,
        rules,
        matches,
        options,
      });
      accumulate(r);
    } catch (e) {
      this.logger.error(
        `scanRewardFarmPattern failed: ${(e as Error).message}`,
      );
    }

    try {
      const r = await this.scanSeasonSuspiciousActors({
        now,
        rules,
        matches,
        options,
      });
      accumulate(r);
    } catch (e) {
      this.logger.error(
        `scanSeasonSuspiciousActors failed: ${(e as Error).message}`,
      );
    }

    return {
      scannedMatches,
      alertsCreated,
      alertsSkippedDuplicate,
      criticalCount: sevCount.CRITICAL,
      warningCount: sevCount.WARN,
      infoCount: sevCount.INFO,
    };
  }

  /**
   * Lightweight check chạy ngay sau khi 1 match resolve. Chỉ xét cặp
   * (attacker,defender) hiện tại — không full scan. KHÔNG throw nếu
   * thất bại (caller arena.service.ts không nên crash response).
   */
  async quickCheckPair(
    attackerCharacterId: string,
    defenderCharacterId: string,
    now: Date = new Date(),
  ): Promise<AntiWintradeRuleScanResult> {
    try {
      const rules = this.getRules();
      const sinceMs =
        now.getTime() - rules.repeatedOpponentWindowHours * 3600 * 1000;
      const since = new Date(sinceMs);
      const matches = await this.prisma.arenaMatch.findMany({
        where: {
          status: 'RESOLVED',
          createdAt: { gte: since },
          OR: [
            {
              attackerCharacterId,
              defenderCharacterId,
            },
            {
              attackerCharacterId: defenderCharacterId,
              defenderCharacterId: attackerCharacterId,
            },
          ],
        },
        select: this.matchSlimSelect,
        orderBy: { createdAt: 'asc' },
      });

      const periodKey = arenaWintradePeriodKey(
        now,
        rules.repeatedOpponentWindowHours,
      );
      const result = await this.detectRepeatedPairFromMatches({
        matches,
        rules,
        now,
        periodKey,
        scopeAttacker: attackerCharacterId,
        scopeDefender: defenderCharacterId,
      });
      return result;
    } catch (e) {
      this.logger.warn(
        `quickCheckPair fail-soft: ${(e as Error).message}`,
      );
      return {
        alertsCreated: 0,
        alertsSkippedDuplicate: 0,
        alertsBySeverity: {},
      };
    }
  }

  /* ----------------------------- Rule scans ----------------------------- */

  async scanRepeatedOpponentPairs(input: {
    now: Date;
    rules: ArenaAntiWintradeRules;
    matches: ArenaMatchSlim[];
    options: AntiWintradeScanOptions;
  }): Promise<AntiWintradeRuleScanResult> {
    const { rules, now, matches, options } = input;
    const periodKey =
      options.periodKeyOverride ??
      arenaWintradePeriodKey(now, rules.repeatedOpponentWindowHours);
    return this.detectRepeatedPairFromMatches({
      matches,
      rules,
      now,
      periodKey,
    });
  }

  async scanReciprocalWinLossPattern(input: {
    now: Date;
    rules: ArenaAntiWintradeRules;
    matches: ArenaMatchSlim[];
    options: AntiWintradeScanOptions;
  }): Promise<AntiWintradeRuleScanResult> {
    const { rules, now, matches, options } = input;
    const periodKey =
      options.periodKeyOverride ??
      arenaWintradePeriodKey(now, rules.repeatedOpponentWindowHours);

    // Group by unordered pair key. Đếm A→B win + B→A win.
    const pairAggregates = new Map<
      string,
      {
        a: string;
        b: string;
        aWinsOverB: number;
        bWinsOverA: number;
      }
    >();

    for (const m of matches) {
      if (m.status !== 'RESOLVED' || !m.result) continue;
      if (m.result === 'DRAW') continue;
      const key = arenaWintradePairKey(
        m.attackerCharacterId,
        m.defenderCharacterId,
      );
      const a = key.split('::')[0];
      const b = key.split('::')[1];
      const entry = pairAggregates.get(key) ?? {
        a,
        b,
        aWinsOverB: 0,
        bWinsOverA: 0,
      };
      const attackerWon = m.result === 'ATTACKER_WIN';
      if (attackerWon) {
        if (m.attackerCharacterId === a) entry.aWinsOverB += 1;
        else entry.bWinsOverA += 1;
      } else if (m.result === 'DEFENDER_WIN') {
        if (m.defenderCharacterId === a) entry.aWinsOverB += 1;
        else entry.bWinsOverA += 1;
      }
      pairAggregates.set(key, entry);
    }

    const result: AntiWintradeRuleScanResult = {
      alertsCreated: 0,
      alertsSkippedDuplicate: 0,
      alertsBySeverity: {},
    };
    const type: ArenaWintradeType = 'RECIPROCAL_WIN_LOSS';
    for (const entry of pairAggregates.values()) {
      const swaps = Math.min(entry.aWinsOverB, entry.bWinsOverA);
      const severity = severityForCount(
        swaps,
        rules.reciprocalMatchThreshold,
        rules.criticalReciprocalMatches,
      );
      if (!severity) continue;
      const windowKey = arenaWintradeWindowKey(
        type,
        `${periodKey}:${entry.a}::${entry.b}`,
      );
      const created = await this.upsertAlert({
        type,
        severity,
        windowKey,
        attackerCharacterId: entry.a,
        defenderCharacterId: entry.b,
        relatedCharacterIds: [],
        details: {
          aWinsOverB: entry.aWinsOverB,
          bWinsOverA: entry.bWinsOverA,
          swaps,
          windowHours: rules.repeatedOpponentWindowHours,
        },
      });
      this.tally(result, created, severity);
    }
    return result;
  }

  async scanRatingGainSpike(input: {
    now: Date;
    rules: ArenaAntiWintradeRules;
    matches: ArenaMatchSlim[];
    options: AntiWintradeScanOptions;
  }): Promise<AntiWintradeRuleScanResult> {
    const { rules, now, matches, options } = input;
    const sinceMs =
      now.getTime() - rules.ratingGainSpikeWindowHours * 3600 * 1000;
    const periodKey =
      options.periodKeyOverride ??
      arenaWintradePeriodKey(now, rules.ratingGainSpikeWindowHours);
    const type: ArenaWintradeType = 'RATING_GAIN_SPIKE';

    const perChar = new Map<string, { delta: number; count: number }>();
    for (const m of matches) {
      if (m.status !== 'RESOLVED' || !m.result) continue;
      if (m.createdAt.getTime() < sinceMs) continue;
      const rd = parseRatingDelta(m.ratingDeltaJson);
      if (!rd) continue;
      const a = perChar.get(m.attackerCharacterId) ?? { delta: 0, count: 0 };
      a.delta += rd.attacker;
      a.count += 1;
      perChar.set(m.attackerCharacterId, a);
      const d = perChar.get(m.defenderCharacterId) ?? { delta: 0, count: 0 };
      d.delta += rd.defender;
      d.count += 1;
      perChar.set(m.defenderCharacterId, d);
    }

    const result: AntiWintradeRuleScanResult = {
      alertsCreated: 0,
      alertsSkippedDuplicate: 0,
      alertsBySeverity: {},
    };
    for (const [characterId, agg] of perChar) {
      if (agg.delta <= 0) continue;
      const severity = severityForCount(
        agg.delta,
        rules.ratingGainSpikeThreshold,
        rules.criticalRatingGainSpike,
      );
      if (!severity) continue;
      const windowKey = arenaWintradeWindowKey(
        type,
        `${periodKey}:${characterId}`,
      );
      const created = await this.upsertAlert({
        type,
        severity,
        windowKey,
        attackerCharacterId: characterId,
        defenderCharacterId: null,
        relatedCharacterIds: [],
        details: {
          ratingDelta: agg.delta,
          matchCount: agg.count,
          windowHours: rules.ratingGainSpikeWindowHours,
        },
      });
      this.tally(result, created, severity);
    }
    return result;
  }

  async scanRewardFarmPattern(input: {
    now: Date;
    rules: ArenaAntiWintradeRules;
    matches: ArenaMatchSlim[];
    options: AntiWintradeScanOptions;
  }): Promise<AntiWintradeRuleScanResult> {
    const { rules, now, matches, options } = input;
    const periodKey =
      options.periodKeyOverride ??
      arenaWintradePeriodKey(now, rules.repeatedOpponentWindowHours);
    const type: ArenaWintradeType = 'REWARD_FARM_PATTERN';

    const perAttacker = new Map<
      string,
      { count: number; opponents: Set<string>; wins: number }
    >();
    for (const m of matches) {
      if (m.status !== 'RESOLVED' || !m.result) continue;
      const a = perAttacker.get(m.attackerCharacterId) ?? {
        count: 0,
        opponents: new Set<string>(),
        wins: 0,
      };
      a.count += 1;
      a.opponents.add(m.defenderCharacterId);
      if (m.result === 'ATTACKER_WIN') a.wins += 1;
      perAttacker.set(m.attackerCharacterId, a);
    }

    const result: AntiWintradeRuleScanResult = {
      alertsCreated: 0,
      alertsSkippedDuplicate: 0,
      alertsBySeverity: {},
    };
    for (const [attackerId, agg] of perAttacker) {
      if (agg.count < rules.rewardFarmMatchesMin) continue;
      if (agg.opponents.size >= rules.rewardFarmDistinctOpponentsMin) continue;
      // farm pattern: nhiều match nhưng ít defender khác nhau → WARN.
      // Nâng CRITICAL nếu opponents.size === 1 (single defender mill).
      const severity: ArenaWintradeSeverity =
        agg.opponents.size <= 1 ? 'CRITICAL' : 'WARN';
      const windowKey = arenaWintradeWindowKey(
        type,
        `${periodKey}:${attackerId}`,
      );
      const created = await this.upsertAlert({
        type,
        severity,
        windowKey,
        attackerCharacterId: attackerId,
        defenderCharacterId: null,
        relatedCharacterIds: Array.from(agg.opponents),
        details: {
          matchCount: agg.count,
          distinctOpponents: agg.opponents.size,
          wins: agg.wins,
          windowHours: rules.repeatedOpponentWindowHours,
        },
      });
      this.tally(result, created, severity);
    }
    return result;
  }

  async scanSeasonSuspiciousActors(input: {
    now: Date;
    rules: ArenaAntiWintradeRules;
    matches: ArenaMatchSlim[];
    options: AntiWintradeScanOptions;
  }): Promise<AntiWintradeRuleScanResult> {
    const { rules, now, matches, options } = input;
    const periodKey =
      options.periodKeyOverride ??
      arenaWintradePeriodKey(now, rules.repeatedOpponentWindowHours);
    const type: ArenaWintradeType = 'SEASON_SUSPICIOUS_ACTOR';

    // Aggregate per attacker: count, wins, distinct opponents.
    const perAttacker = new Map<
      string,
      { count: number; wins: number; opponents: Set<string> }
    >();
    for (const m of matches) {
      if (m.status !== 'RESOLVED' || !m.result) continue;
      const a = perAttacker.get(m.attackerCharacterId) ?? {
        count: 0,
        wins: 0,
        opponents: new Set<string>(),
      };
      a.count += 1;
      if (m.result === 'ATTACKER_WIN') a.wins += 1;
      a.opponents.add(m.defenderCharacterId);
      perAttacker.set(m.attackerCharacterId, a);
    }

    const result: AntiWintradeRuleScanResult = {
      alertsCreated: 0,
      alertsSkippedDuplicate: 0,
      alertsBySeverity: {},
    };
    for (const [attackerId, agg] of perAttacker) {
      if (agg.count < rules.seasonSuspiciousMinMatches) continue;
      const winRate = agg.wins / Math.max(1, agg.count);
      if (winRate < rules.suspiciousWinRateThreshold) continue;
      if (
        agg.opponents.size >= rules.seasonSuspiciousMinDistinctOpponents
      ) {
        continue;
      }
      const severity: ArenaWintradeSeverity =
        agg.opponents.size <= 1 ? 'CRITICAL' : 'WARN';
      const windowKey = arenaWintradeWindowKey(
        type,
        `${periodKey}:${attackerId}`,
      );
      const created = await this.upsertAlert({
        type,
        severity,
        windowKey,
        attackerCharacterId: attackerId,
        defenderCharacterId: null,
        relatedCharacterIds: Array.from(agg.opponents),
        details: {
          matchCount: agg.count,
          wins: agg.wins,
          winRate: Number(winRate.toFixed(4)),
          distinctOpponents: agg.opponents.size,
          windowHours: rules.repeatedOpponentWindowHours,
        },
      });
      this.tally(result, created, severity);
    }
    return result;
  }

  /* ----------------------------- Internals ----------------------------- */

  /** Slim Prisma select cho matches (chia sẻ giữa scanAll + quickCheckPair). */
  private readonly matchSlimSelect = {
    id: true,
    attackerCharacterId: true,
    defenderCharacterId: true,
    result: true,
    status: true,
    resolvedAt: true,
    createdAt: true,
    ratingDeltaJson: true,
  } as const;

  private async fetchRecentMatches(
    now: Date,
    hours: number,
  ): Promise<ArenaMatchSlim[]> {
    const since = new Date(now.getTime() - hours * 3600 * 1000);
    return this.prisma.arenaMatch.findMany({
      where: {
        status: 'RESOLVED',
        createdAt: { gte: since },
      },
      select: this.matchSlimSelect,
      orderBy: { createdAt: 'asc' },
    });
  }

  private async detectRepeatedPairFromMatches(input: {
    matches: ArenaMatchSlim[];
    rules: ArenaAntiWintradeRules;
    now: Date;
    periodKey: string;
    scopeAttacker?: string;
    scopeDefender?: string;
  }): Promise<AntiWintradeRuleScanResult> {
    const { matches, rules, periodKey, scopeAttacker, scopeDefender } = input;
    const type: ArenaWintradeType = 'REPEATED_OPPONENT_PAIR';

    const counts = new Map<
      string,
      { attacker: string; defender: string; count: number }
    >();
    for (const m of matches) {
      if (m.status !== 'RESOLVED') continue;
      // Directional pair: attacker→defender.
      const k = `${m.attackerCharacterId}→${m.defenderCharacterId}`;
      const v = counts.get(k) ?? {
        attacker: m.attackerCharacterId,
        defender: m.defenderCharacterId,
        count: 0,
      };
      v.count += 1;
      counts.set(k, v);
    }

    const result: AntiWintradeRuleScanResult = {
      alertsCreated: 0,
      alertsSkippedDuplicate: 0,
      alertsBySeverity: {},
    };
    for (const v of counts.values()) {
      if (
        scopeAttacker &&
        scopeDefender &&
        !(
          (v.attacker === scopeAttacker && v.defender === scopeDefender) ||
          (v.attacker === scopeDefender && v.defender === scopeAttacker)
        )
      ) {
        continue;
      }
      const severity = severityForCount(
        v.count,
        rules.maxMatchesSameOpponentPerWindow,
        rules.criticalRepeatedMatchesPerWindow,
      );
      if (!severity) continue;
      const windowKey = arenaWintradeWindowKey(
        type,
        `${periodKey}:${v.attacker}→${v.defender}`,
      );
      const created = await this.upsertAlert({
        type,
        severity,
        windowKey,
        attackerCharacterId: v.attacker,
        defenderCharacterId: v.defender,
        relatedCharacterIds: [],
        details: {
          matchCount: v.count,
          windowHours: rules.repeatedOpponentWindowHours,
        },
      });
      this.tally(result, created, severity);
    }
    return result;
  }

  private async upsertAlert(input: {
    type: ArenaWintradeType;
    severity: ArenaWintradeSeverity;
    windowKey: string;
    attackerCharacterId: string | null;
    defenderCharacterId: string | null;
    relatedCharacterIds: string[];
    details: Record<string, unknown>;
    seasonId?: string | null;
  }): Promise<'CREATED' | 'SKIPPED'> {
    try {
      await this.prisma.arenaWintradeAlert.create({
        data: {
          type: input.type,
          severity: input.severity,
          windowKey: input.windowKey,
          status: 'OPEN',
          attackerCharacterId: input.attackerCharacterId,
          defenderCharacterId: input.defenderCharacterId,
          seasonId: input.seasonId ?? null,
          relatedCharacterIdsJson:
            input.relatedCharacterIds as unknown as Prisma.InputJsonValue,
          detailsJson: input.details as unknown as Prisma.InputJsonValue,
        },
      });
      return 'CREATED';
    } catch (e) {
      if (
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === 'P2002'
      ) {
        // Unique violation → idempotent skip.
        return 'SKIPPED';
      }
      throw e;
    }
  }

  private tally(
    out: AntiWintradeRuleScanResult,
    created: 'CREATED' | 'SKIPPED',
    severity: ArenaWintradeSeverity,
  ): void {
    if (created === 'CREATED') {
      out.alertsCreated += 1;
      out.alertsBySeverity[severity] =
        (out.alertsBySeverity[severity] ?? 0) + 1;
    } else {
      out.alertsSkippedDuplicate += 1;
    }
  }
}

/* ---------------------------------------------------------------------------
 * Helpers
 * ------------------------------------------------------------------------- */

function parseRatingDelta(
  raw: Prisma.JsonValue,
): { attacker: number; defender: number } | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const obj = raw as Record<string, unknown>;
  const a = obj.attacker;
  const d = obj.defender;
  if (typeof a !== 'number' || typeof d !== 'number') return null;
  return { attacker: a, defender: d };
}

/**
 * Read rules from env. Default = `ARENA_ANTI_WINTRADE_RULES`. Caller có
 * thể override 1 vài threshold qua env (vd để giảm noise prod).
 *
 * Env keys:
 *   - ARENA_ANTI_WINTRADE_REPEATED_WINDOW_HOURS
 *   - ARENA_ANTI_WINTRADE_REPEATED_WARN
 *   - ARENA_ANTI_WINTRADE_REPEATED_CRITICAL
 *   - ARENA_ANTI_WINTRADE_RECIPROCAL_WARN
 *   - ARENA_ANTI_WINTRADE_RECIPROCAL_CRITICAL
 *   - ARENA_ANTI_WINTRADE_WIN_RATE_THRESHOLD
 *   - ARENA_ANTI_WINTRADE_RATING_SPIKE_HOURS
 *   - ARENA_ANTI_WINTRADE_RATING_SPIKE_WARN
 *   - ARENA_ANTI_WINTRADE_RATING_SPIKE_CRITICAL
 */
export function readAntiWintradeRulesFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): ArenaAntiWintradeRules {
  function readPosInt(key: string, fallback: number): number {
    const v = env[key];
    if (v === undefined || v === '') return fallback;
    const n = Number(v);
    if (!Number.isFinite(n) || n <= 0 || !Number.isInteger(n)) return fallback;
    return n;
  }
  function readPosFloat01(key: string, fallback: number): number {
    const v = env[key];
    if (v === undefined || v === '') return fallback;
    const n = Number(v);
    if (!Number.isFinite(n) || n <= 0 || n > 1) return fallback;
    return n;
  }

  return {
    repeatedOpponentWindowHours: readPosInt(
      'ARENA_ANTI_WINTRADE_REPEATED_WINDOW_HOURS',
      ARENA_ANTI_WINTRADE_RULES.repeatedOpponentWindowHours,
    ),
    maxMatchesSameOpponentPerWindow: readPosInt(
      'ARENA_ANTI_WINTRADE_REPEATED_WARN',
      ARENA_ANTI_WINTRADE_RULES.maxMatchesSameOpponentPerWindow,
    ),
    criticalRepeatedMatchesPerWindow: readPosInt(
      'ARENA_ANTI_WINTRADE_REPEATED_CRITICAL',
      ARENA_ANTI_WINTRADE_RULES.criticalRepeatedMatchesPerWindow,
    ),
    reciprocalMatchThreshold: readPosInt(
      'ARENA_ANTI_WINTRADE_RECIPROCAL_WARN',
      ARENA_ANTI_WINTRADE_RULES.reciprocalMatchThreshold,
    ),
    criticalReciprocalMatches: readPosInt(
      'ARENA_ANTI_WINTRADE_RECIPROCAL_CRITICAL',
      ARENA_ANTI_WINTRADE_RULES.criticalReciprocalMatches,
    ),
    suspiciousWinRateThreshold: readPosFloat01(
      'ARENA_ANTI_WINTRADE_WIN_RATE_THRESHOLD',
      ARENA_ANTI_WINTRADE_RULES.suspiciousWinRateThreshold,
    ),
    minMatchesForWinRate: ARENA_ANTI_WINTRADE_RULES.minMatchesForWinRate,
    ratingGainSpikeWindowHours: readPosInt(
      'ARENA_ANTI_WINTRADE_RATING_SPIKE_HOURS',
      ARENA_ANTI_WINTRADE_RULES.ratingGainSpikeWindowHours,
    ),
    ratingGainSpikeThreshold: readPosInt(
      'ARENA_ANTI_WINTRADE_RATING_SPIKE_WARN',
      ARENA_ANTI_WINTRADE_RULES.ratingGainSpikeThreshold,
    ),
    criticalRatingGainSpike: readPosInt(
      'ARENA_ANTI_WINTRADE_RATING_SPIKE_CRITICAL',
      ARENA_ANTI_WINTRADE_RULES.criticalRatingGainSpike,
    ),
    rewardFarmMatchesMin: ARENA_ANTI_WINTRADE_RULES.rewardFarmMatchesMin,
    rewardFarmDistinctOpponentsMin:
      ARENA_ANTI_WINTRADE_RULES.rewardFarmDistinctOpponentsMin,
    seasonSuspiciousMinDistinctOpponents:
      ARENA_ANTI_WINTRADE_RULES.seasonSuspiciousMinDistinctOpponents,
    seasonSuspiciousMinMatches:
      ARENA_ANTI_WINTRADE_RULES.seasonSuspiciousMinMatches,
  };
}

