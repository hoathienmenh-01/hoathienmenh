/**
 * Phase 14.2.C — Elemental Skill Tree Expansion tests.
 *
 * Cover:
 *   1. SkillElementIdentity catalog invariants (5 hệ Ngũ Hành, primaryTags
 *      non-empty, mỗi primaryTag có ≥ 1 skill thuộc hệ đó).
 *   2. SKILL_TAGS catalog có đủ 6 tag (HEAL/DOT/BURST/SHIELD/CRIT/CONTROL).
 *   3. Phase 14.2.C signature skills tồn tại và mang tag identity đúng.
 *   4. validateSkillTag enforce rule (tag invalid, DOT/SHIELD/CONTROL phải
 *      có element, PASSIVE không được mang tag side-effect).
 *   5. computeSkillElementBonus / computeSkillAffinityDelta đúng logic
 *      character affinity.
 *   6. skillsForTag filter → kết quả non-empty cho mỗi tag.
 */
import { describe, expect, it } from 'vitest';
import {
  SKILLS,
  SKILL_TAGS,
  skillByKey,
  type ElementKey,
  type SkillDef,
  type SkillTag,
} from './combat';
import {
  SKILL_ELEMENT_IDENTITY,
  SKILL_TAG_DOT_DAMAGE_RATIO,
  SKILL_TAG_DOT_TURNS,
  SKILL_TAG_SHIELD_HP_RATIO,
  computeSkillAffinityDelta,
  computeSkillElementBonus,
  describeSkillElementIdentity,
  findElementIdentityCoverageGaps,
  getSkillElementIdentity,
  skillsForTag,
  validateSkillTag,
} from './elemental-skills';
import {
  ELEMENT_CHARACTER_PRIMARY_BONUS,
  ELEMENT_CHARACTER_SECONDARY_BONUS,
} from './balance-dials';

