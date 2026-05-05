/**
 * Linh căn / Spiritual Root — Phase 11.0 prep catalog (foundation only,
 * KHÔNG runtime).
 *
 * Hệ thống Linh căn:
 * - Mỗi nhân vật khi tạo sẽ roll 1 lần Linh căn (5 grade `pham/linh/huyen/
 *   tien/than`) + 1 `primaryElement` thuộc Ngũ Hành (`kim/moc/thuy/hoa/
 *   tho`) + tuỳ grade có thêm `secondaryElements[]`.
 * - Linh căn ảnh hưởng:
 *   - `cultivationMultiplier`: tốc độ exp cultivate (phase 11.3 wire vào
 *     `CultivationService.tickExp`).
 *   - `statBonus`: bonus baseline hpMax / mpMax / atk / def (phase 11.3
 *     wire vào `CharacterStatService.computeStats`).
 *   - `elementMultiplier(skill, target)`: damage modifier theo Ngũ Hành
 *     tương sinh / tương khắc (phase 11.2 wire vào `CombatService.
 *     applySkillDamage`).
 * - Re-roll bằng item `linh_can_dan` (cost cao, drop hiếm endgame). Catalog
 *   này KHÔNG define re-roll item — đã có ở `items.ts`.
 *
 * Hiện trạng PR (session 9r-8 Phase 11.0 catalog foundation):
 *   - Chỉ catalog metadata + helper function.
 *   - KHÔNG schema migration (`Character.spiritualRoot*` future PR).
 *   - KHÔNG runtime hook (cultivation/combat/stat service không đọc).
 *   - KHÔNG onboarding roll (future PR P11-1.B Spiritual Root MVP runtime).
 *
 * Source of truth:
 *   - `docs/GAME_DESIGN_BIBLE.md` §C.4 Linh căn & Thể chất.
 *   - `docs/BALANCE_MODEL.md` §4.2 Element multiplier (chu kỳ tương khắc).
 *   - `docs/LONG_TERM_ROADMAP.md` Phase 11 P11-1 Spiritual Root MVP.
 *
 * Phase 10 PR-5 `boss.ts` + PR-2 `combat.ts` đã ghi `element` field
 * forward-compat — phase 11 sẽ chính thức wire qua `elementMultiplier()`
 * helper bên dưới.
 */

import type { ElementKey } from './combat';
import { ELEMENTS } from './combat';
import {
  describeElementMatch,
  ELEMENT_CHARACTER_PRIMARY_BONUS,
  ELEMENT_CHARACTER_SECONDARY_BONUS,
} from './balance-dials';

/**
 * 5 grade linh căn theo `GAME_DESIGN_BIBLE.md` §C.4. Ordering từ thấp đến
 * cao: phàm < linh < huyền < tiên < thần. Re-roll bằng `linh_can_dan` chỉ
 * có thể TĂNG, không giảm (server-authoritative).
 */
export type SpiritualRootGrade = 'pham' | 'linh' | 'huyen' | 'tien' | 'than';

/**
 * Ordered tier list — phàm = lowest (most common roll). Roll RNG dựa trên
 * `rollWeight` ở `SPIRITUAL_ROOT_GRADES`. Future P11-1.B runtime sẽ wire.
 */
export const SPIRITUAL_ROOT_GRADES: readonly SpiritualRootGrade[] = [
  'pham',
  'linh',
  'huyen',
  'tien',
  'than',
];

