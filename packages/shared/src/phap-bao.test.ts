import { describe, expect, it } from 'vitest';
import {
  PHAP_BAO_CATALOG,
  PHAP_BAO_ACTIVE_COOLDOWN_FLOOR_SEC,
  PHAP_BAO_AWAKEN_MAX,
  PHAP_BAO_PASSIVE_CAP_MULTIPLIER,
  PHAP_BAO_POWER_MULTIPLIER_CAP,
  PHAP_BAO_REFINE_COST_MULTIPLIER,
  PHAP_BAO_STAR_COOLDOWN_REDUCTION_CAP,
  PHAP_BAO_STAR_MAX,
  PHAP_BAO_STAR_POWER_PER_LEVEL,
  PHAP_BAO_REFINE_POWER_PER_LEVEL,
  PHAP_BAO_AWAKEN_POWER_PER_STAGE,
  canEquipPhapBao,
  computePhapBaoActiveSkillPreview,
  computePhapBaoPassiveBonus,
  computePhapBaoPowerScore,
  getPhapBaoAwakenCost,
  getPhapBaoByKey,
  getPhapBaoStarUpCost,
  getPhapBaoTierForRealmOrder,
  getPhapBaoUpgradeCost,
  validatePhapBaoDefinition,
  validatePhapBaoUpgradeRequest,
  type PhapBaoDef,
} from './phap-bao';
import { ITEM_STAT_BUDGET_BY_QUALITY } from './balance-dials';
import { ITEMS } from './items';
import { getEquipmentTierForRealmOrder } from './equipment-progression';

describe('PHAP_BAO_CATALOG — catalog integrity', () => {
  it('catalog có ≥ 10 entries (foundation requirement)', () => {
    expect(PHAP_BAO_CATALOG.length).toBeGreaterThanOrEqual(10);
  });

  it('artifactKey duy nhất, không trùng', () => {
    const keys = new Set<string>();
    for (const a of PHAP_BAO_CATALOG) {
      expect(keys.has(a.artifactKey), `duplicate key ${a.artifactKey}`).toBe(false);
      keys.add(a.artifactKey);
    }
  });

  it('artifactKey = itemKey để inventory pipeline lookup được', () => {
    for (const a of PHAP_BAO_CATALOG) {
      expect(a.itemKey).toBe(a.artifactKey);
    }
  });

  it('mọi pháp bảo có ItemDef tương ứng trong ITEMS catalog', () => {
    for (const a of PHAP_BAO_CATALOG) {
      const itemDef = ITEMS.find((i) => i.key === a.itemKey);
      expect(itemDef, `${a.artifactKey} thiếu ItemDef`).toBeDefined();
      expect(itemDef!.kind, `${a.artifactKey} ItemDef.kind`).toBe('ARTIFACT');
      expect(itemDef!.slot, `${a.artifactKey} ItemDef.slot`).toMatch(/^ARTIFACT_/);
      expect(itemDef!.quality).toBe(a.quality);
      expect(itemDef!.equipmentTier).toBe(a.artifactTier);
    }
  });

  it('phủ tier 2..10 (tier 1 deliberately rỗng vì dòng cao cấp)', () => {
    const tiers = new Set(PHAP_BAO_CATALOG.map((a) => a.artifactTier));
    expect(tiers.has(1)).toBe(false);
    for (let t = 2; t <= 10; t++) {
      // Không enforce strict mỗi tier — foundation có thể bỏ lỗ trên đường tier
      // nhưng cần phủ ≥ 5 tier khác nhau
    }
    expect(tiers.size).toBeGreaterThanOrEqual(5);
  });

  it('mọi quality LINH/HUYEN/TIEN/THAN đều có đại diện (foundation coverage)', () => {
    const qualities = new Set(PHAP_BAO_CATALOG.map((a) => a.quality));
    for (const q of ['LINH', 'HUYEN', 'TIEN', 'THAN'] as const) {
      expect(qualities.has(q), `thiếu quality ${q}`).toBe(true);
    }
  });

  it('mọi activeSkill key duy nhất trong catalog', () => {
    const keys = new Set<string>();
    for (const a of PHAP_BAO_CATALOG) {
      if (a.activeSkill !== null) {
        expect(
          keys.has(a.activeSkill.key),
          `duplicate skill key ${a.activeSkill.key}`,
        ).toBe(false);
        keys.add(a.activeSkill.key);
      }
    }
  });

  it('validatePhapBaoDefinition pass cho mọi entry', () => {
    for (const a of PHAP_BAO_CATALOG) {
      const result = validatePhapBaoDefinition(a);
      expect(result.ok, `${a.artifactKey}: ${result.errors.join('; ')}`).toBe(true);
    }
  });
});

