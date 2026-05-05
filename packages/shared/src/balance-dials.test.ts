/**
 * Balance Dials invariant + snapshot test (Phase 11 nâng cao §6).
 *
 * Verify:
 * 1. Mọi dial là finite number (không NaN / không Infinity).
 * 2. Positivity: caps > 0 nơi cần (multiplier, budget, duration).
 * 3. Ordering: min < max ở pair (LOW/HIGH, MIN/MAX, COUNTER_PENALTY <
 *    NEUTRAL < COUNTER_BONUS).
 * 4. Monotonic: ITEM_STAT_BUDGET_BY_QUALITY tăng theo quality
 *    (PHAM < LINH < HUYEN < TIEN < THAN); MISSION_DAILY_BUDGET tăng
 *    theo realm tier (luyenkhi < truc_co < kim_dan < nguyen_anh).
 * 5. Snapshot: BALANCE_DIALS aggregate stable JSON — drift detection.
 * 6. Validators trả empty errors cho input hợp lệ + ≥ 1 error cho
 *    input vượt cap.
 *
 * Theo `docs/AI_WORKFLOW_RULES.md` SAFETY CORRECTION RULE: KHÔNG
 * `expect(true).toBe(true)`, KHÔNG skip. Thay đổi giá trị dial cần
 * update snapshot test bằng tay (intentional decision).
 */
import { describe, expect, it } from 'vitest';
import { QUALITIES } from './enums';
import {
  BALANCE_DIALS,
  CULTIVATION_BUFF_CAP,
  CULTIVATION_RATE_REALM_MULT,
  COMBAT_RNG_HIGH,
  COMBAT_RNG_LOW,
  ELEMENT_CHARACTER_PRIMARY_BONUS,
  ELEMENT_CHARACTER_SECONDARY_BONUS,
  METHOD_ELEMENT_PRIMARY_BONUS,
  METHOD_ELEMENT_SECONDARY_BONUS,
  ELEMENT_COUNTERED_MULTIPLIER,
  ELEMENT_COUNTER_MULTIPLIER,
  ELEMENT_GENERATED_MULTIPLIER,
  ELEMENT_GENERATE_MULTIPLIER,
  ELEMENT_LOG_AMPLIFY_THRESHOLD,
  ELEMENT_LOG_DAMPEN_THRESHOLD,
  ELEMENT_MATRIX,
  ELEMENT_MODIFIER_ABSOLUTE_CEIL,
  ELEMENT_MODIFIER_ABSOLUTE_FLOOR,
  ELEMENT_NAME_VI,
  ELEMENT_NEUTRAL_MULTIPLIER,
  ELEMENT_RELATION_LABEL_VI,
  ELEMENT_SAME_ELEMENT_MULTIPLIER,
  BREAKTHROUGH_CHANCE_MAX,
  BREAKTHROUGH_CHANCE_MIN,
  ITEM_POWER_EQUIV_WEIGHTS,
  ITEM_STAT_BUDGET_BY_QUALITY,
  MISSION_DAILY_BUDGET_BY_REALM_TIER,
  REALM_COST_SCALE,
  STAGE_COST_SCALE,
  describeElementMatch,
  validateElementalModifier,
  validateItemBudget,
  validateMissionRewardBudget,
  validateSkillBudget,
} from './balance-dials';
import { ELEMENTS } from './combat';
import { CULTIVATION_TICK_BASE_EXP, CULTIVATION_TICK_MS } from './ws-events';
import { STAMINA_REGEN_PER_TICK } from './combat';

const NUMERIC_DIAL_KEYS_TO_CHECK = [
  'CULTIVATION_TICK_MS',
  'CULTIVATION_TICK_BASE_EXP',
  'CULTIVATION_RATE_REALM_MULT',
  'CULTIVATION_BUFF_CAP',
  'REALM_COST_BASE',
  'REALM_COST_SCALE',
  'STAGE_COST_SCALE',
  'STAMINA_REGEN_PER_TICK',
  'STAMINA_MAX_DEFAULT',
  'COMBAT_RNG_LOW',
  'COMBAT_RNG_HIGH',
  'COMBAT_MIN_DAMAGE',
  'COMBAT_DEF_FACTOR',
  'SKILL_ATK_SCALE_HARD_CAP',
  'SKILL_SELF_HEAL_HARD_CAP',
  'SKILL_SELF_BLOOD_HARD_CAP',
  'SKILL_COOLDOWN_HARD_CAP',
  'SKILL_MP_COST_HARD_CAP',
  'ITEM_OFF_SLOT_SOFT_CAP_MULTIPLIER',
  'MISSION_WEEKLY_DAILY_MULTIPLIER',
  'MISSION_ONCE_LINHTHACH_HARD_CAP',
  'MISSION_TIENNGOC_HARD_CAP',
  'ELEMENT_NEUTRAL_MULTIPLIER',
  'ELEMENT_COUNTER_MULTIPLIER',
  'ELEMENT_GENERATE_MULTIPLIER',
  'ELEMENT_COUNTERED_MULTIPLIER',
  'ELEMENT_GENERATED_MULTIPLIER',
  'ELEMENT_SAME_ELEMENT_MULTIPLIER',
  'ELEMENT_CHARACTER_PRIMARY_BONUS',
  'ELEMENT_CHARACTER_SECONDARY_BONUS',
  'METHOD_ELEMENT_PRIMARY_BONUS',
  'METHOD_ELEMENT_SECONDARY_BONUS',
  'ELEMENT_LOG_AMPLIFY_THRESHOLD',
  'ELEMENT_LOG_DAMPEN_THRESHOLD',
  'ELEMENT_MODIFIER_ABSOLUTE_FLOOR',
  'ELEMENT_MODIFIER_ABSOLUTE_CEIL',
  'BREAKTHROUGH_CHANCE_MIN',
  'BREAKTHROUGH_CHANCE_MAX',
  'BREAKTHROUGH_FAIL_DEBUFF_DURATION_SEC',
  'BREAKTHROUGH_FAIL_DEBUFF_RATE_PENALTY',
  'MARKET_TAX_DEFAULT',
  'DROP_WEIGHT_MAX_RATIO',
] as const;

