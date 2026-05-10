/**
 * Phase 14.1.B — Async Arena Foundation service.
 *
 * Trách nhiệm:
 *   - `getOrCreateProfile(characterId)`: lazy-create `ArenaProfile` cho
 *     character. Reset `attacksToday` khi sang ngày mới (server tz).
 *   - `listOpponents(characterId, opts)`: trả opponents gần rating, exclude
 *     self. Fallback random pool nếu không có cùng-bucket nào.
 *   - `createMatch(attackerCharacterId, opts)`: build attacker + defender
 *     snapshot, resolve combat deterministic qua `resolveCombatWithSnapshot`,
 *     persist `ArenaMatch` row, update rating + counters.
 *   - `getMatchHistory(characterId, opts)`: list match attacker hoặc defender
 *     đã tham gia (DESC by createdAt).
 *
 * Resolution là sync trong cùng request — Phase 14.1.B chưa có async worker
 * queue; future 14.1.C có thể defer resolution sang worker (PENDING status
 * sẽ hữu dụng khi đó).
 *
 * KHÔNG đụng tới Mail / Currency / Inventory — Phase 14.1.B không grant
 * reward. Defer 14.1.C.
 */
import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  ARENA_DAILY_LIMIT_DEFAULT,
  ARENA_RATING_DEFAULT,
  arenaDayBucket,
  arenaRankTierFor,
  arenaRatingDeltaFor,
  buildCombatActorSnapshot,
  clampArenaRating,
  composeSeed,
  hashSeed,
  resolveCombatWithSnapshot,
  type ArenaBattleLogLine,
  type ArenaDailyLimitConfig,
  type ArenaMatchOutcome,
  type ArenaMatchResult,
  type ArenaMatchStatus,
  type ArenaOpponentSummary,
  type ArenaProfileSummary,
  type ArenaRatingDelta,
  type CombatActorSnapshot,
  type CombatSimulationResult,
  type ElementKey,
} from '@xuantoi/shared';
import { PrismaService } from '../../common/prisma.service';

/* ---------------------------------------------------------------------------
 * Errors
 * ------------------------------------------------------------------------- */

export type ArenaErrorCode =
  | 'NO_CHARACTER'
  | 'DEFENDER_NOT_FOUND'
  | 'CANNOT_ATTACK_SELF'
  | 'INVALID_INPUT'
  | 'DAILY_LIMIT_REACHED';

export class ArenaError extends Error {
  constructor(public code: ArenaErrorCode) {
    super(code);
  }
}

/* ---------------------------------------------------------------------------
 * Config
 * ------------------------------------------------------------------------- */

/**
 * Default daily limit. Có thể override qua env `ARENA_DAILY_LIMIT_PER_DAY`
 * (positive int — `0` = vô hạn). Phase 14.1.B đơn giản 1 cap chung.
 */
function readDailyLimitConfig(): ArenaDailyLimitConfig {
  const raw = process.env.ARENA_DAILY_LIMIT_PER_DAY;
  if (raw !== undefined) {
    const n = Number(raw);
    if (Number.isFinite(n) && n >= 0 && Number.isInteger(n)) {
      return { ...ARENA_DAILY_LIMIT_DEFAULT, maxAttacksPerDay: n };
    }
  }
  return ARENA_DAILY_LIMIT_DEFAULT;
}

const OPPONENT_RATING_WINDOW = 200; // ± rating range cho near-bucket pool.
const OPPONENT_DEFAULT_LIMIT = 8; // số opponent trả về mặc định.
const OPPONENT_MAX_LIMIT = 20;
const HISTORY_DEFAULT_LIMIT = 20;
const HISTORY_MAX_LIMIT = 100;
const BATTLE_LOG_MAX_LINES = 12; // condensed log cho FE; full log lưu DB.

/* ---------------------------------------------------------------------------
 * Service
 * ------------------------------------------------------------------------- */

