/**
 * Phase 29.0 — PvP Battle service.
 *
 * Quản lý lifecycle 1 trận PvP non-arena: DUEL / FRIENDLY_SPARRING /
 * SECT_WAR / TERRITORY_WAR / EVENT_PVP. Mode ARENA tiếp tục dùng
 * `ArenaService` riêng (Phase 14.1.B/C).
 *
 * Lifecycle:
 *   1. challenge(attackerId, defenderId, mode, options):
 *      a. Validate attacker != defender, both exist.
 *      b. Validate power gap (block khi > policy.powerGapMatchBlockThreshold).
 *      c. Validate cooldown cùng target (sameTargetCooldownMinutes).
 *      d. Build attacker snapshot (ATTACKER), load defender snapshot
 *         qua DefenseService (DEFENDER, fallback rebuild).
 *      e. Compute result deterministic (seed-based) — KHÔNG full combat,
 *         chỉ "power roll" với variance ±15%.
 *      f. Insert `PvpBattle` row status=RESOLVED ngay (async only, không
 *         có pending state cho V1).
 *      g. Apply rating change (DUEL only) qua `ratingChangeJson`. Reward
 *         grant TBD (PR2 sẽ wire ledger).
 *
 *   2. listLogs(characterId, mode?, limit, cursor): pagination history.
 *
 * Invariants (spec PHẦN 1 §4 & PHẦN 20):
 *   - FRIENDLY_SPARRING → rewardGranted=false, ratingChange=0 (zero
 *     economic impact). Enforced by `computeFriendlyMatch`.
 *   - Snapshot immutable sau resolve.
 *   - PaidChallenge ≤ free/4 — enforced ở balance policy.
 */
import { Injectable } from '@nestjs/common';
import {
  PVP_DEFAULT_BALANCE_POLICY,
  computeFriendlyMatch,
  computePvpPowerGap,
  shouldBlockChallengeByPowerGap,
  validatePvpBattleResolve,
  type PvpBalancePolicy,
  type PvpBattleSnapshot,
  type PvpMode,
  type PvpResult,
} from '@xuantoi/shared';
import { PrismaService } from '../../common/prisma.service';
import { PvpSnapshotService } from './snapshot.service';
import { PvpDefenseService } from './defense.service';

export class PvpBattleError extends Error {
  constructor(
    public readonly code:
      | 'PVP_TARGET_NOT_FOUND'
      | 'PVP_TARGET_SELF'
      | 'PVP_TARGET_TOO_STRONG'
      | 'PVP_SAME_TARGET_COOLDOWN'
      | 'PVP_DAILY_LIMIT_REACHED'
      | 'PVP_INVALID_MODE'
      | 'PVP_BATTLE_NOT_FOUND'
      | 'PVP_BATTLE_INVALID_RESOLVE',
    message: string,
  ) {
    super(message);
    this.name = 'PvpBattleError';
  }
}

export interface ChallengeInput {
  attackerCharacterId: string;
  defenderCharacterId: string;
  mode: PvpMode;
  /** Idempotency token (UUID) — chặn double-resolve race. */
  idempotencyKey?: string;
  /** Reference module key (vd `event:hoa_phong_2026`, `sectwar:match_xx`). */
  sourceModuleKey?: string;
}

export interface ChallengeResult {
  battleId: string;
  result: PvpResult;
  attackerSnapshot: PvpBattleSnapshot;
  defenderSnapshot: PvpBattleSnapshot;
  rewardGranted: boolean;
  powerGap: number;
  ratingChange: { attackerDelta: number; defenderDelta: number } | null;
}

@Injectable()
export class PvpBattleService {
  /** Server-side mutable policy override — PR2 sẽ wire admin /pvp/policy. */
  policy: PvpBalancePolicy = { ...PVP_DEFAULT_BALANCE_POLICY };

  constructor(
    private readonly prisma: PrismaService,
    private readonly snapshotSvc: PvpSnapshotService,
    private readonly defenseSvc: PvpDefenseService,
  ) {}