describe('BALANCE_DIALS — finite & positive (anti-NaN/Infinity drift)', () => {
  it('mọi numeric dial là finite number, không NaN/Infinity', () => {
    const dialsAsRecord = BALANCE_DIALS as unknown as Record<string, unknown>;
    for (const key of NUMERIC_DIAL_KEYS_TO_CHECK) {
      const v = dialsAsRecord[key];
      expect(typeof v, `${key} không phải number`).toBe('number');
      expect(Number.isFinite(v as number), `${key}=${String(v)} không finite`).toBe(true);
    }
  });

  it('mọi cap/budget dương (> 0)', () => {
    const positiveKeys = [
      'CULTIVATION_TICK_MS',
      'CULTIVATION_TICK_BASE_EXP',
      'CULTIVATION_RATE_REALM_MULT',
      'CULTIVATION_BUFF_CAP',
      'REALM_COST_BASE',
      'REALM_COST_SCALE',
      'STAGE_COST_SCALE',
      'STAMINA_REGEN_PER_TICK',
      'STAMINA_MAX_DEFAULT',
      'COMBAT_RNG_LOW',
      'COMBAT_RNG_HIGH',
      'COMBAT_MIN_DAMAGE',
      'SKILL_ATK_SCALE_HARD_CAP',
      'SKILL_COOLDOWN_HARD_CAP',
      'SKILL_MP_COST_HARD_CAP',
      'ITEM_OFF_SLOT_SOFT_CAP_MULTIPLIER',
      'MISSION_WEEKLY_DAILY_MULTIPLIER',
      'MISSION_ONCE_LINHTHACH_HARD_CAP',
      'MISSION_TIENNGOC_HARD_CAP',
      'ELEMENT_NEUTRAL_MULTIPLIER',
      'ELEMENT_COUNTER_MULTIPLIER',
      'ELEMENT_GENERATE_MULTIPLIER',
      'ELEMENT_COUNTERED_MULTIPLIER',
      'ELEMENT_GENERATED_MULTIPLIER',
      'ELEMENT_SAME_ELEMENT_MULTIPLIER',
      'ELEMENT_CHARACTER_PRIMARY_BONUS',
      'ELEMENT_CHARACTER_SECONDARY_BONUS',
      'METHOD_ELEMENT_PRIMARY_BONUS',
      'METHOD_ELEMENT_SECONDARY_BONUS',
      'ELEMENT_LOG_AMPLIFY_THRESHOLD',
      'ELEMENT_LOG_DAMPEN_THRESHOLD',
      'ELEMENT_MODIFIER_ABSOLUTE_FLOOR',
      'ELEMENT_MODIFIER_ABSOLUTE_CEIL',
      'BREAKTHROUGH_CHANCE_MIN',
      'BREAKTHROUGH_CHANCE_MAX',
      'BREAKTHROUGH_FAIL_DEBUFF_DURATION_SEC',
      'BREAKTHROUGH_FAIL_DEBUFF_RATE_PENALTY',
      'DROP_WEIGHT_MAX_RATIO',
    ] as const;
    const dialsAsRecord = BALANCE_DIALS as unknown as Record<string, number>;
    for (const key of positiveKeys) {
      const v = dialsAsRecord[key];
      expect(v, `${key}=${v} không > 0`).toBeGreaterThan(0);
    }
  });

  it('skill self-{heal,blood} cap + combat def factor + market tax ∈ [0..1]', () => {
    const ratioKeys = [
      'SKILL_SELF_HEAL_HARD_CAP',
      'SKILL_SELF_BLOOD_HARD_CAP',
      'COMBAT_DEF_FACTOR',
      'MARKET_TAX_DEFAULT',
      'BREAKTHROUGH_CHANCE_MIN',
      'BREAKTHROUGH_CHANCE_MAX',
      'BREAKTHROUGH_FAIL_DEBUFF_RATE_PENALTY',
      'DROP_WEIGHT_MAX_RATIO',
    ] as const;
    const dialsAsRecord = BALANCE_DIALS as unknown as Record<string, number>;
    for (const key of ratioKeys) {
      const v = dialsAsRecord[key];
      expect(v, `${key}=${v} ngoài [0..1]`).toBeGreaterThanOrEqual(0);
      expect(v, `${key}=${v} ngoài [0..1]`).toBeLessThanOrEqual(1);
    }
  });
});

