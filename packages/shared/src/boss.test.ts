import { describe, it, expect } from 'vitest';
import {
  BOSSES,
  bossByKey,
  pickBossByRotation,
  BOSS_ATTACK_COOLDOWN_MS,
  BOSS_STAMINA_PER_HIT,
  BOSS_LIFETIME_MS,
  BOSS_RESPAWN_DELAY_MS,
  WORLD_BOSS_REGION_KEY,
  bossSpawnRegions,
  bossesByRegion,
} from './boss';
import { ITEMS } from './items';

/**
 * BOSSES catalog integrity (session 9j task O): economy/reward safety for
 * world boss system. Drop pools reference ITEMS by key — dangling refs
 * would silently break reward distribution at endgame.
 */

describe('BOSSES catalog integrity', () => {
  it('ít nhất 1 boss được định nghĩa', () => {
    expect(BOSSES.length).toBeGreaterThan(0);
  });

  it('tất cả key unique', () => {
    const keys = BOSSES.map((b) => b.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('tất cả boss có baseMaxHp > 0', () => {
    for (const b of BOSSES) {
      expect(b.baseMaxHp, `${b.key} baseMaxHp`).toBeGreaterThan(0);
    }
  });

  it('atk > 0 và def >= 0', () => {
    for (const b of BOSSES) {
      expect(b.atk, `${b.key} atk`).toBeGreaterThan(0);
      expect(b.def, `${b.key} def`).toBeGreaterThanOrEqual(0);
    }
  });

  it('baseRewardLinhThach > 0 (boss không thể không cho reward)', () => {
    for (const b of BOSSES) {
      expect(b.baseRewardLinhThach, `${b.key} baseRewardLinhThach`).toBeGreaterThan(0);
    }
  });

  it('name + description không rỗng', () => {
    for (const b of BOSSES) {
      expect(b.name.trim().length).toBeGreaterThan(0);
      expect(b.description.trim().length).toBeGreaterThan(0);
    }
  });

  it('recommendedRealm không rỗng', () => {
    for (const b of BOSSES) {
      expect(b.recommendedRealm.trim().length).toBeGreaterThan(0);
    }
  });

  it('topDropPool chỉ chứa itemKey hợp lệ (no dangling refs)', () => {
    const itemKeys = new Set(ITEMS.map((i) => i.key));
    for (const b of BOSSES) {
      for (const k of b.topDropPool) {
        expect(itemKeys.has(k), `${b.key} topDropPool has dangling ${k}`).toBe(true);
      }
    }
  });

  it('midDropPool chỉ chứa itemKey hợp lệ (no dangling refs)', () => {
    const itemKeys = new Set(ITEMS.map((i) => i.key));
    for (const b of BOSSES) {
      for (const k of b.midDropPool) {
        expect(itemKeys.has(k), `${b.key} midDropPool has dangling ${k}`).toBe(true);
      }
    }
  });

  it('topDropPool không rỗng (top-1 cần item)', () => {
    for (const b of BOSSES) {
      expect(b.topDropPool.length, `${b.key} topDropPool empty`).toBeGreaterThan(0);
    }
  });

  it('midDropPool không rỗng (top 2-3 cần item)', () => {
    for (const b of BOSSES) {
      expect(b.midDropPool.length, `${b.key} midDropPool empty`).toBeGreaterThan(0);
    }
  });

  describe('Phase 11.3.D++ — Linh Căn Đan endgame drop tuning', () => {
    /**
     * Boss tier ≥ Hóa Thần (`hoa_than` order=5) phải drop `linh_can_dan` ở
     * mid/top pool. Tier dưới (truc_co/kim_dan/nguyen_anh) KHÔNG được có —
     * tránh leak supply về early game làm vỡ rarity của Linh Căn Đan reroll.
     */
    const ENDGAME_REALM_KEYS = new Set([
      'hoa_than',
      'luyen_hu',
      'hop_the',
      'dai_thua',
      'do_kiep',
    ]);

    it('mọi boss tier ≥ Hóa Thần đều drop linh_can_dan ở mid/top pool', () => {
      const endgameBosses = BOSSES.filter((b) =>
        ENDGAME_REALM_KEYS.has(b.recommendedRealm),
      );
      expect(endgameBosses.length, 'có ≥ 1 endgame boss để drop tune').toBeGreaterThan(0);
      for (const b of endgameBosses) {
        const pools = [...b.topDropPool, ...b.midDropPool];
        expect(
          pools.includes('linh_can_dan'),
          `${b.key} (${b.recommendedRealm}) phải drop linh_can_dan`,
        ).toBe(true);
      }
    });

    it('boss tier < Hóa Thần KHÔNG drop linh_can_dan (rarity gate)', () => {
      const earlyBosses = BOSSES.filter(
        (b) => !ENDGAME_REALM_KEYS.has(b.recommendedRealm),
      );
      for (const b of earlyBosses) {
        const pools = [
          ...b.topDropPool,
          ...b.midDropPool,
          ...(b.lowDropPool ?? []),
        ];
        expect(
          pools.includes('linh_can_dan'),
          `${b.key} (${b.recommendedRealm}) KHÔNG được drop linh_can_dan`,
        ).toBe(false);
      }
    });
  });

  it('mid-tier boss mạnh hơn entry-tier (monotonic power scaling)', () => {
    // Boss index cao hơn trong array thường là tier cao hơn — atk + hp phải tăng.
    for (let i = 1; i < BOSSES.length; i++) {
      const prev = BOSSES[i - 1];
      const curr = BOSSES[i];
      expect(
        curr.baseMaxHp,
        `${curr.key} baseMaxHp (${curr.baseMaxHp}) should >= ${prev.key} (${prev.baseMaxHp})`,
      ).toBeGreaterThanOrEqual(prev.baseMaxHp);
      expect(
        curr.atk,
        `${curr.key} atk (${curr.atk}) should >= ${prev.key} (${prev.atk})`,
      ).toBeGreaterThanOrEqual(prev.atk);
      expect(
        curr.baseRewardLinhThach,
        `${curr.key} reward should >= ${prev.key}`,
      ).toBeGreaterThanOrEqual(prev.baseRewardLinhThach);
    }
  });
});

describe('bossByKey()', () => {
  it('resolve known key', () => {
    const first = BOSSES[0];
    const found = bossByKey(first.key);
    expect(found).toBeDefined();
    expect(found?.name).toBe(first.name);
  });

  it('returns undefined cho unknown key', () => {
    expect(bossByKey('void_dragon_xyz')).toBeUndefined();
  });
});

describe('pickBossByRotation()', () => {
  it('seed=0 → boss[0]', () => {
    expect(pickBossByRotation(0).key).toBe(BOSSES[0].key);
  });

  it('seed=BOSSES.length → boss[0] (modulo wrap)', () => {
    expect(pickBossByRotation(BOSSES.length).key).toBe(BOSSES[0].key);
  });

  it('seed=BOSSES.length+1 → boss[1] (rotation deterministic)', () => {
    if (BOSSES.length > 1) {
      expect(pickBossByRotation(BOSSES.length + 1).key).toBe(BOSSES[1].key);
    }
  });

  it('seed rất lớn vẫn resolve được boss hợp lệ (no out-of-range)', () => {
    const b = pickBossByRotation(999999);
    expect(BOSSES.map((x) => x.key)).toContain(b.key);
  });
});

describe('Phase 12.6 — boss-by-region helpers', () => {
  it('WORLD_BOSS_REGION_KEY = "world" (DB regionKey constant)', () => {
    expect(WORLD_BOSS_REGION_KEY).toBe('world');
  });

  it('bossSpawnRegions() returns sorted distinct regions including "world" (cho catalog null regionKey)', () => {
    const regions = bossSpawnRegions();
    expect(regions.length).toBeGreaterThan(0);
    // Sorted ascending — deterministic heartbeat ordering
    const sorted = [...regions].sort();
    expect(regions).toEqual(sorted);
    // No duplicates
    expect(new Set(regions).size).toBe(regions.length);
  });

  it('bossSpawnRegions() bao gồm WORLD_BOSS_REGION_KEY khi catalog có boss regionKey=null', () => {
    const hasNullRegion = BOSSES.some((b) => b.regionKey === null || b.regionKey === undefined);
    if (hasNullRegion) {
      expect(bossSpawnRegions()).toContain(WORLD_BOSS_REGION_KEY);
    }
  });

  it('bossesByRegion("world") trả về catalog boss với regionKey null/undefined', () => {
    const worldBosses = bossesByRegion(WORLD_BOSS_REGION_KEY);
    for (const b of worldBosses) {
      expect(b.regionKey == null, `${b.key} should have regionKey null/undefined`).toBe(true);
    }
  });

  it('bossesByRegion(specificRegion) returns chỉ boss của region đó', () => {
    const regions = bossSpawnRegions().filter((r) => r !== WORLD_BOSS_REGION_KEY);
    expect(regions.length).toBeGreaterThan(0);
    for (const region of regions) {
      const filtered = bossesByRegion(region);
      expect(filtered.length, `region ${region} có ≥1 boss`).toBeGreaterThan(0);
      for (const b of filtered) {
        expect(b.regionKey, `${b.key} regionKey match`).toBe(region);
      }
    }
  });

  it('mỗi region trong bossSpawnRegions() có ≥1 boss spawn-able (catalog không leak orphan region)', () => {
    for (const region of bossSpawnRegions()) {
      expect(bossesByRegion(region).length, `region ${region} có ≥1 boss`).toBeGreaterThan(0);
    }
  });
});

describe('Boss tuning constants', () => {
  it('BOSS_ATTACK_COOLDOWN_MS hợp lý (1-5s để tránh flood)', () => {
    expect(BOSS_ATTACK_COOLDOWN_MS).toBeGreaterThanOrEqual(1000);
    expect(BOSS_ATTACK_COOLDOWN_MS).toBeLessThanOrEqual(5000);
  });

  it('BOSS_STAMINA_PER_HIT > 0 (không free hit)', () => {
    expect(BOSS_STAMINA_PER_HIT).toBeGreaterThan(0);
  });

  it('BOSS_LIFETIME_MS hợp lý (>= 10 phút)', () => {
    expect(BOSS_LIFETIME_MS).toBeGreaterThanOrEqual(10 * 60 * 1000);
  });

  it('BOSS_RESPAWN_DELAY_MS >= 1 phút (tránh spam spawn)', () => {
    expect(BOSS_RESPAWN_DELAY_MS).toBeGreaterThanOrEqual(60 * 1000);
  });
});

// ─── Content Depth Pack Tests ───────────────────────────────────────────
describe('BOSSES skill book drops (Content Depth Pack)', () => {
  it('có ít nhất 3 bosses với skill book drops trong loot pools', () => {
    const bossesWithSkillBooks = BOSSES.filter((b) => {
      const allDrops = [
        ...(b.topDropPool ?? []),
        ...(b.midDropPool ?? []),
        ...(b.lowDropPool ?? []),
      ];
      return allDrops.some((itemKey) => itemKey.startsWith('skill_book_'));
    });
    expect(bossesWithSkillBooks.length).toBeGreaterThanOrEqual(3);
  });

  it('skill book items trong boss drops đều tồn tại trong ITEMS catalog', () => {
    const itemKeys = new Set(ITEMS.map((i) => i.key));
    for (const b of BOSSES) {
      const allDrops = [
        ...(b.topDropPool ?? []),
        ...(b.midDropPool ?? []),
        ...(b.lowDropPool ?? []),
      ];
      for (const itemKey of allDrops) {
        if (itemKey.startsWith('skill_book_')) {
          expect(
            itemKeys.has(itemKey),
            `boss ${b.key} drop skill_book '${itemKey}' không tồn tại trong ITEMS`,
          ).toBe(true);
        }
      }
    }
  });
});
