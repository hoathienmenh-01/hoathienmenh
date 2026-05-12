/**
 * Phase 23.3 — Gear Resonance tests.
 *
 * Covers: same-tier / enhance / quality / elemental / hybrid active đúng,
 * không active khi thiếu slot, mọi resonance đi qua cap.
 */

import { describe, expect, it } from 'vitest';
import type { ItemDef } from './items';
import type { EquipSlot, Quality } from './enums';
import type { ElementKey } from './combat';
import {
  RESONANCE_ENHANCE_TOTAL_CAP,
  computeElementalResonance,
  computeGearResonance,
  validateResonanceDefinition,
  type GearResonanceComputeInput,
  type GearResonanceEffect,
} from './equipment-resonance';
import { sumEnvelope } from './equipment-set-bonus';

function makeInput(opts: {
  id: string;
  slot: EquipSlot;
  tier?: number;
  element?: ElementKey | null;
  quality?: Quality;
  enhanceLevel?: number;
}): GearResonanceComputeInput {
  return {
    piece: {
      inventoryItemId: opts.id,
      itemKey: `mock_${opts.slot}`,
      equippedSlot: opts.slot,
      quality: opts.quality ?? 'LINH',
      equipmentTier: opts.tier,
      equipmentElement: opts.element ?? null,
      enhanceLevel: opts.enhanceLevel ?? 0,
    },
    item: {
      key: `mock_${opts.slot}`,
      name: 'Mock',
      description: '',
      kind: 'WEAPON',
      quality: opts.quality ?? 'LINH',
      stackable: false,
      slot: opts.slot,
      equipmentTier: opts.tier,
      equipmentElement: opts.element ?? undefined,
      bonuses: { atk: 50 },
      price: 0,
    } as ItemDef,
  };
}

const SIX_SLOTS: readonly EquipSlot[] = [
  'WEAPON',
  'ARMOR',
  'HAT',
  'BELT',
  'BOOTS',
  'ARTIFACT_1',
];

function makeFullBody(opts: {
  tier?: number;
  element?: ElementKey | null;
  quality?: Quality;
  enhanceLevel?: number;
}): GearResonanceComputeInput[] {
  return SIX_SLOTS.map((slot, i) =>
    makeInput({ id: `p-${i}-${slot}`, slot, ...opts }),
  );
}

describe('computeGearResonance — pieceCount', () => {
  it('chỉ 5 piece body → không active any pure-tier/enhance/quality/elemental resonance', () => {
    const inputs = makeFullBody({ tier: 4, element: 'kim', quality: 'LINH' }).slice(0, 5);
    const summary = computeGearResonance(inputs);
    expect(summary.pieceCount).toBe(5);
    expect(summary.active.filter((e) => e.kind === 'SAME_TIER' || e.kind === 'ENHANCE' || e.kind === 'QUALITY' || e.kind === 'ELEMENTAL')).toEqual([]);
  });

  it('duplicate inventoryItemId không tính 2 piece', () => {
    const a = makeInput({ id: 'a', slot: 'WEAPON', tier: 4, element: 'kim' });
    const b = makeInput({ id: 'a', slot: 'ARMOR', tier: 4, element: 'kim' });
    const summary = computeGearResonance([a, b]);
    expect(summary.pieceCount).toBe(1);
  });

  it('2 item cùng slot → chỉ tính 1', () => {
    const a = makeInput({ id: 'a', slot: 'WEAPON', tier: 4, element: 'kim' });
    const b = makeInput({ id: 'b', slot: 'WEAPON', tier: 4, element: 'kim' });
    const summary = computeGearResonance([a, b]);
    expect(summary.pieceCount).toBe(1);
  });
});

describe('Same-Tier Resonance', () => {
  it('full 6 piece body tier 4 → active SAME_TIER với minTier=4', () => {
    const inputs = makeFullBody({ tier: 4 });
    const summary = computeGearResonance(inputs);
    const effect = summary.active.find((e) => e.kind === 'SAME_TIER');
    expect(effect).toBeDefined();
    expect(effect?.meta?.minTier).toBe(4);
  });

  it('1 trong 6 piece thiếu tier → SAME_TIER không active', () => {
    const inputs = makeFullBody({ tier: 4 });
    inputs[2].piece.equipmentTier = undefined;
    inputs[2].item.equipmentTier = undefined;
    const summary = computeGearResonance(inputs);
    expect(summary.active.find((e) => e.kind === 'SAME_TIER')).toBeUndefined();
  });
});

