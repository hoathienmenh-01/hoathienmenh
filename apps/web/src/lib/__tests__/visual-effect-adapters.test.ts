/**
 * Phase 42.0 — Visual effect adapter pure function tests.
 */
import { describe, expect, it } from 'vitest';
import {
  mapBossEventToWarning,
  mapBreakthroughResultToBanner,
  mapCombatDamageToVisualEvent,
  mapCraftResultToEffect,
  mapDropToRareDropPopup,
  mapItemToAuraProps,
} from '../visual-effect-adapters';

describe('mapCombatDamageToVisualEvent', () => {
  it('miss → MISS effect', () => {
    const r = mapCombatDamageToVisualEvent({ isMiss: true });
    expect(r.effect.key).toBe('MISS');
  });
  it('crit → CRIT effect', () => {
    const r = mapCombatDamageToVisualEvent({ amount: 99, isCrit: true });
    expect(r.effect.key).toBe('CRIT');
    expect(r.amount).toBe(99);
  });
  it('heal>0 → HEAL_MEDIUM effect', () => {
    const r = mapCombatDamageToVisualEvent({ heal: 250 });
    expect(r.effect.key).toBe('HEAL_MEDIUM');
  });
  it('normal damage → DAMAGE_* effect', () => {
    const r = mapCombatDamageToVisualEvent({ amount: 50 });
    expect(r.effect.key).toMatch(/^DAMAGE_/);
  });
  it('element HOA maps to FIRE', () => {
    const r = mapCombatDamageToVisualEvent({ amount: 50, element: 'HOA' });
    expect(['FIRE']).toContain(r.effect.element);
  });
});

describe('mapDropToRareDropPopup', () => {
  it('LEGENDARY rarity returns popup', () => {
    const r = mapDropToRareDropPopup({ itemName: 'X', rarity: 'LEGENDARY' });
    expect(r).not.toBeNull();
    expect(r!.rarity).toBe('LEGENDARY');
  });
  it('invalid rarity returns null', () => {
    const r = mapDropToRareDropPopup({ itemName: 'X', rarity: 'NOT_REAL' });
    expect(r).toBeNull();
  });
  it('THAN quality alias → LEGENDARY', () => {
    const r = mapDropToRareDropPopup({ itemName: 'X', rarity: 'THAN' });
    expect(r!.rarity).toBe('LEGENDARY');
  });
});

describe('mapItemToAuraProps', () => {
  it('tier 10 MYTHIC → immortal aura class', () => {
    const r = mapItemToAuraProps({ tier: 10, rarity: 'MYTHIC' });
    expect(r.effectKey).toBe('ITEM_AURA_IMMORTAL');
    expect(r.cssClass).toBe('ve-aura-immortal');
  });
  it('tier 1 COMMON → none', () => {
    const r = mapItemToAuraProps({ tier: 1, rarity: 'COMMON' });
    expect(r.effectKey).toBe('ITEM_AURA_NONE');
    expect(r.cssClass).toBe('ve-aura-none');
  });
});

describe('mapBossEventToWarning', () => {
  it('BOSS_ENRAGE → DANGER severity', () => {
    const r = mapBossEventToWarning({ bossName: 'X', warningType: 'BOSS_ENRAGE' });
    expect(r!.severity).toBe('DANGER');
  });
  it('invalid warningType → null', () => {
    const r = mapBossEventToWarning({ bossName: 'X', warningType: 'NOT_REAL' });
    expect(r).toBeNull();
  });
});

describe('mapBreakthroughResultToBanner', () => {
  it('success cultivation → REALM_BREAKTHROUGH', () => {
    const r = mapBreakthroughResultToBanner({
      success: true,
      breakthroughType: 'CULTIVATION',
    });
    expect(r.effectKey).toBe('REALM_BREAKTHROUGH');
    expect(r.success).toBe(true);
  });
  it('fail cultivation → REALM_BREAKTHROUGH_FAILED', () => {
    const r = mapBreakthroughResultToBanner({
      success: false,
      breakthroughType: 'CULTIVATION',
    });
    expect(r.effectKey).toBe('REALM_BREAKTHROUGH_FAILED');
  });
  it('body cultivation success → BODY_BREAKTHROUGH', () => {
    const r = mapBreakthroughResultToBanner({
      success: true,
      breakthroughType: 'BODY_CULTIVATION',
    });
    expect(r.effectKey).toBe('BODY_BREAKTHROUGH');
  });
});

describe('mapCraftResultToEffect', () => {
  it('ALCHEMY_HIGH_QUALITY returns mapped effect', () => {
    const r = mapCraftResultToEffect({ resultType: 'ALCHEMY_HIGH_QUALITY' });
    expect(r!.effectKey).toBe('ALCHEMY_HIGH_QUALITY');
  });
  it('invalid type returns null', () => {
    const r = mapCraftResultToEffect({ resultType: 'NOT_REAL' });
    expect(r).toBeNull();
  });
});
