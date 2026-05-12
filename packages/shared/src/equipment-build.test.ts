/**
 * Phase 23.3 — Equipment build summary tests.
 *
 * Covers: orchestrator gộp set + resonance + element, tổng cap không vượt
 * EQUIPMENT_BUILD_TOTAL_BONUS_CAP, stat aggregation không double-count.
 */

import { describe, expect, it } from 'vitest';
import type { ItemDef } from './items';
import type { EquipSlot, Quality } from './enums';
import type { ElementKey } from './combat';
import {
  EQUIPMENT_BUILD_TOTAL_BONUS_CAP,
  applyBuildBonusRatio,
  getBuildBonusRatio,
  summarizeEquipmentBuild,
  type EquipmentBuildInputPiece,
} from './equipment-build';
import { sumEnvelope } from './equipment-set-bonus';

const SIX_SLOTS: readonly EquipSlot[] = [
  'WEAPON',
  'ARMOR',
  'HAT',
  'BELT',
  'BOOTS',
  'ARTIFACT_1',
];

function makeInput(opts: {
  id: string;
  slot: EquipSlot;
  tier: number;
  element: ElementKey | null;
  quality?: Quality;
  enhanceLevel?: number;
}): EquipmentBuildInputPiece {
  return {
    piece: {
      inventoryItemId: opts.id,
      itemKey: `mock_${opts.slot}`,
      equippedSlot: opts.slot,
      quality: opts.quality ?? 'LINH',
      equipmentTier: opts.tier,
      equipmentElement: opts.element,
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
      bonuses: { atk: 100 },
      powerBudget: 200,
      computedPowerScore: 200,
      price: 0,
    } as ItemDef,
  };
}

function fullBody(opts: {
  tier: number;
  element: ElementKey | null;
  quality?: Quality;
  enhanceLevel?: number;
}) {
  return SIX_SLOTS.map((slot, i) =>
    makeInput({ id: `b-${i}-${slot}`, slot, ...opts }),
  );
}

describe('summarizeEquipmentBuild', () => {
  it('pieceCount = số slot equip (dedup)', () => {
    const inputs = fullBody({ tier: 4, element: 'kim' });
    const summary = summarizeEquipmentBuild(inputs);
    expect(summary.pieceCount).toBe(6);
  });

  it('mainElement = element dominant ≥ 4/6', () => {
    const inputs = fullBody({ tier: 4, element: 'kim' });
    inputs[0].piece.equipmentElement = 'thuy';
    inputs[0].item.equipmentElement = 'thuy';
    const summary = summarizeEquipmentBuild(inputs);
    expect(summary.mainElement).toBe('kim');
  });

  it('mainElement null khi không hệ nào ≥ 4', () => {
    const inputs = [
      makeInput({ id: '1', slot: 'WEAPON', tier: 4, element: 'kim' }),
      makeInput({ id: '2', slot: 'ARMOR', tier: 4, element: 'thuy' }),
      makeInput({ id: '3', slot: 'HAT', tier: 4, element: 'tho' }),
      makeInput({ id: '4', slot: 'BELT', tier: 4, element: 'moc' }),
      makeInput({ id: '5', slot: 'BOOTS', tier: 4, element: 'hoa' }),
      makeInput({ id: '6', slot: 'ARTIFACT_1', tier: 4, element: 'kim' }),
    ];
    const summary = summarizeEquipmentBuild(inputs);
    expect(summary.mainElement).toBeNull();
  });

  it('activeSetCount khớp số set ≥ 2 piece', () => {
    const inputs = fullBody({ tier: 4, element: 'kim' });
    const summary = summarizeEquipmentBuild(inputs);
    expect(summary.activeSetCount).toBe(1);
    expect(summary.activeSets[0].setKey).toBe('kim_phong_set');
  });

  it('tổng bonus ratio không vượt EQUIPMENT_BUILD_TOTAL_BONUS_CAP', () => {
    const inputs = fullBody({ tier: 8, element: 'kim', quality: 'THAN', enhanceLevel: 15 });
    const summary = summarizeEquipmentBuild(inputs);
    expect(sumEnvelope(summary.totalBonusRatio)).toBeLessThanOrEqual(
      EQUIPMENT_BUILD_TOTAL_BONUS_CAP + 1e-6,
    );
  });

  it('resonance tier escalate theo số effect', () => {
    const empty = summarizeEquipmentBuild([]);
    expect(empty.resonanceTier).toBe('NONE');

    const tuned = fullBody({ tier: 4, element: 'kim' });
    expect(summarizeEquipmentBuild(tuned).resonanceTier).not.toBe('NONE');
  });

  it('totalPowerScore tăng theo số piece equip', () => {
    const oneInput = [makeInput({ id: '1', slot: 'WEAPON', tier: 4, element: 'kim' })];
    const summaryOne = summarizeEquipmentBuild(oneInput);
    const inputs = fullBody({ tier: 4, element: 'kim' });
    const summarySix = summarizeEquipmentBuild(inputs);
    expect(summaryOne.totalPowerScore).toBeGreaterThan(0);
    expect(summarySix.totalPowerScore).toBeGreaterThan(summaryOne.totalPowerScore);
  });

  it('không thay đổi khi piece equippedSlot=null bị bỏ qua', () => {
    const inputs = fullBody({ tier: 4, element: 'kim' });
    inputs[0].piece.equippedSlot = null;
    const summary = summarizeEquipmentBuild(inputs);
    expect(summary.pieceCount).toBe(5);
  });

  it('duplicate inventoryItemId không double-count', () => {
    const inputs = fullBody({ tier: 4, element: 'kim' });
    // Inject duplicate id of first piece.
    inputs[1].piece.inventoryItemId = inputs[0].piece.inventoryItemId;
    const summary = summarizeEquipmentBuild(inputs);
    expect(summary.pieceCount).toBe(5);
  });
});

