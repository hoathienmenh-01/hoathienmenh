/**
 * Phase 14.3.D — Tribulation Encounter Catalog tests.
 *
 * Pure tests cho catalog + helper layer. KHÔNG inject runtime, KHÔNG
 * mutate state. Coverage:
 *   - Catalog valid (5 entry, 1 per ElementKey, không trùng key/element).
 *   - Element mapping correct (Hỏa=BURST / Thủy=SUSTAIN / Mộc=POISON_RECOVERY
 *     / Kim=ARMOR_CRIT / Thổ=DEFENSE_ENDURANCE).
 *   - `successThreshold` envelope `[FLOOR, CEIL]` (0.1, 0.9).
 *   - `failPenaltyMultiplier` / `rewardHintMultiplier` ≤ ceil 1.5.
 *   - `dominantTribulationWaveElement` đúng cho mỗi TribulationDef trong
 *     catalog hiện có (lei→hoa, phong→kim, bang→thuy, hoa→hoa, tam→tho).
 *   - `resolveTribulationEncounterDef` trả về encounter mapping đúng.
 *   - `describeTribulationEncounterAdvantage` symmetry + boundary.
 *   - `validateTribulationEncounterCatalog` reject drift.
 */

import { describe, expect, test } from 'vitest';
import { TRIBULATIONS } from './tribulation';
import {
  computeTribulationEncounterPhaseCount,
  computeTribulationEncounterPowerHint,
  describeTribulationEncounterAdvantage,
  dominantTribulationWaveElement,
  getTribulationEncounterDefByElement,
  getTribulationEncounterDefByKey,
  resolveTribulationEncounterDef,
  TRIBULATION_ENCOUNTER_DEFS,
  TRIBULATION_ENCOUNTER_EFFECT_TYPES,
  TRIBULATION_ENCOUNTER_FAIL_PENALTY_MULTIPLIER_CEIL,
  TRIBULATION_ENCOUNTER_PHASE_COUNT_BY_SEVERITY,
  TRIBULATION_ENCOUNTER_REWARD_HINT_MULTIPLIER_CEIL,
  TRIBULATION_ENCOUNTER_SUCCESS_THRESHOLD_CEIL,
  TRIBULATION_ENCOUNTER_SUCCESS_THRESHOLD_FLOOR,
  validateTribulationEncounterCatalog,
  validateTribulationEncounterDef,
  type TribulationEncounterDef,
} from './tribulation-encounter';