interface CharacterRow {
  id: string;
  name: string;
  realmKey: string;
  realmStage: number;
  hp: number;
  hpMax: number;
  mp: number;
  mpMax: number;
  power: number;
  spirit: number;
  speed: number;
  primaryElement: string | null;
  sectId: string | null;
}

interface CharacterRowWithSect extends CharacterRow {
  sect: { name: string } | null;
}

interface ListOpponentsOptions {
  limit?: number;
}

interface CreateMatchOptions {
  defenderCharacterId: string;
  /** Optional override seed (test/admin). Server tự generate nếu thiếu. */
  seed?: number;
}

interface HistoryOptions {
  limit?: number;
  /** `'all'` = attacker hoặc defender. `'attacker'` = chỉ outgoing. */
  side?: 'all' | 'attacker' | 'defender';
}

interface ArenaProfileRow {
  id: string;
  characterId: string;
  rating: number;
  wins: number;
  losses: number;
  draws: number;
  attacksToday: number;
  lastAttackDayBucket: string | null;
  defenseSnapshotJson: Prisma.JsonValue;
  createdAt: Date;
  updatedAt: Date;
}

@Injectable()
export class ArenaService {
  private readonly logger = new Logger(ArenaService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Daily limit config — re-read mỗi request để env override hot-reload
   * trong test. Cheap.
   */
  getDailyLimitConfig(): ArenaDailyLimitConfig {
    return readDailyLimitConfig();
  }

  /* ----------------------------- Profile ----------------------------- */

  async getOrCreateProfile(characterId: string): Promise<ArenaProfileSummary> {
    const character = await this.requireCharacter(characterId);
    const profile = await this.ensureProfileRow(characterId);
    const rolled = await this.rolloverDailyIfNeeded(profile);
    return this.toProfileSummary(character, rolled);
  }

  /* ----------------------------- Opponents ----------------------------- */

  async listOpponents(
    characterId: string,
    opts: ListOpponentsOptions = {},
  ): Promise<readonly ArenaOpponentSummary[]> {
    await this.requireCharacter(characterId);
    const profile = await this.ensureProfileRow(characterId);
    const limit = clampLimit(
      opts.limit ?? OPPONENT_DEFAULT_LIMIT,
      OPPONENT_MAX_LIMIT,
    );

    // Near-bucket: same rating ± window (exclude self).
    const ratingMin = profile.rating - OPPONENT_RATING_WINDOW;
    const ratingMax = profile.rating + OPPONENT_RATING_WINDOW;
    const nearRows = await this.prisma.arenaProfile.findMany({
      where: {
        characterId: { not: characterId },
        rating: { gte: ratingMin, lte: ratingMax },
      },
      orderBy: { rating: 'asc' },
      take: limit,
      include: {
        character: {
          include: { sect: { select: { name: true } } },
        },
      },
    });
    if (nearRows.length >= limit) {
      return nearRows.map((r) => this.toOpponentSummary(r));
    }

    // Fallback: take any other arena profile (random-ish via createdAt order).
    const exclude = new Set<string>([
      characterId,
      ...nearRows.map((r) => r.characterId),
    ]);
    const fallbackRows = await this.prisma.arenaProfile.findMany({
      where: {
        characterId: { notIn: Array.from(exclude) },
      },
      orderBy: { updatedAt: 'desc' },
      take: limit - nearRows.length,
      include: {
        character: {
          include: { sect: { select: { name: true } } },
        },
      },
    });
    return [...nearRows, ...fallbackRows].map((r) => this.toOpponentSummary(r));
  }

  /* ----------------------------- Create match ----------------------------- */

  async createMatch(
    attackerCharacterId: string,
    opts: CreateMatchOptions,
  ): Promise<ArenaMatchResult> {
    const defenderCharacterId = opts.defenderCharacterId;
    if (!defenderCharacterId || typeof defenderCharacterId !== 'string') {
      throw new ArenaError('INVALID_INPUT');
    }
    if (defenderCharacterId === attackerCharacterId) {
      throw new ArenaError('CANNOT_ATTACK_SELF');
    }

    const attacker = await this.requireCharacter(attackerCharacterId);
    const defender = await this.findCharacter(defenderCharacterId);
    if (!defender) throw new ArenaError('DEFENDER_NOT_FOUND');

    // Lazy-create both profiles (defender may not have GET'd yet).
    const attackerProfile = await this.ensureProfileRow(attackerCharacterId);
    const defenderProfile = await this.ensureProfileRow(defenderCharacterId);

    const rolled = await this.rolloverDailyIfNeeded(attackerProfile);
    const dailyLimit = readDailyLimitConfig();
    if (
      dailyLimit.maxAttacksPerDay > 0 &&
      rolled.attacksToday >= dailyLimit.maxAttacksPerDay
    ) {
      throw new ArenaError('DAILY_LIMIT_REACHED');
    }

    // Build combat snapshots.
    const attackerSnapshot = buildArenaActorSnapshot(attacker);
    const defenderSnapshot = buildArenaActorSnapshot(defender);

    // Resolve seed: caller-passed (test) or server-derived from match-id-to-be.
    // We need the match id to derive deterministic seed but also need seed
    // to resolve before insert. Use 2-step: insert PENDING row first, then
    // derive seed from row id, resolve, update RESOLVED.
    return this.prisma.$transaction(async (tx) => {
      const pending = await tx.arenaMatch.create({
        data: {
          attackerCharacterId,
          defenderCharacterId,
          status: 'PENDING' satisfies ArenaMatchStatus,
          attackerSnapshotJson: attackerSnapshot as unknown as Prisma.InputJsonValue,
          defenderSnapshotJson: defenderSnapshot as unknown as Prisma.InputJsonValue,
          seed: 0,
          battleLogJson: [] as unknown as Prisma.InputJsonValue,
        },
      });

      const seed = opts.seed ?? hashSeed(`arena-match:${pending.id}`);
      const sim = resolveCombatWithSnapshot({
        attacker: attackerSnapshot,
        defender: defenderSnapshot,
        seed,
        context: { source: 'ARENA_PREP', regionKey: null, elementContext: null },
      });

      const outcome: ArenaMatchOutcome =
        sim.winner === 'attacker'
          ? 'ATTACKER_WIN'
          : sim.winner === 'defender'
            ? 'DEFENDER_WIN'
            : 'DRAW';

      const ratingDelta = arenaRatingDeltaFor(outcome);
      const winnerCharacterId =
        outcome === 'ATTACKER_WIN'
          ? attackerCharacterId
          : outcome === 'DEFENDER_WIN'
            ? defenderCharacterId
            : null;

      const battleLog = compactBattleLog(sim);
      const today = arenaDayBucket(new Date(), dailyLimit.tz);
      const resolvedAt = new Date();

      const updated = await tx.arenaMatch.update({
        where: { id: pending.id },
        data: {
          status: 'RESOLVED' satisfies ArenaMatchStatus,
          result: outcome,
          winnerCharacterId,
          seed,
          battleLogJson: battleLog as unknown as Prisma.InputJsonValue,
          ratingDeltaJson: ratingDelta as unknown as Prisma.InputJsonValue,
          resolvedAt,
        },
      });

      const attackerRatingAfter = clampArenaRating(
        rolled.rating + ratingDelta.attacker,
      );
      const defenderRatingAfter = clampArenaRating(
        defenderProfile.rating + ratingDelta.defender,
      );

      await tx.arenaProfile.update({
        where: { characterId: attackerCharacterId },
        data: {
          rating: attackerRatingAfter,
          wins: outcome === 'ATTACKER_WIN' ? { increment: 1 } : undefined,
          losses: outcome === 'DEFENDER_WIN' ? { increment: 1 } : undefined,
          draws: outcome === 'DRAW' ? { increment: 1 } : undefined,
          attacksToday: { increment: 1 },
          lastAttackDayBucket: today,
        },
      });

      await tx.arenaProfile.update({
        where: { characterId: defenderCharacterId },
        data: {
          rating: defenderRatingAfter,
        },
      });

      return {
        matchId: updated.id,
        status: 'RESOLVED',
        outcome,
        attackerCharacterId,
        attackerName: attacker.name,
        defenderCharacterId,
        defenderName: defender.name,
        seed,
        ratingDelta,
        attackerRatingAfter,
        defenderRatingAfter,
        totalAttackerDamage: sim.damageSummary.totalAttackerDamage,
        totalDefenderDamage: sim.damageSummary.totalDefenderDamage,
        rounds: sim.damageSummary.rounds,
        battleLog,
        createdAt: updated.createdAt.toISOString(),
        resolvedAt: updated.resolvedAt?.toISOString() ?? resolvedAt.toISOString(),
      } satisfies ArenaMatchResult;
    });
  }

  /* ----------------------------- History ----------------------------- */

  async getMatchHistory(
    characterId: string,
    opts: HistoryOptions = {},
  ): Promise<readonly ArenaMatchResult[]> {
    await this.requireCharacter(characterId);
    const limit = clampLimit(
      opts.limit ?? HISTORY_DEFAULT_LIMIT,
      HISTORY_MAX_LIMIT,
    );
    const side = opts.side ?? 'all';
    const where: Prisma.ArenaMatchWhereInput =
      side === 'attacker'
        ? { attackerCharacterId: characterId }
        : side === 'defender'
          ? { defenderCharacterId: characterId }
          : {
              OR: [
                { attackerCharacterId: characterId },
                { defenderCharacterId: characterId },
              ],
            };

    const rows = await this.prisma.arenaMatch.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: limit,
      include: {
        attacker: { select: { name: true } },
        defender: { select: { name: true } },
      },
    });

