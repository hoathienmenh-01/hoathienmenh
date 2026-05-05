import { describe, it, expect } from 'vitest';
import {
  MAP_REGIONS,
  REGION_KEYS,
  getMapRegionByKey,
  isMapRegionKey,
  regionsUnlockedAtRealmOrder,
  regionsByDominantElement,
  type RegionKey,
  type MapRegionDef,
} from './map-regions';
import { ELEMENTS, type ElementKey, MONSTERS, DUNGEONS } from './combat';
import { BOSSES } from './boss';
import { MISSIONS } from './missions';
import { REALMS } from './realms';

const REALM_KEYS = new Set(REALMS.map((r) => r.key));
const REGION_KEY_SET: ReadonlySet<RegionKey> = new Set<RegionKey>(REGION_KEYS);

/**
 * MAP_REGIONS catalog — Phase 12.1 catalog foundation.
 * Bound các invariant về key uniqueness, sortOrder monotonic, vi/en
 * parity, unlockRealmKey ∈ REALMS, no orphan regions, cross-catalog
 * parity với MONSTERS / DUNGEONS / BOSSES / MISSIONS regionKey usage.
 */

describe('MAP_REGIONS catalog (Phase 12.1)', () => {
  describe('catalog shape', () => {
    it('total region count >= 8 (Phase 12.1 baseline)', () => {
      expect(MAP_REGIONS.length).toBeGreaterThanOrEqual(8);
    });

    it('total region count ≤ 12 (Phase 12 §12.1 cap "8-12 region")', () => {
      expect(MAP_REGIONS.length).toBeLessThanOrEqual(12);
    });

    it('REGION_KEYS array có cùng length với MAP_REGIONS', () => {
      expect(REGION_KEYS.length).toBe(MAP_REGIONS.length);
    });

    it('mỗi region có key unique (no duplicates)', () => {
      const keys = new Set<RegionKey>();
      for (const r of MAP_REGIONS) {
        expect(keys.has(r.key), `duplicate key: ${r.key}`).toBe(false);
        keys.add(r.key);
      }
    });

    it('REGION_KEYS array khớp 1:1 với MAP_REGIONS keys', () => {
      const fromCatalog = new Set(MAP_REGIONS.map((r) => r.key));
      const fromArray = new Set(REGION_KEYS);
      for (const k of fromCatalog) {
        expect(fromArray.has(k), `REGION_KEYS thiếu ${k}`).toBe(true);
      }
      for (const k of fromArray) {
        expect(fromCatalog.has(k), `MAP_REGIONS thiếu ${k}`).toBe(true);
      }
    });

    it('mỗi region có required field non-empty', () => {
      for (const r of MAP_REGIONS) {
        expect(r.key.length, `${r.key} key empty`).toBeGreaterThan(0);
        expect(r.nameVi.length, `${r.key} nameVi empty`).toBeGreaterThan(0);
        expect(r.nameEn.length, `${r.key} nameEn empty`).toBeGreaterThan(0);
        expect(r.flavorVi.length, `${r.key} flavorVi empty`).toBeGreaterThan(0);
        expect(r.flavorEn.length, `${r.key} flavorEn empty`).toBeGreaterThan(0);
      }
    });

    it('flavor text ≤ 320 ký tự (UI tooltip cap)', () => {
      for (const r of MAP_REGIONS) {
        expect(r.flavorVi.length, `${r.key} flavorVi too long`).toBeLessThanOrEqual(320);
        expect(r.flavorEn.length, `${r.key} flavorEn too long`).toBeLessThanOrEqual(320);
      }
    });

    it('mỗi region có unlockRealmKey ∈ REALMS keys', () => {
      for (const r of MAP_REGIONS) {
        expect(
          REALM_KEYS.has(r.unlockRealmKey),
          `${r.key} unlockRealmKey=${r.unlockRealmKey} không tồn tại trong REALMS`,
        ).toBe(true);
      }
    });

    it('mỗi region có dominantElement ∈ ELEMENTS hoặc null', () => {
      for (const r of MAP_REGIONS) {
        if (r.dominantElement !== null) {
          expect(
            ELEMENTS.includes(r.dominantElement),
            `${r.key} dominantElement=${r.dominantElement} không trong ELEMENTS`,
          ).toBe(true);
        }
      }
    });
  });

  describe('sortOrder invariant', () => {
    it('sortOrder unique (no duplicates)', () => {
      const orders = new Set<number>();
      for (const r of MAP_REGIONS) {
        expect(
          orders.has(r.sortOrder),
          `duplicate sortOrder ${r.sortOrder} on ${r.key}`,
        ).toBe(false);
        orders.add(r.sortOrder);
      }
    });

    it('sortOrder ≥ 1 (1-based UI list)', () => {
      for (const r of MAP_REGIONS) {
        expect(r.sortOrder, `${r.key} sortOrder must be ≥ 1`).toBeGreaterThanOrEqual(1);
      }
    });

    it('sortOrder consecutive starting at 1 — không skip number', () => {
      const orders = MAP_REGIONS.map((r) => r.sortOrder).sort((a, b) => a - b);
      for (let i = 0; i < orders.length; i++) {
        expect(
          orders[i],
          `sortOrder gap at index ${i}: expected ${i + 1}, got ${orders[i]}`,
        ).toBe(i + 1);
      }
    });

    it('sortOrder phải tăng theo unlockRealm.order (early → late)', () => {
      // sortOrder asc → unlockRealmKey order asc (cho phép tie cùng realm)
      const realmOrderByKey = new Map<string, number>();
      for (const realm of REALMS) realmOrderByKey.set(realm.key, realm.order);
      const sorted = [...MAP_REGIONS].sort((a, b) => a.sortOrder - b.sortOrder);
      let prevRealmOrder = -1;
      for (const r of sorted) {
        const realmOrder = realmOrderByKey.get(r.unlockRealmKey)!;
        expect(
          realmOrder,
          `${r.key} unlockRealm ${r.unlockRealmKey} order regression (sortOrder ${r.sortOrder})`,
        ).toBeGreaterThanOrEqual(prevRealmOrder);
        prevRealmOrder = realmOrder;
      }
    });
  });

  describe('vi/en parity', () => {
    it('mọi region có nameVi khác nameEn (avoid placeholder copy-paste)', () => {
      for (const r of MAP_REGIONS) {
        expect(
          r.nameVi.toLowerCase(),
          `${r.key} nameVi và nameEn identical (placeholder)`,
        ).not.toBe(r.nameEn.toLowerCase());
      }
    });

    it('mọi region có flavorVi khác flavorEn (avoid placeholder copy-paste)', () => {
      for (const r of MAP_REGIONS) {
        expect(
          r.flavorVi,
          `${r.key} flavorVi và flavorEn identical (placeholder)`,
        ).not.toBe(r.flavorEn);
      }
    });
  });

  describe('element coverage', () => {
    it('mỗi element Ngũ Hành (kim/moc/thuy/hoa/tho) có ≥ 1 region dominant', () => {
      for (const elem of ELEMENTS as readonly ElementKey[]) {
        const list = regionsByDominantElement(elem);
        expect(
          list.length,
          `element ${elem} không có region dominant — coverage gap`,
        ).toBeGreaterThanOrEqual(1);
      }
    });
  });
});

