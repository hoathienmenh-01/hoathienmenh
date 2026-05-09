import { describe, expect, it } from 'vitest';
import {
  buildSelectedSupportItemEntries,
  composeTribulationSupports,
  isTribulationSupportConsumable,
  itemByKey,
  listTribulationSupportConsumables,
  TRIBULATION_MAX_SELECTED_SUPPORT_ITEMS,
  TRIBULATION_SUPPORT_TOTAL_CEIL,
  validateTribulationSupportSelection,
} from './index';

describe('Phase 14.3.C — listTribulationSupportConsumables', () => {
  it('catalog có Thuận Kiếp Đan + Tử Kiếp Đan (cả 2 PILL_HP có tribulationSupport > 0)', () => {
    const list = listTribulationSupportConsumables();
    const keys = list.map((d) => d.key);
    expect(keys).toContain('thuan_kiep_dan');
    expect(keys).toContain('tu_kiep_dan');
  });

  it('Hộ Kiếp Phù (ARTIFACT slot=ARTIFACT_2) bị loại — equipment không phải consumable', () => {
    const list = listTribulationSupportConsumables();
    const keys = list.map((d) => d.key);
    expect(keys).not.toContain('ho_kiep_phu');
  });

  it('sort theo bonus DESC, fallback key ASC — Tử Kiếp Đan (0.08) trước Thuận Kiếp Đan (0.05)', () => {
    const list = listTribulationSupportConsumables();
    const idxTu = list.findIndex((d) => d.key === 'tu_kiep_dan');
    const idxThuan = list.findIndex((d) => d.key === 'thuan_kiep_dan');
    expect(idxTu).toBeGreaterThanOrEqual(0);
    expect(idxThuan).toBeGreaterThanOrEqual(0);
    expect(idxTu).toBeLessThan(idxThuan);
  });

  it('mọi item trong list đều có bonuses.tribulationSupport > 0 + slot undefined', () => {
    const list = listTribulationSupportConsumables();
    for (const def of list) {
      expect(def.slot).toBeUndefined();
      const bonus = def.bonuses?.tribulationSupport;
      expect(typeof bonus).toBe('number');
      expect(bonus).toBeGreaterThan(0);
    }
  });
});

describe('Phase 14.3.C — isTribulationSupportConsumable', () => {
  it('Thuận Kiếp Đan (PILL_HP, +0.05) → true', () => {
    expect(isTribulationSupportConsumable('thuan_kiep_dan')).toBe(true);
  });

  it('Tử Kiếp Đan (PILL_HP, +0.08) → true', () => {
    expect(isTribulationSupportConsumable('tu_kiep_dan')).toBe(true);
  });

  it('Hộ Kiếp Phù (equipment ARTIFACT_2) → false', () => {
    expect(isTribulationSupportConsumable('ho_kiep_phu')).toBe(false);
  });

  it('Linh Lộ Đan (PILL_MP, no tribulationSupport) → false', () => {
    expect(isTribulationSupportConsumable('linh_lo_dan')).toBe(false);
  });

  it('itemKey không tồn tại → false (catalog drift safe)', () => {
    expect(isTribulationSupportConsumable('khong_ton_tai_xxx')).toBe(false);
  });
});