export interface SpiritualRootGradeDef {
  key: SpiritualRootGrade;
  /** Tên hiển thị tiếng Việt — UI render. */
  name: string;
  /** Mô tả ngắn cho UI tooltip. */
  description: string;
  /**
   * Tier rank — index trong `SPIRITUAL_ROOT_GRADES` (0=pham, 4=than). Dùng
   * để compare grade > / < trong runtime (phase 11.3).
   */
  tier: number;
  /**
   * Multiplier cho `CultivationService.tickExp` — phàm 1.0× baseline, lên
   * dần. `BALANCE_MODEL.md` §4.4 sẽ chính thức wire công thức (currently
   * placeholder values).
   */
  cultivationMultiplier: number;
  /**
   * Bonus % cho stat baseline (hpMax / mpMax / atk / def). Default `0` =
   * không bonus. Wire vào `CharacterStatService.computeStats` ở phase 11.3.
   */
  statBonusPercent: number;
  /**
   * Số lượng `secondaryElements` random thêm khi roll. `pham` chỉ 1
   * primary (đơn linh căn → cultivation chậm). `than` thêm 4 secondary
   * (toàn linh căn → cultivation nhanh + mọi hệ skill bonus).
   */
  secondaryElementCount: number;
  /**
   * Roll weight cho RNG khi tạo character (P11-1.B runtime). Tổng weights
   * → grade probability. Higher weight = rarer.
   *
   * Default RNG (P11-1.B): `pham 60% / linh 25% / huyen 10% / tien 4% /
   * than 1%`. Re-roll bằng `linh_can_dan` có thể tăng grade nhưng KHÔNG
   * vượt quá grade hiện tại (server-authoritative, anti-cheese).
   */
  rollWeight: number;
}

/**
 * 5-tier grade table — config nhỏ, KHÔNG runtime hook. Phase 11.3 sẽ wire
 * vào `cultivationMultiplier` + `statBonusPercent`. Tier ordering quan
 * trọng: index thấp = tier thấp hơn (phàm = 0, thần = 4).
 */
export const SPIRITUAL_ROOT_GRADE_DEFS: readonly SpiritualRootGradeDef[] = [
  {
    key: 'pham',
    name: 'Phàm Linh Căn',
    description: 'Linh căn phàm phẩm, đa số người tu tiên đều có. Tu luyện chậm, không bonus chiến đấu.',
    tier: 0,
    cultivationMultiplier: 1.0,
    statBonusPercent: 0,
    secondaryElementCount: 0,
    rollWeight: 60,
  },
  {
    key: 'linh',
    name: 'Linh Căn',
    description: 'Linh căn phổ thông, tu luyện ổn định. Có 1 secondary element bổ trợ.',
    tier: 1,
    cultivationMultiplier: 1.15,
    statBonusPercent: 5,
    secondaryElementCount: 1,
    rollWeight: 25,
  },
  {
    key: 'huyen',
    name: 'Huyền Linh Căn',
    description: 'Linh căn cao cấp, mỗi 100 người mới có 10 người. Tu luyện nhanh, stat bonus tốt.',
    tier: 2,
    cultivationMultiplier: 1.30,
    statBonusPercent: 10,
    secondaryElementCount: 2,
    rollWeight: 10,
  },
  {
    key: 'tien',
    name: 'Tiên Linh Căn',
    description: 'Linh căn cực phẩm, hiếm có. Tu luyện cực nhanh, stat bonus mạnh, gần đủ Ngũ Hành.',
    tier: 3,
    cultivationMultiplier: 1.50,
    statBonusPercent: 18,
    secondaryElementCount: 3,
    rollWeight: 4,
  },
  {
    key: 'than',
    name: 'Thần Linh Căn',
    description: 'Toàn linh căn — Ngũ Hành đầy đủ. Tu tiên thiên tài, mọi hệ skill đều bonus.',
    tier: 4,
    cultivationMultiplier: 1.80,
    statBonusPercent: 30,
    secondaryElementCount: 4,
    rollWeight: 1,
  },
];

/**
 * Lookup grade def by key. Throws if invalid (catalog-level constant —
 * runtime cannot pass invalid grade unless schema bypass).
 */
export function getSpiritualRootGradeDef(grade: SpiritualRootGrade): SpiritualRootGradeDef {
  const def = SPIRITUAL_ROOT_GRADE_DEFS.find((g) => g.key === grade);
  if (!def) {
    throw new Error(`Unknown SpiritualRootGrade: ${grade as string}`);
  }
  return def;
}

/**
 * Compare 2 grade — return >0 nếu `a > b`, <0 nếu `a < b`, 0 nếu equal.
 * Dùng trong re-roll logic (anti-downgrade), display sorting.
 */
export function compareSpiritualRootGrade(a: SpiritualRootGrade, b: SpiritualRootGrade): number {
  return getSpiritualRootGradeDef(a).tier - getSpiritualRootGradeDef(b).tier;
}

