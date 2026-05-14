import { describe, expect, it } from 'vitest';

import { ACHIEVEMENTS } from './achievements';
import { ELEMENTS } from './combat';
import { REALMS } from './realms';

import {
  TITLES,
  composeTitleMods,
  getTitleDef,
  titleForAchievement,
  titleForRealmMilestone,
  titleForSectRole,
  titlesByElement,
  titlesByRarity,
  titlesBySource,
  type TitleRarity,
  type TitleSource,
} from './titles';

const VALID_RARITIES: readonly TitleRarity[] = [
  'common',
  'rare',
  'epic',
  'legendary',
  'mythic',
];

const VALID_SOURCES: readonly TitleSource[] = [
  'realm_milestone',
  'element_mastery',
  'achievement',
  'sect_rank',
  'sect_season',
  'event',
  'donation',
  // Phase 44.1 — onboarding 7-day Day 7 title source.
  'onboarding',
];

const VALID_STAT_TARGETS = [
  'atk',
  'def',
  'hpMax',
  'mpMax',
  'spirit',
] as const;

describe('TITLES catalog shape', () => {
  it('có ít nhất 20 title baseline', () => {
    expect(TITLES.length).toBeGreaterThanOrEqual(20);
  });

  it('mỗi title có key duy nhất + nameVi + nameEn + description non-empty', () => {
    const seen = new Set<string>();
    for (const t of TITLES) {
      expect(t.key).toMatch(/^[a-z][a-z0-9_]*$/);
      expect(seen.has(t.key)).toBe(false);
      seen.add(t.key);
      expect(t.nameVi.length).toBeGreaterThan(0);
      expect(t.nameEn.length).toBeGreaterThan(0);
      expect(t.description.length).toBeGreaterThan(0);
    }
  });

  it('rarity ∈ TitleRarity enum', () => {
    for (const t of TITLES) {
      expect(VALID_RARITIES).toContain(t.rarity);
    }
  });

  it('source ∈ TitleSource enum', () => {
    for (const t of TITLES) {
      expect(VALID_SOURCES).toContain(t.source);
    }
  });

  it('element ∈ ElementKey ∪ null', () => {
    for (const t of TITLES) {
      if (t.element !== null) {
        expect(ELEMENTS).toContain(t.element);
      }
    }
  });

  it('source=realm_milestone có unlockRealmKey non-null + ref REALMS', () => {
    const realmKeys = new Set(REALMS.map((r) => r.key));
    for (const t of TITLES) {
      if (t.source === 'realm_milestone') {
        expect(t.unlockRealmKey).not.toBeNull();
        expect(realmKeys.has(t.unlockRealmKey as string)).toBe(true);
      } else {
        expect(t.unlockRealmKey).toBeNull();
      }
    }
  });

  it('source=achievement có unlockAchievementKey non-null', () => {
    for (const t of TITLES) {
      if (t.source === 'achievement') {
        expect(t.unlockAchievementKey).not.toBeNull();
      } else {
        expect(t.unlockAchievementKey).toBeNull();
      }
    }
  });

  // Phase 11.10.G-2 catalog cross-ref hardening — verify referential integrity
  // titles.unlockAchievementKey → ACHIEVEMENTS catalog. Bảo vệ
  // `titleForAchievement(achievementKey)` lookup khỏi catalog drift / typo
  // rename ở 1 catalog mà không cập nhật catalog kia.
  it('source=achievement: unlockAchievementKey PHẢI tồn tại trong ACHIEVEMENTS catalog', () => {
    const achievementKeys = new Set(ACHIEVEMENTS.map((a) => a.key));
    for (const t of TITLES) {
      if (t.source === 'achievement' && t.unlockAchievementKey !== null) {
        expect(
          achievementKeys.has(t.unlockAchievementKey),
          `title ${t.key} unlockAchievementKey='${t.unlockAchievementKey}' không tồn tại trong ACHIEVEMENTS catalog`,
        ).toBe(true);
      }
    }
  });

  it('source=sect_rank có unlockSectRole non-null', () => {
    for (const t of TITLES) {
      if (t.source === 'sect_rank') {
        expect(t.unlockSectRole).not.toBeNull();
      } else {
        expect(t.unlockSectRole).toBeNull();
      }
    }
  });

  it('source=element_mastery có element non-null', () => {
    for (const t of TITLES) {
      if (t.source === 'element_mastery') {
        expect(t.element).not.toBeNull();
      }
    }
  });

  it('flavorStatBonus nếu non-null phải có statTarget hợp lệ + value finite > 0', () => {
    for (const t of TITLES) {
      if (t.flavorStatBonus !== null) {
        expect(VALID_STAT_TARGETS).toContain(t.flavorStatBonus.statTarget);
        expect(Number.isFinite(t.flavorStatBonus.value)).toBe(true);
        expect(t.flavorStatBonus.value).toBeGreaterThan(0);
      }
    }
  });
});

