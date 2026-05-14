/**
 * Phase 35.0 — Pet catalog + box + source shared tests.
 * Pure deterministic — không I/O, không Prisma.
 */
import { describe, expect, it } from 'vitest';
import {
  PETS,
  PET_TYPES,
  PET_ELEMENTS,
  PET_RARITIES,
  PET_QUALITIES,
  PET_ROLES,
  PET_SOURCE_TAGS,
  PET_COMBAT_CONTEXTS,
  PET_SKILLS,
  PET_PVE_CAP_PERCENT,
  PET_PVP_DAMAGE_CAP_PERCENT,
  PET_PVP_EFFECT_MULTIPLIER,
  PET_SKILL_DROP_BONUS_CAP_PERCENT,
  PET_SKILL_CULTIVATION_BONUS_CAP_PERCENT,
  petByKey,
  petSkillByKey,
  petStarUpShardCost,
  petBreakthroughCost,
  petExpForItem,
  petExpRequiredForLevel,
  petCumulativeExpForLevel,
  computePetSnapshot,
  validatePetCustomName,
  auditPetCatalog,
  petSkillUpgradeCost,
} from './pets';
import {
  PET_BOXES,
  PET_BOX_COST_TYPES,
  petBoxByKey,
  auditPetBoxes,
  rollRarity,
  rollEntry,
  applyPity,
  advanceCounters,
  compareRarity,
  type PetPityCounters,
} from './pet-boxes';
import { PET_SOURCES, sourcesForPet, sourcesForMaterial, auditPetSources } from './pet-sources';