describe('applyBuildBonusRatio', () => {
  it('atk = baseline.atk * ratio.atkRatio, round int', () => {
    const out = applyBuildBonusRatio(
      { atk: 1000, def: 1000, hpMax: 10000, mpMax: 1000, spirit: 500 },
      { atkRatio: 0.1, defRatio: 0.05 },
    );
    expect(out.atk).toBe(100);
    expect(out.def).toBe(50);
    expect(out.hpMax).toBe(0);
    expect(out.mpMax).toBe(0);
    expect(out.spirit).toBe(0);
  });

  it('ratio 0 → bonus 0', () => {
    const out = applyBuildBonusRatio(
      { atk: 1000, def: 1000, hpMax: 10000, mpMax: 1000, spirit: 500 },
      {},
    );
    expect(out).toEqual({ atk: 0, def: 0, hpMax: 0, mpMax: 0, spirit: 0 });
  });

  it('integer round-trip stable', () => {
    const ratio = getBuildBonusRatio(fullBody({ tier: 4, element: 'kim' }));
    const out1 = applyBuildBonusRatio(
      { atk: 1000, def: 1000, hpMax: 1000, mpMax: 1000, spirit: 1000 },
      ratio,
    );
    const out2 = applyBuildBonusRatio(
      { atk: 1000, def: 1000, hpMax: 1000, mpMax: 1000, spirit: 1000 },
      ratio,
    );
    expect(out1).toEqual(out2);
  });
});

describe('Equip/unequip recompute', () => {
  it('thêm piece thứ 4 nâng pieceCount → 4-piece bonus active', () => {
    const inputs = fullBody({ tier: 4, element: 'kim' }).slice(0, 3);
    const before = summarizeEquipmentBuild(inputs);
    expect(before.activeSets[0].pieceCount).toBe(3);
    expect(before.activeSets[0].activeTiers.map((t) => t.pieces)).toEqual([2]);

    const inputs4 = fullBody({ tier: 4, element: 'kim' }).slice(0, 4);
    const after = summarizeEquipmentBuild(inputs4);
    expect(after.activeSets[0].pieceCount).toBe(4);
    expect(after.activeSets[0].activeTiers.map((t) => t.pieces)).toEqual([2, 4]);
  });

  it('unequip piece (set equippedSlot=null) giảm pieceCount', () => {
    const inputs = fullBody({ tier: 4, element: 'kim' });
    inputs[5].piece.equippedSlot = null;
    const summary = summarizeEquipmentBuild(inputs);
    expect(summary.activeSets[0].pieceCount).toBe(5);
    expect(summary.activeSets[0].activeTiers.map((t) => t.pieces)).toEqual([2, 4]);
  });
});
