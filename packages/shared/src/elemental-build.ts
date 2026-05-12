import type { BossDef } from './boss';
import {
  ELEMENTS,
  SKILLS,
  type DungeonDef,
  type ElementKey,
  type SkillDef,
  type SkillTag,
} from './combat';
import {
  classifyElementMatchup,
  getCounteredByElement,
  getCounterElement,
  getGeneratedByElement,
  getGeneratingElement,
} from './elemental';
import { getBossElementProfile, getDungeonElementProfile } from './elemental-identity';
import { getSkillElementIdentity } from './elemental-skills';
import type { ItemBonus } from './items';
import type { SpiritualRootGrade } from './spiritual-root';

export interface ElementalBuildCharacterInput {
  primaryElement: ElementKey | null;
  secondaryElements?: readonly ElementKey[];
  spiritualRootGrade?: SpiritualRootGrade | null;
}

export interface ElementalBuildTargetInput {
  key?: string;
  name?: string;
  primaryElement?: ElementKey | null;
  weaknessElement?: ElementKey | null;
  resistanceElement?: ElementKey | null;
  resistElements?: readonly ElementKey[];
  elementalResist?: Partial<Record<ElementKey, number>>;
}

function isBossDef(target: Readonly<BossDef | ElementalBuildTargetInput>): target is Readonly<BossDef> {
  return 'element' in target;
}

export interface ElementalEquipmentInput {
  key?: string;
  name?: string;
  equipmentElement?: ElementKey | null;
  bonuses?: Pick<ItemBonus, 'elementalAtkBonus' | 'elementResist'>;
}

export interface ElementalSkillPathSuggestion {
  element: ElementKey;
  role: string;
  skillKeys: readonly string[];
  priorityTags: readonly SkillTag[];
}

export interface ElementalBuildRecommendation {
  mainElement: ElementKey | null;
  secondaryElement: ElementKey | null;
  recommendedSkills: readonly string[];
  recommendedStats: readonly string[];
  counterTips: readonly string[];
  warnings: readonly string[];
  skillPath: readonly ElementalSkillPathSuggestion[];
  equipmentElement: ElementKey | null;
}

const ELEMENT_RECOMMENDED_STATS: Readonly<Record<ElementKey, readonly string[]>> = {
  kim: ['power', 'speed', 'crit', 'armorPierce'],
  moc: ['spirit', 'hpMax', 'regen', 'sustain'],
  thuy: ['speed', 'mpMax', 'control', 'evasion'],
  hoa: ['power', 'mpMax', 'burn', 'burst'],
  tho: ['hpMax', 'def', 'shield', 'reflect'],
};

function elementRole(element: ElementKey): string {
  return getSkillElementIdentity(element).theme;
}

function uniqueElements(elements: readonly (ElementKey | null | undefined)[]): ElementKey[] {
  const out: ElementKey[] = [];
  for (const element of elements) {
    if (!element) continue;
    if (!out.includes(element)) out.push(element);
  }
  return out;
}

function skillsForElement(element: ElementKey, limit: number): readonly SkillDef[] {
  return SKILLS.filter((skill) => skill.element === element && (skill.type ?? 'ACTIVE') === 'ACTIVE')
    .sort((a, b) => b.atkScale - a.atkScale)
    .slice(0, limit);
}

export function suggestElementalSkillPath(
  mainElement: ElementKey | null,
  secondaryElement?: ElementKey | null,
): readonly ElementalSkillPathSuggestion[] {
  const elements = uniqueElements([
    mainElement,
    secondaryElement,
    mainElement ? getGeneratingElement(mainElement) : null,
    mainElement ? getCounterElement(mainElement) : null,
  ]);
  return elements.map((element) => {
    const identity = getSkillElementIdentity(element);
    return {
      element,
      role: elementRole(element),
      skillKeys: skillsForElement(element, 4).map((skill) => skill.key),
      priorityTags: identity.primaryTags,
    };
  });
}

export function suggestCounterForBoss(
  boss: Readonly<BossDef | ElementalBuildTargetInput>,
  character?: ElementalBuildCharacterInput | null,
): readonly string[] {
  const bossElement = isBossDef(boss) ? boss.element ?? null : boss.primaryElement ?? null;
  const weaknessElement =
    boss.weaknessElement !== undefined
      ? boss.weaknessElement
      : bossElement
        ? getCounteredByElement(bossElement)
        : null;
  const tips: string[] = [];
  if (weaknessElement) {
    tips.push(`Use ${weaknessElement} skills to counter this target.`);
  }
  const resistElements =
    boss.resistElements ??
    (boss.elementalResist
      ? ELEMENTS.filter((element) => {
          const value = boss.elementalResist?.[element];
          return typeof value === 'number' && value < 1;
        })
      : []);
  if (resistElements.length > 0) {
    tips.push(`Avoid resisted elements: ${resistElements.join(', ')}.`);
  }
  if (character?.primaryElement && bossElement) {
    const matchup = classifyElementMatchup(character.primaryElement, bossElement);
    if (matchup.isDisadvantage) {
      tips.push(`Warning: your main element is ${matchup.relationship} here.`);
    }
  }
  return tips;
}

