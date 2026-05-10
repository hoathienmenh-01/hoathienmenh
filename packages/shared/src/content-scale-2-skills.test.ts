import { describe, expect, it } from 'vitest';

import {
  SKILLS,
  type SkillDef,
  type SkillTag,
} from './combat';
import {
  SKILL_ATK_SCALE_HARD_CAP,
  SKILL_COOLDOWN_HARD_CAP,
  SKILL_MP_COST_HARD_CAP,
  SKILL_SELF_BLOOD_HARD_CAP,
  SKILL_SELF_HEAL_HARD_CAP,
} from './balance-dials';
import { realmByKey } from './realms';
import { SKILL_TEMPLATES } from './skill-templates';

/**
 * Content Scale 2 — High-Realm Skills Pack invariants.
 *
 * 25 skills new across late-game tiers (Nhân Tiên / Tiên Giới /
 * Hỗn Nguyên / Vĩnh Hằng) + 5 neutral. Phải pass:
 *   - mỗi skill catalog có template tương ứng (1:1 mapping).
 *   - mỗi skill nằm trong balance budget (atkScale ≤ 5, mpCost ≤ 80, …).
 *   - mỗi skill khoá realm ≥ Nhân Tiên (order ≥ 10).
 *   - mỗi tier (Nhân Tiên / Tiên Giới / Hỗn Nguyên / Vĩnh Hằng) cover đủ
 *     5 hệ Ngũ Hành (kim/moc/thuy/hoa/tho).
 *   - role distribution có DAMAGE/HEAL/CONTROL/BUFF coverage rõ ràng.
 *   - tag distribution match identity Ngũ Hành (Mộc HEAL, Hoả BURST/DOT,
 *     Thổ SHIELD, Kim CRIT, Thuỷ CONTROL/HEAL).
 */

const NEW_SKILL_KEYS: readonly string[] = [
  // Nhân Tiên
  'kim_nhan_tien_pho_thien_kiep',
  'moc_nhan_tien_van_lam_sinh_co',
  'thuy_nhan_tien_thuy_kiep_phong_an',
  'hoa_nhan_tien_pho_diem_van_thien',
  'tho_nhan_tien_kim_son_huyen_giap',
  // Tiên Giới
  'kim_tien_gioi_thien_quang_xuyen_van',
  'moc_tien_gioi_co_lam_thuong_truong',
  'thuy_tien_gioi_thien_ha_dao_chuyen',
  'hoa_tien_gioi_chu_tuoc_phan_thien',
  'tho_tien_gioi_huyen_son_dia_phong',
  // Hỗn Nguyên
  'kim_hon_nguyen_kim_kiep_dao_thien',
  'moc_hon_nguyen_thien_dia_long_lac',
  'thuy_hon_nguyen_van_thuy_quy_nguyen',
  'hoa_hon_nguyen_chu_tuoc_thien_phan',
  'tho_hon_nguyen_dia_thien_son_quan',
  // Vĩnh Hằng
  'kim_vinh_hang_thien_kiem_quy_tong',
  'moc_vinh_hang_van_co_sinh_chu',
  'thuy_vinh_hang_thien_ha_dao_lang',
  'hoa_vinh_hang_kiep_diem_thieu_thien',
  'tho_vinh_hang_huyen_dia_kim_can_giap',
  // Neutral / Special
  'tien_anh_quyet_kiem',
  'huyen_thien_van_phap_kinh',
  'chuan_thanh_dao_quan_kiem',
  'dao_quan_van_phap_quy',
  'vinh_hang_dao_tam_an',
];

const NHAN_TIEN_KEYS = NEW_SKILL_KEYS.filter((k) => k.includes('nhan_tien_') && k !== 'tien_anh_quyet_kiem');
const TIEN_GIOI_KEYS = NEW_SKILL_KEYS.filter((k) => k.includes('tien_gioi_'));
const HON_NGUYEN_KEYS = NEW_SKILL_KEYS.filter((k) => k.includes('hon_nguyen_'));
const VINH_HANG_KEYS = NEW_SKILL_KEYS.filter((k) => k.includes('vinh_hang_') && k !== 'vinh_hang_dao_tam_an');

function getNewSkill(key: string): SkillDef {
  const skill = SKILLS.find((s) => s.key === key);
  if (!skill) {
    throw new Error(`new skill not found: ${key}`);
  }
  return skill;
}