describe('Phase 14.2.C — Elemental Skill Tree Expansion', () => {
  describe('SKILL_TAGS catalog', () => {
    it('có đủ 6 tag (HEAL/DOT/BURST/SHIELD/CRIT/CONTROL)', () => {
      expect(SKILL_TAGS).toEqual([
        'HEAL',
        'DOT',
        'BURST',
        'SHIELD',
        'CRIT',
        'CONTROL',
      ]);
      expect(SKILL_TAGS).toHaveLength(6);
    });
  });

  describe('SKILL_ELEMENT_IDENTITY catalog', () => {
    it('có đủ 5 hệ Ngũ Hành', () => {
      const elements = SKILL_ELEMENT_IDENTITY.map((e) => e.element);
      expect(elements.sort()).toEqual(['hoa', 'kim', 'moc', 'tho', 'thuy']);
    });

    it('mỗi entry có primaryTags non-empty và playstyle non-empty', () => {
      for (const id of SKILL_ELEMENT_IDENTITY) {
        expect(id.primaryTags.length).toBeGreaterThan(0);
        expect(id.playstyle).toBeTruthy();
        expect(id.theme).toBeTruthy();
        expect(id.name).toBeTruthy();
        for (const tag of id.primaryTags) {
          expect(SKILL_TAGS as readonly string[]).toContain(tag);
        }
        for (const tag of id.secondaryTags) {
          expect(SKILL_TAGS as readonly string[]).toContain(tag);
        }
      }
    });

    it('getSkillElementIdentity throws cho element invalid', () => {
      expect(() =>
        getSkillElementIdentity('xxx' as unknown as ElementKey),
      ).toThrow();
    });

    it('describeSkillElementIdentity render Vietnamese label', () => {
      expect(describeSkillElementIdentity('hoa')).toBe('Hoả — Bùng nổ & thiêu đốt');
      expect(describeSkillElementIdentity(null)).toBe('Vô hệ');
    });

    it('coverage gap = 0 — mỗi primaryTag có ≥ 1 skill thuộc hệ đó', () => {
      const gaps = findElementIdentityCoverageGaps();
      expect(gaps).toEqual([]);
    });
  });

  describe('Phase 14.2.C signature skills', () => {
    const signatureKeys: Array<{ key: string; element: ElementKey; tag: SkillTag }> = [
      { key: 'moc_xuan_phong_phuc_sinh', element: 'moc', tag: 'HEAL' },
      { key: 'moc_doc_van_truong', element: 'moc', tag: 'DOT' },
      { key: 'moc_thien_sinh_chu', element: 'moc', tag: 'HEAL' },
      { key: 'hoa_phen_diem_kiep', element: 'hoa', tag: 'BURST' },
      { key: 'hoa_thieu_diem_phap', element: 'hoa', tag: 'DOT' },
      { key: 'tho_kim_son_ho_phap', element: 'tho', tag: 'SHIELD' },
      { key: 'tho_huyen_thach_trong_giap', element: 'tho', tag: 'SHIELD' },
      { key: 'kim_xuyen_giap_thien_thich', element: 'kim', tag: 'CRIT' },
      { key: 'kim_phong_nhan_quyet', element: 'kim', tag: 'CRIT' },
      { key: 'thuy_lam_dieu_quyet', element: 'thuy', tag: 'CONTROL' },
      { key: 'thuy_lam_quy_thuy_tam', element: 'thuy', tag: 'HEAL' },
    ];

    it.each(signatureKeys)('skill $key có element=$element và tag $tag', ({ key, element, tag }) => {
      const skill = skillByKey(key);
      expect(skill).toBeDefined();
      expect(skill!.element).toBe(element);
      expect(skill!.tags ?? []).toContain(tag);
    });

    it('có đủ 11 skill mới Phase 14.2.C', () => {
      const matched = signatureKeys.filter((s) => skillByKey(s.key) !== undefined);
      expect(matched).toHaveLength(11);
    });
  });

  describe('validateSkillTag', () => {
    const baseSkill: SkillDef = {
      key: 'test',
      name: 'Test',
      description: 'd',
      mpCost: 0,
      atkScale: 1,
      selfHealRatio: 0,
      selfBloodCost: 0,
      sect: null,
      element: 'kim',
      type: 'ACTIVE',
      role: 'DAMAGE',
      unlockRealm: null,
      cooldownTurns: 0,
    };

    it('không tag → ok', () => {
      expect(() => validateSkillTag(baseSkill)).not.toThrow();
    });

    it('tag valid → ok', () => {
      expect(() => validateSkillTag({ ...baseSkill, tags: ['HEAL'] })).not.toThrow();
      expect(() => validateSkillTag({ ...baseSkill, tags: ['CRIT', 'BURST'] })).not.toThrow();
    });

    it('tag invalid → throw', () => {
      expect(() =>
        validateSkillTag({
          ...baseSkill,
          tags: ['INVALID_TAG' as unknown as SkillTag],
        }),
      ).toThrow(/invalid/);
    });

    it('DOT tag mà element=null → throw', () => {
      expect(() =>
        validateSkillTag({ ...baseSkill, element: null, tags: ['DOT'] }),
      ).toThrow(/element=null/);
    });

    it('SHIELD tag mà element=null → throw', () => {
      expect(() =>
        validateSkillTag({ ...baseSkill, element: null, tags: ['SHIELD'] }),
      ).toThrow(/element=null/);
    });

    it('CONTROL tag mà element=null → throw', () => {
      expect(() =>
        validateSkillTag({ ...baseSkill, element: null, tags: ['CONTROL'] }),
      ).toThrow(/element=null/);
    });

    it('HEAL/CRIT/BURST trên skill vô hệ → ok (chỉ DOT/SHIELD/CONTROL bắt buộc)', () => {
      expect(() =>
        validateSkillTag({ ...baseSkill, element: null, tags: ['HEAL'] }),
      ).not.toThrow();
      expect(() =>
        validateSkillTag({ ...baseSkill, element: null, tags: ['CRIT', 'BURST'] }),
      ).not.toThrow();
    });

    it('PASSIVE skill không được mang BURST/DOT/SHIELD/CONTROL', () => {
      expect(() =>
        validateSkillTag({ ...baseSkill, type: 'PASSIVE', tags: ['BURST'] }),
      ).toThrow(/PASSIVE/);
      expect(() =>
        validateSkillTag({ ...baseSkill, type: 'PASSIVE', tags: ['DOT'] }),
      ).toThrow(/PASSIVE/);
    });

    it('PASSIVE skill được mang HEAL/CRIT (flavor identity)', () => {
      expect(() =>
        validateSkillTag({ ...baseSkill, type: 'PASSIVE', tags: ['HEAL'] }),
      ).not.toThrow();
      expect(() =>
        validateSkillTag({ ...baseSkill, type: 'PASSIVE', tags: ['CRIT'] }),
      ).not.toThrow();
    });

    it('catalog hiện tại — mọi SKILLS pass validateSkillTag', () => {
      for (const skill of SKILLS) {
        expect(() => validateSkillTag(skill)).not.toThrow();
      }
    });
  });

  describe('computeSkillAffinityDelta', () => {
    const charKim = {
      primaryElement: 'kim' as ElementKey,
      secondaryElements: ['tho' as ElementKey],
    };

    it('null character → 0', () => {
      const skill = skillByKey('kim_xuyen_giap_thien_thich')!;
      expect(computeSkillAffinityDelta(null, skill)).toBe(0);
    });

    it('skill vô hệ → 0', () => {
      const skill: SkillDef = { ...skillByKey('kim_xuyen_giap_thien_thich')!, element: null };
      expect(computeSkillAffinityDelta(charKim, skill)).toBe(0);
    });

    it('cùng primaryElement → +ELEMENT_CHARACTER_PRIMARY_BONUS', () => {
      const skill = skillByKey('kim_xuyen_giap_thien_thich')!;
      expect(computeSkillAffinityDelta(charKim, skill)).toBe(
        ELEMENT_CHARACTER_PRIMARY_BONUS,
      );
    });

    it('match secondaryElement → +ELEMENT_CHARACTER_SECONDARY_BONUS', () => {
      const skill = skillByKey('tho_kim_son_ho_phap')!;
      expect(computeSkillAffinityDelta(charKim, skill)).toBe(
        ELEMENT_CHARACTER_SECONDARY_BONUS,
      );
    });

    it('lệch hệ (không primary, không secondary) → 0 (không phạt)', () => {
      const skill = skillByKey('moc_xuan_phong_phuc_sinh')!;
      expect(computeSkillAffinityDelta(charKim, skill)).toBe(0);
    });
  });

  describe('computeSkillElementBonus', () => {
    const charKim = {
      primaryElement: 'kim' as ElementKey,
      secondaryElements: ['tho' as ElementKey],
    };

    it('skill vô hệ vs target vô hệ → 1.0 (no relation)', () => {
      const skill: SkillDef = { ...skillByKey('kim_xuyen_giap_thien_thich')!, element: null };
      expect(computeSkillElementBonus(null, skill, null)).toBe(1.0);
    });

    it('Kim vs Mộc (counter, không character) → cao hơn 1.0', () => {
      const skill = skillByKey('kim_xuyen_giap_thien_thich')!;
      const mul = computeSkillElementBonus(null, skill, 'moc');
      expect(mul).toBeGreaterThan(1.0);
    });

    it('Mộc vs Kim (countered, không character) → thấp hơn 1.0', () => {
      const skill = skillByKey('moc_xuan_phong_phuc_sinh')!;
      const mul = computeSkillElementBonus(null, skill, 'kim');
      expect(mul).toBeLessThan(1.0);
    });

    it('character primary Kim cast Kim skill → bonus áp lên multiplier', () => {
      const skill = skillByKey('kim_xuyen_giap_thien_thich')!;
      const baseline = computeSkillElementBonus(null, skill, 'moc');
      const withChar = computeSkillElementBonus(charKim, skill, 'moc');
      expect(withChar).toBeGreaterThan(baseline);
    });
  });

  describe('skillsForTag', () => {
    it.each(SKILL_TAGS)('mỗi tag %s có ≥ 1 skill match', (tag) => {
      expect(skillsForTag(tag).length).toBeGreaterThan(0);
    });

    it('legacy skill không có tags → không match bất kỳ tag', () => {
      const legacy = SKILLS.find((s) => !s.tags || s.tags.length === 0);
      expect(legacy).toBeDefined();
      for (const tag of SKILL_TAGS) {
        expect(skillsForTag(tag).some((s) => s.key === legacy!.key)).toBe(false);
      }
    });
  });

  describe('Tag side-effect dial', () => {
    it('SKILL_TAG_DOT_DAMAGE_RATIO trong [0.05, 0.30] (anti-runaway)', () => {
      expect(SKILL_TAG_DOT_DAMAGE_RATIO).toBeGreaterThanOrEqual(0.05);
      expect(SKILL_TAG_DOT_DAMAGE_RATIO).toBeLessThanOrEqual(0.3);
    });

    it('SKILL_TAG_DOT_TURNS = 3 (turn count chuẩn)', () => {
      expect(SKILL_TAG_DOT_TURNS).toBe(3);
    });

    it('SKILL_TAG_SHIELD_HP_RATIO trong [0.05, 0.20] (anti-cheese)', () => {
      expect(SKILL_TAG_SHIELD_HP_RATIO).toBeGreaterThanOrEqual(0.05);
      expect(SKILL_TAG_SHIELD_HP_RATIO).toBeLessThanOrEqual(0.2);
    });

    it('Tổng DOT damage 3 lượt ≈ 45% sát thương 1-shot (anti-spam)', () => {
      const totalDotRatio = SKILL_TAG_DOT_DAMAGE_RATIO * SKILL_TAG_DOT_TURNS;
      expect(totalDotRatio).toBeLessThanOrEqual(0.6);
      expect(totalDotRatio).toBeGreaterThanOrEqual(0.3);
    });
  });
});
