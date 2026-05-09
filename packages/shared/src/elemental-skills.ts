/**
 * Phase 14.2.C — Elemental Skill Tree Expansion.
 *
 * Mục tiêu: biến Ngũ Hành (Phase 14.2.A foundation, Phase 14.2.B data) từ
 * lớp damage/resist sang **hệ kỹ năng có hướng chơi riêng**. File này chứa:
 *
 *   1. `SkillElementIdentity` — mô tả gameplay identity từng hệ (HEAL /
 *      DOT / BURST / SHIELD / CRIT / CONTROL) cho UI tooltip + catalog
 *      validation.
 *   2. Hằng số balance cho tag side-effect: `SKILL_TAG_DOT_DAMAGE_RATIO`,
 *      `SKILL_TAG_DOT_TURNS`, `SKILL_TAG_SHIELD_HP_RATIO`.
 *   3. Helpers: `computeSkillElementBonus`, `skillsForTag`,
 *      `describeSkillElementIdentity`, `validateSkillTag`.
 *
 * ⚠️ KHÔNG sửa schema, KHÔNG migration. `SkillDef.tags` là optional —
 * legacy skill không khai báo → tags `[]` → backward-compat với combat
 * runtime hiện có (Phase 11 chain + Phase 14.2.A foundation).
 *
 * Combat side-effect dispatch xảy ra tại
 * `apps/api/src/modules/combat/combat.service.ts` (encounter state extends
 * `monsterDot` + `playerShield`). Xem `BALANCE_MODEL.md §4.7` cho dial.
 */
import type { ElementKey, SkillDef, SkillTag } from './combat';
import { ELEMENTS, SKILLS, SKILL_TAGS } from './combat';
import {
  ELEMENT_CHARACTER_PRIMARY_BONUS,
  ELEMENT_CHARACTER_SECONDARY_BONUS,
} from './balance-dials';
import { characterSkillElementBonus, elementMultiplier } from './spiritual-root';

// ---------------------------------------------------------------------------
// Element identity catalog
// ---------------------------------------------------------------------------

/**
 * Identity card cho 1 hệ Ngũ Hành — flavor + gameplay role để FE tooltip
 * và catalog validation.
 */
export interface SkillElementIdentity {
  /** Hệ. */
  element: ElementKey;
  /** Tên Hán Việt (vd "Mộc"). */
  name: string;
  /** Mô tả gameplay 1 dòng (vd "Hồi máu + độc tố kéo dài + sinh trưởng"). */
  theme: string;
  /**
   * Tag chính (gameplay identity) — luôn xuất hiện ở ít nhất 1 skill
   * cùng hệ. Sub-set của `SKILL_TAGS`. Dùng cho `validateElementCoverage`.
   */
  primaryTags: readonly SkillTag[];
  /**
   * Tag phụ (flavor) — không bắt buộc cover; chỉ dùng cho UI hint.
   */
  secondaryTags: readonly SkillTag[];
  /** Mô tả định hướng cho người chơi (Vietnamese). */
  playstyle: string;
}

/**
 * Phase 14.2.C — Catalog identity 5 hệ. Mỗi entry mô tả:
 *   - `primaryTags`: tag bắt buộc xuất hiện ≥ 1 skill cùng hệ.
 *   - `secondaryTags`: tag flavor.
 *   - `theme` + `playstyle`: dùng ở FE tooltip để giải thích Ngũ Hành cho
 *     người chơi mới.
 */