    return rows.map((row) => this.toHistoryResult(row));
  }

  /* ----------------------------- Internals ----------------------------- */

  private async requireCharacter(id: string): Promise<CharacterRowWithSect> {
    const c = await this.findCharacter(id);
    if (!c) throw new ArenaError('NO_CHARACTER');
    return c;
  }

  private async findCharacter(id: string): Promise<CharacterRowWithSect | null> {
    const row = await this.prisma.character.findUnique({
      where: { id },
      include: { sect: { select: { name: true } } },
    });
    if (!row) return null;
    return {
      id: row.id,
      name: row.name,
      realmKey: row.realmKey,
      realmStage: row.realmStage,
      hp: row.hp,
      hpMax: row.hpMax,
      mp: row.mp,
      mpMax: row.mpMax,
      power: row.power,
      spirit: row.spirit,
      speed: row.speed,
      primaryElement: row.primaryElement,
      sectId: row.sectId,
      sect: row.sect ? { name: row.sect.name } : null,
    };
  }

  private async ensureProfileRow(characterId: string): Promise<ArenaProfileRow> {
    const existing = await this.prisma.arenaProfile.findUnique({
      where: { characterId },
    });
    if (existing) return existing as ArenaProfileRow;
    return (await this.prisma.arenaProfile.create({
      data: {
        characterId,
        rating: ARENA_RATING_DEFAULT,
      },
    })) as ArenaProfileRow;
  }

  private async rolloverDailyIfNeeded(
    profile: ArenaProfileRow,
  ): Promise<ArenaProfileRow> {
    const cfg = readDailyLimitConfig();
    const today = arenaDayBucket(new Date(), cfg.tz);
    if (profile.lastAttackDayBucket === today) return profile;
    if (profile.attacksToday === 0 && profile.lastAttackDayBucket === null) {
      // Brand-new profile, no attack ever. Set today bucket lazily on first
      // attack — keep counters as-is.
      return profile;
    }
    return (await this.prisma.arenaProfile.update({
      where: { characterId: profile.characterId },
      data: { attacksToday: 0, lastAttackDayBucket: today },
    })) as ArenaProfileRow;
  }

  private toProfileSummary(
    character: CharacterRowWithSect,
    profile: ArenaProfileRow,
  ): ArenaProfileSummary {
    const cfg = readDailyLimitConfig();
    const todayBucket = arenaDayBucket(new Date(), cfg.tz);
    const attacksToday =
      profile.lastAttackDayBucket === todayBucket ? profile.attacksToday : 0;
    const remaining =
      cfg.maxAttacksPerDay > 0
        ? Math.max(0, cfg.maxAttacksPerDay - attacksToday)
        : Number.POSITIVE_INFINITY;
    return {
      characterId: profile.characterId,
      characterName: character.name,
      rating: profile.rating,
      tier: arenaRankTierFor(profile.rating),
      wins: profile.wins,
      losses: profile.losses,
      draws: profile.draws,
      attacksToday,
      attacksRemaining: Number.isFinite(remaining) ? remaining : -1,
      todayBucket,
      createdAt: profile.createdAt.toISOString(),
      updatedAt: profile.updatedAt.toISOString(),
    };
  }

  private toOpponentSummary(row: {
    characterId: string;
    rating: number;
    wins: number;
    losses: number;
    character: {
      name: string;
      realmKey: string;
      realmStage: number;
      sect: { name: string } | null;
    };
  }): ArenaOpponentSummary {
    return {
      characterId: row.characterId,
      characterName: row.character.name,
      realmKey: row.character.realmKey,
      realmStage: row.character.realmStage,
      rating: row.rating,
      tier: arenaRankTierFor(row.rating),
      wins: row.wins,
      losses: row.losses,
      sectName: row.character.sect?.name ?? null,
    };
  }

  private toHistoryResult(row: {
    id: string;
    status: string;
    result: string | null;
    winnerCharacterId: string | null;
    attackerCharacterId: string;
    defenderCharacterId: string;
    attacker: { name: string };
    defender: { name: string };
    seed: number;
    battleLogJson: Prisma.JsonValue;
    ratingDeltaJson: Prisma.JsonValue;
    createdAt: Date;
    resolvedAt: Date | null;
  }): ArenaMatchResult {
    const status = (row.status as ArenaMatchStatus) ?? 'PENDING';
    const outcome: ArenaMatchOutcome =
      row.result === 'ATTACKER_WIN' ||
      row.result === 'DEFENDER_WIN' ||
      row.result === 'DRAW'
        ? row.result
        : 'DRAW';
    const battleLog = parseBattleLog(row.battleLogJson);
    const ratingDelta = parseRatingDelta(row.ratingDeltaJson);
    return {
      matchId: row.id,
      status,
      outcome,
      attackerCharacterId: row.attackerCharacterId,
      attackerName: row.attacker.name,
      defenderCharacterId: row.defenderCharacterId,
      defenderName: row.defender.name,
      seed: row.seed,
      ratingDelta,
      attackerRatingAfter: 0,
      defenderRatingAfter: 0,
      totalAttackerDamage: sumDamage(battleLog, 'attacker'),
      totalDefenderDamage: sumDamage(battleLog, 'defender'),
      rounds: battleLog.length,
      battleLog,
      createdAt: row.createdAt.toISOString(),
      resolvedAt: row.resolvedAt?.toISOString() ?? null,
    };
  }
}

