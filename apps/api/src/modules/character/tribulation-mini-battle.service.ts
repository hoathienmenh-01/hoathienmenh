/**
 * Phase 14.3.E.1 — Tribulation Mini-Battle Service.
 *
 * Backend runtime cho turn-based mini-battle Thiên Kiếp. Layer mới trên top
 * encounter system (Phase 14.3.D); KHÔNG thay thế flow legacy
 * `attemptTribulation` / `resolveEncounter` — khi feature flag
 * `TRIBULATION_MINI_BATTLE_ENABLED=false` (default), flow cũ hoạt động
 * nguyên vẹn.
 *
 * Service chia làm 4 method tương ứng 4 endpoint REST:
 *   - `getCurrent(characterId)`     → GET /character/tribulation/battle/current
 *   - `start(characterId, opts)`    → POST /character/tribulation/battle/start
 *   - `action(characterId, ...)`    → POST /character/tribulation/battle/action
 *   - `resolve(characterId, ...)`   → POST /character/tribulation/battle/resolve
 *
 * State machine PENDING → ACTIVE → (RESOLVED | FAILED). Idempotent guard:
 *   - 2nd `start` cùng character with existing PENDING/ACTIVE → reject
 *     `MINI_BATTLE_ALREADY_ACTIVE`.
 *   - Action với cùng `clientNonce` đã thấy → no-op return current state.
 *   - 2nd `resolve` → reconstruct outcome từ persisted result (no double
 *     reward / no double consume support items).
 *
 * Race safety: mọi mutation đi qua `prisma.$transaction`. Optimistic
 * concurrency thông qua `where: { state: <expected> }` clause khi update.
 */
import {
  forwardRef,
  Inject,
  Injectable,
  Logger,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  applyTribulationEffectType,
  computeTribulationPhaseResult,
  ELEMENTS,
  expCostForStage,
  getTribulationForBreakthrough,
  makeInitialMiniBattleSnapshot,
  nextRealm,
  resolveTribulationEncounterDef,
  summarizeTribulationBattleResult,
  TRIBULATION_BATTLE_ACTIONS,
  validateTribulationBattleAction,
  type ElementKey,
  type TribulationBattleAction,
  type TribulationBattleEvent,
  type TribulationMiniBattleEffectType,
  type TribulationMiniBattleSnapshot,
  type TribulationMiniBattleState,
  type TribulationMiniBattleSummary,
} from '@xuantoi/shared';
import { PrismaService } from '../../common/prisma.service';
import {
  TribulationAttemptOutcome,
  TribulationError,
  TribulationService,
} from './tribulation.service';

/** Feature flag env var name. */
export const TRIBULATION_MINI_BATTLE_FLAG_ENV = 'TRIBULATION_MINI_BATTLE_ENABLED';

/**
 * Parse boolean env var (mirror `parseBool` in observability/sentry.ts).
 */
function parseFlag(v: string | undefined, defaultVal = false): boolean {
  if (v === undefined) return defaultVal;
  const s = v.trim().toLowerCase();
  if (['true', '1', 'yes', 'on'].includes(s)) return true;
  if (['false', '0', 'no', 'off', ''].includes(s)) return false;
  return defaultVal;
}

/**
 * Phase 14.3.E.1 — error codes specific to mini-battle. Re-uses upstream
 * {@link TribulationError} for shared errors (CHARACTER_NOT_FOUND etc.) +
 * adds 4 new codes.
 */
export type TribulationMiniBattleErrorCode =
  | 'MINI_BATTLE_DISABLED'
  | 'MINI_BATTLE_ALREADY_ACTIVE'
  | 'MINI_BATTLE_NOT_FOUND'
  | 'MINI_BATTLE_INVALID_ACTION'
  | 'MINI_BATTLE_NOT_TERMINAL'
  | 'MINI_BATTLE_TERMINAL';

export class TribulationMiniBattleError extends Error {
  constructor(public code: TribulationMiniBattleErrorCode | TribulationError['code']) {
    super(code);
  }
}

