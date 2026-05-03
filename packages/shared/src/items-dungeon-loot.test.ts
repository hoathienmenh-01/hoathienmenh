/**
 * Tests cho `rollDungeonLoot`, `DUNGEON_LOOT`, `QUALITY_COLOR`,
 * `QUALITY_LABEL_VI` ở `packages/shared/src/items.ts`.
 *
 * Tại sao cần test:
 *   - `rollDungeonLoot` dùng Math.random — chính lý do cần lock weighted
 *     selection deterministic (stub Math.random) + qty range invariant.
 *   - `DUNGEON_LOOT` table phải toàn entry hợp lệ (weight > 0,
 *     qtyMin ≥ 1, qtyMin ≤ qtyMax, itemKey resolve).
 *   - `QUALITY_COLOR` / `QUALITY_LABEL_VI` phải cover hết 5 quality level
 *     đồng bộ với `QUALITIES` enum (regression nếu thêm Quality mới mà
 *     quên update map).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { QUALITIES } from './enums';
import {
  DUNGEON_LOOT,
  QUALITY_COLOR,
  QUALITY_LABEL_VI,
  itemByKey,
  rollDungeonLoot,
} from './items';

describe('DUNGEON_LOOT integrity', () => {
  it('có ít nhất 1 dungeon', () => {
    expect(Object.keys(DUNGEON_LOOT).length).toBeGreaterThanOrEqual(1);
  });

  it('mọi dungeon có ≥ 1 entry', () => {
    for (const [key, table] of Object.entries(DUNGEON_LOOT)) {
      expect(table.length, `dungeon ${key}`).toBeGreaterThanOrEqual(1);
    }
  });

  it('mọi entry có weight > 0', () => {
    for (const [key, table] of Object.entries(DUNGEON_LOOT)) {
      for (const e of table) {
        expect(e.weight, `${key} → ${e.itemKey}`).toBeGreaterThan(0);
      }
    }
  });

  it('mọi entry có qtyMin ≥ 1 và qtyMin ≤ qtyMax', () => {
    for (const [key, table] of Object.entries(DUNGEON_LOOT)) {
      for (const e of table) {
        expect(e.qtyMin, `${key} → ${e.itemKey} qtyMin`).toBeGreaterThanOrEqual(1);
        expect(e.qtyMin, `${key} → ${e.itemKey} qtyMin≤Max`).toBeLessThanOrEqual(e.qtyMax);
      }
    }
  });

  it('mọi itemKey resolve được qua itemByKey (no orphan ref)', () => {
    for (const [key, table] of Object.entries(DUNGEON_LOOT)) {
      for (const e of table) {
        expect(itemByKey(e.itemKey), `${key} → ${e.itemKey} unresolved`).toBeDefined();
      }
    }
  });

  describe('Phase 11.2.D+++ — skill book drop pool integration', () => {
    /**
     * Mỗi dungeon Ngũ Hành (kim_son_mach / moc_huyen_lam / thuy_long_uyen
     * / hoa_diem_son / hoang_tho_huyet) phải drop đúng `skill_book_*` cùng
     * hệ với element của dungeon (player farm dungeon đúng hệ Linh Căn để
     * học skill cùng hệ). Weight thấp (rare) — không lấn át core loot
     * (equipment / pill / material).
     *
     * Catalog metadata only ở PR này — DUNGEON_LOOT chưa wire vào reward
     * runtime (Phase 11.3.D+++ DungeonRunService sẽ wire). Test enforce
     * data integrity + naming convention + element match.
     */
    const dungeonElementBook: Record<string, string> = {
      kim_son_mach: 'skill_book_kim_quang_tram',
      moc_huyen_lam: 'skill_book_moc_linh_truong_dieu',
      thuy_long_uyen: 'skill_book_thuy_kinh_phong_an',
      hoa_diem_son: 'skill_book_hoa_xa_phun_diem',
      hoang_tho_huyet: 'skill_book_thach_giap_ho_than',
    };

    it('mọi dungeon Ngũ Hành drop đúng skill_book cùng hệ', () => {
      for (const [dungeonKey, expectedBook] of Object.entries(dungeonElementBook)) {
        const table = DUNGEON_LOOT[dungeonKey];
        expect(table, `dungeon ${dungeonKey} không tồn tại`).toBeDefined();
        const entry = table.find((e) => e.itemKey === expectedBook);
        expect(
          entry,
          `dungeon ${dungeonKey} thiếu drop ${expectedBook}`,
        ).toBeDefined();
        expect(entry!.weight, `${dungeonKey}.${expectedBook} weight`).toBeGreaterThanOrEqual(1);
        expect(entry!.qtyMin, `${dungeonKey}.${expectedBook} qtyMin`).toBe(1);
        expect(entry!.qtyMax, `${dungeonKey}.${expectedBook} qtyMax`).toBe(1);
      }
    });

    it('skill book drop weight thấp (rare ≤ 5) — không lấn át core loot', () => {
      for (const [dungeonKey, expectedBook] of Object.entries(dungeonElementBook)) {
        const entry = DUNGEON_LOOT[dungeonKey].find((e) => e.itemKey === expectedBook);
        expect(
          entry!.weight,
          `${dungeonKey}.${expectedBook} weight ${entry!.weight} > 5 (lấn át core loot)`,
        ).toBeLessThanOrEqual(5);
      }
    });

    it('dungeon early/legacy KHÔNG có skill_book leak (rarity gate)', () => {
      const allBooks = Object.values(dungeonElementBook);
      const earlyDungeons = ['son_coc', 'hac_lam', 'yeu_thu_dong'];
      for (const dungeonKey of earlyDungeons) {
        const table = DUNGEON_LOOT[dungeonKey];
        for (const book of allBooks) {
          const has = table.some((e) => e.itemKey === book);
          expect(has, `${dungeonKey} KHÔNG được drop ${book}`).toBe(false);
        }
      }
    });

    it('mỗi dungeon Ngũ Hành chỉ drop skill_book cùng hệ (element gate)', () => {
      // Cross-check: kim_son_mach KHÔNG được leak skill_book hệ khác.
      for (const [dungeonKey, expectedBook] of Object.entries(dungeonElementBook)) {
        const table = DUNGEON_LOOT[dungeonKey];
        const otherBooks = Object.values(dungeonElementBook).filter((b) => b !== expectedBook);
        for (const otherBook of otherBooks) {
          const has = table.some((e) => e.itemKey === otherBook);
          expect(
            has,
            `${dungeonKey} KHÔNG được drop ${otherBook} (chỉ ${expectedBook} hệ matching)`,
          ).toBe(false);
        }
      }
    });
  });

  describe('Phase 11.3.D++ — dungeon hậu kỳ drop linh_can_dan', () => {
    /**
     * Dungeon hậu kỳ (`cuu_la_dien` single-boss endgame instance) phải drop
     * `linh_can_dan` rare cho Linh Căn reroll supply chain. Dungeon early/mid
     * (`son_coc` / `hac_lam` / `yeu_thu_dong` / `kim_son_mach` / `moc_huyen_lam`
     * / `thuy_long_uyen` / `hoa_diem_son` / `hoang_tho_huyet`) KHÔNG được leak.
     */
    it('cuu_la_dien drop linh_can_dan với weight ≥ 1', () => {
      const entry = DUNGEON_LOOT.cuu_la_dien.find(
        (e) => e.itemKey === 'linh_can_dan',
      );
      expect(entry, 'cuu_la_dien phải có linh_can_dan entry').toBeDefined();
      expect(entry!.weight).toBeGreaterThanOrEqual(1);
      expect(entry!.qtyMin).toBe(1);
      expect(entry!.qtyMax).toBe(1);
    });

    it('dungeon early/mid KHÔNG có linh_can_dan (rarity gate)', () => {
      const earlyDungeons = [
        'son_coc',
        'hac_lam',
        'yeu_thu_dong',
        'kim_son_mach',
        'moc_huyen_lam',
        'thuy_long_uyen',
        'hoa_diem_son',
        'hoang_tho_huyet',
      ];
      for (const key of earlyDungeons) {
        const table = DUNGEON_LOOT[key];
        expect(table, `dungeon ${key} không tồn tại`).toBeDefined();
        const has = table.some((e) => e.itemKey === 'linh_can_dan');
        expect(has, `${key} KHÔNG được drop linh_can_dan`).toBe(false);
      }
    });
  });
});