describe('Phase 35 — pet catalog', () => {
  it('has at least 30 pets', () => {
    expect(PETS.length).toBeGreaterThanOrEqual(30);
  });

  it('petKey unique across catalog', () => {
    const keys = PETS.map((p) => p.petKey);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('every type/element/rarity/quality/role/sourceTag valid', () => {
    for (const p of PETS) {
      expect(PET_TYPES).toContain(p.type);
      expect(PET_ELEMENTS).toContain(p.element);
      expect(PET_RARITIES).toContain(p.rarity);
      expect(PET_QUALITIES).toContain(p.quality);
      expect(PET_ROLES).toContain(p.role);
      for (const t of p.sourceTags) expect(PET_SOURCE_TAGS).toContain(t);
    }
  });

  it('every skill ref resolves', () => {
    for (const p of PETS) {
      for (const sk of p.skillKeys) {
        expect(petSkillByKey(sk), `pet ${p.petKey} skill ${sk}`).toBeTruthy();
      }
    }
  });

  it('every pet has ≥1 sourceTag', () => {
    for (const p of PETS) expect(p.sourceTags.length).toBeGreaterThanOrEqual(1);
  });

  it('every Ngũ Hành base element appears in ≥3 pets', () => {
    const baseElems = ['KIM', 'MOC', 'THUY', 'HOA', 'THO'] as const;
    for (const el of baseElems) {
      const ct = PETS.filter((p) => p.element === el).length;
      expect(ct, `element ${el}`).toBeGreaterThanOrEqual(3);
    }
  });

  it('utility pet ≥5 and linh thú combat-support ≥10', () => {
    const utility = PETS.filter((p) => p.type === 'PET' || p.role === 'UTILITY' || p.role === 'EXPLORATION');
    const combat = PETS.filter((p) => p.type === 'LINH_THU');
    expect(utility.length).toBeGreaterThanOrEqual(5);
    expect(combat.length).toBeGreaterThanOrEqual(10);
  });

  it('audit catalog returns no issues', () => {
    expect(auditPetCatalog()).toEqual([]);
  });
});

describe('Phase 35 — pet validators', () => {
  it('custom name: rejects empty/too long/control chars', () => {
    expect(validatePetCustomName('').ok).toBe(false);
    expect(validatePetCustomName('   ').ok).toBe(false);
    expect(validatePetCustomName('A'.repeat(40)).ok).toBe(false);
    expect(validatePetCustomName('Tiểu Hồ\u0007').ok).toBe(false);
    expect(validatePetCustomName('Tiểu Hồ').ok).toBe(true);
    expect(validatePetCustomName('Phoenix-01').ok).toBe(true);
  });

  it('star-up cost monotonic non-decreasing', () => {
    const c2 = petStarUpShardCost(2);
    const c3 = petStarUpShardCost(3);
    const c6 = petStarUpShardCost(6);
    expect(c2).toBeGreaterThan(0);
    expect(c3).toBeGreaterThan(c2);
    expect(c6).toBeGreaterThan(c3);
  });

  it('breakthrough cost defined for level 20/40/60/80/100', () => {
    for (const lvl of [20, 40, 60, 80, 100]) {
      const cost = petBreakthroughCost(lvl);
      expect(cost, `lvl ${lvl}`).toBeTruthy();
      expect(cost!.materials.length).toBeGreaterThan(0);
      expect(cost!.linhThachCost).toBeGreaterThan(0);
    }
    expect(petBreakthroughCost(25)).toBeUndefined();
  });

  it('pet exp items deterministic', () => {
    expect(petExpForItem('pet_mat_linh_thao', 3)).toBe(150);
    expect(petExpForItem('pet_mat_thu_linh_dan', 2)).toBe(2000);
    expect(petExpForItem('unknown', 1)).toBe(0);
  });

  it('exp required + cumulative deterministic', () => {
    expect(petExpRequiredForLevel(1)).toBe(100);
    expect(petCumulativeExpForLevel(1)).toBe(0);
    expect(petCumulativeExpForLevel(3)).toBe(petExpRequiredForLevel(1) + petExpRequiredForLevel(2));
  });

  it('skill upgrade cost grows quadratically', () => {
    const c1 = petSkillUpgradeCost(1);
    const c2 = petSkillUpgradeCost(2);
    expect(c1.materials[0].qty).toBeLessThan(c2.materials[0].qty);
  });
});

describe('Phase 35 — pet snapshot clamp', () => {
  const p = petByKey('pet_kim_lang')!;
  it('PvE snapshot — damage contribution cap = PET_PVE_CAP_PERCENT', () => {
    const snap = computePetSnapshot(p, {
      petKey: p.petKey,
      level: 40,
      star: 4,
      evolutionStage: 1,
      skillLevels: {},
      context: 'PVE',
    });
    expect(snap.damageContributionCapPercent).toBe(PET_PVE_CAP_PERCENT);
  });

  it('PvP snapshot — damage contribution cap = PET_PVP_DAMAGE_CAP_PERCENT', () => {
    const snap = computePetSnapshot(p, {
      petKey: p.petKey,
      level: 60,
      star: 5,
      evolutionStage: 2,
      skillLevels: { pet_skill_battle_roar: 5 },
      context: 'PVP',
    });
    expect(snap.damageContributionCapPercent).toBe(PET_PVP_DAMAGE_CAP_PERCENT);
    const dmg = snap.skills.find((s) => s.skillKey === 'pet_skill_battle_roar');
    expect(dmg?.effectClampedPct).toBeLessThanOrEqual(PET_PVP_DAMAGE_CAP_PERCENT);
  });

  it('Boss snapshot — cap separate from PvE/PvP', () => {
    const snap = computePetSnapshot(p, {
      petKey: p.petKey,
      level: 50,
      star: 5,
      evolutionStage: 1,
      skillLevels: {},
      context: 'BOSS',
    });
    expect(snap.damageContributionCapPercent).toBe(8);
  });

  it('PvP multiplier applied (default 0.4) on supreme pet override (0.35)', () => {
    const supreme = petByKey('pet_legend_kirin_supreme')!;
    expect(supreme.pvpEffectivenessMultiplier).toBe(0.35);
    const snap = computePetSnapshot(supreme, {
      petKey: supreme.petKey,
      level: 80,
      star: 5,
      evolutionStage: 1,
      skillLevels: {},
      context: 'PVP',
    });
    expect(snap.pvpEffectivenessMultiplier).toBe(0.35);
    const standard = petByKey('pet_kim_lang')!;
    expect(standard.pvpEffectivenessMultiplier ?? PET_PVP_EFFECT_MULTIPLIER).toBe(PET_PVP_EFFECT_MULTIPLIER);
  });

  it('drop/cultivation skill capped', () => {
    const lapin = petByKey('pet_lapin_qi')!;
    const snap = computePetSnapshot(lapin, {
      petKey: lapin.petKey,
      level: 20,
      star: 6,
      evolutionStage: 0,
      skillLevels: { pet_skill_qi_nurture: 5 },
      context: 'PVE',
    });
    const qi = snap.skills.find((s) => s.skillKey === 'pet_skill_qi_nurture');
    expect(qi?.effectClampedPct).toBeLessThanOrEqual(PET_SKILL_CULTIVATION_BONUS_CAP_PERCENT);
  });

  it('star/level/stage clamp valid', () => {
    const snap = computePetSnapshot(p, {
      petKey: p.petKey,
      level: -10,
      star: 999,
      evolutionStage: -1,
      skillLevels: {},
      context: 'PVE',
    });
    expect(snap.level).toBe(1);
    expect(snap.star).toBeLessThanOrEqual(p.starLimit);
    expect(snap.evolutionStage).toBe(0);
  });

  it('every context maps to a numeric cap', () => {
    for (const ctx of PET_COMBAT_CONTEXTS) {
      const snap = computePetSnapshot(p, {
        petKey: p.petKey,
        level: 1,
        star: 1,
        evolutionStage: 0,
        skillLevels: {},
        context: ctx,
      });
      expect(typeof snap.damageContributionCapPercent).toBe('number');
      expect(snap.damageContributionCapPercent).toBeGreaterThan(0);
    }
  });

  // Phase 44.1 — preview surfaces passive skill info (test #6).
  it('preview snapshot xuất hiện passive skill cùng category trong skills[]', () => {
    // pet_lapin_qi có skill `pet_skill_qi_nurture` (PASSIVE — cultivation
    // bonus) + `pet_skill_scout_step` → snapshot phải expose category cho FE
    // hiển thị icon.
    const lapin = petByKey('pet_lapin_qi')!;
    const snap = computePetSnapshot(lapin, {
      petKey: lapin.petKey,
      level: 10,
      star: 1,
      evolutionStage: 0,
      skillLevels: { pet_skill_qi_nurture: 1 },
      context: 'PVE',
    });
    expect(snap.skills.length).toBeGreaterThanOrEqual(1);
    const qi = snap.skills.find((s) => s.skillKey === 'pet_skill_qi_nurture');
    expect(qi).toBeDefined();
    expect(qi?.category).toBe('PASSIVE');
    expect(qi?.effectClampedPct).toBeGreaterThan(0);
    // Snapshot phải có stats để preview render.
    expect(snap.stats.hp).toBeGreaterThan(0);
    expect(snap.stats.atk).toBeGreaterThan(0);
  });
});

describe('Phase 35 — pet boxes', () => {
  it('has at least 4 boxes', () => {
    expect(PET_BOXES.length).toBeGreaterThanOrEqual(4);
  });

  it('every box rate sum = 100', () => {
    for (const b of PET_BOXES) {
      const sum = b.rarityRates.reduce((a, r) => a + r.ratePercent, 0);
      expect(Math.abs(sum - 100), `box ${b.boxKey}`).toBeLessThan(1e-6);
    }
  });

  it('every box has pity ≤ 300 opens', () => {
    for (const b of PET_BOXES) {
      for (const p of b.pityRules) {
        expect(p.triggerEveryOpens, `box ${b.boxKey}`).toBeLessThanOrEqual(300);
      }
    }
  });

  it('every box cost type is recognized', () => {
    for (const b of PET_BOXES) {
      expect(PET_BOX_COST_TYPES).toContain(b.costPerOpen.costType);
      expect(b.costPerOpen.amount).toBeGreaterThan(0);
    }
  });

  it('audit boxes returns no issues', () => {
    expect(auditPetBoxes()).toEqual([]);
  });

  it('rollRarity deterministic from u', () => {
    const b = petBoxByKey('pet_box_standard')!;
    expect(rollRarity(b.rarityRates, 0)).toBe('COMMON');
    expect(rollRarity(b.rarityRates, 0.54)).toBe('COMMON');
    expect(rollRarity(b.rarityRates, 0.56)).toBe('UNCOMMON');
    expect(rollRarity(b.rarityRates, 0.95)).toBe('RARE');
    expect(rollRarity(b.rarityRates, 0.999999)).toBe('MYTHIC');
  });

  it('rollEntry deterministic per bucket', () => {
    const b = petBoxByKey('pet_box_standard')!;
    const bucket = b.pool.filter((p) => p.rarity === 'COMMON');
    const first = rollEntry(bucket, 0);
    const last = rollEntry(bucket, 0.999999);
    expect(first).toBeTruthy();
    expect(last).toBeTruthy();
  });

  it('applyPity upgrades to LEGENDARY when 100 opens since legendary', () => {
    const b = petBoxByKey('pet_box_standard')!;
    const counters: PetPityCounters = {
      opensSinceRare: 0,
      opensSinceEpic: 0,
      opensSinceLegendary: 100,
      opensSinceMythic: 100,
    };
    const r = applyPity(b.pityRules, 'COMMON', counters);
    expect(r.pityTriggered).toBe(true);
    expect(r.appliedRarity).toBe('LEGENDARY');
  });

  it('applyPity respects highest rule when multiple triggered', () => {
    const b = petBoxByKey('pet_box_standard')!;
    const counters: PetPityCounters = {
      opensSinceRare: 50,
      opensSinceEpic: 50,
      opensSinceLegendary: 0,
      opensSinceMythic: 0,
    };
    const r = applyPity(b.pityRules, 'COMMON', counters);
    expect(r.appliedRarity).toBe('EPIC');
    expect(r.pityTriggered).toBe(true);
  });

  it('advanceCounters resets matching rarity counters', () => {
    const c: PetPityCounters = {
      opensSinceRare: 9,
      opensSinceEpic: 49,
      opensSinceLegendary: 99,
      opensSinceMythic: 299,
    };
    const next = advanceCounters(c, 'EPIC');
    expect(next.opensSinceRare).toBe(0);
    expect(next.opensSinceEpic).toBe(0);
    expect(next.opensSinceLegendary).toBe(100);
    expect(next.opensSinceMythic).toBe(300);
  });

  it('advanceCounters increments all if COMMON', () => {
    const c: PetPityCounters = {
      opensSinceRare: 5,
      opensSinceEpic: 25,
      opensSinceLegendary: 60,
      opensSinceMythic: 150,
    };
    const next = advanceCounters(c, 'COMMON');
    expect(next.opensSinceRare).toBe(6);
    expect(next.opensSinceEpic).toBe(26);
    expect(next.opensSinceLegendary).toBe(61);
    expect(next.opensSinceMythic).toBe(151);
  });

  it('compareRarity ordered correctly', () => {
    expect(compareRarity('COMMON', 'MYTHIC')).toBeLessThan(0);
    expect(compareRarity('LEGENDARY', 'EPIC')).toBeGreaterThan(0);
    expect(compareRarity('RARE', 'RARE')).toBe(0);
  });
});

describe('Phase 35 — pet sources', () => {
  it('has source entries', () => {
    expect(PET_SOURCES.length).toBeGreaterThanOrEqual(10);
  });

  it('every pet has at least one source entry', () => {
    for (const p of PETS) {
      const srcs = sourcesForPet(p.petKey);
      expect(srcs.length, `pet ${p.petKey}`).toBeGreaterThanOrEqual(1);
    }
  });

  it('every non-premium pet has free path source', () => {
    const issues = auditPetSources();
    const blockers = issues.filter((i) => i.code === 'PET_NO_FREE_PATH');
    expect(blockers).toEqual([]);
  });

  it('source refs valid', () => {
    const issues = auditPetSources();
    expect(issues.filter((i) => i.code === 'INVALID_SOURCE_REF')).toEqual([]);
  });

  it('material source lookup', () => {
    const srcs = sourcesForMaterial('pet_mat_thu_hon_thach');
    expect(srcs.length).toBeGreaterThanOrEqual(1);
  });

  // Phase 44.1 — rare drop policy.
  it('LEGENDARY+ pets không có source `FREE`/`ACHIEVEMENT` (rare pet policy)', () => {
    const issues = auditPetSources();
    const easy = issues.filter((i) => i.code === 'PET_RARE_HAS_EASY_PATH');
    expect(easy, JSON.stringify(easy)).toEqual([]);
  });

  it('LEGENDARY+ pets có estDropRatePct ≤ cap (rare pet drop policy)', () => {
    const issues = auditPetSources();
    const tooHigh = issues.filter(
      (i) => i.code === 'PET_RARE_DROP_RATE_TOO_HIGH',
    );
    expect(tooHigh, JSON.stringify(tooHigh)).toEqual([]);
  });
});

describe('Phase 35 — pet skill catalog', () => {
  it('all skills have a category and maxLevel ≥1', () => {
    for (const s of PET_SKILLS) {
      expect(['PASSIVE', 'ACTIVE', 'SUPPORT', 'EXPLORATION']).toContain(s.category);
      expect(s.maxLevel).toBeGreaterThanOrEqual(1);
    }
  });

  it('drop bonus skill drop ≤ catalog cap × maxLevel ≤ effective cap', () => {
    for (const s of PET_SKILLS) {
      if (s.effects?.dropBonusPct !== undefined) {
        // base value is small (1-2%); cap kicks in at runtime
        expect(s.effects.dropBonusPct).toBeLessThanOrEqual(PET_SKILL_DROP_BONUS_CAP_PERCENT);
      }
    }
  });
});