describe('BALANCE_DIALS — pairwise ordering (min < max)', () => {
  it('COMBAT_RNG_LOW < COMBAT_RNG_HIGH', () => {
    expect(COMBAT_RNG_LOW).toBeLessThan(COMBAT_RNG_HIGH);
  });

  it('ELEMENT_COUNTERED_MULTIPLIER < SAME < NEUTRAL < GENERATE < COUNTER (matrix ordering)', () => {
    expect(ELEMENT_COUNTERED_MULTIPLIER).toBeLessThan(ELEMENT_GENERATED_MULTIPLIER);
    expect(ELEMENT_GENERATED_MULTIPLIER).toBeLessThan(ELEMENT_SAME_ELEMENT_MULTIPLIER);
    expect(ELEMENT_SAME_ELEMENT_MULTIPLIER).toBeLessThan(ELEMENT_NEUTRAL_MULTIPLIER);
    expect(ELEMENT_NEUTRAL_MULTIPLIER).toBeLessThan(ELEMENT_GENERATE_MULTIPLIER);
    expect(ELEMENT_GENERATE_MULTIPLIER).toBeLessThan(ELEMENT_COUNTER_MULTIPLIER);
  });

  it('ELEMENT_GENERATE_MULTIPLIER nhẹ hơn ELEMENT_COUNTER_MULTIPLIER (sinh < khắc)', () => {
    expect(ELEMENT_GENERATE_MULTIPLIER).toBeLessThan(ELEMENT_COUNTER_MULTIPLIER);
  });

  it('ELEMENT_MODIFIER_ABSOLUTE_FLOOR ≤ countered (worst-case); ceiling ≥ counter+primary (best-case)', () => {
    expect(ELEMENT_MODIFIER_ABSOLUTE_FLOOR).toBeLessThanOrEqual(ELEMENT_COUNTERED_MULTIPLIER);
    expect(ELEMENT_COUNTER_MULTIPLIER + ELEMENT_CHARACTER_PRIMARY_BONUS).toBeLessThanOrEqual(
      ELEMENT_MODIFIER_ABSOLUTE_CEIL,
    );
  });

  it('ELEMENT_LOG_DAMPEN_THRESHOLD ≤ NEUTRAL ≤ ELEMENT_LOG_AMPLIFY_THRESHOLD', () => {
    expect(ELEMENT_LOG_DAMPEN_THRESHOLD).toBeLessThanOrEqual(ELEMENT_NEUTRAL_MULTIPLIER);
    expect(ELEMENT_LOG_AMPLIFY_THRESHOLD).toBeGreaterThanOrEqual(ELEMENT_NEUTRAL_MULTIPLIER);
  });

  it('character bonus dials positive < 0.5 (envelope)', () => {
    expect(ELEMENT_CHARACTER_PRIMARY_BONUS).toBeGreaterThan(0);
    expect(ELEMENT_CHARACTER_PRIMARY_BONUS).toBeLessThan(0.5);
    expect(ELEMENT_CHARACTER_SECONDARY_BONUS).toBeGreaterThan(0);
    expect(ELEMENT_CHARACTER_SECONDARY_BONUS).toBeLessThanOrEqual(
      ELEMENT_CHARACTER_PRIMARY_BONUS,
    );
  });

  it('method element bonus dials positive < 0.5 + secondary ≤ primary (Phase 11.1.E envelope)', () => {
    expect(METHOD_ELEMENT_PRIMARY_BONUS).toBeGreaterThan(0);
    expect(METHOD_ELEMENT_PRIMARY_BONUS).toBeLessThan(0.5);
    expect(METHOD_ELEMENT_SECONDARY_BONUS).toBeGreaterThan(0);
    expect(METHOD_ELEMENT_SECONDARY_BONUS).toBeLessThanOrEqual(
      METHOD_ELEMENT_PRIMARY_BONUS,
    );
  });

  it('BREAKTHROUGH_CHANCE_MIN < CHANCE_MAX', () => {
    expect(BREAKTHROUGH_CHANCE_MIN).toBeLessThan(BREAKTHROUGH_CHANCE_MAX);
  });

  it('REALM_COST_SCALE > 1 và STAGE_COST_SCALE > 1 (cost realm cao luôn cao hơn realm thấp)', () => {
    expect(REALM_COST_SCALE).toBeGreaterThan(1);
    expect(STAGE_COST_SCALE).toBeGreaterThan(1);
  });

  it('CULTIVATION_RATE_REALM_MULT > 1 (rate tăng theo realm) và CULTIVATION_BUFF_CAP > 1', () => {
    expect(CULTIVATION_RATE_REALM_MULT).toBeGreaterThan(1);
    expect(CULTIVATION_BUFF_CAP).toBeGreaterThan(1);
  });
});

