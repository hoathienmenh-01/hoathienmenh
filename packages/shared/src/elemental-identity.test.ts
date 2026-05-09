/**
 * Phase 14.2.D — Elemental Dungeon and Boss Identity tests.
 *
 * Verifies:
 *   - Element relation helpers (overcomes / counter / generates / generatedBy).
 *   - DungeonElementProfile derived defaults + override.
 *   - BossElementProfile derived defaults từ elementalResist + override.
 *   - PlayerElementWarning logic (recommended / warning / caution / none).
 *   - Catalog invariant: every element represented + valid element keys.
 *   - Catalog invariant: weakness consistent với element + resist subset
 *     elementalResist keys.
 *   - No-double-multiplier: weaknessElement chỉ hint, không đụng damage.
 */
import { describe, expect, it } from 'vitest';
import { BOSSES } from './boss';
import { DUNGEONS, ELEMENTS, type ElementKey } from './combat';
import {
  bossesWeakTo,
  computePlayerElementWarning,
  computePlayerElementWarningForSet,
  dungeonsByDominantElement,
  elementCounter,
  elementGeneratedBy,
  elementGenerates,
  elementOvercomes,
  getBossElementProfile,
  getDungeonElementProfile,
  validateBossElementProfile,
  validateDungeonElementProfile,
} from './elemental-identity';

describe('Element relation helpers (Phase 14.2.D)', () => {
  it('elementCounter là inverse của elementOvercomes', () => {
    for (const el of ELEMENTS) {
      const counter = elementCounter(el);
      expect(elementOvercomes(counter)).toBe(el);
    }
  });

  it('elementGeneratedBy là inverse của elementGenerates', () => {
    for (const el of ELEMENTS) {
      const gen = elementGeneratedBy(el);
      expect(elementGenerates(gen)).toBe(el);
    }
  });

  it('matrix counter cụ thể: kim←hoa, moc←kim, tho←moc, thuy←tho, hoa←thuy', () => {
    expect(elementCounter('kim')).toBe('hoa');
    expect(elementCounter('moc')).toBe('kim');
    expect(elementCounter('tho')).toBe('moc');
    expect(elementCounter('thuy')).toBe('tho');
    expect(elementCounter('hoa')).toBe('thuy');
  });
});

describe('getDungeonElementProfile (Phase 14.2.D)', () => {
  it('fallback dominantElement = element nếu không set', () => {
    const profile = getDungeonElementProfile({
      key: 't1',
      name: 'Test',
      description: 'desc',
      recommendedRealm: 'pham_nhan',
      monsters: [],
      staminaEntry: 0,
      element: 'hoa',
    });
    expect(profile.dominantElement).toBe('hoa');
    expect(profile.recommendedCounterElement).toBe('thuy');
    expect(profile.rewardElementHint).toBe('hoa');
  });

  it('dominantElement override thắng element legacy', () => {
    const profile = getDungeonElementProfile({
      key: 't2',
      name: 'Test',
      description: 'desc',
      recommendedRealm: 'pham_nhan',
      monsters: [],
      staminaEntry: 0,
      element: 'kim',
      dominantElement: 'moc',
    });
    expect(profile.dominantElement).toBe('moc');
    expect(profile.recommendedCounterElement).toBe('kim');
  });

  it('recommendedCounterElement override thắng default', () => {
    const profile = getDungeonElementProfile({
      key: 't3',
      name: 'Test',
      description: 'desc',
      recommendedRealm: 'pham_nhan',
      monsters: [],
      staminaEntry: 0,
      element: 'tho',
      recommendedCounterElement: null,
    });
    expect(profile.dominantElement).toBe('tho');
    expect(profile.recommendedCounterElement).toBeNull();
  });

  it('null dungeon vô hệ → recommendedCounter null', () => {
    const profile = getDungeonElementProfile({
      key: 't4',
      name: 'Test',
      description: 'desc',
      recommendedRealm: 'pham_nhan',
      monsters: [],
      staminaEntry: 0,
      element: null,
    });
    expect(profile.dominantElement).toBeNull();
    expect(profile.recommendedCounterElement).toBeNull();
    expect(profile.rewardElementHint).toBeNull();
  });

  it('rewardElementHint override thắng default', () => {
    const profile = getDungeonElementProfile({
      key: 't5',
      name: 'Test',
      description: 'desc',
      recommendedRealm: 'pham_nhan',
      monsters: [],
      staminaEntry: 0,
      element: 'kim',
      rewardElementHint: 'thuy',
    });
    expect(profile.rewardElementHint).toBe('thuy');
  });
});

