/**
 * Phase 14.1.A — Combat Simulation Snapshot.
 *
 * Snapshot model + pure resolver cho combat replay-safe. Đặt nền cho
 * Arena PvP bất đồng bộ (Phase 14.1.B kế tiếp): server lưu attacker +
 * defender snapshot lúc match được tạo, sau đó cùng `seed` → cùng kết
 * quả mỗi lần resolve. Dùng để verify match, debug khiếu nại, replay UI.
 *
 * Nguyên tắc:
 *   - Snapshot CHỈ chứa dữ liệu cần thiết để replay combat (stats, skill
 *     keys, buff keys, element). KHÔNG nhét secret / userId / token /
 *     internal IDs ngoài combat scope.
 *   - {@link resolveCombatWithSnapshot} pure function — không IO, không
 *     read DB, không Math.random (mọi RNG đi qua seeded {@link createSeededRng}).
 *   - {@link normalizeCombatSnapshot} sort skill/buff keys để loại bỏ non-
 *     deterministic iteration order. Cùng input set → cùng normalized
 *     snapshot bất kể thứ tự gốc.
 *   - Resolver hiện tại là **text-mode reference simulation** (1v1 turn-
 *     based, basic attack). Phase 14.1.B sẽ wire skill catalog real cho
 *     Arena. Helper hiện tại đủ để verify determinism contract +
 *     unit-test reproducibility cho audit Phase 14.1.A.
 *
 * Không thay thế `combat.service.ts` runtime hiện có (DB-coupled). Chỉ
 * cung cấp resolver pure để Arena prep + replay verify.
 */

import type { ElementKey } from './combat';
import { elementMultiplier } from './spiritual-root';
import { createSeededRng, type SeededRng } from './combat-rng';

/* ---------------------------------------------------------------------------
 * Snapshot types
 * ------------------------------------------------------------------------- */

/**
 * Source của combat simulation. Server emit khi build snapshot — giúp
 * resolver / replay tooling tag log đúng context (vd Arena replay UI cần
 * filter `source='ARENA_PREP'` để loại noise dungeon/boss/tribulation).
 *
 *   - `DUNGEON`        — combat từ DungeonRun (Phase 4 + 12.3 onwards).
 *   - `BOSS`           — combat từ BossService.attack (Phase 4 onwards).
 *   - `TRIBULATION`    — mini-battle Thiên Kiếp (Phase 14.3.E.1+).
 *   - `ARENA_PREP`     — Phase 14.1.B Async Arena Foundation (forward-
 *     compat — chưa wire trong PR Phase 14.1.A; type sẵn cho PR sau).
 */
export type CombatSimulationContextSource =
  | 'DUNGEON'
  | 'BOSS'
  | 'TRIBULATION'
  | 'ARENA_PREP';

export const COMBAT_SIMULATION_CONTEXT_SOURCES: readonly CombatSimulationContextSource[] = [
  'DUNGEON',
  'BOSS',
  'TRIBULATION',
  'ARENA_PREP',
];

/**
 * Base stats actor — tu vi gốc, KHÔNG cộng equipment / buff. Resolver
 * dùng `derivedStats` (đã compose) cho damage formula; `baseStats` chỉ
 * lưu để debug + verify drift sau replay.
 */
export interface CombatActorBaseStats {
  hp: number;
  hpMax: number;
  mp: number;
  mpMax: number;
  power: number;
  spirit: number;
  speed: number;
}

/**
 * Equipment-derived bonus stats — snapshot tại lúc match created. Phase
 * 14.1.A KHÔNG re-resolve equipment runtime (deterministic guarantee —
 * server không re-read inventory DB lúc resolve).
 */
