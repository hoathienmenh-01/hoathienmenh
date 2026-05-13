import { describe, it, expect } from 'vitest';
import {
  EFFECT_NONE,
  EFFECT_SAFETY,
  DEFAULT_PLAYER_VISUAL_EFFECT_SETTINGS,
  getAllVisualEffects,
  getAllStatusEffects,
  getBossWarningEffect,
  getEffectByDamageType,
  getEffectByKey,
  getEffectByRarity,
  getEffectOrFallback,
  getElementalEffect,
  getItemAuraEffect,
  getReducedMotionEffect,
  getStatusEffectByKey,
  PLAYER_VISUAL_EFFECT_LIMITS,
  resolveEffectiveMotionLevel,
  validateBossEffectPolicy,
  validateEffectCatalog,
  validateEffectDurationSafe,
  validateEffectHasFallback,
  validateEffectIntensityAllowed,
  validateEffectKeyExists,
  validateItemEffectPolicy,
  validatePlayerVisualEffectSettings,
  validateStatusEffectCatalog,
  VISUAL_EFFECT_ELEMENTS,
  VISUAL_EFFECT_MOTION_LEVELS,
} from './visual-effects';

describe('Phase 42.0 — Visual Effects catalog invariants', () => {
  it('all effect keys are unique', () => {
    const seen = new Set<string>();
    for (const e of getAllVisualEffects()) {
      expect(seen.has(e.key)).toBe(false);
      seen.add(e.key);
    }
  });

  it('every effect has reducedMotionFallback resolving to NONE or another known key', () => {
    for (const e of getAllVisualEffects()) {
      expect(validateEffectHasFallback(e)).toBe(true);
    }
  });

  it('every effect duration is safe (<= MAX_DURATION_MS_HIGH)', () => {
    for (const e of getAllVisualEffects()) {
      expect(validateEffectDurationSafe(e)).toBe(true);
      expect(e.durationMs).toBeLessThanOrEqual(EFFECT_SAFETY.MAX_DURATION_MS_HIGH);
    }
  });

  it('catalog passes validateEffectCatalog with no errors', () => {
    expect(validateEffectCatalog()).toEqual([]);
  });
});

describe('Phase 42.0 — Effect helper lookups', () => {
  it('getEffectByKey returns known effect or null', () => {
    expect(getEffectByKey('DAMAGE_MEDIUM')?.key).toBe('DAMAGE_MEDIUM');
    expect(getEffectByKey('UNKNOWN_KEY')).toBeNull();
  });

  it('getEffectOrFallback returns EFFECT_NONE for unknown key', () => {
    expect(getEffectOrFallback('NOPE')).toBe(EFFECT_NONE);
    expect(validateEffectKeyExists('NOPE')).toBe(false);
    expect(validateEffectKeyExists('NONE')).toBe(true);
  });

  it('getReducedMotionEffect resolves to a less intense effect', () => {
    const crit = getEffectByKey('CRIT')!;
    const fallback = getReducedMotionEffect('CRIT');
    expect(fallback.key).toBe(crit.reducedMotionFallback);
    expect(fallback.intensity).not.toBe('LEGENDARY');
  });
});

describe('Phase 42.0 — Item aura mapping', () => {
  it('tier 1 common returns NONE aura', () => {
    expect(getItemAuraEffect(1, 'COMMON').key).toBe('ITEM_AURA_NONE');
  });
  it('tier 5 uncommon returns at least LOW aura (tier ≥ 5 bumps to MEDIUM)', () => {
    const e = getItemAuraEffect(5, 'UNCOMMON');
    expect(['ITEM_AURA_LOW', 'ITEM_AURA_MEDIUM']).toContain(e.key);
  });
  it('tier 10 legendary returns LEGENDARY aura', () => {
    expect(getItemAuraEffect(10, 'LEGENDARY').key).toBe('ITEM_AURA_LEGENDARY');
  });
  it('mythic rarity always returns IMMORTAL aura regardless of tier', () => {
    expect(getItemAuraEffect(2, 'MYTHIC').key).toBe('ITEM_AURA_IMMORTAL');
    expect(getItemAuraEffect(10, 'MYTHIC').key).toBe('ITEM_AURA_IMMORTAL');
  });
  it('elemental override returns ITEM_AURA_<ELEMENT> variant', () => {
    expect(getItemAuraEffect(7, 'EPIC', 'FIRE').key).toBe('ITEM_AURA_FIRE');
    expect(getItemAuraEffect(3, 'RARE', 'METAL').key).toBe('ITEM_AURA_METAL');
  });
});