/**
 * View-friendly snapshot persisted in the DB. BigInt-free, Date cast → ISO.
 */
export interface TribulationMiniBattleView {
  id: string;
  characterId: string;
  encounterId: string | null;
  tribulationKey: string;
  realmKey: string;
  effectType: TribulationMiniBattleEffectType;
  element: ElementKey;
  difficulty: 'minor' | 'major' | 'heavenly' | 'saint';
  state: TribulationMiniBattleState;
  currentPhase: number;
  phaseCount: number;
  playerHp: number;
  playerHpMax: number;
  tribulationHp: number;
  tribulationHpMax: number;
  shield: number;
  dotStacks: number;
  focusCharge: number;
  seed: number;
  actionLog: readonly TribulationBattleEvent[];
  result: TribulationMiniBattleSummary | null;
  startedAt: string;
  resolvedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

interface TribulationMiniBattleRow {
  id: string;
  characterId: string;
  encounterId: string | null;
  tribulationKey: string;
  realmKey: string;
  effectType: string;
  element: string;
  difficulty: string;
  state: string;
  currentPhase: number;
  phaseCount: number;
  playerHp: number;
  playerHpMax: number;
  tribulationHp: number;
  tribulationHpMax: number;
  shield: number;
  dotStacks: number;
  focusCharge: number;
  seed: number;
  actionLogJson: unknown;
  resultJson: unknown;
  lastClientNonce: string | null;
  startedAt: Date;
  resolvedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Singleton metrics counter cho mini-battle (mirror pattern
 * `request-metrics.middleware.ts` Phase 17.5). KHÔNG inject service —
 * counter tăng từ trong tx-side function. Read-only snapshot for admin
 * `/admin/metrics` (future wiring).
 */
interface MiniBattleMetricsState {
  started: number;
  resolved: number;
  failed: number;
}

let MINI_BATTLE_METRICS: MiniBattleMetricsState = {
  started: 0,
  resolved: 0,
  failed: 0,
};

export function readTribulationMiniBattleMetrics(): MiniBattleMetricsState {
  return { ...MINI_BATTLE_METRICS };
}

export function resetTribulationMiniBattleMetrics(): void {
  MINI_BATTLE_METRICS = { started: 0, resolved: 0, failed: 0 };
}

@Injectable()
export class TribulationMiniBattleService {
  private readonly logger = new Logger(TribulationMiniBattleService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(forwardRef(() => TribulationService))
    private readonly tribulation: TribulationService,
  ) {}

  /** Feature flag check — read fresh each call để test override env. */
  static isEnabled(): boolean {
    return parseFlag(process.env[TRIBULATION_MINI_BATTLE_FLAG_ENV], false);
  }
  isEnabled(): boolean {
    return TribulationMiniBattleService.isEnabled();
  }

  /* -------------------------------------------------------------------------
   * GET /character/tribulation/battle/current
   * ------------------------------------------------------------------------- */

  async getCurrent(
    characterId: string,
  ): Promise<TribulationMiniBattleView | null> {
    if (!this.isEnabled()) {
      return null;
    }
    // Prefer ACTIVE/PENDING; fall back to most-recent terminal NOT yet
    // reaped (resolvedAt set but resultJson empty would be bug).
    const row = await this.prisma.tribulationMiniBattle.findFirst({
      where: {
        characterId,
        state: { in: ['PENDING', 'ACTIVE'] },
      },
      orderBy: { startedAt: 'desc' },
    });
    if (!row) return null;
    return this.toView(row as TribulationMiniBattleRow);
  }

  /* -------------------------------------------------------------------------
   * POST /character/tribulation/battle/start
   * ------------------------------------------------------------------------- */

