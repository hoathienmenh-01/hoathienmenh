/**
 * Phase 14.1.A — Combat Determinism RNG helper.
 *
 * Seeded RNG cho combat critical path. Phase 14.1.A đặt nền cho Arena PvP
 * bất đồng bộ: cùng `(attackerSnapshot, defenderSnapshot, seed)` → cùng kết
 * quả. Không phụ thuộc runtime/browser, không dùng `Math.random` ở core.
 *
 * Algorithm: mulberry32 — cùng họ với `tribulation-mini-battle.ts` (Phase
 * 14.3.E.1). Module này KHÔNG re-export `mulberry32` từ tribulation file để
 * tránh vòng phụ thuộc combat ↔ tribulation; cùng thuật toán → cùng output
 * cho cùng seed (verified bằng test cross-module).
 *
 * Stable cross-run:
 *   - Cùng numeric seed → cùng sequence float trong [0, 1).
 *   - Cùng string seed (qua {@link hashSeed}) → cùng numeric seed → cùng
 *     sequence.
 *   - Không phụ thuộc `Date.now`, `Math.random`, hay locale.
 *
 * Public API:
 *   - {@link createSeededRng}(seed) → {@link SeededRng}.
 *   - {@link hashSeed}(string) → numeric seed (FNV-1a 32-bit).
 *   - {@link composeSeed}(seed, salt) → numeric seed (mix base + salt).
 *
 * Drop-in `Math.random`: `createSeededRng(seed).next` có signature `() =>
 * number` trùng với `Math.random` — có thể inject vào `rollDamage`,
 * `rollDungeonLoot`, `rollMonsterLoot`, `pickRandom` (xem combat.ts /
 * items.ts / boss.service.ts) cho deterministic combat.
 */

const MULBERRY32_INCREMENT = 0x6d2b79f5;
const FNV_OFFSET_BASIS = 2166136261;
const FNV_PRIME = 16777619;
const COMPOSE_PHI = 0x9e3779b1; // golden-ratio mix constant.

/**
 * Seeded RNG handle returned bởi {@link createSeededRng}. Mỗi method dùng
 * chung internal mulberry32 state — gọi nhiều method khác nhau vẫn deterministic
 * theo thứ tự gọi.
 */
export interface SeededRng {
  /**
   * Drop-in `Math.random` replacement. Float trong `[0, 1)`. Mỗi lần gọi
   * advance state. Safe để pass làm callback `() => number` cho legacy
   * helper (ví dụ `rollDamage(atk, def, scale, rng.next)`).
   */
  next(): number;
  /** Alias cho {@link next} — semantic rõ hơn khi đọc code. */
  nextFloat(): number;
  /**
   * Integer trong `[min, max]` inclusive. `min/max` được swap nếu
   * `min > max`, và truncated về integer (`| 0`). Throw nếu non-finite.
   */
  nextInt(min: number, max: number): number;
  /**
   * Bernoulli sample. `probability ≤ 0` → false (no roll, no state advance).
   * `probability ≥ 1` → true (no roll, no state advance). Else 1 roll.
   * Non-finite → false.
   */
  chance(probability: number): boolean;
  /**
   * Pick 1 phần tử ngẫu nhiên từ array. Returns `null` nếu array rỗng.
   * Pure: cùng seed + cùng array → cùng pick (advance state 1 roll).
   */
  pick<T>(items: readonly T[]): T | null;
}

/**
 * Tạo seeded RNG handle từ numeric hoặc string seed.
 *
 * - Numeric seed: cast `| 0` (32-bit signed). NaN/non-finite → 0.
 * - String seed: hash qua {@link hashSeed} (FNV-1a 32-bit) → numeric seed.
 *
 * @example
 * const rng = createSeededRng(123);
 * const dmg = rollDamage(20, 5, 1, rng.next); // deterministic damage
 */
export function createSeededRng(seed: number | string): SeededRng {
  const numericSeed =
    typeof seed === 'number'
      ? Number.isFinite(seed)
        ? seed | 0
        : 0
      : hashSeed(seed);
  let state = numericSeed | 0;
  const next = (): number => {
    state = (state + MULBERRY32_INCREMENT) | 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    nextFloat: next,
    nextInt(min: number, max: number): number {
      if (!Number.isFinite(min) || !Number.isFinite(max)) {
        throw new Error('createSeededRng.nextInt: min/max must be finite');
      }
      const lo = Math.min(min, max) | 0;
      const hi = Math.max(min, max) | 0;
      return lo + Math.floor(next() * (hi - lo + 1));
    },
    chance(probability: number): boolean {
      if (!Number.isFinite(probability)) return false;
      if (probability <= 0) return false;
      if (probability >= 1) return true;
      return next() < probability;
    },
    pick<T>(items: readonly T[]): T | null {
      if (items.length === 0) return null;
      const idx = Math.floor(next() * items.length);
      return items[idx] ?? null;
    },
  };
}

/**
 * Hash 1 string thành numeric seed (FNV-1a 32-bit). Stable cross-run,
 * cross-platform — same input → same output. Dùng để derive seed từ
 * Arena match id, dungeon run id, character id, etc.
 */
export function hashSeed(input: string): number {
  let h = FNV_OFFSET_BASIS | 0;
  for (let i = 0; i < input.length; i += 1) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, FNV_PRIME);
  }
  return h | 0;
}

/**
 * Compose seed mới từ base seed + salt (string hoặc number). Dùng để derive
 * sub-seed cho 1 sub-component (vd attacker action seed vs defender action
 * seed) trong 1 combat. Stable cross-run.
 *
 * @example
 * const baseSeed = hashSeed(matchId);
 * const attackerSeed = composeSeed(baseSeed, 'attacker');
 * const defenderSeed = composeSeed(baseSeed, 'defender');
 */
export function composeSeed(seed: number, salt: number | string): number {
  const numericSalt = typeof salt === 'number' ? salt | 0 : hashSeed(salt);
  // Mix qua 1 step mulberry32 để spread bit (giống `composeBattlePhaseSeed`
  // ở tribulation-mini-battle).
  let state = (seed ^ Math.imul(numericSalt, COMPOSE_PHI)) | 0;
  state = (state + MULBERRY32_INCREMENT) | 0;
  let t = state;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) | 0;
}