describe('TITLES curve coverage', () => {
  it('có ≥ 9 realm milestone title', () => {
    const realmTitles = titlesBySource('realm_milestone');
    expect(realmTitles.length).toBeGreaterThanOrEqual(9);
  });

  it('mỗi element kim/moc/thuy/hoa/tho có ≥ 1 element_mastery title', () => {
    for (const elem of ELEMENTS) {
      const found = TITLES.filter(
        (t) => t.source === 'element_mastery' && t.element === elem
      );
      expect(found.length).toBeGreaterThanOrEqual(1);
    }
  });

  it('có ≥ 4 achievement title', () => {
    expect(titlesBySource('achievement').length).toBeGreaterThanOrEqual(4);
  });

  it('có ≥ 3 sect rank title', () => {
    expect(titlesBySource('sect_rank').length).toBeGreaterThanOrEqual(3);
  });

  it('có ≥ 2 event title', () => {
    expect(titlesBySource('event').length).toBeGreaterThanOrEqual(2);
  });

  it('có ≥ 1 donation title', () => {
    expect(titlesBySource('donation').length).toBeGreaterThanOrEqual(1);
  });

  it('mỗi rarity tier có ≥ 1 title (cover full spectrum)', () => {
    for (const r of VALID_RARITIES) {
      expect(titlesByRarity(r).length).toBeGreaterThanOrEqual(1);
    }
  });

  it('có 1 mythic title (đỉnh phong)', () => {
    expect(titlesByRarity('mythic').length).toBeGreaterThanOrEqual(1);
  });
});

describe('TITLES balance: flavorStatBonus cap per rarity', () => {
  it('common không có flavorStatBonus hoặc bonus rất nhỏ ≤ 1.02', () => {
    for (const t of TITLES.filter((x) => x.rarity === 'common')) {
      if (t.flavorStatBonus) {
        expect(t.flavorStatBonus.value).toBeLessThanOrEqual(1.02);
      }
    }
  });

  it('rare bonus ≤ 1.03', () => {
    for (const t of TITLES.filter((x) => x.rarity === 'rare')) {
      if (t.flavorStatBonus) {
        expect(t.flavorStatBonus.value).toBeLessThanOrEqual(1.03);
      }
    }
  });

  it('epic bonus ≤ 1.05', () => {
    for (const t of TITLES.filter((x) => x.rarity === 'epic')) {
      if (t.flavorStatBonus) {
        expect(t.flavorStatBonus.value).toBeLessThanOrEqual(1.05);
      }
    }
  });

  it('legendary bonus ≤ 1.10', () => {
    for (const t of TITLES.filter((x) => x.rarity === 'legendary')) {
      if (t.flavorStatBonus) {
        expect(t.flavorStatBonus.value).toBeLessThanOrEqual(1.10);
      }
    }
  });

  it('mythic bonus ≤ 1.15', () => {
    for (const t of TITLES.filter((x) => x.rarity === 'mythic')) {
      if (t.flavorStatBonus) {
        expect(t.flavorStatBonus.value).toBeLessThanOrEqual(1.15);
      }
    }
  });
});

describe('Helper: getTitleDef', () => {
  it('trả undefined cho key không tồn tại', () => {
    expect(getTitleDef('nonexistent_title')).toBeUndefined();
  });

  it('trả def đúng cho key hợp lệ', () => {
    const def = getTitleDef('realm_kim_dan_adept');
    expect(def).toBeDefined();
    expect(def?.source).toBe('realm_milestone');
    expect(def?.unlockRealmKey).toBe('kim_dan');
  });

  it('mỗi title trong catalog đều lookup được', () => {
    for (const t of TITLES) {
      expect(getTitleDef(t.key)).toBe(t);
    }
  });
});

describe('Helper: titlesByRarity', () => {
  it('common trả ≥ 1 title', () => {
    expect(titlesByRarity('common').length).toBeGreaterThanOrEqual(1);
  });

  it('mythic trả ≥ 1 title', () => {
    expect(titlesByRarity('mythic').length).toBeGreaterThanOrEqual(1);
  });

  it('all rarity sum = TITLES.length', () => {
    let total = 0;
    for (const r of VALID_RARITIES) {
      total += titlesByRarity(r).length;
    }
    expect(total).toBe(TITLES.length);
  });
});

describe('Helper: titlesBySource', () => {
  it('realm_milestone trả ≥ 9 title', () => {
    expect(titlesBySource('realm_milestone').length).toBeGreaterThanOrEqual(9);
  });

  it('all source sum = TITLES.length', () => {
    let total = 0;
    for (const s of VALID_SOURCES) {
      total += titlesBySource(s).length;
    }
    expect(total).toBe(TITLES.length);
  });
});