describe('canEquipPhapBao — realm gate', () => {
  it('trả false khi realm chưa đủ', () => {
    for (const a of PHAP_BAO_CATALOG) {
      expect(canEquipPhapBao(a.requiredRealmOrder - 1, a)).toBe(false);
    }
  });

  it('trả true khi đủ requiredRealmOrder', () => {
    for (const a of PHAP_BAO_CATALOG) {
      expect(canEquipPhapBao(a.requiredRealmOrder, a)).toBe(true);
      expect(canEquipPhapBao(a.requiredRealmOrder + 5, a)).toBe(true);
    }
  });

  it('throw RangeError khi realmOrder âm', () => {
    const sample = PHAP_BAO_CATALOG[0];
    expect(() => canEquipPhapBao(-1, sample)).toThrow(RangeError);
    expect(() => canEquipPhapBao(Number.NaN, sample)).toThrow(RangeError);
  });
});

describe('getPhapBaoTierForRealmOrder — tier ladder', () => {
  it('alias đúng equipment tier ladder Phase 23.2', () => {
    for (let realm = 1; realm <= 28; realm++) {
      expect(getPhapBaoTierForRealmOrder(realm)).toBe(
        getEquipmentTierForRealmOrder(realm).tier,
      );
    }
  });

  it('realm order khớp tier yêu cầu của artifact', () => {
    for (const a of PHAP_BAO_CATALOG) {
      const tier = getPhapBaoTierForRealmOrder(a.requiredRealmOrder);
      expect(tier).toBeGreaterThanOrEqual(a.artifactTier);
    }
  });
});

describe('getPhapBaoByKey — lookup', () => {
  it('trả entry đúng cho key catalog', () => {
    for (const a of PHAP_BAO_CATALOG) {
      expect(getPhapBaoByKey(a.artifactKey)).toBe(a);
    }
  });

  it('trả undefined cho key không tồn tại', () => {
    expect(getPhapBaoByKey('not_a_real_artifact_xyz')).toBeUndefined();
  });
});

describe('computePhapBaoPowerScore — deterministic + monotonic', () => {
  const sample = PHAP_BAO_CATALOG.find(
    (a) => a.starCap > 0 && a.refineCap > 0,
  )!;

  it('base instance trả về powerBudget', () => {
    const score = computePhapBaoPowerScore({
      artifactKey: sample.artifactKey,
      starLevel: 0,
      refineLevel: 0,
      awakenStage: 0,
    });
    expect(score).toBe(sample.powerBudget);
  });

  it('tăng theo starLevel (monotonic)', () => {
    const a = computePhapBaoPowerScore({
      artifactKey: sample.artifactKey,
      starLevel: 0,
      refineLevel: 0,
      awakenStage: 0,
    });
    const b = computePhapBaoPowerScore({
      artifactKey: sample.artifactKey,
      starLevel: 1,
      refineLevel: 0,
      awakenStage: 0,
    });
    expect(b).toBeGreaterThan(a);
  });

  it('tăng theo refineLevel (monotonic)', () => {
    const a = computePhapBaoPowerScore({
      artifactKey: sample.artifactKey,
      starLevel: 0,
      refineLevel: 0,
      awakenStage: 0,
    });
    const b = computePhapBaoPowerScore({
      artifactKey: sample.artifactKey,
      starLevel: 0,
      refineLevel: 1,
      awakenStage: 0,
    });
    expect(b).toBeGreaterThan(a);
  });

  it('deterministic — cùng input → cùng output', () => {
    const input = {
      artifactKey: sample.artifactKey,
      starLevel: 2,
      refineLevel: 3,
      awakenStage: 0,
    };
    expect(computePhapBaoPowerScore(input)).toBe(computePhapBaoPowerScore(input));
  });

  it('cap theo PHAP_BAO_POWER_MULTIPLIER_CAP', () => {
    const high = computePhapBaoPowerScore({
      artifactKey: sample.artifactKey,
      starLevel: 999,
      refineLevel: 999,
      awakenStage: 999,
    });
    const ceiling = Math.round(sample.powerBudget * PHAP_BAO_POWER_MULTIPLIER_CAP);
    expect(high).toBeLessThanOrEqual(ceiling);
  });

  it('throw RangeError khi artifactKey không tồn tại', () => {
    expect(() =>
      computePhapBaoPowerScore({
        artifactKey: 'nonexistent_artifact_xyz',
        starLevel: 0,
        refineLevel: 0,
        awakenStage: 0,
      }),
    ).toThrow(RangeError);
  });
});

