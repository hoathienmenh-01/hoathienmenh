/**
 * Phase 14.3.A — Tribulation foundation helpers test.
 *
 * Cover:
 *   - `tribulationRequiredForBreakthrough`: cycle qua catalog (kim_dan→nguyen_anh
 *     true; phamnhan→luyenkhi false; null next false).
 *   - `composeTribulationSupports`: empty → 0; single + clamp per-entry;
 *     multi sum + total clamp; debuff (negative) clamp đối xứng.
 *   - `computeTribulationSuccessChance`: base theo severity; supports add;
 *     element advantage/penalty; floor/ceil clamp.
 *   - `summarizeTribulationRewardHint` / `summarizeTribulationPenaltyHint`:
 *     pass-through đúng + BigInt → string.
 */

import { describe, it, expect } from 'vitest';
import { TRIBULATIONS, getTribulationDef } from './tribulation';
import {
  TRIBULATION_BASE_SUCCESS_CHANCE_BY_SEVERITY,
  TRIBULATION_ELEMENT_AFFINITY_BONUS,
  TRIBULATION_ELEMENT_AFFINITY_PENALTY,
  TRIBULATION_SUCCESS_CHANCE_CEIL,
  TRIBULATION_SUCCESS_CHANCE_FLOOR,
  TRIBULATION_SUPPORT_PER_ENTRY_CEIL,
  TRIBULATION_SUPPORT_TOTAL_CEIL,
  composeTribulationSupports,
  computeTribulationSuccessChance,
  summarizeTribulationPenaltyHint,
  summarizeTribulationRewardHint,
  tribulationRequiredForBreakthrough,
  type TribulationSupportEntry,
} from './tribulation-foundation';

describe('Phase 14.3.A — tribulationRequiredForBreakthrough', () => {
  it('returns true cho transition có TribulationDef trong catalog', () => {
    expect(
      tribulationRequiredForBreakthrough('kim_dan', 'nguyen_anh'),
    ).toBe(true);
    expect(
      tribulationRequiredForBreakthrough('hoa_than', 'luyen_hu'),
    ).toBe(true);
    expect(
      tribulationRequiredForBreakthrough('chuan_thanh', 'thanh_nhan'),
    ).toBe(true);
  });

  it('returns false cho low-tier transition không có catalog entry', () => {
    expect(
      tribulationRequiredForBreakthrough('phamnhan', 'luyenkhi'),
    ).toBe(false);
    expect(
      tribulationRequiredForBreakthrough('luyenkhi', 'truc_co'),
    ).toBe(false);
    expect(
      tribulationRequiredForBreakthrough('truc_co', 'kim_dan'),
    ).toBe(false);
  });

  it('returns false khi toRealmKey null/undefined (đã ở đỉnh)', () => {
    expect(tribulationRequiredForBreakthrough('thanh_nhan', null)).toBe(false);
    expect(
      tribulationRequiredForBreakthrough('thanh_nhan', undefined),
    ).toBe(false);
    expect(tribulationRequiredForBreakthrough('thanh_nhan', '')).toBe(false);
  });

  it('returns false khi from/to reversed (catalog directional)', () => {
    expect(
      tribulationRequiredForBreakthrough('nguyen_anh', 'kim_dan'),
    ).toBe(false);
  });
});

