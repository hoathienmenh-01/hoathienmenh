/**
 * Phase 23.3 — Set Bonus tests.
 *
 * Covers: setKey unique, required pieces hợp lệ, active 2/4/6 đúng, không
 * active khi thiếu, NO duplicate item, NO stack 2 lần, set tier thấp không
 * vượt cap, elemental affinity check, getMissingSetSlots đúng.
 */

import { describe, expect, it } from 'vitest';
import type { ItemDef } from './items';
import type { EquipSlot, Quality } from './enums';
import type { ElementKey } from './combat';
import { EQUIPMENT_SET_BONUS_CAPS } from './equipment-progression';
import {
  SET_BONUSES,
  clampEnvelopeToCap,
  computeActiveSetBonuses,
  getEquippedSetPieces,
  getItemSetKey,
  getMissingSetSlots,
  getSetBonusDefByKey,
  listSetBonusesForElement,
  sumEnvelope,
  validateSetBonusCatalog,
  validateSetBonusDefinition,
  type EquippedPiece,
  type SetBonusDef,
} from './equipment-set-bonus';

const SET_REQUIRED_SLOTS_DEFAULT: readonly EquipSlot[] = [
  'WEAPON',
  'ARMOR',
  'HAT',
  'BELT',
  'BOOTS',
  'ARTIFACT_1',
];

function makeItem(opts: {
  slot: EquipSlot;
  equipmentTier: number;
  element: ElementKey | null;
  quality?: Quality;
}): ItemDef {
  return {
    key: `mock_${opts.slot}_${opts.element ?? 'none'}_${opts.equipmentTier}`,
    name: 'Mock',
    description: '',
    kind: 'WEAPON',
    quality: opts.quality ?? 'LINH',
    stackable: false,
    slot: opts.slot,
    equipmentTier: opts.equipmentTier,
    equipmentElement: opts.element ?? undefined,
    bonuses: {
      atk: 100,
    },
    price: 0,
  } as ItemDef;
}

function makePiece(
  id: string,
  slot: EquipSlot,
  opts?: { quality?: Quality; tier?: number; enhanceLevel?: number; element?: ElementKey | null },
): EquippedPiece {
  return {
    inventoryItemId: id,
    itemKey: `mock_${slot}`,
    equippedSlot: slot,
    quality: opts?.quality ?? 'LINH',
    equipmentTier: opts?.tier,
    equipmentElement: opts?.element ?? null,
    enhanceLevel: opts?.enhanceLevel ?? 0,
  };
}

function makeMidKim(slot: EquipSlot, id = `kim-${slot}`, tier = 4) {
  return {
    piece: { ...makePiece(id, slot, { element: 'kim', tier }) },
    item: makeItem({ slot, equipmentTier: tier, element: 'kim' }),
  };
}

