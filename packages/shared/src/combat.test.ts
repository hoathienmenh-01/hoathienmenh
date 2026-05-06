import { describe, expect, it } from 'vitest';
import {
  MONSTERS,
  DUNGEONS,
  SKILLS,
  SKILL_BASIC_ATTACK,
  STAMINA_PER_ACTION,
  STAMINA_REGEN_PER_TICK,
  monsterByKey,
  dungeonByKey,
  skillByKey,
  skillsForSect,
  rollDamage,
  type SectKey,
} from './combat';
import { realmByKey } from './realms';
import { QUESTS } from './quests';

/**
 * Combat catalog invariants — đảm bảo data game design không bị regression
 * (sai key reference, MP cost âm, dungeon link sai monster, etc.).
 *
 * Pure tests, không cần infra. `rollDamage` có random nên test trên invariant
 * (output range/integer/min) thay vì exact.
 */

describe('MONSTERS catalog', () => {
  it('có ít nhất 9 monster cho 3 dungeon đầu', () => {
    expect(MONSTERS.length).toBeGreaterThanOrEqual(9);
  });

  it('mọi monster có key unique', () => {
    const keys = MONSTERS.map((m) => m.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('mọi monster có name không rỗng', () => {
    for (const m of MONSTERS) {
      expect(m.name.length).toBeGreaterThan(0);
    }
  });

  it('mọi stat (hp/atk/def/level/expDrop/linhThachDrop/speed) đều > 0', () => {
    for (const m of MONSTERS) {
      expect(m.hp).toBeGreaterThan(0);
      expect(m.atk).toBeGreaterThan(0);
      expect(m.def).toBeGreaterThan(0);
      expect(m.level).toBeGreaterThan(0);
      expect(m.speed).toBeGreaterThan(0);
      expect(m.expDrop).toBeGreaterThan(0);
      expect(m.linhThachDrop).toBeGreaterThan(0);
    }
  });

  it('monster level tăng dần theo thứ tự khai báo trong cùng dungeon (giúp UX onboarding)', () => {
    // Spot check: dungeon đầu son_coc có 3 monster level 1→2→3.
    const sonCoc = DUNGEONS.find((d) => d.key === 'son_coc')!;
    const monsters = sonCoc.monsters.map((k) => monsterByKey(k)!);
    for (let i = 1; i < monsters.length; i += 1) {
      expect(monsters[i].level).toBeGreaterThanOrEqual(monsters[i - 1].level);
    }
  });
});

describe('monsterByKey', () => {
  it('trả monster đúng cho key tồn tại', () => {
    const m = monsterByKey('son_thu_lon');
    expect(m).toBeDefined();
    expect(m!.name).toBe('Sơn Thử Lớn');
    expect(m!.level).toBe(1);
  });

  it('trả undefined cho key không tồn tại', () => {
    expect(monsterByKey('nonexistent_monster')).toBeUndefined();
  });
});

describe('DUNGEONS catalog', () => {
  it('có ít nhất 3 dungeon (sơn cốc → hắc lâm → yêu thú động)', () => {
    expect(DUNGEONS.length).toBeGreaterThanOrEqual(3);
  });

  it('mọi dungeon có key unique', () => {
    const keys = DUNGEONS.map((d) => d.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('mọi dungeon có monster list không rỗng', () => {
    for (const d of DUNGEONS) {
      expect(d.monsters.length).toBeGreaterThan(0);
    }
  });

  it('mọi monster key trong dungeon.monsters PHẢI tồn tại trong MONSTERS catalog', () => {
    for (const d of DUNGEONS) {
      for (const monsterKey of d.monsters) {
        expect(monsterByKey(monsterKey), `dungeon ${d.key} → monster ${monsterKey}`).toBeDefined();
      }
    }
  });

  it('mọi recommendedRealm PHẢI tồn tại trong REALMS catalog', () => {
    for (const d of DUNGEONS) {
      expect(realmByKey(d.recommendedRealm), `dungeon ${d.key} realm ${d.recommendedRealm}`).toBeDefined();
    }
  });

  it('mọi staminaEntry > 0 (không cho phép vào dungeon free)', () => {
    for (const d of DUNGEONS) {
      expect(d.staminaEntry).toBeGreaterThan(0);
    }
  });

  it('staminaEntry tăng dần theo độ khó (sơn cốc < hắc lâm < yêu thú động)', () => {
    const sonCoc = DUNGEONS.find((d) => d.key === 'son_coc')!;
    const hacLam = DUNGEONS.find((d) => d.key === 'hac_lam')!;
    const yeuThu = DUNGEONS.find((d) => d.key === 'yeu_thu_dong')!;
    expect(sonCoc.staminaEntry).toBeLessThan(hacLam.staminaEntry);
    expect(hacLam.staminaEntry).toBeLessThan(yeuThu.staminaEntry);
  });
});

describe('dungeonByKey', () => {
  it('trả dungeon đúng cho key tồn tại', () => {
    const d = dungeonByKey('son_coc');
    expect(d).toBeDefined();
    expect(d!.name).toBe('Sơn Cốc');
  });

  it('trả undefined cho key không tồn tại', () => {
    expect(dungeonByKey('nonexistent')).toBeUndefined();
  });
});

describe('SKILLS catalog', () => {
  it('có ít nhất 9 skill (basic + 8 sect-specific)', () => {
    expect(SKILLS.length).toBeGreaterThanOrEqual(9);
  });

  it('mọi skill có key unique', () => {
    const keys = SKILLS.map((s) => s.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('SKILL_BASIC_ATTACK có trong SKILLS catalog', () => {
    expect(SKILLS).toContain(SKILL_BASIC_ATTACK);
    expect(SKILL_BASIC_ATTACK.key).toBe('basic_attack');
    expect(SKILL_BASIC_ATTACK.sect).toBeNull();
    expect(SKILL_BASIC_ATTACK.mpCost).toBe(0);
  });

  it('mọi skill có mpCost >= 0', () => {
    for (const s of SKILLS) {
      expect(s.mpCost).toBeGreaterThanOrEqual(0);
    }
  });

  it('mọi skill có atkScale >= 0 (heal-only skill có atkScale=0 hợp lệ)', () => {
    for (const s of SKILLS) {
      expect(s.atkScale).toBeGreaterThanOrEqual(0);
    }
  });

  it('mọi skill có selfHealRatio trong [0..1]', () => {
    for (const s of SKILLS) {
      expect(s.selfHealRatio).toBeGreaterThanOrEqual(0);
      expect(s.selfHealRatio).toBeLessThanOrEqual(1);
    }
  });

  it('mọi skill có selfBloodCost trong [0..1] (huyết tế tối đa hết máu)', () => {
    for (const s of SKILLS) {
      expect(s.selfBloodCost).toBeGreaterThanOrEqual(0);
      expect(s.selfBloodCost).toBeLessThanOrEqual(1);
    }
  });

  it('mọi sect value PHẢI là null hoặc một trong (thanh_van | huyen_thuy | tu_la)', () => {
    const validSects: ReadonlyArray<SectKey | null> = [null, 'thanh_van', 'huyen_thuy', 'tu_la'];
    for (const s of SKILLS) {
      expect(validSects).toContain(s.sect);
    }
  });

  it('skill có selfBloodCost > 0 PHẢI có atkScale > 1 (huyết tế phải đáng giá)', () => {
    const huyetTeSkills = SKILLS.filter((s) => s.selfBloodCost > 0);
    expect(huyetTeSkills.length).toBeGreaterThan(0);
    for (const s of huyetTeSkills) {
      expect(s.atkScale, `skill ${s.key} huyết tế phải đáng đổi máu`).toBeGreaterThan(1);
    }
  });

  it('skill có selfHealRatio > 0 và atkScale = 0 (heal-only) PHẢI có mpCost cao (tuyệt kỹ)', () => {
    const healOnly = SKILLS.filter((s) => s.selfHealRatio > 0 && s.atkScale === 0);
    for (const s of healOnly) {
      expect(s.mpCost, `skill ${s.key} heal-only phải có mpCost cao`).toBeGreaterThanOrEqual(20);
    }
  });
});

describe('skillByKey', () => {
  it('trả skill đúng cho key tồn tại', () => {
    const s = skillByKey('kiem_khi_chem');
    expect(s).toBeDefined();
    expect(s!.sect).toBe('thanh_van');
    expect(s!.atkScale).toBe(1.7);
  });

  it('trả undefined cho key không tồn tại', () => {
    expect(skillByKey('nonexistent_skill')).toBeUndefined();
  });

  it('basic_attack lookup khớp SKILL_BASIC_ATTACK reference', () => {
    expect(skillByKey('basic_attack')).toBe(SKILL_BASIC_ATTACK);
  });
});

describe('skillsForSect', () => {
  it('null sect → trả về tất cả skill có sect=null (basic only)', () => {
    const result = skillsForSect(null);
    expect(result.length).toBeGreaterThan(0);
    for (const s of result) {
      expect(s.sect).toBeNull();
    }
  });

  it('thanh_van → bao gồm basic + skill thanh_van, không có huyen_thuy/tu_la', () => {
    const result = skillsForSect('thanh_van');
    expect(result).toContain(SKILL_BASIC_ATTACK);
    const sects = result.map((s) => s.sect);
    expect(sects).not.toContain('huyen_thuy');
    expect(sects).not.toContain('tu_la');
    // Phải có ít nhất 2 skill thanh_van (kiem_khi_chem + tuyệt kỹ van_kiem_quy_tong).
    const thanhVanSkills = result.filter((s) => s.sect === 'thanh_van');
    expect(thanhVanSkills.length).toBeGreaterThanOrEqual(2);
  });

  it('huyen_thuy → bao gồm basic + skill huyen_thuy, không có thanh_van/tu_la', () => {
    const result = skillsForSect('huyen_thuy');
    expect(result).toContain(SKILL_BASIC_ATTACK);
    const sects = result.map((s) => s.sect);
    expect(sects).not.toContain('thanh_van');
    expect(sects).not.toContain('tu_la');
    const huyenThuySkills = result.filter((s) => s.sect === 'huyen_thuy');
    expect(huyenThuySkills.length).toBeGreaterThanOrEqual(2);
  });

  it('tu_la → bao gồm basic + skill tu_la, không có thanh_van/huyen_thuy', () => {
    const result = skillsForSect('tu_la');
    expect(result).toContain(SKILL_BASIC_ATTACK);
    const sects = result.map((s) => s.sect);
    expect(sects).not.toContain('thanh_van');
    expect(sects).not.toContain('huyen_thuy');
    const tuLaSkills = result.filter((s) => s.sect === 'tu_la');
    expect(tuLaSkills.length).toBeGreaterThanOrEqual(2);
  });
});

describe('rollDamage', () => {
  it('luôn trả integer >= 1 (sàn min damage)', () => {
    for (let i = 0; i < 100; i += 1) {
      const dmg = rollDamage(10, 5, 1.0);
      expect(Number.isInteger(dmg)).toBe(true);
      expect(dmg).toBeGreaterThanOrEqual(1);
    }
  });

  it('atk lớn hơn def → damage trung bình > 1', () => {
    let total = 0;
    const N = 100;
    for (let i = 0; i < N; i += 1) {
      total += rollDamage(50, 10, 1.0);
    }
    const avg = total / N;
    expect(avg).toBeGreaterThan(10);
  });

  it('def cực cao → damage clamp về 1 (sàn min)', () => {
    for (let i = 0; i < 50; i += 1) {
      // atk=1, def=1000 → base = 1*1 - 500 = -499, clamp về 1.
      expect(rollDamage(1, 1000, 1.0)).toBe(1);
    }
  });

  it('scale=0 + atk lớn → damage = clamp về 1 (basic with scale 0 vs def)', () => {
    for (let i = 0; i < 50; i += 1) {
      expect(rollDamage(100, 0, 0)).toBe(1);
    }
  });

  it('atk*scale>>def → damage variance trong [85%, 115%] expectation', () => {
    // base = 100*2 - 0 = 200. variance 0.85..1.15 → damage 170..230.
    const N = 200;
    const samples: number[] = [];
    for (let i = 0; i < N; i += 1) {
      samples.push(rollDamage(100, 0, 2));
    }
    const min = Math.min(...samples);
    const max = Math.max(...samples);
    expect(min).toBeGreaterThanOrEqual(170);
    expect(max).toBeLessThanOrEqual(230);
  });
});

describe('STAMINA constants', () => {
  it('STAMINA_PER_ACTION > 0', () => {
    expect(STAMINA_PER_ACTION).toBeGreaterThan(0);
  });

  it('STAMINA_REGEN_PER_TICK > 0', () => {
    expect(STAMINA_REGEN_PER_TICK).toBeGreaterThan(0);
  });
});

/**
 * Phase 12 Story PR-6 — `MonsterDef.questTargetIds` ánh xạ monster catalog
 * vào quest placeholder targetId. Bắt buộc invariants:
 *   - Mỗi placeholder phải tồn tại trong ít nhất một quest step kind=kill +
 *     targetType=monster (không cho dangling reference).
 *   - Không trùng monster.key (tránh double-track khi placeholder + key giống
 *     nhau hoàn toàn).
 *   - Mỗi placeholder không trùng nhau trong cùng một MonsterDef
 *     (Set semantics).
 */
describe('Monster questTargetIds (Phase 12 Story PR-6)', () => {
  it('mỗi questTargetIds entry phải reference quest step kill+monster có sẵn', () => {
    const validQuestTargets = new Set<string>();
    for (const def of QUESTS) {
      for (const step of def.steps) {
        if (step.kind === 'kill' && step.targetType === 'monster') {
          validQuestTargets.add(step.targetId);
        }
      }
    }
    for (const m of MONSTERS) {
      if (!m.questTargetIds) continue;
      for (const id of m.questTargetIds) {
        expect(validQuestTargets, `monster ${m.key} questTarget ${id}`).toContain(
          id,
        );
      }
    }
  });

  it('questTargetIds không trùng monster.key (tránh double-track)', () => {
    for (const m of MONSTERS) {
      if (!m.questTargetIds) continue;
      expect(m.questTargetIds, `monster ${m.key}`).not.toContain(m.key);
    }
  });

  it('questTargetIds entries unique per monster', () => {
    for (const m of MONSTERS) {
      if (!m.questTargetIds) continue;
      const set = new Set(m.questTargetIds);
      expect(set.size, `monster ${m.key} dup questTargetIds`).toBe(
        m.questTargetIds.length,
      );
    }
  });

  it('son_thu_lon mapped tới quest placeholder son_thu (Chapter 1 phamnhan playable)', () => {
    const m = monsterByKey('son_thu_lon');
    expect(m).toBeDefined();
    expect(m?.questTargetIds).toBeDefined();
    expect(m?.questTargetIds).toContain('son_thu');
  });

  it('Phàm Nhân + Luyện Khí + Trúc Cơ + Kim Đan + Nguyên Anh grind quest đều có wire ≥1 monster', () => {
    // PR-6 wire 7 placeholder critical-path (Chapter 1..5 grind/main playable)
    // qua `MonsterDef.questTargetIds` alias trên monster đã có sẵn (son_thu /
    // son_tac_dau_muc / bac_lang_quan / hac_moc_yeu / kim_son_yeu /
    // kim_dan_yeu_thu / hoang_tho_quy).
    //
    // Phase 12 Story Foundation Late-game wire (this PR) wire 8 placeholder
    // còn lại (chap_niem_anh, huyet_anh, ky_uc_meo, tam_ma_anh,
    // tam_ma_nguyen_anh, tich_linh_anh, tich_linh_quy, tich_thien_sat_thu)
    // thuộc Trúc Cơ / Kim Đan / Nguyên Anh main quest qua MonsterDef.key
    // match thẳng placeholder (key === placeholder, không cần alias).
    //
    // Sau cả 2 PR, mọi placeholder kill+monster trong QUESTS catalog phải
    // resolve đến ≥ 1 MonsterDef qua `m.key === placeholder` HOẶC
    // `m.questTargetIds.includes(placeholder)`.
    const placeholders = [
      // PR-6 critical-path (alias wire)
      'son_thu',
      'son_tac_dau_muc',
      'bac_lang_quan',
      'hac_moc_yeu',
      'kim_son_yeu',
      'kim_dan_yeu_thu',
      'hoang_tho_quy',
      // Story Foundation Late-game wire (key match)
      'tich_linh_anh',
      'tam_ma_anh',
      'tich_linh_quy',
      'tich_thien_sat_thu',
      'tam_ma_nguyen_anh',
      'chap_niem_anh',
      'ky_uc_meo',
      'huyet_anh',
    ];
    const wired = new Set<string>();
    for (const m of MONSTERS) {
      wired.add(m.key);
      for (const id of m.questTargetIds ?? []) wired.add(id);
    }
    for (const placeholder of placeholders) {
      expect(wired, `placeholder ${placeholder}`).toContain(placeholder);
    }
  });

  it('mọi quest step kind=kill+targetType=monster reachable từ ≥ 1 MonsterDef (no orphan placeholder)', () => {
    // Invariant đầy đủ: nếu quest catalog có step yêu cầu kill monster X thì
    // monster catalog phải có ≥ 1 entry resolve X — qua `key === X` HOẶC
    // `questTargetIds.includes(X)`. Vi phạm = quest sẽ mãi không progress
    // (silent fail-soft trong combat.service kill hook). Test này là backstop
    // cho mọi PR catalog tương lai (ngăn drift trở lại trạng thái pre-PR-6).
    const wired = new Set<string>();
    for (const m of MONSTERS) {
      wired.add(m.key);
      for (const id of m.questTargetIds ?? []) wired.add(id);
    }
    const orphans: string[] = [];
    for (const def of QUESTS) {
      for (const step of def.steps) {
        if (step.kind === 'kill' && step.targetType === 'monster') {
          if (!wired.has(step.targetId)) {
            orphans.push(`${def.key}:${step.id} → ${step.targetId}`);
          }
        }
      }
    }
    expect(orphans, `orphan placeholder(s): ${orphans.join(', ')}`).toEqual([]);
  });

  it('8 placeholder Story Foundation Late-game match qua MonsterDef.key (không qua alias)', () => {
    // 8 placeholder Trúc Cơ/Kim Đan/Nguyên Anh story (tâm ma / linh ảnh / sát
    // thủ tâm cảnh) là entity riêng — wire qua `MonsterDef.key` match thẳng
    // chứ KHÔNG dùng `questTargetIds` alias. Điều này khác PR-6 (alias trên
    // monster đã có sẵn) và gives kill hook auto-track đơn giản hơn (không
    // cần loop alias dedupe khi không có).
    const lateGamePlaceholders = [
      'tich_linh_anh',
      'tam_ma_anh',
      'tich_linh_quy',
      'tich_thien_sat_thu',
      'tam_ma_nguyen_anh',
      'chap_niem_anh',
      'ky_uc_meo',
      'huyet_anh',
    ];
    for (const placeholder of lateGamePlaceholders) {
      const m = monsterByKey(placeholder);
      expect(m, `late-game monster ${placeholder}`).toBeDefined();
      // KHÔNG có questTargetIds alias (key === placeholder, không cần wire alias).
      expect(
        m?.questTargetIds,
        `late-game monster ${placeholder} questTargetIds`,
      ).toBeUndefined();
    }
  });
});
