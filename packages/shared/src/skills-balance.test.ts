/**
 * Skills balance + integrity guard (Phase 10 PR-2 — Ngũ Hành).
 *
 * Purpose:
 *   - Hard-cap stat budget per `docs/BALANCE_MODEL.md` §4 — block silent
 *     power creep when content authors add new skills.
 *   - Required-fields check (key/name/description/sect/atkScale/mpCost/...)
 *     để mọi skill có hiển thị FE và combat logic không null-ref.
 *   - Cooldown / mpCost / selfBloodCost / selfHealRatio bounded.
 *   - Element / type / role hợp lệ với enum khai báo.
 *   - Mỗi Ngũ Hành có ≥ 1 ACTIVE + ≥ 1 PASSIVE (sẵn sàng cho phase 11
 *     spiritual root + elemental combat).
 *   - Phase 11 forward-compat: combat runtime hiện chưa đọc element nhưng
 *     test bound thiết kế để chạy ngay khi field thêm vào, đảm bảo tới
 *     phase 11 không có content "lệch" cap mới.
 */
import { describe, expect, it } from 'vitest';
import { REALMS } from './realms';
import {
  ELEMENTS,
  type ElementKey,
  type SkillDef,
  type SkillType,
  SKILLS,
  SKILL_BASIC_ATTACK,
  SKILL_ROLES,
  activeSkillsForSect,
  skillsForElement,
} from './combat';
import {
  SKILL_ATK_SCALE_HARD_CAP as ATK_SCALE_HARD_CAP,
  SKILL_SELF_HEAL_HARD_CAP as SELF_HEAL_HARD_CAP,
  SKILL_SELF_BLOOD_HARD_CAP as SELF_BLOOD_HARD_CAP,
  SKILL_COOLDOWN_HARD_CAP as COOLDOWN_HARD_CAP,
  SKILL_MP_COST_HARD_CAP as MP_COST_HARD_CAP,
} from './balance-dials';

const VALID_ELEMENTS: ReadonlyArray<ElementKey | null> = [...ELEMENTS, null];
const VALID_TYPES: ReadonlyArray<SkillType> = ['ACTIVE', 'PASSIVE'];
const VALID_REALMS = new Set(REALMS.map((r) => r.key));

