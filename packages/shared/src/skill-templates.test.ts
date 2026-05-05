import { describe, it, expect } from 'vitest';
import {
  SKILL_TEMPLATES,
  SKILL_TIERS,
  SKILL_TIER_DEFS,
  SkillTier,
  SkillTemplate,
  generateMasteryCurve,
  getSkillTemplate,
  getSkillTierDef,
  templatesByTier,
  templatesByUnlock,
  applyMasteryEffect,
  masteryUpgradeCost,
  findOrphanSkills,
  findOrphanTemplates,
  findTierMismatches,
} from './skill-templates';
import { SKILLS, skillByKey } from './combat';

describe('SKILL_TIER_DEFS', () => {
  it('có đủ 5 tier basic/intermediate/advanced/master/legendary', () => {
    expect(SKILL_TIERS).toHaveLength(5);
    for (const tier of SKILL_TIERS) {
      expect(SKILL_TIER_DEFS[tier]).toBeDefined();
      expect(SKILL_TIER_DEFS[tier].key).toBe(tier);
    }
  });

  it('maxMastery monotonic non-decreasing theo thứ tự tier', () => {
    let last = 0;
    for (const tier of SKILL_TIERS) {
      const def = SKILL_TIER_DEFS[tier];
      expect(def.maxMastery).toBeGreaterThanOrEqual(last);
      last = def.maxMastery;
    }
  });

  it('total max atk bonus + total max mp reduction monotonic non-decreasing (cao tier mạnh hơn)', () => {
    let lastAtkTotal = 0;
    let lastMpTotal = 0;
    for (const tier of SKILL_TIERS) {
      const def = SKILL_TIER_DEFS[tier];
      const atkTotal = def.atkScaleBonusPerLevel * def.maxMastery;
      const mpTotal = def.mpCostReductionPerLevel * def.maxMastery;
      expect(atkTotal).toBeGreaterThanOrEqual(lastAtkTotal);
      expect(mpTotal).toBeGreaterThanOrEqual(lastMpTotal);
      lastAtkTotal = atkTotal;
      lastMpTotal = mpTotal;
    }
  });

  it('atkScaleBonusPerLevel × maxMastery (max bonus) bounded ≤ 1.0 (anti power-creep cap +100%)', () => {
    for (const tier of SKILL_TIERS) {
      const def = SKILL_TIER_DEFS[tier];
      const maxBonus = def.atkScaleBonusPerLevel * def.maxMastery;
      expect(maxBonus).toBeLessThanOrEqual(1.0);
    }
  });

  it('mpCostReductionPerLevel × maxMastery bounded < 1.0 (không bao giờ free MP cost)', () => {
    for (const tier of SKILL_TIERS) {
      const def = SKILL_TIER_DEFS[tier];
      const maxReduction = def.mpCostReductionPerLevel * def.maxMastery;
      expect(maxReduction).toBeLessThan(1.0);
    }
  });

  it('chỉ legendary có hasEvolution = true', () => {
    expect(SKILL_TIER_DEFS.basic.hasEvolution).toBe(false);
    expect(SKILL_TIER_DEFS.intermediate.hasEvolution).toBe(false);
    expect(SKILL_TIER_DEFS.advanced.hasEvolution).toBe(false);
    expect(SKILL_TIER_DEFS.master.hasEvolution).toBe(false);
    expect(SKILL_TIER_DEFS.legendary.hasEvolution).toBe(true);
  });

  it('getSkillTierDef throw on invalid tier', () => {
    expect(() => getSkillTierDef('cosmic' as SkillTier)).toThrow(/unknown tier/);
  });
});