export const SKILL_ELEMENT_IDENTITY: ReadonlyArray<SkillElementIdentity> = [
  {
    element: 'kim',
    name: 'Kim',
    theme: 'Xuyên giáp & sát thương dứt khoát',
    primaryTags: ['CRIT', 'BURST'],
    secondaryTags: ['CONTROL'],
    playstyle:
      'Kim hệ chuyên xuyên giáp + bộc phát chí mạng. Đòn đánh ít nhưng mỗi đòn đáng giá: sát thương cao, tỉ lệ chí mạng và bỏ qua phòng ngự đối phương.',
  },
  {
    element: 'moc',
    name: 'Mộc',
    theme: 'Hồi phục & độc tố kéo dài',
    primaryTags: ['HEAL', 'DOT'],
    secondaryTags: ['BURST'],
    playstyle:
      'Mộc hệ tu vi đại biểu cho sinh trưởng — vừa hồi máu cho bản thân, vừa gieo độc tố hao mòn linh hồn đối thủ qua nhiều lượt. Sống lâu, gặm dần.',
  },
  {
    element: 'thuy',
    name: 'Thuỷ',
    theme: 'Khống chế & hồi linh lực',
    primaryTags: ['CONTROL', 'HEAL'],
    secondaryTags: ['DOT'],
    playstyle:
      'Thuỷ hệ giỏi điều khiển nhịp trận — đóng băng / làm chậm địch và hồi linh khí cho bản thân. Kiên nhẫn, nuôi MP để combo cấp cao.',
  },
  {
    element: 'hoa',
    name: 'Hoả',
    theme: 'Bùng nổ & thiêu đốt',
    primaryTags: ['BURST', 'DOT'],
    secondaryTags: ['CRIT'],
    playstyle:
      'Hoả hệ là vua sát thương bộc phát. Đốt trụi mục tiêu trong vài lượt, để lại vết bỏng chí tử kéo dài. Tốn linh khí lớn — đánh nhanh thắng nhanh.',
  },
  {
    element: 'tho',
    name: 'Thổ',
    theme: 'Khiên hộ thân & giảm sát thương',
    primaryTags: ['SHIELD', 'CONTROL'],
    secondaryTags: ['BURST'],
    playstyle:
      'Thổ hệ là rường cột phòng ngự — dựng khiên đá hấp thu sát thương và phong toả bước tiến của địch. Vững chãi, sống đến lượt cuối.',
  },
];

/** Lookup theo element. */
export function getSkillElementIdentity(
  element: ElementKey,
): SkillElementIdentity {
  const found = SKILL_ELEMENT_IDENTITY.find((e) => e.element === element);
  if (!found) {
    throw new Error(`SkillElementIdentity not found for element=${element}`);
  }
  return found;
}

/**
 * Mô tả ngắn cho FE tooltip — kết hợp `name` + `theme`.
 *
 * @example describeSkillElementIdentity('hoa') // → "Hoả — Bùng nổ & thiêu đốt"
 */
export function describeSkillElementIdentity(element: ElementKey | null): string {
  if (element === null) return 'Vô hệ';
  const id = getSkillElementIdentity(element);
  return `${id.name} — ${id.theme}`;
}

// ---------------------------------------------------------------------------
// Tag side-effect dial (BALANCE_MODEL §4.7)
// ---------------------------------------------------------------------------

/**
 * Khi skill có `tags: ['DOT']`, mỗi turn (3 turn) thêm
 * `floor(damageBase × DOT_DAMAGE_RATIO)` HP cho monster — `damageBase` là
 * sát thương 1-shot tại lượt cast. 0.15 = 15% sát thương lập lại.
 *
 * Kết hợp 3 turn → tổng DOT ≈ 45% sát thương 1-shot, cap mềm bằng
 * `monsterDot.turnsLeft = SKILL_TAG_DOT_TURNS`.
 */
export const SKILL_TAG_DOT_DAMAGE_RATIO = 0.15;

/** Số turn DOT tồn tại sau khi cast (xem `monsterDot.turnsLeft`). */
export const SKILL_TAG_DOT_TURNS = 3;

/**
 * Khi skill có `tags: ['SHIELD']`, sau khi cast set
 * `playerShield.absorb = floor(char.hpMax × SHIELD_HP_RATIO)`. Hấp thụ
 * monster reply lượt KẾ TIẾP — single-use, không stack với
 * `talent_shield_phong` (compose multiplicative).
 */
export const SKILL_TAG_SHIELD_HP_RATIO = 0.1;

// ---------------------------------------------------------------------------
// Character affinity bonus (Phase 14.2.C polish API)
// ---------------------------------------------------------------------------

/**
 * Phase 14.2.C — `computeSkillElementBonus` thin wrapper accept `SkillDef`
 * thay vì raw `ElementKey`. Dùng ở callsite cần truyền skill object trực
 * tiếp (vd FE preview, AI moveset compose).
 *
 * Compose pipeline:
 *   1. Base multiplier = `elementMultiplier(skill.element, target)`
 *      (chu kỳ Ngũ Hành sinh-khắc, xem `elemental.ts`).
 *   2. Character affinity bonus:
 *      - `+ELEMENT_CHARACTER_PRIMARY_BONUS` (0.10) nếu skill cùng hệ
 *        primaryElement của character.
 *      - `+ELEMENT_CHARACTER_SECONDARY_BONUS` (0.05) nếu skill có trong
 *        secondaryElements.
 *      - 0 nếu trái hệ (không phạt thêm — mục tiêu Phase 14.2.C scope B).
 *
 * Pure function — KHÔNG đụng monster resist / equipment bonus
 * (defer Phase 14.2.A `applyElementalCombatAdjustment` foundation layer).
 *
 * @param character `null` = legacy character chưa khai linh căn → bypass
 *   bonus, return base multiplier.
 * @param skill SkillDef — `skill.element` `null` (vô hệ) → return 1.0.
 * @param target ElementKey của target (monster element). `null` = vô hệ
 *   target → base multiplier 1.0 (no relation).
 */