describe('Phase 14.3.A — composeTribulationSupports', () => {
  it('empty entries → totalBonus=0, no caps hit', () => {
    const r = composeTribulationSupports([]);
    expect(r.totalBonus).toBe(0);
    expect(r.perEntryCapHit).toBe(false);
    expect(r.totalCapHit).toBe(false);
  });

  it('single entry trong cap → pass-through bonus', () => {
    const e: TribulationSupportEntry = {
      source: 'item',
      key: 'pill_lung_huyet',
      bonus: 0.05,
    };
    const r = composeTribulationSupports([e]);
    expect(r.totalBonus).toBeCloseTo(0.05);
    expect(r.perEntryCapHit).toBe(false);
  });

  it('per-entry cap clamp khi entry > 0.10', () => {
    const e: TribulationSupportEntry = {
      source: 'item',
      key: 'broken_mega_pill',
      bonus: 0.5,
    };
    const r = composeTribulationSupports([e]);
    expect(r.totalBonus).toBeCloseTo(TRIBULATION_SUPPORT_PER_ENTRY_CEIL);
    expect(r.perEntryCapHit).toBe(true);
  });

  it('multi entries sum + total cap khi tổng > 0.30', () => {
    // 5 entries × 0.10 = 0.50 → clamp 0.30
    const entries: TribulationSupportEntry[] = Array.from(
      { length: 5 },
      (_, i) => ({
        source: 'item' as const,
        key: `support_${i}`,
        bonus: TRIBULATION_SUPPORT_PER_ENTRY_CEIL,
      }),
    );
    const r = composeTribulationSupports(entries);
    expect(r.totalBonus).toBeCloseTo(TRIBULATION_SUPPORT_TOTAL_CEIL);
    expect(r.totalCapHit).toBe(true);
  });

  it('negative debuff entry clamp đối xứng', () => {
    const e: TribulationSupportEntry = {
      source: 'buff',
      key: 'tao_ma_debuff',
      bonus: -0.5,
    };
    const r = composeTribulationSupports([e]);
    expect(r.totalBonus).toBeCloseTo(-TRIBULATION_SUPPORT_PER_ENTRY_CEIL);
    expect(r.perEntryCapHit).toBe(true);
  });

  it('multi negative entries clamp tổng đối xứng -0.30', () => {
    const entries: TribulationSupportEntry[] = Array.from(
      { length: 5 },
      (_, i) => ({
        source: 'buff' as const,
        key: `debuff_${i}`,
        bonus: -TRIBULATION_SUPPORT_PER_ENTRY_CEIL,
      }),
    );
    const r = composeTribulationSupports(entries);
    expect(r.totalBonus).toBeCloseTo(-TRIBULATION_SUPPORT_TOTAL_CEIL);
    expect(r.totalCapHit).toBe(true);
  });

  it('NaN bonus → fallback 0 (không crash compose)', () => {
    const e: TribulationSupportEntry = {
      source: 'item',
      key: 'broken_data',
      bonus: NaN,
    };
    const r = composeTribulationSupports([e]);
    expect(r.totalBonus).toBe(0);
  });

  it('mixed positive + negative → net additive sum', () => {
    const entries: TribulationSupportEntry[] = [
      { source: 'item', key: 'pill_a', bonus: 0.08 },
      { source: 'buff', key: 'debuff_a', bonus: -0.03 },
    ];
    const r = composeTribulationSupports(entries);
    expect(r.totalBonus).toBeCloseTo(0.05);
    expect(r.perEntryCapHit).toBe(false);
    expect(r.totalCapHit).toBe(false);
  });
});

