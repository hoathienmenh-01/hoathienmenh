import { describe, expect, it } from 'vitest';
import {
  applyElementalResistanceToDamage,
  classifyElementMatchup,
  computeElementDamageModifier,
  computeElementResistanceModifier,
  ELEMENTAL_SKILL_SYNERGY_RULES,
  getBossElementalResistanceProfile,
  getCounteredByElement,
  getCounterElement,
  getElementalSkillSynergyRule,
  getEquipmentElement,
  getGeneratedByElement,
  getGeneratingElement,
  recommendBuildForCharacter,
  suggestCounterForBoss,
  suggestElementalSkillPath,
  validateElementalSkillSynergyRules,
  type ElementKey,
} from './index';
import { BOSSES } from './boss';

describe('Phase 22.1 five-elements relationship helpers', () => {
  it('maps generating and counter cycles deterministically', () => {
    expect(getGeneratingElement('moc')).toBe('hoa');
    expect(getGeneratingElement('hoa')).toBe('tho');
    expect(getGeneratingElement('tho')).toBe('kim');
    expect(getGeneratingElement('kim')).toBe('thuy');
    expect(getGeneratingElement('thuy')).toBe('moc');

    expect(getCounterElement('moc')).toBe('tho');
    expect(getCounterElement('tho')).toBe('thuy');
    expect(getCounterElement('thuy')).toBe('hoa');
    expect(getCounterElement('hoa')).toBe('kim');
    expect(getCounterElement('kim')).toBe('moc');
  });

  it('finds reverse generated-by and countered-by elements', () => {
    expect(getGeneratedByElement('hoa')).toBe('moc');
    expect(getCounteredByElement('hoa')).toBe('thuy');
  });

  it('computes bounded damage and resistance modifiers', () => {
    expect(computeElementDamageModifier('kim', 'moc')).toBeGreaterThan(1);
    expect(computeElementDamageModifier('moc', 'kim')).toBeLessThan(1);
    expect(computeElementResistanceModifier('moc', 'kim')).toBeGreaterThan(1);
    for (const attacker of ['kim', 'moc', 'thuy', 'hoa', 'tho'] as ElementKey[]) {
      for (const defender of ['kim', 'moc', 'thuy', 'hoa', 'tho'] as ElementKey[]) {
        const value = computeElementDamageModifier(attacker, defender);
        expect(value).toBeGreaterThanOrEqual(0.7);
        expect(value).toBeLessThanOrEqual(1.3);
      }
    }
  });

  it('classifies advantage and disadvantage without absurd values', () => {
    const advantage = classifyElementMatchup('thuy', 'hoa');
    expect(advantage.relationship).toBe('counter');
    expect(advantage.isAdvantage).toBe(true);
    expect(advantage.isDisadvantage).toBe(false);

    const disadvantage = classifyElementMatchup('hoa', 'thuy');
    expect(disadvantage.relationship).toBe('countered');
    expect(disadvantage.isAdvantage).toBe(false);
    expect(disadvantage.isDisadvantage).toBe(true);
  });
});

describe('Phase 22.1 build recommendation helpers', () => {
  it('returns valid build guidance for a primary + secondary root', () => {
    const result = recommendBuildForCharacter({
      primaryElement: 'thuy',
      secondaryElements: ['moc'],
      spiritualRootGrade: 'huyen',
    });
    expect(result.mainElement).toBe('thuy');
    expect(result.secondaryElement).toBe('moc');
    expect(result.recommendedSkills.length).toBeGreaterThan(0);
    expect(result.recommendedStats).toContain('control');
    expect(result.skillPath.some((path) => path.element === 'moc')).toBe(true);
  });

  it('suggests boss counter and warning when player is disadvantaged', () => {
    const tips = suggestCounterForBoss(
      { primaryElement: 'hoa', resistElements: ['kim'] },
      { primaryElement: 'kim' },
    );
    expect(tips.join(' ')).toContain('thuy');
    expect(tips.join(' ')).toContain('Warning');
  });

  it('suggests skill paths with real catalog skill keys', () => {
    const paths = suggestElementalSkillPath('moc', 'hoa');
    expect(paths[0]?.skillKeys.length).toBeGreaterThan(0);
    expect(paths.map((path) => path.element)).toContain('hoa');
  });
});

describe('Phase 22.1 skill synergy and resistance', () => {
  it('has no duplicate skill synergy keys and keeps bonuses modest', () => {
    expect(validateElementalSkillSynergyRules()).toEqual([]);
    expect(new Set(ELEMENTAL_SKILL_SYNERGY_RULES.map((r) => r.key)).size).toBe(
      ELEMENTAL_SKILL_SYNERGY_RULES.length,
    );
  });

  it('implements requested generating combo examples', () => {
    expect(getElementalSkillSynergyRule('thuy', 'moc').kind).toBe('generating');
    expect(getElementalSkillSynergyRule('moc', 'hoa').descriptionVi).toContain('Mộc sinh Hỏa');
    expect(getElementalSkillSynergyRule('hoa', 'tho').bonusMultiplier).toBeGreaterThan(1);
    expect(getElementalSkillSynergyRule('tho', 'kim').recommendedTags).toContain('CRIT');
    expect(getElementalSkillSynergyRule('kim', 'thuy').recommendedTags).toContain('CONTROL');
  });

  it('applies boss weakness/resistance profile without auto-win damage', () => {
    const boss = BOSSES.find((b) => b.element === 'tho')!;
    const profile = getBossElementalResistanceProfile(boss, 'moc');
    expect(profile.primaryElement).toBe('tho');
    expect(profile.weaknessElement).toBe('moc');
    const damage = applyElementalResistanceToDamage(1000, profile);
    expect(damage).toBeGreaterThan(1000);
    expect(damage).toBeLessThanOrEqual(1600);
  });
});

describe('Phase 22.1 equipment affinity hook', () => {
  it('uses explicit equipmentElement before derived elemental bonus', () => {
    expect(
      getEquipmentElement({
        equipmentElement: 'hoa',
        bonuses: { elementalAtkBonus: { kim: 0.1 } },
      }),
    ).toBe('hoa');
  });

  it('derives equipment element from strongest elemental bonus when hook absent', () => {
    expect(
      getEquipmentElement({
        bonuses: { elementalAtkBonus: { kim: 0.03, thuy: 0.05 } },
      }),
    ).toBe('thuy');
  });
});