describe('BALANCE_DIALS — ITEM_STAT_BUDGET_BY_QUALITY monotonic theo quality', () => {
  const STATS = ['atk', 'def', 'hpMax', 'mpMax', 'spirit'] as const;

  it('mỗi stat tăng nghiêm ngặt PHAM < LINH < HUYEN < TIEN < THAN', () => {
    for (const stat of STATS) {
      let prev = 0;
      for (const q of QUALITIES) {
        const v = ITEM_STAT_BUDGET_BY_QUALITY[q][stat];
        expect(v, `${q}.${stat}=${v} ≤ ${prev} (không strict-monotonic theo quality)`).toBeGreaterThan(prev);
        prev = v;
      }
    }
  });

  it('mọi stat cap > 0', () => {
    for (const q of QUALITIES) {
      for (const stat of STATS) {
        expect(
          ITEM_STAT_BUDGET_BY_QUALITY[q][stat],
          `${q}.${stat} ≤ 0`,
        ).toBeGreaterThan(0);
      }
    }
  });

  it('mọi PowerEquivWeights ≥ 0 và atk weight là 1.0 (anchor)', () => {
    expect(ITEM_POWER_EQUIV_WEIGHTS.atk).toBe(1.0);
    for (const stat of STATS) {
      expect(
        ITEM_POWER_EQUIV_WEIGHTS[stat],
        `${stat} weight âm`,
      ).toBeGreaterThanOrEqual(0);
    }
  });
});

describe('BALANCE_DIALS — MISSION_DAILY_BUDGET_BY_REALM_TIER monotonic', () => {
  const TIER_ORDER = ['luyenkhi', 'truc_co', 'kim_dan', 'nguyen_anh'] as const;

  it('budget tăng nghiêm ngặt theo realm tier', () => {
    let prev = 0;
    for (const tier of TIER_ORDER) {
      const v = MISSION_DAILY_BUDGET_BY_REALM_TIER[tier];
      expect(v, `tier ${tier} không có entry`).toBeDefined();
      expect(v, `tier ${tier}=${v} ≤ ${prev}`).toBeGreaterThan(prev);
      prev = v;
    }
  });

  it('mọi tier budget > 0', () => {
    for (const tier of TIER_ORDER) {
      expect(MISSION_DAILY_BUDGET_BY_REALM_TIER[tier]).toBeGreaterThan(0);
    }
  });
});

describe('BALANCE_DIALS — re-export consistency (single source of truth)', () => {
  it('CULTIVATION_TICK_MS / TICK_BASE_EXP re-export khớp ws-events', () => {
    expect(BALANCE_DIALS.CULTIVATION_TICK_MS).toBe(CULTIVATION_TICK_MS);
    expect(BALANCE_DIALS.CULTIVATION_TICK_BASE_EXP).toBe(CULTIVATION_TICK_BASE_EXP);
  });

  it('STAMINA_REGEN_PER_TICK re-export khớp combat', () => {
    expect(BALANCE_DIALS.STAMINA_REGEN_PER_TICK).toBe(STAMINA_REGEN_PER_TICK);
  });
});

