import { describe, it, expect } from 'vitest';
import {
  NPC_SHOP,
  npcShopEntries,
  npcShopByKey,
  toShopEntryView,
} from './shop';
import { ITEMS } from './items';

/**
 * NPC_SHOP catalog integrity tests (session 9j task N):
 * economy-safety guardrail. Regression trong shop catalog có thể làm mất
 * price, mismatch currency, hoặc trỏ itemKey không tồn tại trong ITEMS.
 */

describe('NPC_SHOP catalog integrity', () => {
  it('tất cả entries có itemKey trỏ tới ITEMS hợp lệ (no dangling refs)', () => {
    const itemKeys = new Set(ITEMS.map((i) => i.key));
    for (const entry of NPC_SHOP) {
      expect(itemKeys.has(entry.itemKey), `shop entry ${entry.itemKey} not in ITEMS`).toBe(
        true,
      );
    }
  });

  it('tất cả entries có currency LINH_THACH hoặc TIEN_NGOC', () => {
    for (const entry of NPC_SHOP) {
      expect(['LINH_THACH', 'TIEN_NGOC']).toContain(entry.currency);
    }
  });

  it('itemKey unique (no duplicate entry)', () => {
    const keys = NPC_SHOP.map((e) => e.itemKey);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('override price (nếu có) > 0', () => {
    for (const entry of NPC_SHOP) {
      if (entry.price !== undefined) {
        expect(entry.price, `${entry.itemKey} has non-positive override price`).toBeGreaterThan(0);
      }
    }
  });

  it('M10 — dailyLimit (nếu có) là integer dương', () => {
    for (const entry of NPC_SHOP) {
      if (entry.dailyLimit !== undefined) {
        expect(
          Number.isInteger(entry.dailyLimit),
          `${entry.itemKey} dailyLimit must be integer`,
        ).toBe(true);
        expect(
          entry.dailyLimit,
          `${entry.itemKey} dailyLimit must be > 0`,
        ).toBeGreaterThan(0);
      }
    }
  });

  it('M10 — beta closed: tất cả entries đều có dailyLimit (anti-hoard)', () => {
    for (const entry of NPC_SHOP) {
      expect(
        entry.dailyLimit,
        `${entry.itemKey} should have dailyLimit during closed beta`,
      ).toBeDefined();
    }
  });
});

describe('npcShopEntries()', () => {
  it('trả về ShopEntryWithDef với price hiệu dụng (override hoặc ItemDef.price)', () => {
    const entries = npcShopEntries();
    expect(entries.length).toBe(NPC_SHOP.length);
    for (const x of entries) {
      expect(x.def.key).toBe(x.entry.itemKey);
      expect(x.price).toBe(x.entry.price ?? x.def.price);
      expect(x.price).toBeGreaterThan(0);
    }
  });

  it('không bao giờ có entry trỏ tới itemKey không tồn tại trong ITEMS', () => {
    const entries = npcShopEntries();
    const itemKeys = new Set(ITEMS.map((i) => i.key));
    for (const x of entries) {
      expect(itemKeys.has(x.def.key)).toBe(true);
    }
  });
});

describe('npcShopByKey()', () => {
  it('resolve known itemKey', () => {
    const soKiem = npcShopByKey('so_kiem');
    expect(soKiem).toBeDefined();
    expect(soKiem?.def.name).toBe('Sơ Kiếm');
  });

  it('returns undefined cho unknown key', () => {
    expect(npcShopByKey('void_dragon_xyz')).toBeUndefined();
  });
});

describe('toShopEntryView()', () => {
  it('map ShopEntryWithDef → ShopEntryView với đúng fields', () => {
    const entries = npcShopEntries();
    const view = toShopEntryView(entries[0]);
    expect(view.itemKey).toBe(entries[0].def.key);
    expect(view.name).toBe(entries[0].def.name);
    expect(view.price).toBe(entries[0].price);
    expect(view.currency).toBe(entries[0].entry.currency);
    expect(view.stackable).toBe(entries[0].def.stackable);
  });

  it('M10 — dailyLimit map đúng (number hoặc null)', () => {
    const entries = npcShopEntries();
    for (const x of entries) {
      const view = toShopEntryView(x);
      if (x.entry.dailyLimit === undefined) {
        expect(view.dailyLimit).toBeNull();
      } else {
        expect(view.dailyLimit).toBe(x.entry.dailyLimit);
      }
    }
  });
});
