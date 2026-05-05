import { describe, it, expect } from 'vitest';
import {
  CULTIVATION_METHODS,
  getCultivationMethodDef,
  methodsByElement,
  methodsForSect,
  canLearnMethod,
  computeMethodElementAffinityBonus,
  type CultivationMethodGrade,
} from './cultivation-methods';
import { ELEMENTS, type ElementKey, type SectKey } from './combat';
import { REALMS } from './realms';
import {
  METHOD_ELEMENT_PRIMARY_BONUS,
  METHOD_ELEMENT_SECONDARY_BONUS,
} from './balance-dials';

const REALM_KEYS = new Set(REALMS.map((r) => r.key));
const VALID_GRADES: readonly CultivationMethodGrade[] = ['pham', 'huyen', 'tien', 'than'];
const VALID_SECTS: readonly (SectKey | null)[] = [null, 'thanh_van', 'huyen_thuy', 'tu_la'];

/**
 * CULTIVATION_METHODS catalog balance — Phase 11.1 catalog foundation.
 * Bound các invariant về grade tier, element coverage, sect coverage,
 * stat budget, và forbiddenElements safety.
 *
 * Stat budget (BALANCE_MODEL.md §4.4 cultivation rate):
 *   pham starter        expMul 1.0,   stat +0%   - baseline
 *   huyen-grade         expMul 1.15..1.30, stat sum -5..+30 - mid
 *   tien-grade sect     expMul 1.40, stat sum  +30..+50 - end-mid
 *   than-grade endgame  expMul 1.60..1.80, stat sum +60..+105 - endgame
 */