describe('BALANCE_DIALS — aggregate snapshot (drift detection)', () => {
  /**
   * Snapshot test detect unintentional dial drift. Khi đổi dial cố ý,
   * update snapshot và update `BALANCE_MODEL.md` cùng PR. KHÔNG snapshot
   * những dial chứa BigInt / function — chỉ plain-data subset.
   */
  it('aggregate snapshot stable JSON', () => {
    const snapshot = {
      cultivation: {
        tickMs: BALANCE_DIALS.CULTIVATION_TICK_MS,
        tickBaseExp: BALANCE_DIALS.CULTIVATION_TICK_BASE_EXP,
        rateRealmMult: BALANCE_DIALS.CULTIVATION_RATE_REALM_MULT,
        buffCap: BALANCE_DIALS.CULTIVATION_BUFF_CAP,
      },
      realmCost: {
        base: BALANCE_DIALS.REALM_COST_BASE,
        scale: BALANCE_DIALS.REALM_COST_SCALE,
        stageScale: BALANCE_DIALS.STAGE_COST_SCALE,
      },
      stamina: {
        regenPerTick: BALANCE_DIALS.STAMINA_REGEN_PER_TICK,
        maxDefault: BALANCE_DIALS.STAMINA_MAX_DEFAULT,
      },
      combat: {
        rngLow: BALANCE_DIALS.COMBAT_RNG_LOW,
        rngHigh: BALANCE_DIALS.COMBAT_RNG_HIGH,
        minDamage: BALANCE_DIALS.COMBAT_MIN_DAMAGE,
        defFactor: BALANCE_DIALS.COMBAT_DEF_FACTOR,
      },
      skillCaps: {
        atkScale: BALANCE_DIALS.SKILL_ATK_SCALE_HARD_CAP,
        selfHeal: BALANCE_DIALS.SKILL_SELF_HEAL_HARD_CAP,
        selfBlood: BALANCE_DIALS.SKILL_SELF_BLOOD_HARD_CAP,
        cooldown: BALANCE_DIALS.SKILL_COOLDOWN_HARD_CAP,
        mpCost: BALANCE_DIALS.SKILL_MP_COST_HARD_CAP,
      },
      itemBudget: {
        offSlotSoftCapMultiplier: BALANCE_DIALS.ITEM_OFF_SLOT_SOFT_CAP_MULTIPLIER,
        powerEquivWeights: BALANCE_DIALS.ITEM_POWER_EQUIV_WEIGHTS,
        statBudgetByQuality: BALANCE_DIALS.ITEM_STAT_BUDGET_BY_QUALITY,
      },
      missionReward: {
        dailyBudgetByRealmTier: BALANCE_DIALS.MISSION_DAILY_BUDGET_BY_REALM_TIER,
        weeklyDailyMultiplier: BALANCE_DIALS.MISSION_WEEKLY_DAILY_MULTIPLIER,
        onceLinhThachHardCap: BALANCE_DIALS.MISSION_ONCE_LINHTHACH_HARD_CAP,
        tienNgocHardCap: BALANCE_DIALS.MISSION_TIENNGOC_HARD_CAP,
      },
      element: {
        neutralMultiplier: BALANCE_DIALS.ELEMENT_NEUTRAL_MULTIPLIER,
        counterMultiplier: BALANCE_DIALS.ELEMENT_COUNTER_MULTIPLIER,
        generateMultiplier: BALANCE_DIALS.ELEMENT_GENERATE_MULTIPLIER,
        counteredMultiplier: BALANCE_DIALS.ELEMENT_COUNTERED_MULTIPLIER,
        generatedMultiplier: BALANCE_DIALS.ELEMENT_GENERATED_MULTIPLIER,
        sameElementMultiplier: BALANCE_DIALS.ELEMENT_SAME_ELEMENT_MULTIPLIER,
        characterPrimaryBonus: BALANCE_DIALS.ELEMENT_CHARACTER_PRIMARY_BONUS,
        characterSecondaryBonus: BALANCE_DIALS.ELEMENT_CHARACTER_SECONDARY_BONUS,
        methodPrimaryBonus: BALANCE_DIALS.METHOD_ELEMENT_PRIMARY_BONUS,
        methodSecondaryBonus: BALANCE_DIALS.METHOD_ELEMENT_SECONDARY_BONUS,
        logAmplifyThreshold: BALANCE_DIALS.ELEMENT_LOG_AMPLIFY_THRESHOLD,
        logDampenThreshold: BALANCE_DIALS.ELEMENT_LOG_DAMPEN_THRESHOLD,
        modifierAbsoluteFloor: BALANCE_DIALS.ELEMENT_MODIFIER_ABSOLUTE_FLOOR,
        modifierAbsoluteCeil: BALANCE_DIALS.ELEMENT_MODIFIER_ABSOLUTE_CEIL,
      },
      talentResist: {
        elementResistValue: BALANCE_DIALS.TALENT_ELEMENT_RESIST_VALUE,
      },
      breakthrough: {
        chanceMin: BALANCE_DIALS.BREAKTHROUGH_CHANCE_MIN,
        chanceMax: BALANCE_DIALS.BREAKTHROUGH_CHANCE_MAX,
        failDebuffDurationSec: BALANCE_DIALS.BREAKTHROUGH_FAIL_DEBUFF_DURATION_SEC,
        failDebuffRatePenalty: BALANCE_DIALS.BREAKTHROUGH_FAIL_DEBUFF_RATE_PENALTY,
      },
      economy: {
        marketTaxDefault: BALANCE_DIALS.MARKET_TAX_DEFAULT,
        dropWeightMaxRatio: BALANCE_DIALS.DROP_WEIGHT_MAX_RATIO,
      },
    };
    expect(snapshot).toMatchInlineSnapshot(`
      {
        "breakthrough": {
          "chanceMax": 0.99,
          "chanceMin": 0.3,
          "failDebuffDurationSec": 300,
          "failDebuffRatePenalty": 0.7,
        },
        "combat": {
          "defFactor": 0.5,
          "minDamage": 1,
          "rngHigh": 1.15,
          "rngLow": 0.85,
        },
        "cultivation": {
          "buffCap": 2.5,
          "rateRealmMult": 1.45,
          "tickBaseExp": 5,
          "tickMs": 30000,
        },
        "economy": {
          "dropWeightMaxRatio": 0.8,
          "marketTaxDefault": 0.05,
        },
        "element": {
          "characterPrimaryBonus": 0.1,
          "characterSecondaryBonus": 0.05,
          "counterMultiplier": 1.3,
          "counteredMultiplier": 0.7,
          "generateMultiplier": 1.2,
          "generatedMultiplier": 0.85,
          "logAmplifyThreshold": 1.15,
          "logDampenThreshold": 0.9,
          "methodPrimaryBonus": 0.1,
          "methodSecondaryBonus": 0.05,
          "modifierAbsoluteCeil": 1.5,
          "modifierAbsoluteFloor": 0.6,
          "neutralMultiplier": 1,
          "sameElementMultiplier": 0.9,
        },
        "itemBudget": {
          "offSlotSoftCapMultiplier": 1.2,
          "powerEquivWeights": {
            "atk": 1,
            "def": 0.8,
            "hpMax": 0.05,
            "mpMax": 0.05,
            "spirit": 1.5,
          },
          "statBudgetByQuality": {
            "HUYEN": {
              "atk": 60,
              "def": 50,
              "hpMax": 200,
              "mpMax": 200,
              "spirit": 30,
            },
            "LINH": {
              "atk": 25,
              "def": 20,
              "hpMax": 80,
              "mpMax": 80,
              "spirit": 12,
            },
            "PHAM": {
              "atk": 10,
              "def": 8,
              "hpMax": 30,
              "mpMax": 30,
              "spirit": 5,
            },
            "THAN": {
              "atk": 800,
              "def": 600,
              "hpMax": 3000,
              "mpMax": 3000,
              "spirit": 350,
            },
            "TIEN": {
              "atk": 200,
              "def": 160,
              "hpMax": 800,
              "mpMax": 800,
              "spirit": 100,
            },
          },
        },
        "missionReward": {
          "dailyBudgetByRealmTier": {
            "kim_dan": 6000,
            "luyenkhi": 800,
            "nguyen_anh": 15000,
            "truc_co": 2300,
          },
          "onceLinhThachHardCap": 200000,
          "tienNgocHardCap": 100,
          "weeklyDailyMultiplier": 5,
        },
        "realmCost": {
          "base": 1000,
          "scale": 1.6,
          "stageScale": 1.4,
        },
        "skillCaps": {
          "atkScale": 5,
          "cooldown": 6,
          "mpCost": 80,
          "selfBlood": 0.3,
          "selfHeal": 0.5,
        },
        "stamina": {
          "maxDefault": 100,
          "regenPerTick": 3,
        },
        "talentResist": {
          "elementResistValue": 0.95,
        },
      }
    `);
  });
});