describe('SKILL catalog — required field contract', () => {
  it('mọi skill có key snake_case ASCII (≥ 2 ký tự, không dấu)', () => {
    const re = /^[a-z][a-z0-9_]*$/;
    for (const s of SKILLS) {
      expect(re.test(s.key), `skill key invalid: ${s.key}`).toBe(true);
      expect(s.key.length).toBeGreaterThanOrEqual(2);
    }
  });

  it('mọi skill có key duy nhất (no duplicate)', () => {
    const keys = SKILLS.map((s) => s.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('mọi skill có name không rỗng', () => {
    for (const s of SKILLS) {
      expect(s.name.trim().length, `skill ${s.key} thiếu name`).toBeGreaterThan(0);
    }
  });

  it('mọi skill có description ≥ 10 ký tự (anti-placeholder)', () => {
    for (const s of SKILLS) {
      expect(s.description.length, `skill ${s.key} desc quá ngắn`).toBeGreaterThanOrEqual(10);
    }
  });

  it('SKILL_BASIC_ATTACK có trong catalog với key chuẩn', () => {
    expect(SKILLS).toContain(SKILL_BASIC_ATTACK);
    expect(SKILL_BASIC_ATTACK.key).toBe('basic_attack');
    expect(SKILL_BASIC_ATTACK.sect).toBeNull();
  });
});

describe('SKILL catalog — power budget (BALANCE_MODEL §4)', () => {
  it('mọi atkScale trong [0..5]', () => {
    for (const s of SKILLS) {
      expect(s.atkScale).toBeGreaterThanOrEqual(0);
      expect(
        s.atkScale,
        `skill ${s.key} atkScale=${s.atkScale} vượt hard cap ${ATK_SCALE_HARD_CAP}`,
      ).toBeLessThanOrEqual(ATK_SCALE_HARD_CAP);
    }
  });

  it('mọi mpCost ≥ 0 và ≤ 80 (cap §4.4)', () => {
    for (const s of SKILLS) {
      expect(s.mpCost).toBeGreaterThanOrEqual(0);
      expect(
        s.mpCost,
        `skill ${s.key} mpCost=${s.mpCost} vượt hard cap ${MP_COST_HARD_CAP}`,
      ).toBeLessThanOrEqual(MP_COST_HARD_CAP);
    }
  });

  it('mọi selfHealRatio trong [0..0.5]', () => {
    for (const s of SKILLS) {
      expect(s.selfHealRatio).toBeGreaterThanOrEqual(0);
      expect(
        s.selfHealRatio,
        `skill ${s.key} selfHealRatio=${s.selfHealRatio} vượt cap ${SELF_HEAL_HARD_CAP}`,
      ).toBeLessThanOrEqual(SELF_HEAL_HARD_CAP);
    }
  });

  it('mọi selfBloodCost trong [0..0.3]', () => {
    for (const s of SKILLS) {
      expect(s.selfBloodCost).toBeGreaterThanOrEqual(0);
      expect(
        s.selfBloodCost,
        `skill ${s.key} selfBloodCost=${s.selfBloodCost} vượt cap ${SELF_BLOOD_HARD_CAP}`,
      ).toBeLessThanOrEqual(SELF_BLOOD_HARD_CAP);
    }
  });

  it('mọi cooldownTurns trong [0..6]', () => {
    for (const s of SKILLS) {
      const cd = s.cooldownTurns ?? 0;
      expect(cd).toBeGreaterThanOrEqual(0);
      expect(cd, `skill ${s.key} cooldown=${cd} vượt hard cap ${COOLDOWN_HARD_CAP}`).toBeLessThanOrEqual(
        COOLDOWN_HARD_CAP,
      );
    }
  });

  it('PASSIVE skill phải có atkScale === 0 (không ai dùng passive như attack)', () => {
    const passives = SKILLS.filter((s) => s.type === 'PASSIVE');
    expect(passives.length).toBeGreaterThan(0);
    for (const s of passives) {
      expect(s.atkScale, `passive ${s.key} atkScale phải = 0`).toBe(0);
      expect(s.mpCost, `passive ${s.key} mpCost phải = 0 (kích hoạt tự động)`).toBe(0);
      expect(
        s.selfBloodCost,
        `passive ${s.key} selfBloodCost phải = 0 (không huyết tế bị động)`,
      ).toBe(0);
      expect(s.cooldownTurns ?? 0, `passive ${s.key} cooldownTurns phải = 0`).toBe(0);
    }
  });
});

describe('SKILL catalog — Ngũ Hành / type / role / unlockRealm validity', () => {
  it('mọi element value PHẢI là null hoặc một trong (kim|moc|thuy|hoa|tho)', () => {
    for (const s of SKILLS) {
      const e = s.element ?? null;
      expect(VALID_ELEMENTS, `skill ${s.key} element=${String(e)} không hợp lệ`).toContain(e);
    }
  });

  it('mọi type value PHẢI là một trong (ACTIVE|PASSIVE)', () => {
    for (const s of SKILLS) {
      const t = s.type ?? 'ACTIVE';
      expect(VALID_TYPES, `skill ${s.key} type=${String(t)} không hợp lệ`).toContain(t);
    }
  });

  it('mọi role (nếu có) phải hợp lệ', () => {
    for (const s of SKILLS) {
      if (s.role !== undefined) {
        expect(SKILL_ROLES, `skill ${s.key} role=${s.role} không hợp lệ`).toContain(s.role);
      }
    }
  });

  it('mọi unlockRealm (nếu có) phải tồn tại trong REALMS', () => {
    for (const s of SKILLS) {
      const u = s.unlockRealm ?? null;
      if (u !== null) {
        expect(VALID_REALMS.has(u), `skill ${s.key} unlockRealm=${u} không có trong REALMS`).toBe(
          true,
        );
      }
    }
  });

  it('skill có element non-null phải có type khai báo (ACTIVE|PASSIVE)', () => {
    for (const s of SKILLS) {
      if (s.element != null) {
        expect(
          s.type,
          `skill element-typed ${s.key} phải khai báo type rõ ràng`,
        ).toBeDefined();
      }
    }
  });
});

describe('SKILL catalog — Ngũ Hành coverage (PR-2 v2 promise)', () => {
  it('mỗi element (kim/moc/thuy/hoa/tho) có ≥ 2 ACTIVE + ≥ 2 PASSIVE (PR-2 v2 expansion)', () => {
    for (const el of ELEMENTS) {
      const elementSkills = skillsForElement(el);
      const actives = elementSkills.filter((s) => (s.type ?? 'ACTIVE') === 'ACTIVE');
      const passives = elementSkills.filter((s) => s.type === 'PASSIVE');
      expect(
        actives.length,
        `Hệ ${el.toUpperCase()} thiếu ACTIVE skill (active=${actives.length}, cần ≥ 2)`,
      ).toBeGreaterThanOrEqual(2);
      expect(
        passives.length,
        `Hệ ${el.toUpperCase()} thiếu PASSIVE skill (passive=${passives.length}, cần ≥ 2)`,
      ).toBeGreaterThanOrEqual(2);
    }
  });

  it('mỗi element có ≥ 4 skill (depth Phase 11 build chọn — PR-2 v2 expansion)', () => {
    for (const el of ELEMENTS) {
      const elementSkills = skillsForElement(el);
      expect(
        elementSkills.length,
        `Hệ ${el.toUpperCase()} chỉ có ${elementSkills.length} skill, cần ≥ 4`,
      ).toBeGreaterThanOrEqual(4);
    }
  });

  it('mỗi element có ≥ 1 skill ULT tier kim_dan (PR-2 v2 endgame layer)', () => {
    for (const el of ELEMENTS) {
      const elementSkills = skillsForElement(el);
      const kimDanSkills = elementSkills.filter((s) => s.unlockRealm === 'kim_dan');
      expect(
        kimDanSkills.length,
        `Hệ ${el.toUpperCase()} thiếu ULT tier kim_dan (kim_dan=${kimDanSkills.length}, cần ≥ 1)`,
      ).toBeGreaterThanOrEqual(1);
    }
  });

  it('có ít nhất 1 skill vô hệ (element=null) ngoài basic_attack', () => {
    const noElement = SKILLS.filter((s) => (s.element ?? null) === null);
    expect(noElement.length).toBeGreaterThanOrEqual(2);
    expect(noElement.map((s) => s.key)).toContain(SKILL_BASIC_ATTACK.key);
  });

  it('catalog ≥ 35 skill (Phase 10 PR-2 v2 growth target — Ngũ Hành expansion)', () => {
    expect(SKILLS.length).toBeGreaterThanOrEqual(35);
  });
});

describe('SKILL catalog — sect parity (legacy invariant không vỡ)', () => {
  it('mọi sect value PHẢI là null hoặc thanh_van/huyen_thuy/tu_la', () => {
    const valid: ReadonlyArray<SkillDef['sect']> = [null, 'thanh_van', 'huyen_thuy', 'tu_la'];
    for (const s of SKILLS) {
      expect(valid, `skill ${s.key} sect=${String(s.sect)} không hợp lệ`).toContain(s.sect);
    }
  });

  it('skill có selfBloodCost > 0 PHẢI có atkScale > 1 (huyết tế phải đáng giá)', () => {
    for (const s of SKILLS.filter((x) => x.selfBloodCost > 0)) {
      expect(s.atkScale, `skill ${s.key} huyết tế phải đáng đổi máu`).toBeGreaterThan(1);
    }
  });
});

describe('SKILL helpers — activeSkillsForSect / skillsForElement', () => {
  it('activeSkillsForSect filter loại bỏ PASSIVE', () => {
    const all = activeSkillsForSect(null);
    expect(all.length).toBeGreaterThan(0);
    for (const s of all) {
      expect(s.type ?? 'ACTIVE').toBe('ACTIVE');
    }
  });

  it('activeSkillsForSect cho thanh_van bao gồm basic + skill thanh_van active, không có sect khác', () => {
    const result = activeSkillsForSect('thanh_van');
    expect(result).toContain(SKILL_BASIC_ATTACK);
    const sects = result.map((s) => s.sect);
    expect(sects).not.toContain('huyen_thuy');
    expect(sects).not.toContain('tu_la');
    for (const s of result) {
      expect(s.type ?? 'ACTIVE').toBe('ACTIVE');
    }
  });

  it('skillsForElement(kim) chỉ trả skill element=kim', () => {
    const kim = skillsForElement('kim');
    expect(kim.length).toBeGreaterThanOrEqual(2);
    for (const s of kim) {
      expect(s.element).toBe('kim');
    }
  });

  it('skillsForElement(null) chỉ trả skill vô hệ', () => {
    const noEl = skillsForElement(null);
    for (const s of noEl) {
      expect(s.element ?? null).toBeNull();
    }
    expect(noEl).toContain(SKILL_BASIC_ATTACK);
  });
});
