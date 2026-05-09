/**
 * Phase 14.2.D — Elemental Dungeon and Boss Identity.
 *
 * Mở rộng dungeon/boss thành nội dung có bản sắc Ngũ Hành rõ — derive UI
 * profile (dominant element, recommended counter element, weakness, resist,
 * reward hint) từ existing catalog data (`DungeonDef.element`,
 * `BossDef.element` + `BossDef.elementalResist`) đồng thời cho phép catalog
 * override fields nếu thiết kế cần.
 *
 * **KHÔNG đụng damage formula** — module này chỉ derive metadata cho UI
 * + helper validate. Combat runtime vẫn áp damage qua `elementalMultiplier`
 * (Phase 11.3.B) + `applyElementalCombatAdjustment` (Phase 14.2.A) +
 * `composeMonsterElementalResist` (Phase 14.2.B). Phase 14.2.D chỉ thêm
 * **lớp UI / hint metadata** trên catalog.
 *
 * Design principle:
 *
 *   - **Derived defaults**: nếu `DungeonDef.dominantElement` không set,
 *     fallback sang `DungeonDef.element` (legacy). Nếu
 *     `DungeonDef.recommendedCounterElement` không set, derive từ counter
 *     của dominant (kim → moc, moc → tho, ...). Cho phép designer override
 *     khi muốn (vd dungeon vô hệ vẫn có recommended counter cụ thể).
 *   - **Backward-compat**: legacy entry không có field mới → fallback
 *     hoạt động đúng. Không cần migration data.
 *   - **No double multiplier**: `BossDef.weaknessElement` chỉ là **hint
 *     UI** — combat damage tính qua `elementalMultiplier` từ
 *     `attackerElement` × `bossElement`, KHÔNG đọc weaknessElement. Test
 *     invariant ép weaknessElement === counter(bossElement) để hint match
 *     reality (ngoại trừ designer override).
 */

import { ELEMENTS, type DungeonDef, type ElementKey } from './combat';
import type { BossDef } from './boss';
import { elementGenerates, elementOvercomes } from './spiritual-root';

// ────────────────────────────────────────────────────────────────────────
// Element relation helpers (public)
// ────────────────────────────────────────────────────────────────────────

/**
 * Re-export `elementGenerates` (Ngũ Hành tương sinh — generative cycle)
 * cho parity với `elementOvercomes` + `elementCounter`. Source-of-truth ở
 * `spiritual-root.ts`.
 */
export { elementGenerates, elementOvercomes };

/**
 * Ngũ Hành đối khắc — element nào KHẮC `element` (defender). Dùng cho
 * recommended counter UI: "khuyến nghị dùng skill hệ X để khắc dungeon hệ
 * Y" → counter(Y) = X.
 *
 *   counter(kim) = hoa (Hoả khắc Kim)
 *   counter(moc) = kim (Kim khắc Mộc)
 *   counter(tho) = moc (Mộc khắc Thổ)
 *   counter(thuy) = tho (Thổ khắc Thuỷ)
 *   counter(hoa) = thuy (Thuỷ khắc Hoả)
 *
 * Tính bằng inverse của `elementOvercomes`: counter(X) = element Y sao
 * cho `elementOvercomes(Y) === X`.
 */
export function elementCounter(element: ElementKey): ElementKey {
  for (const e of ELEMENTS) {
    if (elementOvercomes(e) === element) return e;
  }
  // Unreachable — 5 elements cover all relations.
  return element;
}

/**
 * Hệ nào tương sinh `element` (defender). counter cycle generation:
 * `generatedBy(X) = Y` sao cho `elementGenerates(Y) === X`.
 */
export function elementGeneratedBy(element: ElementKey): ElementKey {
  for (const e of ELEMENTS) {
    if (elementGenerates(e) === element) return e;
  }
  return element;
}

// ────────────────────────────────────────────────────────────────────────
// Dungeon element profile
// ────────────────────────────────────────────────────────────────────────

export interface DungeonElementProfile {
  /**
   * Ngũ Hành chủ đạo của dungeon. Fallback sang `DungeonDef.element` nếu
   * `dominantElement` không set. `null` = dungeon vô hệ (không có theme
   * Ngũ Hành rõ rệt — vd cross-element late-game).
   */
  dominantElement: ElementKey | null;
  /**
   * Hệ khuyến nghị player dùng để clear nhanh. `null` khi dungeon vô hệ
   * (không có recommendation cụ thể). Mặc định = counter của
   * `dominantElement` (`elementCounter`).
   */
  recommendedCounterElement: ElementKey | null;
  /**
   * Hệ flavor cho reward — UI hint cho player biết loot dungeon thiên
   * về hệ nào. Mặc định = `dominantElement` (loot cùng hệ với dungeon).
   * `null` khi dungeon vô hệ hoặc rewardElementHint trong catalog set
   * explicit `null`.
   */
  rewardElementHint: ElementKey | null;
}