describe('validateSkillBudget', () => {
  it('input hợp lệ → empty errors', () => {
    expect(
      validateSkillBudget({
        key: 'kim_quang_tram',
        atkScale: 2.5,
        mpCost: 30,
        selfHealRatio: 0,
        selfBloodCost: 0,
        cooldownTurns: 3,
      }),
    ).toEqual([]);
  });

  it('atkScale vượt cap → ≥ 1 error', () => {
    const errs = validateSkillBudget({
      key: 'overpowered_skill',
      atkScale: 999,
      mpCost: 0,
      selfHealRatio: 0,
      selfBloodCost: 0,
    });
    expect(errs.length).toBeGreaterThanOrEqual(1);
    expect(errs.some((e) => e.includes('atkScale'))).toBe(true);
  });

  it('mpCost âm → error', () => {
    const errs = validateSkillBudget({
      key: 'negative_mp',
      atkScale: 1,
      mpCost: -5,
      selfHealRatio: 0,
      selfBloodCost: 0,
    });
    expect(errs.some((e) => e.includes('mpCost'))).toBe(true);
  });

  it('cooldownTurns vượt cap → error', () => {
    const errs = validateSkillBudget({
      key: 'long_cd',
      atkScale: 1,
      mpCost: 0,
      selfHealRatio: 0,
      selfBloodCost: 0,
      cooldownTurns: 999,
    });
    expect(errs.some((e) => e.includes('cooldownTurns'))).toBe(true);
  });

  it('cooldownTurns undefined → treat as 0, không error', () => {
    const errs = validateSkillBudget({
      key: 'no_cd',
      atkScale: 1,
      mpCost: 0,
      selfHealRatio: 0,
      selfBloodCost: 0,
    });
    expect(errs).toEqual([]);
  });
});

describe('validateItemBudget', () => {
  it('PHAM equip với atk=8 (≤ cap 10) → empty errors', () => {
    expect(
      validateItemBudget({
        key: 'pham_sword',
        quality: 'PHAM',
        bonuses: { atk: 8 },
      }),
    ).toEqual([]);
  });

  it('LINH equip vượt atk cap → error', () => {
    const errs = validateItemBudget({
      key: 'broken_linh_sword',
      quality: 'LINH',
      bonuses: { atk: 999 },
    });
    expect(errs.some((e) => e.includes('atk'))).toBe(true);
  });

  it('quality lạ → 1 error duy nhất', () => {
    const errs = validateItemBudget({
      key: 'fake_item',
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      quality: 'FAKE_QUALITY' as any,
      bonuses: { atk: 1 },
    });
    expect(errs.length).toBe(1);
    expect(errs[0]).toContain('quality=FAKE_QUALITY');
  });

  it('multi-stat power-equiv vượt soft cap → error', () => {
    // PHAM cap atk=10, soft cap = 10 * 1.2 = 12. Power equiv với
    // spirit weight 1.5 — spirit 9 = power 13.5 > 12.
    const errs = validateItemBudget({
      key: 'overweight_pham_acc',
      quality: 'PHAM',
      bonuses: { spirit: 9 },
    });
    expect(errs.some((e) => e.includes('power-equiv'))).toBe(true);
  });

  it('bonus âm → error', () => {
    const errs = validateItemBudget({
      key: 'negative_atk_item',
      quality: 'PHAM',
      bonuses: { atk: -1 },
    });
    expect(errs.some((e) => e.includes('âm'))).toBe(true);
  });

  it('input không có bonuses → empty errors (item non-equip)', () => {
    expect(
      validateItemBudget({
        key: 'pill_only',
        quality: 'LINH',
      }),
    ).toEqual([]);
  });
});

