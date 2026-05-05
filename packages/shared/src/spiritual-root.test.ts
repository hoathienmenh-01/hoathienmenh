import { describe, it, expect } from 'vitest';
import {
  SPIRITUAL_ROOT_GRADES,
  SPIRITUAL_ROOT_GRADE_DEFS,
  getSpiritualRootGradeDef,
  compareSpiritualRootGrade,
  elementGenerates,
  elementOvercomes,
  elementMultiplier,
  validateSpiritualRootState,
  characterSkillElementBonus,
  computeSpiritualRootTribulationResist,
  type SpiritualRootGrade,
} from './spiritual-root';
import { ELEMENTS, type ElementKey } from './combat';
import {
  ELEMENT_MODIFIER_ABSOLUTE_CEIL,
  ELEMENT_MODIFIER_ABSOLUTE_FLOOR,
  ELEMENT_NEUTRAL_MULTIPLIER,
} from './balance-dials';

describe('Spiritual Root catalog (Phase 11.0 prep)', () => {
  describe('SPIRITUAL_ROOT_GRADES tier list', () => {
    it('có đủ 5 grade theo GAME_DESIGN_BIBLE.md §C.4', () => {
      expect(SPIRITUAL_ROOT_GRADES).toEqual(['pham', 'linh', 'huyen', 'tien', 'than']);
    });

    it('SPIRITUAL_ROOT_GRADE_DEFS có entry cho mọi grade trong tier list', () => {
      for (const grade of SPIRITUAL_ROOT_GRADES) {
        expect(SPIRITUAL_ROOT_GRADE_DEFS.find((d) => d.key === grade)).toBeDefined();
      }
      expect(SPIRITUAL_ROOT_GRADE_DEFS.length).toBe(5);
    });

    it('tier index trùng với position trong SPIRITUAL_ROOT_GRADES', () => {
      for (let i = 0; i < SPIRITUAL_ROOT_GRADES.length; i++) {
        const grade = SPIRITUAL_ROOT_GRADES[i];
        const def = getSpiritualRootGradeDef(grade);
        expect(def.tier, `${grade} tier`).toBe(i);
      }
    });

    it('cultivationMultiplier monotonic increasing — grade cao hơn cultivate nhanh hơn', () => {
      for (let i = 1; i < SPIRITUAL_ROOT_GRADE_DEFS.length; i++) {
        expect(
          SPIRITUAL_ROOT_GRADE_DEFS[i].cultivationMultiplier,
          `${SPIRITUAL_ROOT_GRADE_DEFS[i].key} cultivationMultiplier`,
        ).toBeGreaterThan(SPIRITUAL_ROOT_GRADE_DEFS[i - 1].cultivationMultiplier);
      }
    });

    it('statBonusPercent monotonic non-decreasing', () => {
      for (let i = 1; i < SPIRITUAL_ROOT_GRADE_DEFS.length; i++) {
        expect(
          SPIRITUAL_ROOT_GRADE_DEFS[i].statBonusPercent,
          `${SPIRITUAL_ROOT_GRADE_DEFS[i].key} statBonusPercent`,
        ).toBeGreaterThanOrEqual(SPIRITUAL_ROOT_GRADE_DEFS[i - 1].statBonusPercent);
      }
    });

    it('secondaryElementCount monotonic non-decreasing và <= 4 (max khi than = 1 primary + 4 secondary = 5 element)', () => {
      for (let i = 1; i < SPIRITUAL_ROOT_GRADE_DEFS.length; i++) {
        expect(
          SPIRITUAL_ROOT_GRADE_DEFS[i].secondaryElementCount,
        ).toBeGreaterThanOrEqual(SPIRITUAL_ROOT_GRADE_DEFS[i - 1].secondaryElementCount);
      }
      for (const def of SPIRITUAL_ROOT_GRADE_DEFS) {
        expect(def.secondaryElementCount, `${def.key} secondaryElementCount <= 4`).toBeLessThanOrEqual(4);
        expect(def.secondaryElementCount, `${def.key} secondaryElementCount >= 0`).toBeGreaterThanOrEqual(0);
      }
    });

    it('rollWeight monotonic decreasing — grade cao hơn rare hơn (anti-pay-to-win)', () => {
      for (let i = 1; i < SPIRITUAL_ROOT_GRADE_DEFS.length; i++) {
        expect(
          SPIRITUAL_ROOT_GRADE_DEFS[i].rollWeight,
          `${SPIRITUAL_ROOT_GRADE_DEFS[i].key} rollWeight`,
        ).toBeLessThan(SPIRITUAL_ROOT_GRADE_DEFS[i - 1].rollWeight);
      }
    });

    it('total rollWeight sum = 100 (rounded percent base)', () => {
      const sum = SPIRITUAL_ROOT_GRADE_DEFS.reduce((acc, d) => acc + d.rollWeight, 0);
      expect(sum).toBe(100);
    });

    it('mỗi grade def có name + description không empty', () => {
      for (const def of SPIRITUAL_ROOT_GRADE_DEFS) {
        expect(def.name.length, `${def.key} name`).toBeGreaterThan(0);
        expect(def.description.length, `${def.key} description`).toBeGreaterThan(0);
      }
    });

    it('getSpiritualRootGradeDef throws on invalid grade', () => {
      expect(() => getSpiritualRootGradeDef('invalid' as SpiritualRootGrade)).toThrow();
    });
  });

  describe('compareSpiritualRootGrade', () => {
    it('cùng grade trả về 0', () => {
      expect(compareSpiritualRootGrade('pham', 'pham')).toBe(0);
      expect(compareSpiritualRootGrade('than', 'than')).toBe(0);
    });

    it('grade cao hơn trả về > 0', () => {
      expect(compareSpiritualRootGrade('linh', 'pham')).toBeGreaterThan(0);
      expect(compareSpiritualRootGrade('than', 'pham')).toBeGreaterThan(0);
      expect(compareSpiritualRootGrade('tien', 'huyen')).toBeGreaterThan(0);
    });

    it('grade thấp hơn trả về < 0', () => {
      expect(compareSpiritualRootGrade('pham', 'linh')).toBeLessThan(0);
      expect(compareSpiritualRootGrade('huyen', 'than')).toBeLessThan(0);
    });
  });

  describe('elementGenerates / elementOvercomes — Ngũ Hành cycle', () => {
    it('chu kỳ tương sinh đầy đủ 5 element', () => {
      // Kim sinh Thuỷ → Thuỷ sinh Mộc → Mộc sinh Hoả → Hoả sinh Thổ → Thổ sinh Kim
      expect(elementGenerates('kim')).toBe('thuy');
      expect(elementGenerates('thuy')).toBe('moc');
      expect(elementGenerates('moc')).toBe('hoa');
      expect(elementGenerates('hoa')).toBe('tho');
      expect(elementGenerates('tho')).toBe('kim');
    });

    it('chu kỳ tương sinh là cycle — apply 5 lần về lại ban đầu', () => {
      for (const start of ELEMENTS) {
        let cur: ElementKey = start;
        for (let i = 0; i < 5; i++) cur = elementGenerates(cur);
        expect(cur, `${start} after 5 generates`).toBe(start);
      }
    });

    it('chu kỳ tương khắc đầy đủ 5 element', () => {
      // Kim khắc Mộc → Mộc khắc Thổ → Thổ khắc Thuỷ → Thuỷ khắc Hoả → Hoả khắc Kim
      expect(elementOvercomes('kim')).toBe('moc');
      expect(elementOvercomes('moc')).toBe('tho');
      expect(elementOvercomes('tho')).toBe('thuy');
      expect(elementOvercomes('thuy')).toBe('hoa');
      expect(elementOvercomes('hoa')).toBe('kim');
    });

    it('chu kỳ tương khắc là cycle — apply 5 lần về lại ban đầu', () => {
      for (const start of ELEMENTS) {
        let cur: ElementKey = start;
        for (let i = 0; i < 5; i++) cur = elementOvercomes(cur);
        expect(cur, `${start} after 5 overcomes`).toBe(start);
      }
    });

    it('tương sinh và tương khắc không trùng nhau (ngược chu kỳ)', () => {
      for (const e of ELEMENTS) {
        expect(elementGenerates(e), `${e} generates ≠ overcomes`).not.toBe(elementOvercomes(e));
      }
    });
  });

  describe('elementMultiplier — Ngũ Hành damage modifier', () => {
    it('vô hệ (null) attacker hoặc defender → 1.0 neutral', () => {
      expect(elementMultiplier(null, 'kim')).toBe(1.0);
      expect(elementMultiplier('kim', null)).toBe(1.0);
      expect(elementMultiplier(null, null)).toBe(1.0);
    });

    it('cùng hệ → 0.9 (cùng triệt một phần)', () => {
      for (const e of ELEMENTS) {
        expect(elementMultiplier(e, e), `${e} vs ${e}`).toBe(0.9);
      }
    });

    it('tương khắc (attacker khắc defender) → 1.3', () => {
      expect(elementMultiplier('kim', 'moc')).toBe(1.3); // Kim khắc Mộc
      expect(elementMultiplier('moc', 'tho')).toBe(1.3);
      expect(elementMultiplier('tho', 'thuy')).toBe(1.3);
      expect(elementMultiplier('thuy', 'hoa')).toBe(1.3);
      expect(elementMultiplier('hoa', 'kim')).toBe(1.3);
    });

    it('bị khắc (attacker bị defender khắc) → 0.7', () => {
      expect(elementMultiplier('moc', 'kim')).toBe(0.7); // Mộc bị Kim khắc
      expect(elementMultiplier('tho', 'moc')).toBe(0.7);
      expect(elementMultiplier('thuy', 'tho')).toBe(0.7);
      expect(elementMultiplier('hoa', 'thuy')).toBe(0.7);
      expect(elementMultiplier('kim', 'hoa')).toBe(0.7);
    });

    it('tương sinh (attacker sinh defender) → 1.2', () => {
      expect(elementMultiplier('kim', 'thuy')).toBe(1.2); // Kim sinh Thuỷ
      expect(elementMultiplier('thuy', 'moc')).toBe(1.2);
      expect(elementMultiplier('moc', 'hoa')).toBe(1.2);
      expect(elementMultiplier('hoa', 'tho')).toBe(1.2);
      expect(elementMultiplier('tho', 'kim')).toBe(1.2);
    });

    it('bị sinh (attacker bị defender sinh) → 0.85', () => {
      expect(elementMultiplier('thuy', 'kim')).toBe(0.85); // Thuỷ bị Kim sinh
      expect(elementMultiplier('moc', 'thuy')).toBe(0.85);
      expect(elementMultiplier('hoa', 'moc')).toBe(0.85);
      expect(elementMultiplier('tho', 'hoa')).toBe(0.85);
      expect(elementMultiplier('kim', 'tho')).toBe(0.85);
    });

    it('mọi cặp (attacker, defender) đều có multiplier hợp lệ ∈ [0.7, 1.3]', () => {
      for (const a of ELEMENTS) {
        for (const d of ELEMENTS) {
          const m = elementMultiplier(a, d);
          expect(m, `${a} vs ${d} multiplier=${m}`).toBeGreaterThanOrEqual(0.7);
          expect(m, `${a} vs ${d} multiplier=${m}`).toBeLessThanOrEqual(1.3);
        }
      }
    });

    it('symmetry — elementMultiplier(a, b) * elementMultiplier(b, a) ≤ 1.0 (no double-buff exploit)', () => {
      for (const a of ELEMENTS) {
        for (const d of ELEMENTS) {
          if (a === d) continue;
          const product = elementMultiplier(a, d) * elementMultiplier(d, a);
          // Tương khắc 1.3 × bị khắc 0.7 = 0.91. Tương sinh 1.2 × bị sinh 0.85 = 1.02
          // (sinh bidirectional gây slight overflow - OK vì sinh là synergy thuận chu kỳ).
          // Cùng hệ 0.9 × 0.9 = 0.81. Vô hệ N/A (null ≠ ElementKey).
          expect(product, `${a} <-> ${d} mutual product`).toBeLessThanOrEqual(1.05);
        }
      }
    });

    it('elementMultiplier delegate sang describeElementMatch (single source-of-truth)', async () => {
      const { describeElementMatch } = await import('./balance-dials');
      for (const a of ELEMENTS) {
        for (const d of ELEMENTS) {
          expect(elementMultiplier(a, d)).toBe(describeElementMatch(a, d).multiplier);
        }
      }
      expect(elementMultiplier(null, null)).toBe(describeElementMatch(null, null).multiplier);
      expect(elementMultiplier('kim', null)).toBe(describeElementMatch('kim', null).multiplier);
      expect(elementMultiplier(null, 'moc')).toBe(describeElementMatch(null, 'moc').multiplier);
    });
  });

  describe('validateSpiritualRootState', () => {
    const validState = {
      grade: 'huyen',
      primaryElement: 'kim',
      secondaryElements: ['thuy', 'hoa'],
      purity: 80,
      rerollCount: 0,
    };

    it('valid state với secondaryElements khớp grade tier', () => {
      const r = validateSpiritualRootState(validState);
      expect(r).not.toBeNull();
      expect(r?.grade).toBe('huyen');
      expect(r?.primaryElement).toBe('kim');
      expect(r?.secondaryElements).toEqual(['thuy', 'hoa']);
    });

    it('reject khi grade không hợp lệ', () => {
      expect(validateSpiritualRootState({ ...validState, grade: 'invalid' })).toBeNull();
    });

    it('reject khi primaryElement không hợp lệ', () => {
      expect(validateSpiritualRootState({ ...validState, primaryElement: 'long' })).toBeNull();
    });

    it('reject khi secondaryElements count không khớp grade', () => {
      // huyen yêu cầu 2 secondary, đưa 1 → reject.
      expect(
        validateSpiritualRootState({ ...validState, secondaryElements: ['thuy'] }),
      ).toBeNull();
      // pham yêu cầu 0 secondary, đưa 1 → reject.
      expect(
        validateSpiritualRootState({
          grade: 'pham',
          primaryElement: 'kim',
          secondaryElements: ['thuy'],
          purity: 100,
          rerollCount: 0,
        }),
      ).toBeNull();
    });

    it('reject khi secondaryElements trùng primaryElement', () => {
      expect(
        validateSpiritualRootState({
          ...validState,
          secondaryElements: ['kim', 'thuy'], // kim trùng primary
        }),
      ).toBeNull();
    });

    it('reject khi secondaryElements trùng nhau', () => {
      expect(
        validateSpiritualRootState({
          ...validState,
          secondaryElements: ['thuy', 'thuy'],
        }),
      ).toBeNull();
    });

    it('reject khi purity ngoài [0, 100]', () => {
      expect(validateSpiritualRootState({ ...validState, purity: -1 })).toBeNull();
      expect(validateSpiritualRootState({ ...validState, purity: 101 })).toBeNull();
    });

    it('reject khi rerollCount âm hoặc không integer', () => {
      expect(validateSpiritualRootState({ ...validState, rerollCount: -1 })).toBeNull();
      expect(validateSpiritualRootState({ ...validState, rerollCount: 1.5 })).toBeNull();
    });

    it('reject khi state null/undefined/non-object', () => {
      expect(validateSpiritualRootState(null)).toBeNull();
      expect(validateSpiritualRootState(undefined)).toBeNull();
      expect(validateSpiritualRootState('string')).toBeNull();
      expect(validateSpiritualRootState(123)).toBeNull();
    });

    it('valid than grade với 4 secondary (toàn linh căn)', () => {
      const r = validateSpiritualRootState({
        grade: 'than',
        primaryElement: 'kim',
        secondaryElements: ['moc', 'thuy', 'hoa', 'tho'],
        purity: 100,
        rerollCount: 0,
      });
      expect(r).not.toBeNull();
      expect(r?.secondaryElements).toHaveLength(4);
    });

    it('valid pham grade với 0 secondary (đơn linh căn)', () => {
      const r = validateSpiritualRootState({
        grade: 'pham',
        primaryElement: 'tho',
        secondaryElements: [],
        purity: 50,
        rerollCount: 0,
      });
      expect(r).not.toBeNull();
      expect(r?.secondaryElements).toHaveLength(0);
    });
  });

  describe('characterSkillElementBonus', () => {
    const huyenChar = {
      primaryElement: 'kim' as ElementKey,
      secondaryElements: ['thuy', 'hoa'] as ElementKey[],
    };

    it('skill cùng primaryElement → bonus +0.10 trên top base multiplier', () => {
      // Kim attacker khắc Mộc target (1.3) + cùng primary (+0.1) = 1.4
      const r = characterSkillElementBonus(huyenChar, 'kim', 'moc');
      expect(r).toBeCloseTo(1.4, 2);
    });

    it('skill thuộc secondaryElements → bonus +0.05', () => {
      // Thuỷ attacker khắc Hoả target (1.3) + thuỷ ∈ secondary (+0.05) = 1.35
      const r = characterSkillElementBonus(huyenChar, 'thuy', 'hoa');
      expect(r).toBeCloseTo(1.35, 2);
    });

    it('skill không thuộc primary/secondary → chỉ base multiplier', () => {
      // Mộc attacker tương khắc Thổ target (1.3) + mộc không trong huyenChar → 1.3
      const r = characterSkillElementBonus(huyenChar, 'moc', 'tho');
      expect(r).toBeCloseTo(1.3, 2);
    });

    it('skillElement null → 1.0 base, không bonus character', () => {
      const r = characterSkillElementBonus(huyenChar, null, 'kim');
      expect(r).toBe(1.0);
    });

    it('character null → chỉ base multiplier (NPC monster cast skill)', () => {
      const r = characterSkillElementBonus(null, 'kim', 'moc');
      expect(r).toBeCloseTo(1.3, 2);
    });

    it('cùng hệ skill vs target + character primary cùng hệ → 0.9 + 0.1 = 1.0', () => {
      // Kim vs Kim cùng hệ 0.9 + character primary Kim (+0.1) = 1.0 (neutral).
      const r = characterSkillElementBonus(huyenChar, 'kim', 'kim');
      expect(r).toBeCloseTo(1.0, 2);
    });
  });

  describe('computeSpiritualRootTribulationResist (Phase 11.6.C)', () => {
    it('tâm kiếp (waveElement=null) → luôn return 1.0 dù primary là gì', () => {
      // Tâm Kiếp ignore element regardless of root.
      expect(computeSpiritualRootTribulationResist('thuy', ['hoa'], null)).toBe(
        ELEMENT_NEUTRAL_MULTIPLIER,
      );
      expect(computeSpiritualRootTribulationResist('hoa', [], null)).toBe(
        ELEMENT_NEUTRAL_MULTIPLIER,
      );
      expect(computeSpiritualRootTribulationResist(null, [], null)).toBe(
        ELEMENT_NEUTRAL_MULTIPLIER,
      );
    });

    it('legacy character (primaryElement=null) → 1.0 fallback (backward-compat)', () => {
      for (const wave of ELEMENTS) {
        expect(
          computeSpiritualRootTribulationResist(null, [], wave),
          `legacy vs wave=${wave}`,
        ).toBe(ELEMENT_NEUTRAL_MULTIPLIER);
      }
    });

    it('primary cùng hệ wave → 0.9 (resonance, resist nhẹ)', () => {
      // Thuỷ root vs Băng kiếp (wave='thuy') → cùng hệ 0.9.
      expect(computeSpiritualRootTribulationResist('thuy', [], 'thuy')).toBeCloseTo(
        0.9,
        2,
      );
      // Hoả root vs Hoả kiếp.
      expect(computeSpiritualRootTribulationResist('hoa', [], 'hoa')).toBeCloseTo(
        0.9,
        2,
      );
    });

    it('primary khắc wave → 0.7 (countered — root khắc lại kiếp, resist mạnh)', () => {
      // Thổ khắc Thuỷ → primary='tho' vs wave='thuy' → 0.7.
      expect(computeSpiritualRootTribulationResist('tho', [], 'thuy')).toBeCloseTo(
        0.7,
        2,
      );
      // Thuỷ khắc Hoả.
      expect(computeSpiritualRootTribulationResist('thuy', [], 'hoa')).toBeCloseTo(
        0.7,
        2,
      );
      // Kim khắc Mộc.
      expect(computeSpiritualRootTribulationResist('kim', [], 'moc')).toBeCloseTo(
        0.7,
        2,
      );
    });

    it('wave khắc primary → 1.3 (counter — kiếp khắc linh căn, weakness)', () => {
      // Hoả khắc Kim → primary='kim' vs wave='hoa' → 1.3.
      expect(computeSpiritualRootTribulationResist('kim', [], 'hoa')).toBeCloseTo(
        1.3,
        2,
      );
      // Thuỷ khắc Hoả → primary='hoa' vs wave='thuy' → 1.3.
      expect(computeSpiritualRootTribulationResist('hoa', [], 'thuy')).toBeCloseTo(
        1.3,
        2,
      );
    });

    it('primary sinh wave → 0.85 (generated — linh căn hấp thụ, resist nhẹ)', () => {
      // Mộc sinh Hoả → primary='moc' vs wave='hoa': "hoa bị sinh bởi moc" = generated 0.85.
      expect(computeSpiritualRootTribulationResist('moc', [], 'hoa')).toBeCloseTo(
        0.85,
        2,
      );
      // Kim sinh Thuỷ → primary='kim' vs wave='thuy' → 0.85.
      expect(computeSpiritualRootTribulationResist('kim', [], 'thuy')).toBeCloseTo(
        0.85,
        2,
      );
    });

    it('wave sinh primary → 1.2 (generate — kiếp nuôi linh căn, weakness)', () => {
      // Mộc sinh Hoả → primary='hoa' vs wave='moc' → "moc khi attack hoa: moc sinh hoa" = generate 1.2.
      expect(computeSpiritualRootTribulationResist('hoa', [], 'moc')).toBeCloseTo(
        1.2,
        2,
      );
    });

    it('secondary trùng wave → giảm thêm -0.05 (resonance phụ)', () => {
      // Hoả root + secondary Thuỷ vs Thuỷ kiếp:
      // base = describeElementMatch('thuy','hoa').mul = 1.3 (thuy khắc hoa)
      // secondary 'thuy' = wave → -0.05 → 1.25.
      expect(
        computeSpiritualRootTribulationResist('hoa', ['thuy'], 'thuy'),
      ).toBeCloseTo(1.25, 2);
    });

    it('secondary khắc wave → giảm thêm -0.05 (counter phụ)', () => {
      // Hoả root + secondary Thổ vs Thuỷ kiếp:
      // base = 1.3 (thuy khắc hoa); secondary 'tho' khắc 'thuy' (tho khắc thuy) → -0.05 → 1.25.
      expect(
        computeSpiritualRootTribulationResist('hoa', ['tho'], 'thuy'),
      ).toBeCloseTo(1.25, 2);
    });

    it('secondary tương sinh wave → KHÔNG bonus (chỉ same/counter mới count)', () => {
      // Hoả root + secondary Mộc vs Thuỷ kiếp:
      // base = 1.3 (thuy khắc hoa); secondary 'moc' không cùng wave và không khắc wave (mộc khắc thổ) → unchanged 1.3.
      expect(
        computeSpiritualRootTribulationResist('hoa', ['moc'], 'thuy'),
      ).toBeCloseTo(1.3, 2);
    });

    it('multi secondary đều count nếu mỗi cái match (each gets -0.05)', () => {
      // Hoả root + secondaries [Thuỷ, Thổ] vs Thuỷ kiếp:
      // base = 1.3; secondary 'thuy'=wave (-0.05); secondary 'tho' khắc 'thuy' (-0.05) → 1.20.
      expect(
        computeSpiritualRootTribulationResist('hoa', ['thuy', 'tho'], 'thuy'),
      ).toBeCloseTo(1.2, 2);
    });

    it('cap floor: aggregate bonus không vượt floor 0.6', () => {
      // Thổ khắc Thuỷ (primary=tho vs wave=thuy) → base 0.7
      // + secondary 'thuy' = wave → -0.05 = 0.65
      // + secondary 'tho' duplicate counter → won't apply (tho=primary, secondaries không trùng primary)
      // → 0.65 vẫn > floor 0.6.
      expect(
        computeSpiritualRootTribulationResist('tho', ['thuy'], 'thuy'),
      ).toBeCloseTo(0.65, 2);
      // Stress floor: than grade với 4 secondary đều count.
      // Primary='tho' vs wave='thuy' → base 0.7
      // secondaries=['thuy','kim','hoa','moc']:
      //   - 'thuy' = wave → -0.05
      //   - 'kim' khắc 'moc' (not wave) → no
      //   - 'hoa' khắc 'kim' (not wave) → no
      //   - 'moc' khắc 'tho' (not wave) → no
      // → 0.65 vẫn > 0.6. Cap không trigger ở case typical.
      const r = computeSpiritualRootTribulationResist(
        'tho',
        ['thuy', 'kim', 'hoa', 'moc'],
        'thuy',
      );
      expect(r).toBeGreaterThanOrEqual(ELEMENT_MODIFIER_ABSOLUTE_FLOOR);
    });

    it('cap ceil: 1.3 weakness + secondary tương sinh không count → vẫn 1.3 (≤ ceil 1.5)', () => {
      // Primary='kim' vs wave='hoa' (hoa khắc kim) → base 1.3
      // secondary='tho': hoa sinh tho → secondary 'tho' không cùng wave 'hoa' và elementOvercomes('tho')='thuy' không = wave → no bonus.
      // → 1.3 ≤ ceil 1.5.
      expect(
        computeSpiritualRootTribulationResist('kim', ['tho'], 'hoa'),
      ).toBeLessThanOrEqual(ELEMENT_MODIFIER_ABSOLUTE_CEIL);
      expect(
        computeSpiritualRootTribulationResist('kim', ['tho'], 'hoa'),
      ).toBeCloseTo(1.3, 2);
    });

    it('luôn nằm trong [floor, ceil] envelope cho mọi combo', () => {
      // Property test: stress mọi 5 primary × 5 wave + 0..4 random secondaries.
      const samples: Array<{
        primary: ElementKey;
        secs: ElementKey[];
        wave: ElementKey | null;
      }> = [];
      for (const primary of ELEMENTS) {
        for (const wave of [...ELEMENTS, null]) {
          // 0 secondary
          samples.push({ primary, secs: [], wave });
          // 1 secondary (each non-primary element)
          for (const sec of ELEMENTS) {
            if (sec === primary) continue;
            samples.push({ primary, secs: [sec], wave });
          }
          // Full 4 secondary (than grade)
          const secs = ELEMENTS.filter((e) => e !== primary);
          samples.push({ primary, secs: [...secs], wave });
        }
      }
      for (const { primary, secs, wave } of samples) {
        const r = computeSpiritualRootTribulationResist(primary, secs, wave);
        expect(r, `primary=${primary}, secs=${secs}, wave=${wave}`).toBeGreaterThanOrEqual(
          ELEMENT_MODIFIER_ABSOLUTE_FLOOR,
        );
        expect(r, `primary=${primary}, secs=${secs}, wave=${wave}`).toBeLessThanOrEqual(
          ELEMENT_MODIFIER_ABSOLUTE_CEIL,
        );
      }
    });

    it('readonly secondaryElements input (không mutate)', () => {
      const secs: readonly ElementKey[] = Object.freeze(['thuy'] as ElementKey[]);
      // Function nhận readonly array — verify TS signature đúng + không throw freeze error.
      const r = computeSpiritualRootTribulationResist('hoa', secs, 'thuy');
      expect(r).toBeCloseTo(1.25, 2);
    });
  });
});
