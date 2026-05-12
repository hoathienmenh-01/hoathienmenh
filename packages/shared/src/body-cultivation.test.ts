import { describe, expect, it } from 'vitest';
import { cultivationRateForRealm, REALMS } from './realms';
import { CULTIVATION_TICK_BASE_EXP } from './ws-events';
import {
  BODY_REALMS,
  bodyExpCostForStage,
  bodyRateForRealm,
  computeBodyBreakthroughRequirement,
  computeBodyStatBonus,
  getBodyRealmByOrder,
  validateBodyCultivationCatalog,
} from './body-cultivation';

describe('Phase 26.0 — Body Cultivation catalog', () => {
  it('BODY_REALMS có 28 entry', () => {
    expect(BODY_REALMS).toHaveLength(28);
    expect(BODY_REALMS).toHaveLength(REALMS.length);
  });

  it('body realm order/stage/tier match REALMS order', () => {
    for (const qi of REALMS) {
      const body = getBodyRealmByOrder(qi.order);
      expect(body, `missing body order ${qi.order}`).toBeDefined();
      expect(body!.stages).toBe(qi.stages);
      expect(body!.tier).toBe(qi.tier);
      expect(body!.qiRealmKey).toBe(qi.key);
    }
  });

  it('body realm key unique', () => {
    expect(new Set(BODY_REALMS.map((r) => r.key)).size).toBe(BODY_REALMS.length);
  });

  it('bodyExpCostForStage monotonic trong từng realm', () => {
    for (const realm of BODY_REALMS) {
      let prev = 0n;
      for (let stage = 1; stage <= realm.stages; stage += 1) {
        const cost = bodyExpCostForStage(realm, stage);
        expect(cost > prev, `${realm.key} stage ${stage}`).toBe(true);
        prev = cost;
      }
    }
  });

  it('bodyRateForRealm nằm trong khoảng 45%–55% cultivationRateForRealm', () => {
    for (const body of BODY_REALMS) {
      const qiRate = cultivationRateForRealm(body.qiRealmKey, CULTIVATION_TICK_BASE_EXP);
      const ratio = bodyRateForRealm(body.key) / qiRate;
      expect(ratio, body.key).toBeGreaterThanOrEqual(0.45);
      expect(ratio, body.key).toBeLessThanOrEqual(0.55);
    }
  });

  it('computeBodyStatBonus không vượt cap envelope', () => {
    for (const body of BODY_REALMS) {
      const bonus = computeBodyStatBonus(body.order, body.stages);
      expect(bonus.hpMax).toBeLessThanOrEqual(24_000);
      expect(bonus.power).toBeLessThanOrEqual(1_200);
      expect(bonus.def).toBeLessThanOrEqual(1_500);
      expect(bonus.staminaMax).toBeLessThanOrEqual(220);
      expect(bonus.bossDamageReduction).toBeLessThanOrEqual(0.28);
    }
  });

  it('breakthrough requirement scale theo order', () => {
    const early = computeBodyBreakthroughRequirement(0, 1);
    const mid = computeBodyBreakthroughRequirement(8, 9);
    expect(mid.bodyExpCost).toBeGreaterThan(early.bodyExpCost);
    expect(mid.materials[0]!.qty).toBeGreaterThan(early.materials[0]!.qty);
  });

  it('validateBodyCultivationCatalog pass', () => {
    expect(validateBodyCultivationCatalog()).toBe(true);
  });
});
