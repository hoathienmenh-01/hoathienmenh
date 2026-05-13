import { describe, expect, it } from 'vitest';
import { MONSTER_FAMILIES } from './monster-taxonomy';
import {
  SECT_BOSS_CATEGORIES,
  SECT_BOSSES,
  SECT_DUNGEON_CATEGORIES,
  SECT_DUNGEONS,
  canEnterSectDungeon,
  computeSectBossHp,
  getSectBossByKey,
  getSectBossesByCategory,
  getSectDungeonByKey,
  getSectDungeonsByCategory,
} from './sect-content';

describe('sect-content — sect dungeons integrity', () => {
  it('key unique', () => {
    const keys = SECT_DUNGEONS.map((d) => d.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('category thuộc SECT_DUNGEON_CATEGORIES', () => {
    const allowed = new Set(SECT_DUNGEON_CATEGORIES);
    for (const d of SECT_DUNGEONS) {
      expect(allowed.has(d.category)).toBe(true);
    }
  });

  it('sourceTier ∈ [1..9]; dailyAttemptsPerMember ≥ 1', () => {
    for (const d of SECT_DUNGEONS) {
      expect(d.sourceTier).toBeGreaterThanOrEqual(1);
      expect(d.sourceTier).toBeLessThanOrEqual(9);
      expect(d.dailyAttemptsPerMember).toBeGreaterThanOrEqual(1);
    }
  });

  it('contributionCost ≥ 0', () => {
    for (const d of SECT_DUNGEONS) {
      expect(d.contributionCost).toBeGreaterThanOrEqual(0);
    }
  });

  it('Bao phủ đủ 6 category', () => {
    const present = new Set(SECT_DUNGEONS.map((d) => d.category));
    for (const cat of SECT_DUNGEON_CATEGORIES) {
      expect(present.has(cat), `category ${cat} thiếu seed`).toBe(true);
    }
  });

  it('CAM_DIA phải có weeklyAttemptsPerSect cap', () => {
    const camDia = getSectDungeonsByCategory('CAM_DIA');
    for (const d of camDia) {
      expect(d.weeklyAttemptsPerSect, `${d.key} cấm địa thiếu weekly cap`).toBeGreaterThanOrEqual(1);
    }
  });
});

describe('sect-content — sect bosses integrity', () => {
  it('key unique', () => {
    const keys = SECT_BOSSES.map((b) => b.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('category thuộc SECT_BOSS_CATEGORIES', () => {
    const allowed = new Set(SECT_BOSS_CATEGORIES);
    for (const b of SECT_BOSSES) {
      expect(allowed.has(b.category)).toBe(true);
    }
  });

  it('family thuộc MONSTER_FAMILIES', () => {
    const allowed = new Set(MONSTER_FAMILIES);
    for (const b of SECT_BOSSES) {
      expect(allowed.has(b.family)).toBe(true);
    }
  });

  it('hpScalingBySectLevel baseHp + hpPerLevel ≥ 0', () => {
    for (const b of SECT_BOSSES) {
      expect(b.hpScalingBySectLevel.baseHp).toBeGreaterThan(0);
      expect(b.hpScalingBySectLevel.hpPerLevel).toBeGreaterThan(0);
    }
  });

  it('contributionReward ≥ 0', () => {
    for (const b of SECT_BOSSES) {
      expect(b.contributionReward).toBeGreaterThanOrEqual(0);
    }
  });

  it('weeklyAttemptsPerSect ≥ dailyAttemptsPerMember (khi cả 2 > 0)', () => {
    for (const b of SECT_BOSSES) {
      if (b.dailyAttemptsPerMember > 0 && b.weeklyAttemptsPerSect > 0) {
        expect(b.weeklyAttemptsPerSect).toBeGreaterThanOrEqual(b.dailyAttemptsPerMember);
      }
    }
  });

  it('Bao phủ đủ 4 SectBossCategory', () => {
    for (const cat of SECT_BOSS_CATEGORIES) {
      const bosses = getSectBossesByCategory(cat);
      expect(bosses.length, `SectBossCategory ${cat} cần ít nhất 1 seed`).toBeGreaterThanOrEqual(1);
    }
  });

  it('INVADER phải có schedule + rankingRewardProfile', () => {
    const invaders = getSectBossesByCategory('INVADER');
    for (const b of invaders) {
      expect(b.schedule).toBeTruthy();
      expect(b.rankingRewardProfile, `${b.key} invader phải có ranking`).toBeTruthy();
    }
  });
});

describe('sect-content — computeSectBossHp', () => {
  const guardian = getSectBossByKey('sect_boss_thu_ho_linh_mach')!;

  it('Sect level 1 → baseHp + 500', () => {
    expect(computeSectBossHp(guardian, 1)).toBe(1500);
  });

  it('Sect level 5 → baseHp + 2500', () => {
    expect(computeSectBossHp(guardian, 5)).toBe(3500);
  });

  it('Sect level 0 hoặc âm clamp về 1', () => {
    expect(computeSectBossHp(guardian, 0)).toBe(1500);
    expect(computeSectBossHp(guardian, -5)).toBe(1500);
  });
});

describe('sect-content — canEnterSectDungeon gating', () => {
  const linhMach = getSectDungeonByKey('sect_linh_mach_dong')!;
  const duocVien = getSectDungeonByKey('sect_duoc_vien_bi_canh')!;

  it('Sect level đủ + đủ contribution → allowed', () => {
    expect(
      canEnterSectDungeon(linhMach, { playerSectLevel: 1, playerContribution: 0 }),
    ).toEqual({ allowed: true });
  });

  it('Sect level chưa đủ → SECT_LEVEL_TOO_LOW', () => {
    expect(
      canEnterSectDungeon(duocVien, { playerSectLevel: 1, playerContribution: 1000 }),
    ).toEqual({ allowed: false, reason: 'SECT_LEVEL_TOO_LOW' });
  });

  it('Đủ sect level nhưng thiếu cống hiến → NOT_ENOUGH_CONTRIBUTION', () => {
    expect(
      canEnterSectDungeon(duocVien, { playerSectLevel: 2, playerContribution: 10 }),
    ).toEqual({ allowed: false, reason: 'NOT_ENOUGH_CONTRIBUTION' });
  });

  it('Realm chưa đủ (khi cung cấp playerRealmOrder) → REALM_TOO_LOW', () => {
    expect(
      canEnterSectDungeon(duocVien, {
        playerSectLevel: 2,
        playerContribution: 100,
        playerRealmOrder: 0,
      }),
    ).toEqual({ allowed: false, reason: 'REALM_TOO_LOW' });
  });

  it('Disabled → DISABLED', () => {
    const camDia = getSectDungeonByKey('sect_cam_dia')!;
    expect(
      canEnterSectDungeon(camDia, {
        playerSectLevel: 9,
        playerContribution: 10000,
        playerRealmOrder: 27,
      }),
    ).toEqual({ allowed: false, reason: 'DISABLED' });
  });
});