/**
 * Derive element profile cho dungeon — combine catalog override với
 * defaults derived từ `DungeonDef.element`. Pure function, dùng được cả
 * client (FE render badge) và server (API include trong response).
 *
 * Catalog override priority:
 *   - `dungeon.dominantElement` ?? `dungeon.element` ?? null.
 *   - `dungeon.recommendedCounterElement` ?? counter(dominant) (nếu
 *     dominant != null) ?? null.
 *   - `dungeon.rewardElementHint` ?? dominant ?? null.
 *
 * Nếu catalog explicit set field = null, override sẽ thắng (designer
 * có thể "tắt" hint cụ thể). `undefined` = fallback default.
 */
export function getDungeonElementProfile(
  dungeon: Readonly<DungeonDef>,
): DungeonElementProfile {
  const dominantElement: ElementKey | null =
    dungeon.dominantElement !== undefined
      ? dungeon.dominantElement
      : dungeon.element ?? null;

  const recommendedCounterElement: ElementKey | null =
    dungeon.recommendedCounterElement !== undefined
      ? dungeon.recommendedCounterElement
      : dominantElement
        ? elementCounter(dominantElement)
        : null;

  const rewardElementHint: ElementKey | null =
    dungeon.rewardElementHint !== undefined
      ? dungeon.rewardElementHint
      : dominantElement;

  return { dominantElement, recommendedCounterElement, rewardElementHint };
}

// ────────────────────────────────────────────────────────────────────────
// Boss element profile
// ────────────────────────────────────────────────────────────────────────

export interface BossElementProfile {
  /** Ngũ Hành affinity của boss. `null` = vô hệ / cross-element. */
  element: ElementKey | null;
  /**
   * Hệ khắc boss — player dùng skill hệ này được bonus damage tốt nhất.
   * Mặc định = counter của `boss.element` (vd boss hệ Hoả → counter Thuỷ).
   * `null` khi boss vô hệ (không có weakness rõ).
   */
  weaknessElement: ElementKey | null;
  /**
   * Danh sách hệ boss kháng. Derive từ `BossDef.elementalResist` keys
   * (mọi hệ có resist `< 1.0`). Designer có thể override qua
   * `BossDef.resistElements` để thêm hint mà không cần resist value
   * (vd boss kháng "tinh thần" pure flavor không impact damage).
   */
  resistElements: readonly ElementKey[];
  /**
   * Hệ flavor cho reward. Mặc định = `boss.element`. Designer có thể
   * override để align với drop pool (vd boss vô hệ drop loot hệ Kim).
   */
  rewardElementHint: ElementKey | null;
}

/**
 * Derive element profile cho boss — combine catalog override với
 * defaults derived từ `BossDef.element` + `BossDef.elementalResist`.
 *
 * Override priority:
 *   - `element`: catalog `boss.element` ?? null.
 *   - `weaknessElement`: `boss.weaknessElement` ?? counter(element) ?? null.
 *   - `resistElements`: `boss.resistElements` ?? keys của
 *     `boss.elementalResist` (sorted asc, dedup) ?? [].
 *   - `rewardElementHint`: `boss.rewardElementHint` ?? element.
 *
 * Pure function — không đọc DB / không mutate. Server có thể call để
 * include trong BossView response; client cũng có thể call để render.
 */
export function getBossElementProfile(
  boss: Readonly<BossDef>,
): BossElementProfile {
  const element: ElementKey | null = boss.element ?? null;

  const weaknessElement: ElementKey | null =
    boss.weaknessElement !== undefined
      ? boss.weaknessElement
      : element
        ? elementCounter(element)
        : null;

  let resistElements: readonly ElementKey[];
  if (boss.resistElements !== undefined) {
    resistElements = boss.resistElements;
  } else if (boss.elementalResist) {
    const keys: ElementKey[] = [];
    for (const el of ELEMENTS) {
      const v = boss.elementalResist[el];
      if (typeof v === 'number' && v < 1) {
        keys.push(el);
      }
    }
    resistElements = keys;
  } else {
    resistElements = [];
  }

  const rewardElementHint: ElementKey | null =
    boss.rewardElementHint !== undefined ? boss.rewardElementHint : element;

  return { element, weaknessElement, resistElements, rewardElementHint };
}

// ────────────────────────────────────────────────────────────────────────
// Player vs Dungeon/Boss element warning
// ────────────────────────────────────────────────────────────────────────