describe('Phase 14.3.A — computeTribulationSuccessChance', () => {
  it('minor severity base = 0.75 khi không support, không element', () => {
    const def = getTribulationDef('tribulation_kim_dan_nguyen_anh');
    expect(def).toBeDefined();
    const r = computeTribulationSuccessChance({ def: def! });
    expect(r.base).toBe(TRIBULATION_BASE_SUCCESS_CHANCE_BY_SEVERITY.minor);
    expect(r.supportBonus).toBe(0);
    expect(r.elementAdjustment).toBe(0);
    expect(r.final).toBeCloseTo(0.75);
    expect(r.floorHit).toBe(false);
    expect(r.ceilHit).toBe(false);
  });

  it('saint severity base = 0.20 (endgame harsh)', () => {
    const def = getTribulationDef('tribulation_chuan_thanh_thanh_nhan');
    expect(def).toBeDefined();
    const r = computeTribulationSuccessChance({ def: def! });
    expect(r.final).toBeCloseTo(0.2);
  });

  it('supports add additive bonus vào base', () => {
    const def = getTribulationDef('tribulation_kim_dan_nguyen_anh')!;
    const supports = composeTribulationSupports([
      { source: 'item', key: 'pill_a', bonus: 0.05 },
    ]);
    const r = computeTribulationSuccessChance({ def, supports });
    expect(r.supportBonus).toBeCloseTo(0.05);
    expect(r.final).toBeCloseTo(0.8);
  });

  it('element affinity bonus khi primary KHẮC kiep dominant element', () => {
    // hoa kiếp (Hoả Diệt Kiếp) — dominant = hoa. Primary thuy KHẮC hoa → bonus.
    const def = getTribulationDef('tribulation_hoa_than_luyen_hu')!;
    const r = computeTribulationSuccessChance({
      def,
      primaryElement: 'thuy',
    });
    expect(r.elementAdjustment).toBeCloseTo(TRIBULATION_ELEMENT_AFFINITY_BONUS);
    expect(r.final).toBeCloseTo(0.55 + TRIBULATION_ELEMENT_AFFINITY_BONUS);
  });

  it('element affinity penalty khi primary BỊ KHẮC bởi kiep dominant element', () => {
    // hoa kiếp dominant. Primary kim BỊ KHẮC bởi hoa → penalty.
    const def = getTribulationDef('tribulation_hoa_than_luyen_hu')!;
    const r = computeTribulationSuccessChance({
      def,
      primaryElement: 'kim',
    });
    expect(r.elementAdjustment).toBeCloseTo(
      -TRIBULATION_ELEMENT_AFFINITY_PENALTY,
    );
    expect(r.final).toBeCloseTo(0.55 - TRIBULATION_ELEMENT_AFFINITY_PENALTY);
  });

  it('element affinity neutral cho Tâm kiếp (element=null) bất kể primary', () => {
    // do_kiep → nhan_tien = Tâm kiếp.
    const def = getTribulationDef('tribulation_do_kiep_nhan_tien')!;
    const r = computeTribulationSuccessChance({
      def,
      primaryElement: 'kim',
    });
    expect(r.elementAdjustment).toBe(0);
  });

  it('element affinity neutral khi primary missing (legacy character)', () => {
    const def = getTribulationDef('tribulation_hoa_than_luyen_hu')!;
    const r = computeTribulationSuccessChance({
      def,
      primaryElement: null,
    });
    expect(r.elementAdjustment).toBe(0);
  });

  it('floor clamp: full debuff không kéo final < 0.05', () => {
    const def = getTribulationDef('tribulation_chuan_thanh_thanh_nhan')!; // saint base 0.20
    const supports = composeTribulationSupports(
      Array.from({ length: 5 }, (_, i) => ({
        source: 'buff' as const,
        key: `debuff_${i}`,
        bonus: -TRIBULATION_SUPPORT_PER_ENTRY_CEIL,
      })),
    );
    // 0.20 - 0.30 = -0.10 → clamp 0.05.
    const r = computeTribulationSuccessChance({ def, supports });
    expect(r.final).toBe(TRIBULATION_SUCCESS_CHANCE_FLOOR);
    expect(r.floorHit).toBe(true);
  });

  it('ceil clamp: full buff không đẩy final > 0.95', () => {
    const def = getTribulationDef('tribulation_kim_dan_nguyen_anh')!; // minor base 0.75
    const supports = composeTribulationSupports(
      Array.from({ length: 5 }, (_, i) => ({
        source: 'item' as const,
        key: `pill_${i}`,
        bonus: TRIBULATION_SUPPORT_PER_ENTRY_CEIL,
      })),
    );
    // 0.75 + 0.30 = 1.05 → clamp 0.95.
    const r = computeTribulationSuccessChance({ def, supports });
    expect(r.final).toBe(TRIBULATION_SUCCESS_CHANCE_CEIL);
    expect(r.ceilHit).toBe(true);
  });

  it('full build minor + advantage element vẫn cap 0.95', () => {
    const def = getTribulationDef('tribulation_hoa_than_luyen_hu')!; // major 0.55
    const supports = composeTribulationSupports([
      { source: 'item', key: 'a', bonus: 0.1 },
      { source: 'buff', key: 'b', bonus: 0.1 },
      { source: 'talent', key: 'c', bonus: 0.1 },
    ]);
    // 0.55 + 0.30 + 0.05 (thuy advantage) = 0.90 → no clamp.
    const r = computeTribulationSuccessChance({
      def,
      supports,
      primaryElement: 'thuy',
    });
    expect(r.final).toBeCloseTo(0.9);
    expect(r.ceilHit).toBe(false);
  });
});

describe('Phase 14.3.A — summarizeTribulationRewardHint', () => {
  it('serialize BigInt expBonus → string + pass-through other fields', () => {
    const def = getTribulationDef('tribulation_kim_dan_nguyen_anh')!;
    const hint = summarizeTribulationRewardHint(def);
    expect(hint.linhThach).toBe(def.reward.linhThach);
    expect(hint.expBonus).toBe(def.reward.expBonus.toString());
    expect(typeof hint.expBonus).toBe('string');
    expect(hint.titleKey).toBe(def.reward.titleKey);
    expect(hint.uniqueDropChance).toBe(def.reward.uniqueDropChance);
    expect(hint.uniqueDropItemKey).toBe(def.reward.uniqueDropItemKey);
  });

  it('every catalog entry serialize không crash', () => {
    for (const def of TRIBULATIONS) {
      const hint = summarizeTribulationRewardHint(def);
      expect(hint.expBonus).toMatch(/^\d+$/);
    }
  });
});

describe('Phase 14.3.A — summarizeTribulationPenaltyHint', () => {
  it('pass-through 4 field penalty 1:1', () => {
    const def = getTribulationDef('tribulation_kim_dan_nguyen_anh')!;
    const hint = summarizeTribulationPenaltyHint(def);
    expect(hint.expLossRatio).toBe(def.failurePenalty.expLossRatio);
    expect(hint.cooldownMinutes).toBe(def.failurePenalty.cooldownMinutes);
    expect(hint.taoMaDebuffChance).toBe(def.failurePenalty.taoMaDebuffChance);
    expect(hint.taoMaDebuffDurationMinutes).toBe(
      def.failurePenalty.taoMaDebuffDurationMinutes,
    );
  });
});
