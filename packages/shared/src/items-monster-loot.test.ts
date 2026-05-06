/**
 * Phase 12.4 — Tests cho `MonsterDef.lootTable` override + `rollMonsterLoot`.
 *
 * Tại sao cần test:
 *   - `MonsterDef.lootTable` optional field — boss/elite có drop chain riêng.
 *     Cần verify integrity (weight > 0, qtyRange, itemKey resolve).
 *   - `rollMonsterLoot` ưu tiên trước `rollDungeonLoot` trong runtime —
 *     cần lock behavior: monster có lootTable → roll từ đó, else → [].
 *   - Convention: chỉ ELITE/BOSS được override, BEAST KHÔNG (phòng leak).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MONSTERS, monsterByKey } from './combat';
import { itemByKey, rollMonsterLoot } from './items';

describe('MonsterDef.lootTable integrity (Phase 12.4)', () => {
  const monstersWithLootTable = MONSTERS.filter(
    (m) => m.lootTable && m.lootTable.length > 0,
  );

  it('có ít nhất 4 monsters với lootTable override', () => {
    expect(monstersWithLootTable.length).toBeGreaterThanOrEqual(4);
  });

  it('chỉ ELITE / BOSS có lootTable (convention gate)', () => {
    for (const m of monstersWithLootTable) {
      expect(
        ['ELITE', 'BOSS'].includes(m.monsterType ?? ''),
        `${m.key} (${m.monsterType}) có lootTable nhưng không phải ELITE/BOSS`,
      ).toBe(true);
    }
  });

  it('mọi entry trong lootTable có weight > 0', () => {
    for (const m of monstersWithLootTable) {
      for (const e of m.lootTable!) {
        expect(e.weight, `${m.key} → ${e.itemKey} weight`).toBeGreaterThan(0);
      }
    }
  });

  it('mọi entry có qtyMin ≥ 1 và qtyMin ≤ qtyMax', () => {
    for (const m of monstersWithLootTable) {
      for (const e of m.lootTable!) {
        expect(e.qtyMin, `${m.key} → ${e.itemKey} qtyMin`).toBeGreaterThanOrEqual(1);
        expect(e.qtyMin, `${m.key} → ${e.itemKey} qtyMin≤Max`).toBeLessThanOrEqual(e.qtyMax);
      }
    }
  });

  it('mọi itemKey resolve qua itemByKey (no orphan ref)', () => {
    for (const m of monstersWithLootTable) {
      for (const e of m.lootTable!) {
        expect(
          itemByKey(e.itemKey),
          `${m.key} → ${e.itemKey} unresolved`,
        ).toBeDefined();
      }
    }
  });

  it('drop weight không vượt 80% probability (no single-item domination)', () => {
    for (const m of monstersWithLootTable) {
      const total = m.lootTable!.reduce((s, e) => s + e.weight, 0);
      for (const e of m.lootTable!) {
        expect(
          e.weight / total,
          `${m.key} → ${e.itemKey} weight ratio ${(e.weight / total * 100).toFixed(1)}% > 80%`,
        ).toBeLessThanOrEqual(0.8);
      }
    }
  });
});

describe('rollMonsterLoot (Phase 12.4)', () => {
  beforeEach(() => {
    vi.spyOn(Math, 'random').mockReturnValue(0);
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('unknown monsterKey → []', () => {
    expect(rollMonsterLoot('nonexistent_zzz_monster')).toEqual([]);
  });

  it('monster không có lootTable (BEAST) → []', () => {
    // son_thu_lon = BEAST, no lootTable
    expect(rollMonsterLoot('son_thu_lon')).toEqual([]);
  });

  it('monster có lootTable (BOSS) → trả entries từ lootTable', () => {
    const boss = monsterByKey('cuu_la_huyen_quan')!;
    expect(boss.lootTable).toBeDefined();
    const result = rollMonsterLoot('cuu_la_huyen_quan', 2);
    expect(result).toHaveLength(2);
    const validKeys = new Set(boss.lootTable!.map((e) => e.itemKey));
    for (const r of result) {
      expect(validKeys.has(r.itemKey), `${r.itemKey} not in boss lootTable`).toBe(true);
      expect(r.qty).toBeGreaterThanOrEqual(1);
    }
  });

  it('Math.random = 0 → first entry, qty = qtyMin', () => {
    const boss = monsterByKey('cuu_la_huyen_quan')!;
    const result = rollMonsterLoot('cuu_la_huyen_quan', 1);
    expect(result).toHaveLength(1);
    expect(result[0].itemKey).toBe(boss.lootTable![0].itemKey);
    expect(result[0].qty).toBe(boss.lootTable![0].qtyMin);
  });

  it('Math.random = 0.999 → last entry, qty near qtyMax', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.999);
    const boss = monsterByKey('cuu_la_huyen_quan')!;
    const last = boss.lootTable![boss.lootTable!.length - 1];
    const result = rollMonsterLoot('cuu_la_huyen_quan', 1);
    expect(result).toHaveLength(1);
    expect(result[0].itemKey).toBe(last.itemKey);
    expect(result[0].qty).toBeLessThanOrEqual(last.qtyMax);
    expect(result[0].qty).toBeGreaterThanOrEqual(last.qtyMin);
  });

  it('count = 0 → []', () => {
    expect(rollMonsterLoot('cuu_la_huyen_quan', 0)).toEqual([]);
  });

  it('mọi qty ∈ [qtyMin, qtyMax] cho ELITE override (50 rolls)', () => {
    vi.restoreAllMocks();
    const elite = monsterByKey('kim_dieu_thuong_phong')!;
    expect(elite.lootTable).toBeDefined();
    for (let i = 0; i < 50; i++) {
      const rolls = rollMonsterLoot('kim_dieu_thuong_phong', 3);
      for (const r of rolls) {
        const entry = elite.lootTable!.find((e) => e.itemKey === r.itemKey);
        expect(entry, `unknown ${r.itemKey}`).toBeDefined();
        expect(r.qty).toBeGreaterThanOrEqual(entry!.qtyMin);
        expect(r.qty).toBeLessThanOrEqual(entry!.qtyMax);
      }
    }
  });
});