  /**
   * Create + resolve trận PvP ngay (V1 async-only). KHÔNG hỗ trợ DUEL_REQUEST
   * 2-step (sẽ làm ở Phase 29.1+).
   */
  async challenge(input: ChallengeInput): Promise<ChallengeResult> {
    if (input.mode === 'ARENA') {
      throw new PvpBattleError(
        'PVP_INVALID_MODE',
        'mode ARENA dùng `ArenaService.challenge` riêng',
      );
    }
    if (input.attackerCharacterId === input.defenderCharacterId) {
      throw new PvpBattleError(
        'PVP_TARGET_SELF',
        'không thể tự khiêu chiến mình',
      );
    }

    // Idempotency check.
    if (input.idempotencyKey) {
      const existing = await this.prisma.pvpBattle.findUnique({
        where: { idempotencyKey: input.idempotencyKey },
      });
      if (existing) {
        return this.fromRow(existing);
      }
    }

    // Build snapshots (anti-cheat: snapshot tại queue, KHÔNG sau resolve).
    const attackerSnapshot = await this.snapshotSvc.buildForCharacter(
      input.attackerCharacterId,
      'ATTACKER',
    );
    const defenderSnapshot = await this.defenseSvc.loadOrBuild(
      input.defenderCharacterId,
    );

    // Power gap check (skip cho SECT_WAR/TERRITORY_WAR — đã có league-based
    // matchmaking ở phase trước).
    const powerGap = computePvpPowerGap(
      attackerSnapshot.totalPower,
      defenderSnapshot.totalPower,
    );
    if (
      input.mode !== 'SECT_WAR' &&
      input.mode !== 'TERRITORY_WAR' &&
      input.mode !== 'EVENT_PVP'
    ) {
      const { blocked } = shouldBlockChallengeByPowerGap(powerGap, this.policy);
      if (
        blocked &&
        attackerSnapshot.totalPower < defenderSnapshot.totalPower
      ) {
        // Khi attacker yếu hơn nhiều → block "tự sát farm".
        throw new PvpBattleError(
          'PVP_TARGET_TOO_STRONG',
          `power gap ${powerGap.toFixed(2)}x vượt ngưỡng ${this.policy.powerGapMatchBlockThreshold}x`,
        );
      }
      // Note: attacker mạnh hơn cũng block (chặn farming newbie).
      if (
        blocked &&
        attackerSnapshot.totalPower > defenderSnapshot.totalPower
      ) {
        throw new PvpBattleError(
          'PVP_TARGET_TOO_STRONG',
          `mạnh hơn defender ${powerGap.toFixed(2)}x — chặn farming`,
        );
      }
    }

    // Cooldown cùng target.
    if (input.mode === 'DUEL' || input.mode === 'FRIENDLY_SPARRING') {
      const cooldownStart = new Date(
        Date.now() - this.policy.sameTargetCooldownMinutes * 60_000,
      );
      const recent = await this.prisma.pvpBattle.findFirst({
        where: {
          attackerCharacterId: input.attackerCharacterId,
          defenderCharacterId: input.defenderCharacterId,
          mode: input.mode,
          createdAt: { gte: cooldownStart },
        },
        select: { id: true },
      });
      if (recent) {
        throw new PvpBattleError(
          'PVP_SAME_TARGET_COOLDOWN',
          `cooldown ${this.policy.sameTargetCooldownMinutes} phút với cùng defender`,
        );
      }
    }

    // Resolve (deterministic).
    const seed = (Date.now() ^ this.hash(input.attackerCharacterId)) | 0;
    const result = this.resolveDeterministic(
      attackerSnapshot.totalPower,
      defenderSnapshot.totalPower,
      seed,
    );
    const friendly = computeFriendlyMatch(input.mode);
    const rewardGranted = friendly ? friendly.rewardGranted : true;
    const ratingChange = this.computeRatingDelta(input.mode, result);

    // Validator: FRIENDLY_SPARRING không grant reward (anti-economic-bypass).
    const resolveIssues = validatePvpBattleResolve({
      mode: input.mode,
      status: 'RESOLVED',
      result,
      rewardGranted,
    });
    if (resolveIssues.length > 0) {
      throw new PvpBattleError(
        'PVP_BATTLE_INVALID_RESOLVE',
        `validatePvpBattleResolve fail: ${resolveIssues.map((i) => i.code).join(',')}`,
      );
    }

    const rewardJsonValue = rewardGranted
      ? (this.buildRewardSnapshot(input.mode, result) as unknown as object)
      : undefined;
    const row = await this.prisma.pvpBattle.create({
      data: {
        mode: input.mode,
        attackerCharacterId: input.attackerCharacterId,
        defenderCharacterId: input.defenderCharacterId,
        status: 'RESOLVED',
        result,
        attackerSnapshotJson: attackerSnapshot as unknown as object,
        defenderSnapshotJson: defenderSnapshot as unknown as object,
        seed,
        roundsJson: this.buildRoundsSummary(
          attackerSnapshot,
          defenderSnapshot,
          result,
        ),
        ...(rewardJsonValue !== undefined
          ? { rewardJson: rewardJsonValue as never }
          : {}),
        ratingChangeJson: ratingChange ?? undefined,
        sourceModuleKey: input.sourceModuleKey ?? null,
        rewardGranted,
        idempotencyKey: input.idempotencyKey ?? null,
        resolvedAt: new Date(),
      },
    });

    return {
      battleId: row.id,
      result,
      attackerSnapshot,
      defenderSnapshot,
      rewardGranted,
      powerGap,
      ratingChange,
    };
  }