describe('getBossElementProfile (Phase 14.2.D)', () => {
  it('weaknessElement default = elementCounter(element)', () => {
    const profile = getBossElementProfile({
      key: 'b1',
      name: 'B',
      description: 'd',
      element: 'hoa',
      level: 50,
      recommendedRealm: 'kim_dan',
      baseMaxHp: 1000,
      atk: 100,
      def: 50,
      baseRewardLinhThach: 100,
      topDropPool: [],
      midDropPool: [],
    });
    expect(profile.element).toBe('hoa');
    expect(profile.weaknessElement).toBe('thuy');
  });

  it('boss vô hệ → weakness null', () => {
    const profile = getBossElementProfile({
      key: 'b2',
      name: 'B',
      description: 'd',
      element: null,
      level: 50,
      recommendedRealm: 'kim_dan',
      baseMaxHp: 1000,
      atk: 100,
      def: 50,
      baseRewardLinhThach: 100,
      topDropPool: [],
      midDropPool: [],
    });
    expect(profile.weaknessElement).toBeNull();
  });

  it('resistElements derive từ elementalResist keys < 1.0', () => {
    const profile = getBossElementProfile({
      key: 'b3',
      name: 'B',
      description: 'd',
      element: 'thuy',
      level: 50,
      recommendedRealm: 'kim_dan',
      baseMaxHp: 1000,
      atk: 100,
      def: 50,
      baseRewardLinhThach: 100,
      topDropPool: [],
      midDropPool: [],
      elementalResist: { thuy: 0.75, tho: 0.85, kim: 1.0 },
    });
    expect(profile.resistElements).toEqual(['thuy', 'tho']);
  });

  it('resistElements override thắng derive', () => {
    const profile = getBossElementProfile({
      key: 'b4',
      name: 'B',
      description: 'd',
      element: 'thuy',
      level: 50,
      recommendedRealm: 'kim_dan',
      baseMaxHp: 1000,
      atk: 100,
      def: 50,
      baseRewardLinhThach: 100,
      topDropPool: [],
      midDropPool: [],
      elementalResist: { thuy: 0.75 },
      resistElements: ['thuy'],
    });
    expect(profile.resistElements).toEqual(['thuy']);
  });

  it('rewardElementHint default = element', () => {
    const profile = getBossElementProfile({
      key: 'b5',
      name: 'B',
      description: 'd',
      element: 'kim',
      level: 50,
      recommendedRealm: 'kim_dan',
      baseMaxHp: 1000,
      atk: 100,
      def: 50,
      baseRewardLinhThach: 100,
      topDropPool: [],
      midDropPool: [],
    });
    expect(profile.rewardElementHint).toBe('kim');
  });
});

describe('computePlayerElementWarning (Phase 14.2.D)', () => {
  it('player khắc target → recommended', () => {
    expect(computePlayerElementWarning('kim', 'moc')).toBe('recommended');
    expect(computePlayerElementWarning('thuy', 'hoa')).toBe('recommended');
  });

  it('player bị target khắc → warning', () => {
    expect(computePlayerElementWarning('moc', 'kim')).toBe('warning');
    expect(computePlayerElementWarning('hoa', 'thuy')).toBe('warning');
  });

  it('cùng hệ → caution', () => {
    expect(computePlayerElementWarning('kim', 'kim')).toBe('caution');
  });

  it('player sinh target hoặc bị sinh → caution', () => {
    expect(computePlayerElementWarning('kim', 'thuy')).toBe('caution');
    expect(computePlayerElementWarning('thuy', 'kim')).toBe('caution');
  });

  it('null bất kỳ → none', () => {
    expect(computePlayerElementWarning(null, 'hoa')).toBe('none');
    expect(computePlayerElementWarning('hoa', null)).toBe('none');
    expect(computePlayerElementWarning(null, null)).toBe('none');
  });

  it('Set helper: recommended thắng warning', () => {
    expect(computePlayerElementWarningForSet('kim', ['moc'], 'moc')).toBe(
      'recommended',
    );
  });

  it('Set helper: warning thắng caution nếu không có recommended', () => {
    expect(computePlayerElementWarningForSet('moc', ['kim'], 'kim')).toBe(
      'warning',
    );
  });

  it('Set helper: empty secondaries fallback primary', () => {
    expect(computePlayerElementWarningForSet('kim', [], 'moc')).toBe(
      'recommended',
    );
  });
});