describe('tribulation-encounter catalog', () => {
  test('catalog has exactly 5 entries (1 per ElementKey)', () => {
    expect(TRIBULATION_ENCOUNTER_DEFS.length).toBe(5);
    const elements = new Set(TRIBULATION_ENCOUNTER_DEFS.map((d) => d.element));
    expect(elements).toEqual(new Set(['kim', 'moc', 'thuy', 'hoa', 'tho']));
  });

  test('catalog keys are unique and follow naming pattern', () => {
    const keys = new Set(TRIBULATION_ENCOUNTER_DEFS.map((d) => d.key));
    expect(keys.size).toBe(TRIBULATION_ENCOUNTER_DEFS.length);
    for (const def of TRIBULATION_ENCOUNTER_DEFS) {
      expect(def.key).toBe(`tribulation_encounter_${def.element}`);
    }
  });

  test('5 element flavors map to expected effect type', () => {
    const expected: Record<string, string> = {
      hoa: 'BURST',
      thuy: 'SUSTAIN',
      moc: 'POISON_RECOVERY',
      kim: 'ARMOR_CRIT',
      tho: 'DEFENSE_ENDURANCE',
    };
    for (const def of TRIBULATION_ENCOUNTER_DEFS) {
      expect(def.effectType).toBe(expected[def.element]);
    }
  });

  test('every entry passes validateTribulationEncounterDef', () => {
    for (const def of TRIBULATION_ENCOUNTER_DEFS) {
      expect(() => validateTribulationEncounterDef(def)).not.toThrow();
    }
  });

  test('full catalog passes validateTribulationEncounterCatalog', () => {
    expect(() => validateTribulationEncounterCatalog()).not.toThrow();
  });

  test('successThreshold ∈ [FLOOR, CEIL] envelope', () => {
    for (const def of TRIBULATION_ENCOUNTER_DEFS) {
      expect(def.successThreshold).toBeGreaterThanOrEqual(
        TRIBULATION_ENCOUNTER_SUCCESS_THRESHOLD_FLOOR,
      );
      expect(def.successThreshold).toBeLessThanOrEqual(
        TRIBULATION_ENCOUNTER_SUCCESS_THRESHOLD_CEIL,
      );
    }
  });

  test('failPenaltyMultiplier capped at CEIL (no character-killing penalty)', () => {
    for (const def of TRIBULATION_ENCOUNTER_DEFS) {
      expect(def.failPenaltyMultiplier).toBeLessThanOrEqual(
        TRIBULATION_ENCOUNTER_FAIL_PENALTY_MULTIPLIER_CEIL,
      );
      expect(def.failPenaltyMultiplier).toBeGreaterThanOrEqual(0.1);
    }
  });

  test('rewardHintMultiplier capped at CEIL', () => {
    for (const def of TRIBULATION_ENCOUNTER_DEFS) {
      expect(def.rewardHintMultiplier).toBeLessThanOrEqual(
        TRIBULATION_ENCOUNTER_REWARD_HINT_MULTIPLIER_CEIL,
      );
      expect(def.rewardHintMultiplier).toBeGreaterThanOrEqual(0.1);
    }
  });

  test('phaseCount ≥ 1 and ≤ 9 (covers severity caps)', () => {
    for (const def of TRIBULATION_ENCOUNTER_DEFS) {
      expect(def.phaseCount).toBeGreaterThanOrEqual(1);
      expect(def.phaseCount).toBeLessThanOrEqual(9);
    }
  });

  test('TRIBULATION_ENCOUNTER_PHASE_COUNT_BY_SEVERITY monotonic', () => {
    const m = TRIBULATION_ENCOUNTER_PHASE_COUNT_BY_SEVERITY;
    expect(m.minor).toBeLessThanOrEqual(m.major);
    expect(m.major).toBeLessThanOrEqual(m.heavenly);
    expect(m.heavenly).toBeLessThanOrEqual(m.saint);
  });

  test('TRIBULATION_ENCOUNTER_EFFECT_TYPES contains exactly 5 unique types', () => {
    expect(TRIBULATION_ENCOUNTER_EFFECT_TYPES.length).toBe(5);
    expect(new Set(TRIBULATION_ENCOUNTER_EFFECT_TYPES).size).toBe(5);
  });
});