/**
 * Mức cảnh báo Ngũ Hành cho player chuẩn bị vào dungeon / đánh boss.
 *
 *   - `recommended`: player dùng skill khắc target → damage bonus
 *     (`ELEMENT_COUNTER_MULTIPLIER` 1.30). UI hiển thị xanh "khuyến
 *     nghị".
 *   - `caution`: player cùng hệ target hoặc bị target sinh — damage hơi
 *     yếu (`ELEMENT_SAME_ELEMENT_MULTIPLIER` 0.90 / 0.85). UI hiển thị
 *     vàng nhạt "đề phòng".
 *   - `warning`: player BỊ target khắc → damage giảm (0.70). UI hiển
 *     thị đỏ "cẩn thận".
 *   - `none`: trung tính / vô hệ — UI không hiện gì.
 */
export type PlayerElementWarning =
  | 'none'
  | 'recommended'
  | 'caution'
  | 'warning';

/**
 * Compute warning cho 1 element player (primary linh căn) vs target hệ
 * dungeon/boss. Pure function.
 *
 *   - `playerElement = null` → 'none' (player vô hệ / chưa có linh căn).
 *   - `targetElement = null` → 'none' (target vô hệ — không có
 *     interaction Ngũ Hành).
 *   - player khắc target → 'recommended'.
 *   - player bị target khắc → 'warning'.
 *   - cùng hệ / bị sinh / sinh target → 'caution'.
 *   - khác cycle (impossible với 5 element) → 'none'.
 */
export function computePlayerElementWarning(
  playerElement: ElementKey | null,
  targetElement: ElementKey | null,
): PlayerElementWarning {
  if (!playerElement || !targetElement) return 'none';
  if (elementOvercomes(playerElement) === targetElement) return 'recommended';
  if (elementOvercomes(targetElement) === playerElement) return 'warning';
  if (playerElement === targetElement) return 'caution';
  if (elementGeneratedBy(playerElement) === targetElement) return 'caution';
  if (elementGeneratedBy(targetElement) === playerElement) return 'caution';
  return 'none';
}

/**
 * Player có element profile (primary + secondaries) vs target hệ
 * dungeon/boss. Returns highest priority warning across player elements.
 *
 * Priority order: 'recommended' > 'warning' > 'caution' > 'none'.
 * Lý do: nếu primary linh căn khắc boss → recommended (highlight
 * positive cho player), kể cả secondary có warning. Nếu primary bị
 * khắc → warning (alert player). Caution cuối cùng — hint nhẹ.
 *
 * `playerSecondaries` mặc định empty array.
 */
export function computePlayerElementWarningForSet(
  playerPrimary: ElementKey | null,
  playerSecondaries: readonly ElementKey[],
  targetElement: ElementKey | null,
): PlayerElementWarning {
  const all: (ElementKey | null)[] = [playerPrimary, ...playerSecondaries];
  const verdicts = all.map((e) => computePlayerElementWarning(e, targetElement));
  if (verdicts.includes('recommended')) return 'recommended';
  if (verdicts.includes('warning')) return 'warning';
  if (verdicts.includes('caution')) return 'caution';
  return 'none';
}

// ────────────────────────────────────────────────────────────────────────
// Validators (catalog invariant)
// ────────────────────────────────────────────────────────────────────────

/**
 * Validate `DungeonElementProfile` consistency vs `DungeonDef.element`.
 *
 * Returns array of issue strings — empty = valid. Used in catalog
 * invariant tests để catch designer override vô lý (vd dungeon
 * dominantElement='kim' nhưng recommendedCounterElement='moc' không
 * khắc kim).
 *
 *   - issue: `dominantElement` !== `element` (nếu cả 2 set explicit) →
 *     conflict, designer phải chọn 1 source.
 *   - issue: `recommendedCounterElement` set explicit nhưng KHÔNG khắc
 *     `dominantElement` (nếu dominant != null) → hint sai semantic.
 *   - issue: `rewardElementHint` không thuộc `ELEMENTS` (nếu set) →
 *     invalid element key.
 */
