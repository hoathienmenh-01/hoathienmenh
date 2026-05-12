import type { BossDef } from './boss';
import { type DungeonDef, type ElementKey } from './combat';
import {
  computeElementDamageModifier,
  computeElementResistanceModifier,
  getCounteredByElement,
} from './elemental';
import { getBossElementProfile, getDungeonElementProfile } from './elemental-identity';

export interface ElementalResistanceProfile {
  primaryElement: ElementKey | null;
  weaknessElement: ElementKey | null;
  resistanceElement: ElementKey | null;
  immunityElement: ElementKey | null;
  damageModifier: number;
  resistanceModifier: number;
  warning: string | null;
}

export function getBossElementalResistanceProfile(
  boss: Readonly<BossDef>,
  attackerElement: ElementKey | null,
): ElementalResistanceProfile {
  const profile = getBossElementProfile(boss);
  const resistanceElement =
    profile.resistElements[0] ?? (profile.element ? profile.element : null);
  const damageModifier = computeElementDamageModifier(attackerElement, profile.element);
  const resistanceModifier = attackerElement
    ? computeElementResistanceModifier(profile.element, attackerElement)
    : 1;
  const resisted =
    attackerElement && profile.resistElements.includes(attackerElement);
  return {
    primaryElement: profile.element,
    weaknessElement:
      profile.weaknessElement ??
      (profile.element ? getCounteredByElement(profile.element) : null),
    resistanceElement,
    immunityElement: null,
    damageModifier,
    resistanceModifier,
    warning: resisted ? 'Attacker element is resisted by this boss.' : null,
  };
}

export function getDungeonElementalResistanceProfile(
  dungeon: Readonly<DungeonDef>,
  attackerElement: ElementKey | null,
): ElementalResistanceProfile {
  const profile = getDungeonElementProfile(dungeon);
  const primaryElement = profile.dominantElement;
  const weaknessElement =
    profile.recommendedCounterElement ??
    (primaryElement ? getCounteredByElement(primaryElement) : null);
  const resistanceElement = primaryElement;
  return {
    primaryElement,
    weaknessElement,
    resistanceElement,
    immunityElement: null,
    damageModifier: computeElementDamageModifier(attackerElement, primaryElement),
    resistanceModifier: attackerElement
      ? computeElementResistanceModifier(primaryElement, attackerElement)
      : 1,
    warning:
      attackerElement && primaryElement && attackerElement === primaryElement
        ? 'Same-element dungeon dampens damage; consider counter element.'
        : null,
  };
}

export function applyElementalResistanceToDamage(
  baseDamage: number,
  profile: Pick<ElementalResistanceProfile, 'damageModifier' | 'resistanceModifier'>,
): number {
  if (!Number.isFinite(baseDamage) || baseDamage <= 0) return 0;
  const multiplier = Math.max(
    0.5,
    Math.min(1.6, profile.damageModifier * profile.resistanceModifier),
  );
  return Math.max(1, Math.floor(baseDamage * multiplier));
}