  async start(
    characterId: string,
    options: { selectedSupportItemKeys?: readonly string[] } = {},
    now: Date = new Date(),
  ): Promise<TribulationMiniBattleView> {
    if (!this.isEnabled()) {
      throw new TribulationMiniBattleError('MINI_BATTLE_DISABLED');
    }

    const created = await this.prisma.$transaction(async (tx) => {
      const character = await tx.character.findUnique({
        where: { id: characterId },
      });
      if (!character) {
        throw new TribulationMiniBattleError('CHARACTER_NOT_FOUND');
      }

      // Realm gate (mirror tribulation.service guard).
      if (character.realmStage < 9) {
        throw new TribulationMiniBattleError('NOT_AT_PEAK');
      }
      const cost = expCostForStage(character.realmKey, 9);
      if (cost === null || character.exp < cost) {
        throw new TribulationMiniBattleError('NOT_AT_PEAK');
      }

      const next = nextRealm(character.realmKey);
      if (!next) throw new TribulationMiniBattleError('NO_NEXT_REALM');
      const def = getTribulationForBreakthrough(character.realmKey, next.key);
      if (!def) {
        throw new TribulationMiniBattleError('NO_TRIBULATION_FOR_TRANSITION');
      }

      // Cooldown gate.
      if (
        character.tribulationCooldownAt &&
        character.tribulationCooldownAt > now
      ) {
        throw new TribulationMiniBattleError('COOLDOWN_ACTIVE');
      }

      // Reject if a non-terminal mini-battle exists.
      const existing = await tx.tribulationMiniBattle.findFirst({
        where: {
          characterId,
          state: { in: ['PENDING', 'ACTIVE'] },
        },
        orderBy: { startedAt: 'desc' },
      });
      if (existing) {
        throw new TribulationMiniBattleError('MINI_BATTLE_ALREADY_ACTIVE');
      }

      // Reuse encounter row if pending; else create one (selection snapshot
      // matches Phase 14.3.D).
      const selectedKeys = options.selectedSupportItemKeys ?? [];
      let encounter = await tx.tribulationEncounter.findFirst({
        where: { characterId, state: 'pending' },
        orderBy: { startedAt: 'desc' },
      });
      const encounterDef = resolveTribulationEncounterDef(def);
      if (!encounter) {
        // Best-effort inventory pre-check (resolve will recheck atomically).
        for (const key of selectedKeys) {
          const owned = await tx.inventoryItem.findFirst({
            where: {
              characterId,
              itemKey: key,
              equippedSlot: null,
              qty: { gt: 0 },
            },
            select: { id: true },
          });
          if (!owned) {
            throw new TribulationMiniBattleError('SUPPORT_ITEM_MISSING');
          }
        }
        encounter = await tx.tribulationEncounter.create({
          data: {
            characterId,
            tribulationKey: def.key,
            fromRealmKey: def.fromRealmKey,
            toRealmKey: def.toRealmKey,
            encounterKey: encounterDef.key,
            effectType: encounterDef.effectType,
            element: encounterDef.element,
            difficulty: def.severity,
            selectedSupportItemKeys: [...selectedKeys],
            state: 'pending',
            startedAt: now,
          },
        });
      } else if (encounter.tribulationKey !== def.key) {
        throw new TribulationMiniBattleError('ENCOUNTER_ALREADY_PENDING');
      }

      // Compose initial mini-battle snapshot.
      const element: ElementKey = (ELEMENTS as readonly string[]).includes(
        encounter.element,
      )
        ? (encounter.element as ElementKey)
        : encounterDef.element;
      const seed = deriveSeed(encounter.id, characterId, now);
      const snapshot = makeInitialMiniBattleSnapshot({
        effectType: encounter.effectType as TribulationMiniBattleEffectType,
        element,
        difficulty: def.severity,
        playerHpMax: character.hpMax,
        seed,
      });

      const row = await tx.tribulationMiniBattle.create({
        data: {
          characterId,
          encounterId: encounter.id,
          tribulationKey: def.key,
          realmKey: character.realmKey,
          effectType: encounter.effectType,
          element: encounter.element,
          difficulty: def.severity,
          state: 'PENDING',
          currentPhase: snapshot.currentPhase,
          phaseCount: snapshot.phaseCount,
          playerHp: snapshot.playerHp,
          playerHpMax: snapshot.playerHpMax,
          tribulationHp: snapshot.tribulationHp,
          tribulationHpMax: snapshot.tribulationHpMax,
          shield: snapshot.shield,
          dotStacks: snapshot.dotStacks,
          focusCharge: snapshot.focusCharge,
          seed: snapshot.seed,
          actionLogJson: snapshot.actionLog as unknown as Prisma.InputJsonValue,
          resultJson: Prisma.JsonNull,
          lastClientNonce: null,
          startedAt: now,
        },
      });

      MINI_BATTLE_METRICS.started += 1;
      this.logger.log(
        `tribulation_battle_started battleId=${row.id} characterId=${characterId} realmKey=${character.realmKey} effectType=${encounter.effectType}`,
      );
      return row;
    });

    return this.toView(created as TribulationMiniBattleRow);
  }