/**
 * Ngũ Hành tương sinh — chu kỳ generative cycle. Element `a` SINH `b`
 * means `a` empowers `b` (e.g. Mộc sinh Hoả: cây cháy thành lửa). Trong
 * combat, attacker.element sinh defender.element → +20% damage (skill
 * cùng tự nhiên synergy với target element).
 *
 * Cycle (clockwise):
 *   Kim sinh Thuỷ → Thuỷ sinh Mộc → Mộc sinh Hoả → Hoả sinh Thổ →
 *   Thổ sinh Kim
 */
export function elementGenerates(element: ElementKey): ElementKey {
  switch (element) {
    case 'kim':
      return 'thuy';
    case 'thuy':
      return 'moc';
    case 'moc':
      return 'hoa';
    case 'hoa':
      return 'tho';
    case 'tho':
      return 'kim';
  }
}

/**
 * Ngũ Hành tương khắc — chu kỳ destructive cycle. Element `a` KHẮC `b`
 * means `a` overcomes / destroys `b` (e.g. Kim khắc Mộc: rìu chém cây).
 * Trong combat, attacker.element khắc defender.element → +30% damage
 * (skill effective vs vulnerable target).
 *
 * Cycle:
 *   Kim khắc Mộc → Mộc khắc Thổ → Thổ khắc Thuỷ → Thuỷ khắc Hoả →
 *   Hoả khắc Kim
 */
export function elementOvercomes(element: ElementKey): ElementKey {
  switch (element) {
    case 'kim':
      return 'moc';
    case 'moc':
      return 'tho';
    case 'tho':
      return 'thuy';
    case 'thuy':
      return 'hoa';
    case 'hoa':
      return 'kim';
  }
}

/**
 * Damage multiplier dựa trên Ngũ Hành quan hệ giữa attacker.element và
 * defender.element. **Source-of-truth là `describeElementMatch()` ở
 * `balance-dials.ts`** — function này delegate sang dial registry để có
 * single tuning point. Behavior identical:
 *
 *   - **Tương khắc** (attacker khắc defender): `ELEMENT_COUNTER_MULTIPLIER`
 *     = `1.30` (e.g. Kim → Mộc).
 *   - **Tương sinh** (attacker sinh defender): `ELEMENT_GENERATE_MULTIPLIER`
 *     = `1.20` (e.g. Mộc → Hoả). Sinh weaker than khắc.
 *   - **Bị khắc** (attacker bị defender khắc): `ELEMENT_COUNTERED_MULTIPLIER`
 *     = `0.70` (defender mạnh hơn).
 *   - **Bị sinh** (attacker bị defender sinh): `ELEMENT_GENERATED_MULTIPLIER`
 *     = `0.85` (defender hấp thụ năng lượng).
 *   - **Cùng hệ**: `ELEMENT_SAME_ELEMENT_MULTIPLIER` = `0.90`.
 *   - **Vô hệ** (`null` either side): `ELEMENT_NEUTRAL_MULTIPLIER` = `1.00`.
 *
 * Wired Phase 11.3.B vào `CombatService` (skill + talent flow + monster
 * reply) + `BossService`. Phase 11 nâng cao §3 (this PR) centralize dial
 * vào `balance-dials.ts` để admin dashboard / future re-tune dùng chung.
 *
 * Reference: `BALANCE_MODEL.md` §4.2 Element multiplier.
 */
export function elementMultiplier(
  attacker: ElementKey | null,
  defender: ElementKey | null,
): number {
  return describeElementMatch(attacker, defender).multiplier;
}

/**
 * Roll character spiritual root state — Phase 11.0 catalog định nghĩa shape,
 * phase 11.1.B (P11-1 runtime) sẽ implement RNG roll service. Catalog
 * KHÔNG implement RNG để giữ deterministic test; runtime sẽ inject seeded
 * RNG để test reproducible.
 *
 * Schema migration P11-1.A sẽ thêm 4 field tương ứng vào `Character`:
 *   - `spiritualRootGrade: SpiritualRootGrade` (default `'pham'` cho legacy).
 *   - `primaryElement: ElementKey` (default `'kim'` cho legacy — không null
 *     để combat runtime không phải null-check, legacy character vẫn có hệ
 *     để wire `elementMultiplier`).
 *   - `secondaryElements: ElementKey[]` (default `[]`).
 *   - `rootPurity: number` (default `100` — purity 0-100, ảnh hưởng future
 *     refine system).
 *   - `rootRerollCount: number` (default `0` — counter để track anti-spam).
 */