describe('Phase 14.3.C — validateTribulationSupportSelection', () => {
  it('empty selection → ok với entries rỗng (player attempt không dùng item nào)', () => {
    const r = validateTribulationSupportSelection([]);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.entries).toEqual([]);
  });

  it('1 valid item → ok với 1 entry, bonus đúng từ catalog', () => {
    const r = validateTribulationSupportSelection(['thuan_kiep_dan']);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.entries).toHaveLength(1);
      expect(r.entries[0].source).toBe('item');
      expect(r.entries[0].key).toBe('thuan_kiep_dan');
      expect(r.entries[0].bonus).toBeCloseTo(0.05);
    }
  });

  it('multiple valid items → ok với entries theo thứ tự input', () => {
    const r = validateTribulationSupportSelection([
      'tu_kiep_dan',
      'thuan_kiep_dan',
    ]);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.entries.map((e) => e.key)).toEqual([
        'tu_kiep_dan',
        'thuan_kiep_dan',
      ]);
    }
  });

  it('non-array input → INVALID_INPUT', () => {
    const r = validateTribulationSupportSelection(
      'not-array' as unknown as readonly unknown[],
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('INVALID_INPUT');
  });

  it('non-string element → INVALID_INPUT', () => {
    const r = validateTribulationSupportSelection([123 as unknown as string]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('INVALID_INPUT');
  });

  it('empty-string element → INVALID_INPUT', () => {
    const r = validateTribulationSupportSelection(['']);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('INVALID_INPUT');
  });

  it('duplicate key → DUPLICATE_SELECTED', () => {
    const r = validateTribulationSupportSelection([
      'thuan_kiep_dan',
      'thuan_kiep_dan',
    ]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('DUPLICATE_SELECTED');
  });

  it('quá MAX selected (4 items) → TOO_MANY_SELECTED', () => {
    expect(TRIBULATION_MAX_SELECTED_SUPPORT_ITEMS).toBe(3);
    const tooMany = ['a', 'b', 'c', 'd'];
    const r = validateTribulationSupportSelection(tooMany);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('TOO_MANY_SELECTED');
  });

  it('item không tồn tại catalog → INVALID_SUPPORT_ITEM', () => {
    const r = validateTribulationSupportSelection(['khong_ton_tai_xxx']);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('INVALID_SUPPORT_ITEM');
  });

  it('equipment Hộ Kiếp Phù → INVALID_SUPPORT_ITEM (không cho consume equipment)', () => {
    const r = validateTribulationSupportSelection(['ho_kiep_phu']);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('INVALID_SUPPORT_ITEM');
  });

  it('item không có tribulationSupport bonus → INVALID_SUPPORT_ITEM', () => {
    const r = validateTribulationSupportSelection(['linh_lo_dan']);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('INVALID_SUPPORT_ITEM');
  });
});

describe('Phase 14.3.C — buildSelectedSupportItemEntries (server trusted)', () => {
  it('build entries với bonus từ catalog (KHÔNG tin client value)', () => {
    const entries = buildSelectedSupportItemEntries([
      'thuan_kiep_dan',
      'tu_kiep_dan',
    ]);
    expect(entries).toHaveLength(2);
    expect(entries[0].bonus).toBeCloseTo(0.05);
    expect(entries[1].bonus).toBeCloseTo(0.08);
    // Catalog name fallthrough cho label.
    expect(entries[0].label).toBe(itemByKey('thuan_kiep_dan')?.name);
  });

  it('throw nếu catalog drift (key không hợp lệ)', () => {
    expect(() =>
      buildSelectedSupportItemEntries(['khong_ton_tai_xxx']),
    ).toThrow();
  });
});

describe('Phase 14.3.C — total support cap qua composeTribulationSupports', () => {
  it('chọn 3 item × 0.10 → total cap về 0.30', () => {
    // Build entries trực tiếp với bonus tối đa per-entry (0.10) — không
    // tồn tại item nào trong catalog có bonus 0.10 hiện tại nhưng helper
    // pure foundation đã clamp.
    const entries = [
      { source: 'item' as const, key: 'a', bonus: 0.1 },
      { source: 'item' as const, key: 'b', bonus: 0.1 },
      { source: 'item' as const, key: 'c', bonus: 0.1 },
    ];
    const composed = composeTribulationSupports(entries);
    expect(composed.totalBonus).toBeCloseTo(TRIBULATION_SUPPORT_TOTAL_CEIL);
    expect(composed.totalCapHit).toBe(true);
  });

  it('chọn Thuận Kiếp Đan + Tử Kiếp Đan → total = 0.13 (chưa cap)', () => {
    const entries = buildSelectedSupportItemEntries([
      'thuan_kiep_dan',
      'tu_kiep_dan',
    ]);
    const composed = composeTribulationSupports(entries);
    expect(composed.totalBonus).toBeCloseTo(0.13);
    expect(composed.totalCapHit).toBe(false);
  });
});
