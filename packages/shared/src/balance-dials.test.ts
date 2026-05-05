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
  ELEMENT_COUNTER_BONUS_MAX,
  ELEMENT_COUNTER_PENALTY_MIN,
  ELEMENT_GENERATE_BONUS,
  ELEMENT_MODIFIER_ABSOLUTE_MAX,
  ELEMENT_MODIFIER_ABSOLUTE_MIN,
  ELEMENT_NEUTRAL_MODIFIER,
  BREAKTHROUGH_CHANCE_MAX,
  BREAKTHROUGH_CHANCE_MIN,
  ITEM_POWER_EQUIV_WEIGHTS,
  ITEM_STAT_BUDGET_BY_QUALITY,
  MISSION_DAILY_BUDGET_BY_REALM_TIER,
  REALM_COST_SCALE,
  STAGE_COST_SCALE,
  validateItemBudget,
  validateMissionRewardBudget,
  validateSkillBudget,
} from './balance-dials';
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
  'ELEMENT_NEUTRAL_MODIFIER',
  'ELEMENT_COUNTER_BONUS_MAX',
  'ELEMENT_COUNTER_PENALTY_MIN',
  'ELEMENT_GENERATE_BONUS',
  'ELEMENT_MODIFIER_ABSOLUTE_MIN',
  'ELEMENT_MODIFIER_ABSOLUTE_MAX',
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
      'ELEMENT_NEUTRAL_MODIFIER',
      'ELEMENT_COUNTER_BONUS_MAX',
      'ELEMENT_COUNTER_PENALTY_MIN',
      'ELEMENT_GENERATE_BONUS',
      'ELEMENT_MODIFIER_ABSOLUTE_MIN',
      'ELEMENT_MODIFIER_ABSOLUTE_MAX',
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

  it('ELEMENT_COUNTER_PENALTY_MIN < NEUTRAL < COUNTER_BONUS_MAX', () => {
    expect(ELEMENT_COUNTER_PENALTY_MIN).toBeLessThan(ELEMENT_NEUTRAL_MODIFIER);
    expect(ELEMENT_NEUTRAL_MODIFIER).toBeLessThan(ELEMENT_COUNTER_BONUS_MAX);
  });

  it('ELEMENT_GENERATE_BONUS giữa NEUTRAL và COUNTER_BONUS_MAX (sinh nhẹ hơn khắc)', () => {
    expect(ELEMENT_GENERATE_BONUS).toBeGreaterThan(ELEMENT_NEUTRAL_MODIFIER);
    expect(ELEMENT_GENERATE_BONUS).toBeLessThanOrEqual(ELEMENT_COUNTER_BONUS_MAX);
  });

  it('ELEMENT_MODIFIER_ABSOLUTE_MIN ≤ COUNTER_PENALTY_MIN; COUNTER_BONUS_MAX ≤ ABSOLUTE_MAX', () => {
    expect(ELEMENT_MODIFIER_ABSOLUTE_MIN).toBeLessThanOrEqual(ELEMENT_COUNTER_PENALTY_MIN);
    expect(ELEMENT_COUNTER_BONUS_MAX).toBeLessThanOrEqual(ELEMENT_MODIFIER_ABSOLUTE_MAX);
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
        neutralModifier: BALANCE_DIALS.ELEMENT_NEUTRAL_MODIFIER,
        counterBonusMax: BALANCE_DIALS.ELEMENT_COUNTER_BONUS_MAX,
        counterPenaltyMin: BALANCE_DIALS.ELEMENT_COUNTER_PENALTY_MIN,
        generateBonus: BALANCE_DIALS.ELEMENT_GENERATE_BONUS,
        modifierAbsoluteMin: BALANCE_DIALS.ELEMENT_MODIFIER_ABSOLUTE_MIN,
        modifierAbsoluteMax: BALANCE_DIALS.ELEMENT_MODIFIER_ABSOLUTE_MAX,
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
          "counterBonusMax": 1.15,
          "counterPenaltyMin": 0.9,
          "generateBonus": 1.05,
          "modifierAbsoluteMax": 1.25,
          "modifierAbsoluteMin": 0.8,
          "neutralModifier": 1,
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