describe('generateMasteryCurve', () => {
  for (const tier of SKILL_TIERS) {
    it(`tier ${tier}: length = maxMastery, level monotonic 1..N`, () => {
      const curve = generateMasteryCurve(tier);
      const def = SKILL_TIER_DEFS[tier];
      expect(curve).toHaveLength(def.maxMastery);
      curve.forEach((lv, i) => {
        expect(lv.level).toBe(i + 1);
      });
    });

    it(`tier ${tier}: atkScaleBonus monotonic strictly increasing với level`, () => {
      const curve = generateMasteryCurve(tier);
      let last = -1;
      for (const lv of curve) {
        expect(lv.atkScaleBonus).toBeGreaterThan(last);
        last = lv.atkScaleBonus;
      }
    });

    it(`tier ${tier}: linhThachCost monotonic strictly increasing`, () => {
      const curve = generateMasteryCurve(tier);
      let last = 0;
      for (const lv of curve) {
        expect(lv.linhThachCost).toBeGreaterThan(last);
        last = lv.linhThachCost;
      }
    });

    it(`tier ${tier}: cooldownReduction non-decreasing`, () => {
      const curve = generateMasteryCurve(tier);
      let last = 0;
      for (const lv of curve) {
        expect(lv.cooldownReduction).toBeGreaterThanOrEqual(last);
        last = lv.cooldownReduction;
      }
    });
  }
});

describe('SKILL_TEMPLATES catalog shape', () => {
  it('không rỗng (≥ 20 template baseline)', () => {
    expect(SKILL_TEMPLATES.length).toBeGreaterThanOrEqual(20);
  });

  it('mọi key unique', () => {
    const keys = SKILL_TEMPLATES.map((t) => t.key);
    const unique = new Set(keys);
    expect(unique.size).toBe(keys.length);
  });

  it('mọi template có required fields', () => {
    for (const t of SKILL_TEMPLATES) {
      expect(t.key).toBeTruthy();
      expect(SKILL_TIERS).toContain(t.tier);
      expect(Array.isArray(t.unlocks)).toBe(true);
      expect(Array.isArray(t.masteryLevels)).toBe(true);
      const tierDef = getSkillTierDef(t.tier);
      expect(t.masteryLevels).toHaveLength(tierDef.maxMastery);
    }
  });

  it('mọi template có masteryLevels.level đúng 1..maxMastery', () => {
    for (const t of SKILL_TEMPLATES) {
      t.masteryLevels.forEach((lv, i) => {
        expect(lv.level).toBe(i + 1);
        expect(lv.linhThachCost).toBeGreaterThan(0);
        expect(lv.shardCost).toBeGreaterThanOrEqual(0);
        expect(lv.atkScaleBonus).toBeGreaterThan(0);
        expect(lv.mpCostReduction).toBeGreaterThan(0);
        expect(lv.cooldownReduction).toBeGreaterThanOrEqual(0);
      });
    }
  });

  it('unlocks reference fields có kind hợp lệ', () => {
    const validKinds = new Set(['realm', 'sect', 'method', 'item', 'quest', 'event']);
    for (const t of SKILL_TEMPLATES) {
      for (const u of t.unlocks) {
        expect(validKinds.has(u.kind)).toBe(true);
        expect(u.ref).toBeTruthy();
      }
    }
  });

  it('chỉ legendary có evolutions; lower tier optional và có thể vắng', () => {
    for (const t of SKILL_TEMPLATES) {
      const tierDef = getSkillTierDef(t.tier);
      if (!tierDef.hasEvolution) {
        // lower tier có thể vắng evolutions hoặc empty
        expect(t.evolutions === undefined || t.evolutions.length === 0).toBe(true);
      } else {
        // legendary phải có ít nhất 1 evolution branch
        expect(t.evolutions).toBeDefined();
        expect(t.evolutions!.length).toBeGreaterThanOrEqual(1);
      }
    }
  });

  it('evolution branchKey unique trên toàn catalog', () => {
    const branchKeys: string[] = [];
    for (const t of SKILL_TEMPLATES) {
      for (const ev of t.evolutions ?? []) {
        branchKeys.push(ev.branchKey);
      }
    }
    const unique = new Set(branchKeys);
    expect(unique.size).toBe(branchKeys.length);
  });

  it('evolution unlockMastery ≤ template.tier.maxMastery', () => {
    for (const t of SKILL_TEMPLATES) {
      const tierDef = getSkillTierDef(t.tier);
      for (const ev of t.evolutions ?? []) {
        expect(ev.unlockMastery).toBeLessThanOrEqual(tierDef.maxMastery);
        expect(ev.unlockMastery).toBeGreaterThanOrEqual(1);
      }
    }
  });
});