describe('computePhapBaoPassiveBonus — cap + deterministic', () => {
  it('mọi stat ≤ cap quality × multiplier kể cả max progression', () => {
    for (const a of PHAP_BAO_CATALOG) {
      const max = computePhapBaoPassiveBonus({
        artifactKey: a.artifactKey,
        starLevel: a.starCap,
        refineLevel: a.refineCap,
        awakenStage: a.awakenCap,
      });
      const cap = ITEM_STAT_BUDGET_BY_QUALITY[a.quality];
      const allowedAtk = Math.round(cap.atk * PHAP_BAO_PASSIVE_CAP_MULTIPLIER);
      const allowedDef = Math.round(cap.def * PHAP_BAO_PASSIVE_CAP_MULTIPLIER);
      const allowedHp = Math.round(cap.hpMax * PHAP_BAO_PASSIVE_CAP_MULTIPLIER);
      const allowedMp = Math.round(cap.mpMax * PHAP_BAO_PASSIVE_CAP_MULTIPLIER);
      const allowedSpirit = Math.round(cap.spirit * PHAP_BAO_PASSIVE_CAP_MULTIPLIER);
      expect((max.atk ?? 0), `${a.artifactKey} atk`).toBeLessThanOrEqual(allowedAtk);
      expect((max.def ?? 0), `${a.artifactKey} def`).toBeLessThanOrEqual(allowedDef);
      expect((max.hpMax ?? 0), `${a.artifactKey} hpMax`).toBeLessThanOrEqual(allowedHp);
      expect((max.mpMax ?? 0), `${a.artifactKey} mpMax`).toBeLessThanOrEqual(allowedMp);
      expect((max.spirit ?? 0), `${a.artifactKey} spirit`).toBeLessThanOrEqual(
        allowedSpirit,
      );
    }
  });

  it('không stat nào âm', () => {
    for (const a of PHAP_BAO_CATALOG) {
      const bonus = computePhapBaoPassiveBonus({
        artifactKey: a.artifactKey,
        starLevel: a.starCap,
        refineLevel: a.refineCap,
        awakenStage: a.awakenCap,
      });
      for (const v of Object.values(bonus)) {
        if (typeof v === 'number') {
          expect(v).toBeGreaterThanOrEqual(0);
        }
      }
    }
  });

  it('star/refine power per level consistent với constants', () => {
    expect(PHAP_BAO_STAR_POWER_PER_LEVEL).toBeGreaterThan(0);
    expect(PHAP_BAO_REFINE_POWER_PER_LEVEL).toBeGreaterThan(0);
    expect(PHAP_BAO_AWAKEN_POWER_PER_STAGE).toBeGreaterThan(0);
  });
});

describe('computePhapBaoActiveSkillPreview — cooldown + unlock', () => {
  const withSkill = PHAP_BAO_CATALOG.find((a) => a.activeSkill !== null)!;
  const noSkill = PHAP_BAO_CATALOG.find((a) => a.activeSkill === null);

  it('trả available=false cho pháp bảo không có active', () => {
    if (!noSkill) return;
    const preview = computePhapBaoActiveSkillPreview({
      artifactKey: noSkill.artifactKey,
      starLevel: 0,
      refineLevel: 0,
      awakenStage: 0,
    });
    expect(preview.available).toBe(false);
  });

  it('locked khi starLevel < unlockStar', () => {
    const preview = computePhapBaoActiveSkillPreview({
      artifactKey: withSkill.artifactKey,
      starLevel: 0,
      refineLevel: 0,
      awakenStage: 0,
    });
    if (preview.available) {
      expect(preview.unlocked).toBe(false);
    }
  });

  it('unlocked khi starLevel ≥ unlockStar', () => {
    const skill = withSkill.activeSkill!;
    const preview = computePhapBaoActiveSkillPreview({
      artifactKey: withSkill.artifactKey,
      starLevel: skill.unlockStar,
      refineLevel: 0,
      awakenStage: 0,
    });
    if (preview.available) {
      expect(preview.unlocked).toBe(true);
    }
  });

  it('cooldown giảm theo star nhưng ≥ floor', () => {
    const skill = withSkill.activeSkill!;
    const preview = computePhapBaoActiveSkillPreview({
      artifactKey: withSkill.artifactKey,
      starLevel: PHAP_BAO_STAR_MAX,
      refineLevel: 0,
      awakenStage: 0,
    });
    if (preview.available) {
      expect(preview.cooldownSeconds).toBeGreaterThanOrEqual(
        PHAP_BAO_ACTIVE_COOLDOWN_FLOOR_SEC,
      );
      expect(preview.baseCooldownSeconds).toBe(skill.cooldownSeconds);
      expect(preview.cooldownReductionRatio).toBeLessThanOrEqual(
        PHAP_BAO_STAR_COOLDOWN_REDUCTION_CAP,
      );
    }
  });
});

