import { ELEMENTS, type ElementKey, type SkillDef, type SkillTag } from './combat';
import {
  computeElementAdvantage,
  getCounterElement,
  getGeneratedByElement,
  getGeneratingElement,
  type ElementRelationship,
} from './elemental';

export type ElementalSkillSynergyKind =
  | 'same_element'
  | 'generating'
  | 'counter'
  | 'hybrid'
  | 'neutral';

export interface ElementalSkillSynergyRule {
  key: string;
  kind: ElementalSkillSynergyKind;
  fromElement: ElementKey;
  toElement: ElementKey;
  relationship: ElementRelationship;
  bonusMultiplier: number;
  recommendedTags: readonly SkillTag[];
  descriptionVi: string;
  descriptionEn: string;
}

const SAME_ELEMENT_BONUS = 1.05;
const GENERATING_COMBO_BONUS = 1.08;
const COUNTER_COMBO_BONUS = 1.1;
const HYBRID_COMBO_BONUS = 1.04;

const ELEMENT_COMBO_TAGS: Readonly<Record<ElementKey, readonly SkillTag[]>> = {
  kim: ['CRIT', 'BURST'],
  moc: ['HEAL', 'DOT'],
  thuy: ['CONTROL', 'HEAL'],
  hoa: ['BURST', 'DOT'],
  tho: ['SHIELD', 'CONTROL'],
};

const GENERATED_COMBO_COPY: Readonly<Record<ElementKey, { vi: string; en: string }>> = {
  thuy: {
    vi: 'Kim sinh Thủy: tăng ổn định debuff/khống chế sau đòn Kim.',
    en: 'Metal generates Water: steadier debuff/control after Metal setup.',
  },
  moc: {
    vi: 'Thủy sinh Mộc: tăng hồi phục/regen sau khống chế.',
    en: 'Water generates Wood: stronger healing/regen after control.',
  },
  hoa: {
    vi: 'Mộc sinh Hỏa: kéo dài độc/bỏng và bùng nổ sau sustain.',
    en: 'Wood generates Fire: longer poison/burn into burst damage.',
  },
  tho: {
    vi: 'Hỏa sinh Thổ: tạo giáp nóng và phản đòn nhẹ.',
    en: 'Fire generates Earth: hot armor and light reflection.',
  },
  kim: {
    vi: 'Thổ sinh Kim: dựng thế xuyên giáp/chí mạng.',
    en: 'Earth generates Metal: armor-pierce and crit setup.',
  },
};

function ruleKey(kind: ElementalSkillSynergyKind, from: ElementKey, to: ElementKey): string {
  return `${kind}_${from}_${to}`;
}

function buildRule(
  kind: ElementalSkillSynergyKind,
  fromElement: ElementKey,
  toElement: ElementKey,
  relationship: ElementRelationship,
  bonusMultiplier: number,
  recommendedTags: readonly SkillTag[],
  descriptionVi: string,
  descriptionEn: string,
): ElementalSkillSynergyRule {
  return {
    key: ruleKey(kind, fromElement, toElement),
    kind,
    fromElement,
    toElement,
    relationship,
    bonusMultiplier,
    recommendedTags,
    descriptionVi,
    descriptionEn,
  };
}

export const ELEMENTAL_SKILL_SYNERGY_RULES: readonly ElementalSkillSynergyRule[] =
  ELEMENTS.flatMap((fromElement) => {
    const generated = getGeneratingElement(fromElement);
    const countered = getCounterElement(fromElement);
    const generatedBy = getGeneratedByElement(fromElement);
    return [
      buildRule(
        'same_element',
        fromElement,
        fromElement,
        'same',
        SAME_ELEMENT_BONUS,
        ELEMENT_COMBO_TAGS[fromElement],
        'Cùng hệ liên chiêu: tăng hiệu quả nhỏ, dễ dùng và ổn định.',
        'Same-element chain: small, reliable effectiveness bonus.',
      ),
      buildRule(
        'generating',
        fromElement,
        generated,
        'generate',
        GENERATING_COMBO_BONUS,
        ELEMENT_COMBO_TAGS[generated],
        GENERATED_COMBO_COPY[generated].vi,
        GENERATED_COMBO_COPY[generated].en,
      ),
      buildRule(
        'counter',
        fromElement,
        countered,
        'counter',
        COUNTER_COMBO_BONUS,
        ELEMENT_COMBO_TAGS[fromElement],
        'Tương khắc liên chiêu: phá phòng thủ trong tình huống đúng.',
        'Counter chain: situational defense break when matched well.',
      ),
      buildRule(
        'hybrid',
        fromElement,
        generatedBy,
        'generated',
        HYBRID_COMBO_BONUS,
        [...ELEMENT_COMBO_TAGS[fromElement], ...ELEMENT_COMBO_TAGS[generatedBy]],
        'Hybrid nghịch sinh: mở hướng build phụ nhưng bonus thấp hơn.',
        'Reverse-generation hybrid: opens off-build paths with lower bonus.',
      ),
    ];
  });

export function getElementalSkillSynergyRule(
  fromElement: ElementKey,
  toElement: ElementKey,
): ElementalSkillSynergyRule {
  const relationship = computeElementAdvantage(fromElement, toElement);
  const kind: ElementalSkillSynergyKind =
    fromElement === toElement
      ? 'same_element'
      : relationship === 'generate'
        ? 'generating'
        : relationship === 'counter'
          ? 'counter'
          : relationship === 'generated'
            ? 'hybrid'
            : 'neutral';
  if (kind === 'neutral') {
    return buildRule(
      'neutral',
      fromElement,
      toElement,
      relationship,
      1,
      [],
      'Không có liên chiêu Ngũ Hành rõ ràng.',
      'No clear five-elements chain.',
    );
  }
  const key = ruleKey(kind, fromElement, toElement);
  const found = ELEMENTAL_SKILL_SYNERGY_RULES.find((rule) => rule.key === key);
  if (found) return found;
  return buildRule(
    kind,
    fromElement,
    toElement,
    relationship,
    1,
    [],
    'Liên chiêu không có rule catalog.',
    'Combo has no catalog rule.',
  );
}

export function computeElementalSkillSynergy(
  previousSkill: Pick<SkillDef, 'element'> | null | undefined,
  nextSkill: Pick<SkillDef, 'element'> | null | undefined,
): ElementalSkillSynergyRule | null {
  const fromElement = previousSkill?.element ?? null;
  const toElement = nextSkill?.element ?? null;
  if (!fromElement || !toElement) return null;
  return getElementalSkillSynergyRule(fromElement, toElement);
}

export function validateElementalSkillSynergyRules(): readonly string[] {
  const errors: string[] = [];
  const keys = new Set<string>();
  for (const rule of ELEMENTAL_SKILL_SYNERGY_RULES) {
    if (keys.has(rule.key)) errors.push(`duplicate synergy key ${rule.key}`);
    keys.add(rule.key);
    if (rule.bonusMultiplier < 1 || rule.bonusMultiplier > 1.15) {
      errors.push(`synergy ${rule.key} bonus out of range`);
    }
  }
  return errors;
}
