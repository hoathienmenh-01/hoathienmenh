import { describe, it, expect } from 'vitest';
import {
  BOSSES,
  bossesByElement,
  bossesByRegion,
  bossesByRealm,
} from './boss';
import { ITEMS } from './items';
import { ELEMENTS, type ElementKey } from './combat';
import { REALMS } from './realms';

/**
 * BOSSES catalog balance — Phase 10 PR-5 Boss Pack 1 (+10 named boss, Ngũ
 * Hành). Bound các invariant scaling, element coverage, region coverage,
 * drop pool quality, và forward-compat field.
 *
 * Stat budget (BALANCE_MODEL.md §6.1):
 *   sect-level (truc_co/kim_dan)  hp 100k..500k    atk 80..220   def 30..70
 *   world pham (nguyen_anh/hoa_than) hp 500k..1.5M   atk 200..400  def 70..150
 *   world late (hoa_than+/luyen_hu)  hp 1.5M..3M     atk 350..600  def 130..200
 *   cross-element endgame (hop_the+) hp 2M..5M       atk 500..800  def 150..250
 *
 * Reward band (BALANCE_MODEL.md §7.1 boss > dungeon):
 *   baseRewardLinhThach ≈ baseMaxHp / 4 ± 30%.
 */

const REALM_KEYS = new Set(REALMS.map((r) => r.key));
const ITEM_KEYS = new Set(ITEMS.map((i) => i.key));

describe('BOSSES catalog (Phase 10 PR-5 Boss Pack 1)', () => {
  it('total boss count >= 12 (legacy 2 + Phase 10 PR-5 +10)', () => {
    expect(BOSSES.length).toBeGreaterThanOrEqual(12);
  });

  it('mỗi boss có recommendedRealm là REALMS key hợp lệ', () => {
    for (const b of BOSSES) {
      expect(
        REALM_KEYS.has(b.recommendedRealm),
        `${b.key} recommendedRealm=${b.recommendedRealm} không tồn tại trong REALMS`,
      ).toBe(true);
    }
  });

  it('mỗi boss có level (forward-compat phase 11.3) > 0', () => {
    for (const b of BOSSES) {
      // Phase 10 PR-5: level optional cho forward-compat. Nếu set, phải > 0.
      if (b.level !== undefined && b.level !== null) {
        expect(b.level, `${b.key} level`).toBeGreaterThan(0);
        expect(b.level, `${b.key} level <= 100 (curve cap)`).toBeLessThanOrEqual(100);
      }
    }
  });

  it('boss level monotonic non-decreasing (cùng tier có thể bằng)', () => {
    let prevLevel = 0;
    for (const b of BOSSES) {
      if (b.level !== undefined && b.level !== null) {
        expect(
          b.level,
          `${b.key} level (${b.level}) phải >= prev level (${prevLevel})`,
        ).toBeGreaterThanOrEqual(prevLevel);
        prevLevel = b.level;
      }
    }
  });
});

describe('Ngũ Hành element coverage (Phase 10 PR-5)', () => {
  it('mỗi element kim/moc/thuy/hoa/tho có >= 2 boss', () => {
    for (const el of ELEMENTS) {
      const list = bossesByElement(el);
      expect(
        list.length,
        `element=${el} chỉ có ${list.length} boss (< 2)`,
      ).toBeGreaterThanOrEqual(2);
    }
  });

  it('có >= 1 boss cross-element (element=null) cho endgame', () => {
    const crossElement = bossesByElement(null);
    expect(
      crossElement.length,
      'cần >= 1 boss vô hệ / cross-element cho endgame (e.g. Hỗn Nguyên Yêu Tổ)',
    ).toBeGreaterThanOrEqual(1);
  });

  it('mỗi boss có element trong ELEMENTS hoặc null', () => {
    const valid: (ElementKey | null)[] = [...ELEMENTS, null];
    for (const b of BOSSES) {
      const e = b.element ?? null;
      expect(
        valid.includes(e),
        `${b.key} element=${e} không hợp lệ`,
      ).toBe(true);
    }
  });
});

describe('Region coverage (Phase 10 PR-5)', () => {
  it('mỗi region từ Phase 10 PR-3 (kim/moc/thuy/hoa/tho region) có >= 1 boss', () => {
    const regions = [
      'kim_son_mach',
      'moc_huyen_lam',
      'thuy_long_uyen',
      'hoa_diem_son',
      'hoang_tho_huyet',
    ] as const;
    for (const r of regions) {
      const list = bossesByRegion(r);
      expect(
        list.length,
        `region=${r} chỉ có ${list.length} boss (< 1)`,
      ).toBeGreaterThanOrEqual(1);
    }
  });

  it('endgame Cửu La Điện có >= 1 boss (cross-element high-tier)', () => {
    const list = bossesByRegion('cuu_la_dien');
    expect(list.length).toBeGreaterThanOrEqual(1);
  });

  it('boss có regionKey null là cross-region (endgame)', () => {
    const noRegion = BOSSES.filter((b) => (b.regionKey ?? null) === null);
    // Cho phép 0..N boss cross-region, không enforce upper bound.
    for (const b of noRegion) {
      expect(b.element ?? null, `${b.key} cross-region phải có element=null`).toBeNull();
    }
  });
});

