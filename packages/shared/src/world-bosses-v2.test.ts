import { describe, expect, it } from 'vitest';
import { MAP_REGIONS } from './map-regions';
import { MONSTER_FAMILIES } from './monster-taxonomy';
import {
  BOSS_CATEGORIES,
  BOSSES_V2,
  getBossV2ByKey,
  getBossesV2ByCategory,
  getBossesV2ByRegion,
} from './world-bosses-v2';
import { ELEMENTS } from './combat';

describe('world-bosses-v2 — catalog integrity', () => {
  it('mỗi boss có key unique', () => {
    const keys = BOSSES_V2.map((b) => b.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('category thuộc BOSS_CATEGORIES', () => {
    const allowed = new Set(BOSS_CATEGORIES);
    for (const b of BOSSES_V2) {
      expect(allowed.has(b.category)).toBe(true);
    }
  });

  it('family thuộc MONSTER_FAMILIES', () => {
    const allowed = new Set(MONSTER_FAMILIES);
    for (const b of BOSSES_V2) {
      expect(allowed.has(b.family)).toBe(true);
    }
  });

  it('element null hoặc thuộc ELEMENTS', () => {
    const allowed = new Set(ELEMENTS);
    for (const b of BOSSES_V2) {
      if (b.element != null) {
        expect(allowed.has(b.element)).toBe(true);
      }
    }
  });

  it('regionKey nếu có thuộc MAP_REGIONS', () => {
    const known = new Set(MAP_REGIONS.map((r) => r.key));
    for (const b of BOSSES_V2) {
      if (b.regionKey != null) {
        expect(known.has(b.regionKey)).toBe(true);
      }
    }
  });

  it('sourceTier ∈ [1..9] và bossTier ∈ [1..5]', () => {
    for (const b of BOSSES_V2) {
      expect(b.sourceTier).toBeGreaterThanOrEqual(1);
      expect(b.sourceTier).toBeLessThanOrEqual(9);
      expect(b.bossTier).toBeGreaterThanOrEqual(1);
      expect(b.bossTier).toBeLessThanOrEqual(5);
    }
  });

  it('manualOnly === true cho mọi boss (anti-P2W auto-farm rule)', () => {
    for (const b of BOSSES_V2) {
      expect(b.manualOnly, `${b.key} must be manualOnly`).toBe(true);
    }
  });

  it('daily/weekly cap ≥ 0; daily ≤ weekly (khi cả 2 > 0)', () => {
    for (const b of BOSSES_V2) {
      expect(b.dailyRewardCap).toBeGreaterThanOrEqual(0);
      expect(b.weeklyRewardCap).toBeGreaterThanOrEqual(0);
      if (b.dailyRewardCap > 0 && b.weeklyRewardCap > 0) {
        expect(b.dailyRewardCap).toBeLessThanOrEqual(b.weeklyRewardCap);
      }
    }
  });

  it('WORLD_BOSS phải có rankingRewardProfile', () => {
    const worldBosses = getBossesV2ByCategory('WORLD_BOSS');
    expect(worldBosses.length).toBeGreaterThanOrEqual(1);
    for (const b of worldBosses) {
      expect(b.rankingRewardProfile, `${b.key} world boss missing rankingRewardProfile`).toBeTruthy();
    }
  });

  it('MAIN_QUEST_BOSS firstKillReward.linhThach > 0 và repeat ≤ first (anti-farm)', () => {
    const mainQuest = getBossesV2ByCategory('MAIN_QUEST_BOSS');
    for (const b of mainQuest) {
      expect(b.firstKillReward?.linhThach ?? 0).toBeGreaterThan(0);
      const repeat = b.repeatRewardProfile.linhThach ?? 0;
      const first = b.firstKillReward?.linhThach ?? 0;
      expect(repeat).toBeLessThanOrEqual(first);
    }
  });

  it('HIDDEN_BOSS phải có spawnRule', () => {
    const hidden = getBossesV2ByCategory('HIDDEN_BOSS');
    expect(hidden.length).toBeGreaterThanOrEqual(1);
    for (const b of hidden) {
      expect(b.spawnRule, `${b.key} hidden missing spawnRule`).toBeTruthy();
    }
  });

  it('SECT_BOSS phải sectRequired=true', () => {
    const sectBosses = getBossesV2ByCategory('SECT_BOSS');
    expect(sectBosses.length).toBeGreaterThanOrEqual(1);
    for (const b of sectBosses) {
      expect(b.sectRequired).toBe(true);
    }
  });

  it('DUNGEON_BOSS phải có dungeonKey', () => {
    const dungeonBosses = getBossesV2ByCategory('DUNGEON_BOSS');
    expect(dungeonBosses.length).toBeGreaterThanOrEqual(1);
    for (const b of dungeonBosses) {
      expect(b.dungeonKey, `${b.key} dungeon boss missing dungeonKey`).toBeTruthy();
    }
  });

  it('HOURLY_BOSS phải có schedule.hoursOfDay không rỗng', () => {
    const hourly = getBossesV2ByCategory('HOURLY_BOSS');
    expect(hourly.length).toBeGreaterThanOrEqual(1);
    for (const b of hourly) {
      expect(b.schedule).toBeTruthy();
      expect((b.schedule!.hoursOfDay ?? []).length).toBeGreaterThan(0);
    }
  });

  it('TRIAL_BOSS có daily/weekly cap = 0 (Trial Tower có cap riêng)', () => {
    const trial = getBossesV2ByCategory('TRIAL_BOSS');
    for (const b of trial) {
      expect(b.dailyRewardCap).toBe(0);
      expect(b.weeklyRewardCap).toBe(0);
    }
  });
});

describe('world-bosses-v2 — indexing helpers', () => {
  it('getBossV2ByKey undefined when not found', () => {
    expect(getBossV2ByKey('does_not_exist')).toBeUndefined();
  });

  it('getBossesV2ByRegion trả đúng tập', () => {
    const sonCoc = getBossesV2ByRegion('son_coc');
    for (const b of sonCoc) expect(b.regionKey).toBe('son_coc');
  });

  it('Mỗi BossCategory có ít nhất 1 seed', () => {
    for (const cat of BOSS_CATEGORIES) {
      const bosses = getBossesV2ByCategory(cat);
      expect(bosses.length, `BossCategory ${cat} cần ít nhất 1 seed`).toBeGreaterThanOrEqual(1);
    }
  });
});