describe('Enhance Resonance', () => {
  it('all +5 → 1 mốc active', () => {
    const inputs = makeFullBody({ tier: 4, enhanceLevel: 5 });
    const summary = computeGearResonance(inputs);
    const enhances = summary.active.filter((e) => e.kind === 'ENHANCE');
    expect(enhances.length).toBe(1);
    expect(enhances[0].meta?.minLevel).toBe(5);
  });

  it('all +12 → 3 mốc active (+5, +8, +12)', () => {
    const inputs = makeFullBody({ tier: 4, enhanceLevel: 12 });
    const summary = computeGearResonance(inputs);
    const enhances = summary.active.filter((e) => e.kind === 'ENHANCE');
    expect(enhances.map((e) => e.meta?.minLevel)).toEqual([5, 8, 12]);
  });

  it('all +15 → 4 mốc active, tổng cap = RESONANCE_ENHANCE_TOTAL_CAP', () => {
    const inputs = makeFullBody({ tier: 4, enhanceLevel: 15 });
    const summary = computeGearResonance(inputs);
    const enhances = summary.active.filter((e) => e.kind === 'ENHANCE');
    const total = enhances.reduce((acc, e) => acc + sumEnvelope(e.ratio), 0);
    expect(total).toBeLessThanOrEqual(RESONANCE_ENHANCE_TOTAL_CAP + 1e-9);
    expect(enhances.length).toBe(4);
  });

  it('1 món +4, còn lại +15 → minLevel=4 → không active mốc nào', () => {
    const inputs = makeFullBody({ tier: 4, enhanceLevel: 15 });
    inputs[0].piece.enhanceLevel = 4;
    const summary = computeGearResonance(inputs);
    expect(summary.active.find((e) => e.kind === 'ENHANCE')).toBeUndefined();
  });
});

describe('Quality Resonance', () => {
  it('all HUYEN → QUALITY_HUYEN active', () => {
    const inputs = makeFullBody({ tier: 4, quality: 'HUYEN' });
    const summary = computeGearResonance(inputs);
    const q = summary.active.find((e) => e.kind === 'QUALITY');
    expect(q?.meta?.minQuality).toBe('HUYEN');
  });

  it('all THAN → QUALITY_THAN active', () => {
    const inputs = makeFullBody({ tier: 4, quality: 'THAN' });
    const summary = computeGearResonance(inputs);
    const q = summary.active.find((e) => e.kind === 'QUALITY');
    expect(q?.meta?.minQuality).toBe('THAN');
  });

  it('1 món LINH, còn lại TIEN → không active vì min quality LINH', () => {
    const inputs = makeFullBody({ tier: 4, quality: 'TIEN' });
    inputs[1].piece.quality = 'LINH';
    const summary = computeGearResonance(inputs);
    expect(summary.active.find((e) => e.kind === 'QUALITY')).toBeUndefined();
  });
});

describe('Elemental Resonance', () => {
  it('4/6 cùng hệ Kim → ELEMENTAL_4_OF_6_KIM active', () => {
    const inputs = makeFullBody({ tier: 4, element: 'kim' });
    inputs[0].piece.equipmentElement = 'thuy';
    inputs[0].item.equipmentElement = 'thuy';
    inputs[1].piece.equipmentElement = 'tho';
    inputs[1].item.equipmentElement = 'tho';
    const summary = computeGearResonance(inputs);
    const el = summary.active.find((e) => e.kind === 'ELEMENTAL');
    expect(el?.meta?.element).toBe('kim');
    expect(el?.meta?.count).toBe(4);
  });

  it('6/6 cùng hệ Hoả → ELEMENTAL 6_OF_6 active, ratio cao hơn 4/6', () => {
    const four = makeFullBody({ tier: 4, element: 'hoa' });
    four[0].piece.equipmentElement = 'tho';
    four[0].item.equipmentElement = 'tho';
    four[1].piece.equipmentElement = 'thuy';
    four[1].item.equipmentElement = 'thuy';
    const six = makeFullBody({ tier: 4, element: 'hoa' });
    const summary4 = computeGearResonance(four);
    const summary6 = computeGearResonance(six);
    const el4 = summary4.active.find((e) => e.kind === 'ELEMENTAL');
    const el6 = summary6.active.find((e) => e.kind === 'ELEMENTAL');
    expect(sumEnvelope(el6!.ratio)).toBeGreaterThan(sumEnvelope(el4!.ratio));
  });

  it('3/6 cùng hệ → không active elemental', () => {
    const inputs = makeFullBody({ tier: 4, element: 'kim' });
    inputs[0].piece.equipmentElement = 'thuy';
    inputs[0].item.equipmentElement = 'thuy';
    inputs[1].piece.equipmentElement = 'tho';
    inputs[1].item.equipmentElement = 'tho';
    inputs[2].piece.equipmentElement = 'hoa';
    inputs[2].item.equipmentElement = 'hoa';
    const summary = computeGearResonance(inputs);
    expect(summary.active.find((e) => e.kind === 'ELEMENTAL')).toBeUndefined();
  });
});

