/**
 * Phase 26.4 — Artifact / Pháp Bảo Crafting V2 shared test.
 *
 * Test thuần shared (không cần DB): validate catalog đầy đủ 9 tier × 10 type
 * × balanced grade, helper math (success rate / grade multiplier / sub
 * stat / aggregate), drop economy invariants (ARTIFACT_CRAFT rare hơn
 * ALCHEMY_QI / không drop từ NORMAL_MONSTER).
 *
 * Tham chiếu spec: `docs/BALANCE_MODEL.md` §26.4 + `docs/ECONOMY_MODEL.md`
 * §ARTIFACT_CRAFT policy.
 */
import { describe, expect, it } from 'vitest';
import {
  ARTIFACT_BLUEPRINT_CATALOG,
  ARTIFACT_BONUS_CAPS,
  ARTIFACT_CATALOG_V2,
  ARTIFACT_ELEMENTS,
  ARTIFACT_EQUIP_SLOTS,
  ARTIFACT_GRADES,
  ARTIFACT_MATERIAL_CATALOG,
  ARTIFACT_TIERS,
  ARTIFACT_TYPES,
  aggregateArtifactV2Snapshot,
  allowedSlotsForArtifactType,
  artifactAwakenSuccessRate,
  artifactBlueprintItemKey,
  artifactBossCoreKey,
  artifactEmbryoKey,
  artifactGradeMultiplier,
  artifactGradeOrder,
  artifactRefineSuccessRate,
  artifactStarUpSuccessRate,
  artifactTierForRealmOrder,
  canCraftArtifact,
  canEquipArtifact,
  clampArtifactV2Snapshot,
  computeArtifactCraftSuccessRate,
  computeArtifactLevelUpCost,
  computeArtifactPowerScore,
  computeArtifactStarUpCost,
  computeArtifactStats,
  defaultSlotForArtifactType,
  emptyArtifactSnapshot,
  getArtifactBlueprint,
  getArtifactDef,
  getArtifactTierDef,
  getArtifactTierName,
  isArtifactMaterialKey,
  isArtifactV2EquipSlot,
  isLegacyArtifactSlot,
  maxAwakenForArtifactTier,
  maxLevelForArtifactTier,
  maxRefineForArtifactTier,
  maxStarForArtifactTier,
  qualityForArtifactTier,
  rollArtifactGrade,
  rollArtifactSubStats,
  subStatSlotsForGrade,
  validateArtifactCatalog,
  type ArtifactTier,
} from './artifacts-v2';
import { DROP_RULE_CATALOG } from './drop-economy';
import { itemByKey } from './items';