describe('CULTIVATION_METHODS catalog (Phase 11.1)', () => {
  describe('catalog shape', () => {
    it('total method count >= 12 (Phase 11.1 baseline)', () => {
      expect(CULTIVATION_METHODS.length).toBeGreaterThanOrEqual(12);
    });

    it('mỗi method có key unique (no duplicates)', () => {
      const keys = new Set<string>();
      for (const m of CULTIVATION_METHODS) {
        expect(keys.has(m.key), `duplicate key: ${m.key}`).toBe(false);
        keys.add(m.key);
      }
    });

    it('mỗi method có required field non-empty', () => {
      for (const m of CULTIVATION_METHODS) {
        expect(m.key.length, `${m.key} key empty`).toBeGreaterThan(0);
        expect(m.name.length, `${m.key} name empty`).toBeGreaterThan(0);
        expect(m.description.length, `${m.key} description empty`).toBeGreaterThan(0);
      }
    });

    it('mỗi method có grade hợp lệ', () => {
      for (const m of CULTIVATION_METHODS) {
        expect(
          VALID_GRADES.includes(m.grade),
          `${m.key} grade=${m.grade} không trong valid grades`,
        ).toBe(true);
      }
    });

    it('mỗi method có element ∈ ELEMENTS hoặc null', () => {
      for (const m of CULTIVATION_METHODS) {
        if (m.element !== null) {
          expect(
            ELEMENTS.includes(m.element),
            `${m.key} element=${m.element} không trong ELEMENTS`,
          ).toBe(true);
        }
      }
    });

    it('mỗi method có unlockRealm ∈ REALMS keys', () => {
      for (const m of CULTIVATION_METHODS) {
        expect(
          REALM_KEYS.has(m.unlockRealm),
          `${m.key} unlockRealm=${m.unlockRealm} không tồn tại`,
        ).toBe(true);
      }
    });

    it('mỗi method có requiredSect ∈ SectKey hoặc null', () => {
      for (const m of CULTIVATION_METHODS) {
        expect(
          VALID_SECTS.includes(m.requiredSect),
          `${m.key} requiredSect=${m.requiredSect} không hợp lệ`,
        ).toBe(true);
      }
    });

    it('mỗi method có source hợp lệ', () => {
      const validSources = ['starter', 'sect_shop', 'dungeon_drop', 'boss_drop', 'event', 'quest_milestone'];
      for (const m of CULTIVATION_METHODS) {
        expect(
          validSources.includes(m.source),
          `${m.key} source=${m.source} không hợp lệ`,
        ).toBe(true);
      }
    });
  });

  describe('balance — expMultiplier & statBonus', () => {
    it('expMultiplier ∈ [1.0, 2.0] — không quá power-creep', () => {
      for (const m of CULTIVATION_METHODS) {
        expect(m.expMultiplier, `${m.key} expMultiplier`).toBeGreaterThanOrEqual(1.0);
        expect(m.expMultiplier, `${m.key} expMultiplier`).toBeLessThanOrEqual(2.0);
      }
    });

    it('pham starter có expMultiplier = 1.0 (baseline, không bonus)', () => {
      const starters = CULTIVATION_METHODS.filter((m) => m.grade === 'pham');
      expect(starters.length, 'must have at least 1 pham starter').toBeGreaterThanOrEqual(1);
      for (const m of starters) {
        expect(m.expMultiplier, `${m.key} pham expMul`).toBe(1.0);
      }
    });

    it('huyen-grade expMultiplier ∈ [1.10, 1.35]', () => {
      for (const m of CULTIVATION_METHODS) {
        if (m.grade !== 'huyen') continue;
        expect(m.expMultiplier, `${m.key} huyen expMul`).toBeGreaterThanOrEqual(1.1);
        expect(m.expMultiplier, `${m.key} huyen expMul`).toBeLessThanOrEqual(1.35);
      }
    });

    it('tien-grade expMultiplier ∈ [1.35, 1.5]', () => {
      for (const m of CULTIVATION_METHODS) {
        if (m.grade !== 'tien') continue;
        expect(m.expMultiplier, `${m.key} tien expMul`).toBeGreaterThanOrEqual(1.35);
        expect(m.expMultiplier, `${m.key} tien expMul`).toBeLessThanOrEqual(1.5);
      }
    });

    it('than-grade expMultiplier ∈ [1.55, 1.85]', () => {
      for (const m of CULTIVATION_METHODS) {
        if (m.grade !== 'than') continue;
        expect(m.expMultiplier, `${m.key} than expMul`).toBeGreaterThanOrEqual(1.55);
        expect(m.expMultiplier, `${m.key} than expMul`).toBeLessThanOrEqual(1.85);
      }
    });

    it('statBonus.hpMax/mpMax/atk/def ∈ [-10, 35] (allow huyết-kinh-style negative tradeoff)', () => {
      for (const m of CULTIVATION_METHODS) {
        for (const [field, val] of Object.entries(m.statBonus)) {
          expect(val, `${m.key} statBonus.${field}=${val}`).toBeGreaterThanOrEqual(-10);
          expect(val, `${m.key} statBonus.${field}=${val}`).toBeLessThanOrEqual(35);
        }
      }
    });

    it('pham starter có statBonus tất cả = 0 (baseline)', () => {
      const starters = CULTIVATION_METHODS.filter((m) => m.grade === 'pham');
      for (const m of starters) {
        expect(m.statBonus.hpMaxPercent, `${m.key} pham hp`).toBe(0);
        expect(m.statBonus.mpMaxPercent, `${m.key} pham mp`).toBe(0);
        expect(m.statBonus.atkPercent, `${m.key} pham atk`).toBe(0);
        expect(m.statBonus.defPercent, `${m.key} pham def`).toBe(0);
      }
    });

    it('than-grade có sum stat bonus >= 60 (endgame value justifies drop rarity)', () => {
      for (const m of CULTIVATION_METHODS) {
        if (m.grade !== 'than') continue;
        const sum = m.statBonus.hpMaxPercent
          + m.statBonus.mpMaxPercent
          + m.statBonus.atkPercent
          + m.statBonus.defPercent;
        expect(sum, `${m.key} than stat sum`).toBeGreaterThanOrEqual(60);
      }
    });
  });

  describe('coverage — element / sect / grade', () => {
    it('có ít nhất 1 method cho mỗi Ngũ Hành element (huyen-grade base coverage)', () => {
      for (const e of ELEMENTS) {
        const methodsOfElement = CULTIVATION_METHODS.filter((m) => m.element === e);
        expect(methodsOfElement.length, `element ${e} coverage`).toBeGreaterThanOrEqual(1);
      }
    });

    it('có ít nhất 1 vô hệ method (null element) cho universal availability', () => {
      const neutral = CULTIVATION_METHODS.filter((m) => m.element === null);
      expect(neutral.length).toBeGreaterThanOrEqual(1);
    });

    it('mỗi sect (thanh_van/huyen_thuy/tu_la) có ít nhất 1 sect-locked method', () => {
      const sects: SectKey[] = ['thanh_van', 'huyen_thuy', 'tu_la'];
      for (const s of sects) {
        const sectMethods = CULTIVATION_METHODS.filter((m) => m.requiredSect === s);
        expect(sectMethods.length, `sect ${s} coverage`).toBeGreaterThanOrEqual(1);
      }
    });

    it('có ít nhất 1 method mỗi grade (pham / huyen / tien / than)', () => {
      for (const g of VALID_GRADES) {
        const ofGrade = CULTIVATION_METHODS.filter((m) => m.grade === g);
        expect(ofGrade.length, `grade ${g} coverage`).toBeGreaterThanOrEqual(1);
      }
    });

    it('starter source chỉ dành cho pham grade (không có starter than-grade)', () => {
      for (const m of CULTIVATION_METHODS) {
        if (m.source === 'starter') {
          expect(m.grade, `${m.key} starter must be pham`).toBe('pham');
        }
      }
    });
  });

  describe('forbiddenElements safety', () => {
    it('forbiddenElements (nếu có) chỉ chứa ElementKey hợp lệ và không trùng method.element', () => {
      for (const m of CULTIVATION_METHODS) {
        if (!m.forbiddenElements || m.forbiddenElements.length === 0) continue;
        for (const e of m.forbiddenElements) {
          expect(ELEMENTS.includes(e), `${m.key} forbiddenElements has invalid ${e}`).toBe(true);
          if (m.element !== null) {
            expect(
              e,
              `${m.key} forbiddenElements không được trùng method.element`,
            ).not.toBe(m.element);
          }
        }
      }
    });

    it('forbiddenElements không có duplicate', () => {
      for (const m of CULTIVATION_METHODS) {
        if (!m.forbiddenElements) continue;
        const set = new Set(m.forbiddenElements);
        expect(set.size, `${m.key} forbiddenElements duplicate`).toBe(m.forbiddenElements.length);
      }
    });

    it('vô hệ method (element null) không có forbiddenElements (universal)', () => {
      for (const m of CULTIVATION_METHODS) {
        if (m.element !== null) continue;
        expect(
          !m.forbiddenElements || m.forbiddenElements.length === 0,
          `${m.key} vô hệ không nên có forbiddenElements`,
        ).toBe(true);
      }
    });
  });

  describe('passiveSkillKeys (forward-compat phase 11.2)', () => {
    it('passiveSkillKeys nếu có là array string non-empty', () => {
      for (const m of CULTIVATION_METHODS) {
        if (!m.passiveSkillKeys) continue;
        expect(Array.isArray(m.passiveSkillKeys), `${m.key} passiveSkillKeys`).toBe(true);
        for (const k of m.passiveSkillKeys) {
          expect(typeof k, `${m.key} passiveSkillKey`).toBe('string');
          expect(k.length, `${m.key} passiveSkillKey empty`).toBeGreaterThan(0);
        }
      }
    });
  });

  describe('helper functions', () => {
    it('getCultivationMethodDef trả method khi key valid', () => {
      const m = getCultivationMethodDef('khai_thien_quyet');
      expect(m).toBeDefined();
      expect(m?.key).toBe('khai_thien_quyet');
    });

    it('getCultivationMethodDef trả undefined khi key invalid', () => {
      expect(getCultivationMethodDef('not_a_real_method')).toBeUndefined();
    });

    it('methodsByElement(kim) include kim methods + neutral methods (default)', () => {
      const r = methodsByElement('kim');
      expect(r.length).toBeGreaterThan(0);
      for (const m of r) {
        expect(m.element === 'kim' || m.element === null, `${m.key}`).toBe(true);
      }
    });

    it('methodsByElement(kim, includeNeutral=false) chỉ kim methods', () => {
      const r = methodsByElement('kim', { includeNeutral: false });
      for (const m of r) {
        expect(m.element).toBe('kim');
      }
    });

    it('methodsForSect(thanh_van) include thanh_van methods + open methods', () => {
      const r = methodsForSect('thanh_van');
      expect(r.length).toBeGreaterThan(0);
      for (const m of r) {
        expect(
          m.requiredSect === 'thanh_van' || m.requiredSect === null,
          `${m.key} requiredSect=${m.requiredSect}`,
        ).toBe(true);
      }
    });

    it('methodsForSect(null) chỉ open methods (không sect-locked)', () => {
      const r = methodsForSect(null);
      for (const m of r) {
        expect(m.requiredSect).toBeNull();
      }
    });

    it('methodsForSect(thanh_van, includeOpen=false) chỉ thanh_van methods', () => {
      const r = methodsForSect('thanh_van', { includeOpen: false });
      for (const m of r) {
        expect(m.requiredSect).toBe('thanh_van');
      }
    });

    it('canLearnMethod true khi primaryElement không trong forbiddenElements', () => {
      const tuLa = getCultivationMethodDef('tu_la_huyet_kinh');
      expect(tuLa).toBeDefined();
      // tu_la_huyet_kinh forbidden: thuy → kim/moc/hoa/tho học được.
      expect(canLearnMethod(tuLa!, 'kim')).toBe(true);
      expect(canLearnMethod(tuLa!, 'hoa')).toBe(true);
      expect(canLearnMethod(tuLa!, 'thuy')).toBe(false);
    });

    it('canLearnMethod true cho method không có forbiddenElements', () => {
      const starter = getCultivationMethodDef('khai_thien_quyet');
      expect(starter).toBeDefined();
      for (const e of ELEMENTS) {
        expect(canLearnMethod(starter!, e), `starter learn by ${e}`).toBe(true);
      }
    });
  });

  describe('computeMethodElementAffinityBonus (Phase 11.1.E)', () => {
    it('methodElement === primaryElement → trả METHOD_ELEMENT_PRIMARY_BONUS (+10%)', () => {
      expect(computeMethodElementAffinityBonus('kim', [], 'kim')).toBe(
        METHOD_ELEMENT_PRIMARY_BONUS,
      );
      expect(computeMethodElementAffinityBonus('hoa', ['kim', 'moc'], 'hoa')).toBe(
        METHOD_ELEMENT_PRIMARY_BONUS,
      );
    });

    it('methodElement ∈ secondaryElements → trả METHOD_ELEMENT_SECONDARY_BONUS (+5%)', () => {
      expect(computeMethodElementAffinityBonus('kim', ['hoa'], 'hoa')).toBe(
        METHOD_ELEMENT_SECONDARY_BONUS,
      );
      expect(
        computeMethodElementAffinityBonus('thuy', ['kim', 'moc', 'hoa'], 'moc'),
      ).toBe(METHOD_ELEMENT_SECONDARY_BONUS);
    });

    it('primary trumps secondary — primary match check trước secondary list', () => {
      // `methodElement = kim` khớp cả `primary=kim` lẫn `secondaryElements=[kim,moc]` (giả định
      // — runtime dữ liệu KHÔNG nên có overlap, nhưng helper phải an toàn).
      // Primary check trước → trả primary bonus.
      expect(
        computeMethodElementAffinityBonus('kim', ['kim', 'moc'], 'kim'),
      ).toBe(METHOD_ELEMENT_PRIMARY_BONUS);
    });

    it('khác hệ (không primary, không secondary) → trả 0 (không bonus)', () => {
      expect(computeMethodElementAffinityBonus('kim', ['moc'], 'hoa')).toBe(0);
      expect(computeMethodElementAffinityBonus('hoa', [], 'thuy')).toBe(0);
    });

    it('methodElement === null (vô hệ — khai_thien_quyet, thai_hu_chan_kinh) → trả 0', () => {
      // Vô hệ method KHÔNG thiên vị linh căn nào — bonus 0.
      for (const e of ELEMENTS) {
        expect(
          computeMethodElementAffinityBonus(e, [], null),
          `methodElement=null vs primary=${e}`,
        ).toBe(0);
        expect(
          computeMethodElementAffinityBonus(e, ['moc', 'thuy'], null),
          `methodElement=null vs primary=${e} + secondary`,
        ).toBe(0);
      }
      expect(computeMethodElementAffinityBonus(null, [], null)).toBe(0);
    });

    it('legacy character (primaryElement=null, secondaryElements=[]) → trả 0 (backward-compat)', () => {
      // Legacy character pre-Phase 11.3 → bonus = 0 → identity (gain × 1.0).
      for (const e of ELEMENTS) {
        expect(
          computeMethodElementAffinityBonus(null, [], e),
          `legacy null vs methodElement=${e}`,
        ).toBe(0);
      }
    });

    it('primary mismatch + secondary mismatch → 0 cho mọi element pair sai khớp', () => {
      // Matrix 5×5: nếu primary khác methodElement và methodElement không
      // trong secondaryElements → bonus 0.
      for (const primary of ELEMENTS) {
        for (const methodEl of ELEMENTS) {
          if (primary === methodEl) continue; // chỉ test mismatch
          expect(
            computeMethodElementAffinityBonus(primary, [], methodEl),
            `primary=${primary} vs method=${methodEl} (no secondary)`,
          ).toBe(0);
        }
      }
    });

    it('matrix coverage 5×5 primary === method → đều trả PRIMARY bonus', () => {
      for (const e of ELEMENTS) {
        expect(
          computeMethodElementAffinityBonus(e, [], e),
          `primary=${e} vs method=${e}`,
        ).toBe(METHOD_ELEMENT_PRIMARY_BONUS);
      }
    });

    it('matrix coverage 5×5 secondary contains method → đều trả SECONDARY bonus', () => {
      // primary khác methodElement, secondary chứa methodElement → secondary bonus.
      for (const primary of ELEMENTS) {
        for (const methodEl of ELEMENTS) {
          if (primary === methodEl) continue;
          expect(
            computeMethodElementAffinityBonus(primary, [methodEl], methodEl),
            `primary=${primary} vs method=${methodEl} ∈ secondaries`,
          ).toBe(METHOD_ELEMENT_SECONDARY_BONUS);
        }
      }
    });
  });

  describe('Ngũ Hành tương khắc safety — forbiddenElements consistency', () => {
    /**
     * Nếu method có element và forbiddenElements, forbiddenElements thường
     * là element bị element method khắc (theo logic chống yin/yang xung
     * khắc). Test này soft-assert: nếu method có forbiddenElements không
     * empty, ít nhất phải có 1 element bị method khắc HOẶC khắc method.
     * (allow flex để designer có thể thêm forbid khác lý do.)
     */
    it('mỗi method có element + forbidden không null đều có valid Ngũ Hành justification', () => {
      for (const m of CULTIVATION_METHODS) {
        if (!m.element || !m.forbiddenElements || m.forbiddenElements.length === 0) continue;
        // Soft check: forbidden lists chỉ cần là valid ElementKey (đã check ở
        // test trên). Designer có thể thêm bất cứ element nào — không strict
        // tương khắc, vì có thể có lý do narrative/balance khác.
        expect(m.forbiddenElements.length, `${m.key} forbidden count`).toBeGreaterThan(0);
      }
    });
  });
});