  /* -------------------------------------------------------------------------
   * POST /character/tribulation/battle/action
   * ------------------------------------------------------------------------- */

  async action(
    characterId: string,
    battleId: string,
    actionRaw: unknown,
    clientNonce: string | null = null,
    now: Date = new Date(),
  ): Promise<TribulationMiniBattleView> {
    if (!this.isEnabled()) {
      throw new TribulationMiniBattleError('MINI_BATTLE_DISABLED');
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const row = await tx.tribulationMiniBattle.findUnique({
        where: { id: battleId },
      });
      if (!row || row.characterId !== characterId) {
        throw new TribulationMiniBattleError('MINI_BATTLE_NOT_FOUND');
      }
      // Idempotent: same clientNonce → return current state without
      // mutating.
      if (
        clientNonce &&
        row.lastClientNonce &&
        row.lastClientNonce === clientNonce
      ) {
        return row;
      }
      if (row.state === 'RESOLVED' || row.state === 'FAILED' || row.state === 'EXPIRED') {
        throw new TribulationMiniBattleError('MINI_BATTLE_TERMINAL');
      }

      const snapshotIn = this.rowToSnapshot(row as TribulationMiniBattleRow);
      const validation = validateTribulationBattleAction(snapshotIn, actionRaw);
      if (!validation.ok) {
        throw new TribulationMiniBattleError('MINI_BATTLE_INVALID_ACTION');
      }
      const action = actionRaw as TribulationBattleAction;
      // Defensive: ensure action ∈ enum (validate already covered, but
      // narrow type for downstream pure helper).
      if (!(TRIBULATION_BATTLE_ACTIONS as readonly string[]).includes(action)) {
        throw new TribulationMiniBattleError('MINI_BATTLE_INVALID_ACTION');
      }

      const { snapshot: nextSnapshot } = computeTribulationPhaseResult(
        snapshotIn,
        action,
      );

      // Optimistic update — race-safety: state must still match what we
      // read. If concurrent action raced ahead, this update count = 0 and
      // we throw.
      const update = await tx.tribulationMiniBattle.updateMany({
        where: {
          id: row.id,
          state: row.state,
          currentPhase: row.currentPhase,
        },
        data: {
          state: nextSnapshot.state,
          currentPhase: nextSnapshot.currentPhase,
          playerHp: nextSnapshot.playerHp,
          playerHpMax: nextSnapshot.playerHpMax,
          tribulationHp: nextSnapshot.tribulationHp,
          tribulationHpMax: nextSnapshot.tribulationHpMax,
          shield: nextSnapshot.shield,
          dotStacks: nextSnapshot.dotStacks,
          focusCharge: nextSnapshot.focusCharge,
          actionLogJson: nextSnapshot.actionLog as unknown as Prisma.InputJsonValue,
          resultJson:
            nextSnapshot.state === 'RESOLVED' || nextSnapshot.state === 'FAILED'
              ? (summarizeTribulationBattleResult(
                  nextSnapshot,
                ) as unknown as Prisma.InputJsonValue)
              : Prisma.JsonNull,
          resolvedAt:
            nextSnapshot.state === 'RESOLVED' || nextSnapshot.state === 'FAILED'
              ? now
              : null,
          lastClientNonce: clientNonce ?? row.lastClientNonce ?? null,
        },
      });
      if (update.count === 0) {
        // Concurrent action; refetch fresh row state to indicate to the
        // caller they should retry.
        throw new TribulationMiniBattleError('MINI_BATTLE_INVALID_ACTION');
      }

      const fresh = await tx.tribulationMiniBattle.findUnique({
        where: { id: battleId },
      });
      if (!fresh) {
        throw new TribulationMiniBattleError('MINI_BATTLE_NOT_FOUND');
      }
      return fresh;
    });