describe('Realm tier coverage (Phase 10 PR-5)', () => {
  it('có boss ở tier kim_dan / nguyen_anh / hoa_than (mid-late game core)', () => {
    for (const realm of ['kim_dan', 'nguyen_anh', 'hoa_than'] as const) {
      const list = bossesByRealm(realm);
      expect(list.length, `realm=${realm} chỉ có ${list.length} boss`).toBeGreaterThanOrEqual(1);
    }
  });

  it('có >= 1 boss ở luyen_hu+ (world late tier endgame)', () => {
    const lateRealms = ['luyen_hu', 'hop_the', 'dai_thua', 'do_kiep'];
    const lateBosses = BOSSES.filter((b) => lateRealms.includes(b.recommendedRealm));
    expect(lateBosses.length).toBeGreaterThanOrEqual(1);
  });
});

describe('Stat budget bound (Phase 10 PR-5 — BALANCE_MODEL.md §6.1)', () => {
  it('hp >= 100k (sect-level minimum)', () => {
    for (const b of BOSSES) {
      expect(b.baseMaxHp, `${b.key} baseMaxHp ${b.baseMaxHp} < 100k`).toBeGreaterThanOrEqual(100000);
    }
  });

  it('hp <= 5M (cap phase 10 catalog — phase 12+ mới mở rộng)', () => {
    for (const b of BOSSES) {
      expect(b.baseMaxHp, `${b.key} baseMaxHp ${b.baseMaxHp} > 5M cap`).toBeLessThanOrEqual(5_000_000);
    }
  });

  it('atk band tỷ lệ với hp (atk ~ hp/8000..hp/1000, AI kill 6..30 turn)', () => {
    // Early boss (legacy yeu_vuong/huyet_long) atk band aggressive (~hp/1300);
    // late boss raid-style (~hp/4000+). Band [hp/8000, hp/1000] cover cả 2.
    for (const b of BOSSES) {
      const minAtk = b.baseMaxHp / 8000;
      const maxAtk = b.baseMaxHp / 1000;
      expect(
        b.atk,
        `${b.key} atk ${b.atk} < hp/8000 = ${minAtk} (boss quá yếu)`,
      ).toBeGreaterThanOrEqual(minAtk);
      expect(
        b.atk,
        `${b.key} atk ${b.atk} > hp/1000 = ${maxAtk} (boss one-shot, không cho phép)`,
      ).toBeLessThanOrEqual(maxAtk);
    }
  });

  it('def <= atk (boss thiên về tấn công, không pure tank)', () => {
    for (const b of BOSSES) {
      expect(b.def, `${b.key} def ${b.def} > atk ${b.atk}`).toBeLessThanOrEqual(b.atk);
    }
  });

  it('baseRewardLinhThach trong band [hp/8, hp/2] (boss reward > dungeon)', () => {
    for (const b of BOSSES) {
      expect(
        b.baseRewardLinhThach,
        `${b.key} reward ${b.baseRewardLinhThach} < hp/8 = ${b.baseMaxHp / 8}`,
      ).toBeGreaterThanOrEqual(b.baseMaxHp / 8);
      expect(
        b.baseRewardLinhThach,
        `${b.key} reward ${b.baseRewardLinhThach} > hp/2 = ${b.baseMaxHp / 2}`,
      ).toBeLessThanOrEqual(b.baseMaxHp / 2);
    }
  });
});