describe('MAP_REGIONS helpers', () => {
  describe('getMapRegionByKey', () => {
    it('return MapRegionDef cho key tồn tại', () => {
      const r = getMapRegionByKey('son_coc');
      expect(r).toBeDefined();
      expect(r?.key).toBe('son_coc');
      expect(r?.nameVi).toBe('Sơn Cốc');
    });

    it('return undefined cho key không tồn tại', () => {
      expect(getMapRegionByKey('khong_ton_tai')).toBeUndefined();
      expect(getMapRegionByKey('')).toBeUndefined();
    });
  });

  describe('isMapRegionKey', () => {
    it('return true cho key trong REGION_KEYS', () => {
      for (const k of REGION_KEYS) {
        expect(isMapRegionKey(k), `${k} should be valid`).toBe(true);
      }
    });

    it('return false cho key không tồn tại', () => {
      expect(isMapRegionKey('khong_ton_tai')).toBe(false);
      expect(isMapRegionKey('')).toBe(false);
      expect(isMapRegionKey('SON_COC')).toBe(false); // case-sensitive
    });
  });

  describe('regionsUnlockedAtRealmOrder', () => {
    it('phamnhan (order 0) chưa unlock region nào', () => {
      const list = regionsUnlockedAtRealmOrder(0, REALMS);
      expect(list.length).toBe(0);
    });

    it('luyenkhi (order 1) unlock đúng region son_coc', () => {
      const list = regionsUnlockedAtRealmOrder(1, REALMS);
      const keys = list.map((r) => r.key);
      expect(keys).toContain('son_coc');
      expect(keys).not.toContain('hac_lam'); // truc_co order 2
      expect(keys).not.toContain('cuu_la_dien'); // hoa_than order 5
    });

    it('kim_dan (order 3) unlock son_coc + truc_co + kim_dan tier', () => {
      const list = regionsUnlockedAtRealmOrder(3, REALMS);
      const keys = list.map((r) => r.key);
      expect(keys).toContain('son_coc'); // luyenkhi 1
      expect(keys).toContain('hac_lam'); // truc_co 2
      expect(keys).toContain('kim_son_mach'); // kim_dan 3
      expect(keys).not.toContain('hoa_diem_son'); // nguyen_anh 4
    });

    it('hoa_than (order 5) unlock toàn bộ region', () => {
      const list = regionsUnlockedAtRealmOrder(5, REALMS);
      expect(list.length).toBe(MAP_REGIONS.length);
    });

    it('return list đã sort theo sortOrder asc', () => {
      const list = regionsUnlockedAtRealmOrder(99, REALMS);
      for (let i = 1; i < list.length; i++) {
        expect(
          list[i].sortOrder,
          `sortOrder regression at index ${i}`,
        ).toBeGreaterThan(list[i - 1].sortOrder);
      }
    });
  });

  describe('regionsByDominantElement', () => {
    it('kim → trả region có dominantElement === kim', () => {
      const list = regionsByDominantElement('kim');
      expect(list.length).toBeGreaterThanOrEqual(1);
      for (const r of list) {
        expect(r.dominantElement).toBe('kim');
      }
    });

    it('return list đã sort theo sortOrder asc', () => {
      for (const elem of ELEMENTS as readonly ElementKey[]) {
        const list = regionsByDominantElement(elem);
        for (let i = 1; i < list.length; i++) {
          expect(list[i].sortOrder).toBeGreaterThan(list[i - 1].sortOrder);
        }
      }
    });
  });
});