    return this.toView(updated as TribulationMiniBattleRow);
  }

  /* -------------------------------------------------------------------------
   * POST /character/tribulation/battle/resolve
   * ------------------------------------------------------------------------- */

  async resolve(
    characterId: string,
    battleId: string,
    rng: () => number = Math.random,
    now: Date = new Date(),
  ): Promise<TribulationAttemptOutcome> {
    if (!this.isEnabled()) {
      throw new TribulationMiniBattleError('MINI_BATTLE_DISABLED');
    }

    const outcome = await this.prisma.$transaction(async (tx) => {
      const row = await tx.tribulationMiniBattle.findUnique({
        where: { id: battleId },
      });
      if (!row || row.characterId !== characterId) {
        throw new TribulationMiniBattleError('MINI_BATTLE_NOT_FOUND');
      }
      if (row.state !== 'RESOLVED' && row.state !== 'FAILED') {
        throw new TribulationMiniBattleError('MINI_BATTLE_NOT_TERMINAL');
      }

      // Idempotent: result already applied (resultJson has attemptLogId).
      const existingResult = (row.resultJson ?? null) as
        | (TribulationMiniBattleSummary & { attemptLogId?: string })
        | null;
      if (existingResult && existingResult.attemptLogId) {
        const log = await tx.tribulationAttemptLog.findUnique({
          where: { id: existingResult.attemptLogId },
        });
        if (log) {
          return reconstructOutcomeFromAttemptLog(log, row.tribulationKey);
        }
      }

      // Get encounter for selectedSupportItemKeys.
      let selectedKeys: readonly string[] = [];
      if (row.encounterId) {
        const encounter = await tx.tribulationEncounter.findUnique({
          where: { id: row.encounterId },
        });
        if (encounter) {
          // Idempotent: if encounter already resolved (prior resolve race),
          // attempt log might already exist. Check pointer before forcing.
          if (encounter.state === 'resolved' && encounter.resolvedAttemptLogId) {
            const log = await tx.tribulationAttemptLog.findUnique({
              where: { id: encounter.resolvedAttemptLogId },
            });
            if (log) {
              // Persist pointer on battle row for next idempotent call.
              const summary: TribulationMiniBattleSummary & {
                attemptLogId: string;
              } = {
                ...summaryFromRow(row as TribulationMiniBattleRow),
                attemptLogId: log.id,
              };
              await tx.tribulationMiniBattle.update({
                where: { id: row.id },
                data: {
                  resultJson: summary as unknown as Prisma.InputJsonValue,
                },
              });
              return reconstructOutcomeFromAttemptLog(log, row.tribulationKey);
            }
          }
          selectedKeys = encounter.selectedSupportItemKeys;
        }
      }

      const success = row.state === 'RESOLVED';
      const finalHp = row.playerHp;
      const result =
        await this.tribulation.runAttemptInTxWithForcedOutcome(
          tx,
          characterId,
          selectedKeys,
          { success, finalHp },
          rng,
          now,
        );

      // Mark encounter resolved with pointer, mirroring Phase 14.3.D.
      if (row.encounterId) {
        await tx.tribulationEncounter.update({
          where: { id: row.encounterId },
          data: {
            state: 'resolved',
            resolvedAt: now,
            resolvedAttemptLogId: result.logId,
          },
        });
      }

      // Persist attemptLogId pointer on battle row for idempotent re-call.
      const summary: TribulationMiniBattleSummary & { attemptLogId: string } = {
        ...summaryFromRow(row as TribulationMiniBattleRow),
        attemptLogId: result.logId,
      };
      await tx.tribulationMiniBattle.update({
        where: { id: row.id },
        data: {
          resultJson: summary as unknown as Prisma.InputJsonValue,
          resolvedAt: row.resolvedAt ?? now,
        },
      });

      if (success) MINI_BATTLE_METRICS.resolved += 1;
      else MINI_BATTLE_METRICS.failed += 1;
      this.logger.log(
        `tribulation_battle_resolved battleId=${row.id} characterId=${characterId} realmKey=${row.realmKey} result=${success ? 'win' : 'lose'} attemptLogId=${result.logId}`,
      );

      return result;
    });

    return outcome;
  }