describe('SKILL_TEMPLATES coverage vs SKILLS', () => {
  it('mọi skill ở SKILLS đều có template (no orphans)', () => {
    expect(findOrphanSkills()).toEqual([]);
  });

  it('mọi template trỏ tới skill tồn tại trong SKILLS', () => {
    expect(findOrphanTemplates()).toEqual([]);
  });

  it('cardinality SKILL_TEMPLATES = SKILLS', () => {
    expect(SKILL_TEMPLATES.length).toBe(SKILLS.length);
  });

  it('mỗi tier có ít nhất 1 template (5 tier baseline coverage)', () => {
    for (const tier of SKILL_TIERS) {
      const list = templatesByTier(tier);
      expect(list.length).toBeGreaterThanOrEqual(1);
    }
  });

  it('early/mid tier dominate over endgame (basic + intermediate ≥ advanced + master + legendary)', () => {
    // Phase 10 PR-2 heuristic cũ là `basic ≥ intermediate` — không scale tới
    // Phase 11 nâng cao §2 v3 khi content mở rộng tier nguyen_anh + role-fill
    // truc_co (intermediate naturally grows). Invariant mới: gộp early/mid
    // (basic + intermediate) vẫn ≥ tổng advanced/master/legendary để giữ
    // accessibility curve early-game friendly.
    const earlyMid =
      templatesByTier('basic').length + templatesByTier('intermediate').length;
    const lateGame =
      templatesByTier('advanced').length +
      templatesByTier('master').length +
      templatesByTier('legendary').length;
    expect(
      earlyMid,
      `early/mid (basic+intermediate=${earlyMid}) phải ≥ late (advanced+master+legendary=${lateGame})`,
    ).toBeGreaterThanOrEqual(lateGame);

    // Legendary vẫn là tier rare nhất (≤ basic).
    const basicCount = templatesByTier('basic').length;
    const legendaryCount = templatesByTier('legendary').length;
    expect(legendaryCount).toBeLessThanOrEqual(basicCount);
  });
});

describe('SKILL_TEMPLATES tier consistency với SkillDef baseline', () => {
  it('findTierMismatches() = empty (catalog tier khớp với SkillDef stat hoặc whitelist override)', () => {
    const mismatches = findTierMismatches();
    if (mismatches.length > 0) {
      // helpful diagnostic
      console.error('Tier mismatches:', JSON.stringify(mismatches, null, 2));
    }
    expect(mismatches).toEqual([]);
  });
});

describe('helpers', () => {
  it('getSkillTemplate trả về template đúng theo skillKey', () => {
    const t = getSkillTemplate('basic_attack');
    expect(t).toBeDefined();
    expect(t!.key).toBe('basic_attack');
    expect(t!.tier).toBe('basic');
  });

  it('getSkillTemplate trả undefined với key không tồn tại', () => {
    expect(getSkillTemplate('khong_co_ky')).toBeUndefined();
  });

  it('templatesByTier: chỉ trả templates đúng tier', () => {
    const legendary = templatesByTier('legendary');
    expect(legendary.length).toBeGreaterThanOrEqual(1);
    for (const t of legendary) {
      expect(t.tier).toBe('legendary');
    }
  });

  it('templatesByUnlock kind=sect ref=tu_la trả về template tu_la', () => {
    const list = templatesByUnlock('sect', 'tu_la');
    expect(list.length).toBeGreaterThanOrEqual(1);
    for (const t of list) {
      expect(t.unlocks.some((u) => u.kind === 'sect' && u.ref === 'tu_la')).toBe(true);
    }
  });

  it('templatesByUnlock kind=realm ref=truc_co ≥ 5 (intermediate skills)', () => {
    const list = templatesByUnlock('realm', 'truc_co');
    expect(list.length).toBeGreaterThanOrEqual(5);
  });
});