export interface CombatActorEquipmentStats {
  /** Additive ATK bonus từ equipment. */
  atkBonus: number;
  /** Additive DEF bonus từ equipment. */
  defBonus: number;
  /** Additive HP bonus từ equipment. */
  hpBonus: number;
  /** Additive spirit bonus từ equipment. */
  spiritBonus: number;
  /** Additive speed bonus từ equipment. */
  speedBonus: number;
  /**
   * Elemental ATK bonus theo skill element key (Phase 14.2.A). Additive
   * stack across all equipped items. Empty object = no bonus.
   */
  elementalAtkBonus: Readonly<Partial<Record<ElementKey, number>>>;
  /**
   * Elemental resist (incoming damage multiplier) theo skill element
   * key. Multiplier ≤ 1 = giảm damage chịu vào. Empty object = neutral.
   */
  elementalResist: Readonly<Partial<Record<ElementKey, number>>>;
}

/**
 * Composed final stats (base + equipment + buff) — resolver chỉ dùng
 * field này cho damage formula. Server compose sẵn lúc build snapshot
 * → resolver KHÔNG cần read mutable state.
 */
export interface CombatActorDerivedStats {
  /** Effective ATK (Phase 11 `power` semantics). */
  atk: number;
  /** Effective DEF (anti-damage). */
  def: number;
  /** Effective max HP (compose hp + hpBonus + buff). */
  hpMax: number;
  /** Effective spirit (boss reply, debuff resist). */
  spirit: number;
  /** Effective speed — turn-order tie-break sau seeded coin toss. */
  speed: number;
}

/**
 * Snapshot 1 actor (player / monster / boss) trong 1 combat simulation.
 *
 *   - `characterId`: nullable. Player → UUID; monster/boss/system →
 *     `null`.
 *   - `realmKey`: Phase 11 realm (vd `truc_co`, `kim_dan`).
 *   - `stage`: tiểu cảnh giới 1..n trong realm.
 *   - `baseStats`: tu vi base, không cộng equipment / buff.
 *   - `equipmentStats`: bonus equipment đã compose tại lúc snapshot.
 *   - `skillKeys`: skill keys character đang equip (sorted khi normalize).
 *   - `buffKeys`: active buff keys (sorted khi normalize).
 *   - `elementalAffinity`: linh căn / element (null = vô hệ).
 *   - `derivedStats`: final stats để damage formula dùng — server
 *     compose sẵn khi build snapshot.
 */
export interface CombatActorSnapshot {
  characterId: string | null;
  name: string;
  realmKey: string;
  stage: number;
  baseStats: CombatActorBaseStats;
  equipmentStats: CombatActorEquipmentStats;
  skillKeys: readonly string[];
  buffKeys: readonly string[];
  elementalAffinity: ElementKey | null;
  derivedStats: CombatActorDerivedStats;
}

export interface CombatSimulationContext {
  source: CombatSimulationContextSource;
  /** Region key — null = không gắn region cụ thể. */
  regionKey: string | null;
  /** Element context override (vd tribulation realm element). null = không có. */
  elementContext: ElementKey | null;
}

/**
 * 1 lần combat simulation. Cùng `(attacker, defender, seed, context)` →
 * cùng kết quả mỗi lần resolve (replay-safe).
 */
export interface CombatSimulationSnapshot {
  attacker: CombatActorSnapshot;
  defender: CombatActorSnapshot;
  /** Numeric seed. Có thể derive từ string qua {@link createSeededRng}. */
  seed: number;
  context: CombatSimulationContext;
}

/* ---------------------------------------------------------------------------
 * Result types
 * ------------------------------------------------------------------------- */

export type CombatWinner = 'attacker' | 'defender' | 'draw';

export interface CombatRoundLog {
  /** 1-indexed round number. */
  round: number;
  /** Side đang attack lượt này. */
  attackerSide: 'attacker' | 'defender';
  attackerName: string;
  defenderName: string;
  /** Skill key dùng — `null` = basic attack vô hệ. */
  skillKey: string | null;
  /** Element của skill cast lượt này — null = vô hệ. */
  skillElement: ElementKey | null;
  /** Base damage trước khi nhân element + resist. */
  baseDamage: number;
  /** Element multiplier (skillElement vs defender.elementalAffinity). */
  elementMultiplier: number;
  /** Equipment elemental bonus (1 + bonus). */
  equipBonusMultiplier: number;
  /** Defender elemental resist (≤ 1 = giảm damage). */
  resistMultiplier: number;
  /** Final damage applied lên defender lượt này. */
  finalDamage: number;
  /** HP attacker sau lượt. */
  attackerHp: number;
  /** HP defender sau lượt. */
  defenderHp: number;
}