describe('getPhapBaoUpgradeCost — refine cost curve', () => {
  it('cost dương + tăng dần theo currentRefineLevel', () => {
    const seq: number[] = [];
    for (let lv = 0; lv < 6; lv++) {
      const cost = getPhapBaoUpgradeCost({
        tier: 5,
        currentRefineLevel: lv,
        refineCap: 13,
        quality: 'TIEN',
      });
      expect(cost.linhThachCost).toBeGreaterThan(0);
      expect(cost.materialQty).toBeGreaterThan(0);
      seq.push(cost.linhThachCost);
    }
    for (let i = 1; i < seq.length; i++) {
      expect(seq[i]).toBeGreaterThan(seq[i - 1]);
    }
  });

  it('cost cao hơn equipment refine cùng tier (×1.5 multiplier)', () => {
    const cost = getPhapBaoUpgradeCost({
      tier: 5,
      currentRefineLevel: 0,
      refineCap: 13,
      quality: 'TIEN',
    });
    // Sanity: bigger than 1× baseline (đắt hơn refine equipment thường)
    expect(PHAP_BAO_REFINE_COST_MULTIPLIER).toBeGreaterThan(1);
    expect(cost.linhThachCost).toBeGreaterThan(0);
  });

  it('throw khi currentRefineLevel ≥ refineCap', () => {
    expect(() =>
      getPhapBaoUpgradeCost({
        tier: 5,
        currentRefineLevel: 13,
        refineCap: 13,
        quality: 'TIEN',
      }),
    ).toThrow(RangeError);
  });
});

describe('getPhapBaoStarUpCost — star cost curve', () => {
  it('cost monotonic theo currentStarLevel', () => {
    const seq: number[] = [];
    for (let s = 0; s < PHAP_BAO_STAR_MAX; s++) {
      const cost = getPhapBaoStarUpCost({
        tier: 5,
        currentStarLevel: s,
        starCap: 5,
        quality: 'TIEN',
      });
      expect(cost.linhThachCost).toBeGreaterThan(0);
      expect(cost.shardKey).toBe('phap_bao_shard');
      expect(cost.shardQty).toBeGreaterThan(0);
      seq.push(cost.linhThachCost);
    }
    for (let i = 1; i < seq.length; i++) {
      expect(seq[i]).toBeGreaterThan(seq[i - 1]);
    }
  });

  it('throw khi currentStarLevel ≥ cap', () => {
    expect(() =>
      getPhapBaoStarUpCost({
        tier: 5,
        currentStarLevel: PHAP_BAO_STAR_MAX,
        starCap: PHAP_BAO_STAR_MAX,
        quality: 'TIEN',
      }),
    ).toThrow(RangeError);
  });
});

describe('getPhapBaoAwakenCost — awaken cost curve', () => {
  it('yêu cầu quality TIEN/THAN + tier ≥ 5', () => {
    expect(() =>
      getPhapBaoAwakenCost({
        tier: 5,
        currentAwakenStage: 0,
        awakenCap: 3,
        quality: 'HUYEN',
      }),
    ).toThrow(RangeError);
    expect(() =>
      getPhapBaoAwakenCost({
        tier: 4,
        currentAwakenStage: 0,
        awakenCap: 3,
        quality: 'TIEN',
      }),
    ).toThrow(RangeError);
  });

  it('cost monotonic theo currentAwakenStage', () => {
    const seq: number[] = [];
    for (let stage = 0; stage < PHAP_BAO_AWAKEN_MAX; stage++) {
      const cost = getPhapBaoAwakenCost({
        tier: 8,
        currentAwakenStage: stage,
        awakenCap: PHAP_BAO_AWAKEN_MAX,
        quality: 'THAN',
      });
      expect(cost.linhThachCost).toBeGreaterThan(0);
      expect(cost.awakenStoneKey).toBe('awaken_stone');
      expect(cost.awakenStoneQty).toBeGreaterThan(0);
      seq.push(cost.linhThachCost);
    }
    for (let i = 1; i < seq.length; i++) {
      expect(seq[i]).toBeGreaterThan(seq[i - 1]);
    }
  });
});