describe('tribulation-encounter validate (drift catch)', () => {
  test('validate rejects invalid element', () => {
    expect(() =>
      validateTribulationEncounterDef({
        ...TRIBULATION_ENCOUNTER_DEFS[0],
        element: 'invalid' as TribulationEncounterDef['element'],
      }),
    ).toThrow(/invalid element/);
  });

  test('validate rejects invalid effectType', () => {
    expect(() =>
      validateTribulationEncounterDef({
        ...TRIBULATION_ENCOUNTER_DEFS[0],
        effectType:
          'NOPE' as unknown as TribulationEncounterDef['effectType'],
      }),
    ).toThrow(/invalid effectType/);
  });

  test('validate rejects successThreshold below FLOOR', () => {
    expect(() =>
      validateTribulationEncounterDef({
        ...TRIBULATION_ENCOUNTER_DEFS[0],
        successThreshold:
          TRIBULATION_ENCOUNTER_SUCCESS_THRESHOLD_FLOOR - 0.01,
      }),
    ).toThrow(/successThreshold/);
  });

  test('validate rejects successThreshold above CEIL', () => {
    expect(() =>
      validateTribulationEncounterDef({
        ...TRIBULATION_ENCOUNTER_DEFS[0],
        successThreshold:
          TRIBULATION_ENCOUNTER_SUCCESS_THRESHOLD_CEIL + 0.01,
      }),
    ).toThrow(/successThreshold/);
  });

  test('validate rejects failPenaltyMultiplier above CEIL', () => {
    expect(() =>
      validateTribulationEncounterDef({
        ...TRIBULATION_ENCOUNTER_DEFS[0],
        failPenaltyMultiplier:
          TRIBULATION_ENCOUNTER_FAIL_PENALTY_MULTIPLIER_CEIL + 0.5,
      }),
    ).toThrow(/failPenaltyMultiplier/);
  });

  test('validate rejects rewardHintMultiplier above CEIL', () => {
    expect(() =>
      validateTribulationEncounterDef({
        ...TRIBULATION_ENCOUNTER_DEFS[0],
        rewardHintMultiplier:
          TRIBULATION_ENCOUNTER_REWARD_HINT_MULTIPLIER_CEIL + 0.5,
      }),
    ).toThrow(/rewardHintMultiplier/);
  });

  test('validate rejects phaseCount=0', () => {
    expect(() =>
      validateTribulationEncounterDef({
        ...TRIBULATION_ENCOUNTER_DEFS[0],
        phaseCount: 0,
      }),
    ).toThrow(/phaseCount/);
  });

  test('validateCatalog rejects duplicate element', () => {
    const dup = [
      ...TRIBULATION_ENCOUNTER_DEFS,
      {
        ...TRIBULATION_ENCOUNTER_DEFS[0],
        key: 'tribulation_encounter_dup',
      },
    ];
    expect(() => validateTribulationEncounterCatalog(dup)).toThrow();
  });

  test('validateCatalog rejects missing element', () => {
    const partial = TRIBULATION_ENCOUNTER_DEFS.slice(0, 4);
    expect(() => validateTribulationEncounterCatalog(partial)).toThrow();
  });
});

describe('tribulation-encounter element mapping (TribulationDef → encounter)', () => {
  test('lei type → dominant element hoa', () => {
    const def = TRIBULATIONS.find((t) => t.type === 'lei');
    expect(def).toBeDefined();
    if (!def) return;
    expect(dominantTribulationWaveElement(def)).toBe('hoa');
    expect(resolveTribulationEncounterDef(def).element).toBe('hoa');
    expect(resolveTribulationEncounterDef(def).effectType).toBe('BURST');
  });

  test('phong type → dominant element kim', () => {
    const def = TRIBULATIONS.find((t) => t.type === 'phong');
    expect(def).toBeDefined();
    if (!def) return;
    expect(dominantTribulationWaveElement(def)).toBe('kim');
    expect(resolveTribulationEncounterDef(def).element).toBe('kim');
    expect(resolveTribulationEncounterDef(def).effectType).toBe('ARMOR_CRIT');
  });

  test('bang type → dominant element thuy', () => {
    const def = TRIBULATIONS.find((t) => t.type === 'bang');
    expect(def).toBeDefined();
    if (!def) return;
    expect(dominantTribulationWaveElement(def)).toBe('thuy');
    expect(resolveTribulationEncounterDef(def).element).toBe('thuy');
    expect(resolveTribulationEncounterDef(def).effectType).toBe('SUSTAIN');
  });

  test('hoa type → dominant element hoa', () => {
    const def = TRIBULATIONS.find((t) => t.type === 'hoa');
    expect(def).toBeDefined();
    if (!def) return;
    expect(dominantTribulationWaveElement(def)).toBe('hoa');
    expect(resolveTribulationEncounterDef(def).element).toBe('hoa');
    expect(resolveTribulationEncounterDef(def).effectType).toBe('BURST');
  });

  test('tam type (element=null) → fallback tho (DEFENSE_ENDURANCE)', () => {
    const def = TRIBULATIONS.find((t) => t.type === 'tam');
    expect(def).toBeDefined();
    if (!def) return;
    expect(dominantTribulationWaveElement(def)).toBe('tho');
    expect(resolveTribulationEncounterDef(def).element).toBe('tho');
    expect(resolveTribulationEncounterDef(def).effectType).toBe(
      'DEFENSE_ENDURANCE',
    );
  });

  test('every TRIBULATIONS entry resolves to a valid encounter', () => {
    for (const tdef of TRIBULATIONS) {
      const enc = resolveTribulationEncounterDef(tdef);
      expect(enc).toBeDefined();
      expect(() => validateTribulationEncounterDef(enc)).not.toThrow();
    }
  });

  test('computeTribulationEncounterPowerHint > 0 for every TRIBULATIONS entry', () => {
    for (const tdef of TRIBULATIONS) {
      expect(computeTribulationEncounterPowerHint(tdef)).toBeGreaterThan(0);
    }
  });

  test('computeTribulationEncounterPhaseCount ≤ severity cap', () => {
    for (const tdef of TRIBULATIONS) {
      const cap = TRIBULATION_ENCOUNTER_PHASE_COUNT_BY_SEVERITY[tdef.severity];
      expect(computeTribulationEncounterPhaseCount(tdef)).toBeLessThanOrEqual(
        cap,
      );
      expect(
        computeTribulationEncounterPhaseCount(tdef),
      ).toBeGreaterThanOrEqual(1);
    }
  });
});