describe('Content Scale 2 — High-Realm Skills Pack', () => {
  it('pack có đúng 25 skill mới', () => {
    expect(NEW_SKILL_KEYS.length).toBe(25);
  });

  it('mỗi skill key nằm trong SKILLS catalog', () => {
    for (const key of NEW_SKILL_KEYS) {
      const skill = SKILLS.find((s) => s.key === key);
      expect(skill, `missing skill catalog entry: ${key}`).toBeDefined();
    }
  });

  it('mỗi skill có template tương ứng trong SKILL_TEMPLATES', () => {
    for (const key of NEW_SKILL_KEYS) {
      const tmpl = SKILL_TEMPLATES.find((t) => t.key === key);
      expect(tmpl, `missing template for: ${key}`).toBeDefined();
      expect(tmpl?.unlocks.length).toBeGreaterThan(0);
      const realmUnlock = tmpl?.unlocks.find((u) => u.kind === 'realm');
      expect(realmUnlock, `missing realm unlock: ${key}`).toBeDefined();
    }
  });

  it('mọi skill key unique (không trùng skill cũ)', () => {
    const all = SKILLS.map((s) => s.key);
    const dup = all.filter((k, i) => all.indexOf(k) !== i);
    expect(dup).toEqual([]);
  });

  it('mỗi skill có realm requirement valid (≥ Nhân Tiên, order ≥ 10)', () => {
    for (const key of NEW_SKILL_KEYS) {
      const skill = getNewSkill(key);
      expect(skill.unlockRealm, `missing unlockRealm: ${key}`).toBeTruthy();
      const realm = realmByKey(skill.unlockRealm!);
      expect(realm, `unknown realm: ${skill.unlockRealm}`).toBeDefined();
      expect(realm!.order).toBeGreaterThanOrEqual(10);
    }
  });

  it('mỗi skill nằm trong balance hard caps', () => {
    for (const key of NEW_SKILL_KEYS) {
      const skill = getNewSkill(key);
      expect(skill.atkScale, `${key} atkScale`).toBeGreaterThanOrEqual(0);
      expect(skill.atkScale, `${key} atkScale`).toBeLessThanOrEqual(SKILL_ATK_SCALE_HARD_CAP);
      expect(skill.mpCost, `${key} mpCost`).toBeGreaterThanOrEqual(0);
      expect(skill.mpCost, `${key} mpCost`).toBeLessThanOrEqual(SKILL_MP_COST_HARD_CAP);
      expect(skill.selfHealRatio, `${key} selfHealRatio`).toBeGreaterThanOrEqual(0);
      expect(skill.selfHealRatio, `${key} selfHealRatio`).toBeLessThanOrEqual(SKILL_SELF_HEAL_HARD_CAP);
      expect(skill.selfBloodCost, `${key} selfBloodCost`).toBeGreaterThanOrEqual(0);
      expect(skill.selfBloodCost, `${key} selfBloodCost`).toBeLessThanOrEqual(SKILL_SELF_BLOOD_HARD_CAP);
      const cd = skill.cooldownTurns ?? 0;
      expect(cd, `${key} cooldownTurns`).toBeGreaterThanOrEqual(0);
      expect(cd, `${key} cooldownTurns`).toBeLessThanOrEqual(SKILL_COOLDOWN_HARD_CAP);
    }
  });

  it('mỗi skill có description không rỗng', () => {
    for (const key of NEW_SKILL_KEYS) {
      const skill = getNewSkill(key);
      expect(skill.name.trim().length, `${key} name`).toBeGreaterThan(0);
      expect(skill.description.trim().length, `${key} description`).toBeGreaterThan(8);
    }
  });

  it('mỗi tier realm cover đủ 5 hệ Ngũ Hành (kim/moc/thuy/hoa/tho)', () => {
    const tiers: Record<string, readonly string[]> = {
      'Nhân Tiên': NHAN_TIEN_KEYS,
      'Tiên Giới': TIEN_GIOI_KEYS,
      'Hỗn Nguyên': HON_NGUYEN_KEYS,
      'Vĩnh Hằng': VINH_HANG_KEYS,
    };
    for (const [label, keys] of Object.entries(tiers)) {
      const elements = new Set<string>();
      for (const k of keys) {
        const skill = getNewSkill(k);
        if (skill.element) {
          elements.add(skill.element);
        }
      }
      expect(elements.has('kim'), `${label} thiếu hệ Kim`).toBe(true);
      expect(elements.has('moc'), `${label} thiếu hệ Mộc`).toBe(true);
      expect(elements.has('thuy'), `${label} thiếu hệ Thuỷ`).toBe(true);
      expect(elements.has('hoa'), `${label} thiếu hệ Hoả`).toBe(true);
      expect(elements.has('tho'), `${label} thiếu hệ Thổ`).toBe(true);
    }
  });

  it('role distribution: có ≥ 1 DAMAGE, ≥ 1 HEAL, ≥ 1 CONTROL, ≥ 1 BUFF', () => {
    const roles = new Set<string>();
    for (const key of NEW_SKILL_KEYS) {
      const skill = getNewSkill(key);
      if (skill.role) {
        roles.add(skill.role);
      }
    }
    expect(roles.has('DAMAGE')).toBe(true);
    expect(roles.has('HEAL')).toBe(true);
    expect(roles.has('CONTROL')).toBe(true);
    expect(roles.has('BUFF')).toBe(true);
  });

  it('Mộc skill nào trong pack đều có HEAL hoặc DOT tag', () => {
    const mocSkills = NEW_SKILL_KEYS.map(getNewSkill).filter((s) => s.element === 'moc');
    for (const skill of mocSkills) {
      const tags = (skill.tags ?? []) as readonly SkillTag[];
      const hasIdentity = tags.includes('HEAL') || tags.includes('DOT');
      expect(hasIdentity, `${skill.key} thiếu HEAL/DOT identity`).toBe(true);
    }
  });

  it('Hoả skill nào trong pack đều có BURST hoặc DOT tag', () => {
    const hoaSkills = NEW_SKILL_KEYS.map(getNewSkill).filter((s) => s.element === 'hoa');
    for (const skill of hoaSkills) {
      const tags = (skill.tags ?? []) as readonly SkillTag[];
      const hasIdentity = tags.includes('BURST') || tags.includes('DOT');
      expect(hasIdentity, `${skill.key} thiếu BURST/DOT identity`).toBe(true);
    }
  });

  it('Thổ skill nào trong pack đều có SHIELD hoặc CONTROL tag', () => {
    const thoSkills = NEW_SKILL_KEYS.map(getNewSkill).filter((s) => s.element === 'tho');
    for (const skill of thoSkills) {
      const tags = (skill.tags ?? []) as readonly SkillTag[];
      const hasIdentity = tags.includes('SHIELD') || tags.includes('CONTROL');
      expect(hasIdentity, `${skill.key} thiếu SHIELD/CONTROL identity`).toBe(true);
    }
  });

  it('Kim skill nào trong pack đều có CRIT hoặc BURST tag', () => {
    const kimSkills = NEW_SKILL_KEYS.map(getNewSkill).filter((s) => s.element === 'kim');
    for (const skill of kimSkills) {
      const tags = (skill.tags ?? []) as readonly SkillTag[];
      const hasIdentity = tags.includes('CRIT') || tags.includes('BURST');
      expect(hasIdentity, `${skill.key} thiếu CRIT/BURST identity`).toBe(true);
    }
  });

  it('Thuỷ skill nào trong pack đều có CONTROL hoặc HEAL tag', () => {
    const thuySkills = NEW_SKILL_KEYS.map(getNewSkill).filter((s) => s.element === 'thuy');
    for (const skill of thuySkills) {
      const tags = (skill.tags ?? []) as readonly SkillTag[];
      const hasIdentity = tags.includes('CONTROL') || tags.includes('HEAL');
      expect(hasIdentity, `${skill.key} thiếu CONTROL/HEAL identity`).toBe(true);
    }
  });

  it('không skill nào one-shot (atkScale ≤ hard cap, không có raw multiplier ≥ 5)', () => {
    for (const key of NEW_SKILL_KEYS) {
      const skill = getNewSkill(key);
      expect(skill.atkScale, `${key} atkScale phá cap`).toBeLessThan(5);
    }
  });

  it('huyết tế skills không vượt quá 0.3 (không tự sát farm)', () => {
    for (const key of NEW_SKILL_KEYS) {
      const skill = getNewSkill(key);
      expect(skill.selfBloodCost, `${key} blood cost`).toBeLessThanOrEqual(0.3);
    }
  });
});
