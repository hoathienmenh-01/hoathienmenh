/**
 * Phase 14.3.B — Tribulation Support Providers tests.
 *
 * Cover:
 *   - collectItemTribulationSupports: pill (PHẨM HUYEN/TIEN) trong túi → entry;
 *     equipped không count; qty 0 / unknown skip; dedup theo itemKey.
 *   - collectEquipmentTribulationSupports: pháp bảo equip → entry; non-equipped
 *     không count.
 *   - collectBuffTribulationSupports: buff `tribulationSupport` > 0 → entry,
 *     stacks multiply, clamp per-entry; debuff `< 0` → entry âm clamp; legacy
 *     buff không có field → skip.
 *   - collectTalentTribulationSupports: passive `element_resist` matching wave
 *     → entry; null wave → empty; non-matching element skip.
 *
 * Pure data — không cần Prisma / Nest.
 */

import { describe, expect, it } from 'vitest';
import {
  TRIBULATION_SUPPORT_PER_ENTRY_CEIL,
  collectBuffTribulationSupports,
  collectEquipmentTribulationSupports,
  collectItemTribulationSupports,
  collectTalentTribulationSupports,
  composeTribulationSupports,
} from './index';

describe('Phase 14.3.B — collectItemTribulationSupports', () => {
  it('inventory có Thuận Kiếp Đan (qty=2, unequipped) → 1 entry +0.05', () => {
    const entries = collectItemTribulationSupports([
      { itemKey: 'thuan_kiep_dan', qty: 2, equippedSlot: null },
    ]);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      source: 'item',
      key: 'thuan_kiep_dan',
      bonus: 0.05,
    });
    expect(entries[0].label).toBe('Thuận Kiếp Đan');
  });

  it('equipped item KHÔNG xét trong item provider (xét ở equipment provider)', () => {
    const entries = collectItemTribulationSupports([
      { itemKey: 'ho_kiep_phu', qty: 1, equippedSlot: 'ARTIFACT_2' },
    ]);
    expect(entries).toEqual([]);
  });

  it('item không có tribulationSupport → skip', () => {
    const entries = collectItemTribulationSupports([
      { itemKey: 'so_kiem', qty: 1, equippedSlot: null },
      { itemKey: 'tieu_phuc_dan', qty: 5, equippedSlot: null },
    ]);
    expect(entries).toEqual([]);
  });

  it('item key không tồn tại trong catalog → skip', () => {
    const entries = collectItemTribulationSupports([
      { itemKey: 'unknown_item_xyz', qty: 1, equippedSlot: null },
    ]);
    expect(entries).toEqual([]);
  });

  it('qty <= 0 → skip', () => {
    const entries = collectItemTribulationSupports([
      { itemKey: 'thuan_kiep_dan', qty: 0, equippedSlot: null },
    ]);
    expect(entries).toEqual([]);
  });

  it('dedup: 2 row cùng itemKey → 1 entry (single-use convention)', () => {
    const entries = collectItemTribulationSupports([
      { itemKey: 'thuan_kiep_dan', qty: 1, equippedSlot: null },
      { itemKey: 'thuan_kiep_dan', qty: 3, equippedSlot: null },
    ]);
    expect(entries).toHaveLength(1);
    expect(entries[0].bonus).toBe(0.05);
  });

  it('mix nhiều loại pill — chỉ surface những cái có support', () => {
    const entries = collectItemTribulationSupports([
      { itemKey: 'thuan_kiep_dan', qty: 1, equippedSlot: null },
      { itemKey: 'tu_kiep_dan', qty: 2, equippedSlot: null },
      { itemKey: 'tieu_phuc_dan', qty: 10, equippedSlot: null },
    ]);
    expect(entries).toHaveLength(2);
    expect(entries.map((e) => e.key).sort()).toEqual([
      'thuan_kiep_dan',
      'tu_kiep_dan',
    ]);
  });
});

describe('Phase 14.3.B — collectEquipmentTribulationSupports', () => {
  it('Hộ Kiếp Phù equipped → 1 entry +0.06', () => {
    const entries = collectEquipmentTribulationSupports([
      { itemKey: 'ho_kiep_phu', qty: 1, equippedSlot: 'ARTIFACT_2' },
    ]);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      source: 'equipment',
      key: 'ho_kiep_phu',
      bonus: 0.06,
    });
  });

  it('item trong túi (equippedSlot=null) KHÔNG count', () => {
    const entries = collectEquipmentTribulationSupports([
      { itemKey: 'ho_kiep_phu', qty: 1, equippedSlot: null },
    ]);
    expect(entries).toEqual([]);
  });

  it('equipped item không có tribulationSupport → skip', () => {
    const entries = collectEquipmentTribulationSupports([
      { itemKey: 'so_kiem', qty: 1, equippedSlot: 'WEAPON' },
      { itemKey: 'pham_giap', qty: 1, equippedSlot: 'ARMOR' },
    ]);
    expect(entries).toEqual([]);
  });
});