export interface CombatDamageSummary {
  /** Tổng damage attacker gây cho defender qua toàn match. */
  totalAttackerDamage: number;
  /** Tổng damage defender phản kích. */
  totalDefenderDamage: number;
  /** Số round đã chạy. */
  rounds: number;
}

export interface CombatAppliedSkillSummary {
  /** Skill attacker dùng (lần đầu pick — Phase 14.1.A reference resolver
   * dùng 1 skill suốt match). */
  attackerSkillKey: string | null;
  attackerSkillElement: ElementKey | null;
  defenderSkillKey: string | null;
  defenderSkillElement: ElementKey | null;
}

export interface CombatElementMultiplierSummary {
  /** Multiplier khi attacker hit defender. */
  attackerVsDefender: number;
  /** Multiplier khi defender phản kích attacker. */
  defenderVsAttacker: number;
}

export interface CombatSimulationResult {
  winner: CombatWinner;
  rounds: readonly CombatRoundLog[];
  damageSummary: CombatDamageSummary;
  appliedSkillSummary: CombatAppliedSkillSummary;
  elementMultiplierSummary: CombatElementMultiplierSummary;
  /** Echo seed dùng để resolve — phục vụ replay verify. */
  seed: number;
  /** Echo context — replay tooling filter / debug. */
  context: CombatSimulationContext;
}

/* ---------------------------------------------------------------------------
 * Helpers — build / normalize
 * ------------------------------------------------------------------------- */

const ZERO_BASE_STATS: CombatActorBaseStats = {
  hp: 0,
  hpMax: 0,
  mp: 0,
  mpMax: 0,
  power: 0,
  spirit: 0,
  speed: 0,
};

const ZERO_EQUIPMENT_STATS: CombatActorEquipmentStats = {
  atkBonus: 0,
  defBonus: 0,
  hpBonus: 0,
  spiritBonus: 0,
  speedBonus: 0,
  elementalAtkBonus: {},
  elementalResist: {},
};

/**
 * Input cho {@link buildCombatActorSnapshot}. Tất cả field optional —
 * helper fill default cho phần thiếu (zero stats, empty arrays, neutral
 * element). Nếu không cung cấp `derivedStats`, helper auto-compose từ
 * `baseStats + equipmentStats` (atk = power + atkBonus, etc).
 */
export interface CombatActorSnapshotInput {
  characterId?: string | null;
  name?: string;
  realmKey?: string;
  stage?: number;
  baseStats?: Partial<CombatActorBaseStats>;
  equipmentStats?: Partial<CombatActorEquipmentStats>;
  skillKeys?: readonly string[];
  buffKeys?: readonly string[];
  elementalAffinity?: ElementKey | null;
  derivedStats?: Partial<CombatActorDerivedStats>;
}

/**
 * Build {@link CombatActorSnapshot} với safe default. Caller chỉ cần
 * cung cấp field thật sự khác default — helper tự fill phần còn lại.
 *
 * Convention:
 *   - Nếu `derivedStats` không cung cấp → auto-compose:
 *     `atk = baseStats.power + equipmentStats.atkBonus` (etc).
 *   - `skillKeys` / `buffKeys` được sort qua {@link normalizeCombatSnapshot}
 *     khi pass qua resolver — buildCombatActorSnapshot KHÔNG sort sẵn để
 *     test có thể verify normalization step độc lập.
 */