describe('Drop pool integrity (Phase 10 PR-5)', () => {
  it('mỗi boss có topDropPool có >= 1 entry quality HUYEN/TIEN/THAN (signature reward)', () => {
    const highQuality = new Map(
      ITEMS.map((i) => [i.key, i.quality] as const),
    );
    const HIGH = new Set(['HUYEN', 'TIEN', 'THAN']);
    for (const b of BOSSES) {
      const hasHigh = b.topDropPool.some((k) => HIGH.has(highQuality.get(k) ?? ''));
      expect(
        hasHigh,
        `${b.key} topDropPool không có HUYEN/TIEN/THAN item: ${[...b.topDropPool].join(',')}`,
      ).toBe(true);
    }
  });

  it('lowDropPool nếu có chỉ chứa itemKey hợp lệ (forward-compat phase 12)', () => {
    for (const b of BOSSES) {
      if (!b.lowDropPool) continue;
      for (const k of b.lowDropPool) {
        expect(
          ITEM_KEYS.has(k),
          `${b.key} lowDropPool có dangling itemKey ${k}`,
        ).toBe(true);
      }
    }
  });

  it('Phase 10 PR-5 boss (10 named) đều có lowDropPool (forward-compat phase 12 pity)', () => {
    // Legacy 2 bosses cũng đã thêm lowDropPool. Mới: 10 bosses Phase 10 PR-5
    // bắt buộc có lowDropPool ≥ 1 entry.
    const phase10Keys = [
      'moc_dinh_co_yeu',
      'thuy_thanh_long_de',
      'kim_phach_long_dieu',
      'chu_tuoc_huyet_de',
      'thach_long_co_de',
      'cuu_u_yeu_hau',
      'cuu_la_thien_de',
      'hoa_long_to_su',
      'bang_phach_long_de',
      'hon_nguyen_yeu_to',
    ];
    for (const k of phase10Keys) {
      const b = BOSSES.find((x) => x.key === k);
      expect(b, `boss ${k} không tồn tại trong BOSSES`).toBeDefined();
      expect(
        b!.lowDropPool && b!.lowDropPool.length,
        `${k} thiếu lowDropPool (cần >= 1 entry)`,
      ).toBeGreaterThanOrEqual(1);
    }
  });

  it('topDropPool / midDropPool / lowDropPool không trùng lặp internal (mỗi pool unique key)', () => {
    for (const b of BOSSES) {
      const top = [...b.topDropPool];
      expect(new Set(top).size, `${b.key} topDropPool có duplicate`).toBe(top.length);
      const mid = [...b.midDropPool];
      expect(new Set(mid).size, `${b.key} midDropPool có duplicate`).toBe(mid.length);
      if (b.lowDropPool) {
        const low = [...b.lowDropPool];
        expect(new Set(low).size, `${b.key} lowDropPool có duplicate`).toBe(low.length);
      }
    }
  });
});

describe('Forward-compat field consistency (Phase 10 PR-5)', () => {
  it('Phase 10 PR-5 boss đều có element + regionKey + level + monsterType set', () => {
    const phase10Keys = [
      'moc_dinh_co_yeu',
      'thuy_thanh_long_de',
      'kim_phach_long_dieu',
      'chu_tuoc_huyet_de',
      'thach_long_co_de',
      'cuu_u_yeu_hau',
      'cuu_la_thien_de',
      'hoa_long_to_su',
      'bang_phach_long_de',
      'hon_nguyen_yeu_to',
    ];
    for (const k of phase10Keys) {
      const b = BOSSES.find((x) => x.key === k);
      expect(b, `boss ${k} không tồn tại`).toBeDefined();
      expect(b!.element !== undefined, `${k} thiếu element`).toBe(true);
      expect(b!.regionKey !== undefined, `${k} thiếu regionKey`).toBe(true);
      expect(b!.level !== undefined, `${k} thiếu level`).toBe(true);
      expect(b!.monsterType, `${k} monsterType phải = 'BOSS'`).toBe('BOSS');
    }
  });

  it('region không null phải khớp với region từ MonsterDef / DungeonDef (Phase 10 PR-3)', () => {
    const allowedRegions = new Set([
      'son_coc',
      'hac_lam',
      'yeu_thu_dong',
      'kim_son_mach',
      'moc_huyen_lam',
      'thuy_long_uyen',
      'hoa_diem_son',
      'hoang_tho_huyet',
      'cuu_la_dien',
    ]);
    for (const b of BOSSES) {
      if (b.regionKey == null) continue;
      expect(
        allowedRegions.has(b.regionKey),
        `${b.key} regionKey=${b.regionKey} không khớp catalog Phase 10 PR-3`,
      ).toBe(true);
    }
  });

  it('Phase 10 PR-5 boss element khớp với element của region (consistency)', () => {
    const regionElement: Record<string, ElementKey | null> = {
      son_coc: 'tho',
      hac_lam: 'moc',
      yeu_thu_dong: 'kim',
      kim_son_mach: 'kim',
      moc_huyen_lam: 'moc',
      thuy_long_uyen: 'thuy',
      hoa_diem_son: 'hoa',
      hoang_tho_huyet: 'tho',
      cuu_la_dien: 'kim',
    };
    for (const b of BOSSES) {
      if (b.regionKey == null) continue;
      const expected = regionElement[b.regionKey];
      if (expected === undefined) continue;
      expect(
        b.element ?? null,
        `${b.key} element=${b.element} không khớp region=${b.regionKey} expected=${expected}`,
      ).toBe(expected);
    }
  });
});