describe('rollDungeonLoot', () => {
  beforeEach(() => {
    // Stub Math.random — default 0 → luôn chọn entry đầu, qty = qtyMin.
    vi.spyOn(Math, 'random').mockReturnValue(0);
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('dungeon không tồn tại → []', () => {
    expect(rollDungeonLoot('nonexistent_dungeon_xyz')).toEqual([]);
  });

  it('default count = 2 → 2 entries', () => {
    const r = rollDungeonLoot('son_coc');
    expect(r).toHaveLength(2);
  });

  it('count = 5 → 5 entries', () => {
    const r = rollDungeonLoot('son_coc', 5);
    expect(r).toHaveLength(5);
  });

  it('count = 0 → []', () => {
    expect(rollDungeonLoot('son_coc', 0)).toEqual([]);
  });

  it('Math.random = 0 → chọn entry đầu của table với qty = qtyMin', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);
    const r = rollDungeonLoot('son_coc', 1);
    expect(r).toHaveLength(1);
    const firstEntry = DUNGEON_LOOT.son_coc[0];
    expect(r[0].itemKey).toBe(firstEntry.itemKey);
    // count=1, Math.random=0 → qty = qtyMin + floor(0 * range) = qtyMin
    expect(r[0].qty).toBe(firstEntry.qtyMin);
  });

  it('Math.random = 0.999 → chọn entry cuối table và qty gần qtyMax', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.999);
    const r = rollDungeonLoot('son_coc', 1);
    expect(r).toHaveLength(1);
    const lastEntry = DUNGEON_LOOT.son_coc[DUNGEON_LOOT.son_coc.length - 1];
    expect(r[0].itemKey).toBe(lastEntry.itemKey);
    expect(r[0].qty).toBeLessThanOrEqual(lastEntry.qtyMax);
    expect(r[0].qty).toBeGreaterThanOrEqual(lastEntry.qtyMin);
  });

  it('mọi qty trả về ∈ [qtyMin, qtyMax] của entry tương ứng', () => {
    vi.restoreAllMocks();
    // Giả lập 100 roll thật (no mock) cho từng dungeon, kiểm tra qty range.
    for (const dungeonKey of Object.keys(DUNGEON_LOOT)) {
      for (let i = 0; i < 50; i++) {
        const rolls = rollDungeonLoot(dungeonKey, 3);
        for (const got of rolls) {
          const def = DUNGEON_LOOT[dungeonKey].find((e) => e.itemKey === got.itemKey);
          expect(def, `dungeon ${dungeonKey} produced unknown ${got.itemKey}`).toBeDefined();
          expect(got.qty).toBeGreaterThanOrEqual(def!.qtyMin);
          expect(got.qty).toBeLessThanOrEqual(def!.qtyMax);
        }
      }
    }
  });

  it('mọi itemKey trả về thuộc table của dungeon (no leak)', () => {
    vi.restoreAllMocks();
    for (const dungeonKey of Object.keys(DUNGEON_LOOT)) {
      const validKeys = new Set(DUNGEON_LOOT[dungeonKey].map((e) => e.itemKey));
      for (let i = 0; i < 30; i++) {
        const rolls = rollDungeonLoot(dungeonKey, 4);
        for (const got of rolls) {
          expect(validKeys.has(got.itemKey)).toBe(true);
        }
      }
    }
  });
});

describe('QUALITY_COLOR + QUALITY_LABEL_VI parity', () => {
  it('QUALITY_COLOR phủ hết QUALITIES', () => {
    for (const q of QUALITIES) {
      expect(QUALITY_COLOR[q], `missing color for ${q}`).toBeTruthy();
    }
  });

  it('QUALITY_LABEL_VI phủ hết QUALITIES', () => {
    for (const q of QUALITIES) {
      expect(QUALITY_LABEL_VI[q], `missing label for ${q}`).toBeTruthy();
    }
  });

  it('QUALITY_COLOR không có key thừa (so với QUALITIES)', () => {
    const colorKeys = Object.keys(QUALITY_COLOR).sort();
    expect(colorKeys).toEqual([...QUALITIES].sort());
  });

  it('QUALITY_LABEL_VI không có key thừa (so với QUALITIES)', () => {
    const labelKeys = Object.keys(QUALITY_LABEL_VI).sort();
    expect(labelKeys).toEqual([...QUALITIES].sort());
  });

  it('QUALITY_COLOR là Tailwind text-* class (sanity prefix)', () => {
    for (const q of QUALITIES) {
      expect(QUALITY_COLOR[q]).toMatch(/^text-/);
    }
  });
});