  async listLogs(
    characterId: string,
    options: { mode?: PvpMode; limit?: number; cursor?: string } = {},
  ) {
    const limit = Math.min(50, Math.max(1, options.limit ?? 20));
    const where = {
      AND: [
        {
          OR: [
            { attackerCharacterId: characterId },
            { defenderCharacterId: characterId },
          ],
        },
        options.mode ? { mode: options.mode } : {},
      ],
    } as const;
    const rows = await this.prisma.pvpBattle.findMany({
      where: where as never,
      orderBy: { createdAt: 'desc' },
      take: limit,
      ...(options.cursor
        ? { cursor: { id: options.cursor }, skip: 1 }
        : {}),
    });
    return rows.map((r) => ({
      id: r.id,
      mode: r.mode,
      status: r.status,
      result: r.result,
      attackerCharacterId: r.attackerCharacterId,
      defenderCharacterId: r.defenderCharacterId,
      powerGap: computePvpPowerGap(
        (r.attackerSnapshotJson as unknown as PvpBattleSnapshot).totalPower ?? 0,
        (r.defenderSnapshotJson as unknown as PvpBattleSnapshot).totalPower ?? 0,
      ),
      rewardGranted: r.rewardGranted,
      sourceModuleKey: r.sourceModuleKey,
      createdAt: r.createdAt.toISOString(),
      resolvedAt: r.resolvedAt?.toISOString() ?? null,
    }));
  }

  async getById(battleId: string) {
    const row = await this.prisma.pvpBattle.findUnique({
      where: { id: battleId },
    });
    if (!row) {
      throw new PvpBattleError(
        'PVP_BATTLE_NOT_FOUND',
        `battle ${battleId} không tồn tại`,
      );
    }
    return row;
  }

  /**
   * Admin invalidate — flag `status=INVALIDATED`, KHÔNG xoá. Audit log
   * gọi ở admin controller.
   */
  async invalidate(battleId: string, reason: string) {
    const row = await this.prisma.pvpBattle.findUnique({
      where: { id: battleId },
    });
    if (!row) {
      throw new PvpBattleError(
        'PVP_BATTLE_NOT_FOUND',
        `battle ${battleId} không tồn tại`,
      );
    }
    if (row.status === 'INVALIDATED') return row;
    return await this.prisma.pvpBattle.update({
      where: { id: battleId },
      data: {
        status: 'INVALIDATED',
        rewardGranted: false,
        ratingChangeJson: { invalidatedReason: reason },
      },
    });
  }