describe('Helper functions (Phase 10 PR-5)', () => {
  it('bossesByElement(kim) >= 2 và mọi entry có element=kim', () => {
    const list = bossesByElement('kim');
    expect(list.length).toBeGreaterThanOrEqual(2);
    for (const b of list) {
      expect(b.element).toBe('kim');
    }
  });

  it('bossesByElement(null) trả về cross-element bosses', () => {
    const list = bossesByElement(null);
    for (const b of list) {
      expect(b.element ?? null).toBeNull();
    }
  });

  it('bossesByRegion(hoa_diem_son) chỉ chứa boss thuộc Hoả Diệm Sơn', () => {
    const list = bossesByRegion('hoa_diem_son');
    expect(list.length).toBeGreaterThanOrEqual(1);
    for (const b of list) {
      expect(b.regionKey).toBe('hoa_diem_son');
    }
  });

  it('bossesByRealm(kim_dan) >= 1 và mọi entry có recommendedRealm=kim_dan', () => {
    const list = bossesByRealm('kim_dan');
    expect(list.length).toBeGreaterThanOrEqual(1);
    for (const b of list) {
      expect(b.recommendedRealm).toBe('kim_dan');
    }
  });
});

describe('Phase 11.2.D+++ — skill book lowDropPool integration', () => {
  /**
   * Mỗi boss tier ≥ Trúc Cơ có element ∈ {kim,moc,thuy,hoa,tho} phải drop
   * `skill_book_<element>` cùng hệ trong `lowDropPool` (forward-compat
   * Phase 12 BossRewardService pity wire). Cross-element world boss
   * endgame (`hon_nguyen_yeu_to`) carry full Skill Book Pack 1 (5 element).
   *
   * Catalog metadata only ở PR này — `lowDropPool` chưa wire vào reward
   * runtime (Phase 12 sẽ wire share-ratio top 4-10 player).
   */
  const elementBook: Record<ElementKey, string> = {
    kim: 'skill_book_kim_quang_tram',
    moc: 'skill_book_moc_linh_truong_dieu',
    thuy: 'skill_book_thuy_kinh_phong_an',
    hoa: 'skill_book_hoa_xa_phun_diem',
    tho: 'skill_book_thach_giap_ho_than',
  };
  const ALL_BOOKS = Object.values(elementBook);

  it('mọi boss có element != null carry skill_book cùng hệ trong lowDropPool', () => {
    for (const b of BOSSES) {
      if (b.element == null) continue;
      const expectedBook = elementBook[b.element];
      expect(
        b.lowDropPool,
        `${b.key} (element=${b.element}) thiếu lowDropPool`,
      ).toBeDefined();
      expect(
        b.lowDropPool!.includes(expectedBook),
        `${b.key} lowDropPool thiếu ${expectedBook} (cùng hệ ${b.element})`,
      ).toBe(true);
    }
  });

  it('cross-element boss (element=null) carry full Skill Book Pack 1 (5 element)', () => {
    const cross = BOSSES.filter((b) => (b.element ?? null) === null);
    expect(cross.length, 'cần ≥ 1 cross-element boss').toBeGreaterThanOrEqual(1);
    for (const b of cross) {
      expect(b.lowDropPool, `${b.key} thiếu lowDropPool`).toBeDefined();
      for (const book of ALL_BOOKS) {
        expect(
          b.lowDropPool!.includes(book),
          `cross-element boss ${b.key} lowDropPool thiếu ${book}`,
        ).toBe(true);
      }
    }
  });

  it('boss element != null KHÔNG carry skill_book khác hệ (element gate)', () => {
    for (const b of BOSSES) {
      if (b.element == null) continue;
      if (!b.lowDropPool) continue;
      const expectedBook = elementBook[b.element];
      const otherBooks = ALL_BOOKS.filter((book) => book !== expectedBook);
      for (const otherBook of otherBooks) {
        expect(
          b.lowDropPool.includes(otherBook),
          `${b.key} (element=${b.element}) KHÔNG được carry ${otherBook} (chỉ ${expectedBook} hệ matching)`,
        ).toBe(false);
      }
    }
  });

  it('mọi skill_book trong lowDropPool resolve qua ITEMS (no orphan)', () => {
    for (const b of BOSSES) {
      if (!b.lowDropPool) continue;
      for (const k of b.lowDropPool) {
        if (!k.startsWith('skill_book_')) continue;
        expect(
          ITEM_KEYS.has(k),
          `${b.key} lowDropPool có dangling skill_book ${k}`,
        ).toBe(true);
      }
    }
  });
});