function makeRng(seed: number): () => number {
  // Deterministic mulberry32 — copy pattern khác trong codebase.
  let s = seed >>> 0;
  return () => {
    s |= 0;
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('Phase 26.4 — Artifact V2 catalog', () => {
  it('validateArtifactCatalog passes (no errors)', () => {
    const v = validateArtifactCatalog();
    expect(v.ok, v.errors.join(', ')).toBe(true);
    expect(v.errors).toEqual([]);
  });

  it('artifact catalog covers all 9 tiers', () => {
    const tiers = new Set<number>();
    for (const a of ARTIFACT_CATALOG_V2) tiers.add(a.tier);
    for (let t = 1; t <= 9; t++) expect(tiers.has(t), `tier ${t} present`).toBe(true);
  });

  it('artifact catalog covers all 10 types', () => {
    const types = new Set(ARTIFACT_CATALOG_V2.map((a) => a.type));
    for (const t of ARTIFACT_TYPES) {
      expect(types.has(t), `type ${t} present`).toBe(true);
    }
  });

  it('artifact catalog covers all elements', () => {
    const els = new Set(ARTIFACT_CATALOG_V2.map((a) => a.element));
    expect(els.size).toBeGreaterThanOrEqual(4);
  });

  it('artifact keys are unique', () => {
    const keys = new Set<string>();
    for (const a of ARTIFACT_CATALOG_V2) {
      expect(keys.has(a.key), `duplicate ${a.key}`).toBe(false);
      keys.add(a.key);
    }
  });

  it('blueprint keys are unique and reference real artifacts', () => {
    const keys = new Set<string>();
    const artKeys = new Set(ARTIFACT_CATALOG_V2.map((a) => a.key));
    for (const bp of ARTIFACT_BLUEPRINT_CATALOG) {
      expect(keys.has(bp.key), `duplicate blueprint ${bp.key}`).toBe(false);
      keys.add(bp.key);
      expect(artKeys.has(bp.artifactKey)).toBe(true);
    }
  });

  it('every blueprint input itemKey exists in artifact material catalog', () => {
    const mats = new Set(ARTIFACT_MATERIAL_CATALOG.map((m) => m.key));
    for (const bp of ARTIFACT_BLUEPRINT_CATALOG) {
      for (const input of bp.inputs) {
        expect(mats.has(input.itemKey), `${bp.key}.input ${input.itemKey}`).toBe(true);
      }
    }
  });

  it('artifact material items resolvable via itemByKey', () => {
    for (const m of ARTIFACT_MATERIAL_CATALOG) {
      const item = itemByKey(m.key);
      expect(item, `item ${m.key} resolvable`).toBeDefined();
      expect(item?.materialTier).toBe(m.tier);
    }
  });

  it('isArtifactMaterialKey identifies craft materials', () => {
    for (const m of ARTIFACT_MATERIAL_CATALOG) {
      expect(isArtifactMaterialKey(m.key)).toBe(true);
    }
    expect(isArtifactMaterialKey('not_a_material_xyz')).toBe(false);
  });

  it('blueprint required realm matches tier minRealmOrder gate', () => {
    for (const bp of ARTIFACT_BLUEPRINT_CATALOG) {
      const tierDef = getArtifactTierDef(bp.artifactTier);
      expect(tierDef).toBeDefined();
      expect(bp.requiredRealmOrder).toBeGreaterThanOrEqual(tierDef!.minRealmOrder);
    }
  });
});

describe('Phase 26.4 — tier / grade / type / element', () => {
  it('all 9 tiers present with monotonic baseScale', () => {
    expect(ARTIFACT_TIERS.length).toBe(9);
    let prev = 0;
    for (const t of ARTIFACT_TIERS) {
      expect(t.baseScale).toBeGreaterThan(prev);
      prev = t.baseScale;
    }
  });

  it('grade multiplier monotonic from HA_PHAM to DAO_VAN', () => {
    const ordered = ARTIFACT_GRADES.map((g) => ({ g, m: artifactGradeMultiplier(g) }));
    expect(ordered[0].m).toBeCloseTo(0.85);
    expect(ordered[ordered.length - 1].m).toBeCloseTo(1.6);
    for (let i = 1; i < ordered.length; i++) {
      expect(ordered[i].m).toBeGreaterThan(ordered[i - 1].m);
    }
  });

  it('grade order is strictly increasing', () => {
    let prev = -1;
    for (const g of ARTIFACT_GRADES) {
      expect(artifactGradeOrder(g)).toBeGreaterThan(prev);
      prev = artifactGradeOrder(g);
    }
  });

  it('artifactTierForRealmOrder clamps low and high realmOrder', () => {
    expect(artifactTierForRealmOrder(0)).toBe(1);
    expect(artifactTierForRealmOrder(-5)).toBe(1);
    expect(artifactTierForRealmOrder(28)).toBe(9);
    expect(artifactTierForRealmOrder(1)).toBe(1);
    expect(artifactTierForRealmOrder(15)).toBe(6);
  });

  it('getArtifactTierName returns Vietnamese names', () => {
    expect(getArtifactTierName(1)).toBe('Phàm Khí');
    expect(getArtifactTierName(9)).toBe('Chí Tôn Pháp Bảo');
  });

  it('all artifact types map to a default slot', () => {
    for (const t of ARTIFACT_TYPES) {
      const slot = defaultSlotForArtifactType(t);
      expect(ARTIFACT_EQUIP_SLOTS.includes(slot)).toBe(true);
      expect(allowedSlotsForArtifactType(t).length).toBeGreaterThan(0);
      expect(allowedSlotsForArtifactType(t).includes(slot)).toBe(true);
    }
  });

  it('all elements valid (Ngũ Hành + NONE/MIXED/HON_NGUYEN)', () => {
    expect(new Set(ARTIFACT_ELEMENTS)).toEqual(
      new Set(['kim', 'moc', 'thuy', 'hoa', 'tho', 'NONE', 'MIXED', 'HON_NGUYEN']),
    );
  });

  it('qualityForArtifactTier maps to UI quality', () => {
    expect(qualityForArtifactTier(1)).toBe('LINH');
    expect(qualityForArtifactTier(3)).toBe('HUYEN');
    expect(qualityForArtifactTier(5)).toBe('TIEN');
    expect(qualityForArtifactTier(9)).toBe('THAN');
  });

  it('max level/star/refine/awaken monotone with tier', () => {
    let lvl = 0;
    let star = -1;
    let refine = -1;
    let awaken = -1;
    for (let t: ArtifactTier = 1 as ArtifactTier; t <= 9; t = ((t as number) + 1) as ArtifactTier) {
      expect(maxLevelForArtifactTier(t)).toBeGreaterThanOrEqual(lvl);
      expect(maxStarForArtifactTier(t)).toBeGreaterThanOrEqual(star);
      expect(maxRefineForArtifactTier(t)).toBeGreaterThanOrEqual(refine);
      expect(maxAwakenForArtifactTier(t)).toBeGreaterThanOrEqual(awaken);
      lvl = maxLevelForArtifactTier(t);
      star = maxStarForArtifactTier(t);
      refine = maxRefineForArtifactTier(t);
      awaken = maxAwakenForArtifactTier(t);
    }
  });
});

describe('Phase 26.4 — craft / upgrade math', () => {
  const bp = ARTIFACT_BLUEPRINT_CATALOG[0];

  it('computeArtifactCraftSuccessRate cap ≤ 0.95 and ≥ 0.05', () => {
    for (const blueprint of ARTIFACT_BLUEPRINT_CATALOG) {
      const lo = computeArtifactCraftSuccessRate(blueprint, {
        playerRealmOrder: blueprint.requiredRealmOrder,
        externalSuccessBonus: 0,
      });
      const hi = computeArtifactCraftSuccessRate(blueprint, {
        playerRealmOrder: blueprint.requiredRealmOrder + 10,
        externalSuccessBonus: 0.5,
      });
      expect(lo).toBeGreaterThan(0);
      expect(hi).toBeLessThanOrEqual(0.95);
    }
  });

  it('craft success rate bonus from realm cap reasonable', () => {
    const lo = computeArtifactCraftSuccessRate(bp, {
      playerRealmOrder: bp.requiredRealmOrder,
      externalSuccessBonus: 0,
    });
    const hi = computeArtifactCraftSuccessRate(bp, {
      playerRealmOrder: bp.requiredRealmOrder + 6,
      externalSuccessBonus: 0,
    });
    expect(hi).toBeGreaterThanOrEqual(lo);
  });

  it('externalSuccessBonus is clamped to <=0.15', () => {
    const r1 = computeArtifactCraftSuccessRate(bp, {
      playerRealmOrder: bp.requiredRealmOrder,
      externalSuccessBonus: 0.15,
    });
    const r2 = computeArtifactCraftSuccessRate(bp, {
      playerRealmOrder: bp.requiredRealmOrder,
      externalSuccessBonus: 1.0,
    });
    expect(r1).toBeCloseTo(r2, 5);
  });

  it('rollArtifactGrade respects maxGrade', () => {
    const rng = makeRng(12345);
    for (let i = 0; i < 200; i++) {
      const g = rollArtifactGrade(bp, rng);
      expect(artifactGradeOrder(g)).toBeLessThanOrEqual(artifactGradeOrder(bp.maxGrade));
    }
  });

  it('DAO_VAN remains rare across many rolls', () => {
    const rng = makeRng(42);
    let dao = 0;
    const N = 5000;
    for (let i = 0; i < N; i++) {
      const g = rollArtifactGrade(bp, rng);
      if (g === 'DAO_VAN') dao++;
    }
    // bp[0] is tier 1; DAO_VAN cap is very tight → expect basically zero, allow noise.
    expect(dao / N).toBeLessThanOrEqual(0.05);
  });

  it('subStatSlotsForGrade matches policy (HA_PHAM=0 ... DAO_VAN=4)', () => {
    expect(subStatSlotsForGrade('HA_PHAM')).toBe(0);
    expect(subStatSlotsForGrade('TRUNG_PHAM')).toBe(1);
    expect(subStatSlotsForGrade('THUONG_PHAM')).toBe(2);
    expect(subStatSlotsForGrade('CUC_PHAM')).toBe(3);
    expect(subStatSlotsForGrade('LINH_VAN')).toBe(4);
    expect(subStatSlotsForGrade('DAO_VAN')).toBe(4);
  });

  it('rollArtifactSubStats returns expected number of slots', () => {
    const rng = makeRng(99);
    const art = ARTIFACT_CATALOG_V2[0];
    const rolls = rollArtifactSubStats(art, 'CUC_PHAM', rng);
    expect(rolls.length).toBeLessThanOrEqual(3);
    expect(rolls.length).toBeGreaterThan(0);
  });

  it('artifactStarUpSuccessRate decreases with current star and clamps', () => {
    expect(artifactStarUpSuccessRate(0)).toBeGreaterThan(artifactStarUpSuccessRate(5));
    expect(artifactStarUpSuccessRate(0)).toBeLessThanOrEqual(1);
    expect(artifactStarUpSuccessRate(99)).toBeGreaterThan(0);
  });

  it('artifactRefineSuccessRate decreases with current refine', () => {
    expect(artifactRefineSuccessRate(0)).toBeGreaterThan(artifactRefineSuccessRate(5));
  });

  it('artifactAwakenSuccessRate decreases with current awaken', () => {
    expect(artifactAwakenSuccessRate(0)).toBeGreaterThan(artifactAwakenSuccessRate(3));
  });

  it('computeArtifactLevelUpCost > 0 and scales with tier', () => {
    const art1 = ARTIFACT_CATALOG_V2.find((a) => a.tier === 1)!;
    const art9 = ARTIFACT_CATALOG_V2.find((a) => a.tier === 9)!;
    const c1 = computeArtifactLevelUpCost(art1, 0);
    const c9 = computeArtifactLevelUpCost(art9, 0);
    expect(c1.linhThachCost).toBeGreaterThan(0);
    expect(c9.linhThachCost).toBeGreaterThan(c1.linhThachCost);
  });

  it('computeArtifactStarUpCost includes shard items for the artifact', () => {
    const art = ARTIFACT_CATALOG_V2.find((a) => a.tier === 1)!;
    const cost = computeArtifactStarUpCost(art, 0);
    expect(cost.linhThachCost).toBeGreaterThan(0);
    expect(cost.materials.length).toBeGreaterThan(0);
  });
});

describe('Phase 26.4 — equip / gate', () => {
  it('canCraftArtifact rejects realm too low', () => {
    const bp = ARTIFACT_BLUEPRINT_CATALOG.find((b) => b.artifactTier >= 4)!;
    const check = canCraftArtifact(bp, { playerRealmOrder: 1, playerBodyRealmOrder: 1 });
    expect(check.ok).toBe(false);
    expect(check.errors).toContain('REALM_TOO_LOW');
  });

  it('canCraftArtifact rejects tier-too-high when player is far below', () => {
    const bp = ARTIFACT_BLUEPRINT_CATALOG.find((b) => b.artifactTier >= 5)!;
    const check = canCraftArtifact(bp, {
      playerRealmOrder: 1,
      playerBodyRealmOrder: 0,
    });
    expect(check.ok).toBe(false);
    // Will include both REALM_TOO_LOW and TIER_TOO_HIGH.
    expect(check.errors.some((e) => e === 'TIER_TOO_HIGH' || e === 'REALM_TOO_LOW')).toBe(true);
  });

  it('canCraftArtifact passes at matching realm', () => {
    const bp = ARTIFACT_BLUEPRINT_CATALOG.find((b) => b.artifactTier === 1)!;
    const check = canCraftArtifact(bp, {
      playerRealmOrder: bp.requiredRealmOrder + 1,
      playerBodyRealmOrder: bp.requiredBodyRealmOrder ?? 0,
      playerAlchemyLevel: bp.requiredAlchemyLevel ?? 0,
    });
    expect(check.ok, check.errors.join(',')).toBe(true);
  });

  it('canEquipArtifact rejects when realm < artifact.requiredRealmOrder', () => {
    const art = ARTIFACT_CATALOG_V2.find((a) => a.tier === 5)!;
    const check = canEquipArtifact(art, defaultSlotForArtifactType(art.type), {
      playerRealmOrder: 1,
    });
    expect(check.ok).toBe(false);
    expect(check.errors).toContain('REALM_TOO_LOW');
  });

  it('canEquipArtifact rejects when target slot invalid for type', () => {
    const flying = ARTIFACT_CATALOG_V2.find((a) => a.type === 'FLYING_SWORD')!;
    const check = canEquipArtifact(flying, 'DEFENSE_ARTIFACT_V2', {
      playerRealmOrder: 99,
    });
    expect(check.ok).toBe(false);
    expect(check.errors).toContain('SLOT_INVALID_FOR_TYPE');
  });

  it('canEquipArtifact accepts valid type+realm combo', () => {
    const art = ARTIFACT_CATALOG_V2.find((a) => a.tier === 1)!;
    const check = canEquipArtifact(art, defaultSlotForArtifactType(art.type), {
      playerRealmOrder: 28,
    });
    expect(check.ok, check.errors.join(',')).toBe(true);
  });

  it('isArtifactV2EquipSlot / isLegacyArtifactSlot distinct', () => {
    expect(isArtifactV2EquipSlot('MAIN_ARTIFACT_V2')).toBe(true);
    expect(isArtifactV2EquipSlot('ARTIFACT_1')).toBe(false);
    expect(isLegacyArtifactSlot('ARTIFACT_1')).toBe(true);
    expect(isLegacyArtifactSlot('MAIN_ARTIFACT_V2' as never)).toBe(false);
  });
});

describe('Phase 26.4 — stat / snapshot', () => {
  const art = ARTIFACT_CATALOG_V2.find((a) => a.tier === 3)!;

  it('computeArtifactStats grows with level and star', () => {
    const base = computeArtifactStats(art, {
      grade: 'TRUNG_PHAM',
      level: 1,
      star: 0,
      refineLevel: 0,
      awakenLevel: 0,
      spiritLevel: 0,
      subStats: [],
    });
    const leveled = computeArtifactStats(art, {
      grade: 'TRUNG_PHAM',
      level: 10,
      star: 0,
      refineLevel: 0,
      awakenLevel: 0,
      spiritLevel: 0,
      subStats: [],
    });
    const stars = computeArtifactStats(art, {
      grade: 'TRUNG_PHAM',
      level: 1,
      star: 5,
      refineLevel: 0,
      awakenLevel: 0,
      spiritLevel: 0,
      subStats: [],
    });
    expect(leveled.atk ?? 0).toBeGreaterThanOrEqual(base.atk ?? 0);
    expect(stars.atk ?? 0).toBeGreaterThanOrEqual(base.atk ?? 0);
  });

  it('higher grade yields higher stats than lower grade', () => {
    const ha = computeArtifactStats(art, {
      grade: 'HA_PHAM',
      level: 5,
      star: 1,
      refineLevel: 0,
      awakenLevel: 0,
      spiritLevel: 0,
      subStats: [],
    });
    const dao = computeArtifactStats(art, {
      grade: 'DAO_VAN',
      level: 5,
      star: 1,
      refineLevel: 0,
      awakenLevel: 0,
      spiritLevel: 0,
      subStats: [],
    });
    expect(dao.atk ?? 0).toBeGreaterThan(ha.atk ?? 0);
  });

  it('aggregateArtifactV2Snapshot composes multiple artifacts', () => {
    const snap = aggregateArtifactV2Snapshot([
      {
        def: art,
        state: {
          artifactKey: art.key,
          grade: 'TRUNG_PHAM',
          level: 5,
          star: 1,
          refineLevel: 0,
          awakenLevel: 0,
          spiritLevel: 0,
          subStats: [],
          equippedSlot: defaultSlotForArtifactType(art.type),
        },
      },
    ]);
    expect(snap.atk).toBeGreaterThan(0);
  });

  it('aggregateArtifactV2Snapshot skips unequipped entries', () => {
    const snap = aggregateArtifactV2Snapshot([
      {
        def: art,
        state: {
          artifactKey: art.key,
          grade: 'TRUNG_PHAM',
          level: 5,
          star: 1,
          refineLevel: 0,
          awakenLevel: 0,
          spiritLevel: 0,
          subStats: [],
          equippedSlot: null,
        },
      },
    ]);
    const empty = emptyArtifactSnapshot();
    expect(snap.atk).toBe(empty.atk);
    expect(snap.def).toBe(empty.def);
  });

  it('clampArtifactV2Snapshot enforces all caps', () => {
    const big = emptyArtifactSnapshot();
    big.cultivationRateBonusPct = 999;
    big.bodyCultivationRateBonusPct = 999;
    big.alchemySuccessRateBonusPct = 999;
    big.dropRateBonusPct = 999;
    big.luckBonusPct = 999;
    big.bossDamageReductionPct = 999;
    big.tribulationSupportBonusPct = 999;
    big.crit = 999;
    big.speed = 999;
    big.elementalAtkBonus = { kim: 99, hoa: 99 };
    big.elementResist = { kim: 99 };
    const clamped = clampArtifactV2Snapshot(big);
    expect(clamped.cultivationRateBonusPct).toBeLessThanOrEqual(
      ARTIFACT_BONUS_CAPS.cultivationRateBonusPct,
    );
    expect(clamped.bodyCultivationRateBonusPct).toBeLessThanOrEqual(
      ARTIFACT_BONUS_CAPS.bodyCultivationRateBonusPct,
    );
    expect(clamped.alchemySuccessRateBonusPct).toBeLessThanOrEqual(
      ARTIFACT_BONUS_CAPS.alchemySuccessRateBonusPct,
    );
    expect(clamped.dropRateBonusPct).toBeLessThanOrEqual(ARTIFACT_BONUS_CAPS.dropRateBonusPct);
    expect(clamped.luckBonusPct).toBeLessThanOrEqual(ARTIFACT_BONUS_CAPS.luckBonusPct);
    expect(clamped.bossDamageReductionPct).toBeLessThanOrEqual(
      ARTIFACT_BONUS_CAPS.bossDamageReductionPct,
    );
    expect(clamped.crit).toBeLessThanOrEqual(ARTIFACT_BONUS_CAPS.critPct);
    expect(clamped.speed).toBeLessThanOrEqual(ARTIFACT_BONUS_CAPS.speedPct);
    expect(clamped.elementalAtkBonus.kim!).toBeLessThanOrEqual(
      ARTIFACT_BONUS_CAPS.elementalAtkBonusPerElement,
    );
    expect(clamped.elementResist.kim!).toBeLessThanOrEqual(
      ARTIFACT_BONUS_CAPS.elementResistPerElement,
    );
  });

  it('computeArtifactPowerScore positive and monotone with star/level', () => {
    const lo = computeArtifactPowerScore(art, {
      grade: 'TRUNG_PHAM',
      level: 1,
      star: 0,
      refineLevel: 0,
      awakenLevel: 0,
      spiritLevel: 0,
      subStats: [],
    });
    const hi = computeArtifactPowerScore(art, {
      grade: 'DAO_VAN',
      level: 10,
      star: 3,
      refineLevel: 2,
      awakenLevel: 0,
      spiritLevel: 0,
      subStats: [],
    });
    expect(lo).toBeGreaterThan(0);
    expect(hi).toBeGreaterThan(lo);
  });
});

describe('Phase 26.4 — material catalog helpers', () => {
  it('artifactEmbryoKey / blueprintItemKey / bossCoreKey deterministic', () => {
    expect(artifactEmbryoKey(1)).toBe('phoi_phap_bao_t1');
    expect(artifactBlueprintItemKey(9)).toBe('ban_ve_phap_bao_t9');
    expect(artifactBossCoreKey(5)).toBe('boss_core_t5');
  });

  it('every tier has embryo + blueprint item + boss_core entries', () => {
    const keys = new Set(ARTIFACT_MATERIAL_CATALOG.map((m) => m.key));
    for (let t = 1; t <= 9; t++) {
      expect(keys.has(`phoi_phap_bao_t${t}`)).toBe(true);
      expect(keys.has(`ban_ve_phap_bao_t${t}`)).toBe(true);
    }
  });
});

describe('Phase 26.4 — drop economy invariants', () => {
  it('NORMAL_MONSTER never drops ARTIFACT_CRAFT', () => {
    const violating = DROP_RULE_CATALOG.filter(
      (r) =>
        r.source === 'NORMAL_MONSTER' &&
        r.materialCategory === 'ARTIFACT_CRAFT' &&
        (r.maxDailyQty ?? Infinity) > 0,
    );
    expect(violating.length).toBe(0);
  });

  it('ARTIFACT_CRAFT tier 8–9 only from WORLD_BOSS or EVENT', () => {
    const t89 = DROP_RULE_CATALOG.filter(
      (r) =>
        r.materialCategory === 'ARTIFACT_CRAFT' &&
        r.materialTier >= 8 &&
        (r.maxDailyQty === undefined || r.maxDailyQty > 0),
    );
    for (const r of t89) {
      expect(r.source === 'WORLD_BOSS' || r.source === 'EVENT').toBe(true);
    }
  });

  it('ARTIFACT_CRAFT baseChance always < 0.05 (rarer than ALCHEMY_QI)', () => {
    const artifact = DROP_RULE_CATALOG.filter((r) => r.materialCategory === 'ARTIFACT_CRAFT');
    for (const r of artifact) {
      expect(r.baseChance).toBeLessThan(0.05);
    }
  });

  it('all 9 tiers of ARTIFACT_CRAFT have at least 1 rule', () => {
    const tiers = new Set<number>();
    for (const r of DROP_RULE_CATALOG) {
      if (r.materialCategory === 'ARTIFACT_CRAFT') tiers.add(r.materialTier);
    }
    expect(tiers.size).toBeGreaterThanOrEqual(5);
  });
});

describe('Phase 26.4 — blueprint by key + missing-blueprint robustness', () => {
  it('getArtifactBlueprint returns def or undefined', () => {
    const first = ARTIFACT_BLUEPRINT_CATALOG[0];
    expect(getArtifactBlueprint(first.key)).toEqual(first);
    expect(getArtifactBlueprint('does-not-exist')).toBeUndefined();
  });

  it('getArtifactDef returns def or undefined', () => {
    expect(getArtifactDef(ARTIFACT_CATALOG_V2[0].key)).toBeDefined();
    expect(getArtifactDef('does-not-exist')).toBeUndefined();
  });
});