export function suggestEquipmentElement(
  character: ElementalBuildCharacterInput | null,
  target?: ElementalBuildTargetInput | null,
  equipment?: readonly ElementalEquipmentInput[],
): ElementKey | null {
  const targetWeakness = target?.weaknessElement ?? null;
  if (targetWeakness) return targetWeakness;

  const counted = new Map<ElementKey, number>();
  for (const item of equipment ?? []) {
    if (item.equipmentElement) {
      counted.set(item.equipmentElement, (counted.get(item.equipmentElement) ?? 0) + 2);
    }
    const atkBonus = item.bonuses?.elementalAtkBonus;
    if (!atkBonus) continue;
    for (const element of ELEMENTS) {
      const value = atkBonus[element] ?? 0;
      if (value > 0) counted.set(element, (counted.get(element) ?? 0) + value);
    }
  }
  let best: ElementKey | null = null;
  let bestScore = 0;
  for (const element of ELEMENTS) {
    const score = counted.get(element) ?? 0;
    if (score > bestScore) {
      best = element;
      bestScore = score;
    }
  }
  return best ?? character?.primaryElement ?? null;
}

export function recommendBuildForCharacter(
  character: ElementalBuildCharacterInput | null,
  options?: {
    target?: ElementalBuildTargetInput | null;
    boss?: Readonly<BossDef> | null;
    dungeon?: Readonly<DungeonDef> | null;
    equipment?: readonly ElementalEquipmentInput[];
    skillLimit?: number;
  },
): ElementalBuildRecommendation {
  const mainElement = character?.primaryElement ?? null;
  const secondaryElement =
    character?.secondaryElements?.find((element) => element !== mainElement) ??
    (mainElement ? getGeneratingElement(mainElement) : null);

  const bossProfile = options?.boss ? getBossElementProfile(options.boss) : null;
  const dungeonProfile = options?.dungeon
    ? getDungeonElementProfile(options.dungeon)
    : null;
  const targetElement =
    options?.target?.primaryElement ??
    bossProfile?.element ??
    dungeonProfile?.dominantElement ??
    null;
  const weaknessElement =
    options?.target?.weaknessElement ??
    bossProfile?.weaknessElement ??
    dungeonProfile?.recommendedCounterElement ??
    (targetElement ? getCounteredByElement(targetElement) : null);
  const target: ElementalBuildTargetInput | null = targetElement
    ? {
        primaryElement: targetElement,
        weaknessElement,
        resistElements:
          options?.target?.resistElements ?? bossProfile?.resistElements ?? [],
        elementalResist: options?.target?.elementalResist ?? options?.boss?.elementalResist,
      }
    : options?.target ?? null;

  const skillElements = uniqueElements([
    weaknessElement,
    mainElement,
    secondaryElement,
    mainElement ? getGeneratedByElement(mainElement) : null,
  ]);
  const skillLimit = options?.skillLimit ?? 8;
  const recommendedSkills = skillElements
    .flatMap((element) => skillsForElement(element, 3).map((skill) => skill.key))
    .slice(0, skillLimit);
  const recommendedStats = mainElement
    ? ELEMENT_RECOMMENDED_STATS[mainElement]
    : ['power', 'spirit', 'hpMax'];
  const counterTips = target
    ? suggestCounterForBoss(target, character)
    : mainElement
      ? [`Use ${getCounterElement(mainElement)} for a situational counter branch.`]
      : ['Open spiritual root first to unlock elemental build direction.'];

  const warnings: string[] = [];
  if (!mainElement) {
    warnings.push('Character has no primary element yet.');
  }
  if (mainElement && targetElement) {
    const matchup = classifyElementMatchup(mainElement, targetElement);
    if (matchup.isDisadvantage) {
      warnings.push(`Main element ${mainElement} is disadvantaged against ${targetElement}.`);
    }
  }
  if (character?.spiritualRootGrade === 'than' && character.secondaryElements?.length === 4) {
    warnings.push('Full five-element root is flexible but still capped by shared modifiers.');
  }

  return {
    mainElement,
    secondaryElement,
    recommendedSkills,
    recommendedStats,
    counterTips,
    warnings,
    skillPath: suggestElementalSkillPath(mainElement, secondaryElement),
    equipmentElement: suggestEquipmentElement(character, target, options?.equipment),
  };
}