export interface SpiritualRootState {
  grade: SpiritualRootGrade;
  primaryElement: ElementKey;
  secondaryElements: readonly ElementKey[];
  /** Purity 0-100 — future P11-2 sẽ wire vào refine. */
  purity: number;
  /** Re-roll counter — RNG seed input nếu muốn deterministic. */
  rerollCount: number;
}

/**
 * Validate `SpiritualRootState` shape — runtime use khi load Character từ
 * DB (defensive parse). Returns `null` nếu invalid.
 */
export function validateSpiritualRootState(state: unknown): SpiritualRootState | null {
  if (!state || typeof state !== 'object') return null;
  const s = state as Record<string, unknown>;
  if (typeof s.grade !== 'string' || !SPIRITUAL_ROOT_GRADES.includes(s.grade as SpiritualRootGrade)) {
    return null;
  }
  if (typeof s.primaryElement !== 'string' || !ELEMENTS.includes(s.primaryElement as ElementKey)) {
    return null;
  }
  if (!Array.isArray(s.secondaryElements)) return null;
  for (const e of s.secondaryElements) {
    if (typeof e !== 'string' || !ELEMENTS.includes(e as ElementKey)) return null;
  }
  if (typeof s.purity !== 'number' || s.purity < 0 || s.purity > 100) return null;
  if (typeof s.rerollCount !== 'number' || s.rerollCount < 0 || !Number.isInteger(s.rerollCount)) {
    return null;
  }
  // Validate secondaryElements count matches grade tier.
  const def = getSpiritualRootGradeDef(s.grade as SpiritualRootGrade);
  if (s.secondaryElements.length !== def.secondaryElementCount) return null;
  // Validate secondaryElements không trùng primaryElement và không trùng
  // nhau (mỗi element chỉ xuất hiện 1 lần trong tổng linh căn).
  const all = new Set<string>([s.primaryElement as string]);
  for (const e of s.secondaryElements as ElementKey[]) {
    if (all.has(e)) return null;
    all.add(e);
  }
  return {
    grade: s.grade as SpiritualRootGrade,
    primaryElement: s.primaryElement as ElementKey,
    secondaryElements: s.secondaryElements as ElementKey[],
    purity: s.purity,
    rerollCount: s.rerollCount,
  };
}

/**
 * Compute character's overall element bonus damage multiplier khi cast
 * skill `skillElement` vs target `targetElement`. Bao gồm:
 *
 *   - Base `elementMultiplier(skillElement, targetElement)` (Ngũ Hành).
 *   - Bonus +0.10 nếu `skillElement === character.primaryElement` (skill
 *     cùng hệ chính).
 *   - Bonus +0.05 nếu `skillElement ∈ character.secondaryElements` (skill
 *     cùng hệ phụ).
 *   - KHÔNG additive với base nếu skillElement = null (vô hệ skill —
 *     không Ngũ Hành bonus).
 *
 * Phase 11.2 sẽ wire vào `CombatService.applySkillDamage`. Hiện chỉ helper
 * + test — runtime KHÔNG đọc.
 */
export function characterSkillElementBonus(
  character: { primaryElement: ElementKey; secondaryElements: readonly ElementKey[] } | null,
  skillElement: ElementKey | null,
  targetElement: ElementKey | null,
): number {
  const baseMul = elementMultiplier(skillElement, targetElement);
  if (skillElement === null || character === null) return baseMul;
  if (skillElement === character.primaryElement) {
    return baseMul + ELEMENT_CHARACTER_PRIMARY_BONUS;
  }
  if (character.secondaryElements.includes(skillElement)) {
    return baseMul + ELEMENT_CHARACTER_SECONDARY_BONUS;
  }
  return baseMul;
}

// Re-export `ELEMENT_NEUTRAL_MULTIPLIER` cho legacy callsite import shape (e.g.
// `import { ELEMENT_NEUTRAL_MULTIPLIER } from '@xuantoi/shared/spiritual-root'`)
// — convenience re-export, source-of-truth vẫn ở `balance-dials.ts`.
export { ELEMENT_NEUTRAL_MULTIPLIER } from './balance-dials';