describe('MAP_REGIONS cross-catalog parity', () => {
  /**
   * No-orphan invariant — mọi `regionKey` xuất hiện trong các catalog
   * khác (MONSTERS / DUNGEONS / BOSSES / MISSIONS) phải tồn tại trong
   * MAP_REGIONS. Test này là gate chính: nếu thêm region mới cho
   * monster/boss/mission mà quên catalog → CI red.
   */
  function collectRegionKeysFrom<T extends { regionKey?: string | null }>(
    items: readonly T[],
  ): Set<string> {
    const keys = new Set<string>();
    for (const it of items) {
      if (it.regionKey != null) keys.add(it.regionKey);
    }
    return keys;
  }

  it('mọi MonsterDef.regionKey ∈ MAP_REGIONS', () => {
    const keys = collectRegionKeysFrom(MONSTERS);
    for (const k of keys) {
      expect(
        REGION_KEY_SET.has(k as RegionKey),
        `MONSTERS regionKey=${k} không có trong MAP_REGIONS`,
      ).toBe(true);
    }
  });

  it('mọi DungeonDef.regionKey ∈ MAP_REGIONS', () => {
    const keys = collectRegionKeysFrom(DUNGEONS);
    for (const k of keys) {
      expect(
        REGION_KEY_SET.has(k as RegionKey),
        `DUNGEONS regionKey=${k} không có trong MAP_REGIONS`,
      ).toBe(true);
    }
  });

  it('mọi BossDef.regionKey ∈ MAP_REGIONS', () => {
    const keys = collectRegionKeysFrom(BOSSES);
    for (const k of keys) {
      expect(
        REGION_KEY_SET.has(k as RegionKey),
        `BOSSES regionKey=${k} không có trong MAP_REGIONS`,
      ).toBe(true);
    }
  });

  it('mọi MissionDef.regionKey ∈ MAP_REGIONS', () => {
    const keys = collectRegionKeysFrom(MISSIONS);
    for (const k of keys) {
      expect(
        REGION_KEY_SET.has(k as RegionKey),
        `MISSIONS regionKey=${k} không có trong MAP_REGIONS`,
      ).toBe(true);
    }
  });

  it('mọi region trong MAP_REGIONS được reference ít nhất 1 lần (no dead region)', () => {
    const referenced = new Set<string>();
    for (const m of MONSTERS) if (m.regionKey != null) referenced.add(m.regionKey);
    for (const d of DUNGEONS) if (d.regionKey != null) referenced.add(d.regionKey);
    for (const b of BOSSES) if (b.regionKey != null) referenced.add(b.regionKey);
    for (const m of MISSIONS) if (m.regionKey != null) referenced.add(m.regionKey);
    for (const r of MAP_REGIONS) {
      expect(
        referenced.has(r.key),
        `MAP_REGIONS.${r.key} không được reference từ bất kỳ catalog nào (dead region — xem xét loại bỏ hoặc thêm content)`,
      ).toBe(true);
    }
  });

  it('catalog type — MapRegionDef.key narrow type RegionKey', () => {
    // Compile-time check — chạy test này pass nghĩa là TS compile happy.
    const r: MapRegionDef = MAP_REGIONS[0];
    const k: RegionKey = r.key;
    expect(REGION_KEY_SET.has(k)).toBe(true);
  });
});