describe('applyMasteryEffect', () => {
  it('masteryLevel = 0 → trả base skill không bonus', () => {
    const skill = skillByKey('kim_quang_tram')!;
    const template = getSkillTemplate('kim_quang_tram')!;
    const effective = applyMasteryEffect(template, 0, skill);
    expect(effective.atkScale).toBe(skill.atkScale);
    expect(effective.mpCost).toBe(skill.mpCost);
    expect(effective.cooldownTurns).toBe(skill.cooldownTurns ?? 0);
    expect(effective.masteryLevel).toBe(0);
  });

  it('masteryLevel = 1 → cộng bonus đúng curve', () => {
    const skill = skillByKey('kim_quang_tram')!;
    const template = getSkillTemplate('kim_quang_tram')!;
    const effective = applyMasteryEffect(template, 1, skill);
    const tierDef = getSkillTierDef(template.tier);
    const expectedAtk = Math.round(skill.atkScale * (1 + tierDef.atkScaleBonusPerLevel) * 100) / 100;
    const expectedMp = Math.max(0, Math.round(skill.mpCost * (1 - tierDef.mpCostReductionPerLevel)));
    expect(effective.atkScale).toBe(expectedAtk);
    expect(effective.mpCost).toBe(expectedMp);
    expect(effective.masteryLevel).toBe(1);
  });

  it('masteryLevel > maxMastery → clamp to maxMastery', () => {
    const skill = skillByKey('basic_attack')!;
    const template = getSkillTemplate('basic_attack')!;
    const tierDef = getSkillTierDef(template.tier);
    const effective = applyMasteryEffect(template, 999, skill);
    expect(effective.masteryLevel).toBe(tierDef.maxMastery);
  });

  it('throw nếu template.key mismatch baseSkill.key', () => {
    const skill = skillByKey('kim_quang_tram')!;
    const template = getSkillTemplate('basic_attack')!;
    expect(() => applyMasteryEffect(template, 1, skill)).toThrow(/mismatch/);
  });

  it('atkScale + bonus monotonic increase mỗi level', () => {
    const skill = skillByKey('kim_quang_tram')!;
    const template = getSkillTemplate('kim_quang_tram')!;
    const tierDef = getSkillTierDef(template.tier);
    let last = 0;
    for (let lv = 0; lv <= tierDef.maxMastery; lv++) {
      const effective = applyMasteryEffect(template, lv, skill);
      expect(effective.atkScale).toBeGreaterThanOrEqual(last);
      last = effective.atkScale;
    }
  });

  it('mpCost monotonic non-increase mỗi level (cao mastery dùng ít MP hơn)', () => {
    const skill = skillByKey('hoa_long_phen_thien')!;
    const template = getSkillTemplate('hoa_long_phen_thien')!;
    const tierDef = getSkillTierDef(template.tier);
    let last = Infinity;
    for (let lv = 0; lv <= tierDef.maxMastery; lv++) {
      const effective = applyMasteryEffect(template, lv, skill);
      expect(effective.mpCost).toBeLessThanOrEqual(last);
      last = effective.mpCost;
    }
  });

  it('mpCost không âm dù bonus rất cao', () => {
    const skill = skillByKey('hoa_long_phen_thien')!;
    const template = getSkillTemplate('hoa_long_phen_thien')!;
    const tierDef = getSkillTierDef(template.tier);
    const effective = applyMasteryEffect(template, tierDef.maxMastery, skill);
    expect(effective.mpCost).toBeGreaterThanOrEqual(0);
  });

  it('cooldownTurns không âm sau reduction', () => {
    const skill = skillByKey('kim_phong_phap_quyet')!;
    const template = getSkillTemplate('kim_phong_phap_quyet')!;
    const tierDef = getSkillTierDef(template.tier);
    const effective = applyMasteryEffect(template, tierDef.maxMastery, skill);
    expect(effective.cooldownTurns).toBeGreaterThanOrEqual(0);
  });
});