export function validateDungeonElementProfile(
  dungeon: Readonly<DungeonDef>,
): string[] {
  const issues: string[] = [];
  // dominantElement vs legacy element conflict.
  if (
    dungeon.dominantElement !== undefined &&
    dungeon.element !== undefined &&
    dungeon.dominantElement !== dungeon.element
  ) {
    issues.push(
      `dungeon ${dungeon.key}: dominantElement=${dungeon.dominantElement} != element=${dungeon.element} (catalog conflict)`,
    );
  }
  const profile = getDungeonElementProfile(dungeon);
  // recommendedCounter must counter dominant (semantic invariant).
  if (
    dungeon.recommendedCounterElement !== undefined &&
    dungeon.recommendedCounterElement !== null &&
    profile.dominantElement !== null
  ) {
    const expectedCounter = elementCounter(profile.dominantElement);
    if (dungeon.recommendedCounterElement !== expectedCounter) {
      issues.push(
        `dungeon ${dungeon.key}: recommendedCounterElement=${dungeon.recommendedCounterElement} không khắc dominantElement=${profile.dominantElement} (expected ${expectedCounter})`,
      );
    }
  }
  // rewardElementHint must be valid element or null.
  if (
    dungeon.rewardElementHint !== undefined &&
    dungeon.rewardElementHint !== null &&
    !(ELEMENTS as readonly string[]).includes(dungeon.rewardElementHint)
  ) {
    issues.push(
      `dungeon ${dungeon.key}: rewardElementHint=${dungeon.rewardElementHint} không thuộc ELEMENTS`,
    );
  }
  return issues;
}

/**
 * Validate `BossElementProfile` consistency vs `BossDef.element` +
 * `BossDef.elementalResist`.
 *
 * Returns array of issue strings — empty = valid.
 *
 *   - issue: `weaknessElement` set explicit nhưng KHÔNG khắc `element`
 *     (nếu element != null) → hint sai semantic.
 *   - issue: `resistElements` set explicit chứa hệ KHÔNG có trong
 *     `elementalResist` keys → hint không match damage data (player
 *     hiểu lầm là kháng).
 *   - issue: invalid element key trong `resistElements` /
 *     `rewardElementHint` / `weaknessElement`.
 */
export function validateBossElementProfile(boss: Readonly<BossDef>): string[] {
  const issues: string[] = [];
  // weaknessElement must counter element.
  if (
    boss.weaknessElement !== undefined &&
    boss.weaknessElement !== null &&
    boss.element
  ) {
    const expectedWeakness = elementCounter(boss.element);
    if (boss.weaknessElement !== expectedWeakness) {
      issues.push(
        `boss ${boss.key}: weaknessElement=${boss.weaknessElement} không khắc element=${boss.element} (expected ${expectedWeakness})`,
      );
    }
  }
  // weaknessElement valid.
  if (
    boss.weaknessElement !== undefined &&
    boss.weaknessElement !== null &&
    !(ELEMENTS as readonly string[]).includes(boss.weaknessElement)
  ) {
    issues.push(
      `boss ${boss.key}: weaknessElement=${boss.weaknessElement} không thuộc ELEMENTS`,
    );
  }
  // resistElements valid keys.
  if (boss.resistElements !== undefined) {
    for (const el of boss.resistElements) {
      if (!(ELEMENTS as readonly string[]).includes(el)) {
        issues.push(
          `boss ${boss.key}: resistElements chứa ${el} không thuộc ELEMENTS`,
        );
      }
    }
    // resistElements should be subset of elementalResist keys (nếu cả 2 set).
    if (boss.elementalResist) {
      const resistKeys = new Set(
        Object.entries(boss.elementalResist)
          .filter(([, v]) => typeof v === 'number' && v < 1)
          .map(([k]) => k as ElementKey),
      );
      for (const el of boss.resistElements) {
        if (!resistKeys.has(el)) {
          issues.push(
            `boss ${boss.key}: resistElements chứa ${el} nhưng elementalResist[${el}] không < 1.0 (hint không match damage)`,
          );
        }
      }
    }
  }
  // rewardElementHint valid.
  if (
    boss.rewardElementHint !== undefined &&
    boss.rewardElementHint !== null &&
    !(ELEMENTS as readonly string[]).includes(boss.rewardElementHint)
  ) {
    issues.push(
      `boss ${boss.key}: rewardElementHint=${boss.rewardElementHint} không thuộc ELEMENTS`,
    );
  }
  return issues;
}

/**
 * Find all `DungeonDef` whose dominantElement matches given element.
 * Used cho UI filter "dungeon hệ X" + element coverage invariant.
 *
 * Pass `null` để query dungeon vô hệ (cross-element).
 */
export function dungeonsByDominantElement(
  dungeons: ReadonlyArray<Readonly<DungeonDef>>,
  element: ElementKey | null,
): DungeonDef[] {
  return dungeons.filter(
    (d) => getDungeonElementProfile(d).dominantElement === element,
  );
}

/**
 * Find all `BossDef` weak to given element. Used cho UI hint
 * "boss khắc bởi {element}: …" + element coverage invariant.
 *
 * Pass element X → trả mọi boss có `weaknessElement === X`.
 */
export function bossesWeakTo(
  bosses: ReadonlyArray<Readonly<BossDef>>,
  element: ElementKey,
): BossDef[] {
  return bosses.filter((b) => getBossElementProfile(b).weaknessElement === element);
}