describe('Helper: titlesByElement', () => {
  it('null trả neutral title (≥ 9 realm + 4 achievement + 3 sect + 2 event + 1 donation)', () => {
    const neutrals = titlesByElement(null);
    for (const t of neutrals) expect(t.element).toBeNull();
    expect(neutrals.length).toBeGreaterThanOrEqual(15);
  });

  it('mỗi element trả ≥ 1 title', () => {
    for (const elem of ELEMENTS) {
      expect(titlesByElement(elem).length).toBeGreaterThanOrEqual(1);
    }
  });
});

describe('Helper: titleForRealmMilestone', () => {
  it('realm có milestone title trả def đúng', () => {
    const t = titleForRealmMilestone('kim_dan');
    expect(t).toBeDefined();
    expect(t?.key).toBe('realm_kim_dan_adept');
  });

  it('realm không có milestone trả undefined', () => {
    const t = titleForRealmMilestone('nonexistent_realm');
    expect(t).toBeUndefined();
  });

  it('phamnhan (order 0) không có milestone title', () => {
    expect(titleForRealmMilestone('phamnhan')).toBeUndefined();
  });

  it('hu_khong_chi_ton (đỉnh phong) có mythic title', () => {
    const t = titleForRealmMilestone('hu_khong_chi_ton');
    expect(t).toBeDefined();
    expect(t?.rarity).toBe('mythic');
  });
});

describe('Helper: titleForAchievement', () => {
  it('first_boss_kill achievement → boss slayer title', () => {
    const t = titleForAchievement('first_boss_kill');
    expect(t).toBeDefined();
    expect(t?.key).toBe('achievement_first_boss');
  });

  it('achievement không tồn tại trả undefined', () => {
    expect(titleForAchievement('nonexistent_achievement')).toBeUndefined();
  });
});

describe('Helper: titleForSectRole', () => {
  it('elder sect role → elder title', () => {
    const t = titleForSectRole('elder');
    expect(t).toBeDefined();
    expect(t?.key).toBe('sect_elder');
  });

  it('sect role không tồn tại trả undefined', () => {
    expect(titleForSectRole('nonexistent_role')).toBeUndefined();
  });
});

describe('Helper: composeTitleMods', () => {
  it('list rỗng trả identity', () => {
    const mods = composeTitleMods([]);
    expect(mods.atkMul).toBe(1);
    expect(mods.defMul).toBe(1);
    expect(mods.hpMaxMul).toBe(1);
    expect(mods.mpMaxMul).toBe(1);
    expect(mods.spiritMul).toBe(1);
  });

  it('title không có flavorStatBonus áp identity', () => {
    const mods = composeTitleMods(['realm_luyenkhi_initiate']);
    expect(mods.atkMul).toBe(1);
    expect(mods.defMul).toBe(1);
  });

  it('realm_kim_dan_adept áp atk × 1.02', () => {
    const mods = composeTitleMods(['realm_kim_dan_adept']);
    expect(mods.atkMul).toBeCloseTo(1.02, 5);
  });

  it('element_tho_earth_tyrant áp def × 1.05', () => {
    const mods = composeTitleMods(['element_tho_earth_tyrant']);
    expect(mods.defMul).toBeCloseTo(1.05, 5);
  });

  it('hu_khong_chi_ton (mythic) áp atk × 1.12', () => {
    const mods = composeTitleMods(['realm_hu_khong_chi_ton']);
    expect(mods.atkMul).toBeCloseTo(1.12, 5);
  });

  it('combine 2 title đa stat (atk + def)', () => {
    const mods = composeTitleMods([
      'realm_kim_dan_adept', // atk × 1.02
      'element_tho_earth_tyrant', // def × 1.05
    ]);
    expect(mods.atkMul).toBeCloseTo(1.02, 5);
    expect(mods.defMul).toBeCloseTo(1.05, 5);
  });

  it('combine 2 title cùng stat áp multiplicative', () => {
    const mods = composeTitleMods([
      'realm_kim_dan_adept', // atk × 1.02
      'element_kim_blade_master', // atk × 1.05
    ]);
    expect(mods.atkMul).toBeCloseTo(1.02 * 1.05, 5);
  });

  it('unknown key skip không lỗi', () => {
    const mods = composeTitleMods([
      'nonexistent_xyz',
      'realm_kim_dan_adept',
    ]);
    expect(mods.atkMul).toBeCloseTo(1.02, 5);
  });
});

describe('TITLES integration: REALMS coverage', () => {
  it('realm_milestone titles cover các realm tier khác nhau', () => {
    const realmKeys = TITLES.filter((t) => t.source === 'realm_milestone').map(
      (t) => t.unlockRealmKey
    );
    expect(realmKeys).toContain('luyenkhi');
    expect(realmKeys).toContain('kim_dan');
    expect(realmKeys).toContain('hu_khong_chi_ton');
  });

  it('realm milestone không trỏ tới phamnhan (order 0)', () => {
    const phamMilestone = TITLES.find(
      (t) =>
        t.source === 'realm_milestone' && t.unlockRealmKey === 'phamnhan'
    );
    expect(phamMilestone).toBeUndefined();
  });
});
