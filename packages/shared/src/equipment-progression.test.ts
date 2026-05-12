import { describe, expect, it } from 'vitest';
import { ITEMS, itemWithProgression } from './items';
import {
  EQUIPMENT_GEM_BONUS_RATIO_CAP,
  EQUIPMENT_SET_BONUS_CAPS,
  EQUIPMENT_TIERS,
  canEquipItemAtRealm,
  computeEquipmentPowerBudget,
  computeEquipmentPowerScore,
  deriveEquipmentProgressionMetadata,
  getEnhanceCapForTier,
  getEquipmentGradeWithinTier,
  getEquipmentTierForRealmOrder,
  getQualityMultiplier,
  getRequiredRealmOrderForTierGrade,
  getSetBonusCapForPieceCount,
  getSlotWeight,
  getSocketCapForTierAndQuality,
  getTierBasePower,
  validateEquipmentProgression,
} from './equipment-progression';
import type { EquipSlot, Quality } from './enums';

describe('equipment progression tiers', () => {
  it('EQUIPMENT_TIERS cover đủ realmOrder 1–28 đúng một lần', () => {
    const covered = new Set<number>();
    for (const tier of EQUIPMENT_TIERS) {
      for (let order = tier.minRealmOrder; order <= tier.maxRealmOrder; order += 1) {
        expect(covered.has(order), `realm ${order} duplicate`).toBe(false);
        covered.add(order);
      }
    }
    expect([...covered].sort((a, b) => a - b)).toEqual(
      Array.from({ length: 28 }, (_, i) => i + 1),
    );
  });

  it('mỗi realmOrder map đúng tier và required realm range', () => {
    const expected = [
      [1, 3],
      [4, 6],
      [7, 9],
      [10, 12],
      [13, 15],
      [16, 18],
      [19, 21],
      [22, 24],
      [25, 27],
      [28, 28],
    ];
    for (const [idx, [min, max]] of expected.entries()) {
      const tier = EQUIPMENT_TIERS[idx];
      expect(tier.minRealmOrder).toBe(min);
      expect(tier.maxRealmOrder).toBe(max);
      for (let realmOrder = min; realmOrder <= max; realmOrder += 1) {
        expect(getEquipmentTierForRealmOrder(realmOrder).tier).toBe(idx + 1);
      }
    }
  });

  it('grade I/II/III map đúng trong tier, tier 10 không có grade nội bộ', () => {
    expect(getEquipmentGradeWithinTier(1)).toBe('I');
    expect(getEquipmentGradeWithinTier(2)).toBe('II');
    expect(getEquipmentGradeWithinTier(3)).toBe('III');
    expect(getEquipmentGradeWithinTier(4)).toBe('I');
    expect(getEquipmentGradeWithinTier(5)).toBe('II');
    expect(getEquipmentGradeWithinTier(6)).toBe('III');
    expect(getEquipmentGradeWithinTier(28)).toBeNull();
    expect(getRequiredRealmOrderForTierGrade(2, 'I')).toBe(4);
    expect(getRequiredRealmOrderForTierGrade(2, 'II')).toBe(5);
    expect(getRequiredRealmOrderForTierGrade(2, 'III')).toBe(6);
    expect(getRequiredRealmOrderForTierGrade(10, null)).toBe(28);
  });
});

describe('equipment progression balance dials', () => {
  it('quality multiplier đúng', () => {
    expect(getQualityMultiplier('PHAM')).toBe(1);
    expect(getQualityMultiplier('LINH')).toBe(1.15);
    expect(getQualityMultiplier('HUYEN')).toBe(1.35);
    expect(getQualityMultiplier('TIEN')).toBe(1.6);
    expect(getQualityMultiplier('THAN')).toBe(1.9);
  });

  it('slot weight đúng cho slot hiện tại và alias design', () => {
    expect(getSlotWeight('WEAPON')).toBe(1);
    expect(getSlotWeight('ARMOR')).toBe(0.85);
    expect(getSlotWeight('helmet')).toBe(0.55);
    expect(getSlotWeight('BOOTS')).toBe(0.45);
    expect(getSlotWeight('ring')).toBe(0.4);
    expect(getSlotWeight('amulet')).toBe(0.4);
    expect(getSlotWeight('BELT')).toBe(0.35);
    expect(getSlotWeight('ARTIFACT_1')).toBe(0.7);
    expect(getSlotWeight('offhand')).toBe(0.7);
  });

  it('tier base power và enhance cap đúng theo tier', () => {
    const bases = [100, 260, 680, 1_750, 4_500, 11_500, 29_000, 72_000, 175_000, 420_000];
    const caps = [5, 7, 9, 11, 13, 15, 17, 19, 21, 23];
    for (let tier = 1; tier <= 10; tier += 1) {
      expect(getTierBasePower(tier)).toBe(bases[tier - 1]);
      expect(getEnhanceCapForTier(tier)).toBe(caps[tier - 1]);
    }
  });

  it('socket cap đúng theo tier + quality', () => {
    expect(getSocketCapForTierAndQuality(1, 'PHAM')).toBe(0);
    expect(getSocketCapForTierAndQuality(1, 'LINH')).toBe(1);
    expect(getSocketCapForTierAndQuality(1, 'THAN')).toBe(1);
    expect(getSocketCapForTierAndQuality(3, 'TIEN')).toBe(2);
    expect(getSocketCapForTierAndQuality(5, 'THAN')).toBe(3);
    expect(getSocketCapForTierAndQuality(10, 'THAN')).toBe(3);
  });

  it('gem bonus không vượt 20% và set bonus không vượt cap', () => {
    expect(EQUIPMENT_GEM_BONUS_RATIO_CAP).toBe(0.2);
    expect(EQUIPMENT_SET_BONUS_CAPS.twoPiece.max).toBeLessThanOrEqual(0.05);
    expect(EQUIPMENT_SET_BONUS_CAPS.fourPiece.max).toBeLessThanOrEqual(0.1);
    expect(EQUIPMENT_SET_BONUS_CAPS.sixPiece.max).toBeLessThanOrEqual(0.15);
    expect(getSetBonusCapForPieceCount(2)).toBe(0.05);
    expect(getSetBonusCapForPieceCount(4)).toBe(0.1);
    expect(getSetBonusCapForPieceCount(6)).toBe(0.15);
    expect(() =>
      computeEquipmentPowerScore({
        requiredRealmOrder: 1,
        quality: 'PHAM',
        slot: 'WEAPON',
        gemBonusRatio: 0.21,
      }),
    ).toThrow();
    expect(() =>
      computeEquipmentPowerScore({
        requiredRealmOrder: 1,
        quality: 'PHAM',
        slot: 'WEAPON',
        setBonusRatio: 0.16,
      }),
    ).toThrow();
  });
});