describe('Hybrid Resonance', () => {
  it('3 Mộc + 3 Hoả (tương sinh) → HYBRID_MOC_HOA active', () => {
    const inputs: GearResonanceComputeInput[] = [
      makeInput({ id: '1', slot: 'WEAPON', tier: 4, element: 'moc' }),
      makeInput({ id: '2', slot: 'ARMOR', tier: 4, element: 'moc' }),
      makeInput({ id: '3', slot: 'HAT', tier: 4, element: 'moc' }),
      makeInput({ id: '4', slot: 'BELT', tier: 4, element: 'hoa' }),
      makeInput({ id: '5', slot: 'BOOTS', tier: 4, element: 'hoa' }),
      makeInput({ id: '6', slot: 'ARTIFACT_1', tier: 4, element: 'hoa' }),
    ];
    const summary = computeGearResonance(inputs);
    const hybrid = summary.active.find((e) => e.kind === 'HYBRID');
    expect(hybrid?.meta?.from).toBe('moc');
    expect(hybrid?.meta?.to).toBe('hoa');
  });

  it('Mộc + Thổ (KHÔNG tương sinh — Mộc khắc Thổ) → HYBRID không active', () => {
    const inputs: GearResonanceComputeInput[] = [
      makeInput({ id: '1', slot: 'WEAPON', tier: 4, element: 'moc' }),
      makeInput({ id: '2', slot: 'ARMOR', tier: 4, element: 'moc' }),
      makeInput({ id: '3', slot: 'HAT', tier: 4, element: 'moc' }),
      makeInput({ id: '4', slot: 'BELT', tier: 4, element: 'tho' }),
      makeInput({ id: '5', slot: 'BOOTS', tier: 4, element: 'tho' }),
      makeInput({ id: '6', slot: 'ARTIFACT_1', tier: 4, element: 'tho' }),
    ];
    const summary = computeGearResonance(inputs);
    expect(summary.active.find((e) => e.kind === 'HYBRID')).toBeUndefined();
  });
});

describe('Resonance cap', () => {
  it('tổng resonance không vượt cap mặc định 0.2', () => {
    const inputs = makeFullBody({ tier: 8, element: 'kim', quality: 'THAN', enhanceLevel: 15 });
    const summary = computeGearResonance(inputs);
    expect(sumEnvelope(summary.totalRatio)).toBeLessThanOrEqual(0.2 + 1e-6);
  });
});

describe('computeElementalResonance', () => {
  it('chỉ trả ELEMENTAL/HYBRID', () => {
    const inputs = makeFullBody({ tier: 4, element: 'kim', quality: 'HUYEN', enhanceLevel: 5 });
    const out = computeElementalResonance(inputs);
    for (const e of out) {
      expect(['ELEMENTAL', 'HYBRID']).toContain(e.kind);
    }
  });
});

describe('validateResonanceDefinition', () => {
  it('reject ratio total > 12%', () => {
    const effect: GearResonanceEffect = {
      kind: 'SAME_TIER',
      key: 'BAD',
      ratio: { atkRatio: 0.5 },
      description: 'bad',
    };
    const result = validateResonanceDefinition(effect);
    expect(result.ok).toBe(false);
    expect(result.errors).toContain('INVALID_RATIO_TOTAL');
  });

  it('accept default same-tier effect', () => {
    const inputs = makeFullBody({ tier: 4 });
    const summary = computeGearResonance(inputs);
    const sameTier = summary.active.find((e) => e.kind === 'SAME_TIER');
    expect(sameTier).toBeDefined();
    expect(validateResonanceDefinition(sameTier!).ok).toBe(true);
  });
});