export function computeSkillElementBonus(
  character:
    | { primaryElement: ElementKey; secondaryElements: readonly ElementKey[] }
    | null,
  skill: Pick<SkillDef, 'element'>,
  target: ElementKey | null,
): number {
  return characterSkillElementBonus(character, skill.element ?? null, target);
}

/**
 * Phase 14.2.C — Convenience: compute bonus thuần (không base multiplier),
 * dùng cho UI tooltip "với linh căn của bạn, skill này +X% sát thương cùng
 * hệ".
 */
export function computeSkillAffinityDelta(
  character:
    | { primaryElement: ElementKey; secondaryElements: readonly ElementKey[] }
    | null,
  skill: Pick<SkillDef, 'element'>,
): number {
  if (character === null || skill.element == null) return 0;
  if (skill.element === character.primaryElement) {
    return ELEMENT_CHARACTER_PRIMARY_BONUS;
  }
  if (character.secondaryElements.includes(skill.element)) {
    return ELEMENT_CHARACTER_SECONDARY_BONUS;
  }
  return 0;
}

// ---------------------------------------------------------------------------
// Tag helpers
// ---------------------------------------------------------------------------

/**
 * Filter SKILLS theo tag. Match nếu skill có tag trong `tags[]` —
 * legacy skill không khai báo `tags` → không match.
 */
export function skillsForTag(tag: SkillTag): SkillDef[] {
  return SKILLS.filter((s) => (s.tags ?? []).includes(tag));
}

/**
 * Validate 1 SkillDef — throw nếu khai báo tag invalid.
 *
 * Rules (Phase 14.2.C):
 *   - `tags` (nếu có) phải là subset của `SKILL_TAGS`.
 *   - Tag `DOT` / `SHIELD` / `CONTROL` chỉ áp lên skill có element non-null
 *     (gắn với Ngũ Hành identity).
 *   - PASSIVE skill không được mang tag `BURST` / `DOT` / `SHIELD` / `CONTROL`
 *     (passive không cast trực tiếp — không có lượt apply).
 */
export function validateSkillTag(skill: SkillDef): void {
  const tags = skill.tags ?? [];
  for (const t of tags) {
    if (!(SKILL_TAGS as readonly string[]).includes(t)) {
      throw new Error(`skill ${skill.key} có tag invalid '${t}'`);
    }
  }
  const requireElement: readonly SkillTag[] = ['DOT', 'SHIELD', 'CONTROL'];
  if (
    tags.some((t) => requireElement.includes(t)) &&
    skill.element == null
  ) {
    throw new Error(
      `skill ${skill.key} có tag DOT/SHIELD/CONTROL nhưng element=null (phải gắn Ngũ Hành)`,
    );
  }
  if ((skill.type ?? 'ACTIVE') === 'PASSIVE') {
    const activeOnly: readonly SkillTag[] = ['BURST', 'DOT', 'SHIELD', 'CONTROL'];
    const violating = tags.filter((t) => activeOnly.includes(t));
    if (violating.length > 0) {
      throw new Error(
        `skill PASSIVE ${skill.key} không được mang tag ${violating.join(',')} (chỉ ACTIVE mới dispatch side-effect)`,
      );
    }
  }
}

/**
 * Phase 14.2.C — coverage check: mỗi element identity primaryTag phải có
 * ≥ 1 skill thuộc hệ đó cover. Trả về list missing pair `(element, tag)`.
 * Empty array = coverage đầy đủ.
 */
export function findElementIdentityCoverageGaps(): Array<{
  element: ElementKey;
  missingTag: SkillTag;
}> {
  const gaps: Array<{ element: ElementKey; missingTag: SkillTag }> = [];
  for (const id of SKILL_ELEMENT_IDENTITY) {
    const elementSkills = SKILLS.filter((s) => s.element === id.element);
    for (const tag of id.primaryTags) {
      const has = elementSkills.some((s) => (s.tags ?? []).includes(tag));
      if (!has) {
        gaps.push({ element: id.element, missingTag: tag });
      }
    }
  }
  return gaps;
}

// ---------------------------------------------------------------------------
// Re-exports for convenience
// ---------------------------------------------------------------------------

export { ELEMENTS, SKILL_TAGS, elementMultiplier };
export type { ElementKey, SkillTag };