describe('DUNGEONS catalog element identity (Phase 14.2.D)', () => {
  it('mọi dungeon validate không issue', () => {
    for (const d of DUNGEONS) {
      const issues = validateDungeonElementProfile(d);
      expect(issues, `dungeon ${d.key}: ${issues.join(' | ')}`).toEqual([]);
    }
  });

  it('mỗi element có ≥ 1 dungeon dominant', () => {
    for (const el of ELEMENTS) {
      const list = dungeonsByDominantElement(DUNGEONS, el);
      expect(
        list.length,
        `element ${el} cần ≥ 1 dungeon dominant`,
      ).toBeGreaterThanOrEqual(1);
    }
  });

  it('mọi dungeon có dominantElement hợp lệ (∈ ELEMENTS hoặc null)', () => {
    for (const d of DUNGEONS) {
      const profile = getDungeonElementProfile(d);
      const e = profile.dominantElement;
      const ok = e === null || (ELEMENTS as readonly string[]).includes(e);
      expect(ok, `dungeon ${d.key} dominantElement=${e}`).toBe(true);
    }
  });

  it('recommendedCounterElement consistent — counter của dominant', () => {
    for (const d of DUNGEONS) {
      const profile = getDungeonElementProfile(d);
      if (profile.dominantElement && profile.recommendedCounterElement) {
        expect(
          elementOvercomes(profile.recommendedCounterElement),
          `dungeon ${d.key}: recommendedCounter ${profile.recommendedCounterElement} không khắc dominant ${profile.dominantElement}`,
        ).toBe(profile.dominantElement);
      }
    }
  });
});

describe('BOSSES catalog element identity (Phase 14.2.D)', () => {
  it('mọi boss validate không issue', () => {
    for (const b of BOSSES) {
      const issues = validateBossElementProfile(b);
      expect(issues, `boss ${b.key}: ${issues.join(' | ')}`).toEqual([]);
    }
  });

  it('mỗi element có ≥ 1 boss có weakness hệ đó', () => {
    for (const el of ELEMENTS) {
      const list = bossesWeakTo(BOSSES, el);
      expect(
        list.length,
        `element ${el} cần ≥ 1 boss weak to nó`,
      ).toBeGreaterThanOrEqual(1);
    }
  });

  it('mọi boss có element hợp lệ (∈ ELEMENTS hoặc null)', () => {
    for (const b of BOSSES) {
      const profile = getBossElementProfile(b);
      const e = profile.element;
      const ok = e === null || (ELEMENTS as readonly string[]).includes(e);
      expect(ok, `boss ${b.key} element=${e}`).toBe(true);
    }
  });

  it('weaknessElement match counter(element) cho boss có hệ', () => {
    for (const b of BOSSES) {
      const profile = getBossElementProfile(b);
      if (profile.element && profile.weaknessElement) {
        expect(
          profile.weaknessElement,
          `boss ${b.key}: weakness ${profile.weaknessElement} != counter(${profile.element})`,
        ).toBe(elementCounter(profile.element));
      }
    }
  });

  it('resistElements là subset của elementalResist keys (nếu có)', () => {
    for (const b of BOSSES) {
      if (!b.elementalResist) continue;
      const profile = getBossElementProfile(b);
      const resistKeys = new Set<ElementKey>(
        Object.entries(b.elementalResist)
          .filter(([, v]) => typeof v === 'number' && v < 1)
          .map(([k]) => k as ElementKey),
      );
      for (const el of profile.resistElements) {
        expect(
          resistKeys.has(el),
          `boss ${b.key} resistElements ${el} không có trong elementalResist`,
        ).toBe(true);
      }
    }
  });
});

describe('No-double-multiplier invariant (Phase 14.2.D)', () => {
  it('weaknessElement field thuần UI hint — không expose multiplier numeric', () => {
    // BossElementProfile chỉ có element key + element key list, KHÔNG có
    // multiplier field. Damage compute luôn qua `elementalMultiplier`
    // (Phase 11.3.B) + `composeMonsterElementalResist` (Phase 14.2.B).
    // Test này backstop nếu ai đó add multiplier field, sẽ phá test.
    for (const b of BOSSES) {
      const profile = getBossElementProfile(b);
      expect(profile).not.toHaveProperty('weaknessMultiplier');
      expect(profile).not.toHaveProperty('resistMultiplier');
      expect(profile).not.toHaveProperty('elementalAttackBonus');
    }
  });

  it('DungeonElementProfile không expose multiplier', () => {
    for (const d of DUNGEONS) {
      const profile = getDungeonElementProfile(d);
      expect(profile).not.toHaveProperty('counterMultiplier');
      expect(profile).not.toHaveProperty('elementBonus');
    }
  });
});