describe('Phase 42.0 — Damage / rarity / element / boss mapping', () => {
  it('getEffectByDamageType returns specific effect per type', () => {
    expect(getEffectByDamageType('crit').key).toBe('CRIT');
    expect(getEffectByDamageType('miss').key).toBe('MISS');
    expect(getEffectByDamageType('block').key).toBe('BLOCK');
    expect(getEffectByDamageType('shield').key).toBe('SHIELD');
    expect(getEffectByDamageType('dot').key).toBe('DOT');
    expect(getEffectByDamageType('lifesteal').key).toBe('LIFESTEAL');
    expect(getEffectByDamageType('counter').key).toBe('COUNTER');
  });

  it('getEffectByDamageType normal + element returns DAMAGE_<ELEMENT>', () => {
    expect(getEffectByDamageType('normal', 'FIRE').key).toBe('DAMAGE_FIRE');
    expect(getEffectByDamageType('normal', 'WATER').key).toBe('DAMAGE_WATER');
    expect(getEffectByDamageType('normal').key).toBe('DAMAGE_MEDIUM');
  });

  it('getEffectByRarity returns null for COMMON/UNCOMMON and popup effect for RARE+', () => {
    expect(getEffectByRarity('COMMON')).toBeNull();
    expect(getEffectByRarity('UNCOMMON')).toBeNull();
    expect(getEffectByRarity('RARE')?.key).toBe('RARE_DROP_RARE');
    expect(getEffectByRarity('LEGENDARY')?.key).toBe('RARE_DROP_LEGENDARY');
    expect(getEffectByRarity('MYTHIC')?.key).toBe('RARE_DROP_MYTHIC');
  });

  it('getElementalEffect maps action types', () => {
    expect(getElementalEffect('FIRE', 'damage').key).toBe('DAMAGE_FIRE');
    expect(getElementalEffect('NONE', 'heal').key).toBe('HEAL_MEDIUM');
    expect(getElementalEffect('EARTH', 'shield').key).toBe('SHIELD');
    expect(getElementalEffect('METAL', 'crit').key).toBe('CRIT');
  });

  it('getBossWarningEffect returns correct boss effect', () => {
    expect(getBossWarningEffect('BOSS_ENRAGE').key).toBe('BOSS_ENRAGE');
    expect(getBossWarningEffect('BOSS_DEFEATED').key).toBe('BOSS_DEFEATED');
  });
});

describe('Phase 42.0 — Effect policy validators', () => {
  it('validateEffectIntensityAllowed enforces motion level gating', () => {
    const high = getEffectByKey('REALM_BREAKTHROUGH')!;
    expect(validateEffectIntensityAllowed(high, 'HIGH')).toBe(true);
    expect(validateEffectIntensityAllowed(high, 'MEDIUM')).toBe(false);
    expect(validateEffectIntensityAllowed(high, 'LOW')).toBe(false);
    expect(validateEffectIntensityAllowed(high, 'OFF')).toBe(false);
    const noneEffect = getEffectByKey('NONE')!;
    expect(validateEffectIntensityAllowed(noneEffect, 'OFF')).toBe(true);
  });

  it('validateItemEffectPolicy rejects COMMON item with non-NONE aura', () => {
    const auraHigh = getEffectByKey('ITEM_AURA_HIGH')!;
    expect(validateItemEffectPolicy({ rarity: 'COMMON', effect: auraHigh })).toBe(
      'ITEM_EFFECT_TOO_INTENSE_FOR_RARITY',
    );
    const auraNone = getEffectByKey('ITEM_AURA_NONE')!;
    expect(validateItemEffectPolicy({ rarity: 'COMMON', effect: auraNone })).toBeNull();
    const auraLow = getEffectByKey('ITEM_AURA_LOW')!;
    expect(validateItemEffectPolicy({ rarity: 'RARE', effect: auraLow })).toBeNull();
    expect(
      validateItemEffectPolicy({
        rarity: 'RARE',
        effect: getEffectByKey('ITEM_AURA_LEGENDARY')!,
      }),
    ).toBe('ITEM_EFFECT_TOO_INTENSE_FOR_RARITY');
  });

  it('validateBossEffectPolicy rejects non-boss effect types', () => {
    const dmg = getEffectByKey('DAMAGE_LOW')!;
    expect(validateBossEffectPolicy(dmg)).toBe('BOSS_EFFECT_TYPE_MISMATCH');
    const boss = getEffectByKey('BOSS_ENRAGE')!;
    expect(validateBossEffectPolicy(boss)).toBeNull();
  });
});