/* ---------------------------------------------------------------------------
 * Helpers (module-private)
 * ------------------------------------------------------------------------- */

function clampLimit(n: number, max: number): number {
  if (!Number.isFinite(n)) return max;
  if (n < 1) return 1;
  if (n > max) return max;
  return Math.floor(n);
}

function compactBattleLog(sim: CombatSimulationResult): ArenaBattleLogLine[] {
  const lines: ArenaBattleLogLine[] = [];
  for (const r of sim.rounds) {
    lines.push({
      round: r.round,
      attackerSide: r.attackerSide,
      attackerName: r.attackerName,
      defenderName: r.defenderName,
      finalDamage: r.finalDamage,
      attackerHp: r.attackerHp,
      defenderHp: r.defenderHp,
    });
    if (lines.length >= BATTLE_LOG_MAX_LINES) break;
  }
  return lines;
}

function parseBattleLog(json: Prisma.JsonValue): ArenaBattleLogLine[] {
  if (!Array.isArray(json)) return [];
  const out: ArenaBattleLogLine[] = [];
  for (const raw of json) {
    if (!raw || typeof raw !== 'object') continue;
    const r = raw as Record<string, unknown>;
    if (
      typeof r.round !== 'number' ||
      typeof r.attackerSide !== 'string' ||
      typeof r.finalDamage !== 'number' ||
      typeof r.attackerHp !== 'number' ||
      typeof r.defenderHp !== 'number'
    )
      continue;
    if (r.attackerSide !== 'attacker' && r.attackerSide !== 'defender') continue;
    out.push({
      round: r.round,
      attackerSide: r.attackerSide,
      attackerName: typeof r.attackerName === 'string' ? r.attackerName : '',
      defenderName: typeof r.defenderName === 'string' ? r.defenderName : '',
      finalDamage: r.finalDamage,
      attackerHp: r.attackerHp,
      defenderHp: r.defenderHp,
    });
  }
  return out;
}