describe('validateMissionRewardBudget', () => {
  it('DAILY luyenkhi linhThach=500 (≤ cap 800) → empty', () => {
    expect(
      validateMissionRewardBudget({
        key: 'daily_kill_son_coc',
        period: 'DAILY',
        realmTier: 'luyenkhi',
        rewards: { linhThach: 500 },
      }),
    ).toEqual([]);
  });

  it('DAILY luyenkhi linhThach=99999 → error', () => {
    const errs = validateMissionRewardBudget({
      key: 'broken_daily',
      period: 'DAILY',
      realmTier: 'luyenkhi',
      rewards: { linhThach: 99999 },
    });
    expect(errs.some((e) => e.includes('vượt cap'))).toBe(true);
  });

  it('WEEKLY kim_dan linhThach=29999 (≤ 6000 × 5 = 30000) → empty', () => {
    expect(
      validateMissionRewardBudget({
        key: 'weekly_kim_dan',
        period: 'WEEKLY',
        realmTier: 'kim_dan',
        rewards: { linhThach: 29999 },
      }),
    ).toEqual([]);
  });

  it('ONCE linhThach=999999 (vượt 200000 cap) → error', () => {
    const errs = validateMissionRewardBudget({
      key: 'broken_once',
      period: 'ONCE',
      rewards: { linhThach: 999999 },
    });
    expect(errs.some((e) => e.includes('vượt cap'))).toBe(true);
  });

  it('tienNgoc=999 (vượt 100 cap) → error', () => {
    const errs = validateMissionRewardBudget({
      key: 'broken_tn',
      period: 'ONCE',
      rewards: { tienNgoc: 999 },
    });
    expect(errs.some((e) => e.includes('tienNgoc'))).toBe(true);
  });

  it('linhThach âm → error', () => {
    const errs = validateMissionRewardBudget({
      key: 'neg_lt',
      period: 'DAILY',
      realmTier: 'luyenkhi',
      rewards: { linhThach: -1 },
    });
    expect(errs.some((e) => e.includes('âm'))).toBe(true);
  });

  it('realmTier không có entry trong DAILY_BUDGET → skip cap check (no error)', () => {
    expect(
      validateMissionRewardBudget({
        key: 'unknown_tier',
        period: 'DAILY',
        realmTier: 'hu_khong_chi_ton',
        rewards: { linhThach: 9999999 },
      }),
    ).toEqual([]);
  });
});

describe('describeElementMatch — Ngũ Hành matrix breakdown', () => {
  it('null attacker hoặc null defender → neutral 1.0, vi=null', () => {
    expect(describeElementMatch(null, null)).toEqual({
      multiplier: ELEMENT_NEUTRAL_MULTIPLIER,
      relation: 'neutral',
      vi: null,
    });
    expect(describeElementMatch('kim', null)).toEqual({
      multiplier: ELEMENT_NEUTRAL_MULTIPLIER,
      relation: 'neutral',
      vi: null,
    });
    expect(describeElementMatch(null, 'moc')).toEqual({
      multiplier: ELEMENT_NEUTRAL_MULTIPLIER,
      relation: 'neutral',
      vi: null,
    });
  });

  it('Kim khắc Mộc → counter 1.30 + vi="Kim khắc Mộc"', () => {
    expect(describeElementMatch('kim', 'moc')).toEqual({
      multiplier: ELEMENT_COUNTER_MULTIPLIER,
      relation: 'counter',
      vi: 'Kim khắc Mộc',
    });
  });

  it('Mộc tương sinh Hoả → generate 1.20 + vi="Mộc tương sinh Hoả"', () => {
    expect(describeElementMatch('moc', 'hoa')).toEqual({
      multiplier: ELEMENT_GENERATE_MULTIPLIER,
      relation: 'generate',
      vi: 'Mộc tương sinh Hoả',
    });
  });

  it('Mộc bị Kim khắc → countered 0.70 + vi="Mộc bị Kim khắc"', () => {
    expect(describeElementMatch('moc', 'kim')).toEqual({
      multiplier: ELEMENT_COUNTERED_MULTIPLIER,
      relation: 'countered',
      vi: 'Mộc bị Kim khắc',
    });
  });

  it('Hoả bị Mộc sinh → generated 0.85 + vi="Hoả bị Mộc sinh"', () => {
    expect(describeElementMatch('hoa', 'moc')).toEqual({
      multiplier: ELEMENT_GENERATED_MULTIPLIER,
      relation: 'generated',
      vi: 'Hoả bị Mộc sinh',
    });
  });

  it('Kim cùng hệ Kim → same 0.90 + vi="Kim cùng hệ Kim"', () => {
    expect(describeElementMatch('kim', 'kim')).toEqual({
      multiplier: ELEMENT_SAME_ELEMENT_MULTIPLIER,
      relation: 'same',
      vi: 'Kim cùng hệ Kim',
    });
  });

  it('5×5 matrix exhaustive: mỗi cặp có relation hợp lệ + multiplier ∈ {0.7, 0.85, 0.9, 1.2, 1.3}', () => {
    const validMuls = new Set([
      ELEMENT_COUNTERED_MULTIPLIER,
      ELEMENT_GENERATED_MULTIPLIER,
      ELEMENT_SAME_ELEMENT_MULTIPLIER,
      ELEMENT_GENERATE_MULTIPLIER,
      ELEMENT_COUNTER_MULTIPLIER,
    ]);
    for (const a of ELEMENTS) {
      for (const d of ELEMENTS) {
        const desc = describeElementMatch(a, d);
        expect(desc.relation).not.toBe('neutral');
        expect(validMuls.has(desc.multiplier)).toBe(true);
        expect(desc.vi).not.toBeNull();
        expect(desc.vi).toContain(ELEMENT_NAME_VI[a]);
        expect(desc.vi).toContain(ELEMENT_NAME_VI[d]);
      }
    }
  });

  it('matrix self-consistency: counter(a,b)=1.30 ↔ countered(b,a)=0.70', () => {
    for (const a of ELEMENTS) {
      for (const d of ELEMENTS) {
        const ad = describeElementMatch(a, d);
        const da = describeElementMatch(d, a);
        if (ad.relation === 'counter') {
          expect(da.relation).toBe('countered');
        }
        if (ad.relation === 'generate') {
          expect(da.relation).toBe('generated');
        }
        if (ad.relation === 'same') {
          expect(da.relation).toBe('same');
        }
      }
    }
  });

  it('label registry coverage: ELEMENT_NAME_VI và ELEMENT_RELATION_LABEL_VI cover all keys', () => {
    for (const e of ELEMENTS) {
      expect(typeof ELEMENT_NAME_VI[e]).toBe('string');
      expect(ELEMENT_NAME_VI[e].length).toBeGreaterThan(0);
    }
    const relations = ['neutral', 'counter', 'generate', 'countered', 'generated', 'same'] as const;
    for (const r of relations) {
      expect(typeof ELEMENT_RELATION_LABEL_VI[r]).toBe('string');
      expect(ELEMENT_RELATION_LABEL_VI[r].length).toBeGreaterThan(0);
    }
  });
});