describe('equipment progression validation', () => {
  it('canEquipItemAtRealm trả false nếu chưa đủ, true nếu đủ', () => {
    const item = { slot: 'WEAPON' as EquipSlot, requiredRealmOrder: 4 };
    expect(canEquipItemAtRealm(item, 3)).toBe(false);
    expect(canEquipItemAtRealm(item, 4)).toBe(true);
    expect(canEquipItemAtRealm(item, 8)).toBe(true);
    expect(canEquipItemAtRealm({ requiredRealmOrder: 28 }, 1)).toBe(true);
  });

  it('computeEquipmentPowerScore deterministic và chặn enhance vượt cap', () => {
    const input = {
      requiredRealmOrder: 4,
      quality: 'HUYEN' as Quality,
      slot: 'WEAPON' as EquipSlot,
      enhanceLevel: 3,
      gemBonusRatio: 0.1,
      setBonusRatio: 0.05,
    };
    expect(computeEquipmentPowerScore(input)).toBe(computeEquipmentPowerScore(input));
    expect(computeEquipmentPowerScore(input)).toBeGreaterThan(computeEquipmentPowerBudget(input));
    expect(() =>
      computeEquipmentPowerScore({ ...input, requiredRealmOrder: 1, enhanceLevel: 6 }),
    ).toThrow();
  });

  it('validateEquipmentProgression chặn thiếu requiredRealmOrder và power vượt budget', () => {
    expect(
      validateEquipmentProgression({ key: 'bad', slot: 'WEAPON', quality: 'PHAM' }).errors,
    ).toContain('MISSING_REQUIRED_REALM_ORDER');
    const budget = computeEquipmentPowerBudget({
      requiredRealmOrder: 1,
      quality: 'PHAM',
      slot: 'WEAPON',
    });
    const result = validateEquipmentProgression({
      key: 'bad_power',
      slot: 'WEAPON',
      quality: 'PHAM',
      requiredRealmOrder: 1,
      powerBudget: budget + 1,
    });
    expect(result.ok).toBe(false);
    expect(result.errors).toContain('POWER_BUDGET_EXCEEDED');
  });

  it('derive metadata cung cấp tier/grade/realm/power/cap cho equipment', () => {
    const meta = deriveEquipmentProgressionMetadata({
      quality: 'THAN',
      slot: 'WEAPON',
      requiredRealmOrder: 28,
    });
    expect(meta?.equipmentTier).toBe(10);
    expect(meta?.equipmentGradeWithinTier).toBeNull();
    expect(meta?.requiredRealmKey).toBeDefined();
    expect(meta?.powerBudget).toBeGreaterThan(0);
    expect(meta?.maxEnhanceLevel).toBe(23);
    expect(meta?.maxSocketCount).toBe(3);
  });

  it('existing items không phá balance progression test', () => {
    const equipment = ITEMS.filter((item) => item.slot);
    expect(equipment.length).toBeGreaterThan(0);
    for (const item of equipment) {
      const enriched = itemWithProgression(item);
      expect(enriched.requiredRealmOrder, item.key).toBeGreaterThanOrEqual(1);
      expect(enriched.requiredRealmOrder, item.key).toBeLessThanOrEqual(28);
      expect(enriched.equipmentTier, item.key).toBeGreaterThanOrEqual(1);
      expect(enriched.equipmentTier, item.key).toBeLessThanOrEqual(10);
      expect(enriched.powerBudget, item.key).toBeGreaterThan(0);
      expect(enriched.maxEnhanceLevel, item.key).toBe(
        getEnhanceCapForTier(enriched.equipmentTier!),
      );
      expect(enriched.maxSocketCount, item.key).toBe(
        getSocketCapForTierAndQuality(enriched.equipmentTier!, item.quality),
      );
    }
  });
});