export function buildCombatActorSnapshot(
  input: CombatActorSnapshotInput = {},
): CombatActorSnapshot {
  const baseStats: CombatActorBaseStats = {
    ...ZERO_BASE_STATS,
    ...(input.baseStats ?? {}),
  };
  const equipmentStats: CombatActorEquipmentStats = {
    ...ZERO_EQUIPMENT_STATS,
    ...(input.equipmentStats ?? {}),
    elementalAtkBonus: { ...(input.equipmentStats?.elementalAtkBonus ?? {}) },
    elementalResist: { ...(input.equipmentStats?.elementalResist ?? {}) },
  };
  const derivedDefault: CombatActorDerivedStats = {
    atk: baseStats.power + equipmentStats.atkBonus,
    def: equipmentStats.defBonus,
    hpMax: baseStats.hpMax + equipmentStats.hpBonus,
    spirit: baseStats.spirit + equipmentStats.spiritBonus,
    speed: baseStats.speed + equipmentStats.speedBonus,
  };
  const derivedStats: CombatActorDerivedStats = {
    ...derivedDefault,
    ...(input.derivedStats ?? {}),
  };
  return {
    characterId: input.characterId ?? null,
    name: input.name ?? 'unnamed',
    realmKey: input.realmKey ?? 'pham_nhan',
    stage: input.stage ?? 1,
    baseStats,
    equipmentStats,
    skillKeys: input.skillKeys ? [...input.skillKeys] : [],
    buffKeys: input.buffKeys ? [...input.buffKeys] : [],
    elementalAffinity: input.elementalAffinity ?? null,
    derivedStats,
  };
}

function normalizeActor(actor: CombatActorSnapshot): CombatActorSnapshot {
  return {
    ...actor,
    skillKeys: [...actor.skillKeys].sort(),
    buffKeys: [...actor.buffKeys].sort(),
    equipmentStats: {
      ...actor.equipmentStats,
      elementalAtkBonus: { ...actor.equipmentStats.elementalAtkBonus },
      elementalResist: { ...actor.equipmentStats.elementalResist },
    },
    baseStats: { ...actor.baseStats },
    derivedStats: { ...actor.derivedStats },
  };
}

/**
 * Normalize snapshot để guarantee deterministic iteration:
 *   - `skillKeys` + `buffKeys` được sort lexicographically (loại non-
 *     deterministic Set/Object iteration order).
 *   - Numeric seed được cast `| 0` (32-bit signed) để consistent
 *     across runtime.
 *   - Stats objects được clone để snapshot KHÔNG share reference với
 *     caller (immutability guard).
 */
export function normalizeCombatSnapshot(
  snapshot: CombatSimulationSnapshot,
): CombatSimulationSnapshot {
  return {
    attacker: normalizeActor(snapshot.attacker),
    defender: normalizeActor(snapshot.defender),
    seed: snapshot.seed | 0,
    context: { ...snapshot.context },
  };
}

/* ---------------------------------------------------------------------------
 * Deterministic resolver
 * ------------------------------------------------------------------------- */

/**
 * Phase 14.1.A reference resolver.
 *
 * Đơn giản, deterministic, pure. Phase 14.1.B Arena sẽ wire skill catalog
 * thật + buff/element side-effect đầy đủ. PR Phase 14.1.A chỉ guarantee:
 *
 *   - Cùng snapshot + cùng seed → cùng result.
 *   - Element multiplier deterministic (qua `elementMultiplier`).
 *   - Equipment elemental atk bonus deterministic.
 *   - Resist deterministic.
 *
 * Algorithm (text-mode 1v1):
 *   - Mỗi round, side có speed cao hơn attack trước; tie-break bằng
 *     seeded coin toss (`rng.chance(0.5)`).
 *   - Damage = `max(1, round((atk × atkScale - def × 0.5) × variance ×
 *     elementMul × equipBonusMul × resistMul))`.
 *   - `variance ∈ [0.85, 1.15]` qua `0.85 + rng.next() × 0.3` (giống
 *     `rollDamage` ở `combat.ts`).
 *   - Skill chosen: lần đầu pick `attacker.skillKeys[0]` nếu có, else
 *     basic attack `null`. Phase 14.1.A reference resolver dùng cùng
 *     skill suốt match (no rotation).
 *   - Loop tới khi 1 side HP ≤ 0 hoặc đạt `maxRounds` (default 30) →
 *     `winner='draw'` nếu cap hit.
 */