function parseRatingDelta(json: Prisma.JsonValue): ArenaRatingDelta {
  if (!json || typeof json !== 'object' || Array.isArray(json)) {
    return { attacker: 0, defender: 0 };
  }
  const r = json as Record<string, unknown>;
  return {
    attacker: typeof r.attacker === 'number' ? r.attacker : 0,
    defender: typeof r.defender === 'number' ? r.defender : 0,
  };
}

function sumDamage(
  log: readonly ArenaBattleLogLine[],
  side: 'attacker' | 'defender',
): number {
  let total = 0;
  for (const line of log) if (line.attackerSide === side) total += line.finalDamage;
  return total;
}

/**
 * Build snapshot từ DB row character. Pure — KHÔNG đọc DB / không IO.
 *
 * Phase 14.1.B reference resolver dùng basic atk/def/hpMax/spirit/speed.
 * Không compose equipment hay buff trong PR này — defer 14.1.C khi wire
 * `EquipmentService.buildAttachedStatBundle` vào Arena snapshot.
 */
export function buildArenaActorSnapshot(c: CharacterRow): CombatActorSnapshot {
  const element: ElementKey | null = isElementKey(c.primaryElement)
    ? c.primaryElement
    : null;
  return buildCombatActorSnapshot({
    characterId: c.id,
    name: c.name,
    realmKey: c.realmKey,
    stage: c.realmStage,
    baseStats: {
      hp: c.hp,
      hpMax: c.hpMax,
      mp: c.mp,
      mpMax: c.mpMax,
      power: c.power,
      spirit: c.spirit,
      speed: c.speed,
    },
    derivedStats: {
      atk: Math.max(1, c.power),
      def: Math.max(0, Math.floor(c.spirit / 2)),
      hpMax: c.hpMax,
      spirit: c.spirit,
      speed: c.speed,
    },
    elementalAffinity: element,
    skillKeys: ['atk_thuong'],
  });
}

const ELEMENT_KEYS: ReadonlySet<string> = new Set([
  'kim',
  'moc',
  'thuy',
  'hoa',
  'tho',
]);

function isElementKey(value: string | null | undefined): value is ElementKey {
  return typeof value === 'string' && ELEMENT_KEYS.has(value);
}

/** Re-export composeSeed for tests that want stable seed across runs. */
export { composeSeed as arenaComposeSeed };