  /* -------------------------------------------------------------------------
   * View / snapshot helpers
   * ------------------------------------------------------------------------- */

  private toView(row: TribulationMiniBattleRow): TribulationMiniBattleView {
    return {
      id: row.id,
      characterId: row.characterId,
      encounterId: row.encounterId,
      tribulationKey: row.tribulationKey,
      realmKey: row.realmKey,
      effectType: row.effectType as TribulationMiniBattleEffectType,
      element: row.element as ElementKey,
      difficulty: row.difficulty as 'minor' | 'major' | 'heavenly' | 'saint',
      state: row.state as TribulationMiniBattleState,
      currentPhase: row.currentPhase,
      phaseCount: row.phaseCount,
      playerHp: row.playerHp,
      playerHpMax: row.playerHpMax,
      tribulationHp: row.tribulationHp,
      tribulationHpMax: row.tribulationHpMax,
      shield: row.shield,
      dotStacks: row.dotStacks,
      focusCharge: row.focusCharge,
      seed: row.seed,
      actionLog: parseActionLog(row.actionLogJson),
      result: parseResultJson(row.resultJson),
      startedAt: row.startedAt.toISOString(),
      resolvedAt: row.resolvedAt ? row.resolvedAt.toISOString() : null,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  private rowToSnapshot(
    row: TribulationMiniBattleRow,
  ): TribulationMiniBattleSnapshot {
    return {
      state: row.state as TribulationMiniBattleState,
      effectType: row.effectType as TribulationMiniBattleEffectType,
      element: row.element as ElementKey,
      difficulty: row.difficulty as 'minor' | 'major' | 'heavenly' | 'saint',
      currentPhase: row.currentPhase,
      phaseCount: row.phaseCount,
      playerHp: row.playerHp,
      playerHpMax: row.playerHpMax,
      tribulationHp: row.tribulationHp,
      tribulationHpMax: row.tribulationHpMax,
      shield: row.shield,
      dotStacks: row.dotStacks,
      focusCharge: row.focusCharge,
      seed: row.seed,
      actionLog: parseActionLog(row.actionLogJson),
      result:
        row.state === 'RESOLVED'
          ? 'win'
          : row.state === 'FAILED'
            ? 'lose'
            : null,
    };
  }
}

/* ---------------------------------------------------------------------------
 * Module-private helpers (pure)
 * ------------------------------------------------------------------------- */

function summaryFromRow(
  row: TribulationMiniBattleRow,
): TribulationMiniBattleSummary {
  const log = parseActionLog(row.actionLogJson);
  let totalDamageTaken = 0;
  let totalHeal = 0;
  let totalShieldGained = 0;
  for (const e of log) {
    if (e.damage > 0) totalDamageTaken += e.damage;
    if (e.heal > 0) totalHeal += e.heal;
    if (e.shield > 0) totalShieldGained += e.shield;
  }
  const totalDamageDealt = Math.max(
    0,
    row.tribulationHpMax - row.tribulationHp,
  );
  const result: 'win' | 'lose' | null =
    row.state === 'RESOLVED' ? 'win' : row.state === 'FAILED' ? 'lose' : null;
  return {
    state: row.state as TribulationMiniBattleState,
    result,
    phasesPlayed: log.length,
    totalDamageTaken,
    totalDamageDealt,
    totalHeal,
    totalShieldGained,
    finalPlayerHp: row.playerHp,
    finalTribulationHp: row.tribulationHp,
    effectType: row.effectType as TribulationMiniBattleEffectType,
  };
}

function parseActionLog(raw: unknown): readonly TribulationBattleEvent[] {
  if (!Array.isArray(raw)) return [];
  // Best-effort cast — Prisma JSONB returns generic JSON. We trust shape
  // since we wrote it ourselves; runtime validation skipped for perf.
  return raw as TribulationBattleEvent[];
}

function parseResultJson(
  raw: unknown,
): TribulationMiniBattleSummary | null {
  if (!raw || typeof raw !== 'object') return null;
  return raw as TribulationMiniBattleSummary;
}

/**
 * Deterministic seed derived from encounter id + character id + start time
 * (millis). Stable for replay: same row → same seed; new battle → new seed.
 */
function deriveSeed(encounterId: string, characterId: string, now: Date): number {
  const h = (s: string): number => {
    let hash = 5381;
    for (let i = 0; i < s.length; i += 1) {
      hash = ((hash << 5) + hash + s.charCodeAt(i)) | 0;
    }
    return hash;
  };
  const seed =
    (h(encounterId) ^ h(characterId) ^ ((now.getTime() & 0xffffffff) | 0)) | 0;
  return Math.abs(seed) | 0 || 1;
}

/**
 * Reconstruct outcome shape from existing `TribulationAttemptLog` row.
 * Used khi resolve idempotent re-call hoặc encounter đã resolve trước đó.
 * Matches `TribulationService.reconstructOutcomeFromLog` shape.
 */
function reconstructOutcomeFromAttemptLog(
  log: {
    id: string;
    success: boolean;
    tribulationKey: string;
    fromRealmKey: string;
    toRealmKey: string;
    severity: string;
    type: string;
    wavesCompleted: number;
    totalDamage: number;
    finalHp: number;
    expBefore: bigint;
    expAfter: bigint;
    expLoss: bigint;
    cooldownAt: Date | null;
    taoMaActive: boolean;
    taoMaExpiresAt: Date | null;
    linhThachReward: number;
    expBonusReward: bigint;
    titleKeyReward: string | null;
    attemptIndex: number;
  },
  expectedTribulationKey: string,
): TribulationAttemptOutcome {
  // Defensive narrowing — silently ignore if mismatch (caller guards
  // through encounter pointer).
  void expectedTribulationKey;
  return {
    success: log.success,
    tribulationKey: log.tribulationKey,
    fromRealmKey: log.fromRealmKey,
    toRealmKey: log.toRealmKey,
    severity: log.severity as 'minor' | 'major' | 'heavenly' | 'saint',
    type: log.type as 'lei' | 'phong' | 'bang' | 'hoa' | 'tam',
    wavesCompleted: log.wavesCompleted,
    totalDamage: log.totalDamage,
    finalHp: log.finalHp,
    attemptIndex: log.attemptIndex,
    reward: log.success
      ? {
          linhThach: log.linhThachReward,
          expBonus: log.expBonusReward,
          titleKey: log.titleKeyReward,
        }
      : null,
    penalty:
      !log.success && log.cooldownAt
        ? {
            expBefore: log.expBefore,
            expAfter: log.expAfter,
            expLoss: log.expLoss,
            cooldownAt: log.cooldownAt,
            taoMaActive: log.taoMaActive,
            taoMaExpiresAt: log.taoMaExpiresAt,
          }
        : null,
    logId: log.id,
    consumedSupportItemKeys: [],
    supportTotalBonus: 0,
    successChance: {
      base: 0,
      supportBonus: 0,
      elementAdjustment: 0,
      raw: 0,
      final: 0,
      floorHit: false,
      ceilHit: false,
    },
  };
}

/* ---------------------------------------------------------------------------
 * Re-export for tests / metrics integration
 * ------------------------------------------------------------------------- */
export { applyTribulationEffectType, computeTribulationPhaseResult };