describe('Phase 42.0 — Status effect catalog', () => {
  it('all status keys unique and all effectKey references exist', () => {
    expect(validateStatusEffectCatalog()).toEqual([]);
  });

  it('getStatusEffectByKey returns def with labels and tooltip i18n strings', () => {
    const burn = getStatusEffectByKey('BURN');
    expect(burn?.labelVi).toBe('Bỏng');
    expect(burn?.labelEn).toBe('Burn');
    expect(burn?.positive).toBe(false);
    expect(getStatusEffectByKey('SHIELD')?.positive).toBe(true);
    expect(getAllStatusEffects().length).toBeGreaterThanOrEqual(20);
  });
});

describe('Phase 42.0 — Player visual-effect settings validation', () => {
  it('accepts visualEffectLevel OFF/LOW/MEDIUM/HIGH and rejects invalid', () => {
    for (const lvl of VISUAL_EFFECT_MOTION_LEVELS) {
      const res = validatePlayerVisualEffectSettings({ visualEffectLevel: lvl });
      expect(res.ok).toBe(true);
      expect(res.sanitized.visualEffectLevel).toBe(lvl);
    }
    const bad = validatePlayerVisualEffectSettings({ visualEffectLevel: 'EXTREME' });
    expect(bad.ok).toBe(false);
    expect(bad.errors[0]).toContain('visualEffectLevel');
  });

  it('coerces booleans + clamps maxFloatingTextsOnScreen', () => {
    const res = validatePlayerVisualEffectSettings({
      enableFloatingCombatText: false,
      enableScreenShake: true,
      maxFloatingTextsOnScreen: 12,
    });
    expect(res.ok).toBe(true);
    expect(res.sanitized.enableFloatingCombatText).toBe(false);
    expect(res.sanitized.enableScreenShake).toBe(true);
    expect(res.sanitized.maxFloatingTextsOnScreen).toBe(12);
  });

  it('rejects out-of-range maxEffectPopupsOnScreen', () => {
    const bad = validatePlayerVisualEffectSettings({
      maxEffectPopupsOnScreen: PLAYER_VISUAL_EFFECT_LIMITS.MAX_POPUPS_HARD_CAP + 100,
    });
    expect(bad.ok).toBe(false);
  });

  it('default settings pass validation roundtrip', () => {
    const res = validatePlayerVisualEffectSettings({
      ...DEFAULT_PLAYER_VISUAL_EFFECT_SETTINGS,
    });
    expect(res.ok).toBe(true);
    expect(res.sanitized.visualEffectLevel).toBe(
      DEFAULT_PLAYER_VISUAL_EFFECT_SETTINGS.visualEffectLevel,
    );
  });
});

describe('Phase 42.0 — Reduced motion override', () => {
  it('reduceMotion=true forces HIGH/MEDIUM down to LOW', () => {
    expect(resolveEffectiveMotionLevel({ reduceMotion: true, visualEffectLevel: 'HIGH' })).toBe(
      'LOW',
    );
    expect(resolveEffectiveMotionLevel({ reduceMotion: true, visualEffectLevel: 'MEDIUM' })).toBe(
      'LOW',
    );
    expect(resolveEffectiveMotionLevel({ reduceMotion: true, visualEffectLevel: 'LOW' })).toBe(
      'LOW',
    );
  });

  it('reduceMotion=true keeps OFF at OFF', () => {
    expect(resolveEffectiveMotionLevel({ reduceMotion: true, visualEffectLevel: 'OFF' })).toBe(
      'OFF',
    );
  });

  it('reduceMotion=false passes through', () => {
    for (const lvl of VISUAL_EFFECT_MOTION_LEVELS) {
      expect(
        resolveEffectiveMotionLevel({ reduceMotion: false, visualEffectLevel: lvl }),
      ).toBe(lvl);
    }
  });
});

describe('Phase 42.0 — Element coverage', () => {
  it('catalog includes a DAMAGE_<ELEMENT> for the five core elements', () => {
    for (const e of ['FIRE', 'WATER', 'WOOD', 'METAL', 'EARTH']) {
      const def = getEffectByKey(`DAMAGE_${e}`);
      expect(def).not.toBeNull();
      expect(def?.element).toBe(e);
    }
  });
  it('VISUAL_EFFECT_ELEMENTS contains NONE + five elements + presentation-only elements', () => {
    expect(VISUAL_EFFECT_ELEMENTS).toContain('NONE');
    expect(VISUAL_EFFECT_ELEMENTS).toContain('FIRE');
    expect(VISUAL_EFFECT_ELEMENTS).toContain('LIGHTNING');
    expect(VISUAL_EFFECT_ELEMENTS).toContain('DARK');
  });
});