describe('tribulation-encounter advantage', () => {
  test('null primary → 0 (no advantage)', () => {
    expect(describeTribulationEncounterAdvantage(null, 'hoa')).toBe(0);
  });

  test('same element → +2 (affinity)', () => {
    expect(describeTribulationEncounterAdvantage('hoa', 'hoa')).toBe(2);
    expect(describeTribulationEncounterAdvantage('thuy', 'thuy')).toBe(2);
  });

  test('player counters encounter → +1 (advantage)', () => {
    // hoa counters kim → player primary=hoa vs encounter=kim → +1
    expect(describeTribulationEncounterAdvantage('hoa', 'kim')).toBe(1);
    // thuy counters hoa → player primary=thuy vs encounter=hoa → +1
    expect(describeTribulationEncounterAdvantage('thuy', 'hoa')).toBe(1);
    // kim counters moc → player primary=kim vs encounter=moc → +1
    expect(describeTribulationEncounterAdvantage('kim', 'moc')).toBe(1);
  });

  test('encounter generates player → +1 (encounter feeds player)', () => {
    // kim generates thuy → encounter=kim feeds player=thuy → +1
    expect(describeTribulationEncounterAdvantage('thuy', 'kim')).toBe(1);
    // moc generates hoa → encounter=moc feeds player=hoa → +1
    expect(describeTribulationEncounterAdvantage('hoa', 'moc')).toBe(1);
  });

  test('player generates encounter → -1 (player feeds encounter)', () => {
    // moc generates hoa → player=moc feeds encounter=hoa → -1
    expect(describeTribulationEncounterAdvantage('moc', 'hoa')).toBe(-1);
    // kim generates thuy → player=kim feeds encounter=thuy → -1
    expect(describeTribulationEncounterAdvantage('kim', 'thuy')).toBe(-1);
  });

  test('encounter counters player → -2 (worst)', () => {
    // kim counters moc → primary=moc vs encounter=kim → -2
    expect(describeTribulationEncounterAdvantage('moc', 'kim')).toBe(-2);
    // hoa counters kim → primary=kim vs encounter=hoa → -2
    expect(describeTribulationEncounterAdvantage('kim', 'hoa')).toBe(-2);
  });
});

describe('tribulation-encounter lookup helpers', () => {
  test('getTribulationEncounterDefByElement returns def for valid element', () => {
    expect(getTribulationEncounterDefByElement('hoa')?.effectType).toBe(
      'BURST',
    );
    expect(getTribulationEncounterDefByElement('thuy')?.effectType).toBe(
      'SUSTAIN',
    );
  });

  test('getTribulationEncounterDefByKey lookup roundtrip', () => {
    for (const def of TRIBULATION_ENCOUNTER_DEFS) {
      expect(getTribulationEncounterDefByKey(def.key)).toBe(def);
    }
  });

  test('getTribulationEncounterDefByKey returns undefined for invalid key', () => {
    expect(getTribulationEncounterDefByKey('not_a_real_key')).toBeUndefined();
  });
});