export interface CombatSimulationOptions {
  /** Cap số round để tránh deadlock khi cả 2 side damage = 1. */
  maxRounds?: number;
}

export const COMBAT_SIMULATION_DEFAULT_MAX_ROUNDS = 30;
export const COMBAT_SIMULATION_BASE_ATK_SCALE = 1.0;
export const COMBAT_SIMULATION_VARIANCE_LOW = 0.85;
export const COMBAT_SIMULATION_VARIANCE_HIGH = 1.15;

interface ResolveSidePower {
  side: 'attacker' | 'defender';
  actor: CombatActorSnapshot;
  hp: number;
  skillKey: string | null;
  skillElement: ElementKey | null;
  /** Element multiplier khi side này hit đối thủ. */
  elementVsTarget: number;
  /** Equipment bonus multiplier khi side này hit (theo skill element). */
  equipBonusVsTarget: number;
  /** Resist của target khi side này hit. */
  targetResistVsSelf: number;
}

function resolveSkillElement(
  actor: CombatActorSnapshot,
): { skillKey: string | null; skillElement: ElementKey | null } {
  const first = actor.skillKeys[0] ?? null;
  return {
    skillKey: first,
    // Phase 14.1.A reference resolver KHÔNG resolve `SKILLS[key].element`
    // (giữ helper pure không phụ thuộc skill catalog runtime). Element
    // cast của side = `actor.elementalAffinity` (linh căn). Phase 14.1.B
    // sẽ wire skill catalog real cho Arena.
    skillElement: actor.elementalAffinity,
  };
}