  // ── helpers ──────────────────────────────────────────────────────────

  private resolveDeterministic(
    attackerPower: number,
    defenderPower: number,
    seed: number,
  ): PvpResult {
    // Variance ±15% theo seed → tránh deterministic tuyệt đối nhưng vẫn replay-safe.
    const aRoll = attackerPower * (1 + this.seededVariance(seed, 0));
    const dRoll = defenderPower * (1 + this.seededVariance(seed, 1));
    if (Math.abs(aRoll - dRoll) < 0.01 * Math.max(aRoll, dRoll)) {
      return 'DRAW';
    }
    return aRoll > dRoll ? 'ATTACKER_WIN' : 'DEFENDER_WIN';
  }

  private seededVariance(seed: number, salt: number): number {
    // Mulberry32 1 step + salt.
    let t = (seed + salt * 0x6d2b79f5) | 0;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    const rand = (((t ^ (t >>> 14)) >>> 0) % 30000) / 100000; // 0..0.30
    return rand - 0.15; // -0.15..+0.15
  }

  private buildRoundsSummary(
    a: PvpBattleSnapshot,
    d: PvpBattleSnapshot,
    result: PvpResult,
  ) {
    return {
      summary: `power ${a.totalPower} vs ${d.totalPower} → ${result}`,
      rounds: [
        { round: 1, attackerDelta: -10, defenderDelta: -15, note: 'opening' },
        { round: 2, attackerDelta: -20, defenderDelta: -30, note: 'mid' },
        { round: 3, attackerDelta: -5, defenderDelta: -50, note: 'close' },
      ],
    };
  }

  private buildRewardSnapshot(mode: PvpMode, result: PvpResult) {
    if (result === 'DRAW' || result === 'FORFEIT') {
      return { tokens: { pvpToken: 0 }, items: [] };
    }
    // V1: chỉ display, KHÔNG grant. PR2 wire ledger/cap.
    const baseToken = mode === 'DUEL' ? 5 : mode === 'EVENT_PVP' ? 8 : 3;
    return {
      tokens: { pvpToken: result === 'ATTACKER_WIN' ? baseToken : 1 },
      items: [],
      note: 'V1 display-only — ledger grant ở Phase 29.1+',
    };
  }

  private computeRatingDelta(
    mode: PvpMode,
    result: PvpResult,
  ): { attackerDelta: number; defenderDelta: number } | null {
    if (mode !== 'DUEL') return null;
    if (result === 'DRAW') return { attackerDelta: 0, defenderDelta: 0 };
    if (result === 'FORFEIT') return { attackerDelta: -5, defenderDelta: 0 };
    return result === 'ATTACKER_WIN'
      ? { attackerDelta: +10, defenderDelta: -10 }
      : { attackerDelta: -10, defenderDelta: +10 };
  }

  private hash(s: string): number {
    let h = 0;
    for (let i = 0; i < s.length; i++) {
      h = (h * 31 + s.charCodeAt(i)) | 0;
    }
    return h;
  }

  private async fromRow(
    row: Awaited<ReturnType<PrismaService['pvpBattle']['findUnique']>>,
  ): Promise<ChallengeResult> {
    if (!row) {
      throw new PvpBattleError(
        'PVP_BATTLE_NOT_FOUND',
        'idempotency lookup không tìm thấy',
      );
    }
    const a = row.attackerSnapshotJson as unknown as PvpBattleSnapshot;
    const d = row.defenderSnapshotJson as unknown as PvpBattleSnapshot;
    return {
      battleId: row.id,
      result: (row.result as PvpResult) ?? 'DRAW',
      attackerSnapshot: a,
      defenderSnapshot: d,
      rewardGranted: row.rewardGranted,
      powerGap: computePvpPowerGap(a.totalPower, d.totalPower),
      ratingChange: row.ratingChangeJson
        ? (row.ratingChangeJson as unknown as {
            attackerDelta: number;
            defenderDelta: number;
          })
        : null,
    };
  }
}