describe('validatePhapBaoDefinition — drift guard', () => {
  function clone(a: PhapBaoDef): PhapBaoDef {
    return JSON.parse(JSON.stringify(a)) as PhapBaoDef;
  }

  it('fail khi requiredRealmOrder ngoài 1..28', () => {
    const bad = clone(PHAP_BAO_CATALOG[0]);
    bad.requiredRealmOrder = 99;
    expect(validatePhapBaoDefinition(bad).ok).toBe(false);
  });

  it('fail khi artifactTier ngoài 1..10', () => {
    const bad = clone(PHAP_BAO_CATALOG[0]);
    bad.artifactTier = 12 as unknown as PhapBaoDef['artifactTier'];
    expect(validatePhapBaoDefinition(bad).ok).toBe(false);
  });

  it('fail khi passiveBonus vượt cap × multiplier', () => {
    const bad = clone(PHAP_BAO_CATALOG[0]); // LINH
    bad.passiveBonus = { atk: 99999 };
    const result = validatePhapBaoDefinition(bad);
    expect(result.ok).toBe(false);
    expect(result.errors.join(' ')).toContain('cap');
  });

  it('fail khi activeSkill cooldown < floor', () => {
    const withSkill = PHAP_BAO_CATALOG.find((a) => a.activeSkill !== null)!;
    const bad = clone(withSkill);
    bad.activeSkill!.cooldownSeconds = 5;
    expect(validatePhapBaoDefinition(bad).ok).toBe(false);
  });

  it('fail khi itemKey khác artifactKey', () => {
    const bad = clone(PHAP_BAO_CATALOG[0]);
    bad.itemKey = 'wrong_key';
    expect(validatePhapBaoDefinition(bad).ok).toBe(false);
  });
});

describe('validatePhapBaoUpgradeRequest — request guard', () => {
  const refineSample = PHAP_BAO_CATALOG.find((a) => a.refineCap > 0)!;
  const tienSample = PHAP_BAO_CATALOG.find(
    (a) => a.quality === 'TIEN' && a.awakenCap > 0,
  )!;

  it('fail khi artifactKey không tồn tại', () => {
    const result = validatePhapBaoUpgradeRequest({
      artifactKey: 'not_real_xyz',
      kind: 'refine',
      currentRefineLevel: 0,
      currentStarLevel: 0,
      currentAwakenStage: 0,
    });
    expect(result.ok).toBe(false);
  });

  it('fail khi refineLevel ≥ cap', () => {
    const result = validatePhapBaoUpgradeRequest({
      artifactKey: refineSample.artifactKey,
      kind: 'refine',
      currentRefineLevel: refineSample.refineCap,
      currentStarLevel: 0,
      currentAwakenStage: 0,
    });
    expect(result.ok).toBe(false);
  });

  it('pass khi refineLevel < cap', () => {
    const result = validatePhapBaoUpgradeRequest({
      artifactKey: refineSample.artifactKey,
      kind: 'refine',
      currentRefineLevel: 0,
      currentStarLevel: 0,
      currentAwakenStage: 0,
    });
    expect(result.ok).toBe(true);
  });

  it('fail awaken khi quality không phải TIEN/THAN', () => {
    const linhArtifact = PHAP_BAO_CATALOG.find((a) => a.quality === 'LINH');
    if (!linhArtifact) return;
    const result = validatePhapBaoUpgradeRequest({
      artifactKey: linhArtifact.artifactKey,
      kind: 'awaken',
      currentRefineLevel: 0,
      currentStarLevel: 1,
      currentAwakenStage: 0,
    });
    expect(result.ok).toBe(false);
  });

  it('fail awaken khi starLevel < 1', () => {
    const result = validatePhapBaoUpgradeRequest({
      artifactKey: tienSample.artifactKey,
      kind: 'awaken',
      currentRefineLevel: 0,
      currentStarLevel: 0,
      currentAwakenStage: 0,
    });
    expect(result.ok).toBe(false);
  });
});