describe('ELEMENT_MATRIX — frozen 5×5 lookup', () => {
  it('mỗi attacker có entry cho mỗi defender (5×5=25 cell)', () => {
    for (const a of ELEMENTS) {
      expect(Object.keys(ELEMENT_MATRIX[a])).toHaveLength(ELEMENTS.length);
      for (const d of ELEMENTS) {
        expect(typeof ELEMENT_MATRIX[a][d]).toBe('number');
        expect(Number.isFinite(ELEMENT_MATRIX[a][d])).toBe(true);
      }
    }
  });

  it('ELEMENT_MATRIX[a][b] === describeElementMatch(a,b).multiplier (no drift)', () => {
    for (const a of ELEMENTS) {
      for (const d of ELEMENTS) {
        expect(ELEMENT_MATRIX[a][d]).toBe(describeElementMatch(a, d).multiplier);
      }
    }
  });

  it('matrix immutable (frozen)', () => {
    expect(Object.isFrozen(ELEMENT_MATRIX)).toBe(true);
    expect(Object.isFrozen(ELEMENT_MATRIX.kim)).toBe(true);
  });
});

describe('validateElementalModifier — envelope guard', () => {
  it('value=1.0 (neutral) → empty errors', () => {
    expect(validateElementalModifier({ source: 'skill_cast', value: 1.0 })).toEqual([]);
  });

  it('value=1.40 (counter 1.30 + primary 0.10) → empty errors (≤ ceil 1.5)', () => {
    expect(
      validateElementalModifier({
        source: 'skill_cast',
        value: ELEMENT_COUNTER_MULTIPLIER + ELEMENT_CHARACTER_PRIMARY_BONUS,
      }),
    ).toEqual([]);
  });

  it('value=0.65 (countered 0.70 - light overflow) → empty errors (≥ floor 0.6)', () => {
    expect(validateElementalModifier({ source: 'talent_cast', value: 0.65 })).toEqual([]);
  });

  it('value=2.5 (vượt ceil 1.5) → error', () => {
    const errs = validateElementalModifier({ source: 'broken_buff', value: 2.5 });
    expect(errs).toHaveLength(1);
    expect(errs[0]).toContain('vượt trần');
    expect(errs[0]).toContain('broken_buff');
  });

  it('value=0.3 (dưới floor 0.6) → error', () => {
    const errs = validateElementalModifier({ source: 'broken_debuff', value: 0.3 });
    expect(errs).toHaveLength(1);
    expect(errs[0]).toContain('dưới sàn');
  });

  it('value=NaN → error không finite', () => {
    const errs = validateElementalModifier({ source: 'nan_skill', value: NaN });
    expect(errs).toHaveLength(1);
    expect(errs[0]).toContain('không finite');
  });

  it('value=Infinity → error không finite', () => {
    const errs = validateElementalModifier({ source: 'inf_buff', value: Infinity });
    expect(errs).toHaveLength(1);
    expect(errs[0]).toContain('không finite');
  });
});