describe('masteryUpgradeCost', () => {
  it('from = to → cost zero', () => {
    const template = getSkillTemplate('kim_quang_tram')!;
    const cost = masteryUpgradeCost(template, 3, 3);
    expect(cost.linhThachCost).toBe(0);
    expect(cost.shardCost).toBe(0);
  });

  it('from = 0, to = 1 → cost = level 1', () => {
    const template = getSkillTemplate('kim_quang_tram')!;
    const cost = masteryUpgradeCost(template, 0, 1);
    expect(cost.linhThachCost).toBe(template.masteryLevels[0].linhThachCost);
    expect(cost.shardCost).toBe(template.masteryLevels[0].shardCost);
  });

  it('full upgrade from 0 to maxMastery = sum levels', () => {
    const template = getSkillTemplate('kim_quang_tram')!;
    const tierDef = getSkillTierDef(template.tier);
    const cost = masteryUpgradeCost(template, 0, tierDef.maxMastery);
    const expectedLT = template.masteryLevels.reduce((sum, lv) => sum + lv.linhThachCost, 0);
    const expectedShard = template.masteryLevels.reduce((sum, lv) => sum + lv.shardCost, 0);
    expect(cost.linhThachCost).toBe(expectedLT);
    expect(cost.shardCost).toBe(expectedShard);
  });

  it('throw nếu from < 0', () => {
    const template = getSkillTemplate('kim_quang_tram')!;
    expect(() => masteryUpgradeCost(template, -1, 3)).toThrow(/fromLevel/);
  });

  it('throw nếu to < from', () => {
    const template = getSkillTemplate('kim_quang_tram')!;
    expect(() => masteryUpgradeCost(template, 3, 1)).toThrow(/toLevel/);
  });

  it('throw nếu to > maxMastery', () => {
    const template = getSkillTemplate('kim_quang_tram')!;
    const tierDef = getSkillTierDef(template.tier);
    expect(() => masteryUpgradeCost(template, 0, tierDef.maxMastery + 1)).toThrow(/maxMastery/);
  });
});

describe('Balance — global stack rule', () => {
  it('total max atkScale bonus per skill ≤ +100% (cap power-creep)', () => {
    for (const t of SKILL_TEMPLATES) {
      const lastLv = t.masteryLevels[t.masteryLevels.length - 1];
      expect(lastLv.atkScaleBonus).toBeLessThanOrEqual(1.0);
    }
  });

  it('total max mpCost reduction per skill ≤ 60% (luôn còn cost)', () => {
    for (const t of SKILL_TEMPLATES) {
      const lastLv = t.masteryLevels[t.masteryLevels.length - 1];
      expect(lastLv.mpCostReduction).toBeLessThanOrEqual(0.6);
    }
  });

  it('cumulative linhThach cost full mastery cao tier > thấp tier', () => {
    // Verify economy progression: legendary tier ≫ basic tier total cost
    const basicSample = SKILL_TEMPLATES.find((t) => t.tier === 'basic');
    const legendarySample = SKILL_TEMPLATES.find((t) => t.tier === 'legendary');
    expect(basicSample).toBeDefined();
    expect(legendarySample).toBeDefined();
    const basicTotal = basicSample!.masteryLevels.reduce((s, lv) => s + lv.linhThachCost, 0);
    const legendaryTotal = legendarySample!.masteryLevels.reduce(
      (s, lv) => s + lv.linhThachCost,
      0
    );
    expect(legendaryTotal).toBeGreaterThan(basicTotal);
  });
});