describe('Phase 14.3.B — collectBuffTribulationSupports', () => {
  it('Thuận Kiếp Đan Ấn buff active → 1 entry +0.05', () => {
    const entries = collectBuffTribulationSupports([
      { buffKey: 'thuan_kiep_dan_aura', stacks: 1 },
    ]);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      source: 'buff',
      key: 'thuan_kiep_dan_aura',
      bonus: 0.05,
    });
  });

  it('legacy buff không có tribulationSupport → skip', () => {
    const entries = collectBuffTribulationSupports([
      { buffKey: 'pill_atk_buff_t1', stacks: 1 },
      { buffKey: 'sect_aura_kim', stacks: 1 },
    ]);
    expect(entries).toEqual([]);
  });

  it('unknown buffKey → skip', () => {
    const entries = collectBuffTribulationSupports([
      { buffKey: 'unknown_buff', stacks: 1 },
    ]);
    expect(entries).toEqual([]);
  });

  it('stacks=0 → skip', () => {
    const entries = collectBuffTribulationSupports([
      { buffKey: 'thuan_kiep_dan_aura', stacks: 0 },
    ]);
    expect(entries).toEqual([]);
  });

  it('stacks multiply but clamp ≤ per-entry ceil 0.1', () => {
    // Với perStack=0.05, stacks=5 → raw=0.25 > per-entry 0.10 → clamp về 0.10.
    const entries = collectBuffTribulationSupports([
      { buffKey: 'thuan_kiep_dan_aura', stacks: 5 },
    ]);
    expect(entries).toHaveLength(1);
    expect(entries[0].bonus).toBe(TRIBULATION_SUPPORT_PER_ENTRY_CEIL);
  });
});

describe('Phase 14.3.B — collectTalentTribulationSupports', () => {
  it('learned talent element_resist khớp wave element → entry positive', () => {
    // talent_kim_thien_giap: element_resist value=0.95 cho `kim` → 0.05.
    const entries = collectTalentTribulationSupports(
      ['talent_kim_thien_giap'],
      ['kim', 'thuy'],
    );
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      source: 'talent',
      key: 'talent_kim_thien_giap',
      element: 'kim',
    });
    expect(entries[0].bonus).toBeCloseTo(0.05);
  });

  it('waveElements rỗng / toàn null (Tâm kiếp) → empty', () => {
    expect(
      collectTalentTribulationSupports(['talent_kim_thien_giap'], []),
    ).toEqual([]);
    expect(
      collectTalentTribulationSupports(
        ['talent_kim_thien_giap'],
        [null, null],
      ),
    ).toEqual([]);
  });

  it('non-matching element → skip', () => {
    const entries = collectTalentTribulationSupports(
      ['talent_kim_thien_giap'],
      ['thuy', 'hoa'],
    );
    expect(entries).toEqual([]);
  });

  it('unknown talent key → skip', () => {
    const entries = collectTalentTribulationSupports(
      ['unknown_talent_xyz'],
      ['kim'],
    );
    expect(entries).toEqual([]);
  });

  it('dedup talent key dù waveElements có duplicate', () => {
    const entries = collectTalentTribulationSupports(
      ['talent_kim_thien_giap'],
      ['kim', 'kim', 'kim'],
    );
    expect(entries).toHaveLength(1);
  });

  it('multi-talent multi-element — surface tất cả match', () => {
    const entries = collectTalentTribulationSupports(
      ['talent_kim_thien_giap', 'talent_thuy_thien_giap'],
      ['kim', 'thuy'],
    );
    expect(entries).toHaveLength(2);
    const keys = entries.map((e) => e.key).sort();
    expect(keys).toEqual(['talent_kim_thien_giap', 'talent_thuy_thien_giap']);
  });
});

describe('Phase 14.3.B — providers compose hợp lệ', () => {
  it('item + equipment + buff → composeTribulationSupports tổng cộng cap totalCeil 0.30', () => {
    const items = collectItemTribulationSupports([
      { itemKey: 'thuan_kiep_dan', qty: 1, equippedSlot: null }, // +0.05
      { itemKey: 'tu_kiep_dan', qty: 1, equippedSlot: null }, // +0.08
    ]);
    const equip = collectEquipmentTribulationSupports([
      { itemKey: 'ho_kiep_phu', qty: 1, equippedSlot: 'ARTIFACT_2' }, // +0.06
    ]);
    const buffs = collectBuffTribulationSupports([
      { buffKey: 'thuan_kiep_dan_aura', stacks: 1 }, // +0.05
    ]);
    const composed = composeTribulationSupports([...items, ...equip, ...buffs]);
    // 0.05 + 0.08 + 0.06 + 0.05 = 0.24, dưới total cap 0.30 → giữ raw.
    expect(composed.totalBonus).toBeCloseTo(0.24);
    expect(composed.totalCapHit).toBe(false);
    expect(composed.perEntryCapHit).toBe(false);
    expect(composed.entries).toHaveLength(4);
  });

  it('stack lớn vượt total cap 0.30 → clamp về total ceil', () => {
    // Mỗi buff entry sau pre-clamp = 0.10 (5 stacks × 0.05 = 0.25 → clamp 0.10).
    // 4 buff entry × 0.10 = 0.40, cộng item 0.08 = 0.48 → clamp về 0.30.
    const items = [
      { itemKey: 'tu_kiep_dan', qty: 1, equippedSlot: null },
    ];
    const buffEntries = [
      ...collectBuffTribulationSupports([
        { buffKey: 'thuan_kiep_dan_aura', stacks: 5 },
      ]),
      ...collectBuffTribulationSupports([
        { buffKey: 'thuan_kiep_dan_aura', stacks: 5 },
      ]),
      ...collectBuffTribulationSupports([
        { buffKey: 'thuan_kiep_dan_aura', stacks: 5 },
      ]),
      ...collectBuffTribulationSupports([
        { buffKey: 'thuan_kiep_dan_aura', stacks: 5 },
      ]),
    ];
    const composed = composeTribulationSupports([
      ...collectItemTribulationSupports(items),
      ...buffEntries,
    ]);
    expect(composed.totalBonus).toBeCloseTo(0.3);
    expect(composed.totalCapHit).toBe(true);
  });
});