function clamp01Plus(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

function buildSidePower(
  actor: CombatActorSnapshot,
  target: CombatActorSnapshot,
  side: 'attacker' | 'defender',
): ResolveSidePower {
  const { skillKey, skillElement } = resolveSkillElement(actor);
  const elementVsTarget = elementMultiplier(
    skillElement,
    target.elementalAffinity,
  );
  const equipBonusRaw =
    skillElement !== null
      ? actor.equipmentStats.elementalAtkBonus[skillElement] ?? 0
      : 0;
  const equipBonusVsTarget = 1 + clamp01Plus(equipBonusRaw, 0, 1);
  const resistRaw =
    skillElement !== null
      ? target.equipmentStats.elementalResist[skillElement] ?? 1
      : 1;
  const targetResistVsSelf = clamp01Plus(resistRaw, 0, 2);
  return {
    side,
    actor,
    hp: actor.derivedStats.hpMax,
    skillKey,
    skillElement,
    elementVsTarget,
    equipBonusVsTarget,
    targetResistVsSelf,
  };
}

function rollDamageInternal(
  atk: number,
  def: number,
  scale: number,
  rng: SeededRng,
): number {
  const base = atk * scale - def * 0.5;
  const variance =
    COMBAT_SIMULATION_VARIANCE_LOW +
    rng.next() *
      (COMBAT_SIMULATION_VARIANCE_HIGH - COMBAT_SIMULATION_VARIANCE_LOW);
  return Math.max(1, Math.round(base * variance));
}

/**
 * Resolve combat từ snapshot. Pure deterministic — cùng input → cùng
 * output. KHÔNG IO, KHÔNG read DB, KHÔNG `Math.random`.
 *
 * Snapshot được normalize trước khi resolve qua {@link
 * normalizeCombatSnapshot} — caller KHÔNG cần normalize trước.
 */
export function resolveCombatWithSnapshot(
  snapshot: CombatSimulationSnapshot,
  options: CombatSimulationOptions = {},
): CombatSimulationResult {
  const normalized = normalizeCombatSnapshot(snapshot);
  const maxRounds =
    options.maxRounds ?? COMBAT_SIMULATION_DEFAULT_MAX_ROUNDS;
  const rng = createSeededRng(normalized.seed);

  const attackerPower = buildSidePower(
    normalized.attacker,
    normalized.defender,
    'attacker',
  );
  const defenderPower = buildSidePower(
    normalized.defender,
    normalized.attacker,
    'defender',
  );

  // Turn-order: side có speed cao hơn đi trước. Tie-break = seeded
  // coin toss để cùng seed → cùng order. Lưu ý: rng.chance advance
  // state đúng 1 lần khi tie — input sequence reproducible.
  const speedDelta =
    attackerPower.actor.derivedStats.speed -
    defenderPower.actor.derivedStats.speed;
  const attackerGoesFirst =
    speedDelta > 0
      ? true
      : speedDelta < 0
        ? false
        : rng.chance(0.5);

  const rounds: CombatRoundLog[] = [];
  let attackerHp = attackerPower.actor.derivedStats.hpMax;
  let defenderHp = defenderPower.actor.derivedStats.hpMax;
  let totalAttackerDamage = 0;
  let totalDefenderDamage = 0;

  const order: ResolveSidePower[] = attackerGoesFirst
    ? [attackerPower, defenderPower]
    : [defenderPower, attackerPower];

  let roundIdx = 0;
  while (roundIdx < maxRounds && attackerHp > 0 && defenderHp > 0) {
    for (const side of order) {
      if (attackerHp <= 0 || defenderHp <= 0) break;
      roundIdx += 1;
      if (roundIdx > maxRounds) break;
      const isAttackerSide = side.side === 'attacker';
      const selfAtk = side.actor.derivedStats.atk;
      const targetDef = isAttackerSide
        ? defenderPower.actor.derivedStats.def
        : attackerPower.actor.derivedStats.def;
      const baseDmg = rollDamageInternal(
        selfAtk,
        targetDef,
        COMBAT_SIMULATION_BASE_ATK_SCALE,
        rng,
      );
      const finalDmg = Math.max(
        1,
        Math.round(
          baseDmg *
            side.elementVsTarget *
            side.equipBonusVsTarget *
            side.targetResistVsSelf,
        ),
      );
      if (isAttackerSide) {
        defenderHp = Math.max(0, defenderHp - finalDmg);
        totalAttackerDamage += finalDmg;
      } else {
        attackerHp = Math.max(0, attackerHp - finalDmg);
        totalDefenderDamage += finalDmg;
      }
      rounds.push({
        round: roundIdx,
        attackerSide: side.side,
        attackerName: side.actor.name,
        defenderName: isAttackerSide
          ? defenderPower.actor.name
          : attackerPower.actor.name,
        skillKey: side.skillKey,
        skillElement: side.skillElement,
        baseDamage: baseDmg,
        elementMultiplier: side.elementVsTarget,
        equipBonusMultiplier: side.equipBonusVsTarget,
        resistMultiplier: side.targetResistVsSelf,
        finalDamage: finalDmg,
        attackerHp,
        defenderHp,
      });
    }
  }

  let winner: CombatWinner;
  if (defenderHp <= 0 && attackerHp > 0) winner = 'attacker';
  else if (attackerHp <= 0 && defenderHp > 0) winner = 'defender';
  else if (defenderHp <= 0 && attackerHp <= 0) winner = 'draw';
  else winner = 'draw';

  return {
    winner,
    rounds,
    damageSummary: {
      totalAttackerDamage,
      totalDefenderDamage,
      rounds: rounds.length,
    },
    appliedSkillSummary: {
      attackerSkillKey: attackerPower.skillKey,
      attackerSkillElement: attackerPower.skillElement,
      defenderSkillKey: defenderPower.skillKey,
      defenderSkillElement: defenderPower.skillElement,
    },
    elementMultiplierSummary: {
      attackerVsDefender: attackerPower.elementVsTarget,
      defenderVsAttacker: defenderPower.elementVsTarget,
    },
    seed: normalized.seed,
    context: { ...normalized.context },
  };
}