describe('SET_BONUSES catalog', () => {
  it('setKey unique', () => {
    const keys = SET_BONUSES.map((s) => s.setKey);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('catalog cover đủ 5 element × 2 set (mid + endgame)', () => {
    const grouped: Record<ElementKey, SetBonusDef[]> = {
      kim: [],
      moc: [],
      thuy: [],
      hoa: [],
      tho: [],
    };
    for (const set of SET_BONUSES) {
      grouped[set.elementAffinity].push(set);
    }
    for (const element of Object.keys(grouped) as ElementKey[]) {
      expect(grouped[element].length).toBeGreaterThanOrEqual(2);
    }
  });

  it('mọi set hợp lệ qua validateSetBonusDefinition', () => {
    expect(validateSetBonusCatalog()).toEqual([]);
  });

  it('listSetBonusesForElement trả đúng set theo hệ', () => {
    const kim = listSetBonusesForElement('kim');
    expect(kim.length).toBeGreaterThanOrEqual(2);
    for (const s of kim) expect(s.elementAffinity).toBe('kim');
  });

  it('mọi set tier ratio không vượt cap envelope', () => {
    for (const set of SET_BONUSES) {
      const caps = [
        EQUIPMENT_SET_BONUS_CAPS.twoPiece.max,
        EQUIPMENT_SET_BONUS_CAPS.fourPiece.max,
        EQUIPMENT_SET_BONUS_CAPS.sixPiece.max,
      ];
      set.tiers.forEach((tier, idx) => {
        const total = sumEnvelope(tier.bonusRatio);
        expect(total).toBeLessThanOrEqual(caps[idx] + 1e-6);
      });
    }
  });

  it('requiredSlots không duplicate, mọi slot valid', () => {
    for (const set of SET_BONUSES) {
      const set2 = new Set(set.requiredSlots);
      expect(set2.size).toBe(set.requiredSlots.length);
    }
  });
});

describe('validateSetBonusDefinition', () => {
  const baseSet = SET_BONUSES[0];

  it('reject ratio vượt cap 2-piece', () => {
    const bad: SetBonusDef = {
      ...baseSet,
      setKey: 'bad_set',
      tiers: [
        { pieces: 2, bonusRatio: { atkRatio: 0.5 }, description: 'bad' },
        baseSet.tiers[1],
        baseSet.tiers[2],
      ],
    };
    const result = validateSetBonusDefinition(bad);
    expect(result.ok).toBe(false);
    expect(result.errors).toContain('TIER_RATIO_OVER_CAP');
  });

  it('reject negative ratio', () => {
    const bad: SetBonusDef = {
      ...baseSet,
      setKey: 'bad_neg',
      tiers: [
        { pieces: 2, bonusRatio: { atkRatio: -0.01 }, description: 'bad' },
        baseSet.tiers[1],
        baseSet.tiers[2],
      ],
    };
    const result = validateSetBonusDefinition(bad);
    expect(result.ok).toBe(false);
    expect(result.errors).toContain('TIER_RATIO_NEGATIVE');
  });

  it('reject tier list không phải 2/4/6', () => {
    const bad: SetBonusDef = {
      ...baseSet,
      setKey: 'bad_pieces',
      tiers: [
        { pieces: 2, bonusRatio: { atkRatio: 0.02 }, description: 'ok' },
        { pieces: 2 as 2, bonusRatio: { atkRatio: 0.02 }, description: 'dup' },
        { pieces: 6, bonusRatio: { atkRatio: 0.05 }, description: 'ok' },
      ],
    };
    const result = validateSetBonusDefinition(bad);
    expect(result.ok).toBe(false);
    expect(result.errors).toContain('INVALID_TIER_PIECES');
  });

  it('reject requiredSlots invalid', () => {
    const bad: SetBonusDef = {
      ...baseSet,
      setKey: 'bad_slots',
      requiredSlots: ['WEAPON', 'WEAPON'] as readonly EquipSlot[],
    };
    const result = validateSetBonusDefinition(bad);
    expect(result.ok).toBe(false);
    expect(result.errors).toContain('INVALID_REQUIRED_SLOTS');
  });
});

describe('getItemSetKey', () => {
  it('match item Kim tier 4 vào kim_phong_set', () => {
    const item = makeItem({ slot: 'WEAPON', equipmentTier: 4, element: 'kim' });
    expect(getItemSetKey(item)).toBe('kim_phong_set');
  });

  it('match item Hoả tier 8 vào cuu_u_diem_hoa_set', () => {
    const item = makeItem({ slot: 'WEAPON', equipmentTier: 8, element: 'hoa' });
    expect(getItemSetKey(item)).toBe('cuu_u_diem_hoa_set');
  });

  it('không match nếu item không có element', () => {
    const item = makeItem({ slot: 'WEAPON', equipmentTier: 4, element: null });
    expect(getItemSetKey(item)).toBeUndefined();
  });

  it('không match nếu slot không trong requiredSlots', () => {
    const item = makeItem({ slot: 'ARTIFACT_2', equipmentTier: 4, element: 'kim' });
    expect(getItemSetKey(item)).toBeUndefined();
  });

  it('không match nếu tier ngoài allowedTiers', () => {
    const item = makeItem({ slot: 'WEAPON', equipmentTier: 6, element: 'kim' });
    expect(getItemSetKey(item)).toBeUndefined();
  });
});

describe('getEquippedSetPieces', () => {
  it('2 món Kim tier 4 → group kim_phong_set có 2 piece', () => {
    const inputs = [makeMidKim('WEAPON'), makeMidKim('ARMOR')];
    const groups = getEquippedSetPieces(inputs);
    const group = groups.get('kim_phong_set');
    expect(group?.pieces.length).toBe(2);
  });

  it('duplicate inventoryItemId không tính 2 món', () => {
    const inputs = [
      makeMidKim('WEAPON', 'dup-1'),
      { piece: { ...makePiece('dup-1', 'ARMOR', { element: 'kim', tier: 4 }) }, item: makeItem({ slot: 'ARMOR', equipmentTier: 4, element: 'kim' }) },
    ];
    const groups = getEquippedSetPieces(inputs);
    expect(groups.get('kim_phong_set')?.pieces.length).toBe(1);
  });

  it('2 món Kim tier 4 + 2 món Kim tier 8 → 2 group khác nhau (không stack)', () => {
    const inputs = [
      makeMidKim('WEAPON'),
      makeMidKim('ARMOR'),
      {
        piece: makePiece('endkim-hat', 'HAT', { element: 'kim', tier: 8 }),
        item: makeItem({ slot: 'HAT', equipmentTier: 8, element: 'kim' }),
      },
      {
        piece: makePiece('endkim-belt', 'BELT', { element: 'kim', tier: 8 }),
        item: makeItem({ slot: 'BELT', equipmentTier: 8, element: 'kim' }),
      },
    ];
    const groups = getEquippedSetPieces(inputs);
    expect(groups.get('kim_phong_set')?.pieces.length).toBe(2);
    expect(groups.get('kim_quang_sat_set')?.pieces.length).toBe(2);
  });

  it('item không match (no element) → bị bỏ qua', () => {
    const inputs = [
      makeMidKim('WEAPON'),
      {
        piece: makePiece('no-elem', 'ARMOR', { tier: 4, element: null }),
        item: makeItem({ slot: 'ARMOR', equipmentTier: 4, element: null }),
      },
    ];
    const groups = getEquippedSetPieces(inputs);
    expect(groups.get('kim_phong_set')?.pieces.length).toBe(1);
  });
});

describe('computeActiveSetBonuses', () => {
  function buildMidKimEquipment(count: number) {
    const slots: EquipSlot[] = ['WEAPON', 'ARMOR', 'HAT', 'BELT', 'BOOTS', 'ARTIFACT_1'];
    return slots.slice(0, count).map((s) => makeMidKim(s));
  }

  it('không active khi chỉ 1 piece', () => {
    const groups = getEquippedSetPieces(buildMidKimEquipment(1));
    const active = computeActiveSetBonuses(groups);
    expect(active).toEqual([]);
  });

  it('active 2-piece khi đủ 2 món', () => {
    const groups = getEquippedSetPieces(buildMidKimEquipment(2));
    const active = computeActiveSetBonuses(groups);
    expect(active.length).toBe(1);
    expect(active[0].pieceCount).toBe(2);
    expect(active[0].activeTiers.map((t) => t.pieces)).toEqual([2]);
  });

  it('không active 4-piece khi chỉ 3 món', () => {
    const groups = getEquippedSetPieces(buildMidKimEquipment(3));
    const active = computeActiveSetBonuses(groups);
    expect(active[0].pieceCount).toBe(3);
    expect(active[0].activeTiers.map((t) => t.pieces)).toEqual([2]);
  });

  it('active 4-piece khi đủ 4 món', () => {
    const groups = getEquippedSetPieces(buildMidKimEquipment(4));
    const active = computeActiveSetBonuses(groups);
    expect(active[0].activeTiers.map((t) => t.pieces)).toEqual([2, 4]);
  });

  it('active 6-piece khi đủ 6 món, gộp 2+4+6 ratio', () => {
    const groups = getEquippedSetPieces(buildMidKimEquipment(6));
    const active = computeActiveSetBonuses(groups);
    expect(active[0].activeTiers.map((t) => t.pieces)).toEqual([2, 4, 6]);
    expect(active[0].totalRatio.atkRatio).toBeGreaterThan(0);
    expect(active[0].missingSlots).toEqual([]);
  });

  it('totalRatio bị clamp về bonusCap khi sum vượt', () => {
    // Synthesize a fake set bonus group that goes over cap to test clamp.
    const set = getSetBonusDefByKey('kim_phong_set');
    expect(set).toBeDefined();
    const total = sumEnvelope({
      atkRatio: 0.04,
      defRatio: 0.04,
      hpMaxRatio: 0.04,
      mpMaxRatio: 0.04,
      spiritRatio: 0.04,
    });
    const clamped = clampEnvelopeToCap(
      { atkRatio: 0.04, defRatio: 0.04, hpMaxRatio: 0.04, mpMaxRatio: 0.04, spiritRatio: 0.04 },
      0.1,
    );
    expect(sumEnvelope(clamped)).toBeLessThanOrEqual(0.1 + 1e-6);
    expect(total).toBeGreaterThan(0.1);
  });

  it('duplicate item không tăng pieceCount lần 2', () => {
    const inputs = [
      makeMidKim('WEAPON', 'a'),
      makeMidKim('ARMOR', 'b'),
      // Cùng inventoryItemId 'a' (race / retry) → ignore.
      makeMidKim('WEAPON', 'a'),
    ];
    const groups = getEquippedSetPieces(inputs);
    expect(groups.get('kim_phong_set')?.pieces.length).toBe(2);
  });

  it('set tier thấp full 6 món vẫn không vượt bonusCap (15%)', () => {
    const groups = getEquippedSetPieces(
      ['WEAPON', 'ARMOR', 'HAT', 'BELT', 'BOOTS', 'ARTIFACT_1'].map((s) =>
        makeMidKim(s as EquipSlot),
      ),
    );
    const active = computeActiveSetBonuses(groups);
    expect(sumEnvelope(active[0].totalRatio)).toBeLessThanOrEqual(active[0].set.bonusCap + 1e-6);
  });

  it('elemental affinity match đúng hệ (Hoả set chỉ kích bởi item Hoả)', () => {
    // Mix Kim weapon + Hoả armor → mỗi set chỉ có 1 piece, không active 2.
    const inputs = [
      makeMidKim('WEAPON'),
      {
        piece: makePiece('hoa-armor', 'ARMOR', { element: 'hoa', tier: 4 }),
        item: makeItem({ slot: 'ARMOR', equipmentTier: 4, element: 'hoa' }),
      },
    ];
    const groups = getEquippedSetPieces(inputs);
    expect(groups.get('kim_phong_set')?.pieces.length).toBe(1);
    expect(groups.get('lieu_hoa_phon_set')?.pieces.length).toBe(1);
    const active = computeActiveSetBonuses(groups);
    expect(active).toEqual([]);
  });
});

describe('getMissingSetSlots', () => {
  it('trả slot còn thiếu trong set khi mặc 2 piece', () => {
    const groups = getEquippedSetPieces([
      makeMidKim('WEAPON'),
      makeMidKim('ARMOR'),
    ]);
    const missing = getMissingSetSlots(groups, 'kim_phong_set');
    expect(missing.length).toBe(4);
    expect(missing).toEqual(expect.arrayContaining(['HAT', 'BELT', 'BOOTS', 'ARTIFACT_1']));
  });

  it('trả [] khi setKey không tồn tại', () => {
    const groups = getEquippedSetPieces([makeMidKim('WEAPON')]);
    expect(getMissingSetSlots(groups, 'unknown_set')).toEqual([]);
  });

  it('trả [] khi full 6 piece', () => {
    const groups = getEquippedSetPieces(
      SET_REQUIRED_SLOTS_DEFAULT.map((s) => makeMidKim(s)),
    );
    const missing = getMissingSetSlots(groups, 'kim_phong_set');
    expect(missing).toEqual([]);
  });
});
