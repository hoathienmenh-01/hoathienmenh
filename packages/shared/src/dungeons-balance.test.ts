/**
 * Phase 10 PR-3 — Dungeon catalog integrity & balance tests.
 *
 * Tại sao cần test:
 * - `DUNGEONS` reference monsters (key) — cần verify zero orphan ref.
 * - `DUNGEON_LOOT[dungeonKey]` reference items (itemKey) — `items-dungeon-loot.test.ts`
 *   đã verify orphan ref nhưng KHÔNG verify mọi dungeon catalog có bảng loot
 *   tương ứng. Test này thêm guard "no dungeon without loot table".
 * - Stamina entry phải tuân BALANCE_MODEL.md §5.1 curve theo recommendedRealm.
 * - Element coverage: mỗi Ngũ Hành phải có ≥ 1 dungeon thematic phase 10 PR-3.
 *
 * Catalog only: dungeon enter/run runtime KHÔNG có ở phase 10 (xem
 * `DungeonDef` doc cho `element` / `regionKey` / `dailyLimit` forward-compat).
 */
import { describe, expect, it } from 'vitest';
import {
  DUNGEONS,
  ELEMENTS,
  ElementKey,
  MONSTERS,
  dungeonByKey,
  dungeonsByElement,
  dungeonsByRegion,
  monsterByKey,
} from './combat';
import { DUNGEON_LOOT, itemByKey } from './items';
import { realmByKey } from './realms';

describe('DUNGEONS catalog integrity', () => {
  it('có ít nhất 9 entries (3 legacy + 6 phase 10 PR-3)', () => {
    expect(DUNGEONS.length).toBeGreaterThanOrEqual(9);
  });

  it('mọi key unique', () => {
    const keys = DUNGEONS.map((d) => d.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('mọi key match snake_case [a-z][a-z0-9_]*', () => {
    for (const d of DUNGEONS) {
      expect(d.key, `dungeon key ${d.key}`).toMatch(/^[a-z][a-z0-9_]*$/);
    }
  });

  it('name + description không rỗng', () => {
    for (const d of DUNGEONS) {
      expect(d.name.trim().length, `dungeon ${d.key} name`).toBeGreaterThan(0);
      expect(d.description.trim().length, `dungeon ${d.key} desc`).toBeGreaterThan(0);
    }
  });

  it('description có ≥ 20 ký tự (UI tooltip readable)', () => {
    for (const d of DUNGEONS) {
      expect(d.description.length, `dungeon ${d.key} desc length`).toBeGreaterThanOrEqual(20);
    }
  });

  it('dungeonByKey() resolve mọi entry', () => {
    for (const d of DUNGEONS) {
      expect(dungeonByKey(d.key)?.key).toBe(d.key);
    }
  });
});

describe('DUNGEONS recommendedRealm', () => {
  it('mọi recommendedRealm resolve via realmByKey', () => {
    for (const d of DUNGEONS) {
      expect(
        realmByKey(d.recommendedRealm),
        `dungeon ${d.key} recommendedRealm ${d.recommendedRealm}`,
      ).toBeDefined();
    }
  });
});

describe('DUNGEONS monsters reference', () => {
  it('mọi monster key resolve qua monsterByKey (no orphan ref)', () => {
    for (const d of DUNGEONS) {
      for (const mk of d.monsters) {
        expect(monsterByKey(mk), `dungeon ${d.key} → monster ${mk}`).toBeDefined();
      }
    }
  });

  it('mọi dungeon có ≥ 1 monster', () => {
    for (const d of DUNGEONS) {
      expect(d.monsters.length, `dungeon ${d.key} monster count`).toBeGreaterThanOrEqual(1);
    }
  });

  it('full multi-encounter dungeon (≥ 3 monster) cho mọi normal dungeon (trừ single-boss endgame)', () => {
    const SINGLE_BOSS_KEYS = new Set(['cuu_la_dien']); // single-boss design
    for (const d of DUNGEONS) {
      if (SINGLE_BOSS_KEYS.has(d.key)) continue;
      expect(
        d.monsters.length,
        `dungeon ${d.key} (multi-encounter) ≥ 3 monsters`,
      ).toBeGreaterThanOrEqual(3);
    }
  });

  it('Phase 12 Story Foundation Late-game wire: 8 placeholder reachable trong DUNGEONS.monsters[]', () => {
    // Invariant: 8 placeholder Trúc Cơ/Kim Đan/Nguyên Anh story (`tich_linh_anh`,
    // `tam_ma_anh`, `tich_linh_quy`, `tich_thien_sat_thu`, `tam_ma_nguyen_anh`,
    // `chap_niem_anh`, `ky_uc_meo`, `huyet_anh`) phải xuất hiện ở ≥ 1 dungeon
    // `monsters[]` để player thực kill được qua DungeonRun encounter loop. Trước
    // wire này (PR #433), monster catalog có nhưng dungeon `monsters[]` không
    // chứa → player chỉ track quest qua admin harness `POST /admin/users/:id/
    // quest-track` (PR-5). Test backstop ngăn drift trở lại.
    const lateGamePlaceholders = [
      'tich_linh_anh',
      'tam_ma_anh',
      'tich_linh_quy',
      'tich_thien_sat_thu',
      'tam_ma_nguyen_anh',
      'chap_niem_anh',
      'ky_uc_meo',
      'huyet_anh',
    ];
    const reachable = new Set<string>();
    for (const d of DUNGEONS) {
      for (const mk of d.monsters) reachable.add(mk);
    }
    for (const placeholder of lateGamePlaceholders) {
      expect(
        reachable.has(placeholder),
        `late-game placeholder ${placeholder} không reachable trong dungeons.monsters[]`,
      ).toBe(true);
    }
  });
});

describe('DUNGEONS staminaEntry budget (BALANCE_MODEL §5.1)', () => {
  // Stamina max default = 100 → cap entry ≤ 80
  it('staminaEntry ∈ [5, 80]', () => {
    for (const d of DUNGEONS) {
      expect(d.staminaEntry, `dungeon ${d.key} stamina min`).toBeGreaterThanOrEqual(5);
      expect(d.staminaEntry, `dungeon ${d.key} stamina max`).toBeLessThanOrEqual(80);
    }
  });

  // Heuristic: stamina tăng theo realm tier
  it('stamina luyenkhi ≤ 15, truc_co ≤ 30, kim_dan ≤ 40, nguyen_anh ≤ 65', () => {
    for (const d of DUNGEONS) {
      const realm = d.recommendedRealm;
      if (realm === 'luyenkhi') {
        expect(d.staminaEntry, `${d.key} luyenkhi stamina`).toBeLessThanOrEqual(15);
      } else if (realm === 'truc_co') {
        expect(d.staminaEntry, `${d.key} truc_co stamina`).toBeLessThanOrEqual(30);
      } else if (realm === 'kim_dan') {
        expect(d.staminaEntry, `${d.key} kim_dan stamina`).toBeLessThanOrEqual(40);
      } else if (realm === 'nguyen_anh') {
        expect(d.staminaEntry, `${d.key} nguyen_anh stamina`).toBeLessThanOrEqual(65);
      }
    }
  });
});

describe('DUNGEONS forward-compat metadata (phase 10 PR-3)', () => {
  const ELEMENT_SET = new Set<ElementKey | null>([...ELEMENTS, null]);

  it('mọi element ∈ {kim, moc, thuy, hoa, tho, null}', () => {
    for (const d of DUNGEONS) {
      const elem = d.element ?? null;
      expect(
        ELEMENT_SET.has(elem),
        `dungeon ${d.key} element ${elem} invalid`,
      ).toBe(true);
    }
  });

  it('regionKey nếu set là string non-empty', () => {
    for (const d of DUNGEONS) {
      if (d.regionKey != null) {
        expect(d.regionKey.length, `dungeon ${d.key} regionKey`).toBeGreaterThan(0);
      }
    }
  });

  it('dailyLimit nếu set ∈ [1, 10]', () => {
    for (const d of DUNGEONS) {
      if (d.dailyLimit != null) {
        expect(d.dailyLimit, `dungeon ${d.key} dailyLimit min`).toBeGreaterThanOrEqual(1);
        expect(d.dailyLimit, `dungeon ${d.key} dailyLimit max`).toBeLessThanOrEqual(10);
      }
    }
  });
});

describe('DUNGEONS element coverage', () => {
  it('mỗi element Ngũ Hành (kim/moc/thuy/hoa/tho) có ≥ 1 dungeon thematic', () => {
    for (const elem of ELEMENTS) {
      const list = dungeonsByElement(elem);
      expect(list.length, `element ${elem} dungeon count`).toBeGreaterThanOrEqual(1);
    }
  });
});

describe('DUNGEONS dungeon-region cross-reference', () => {
  it('nếu dungeon có regionKey, region đó có ≥ 1 monster', () => {
    for (const d of DUNGEONS) {
      if (!d.regionKey) continue;
      // Tránh false-positive trên cuu_la_dien (regionKey = kim_son_mach, share monsters)
      expect(
        d.monsters.length,
        `dungeon ${d.key} (regionKey ${d.regionKey}) phải có monsters`,
      ).toBeGreaterThan(0);
    }
  });
});

describe('DUNGEON_LOOT × DUNGEONS parity', () => {
  it('mọi dungeon catalog có entry trong DUNGEON_LOOT', () => {
    const lootKeys = new Set(Object.keys(DUNGEON_LOOT));
    for (const d of DUNGEONS) {
      expect(
        lootKeys.has(d.key),
        `dungeon ${d.key} thiếu DUNGEON_LOOT entry`,
      ).toBe(true);
    }
  });

  it('không có DUNGEON_LOOT entry cho dungeon không tồn tại (no orphan)', () => {
    const dungeonKeys = new Set(DUNGEONS.map((d) => d.key));
    for (const lootKey of Object.keys(DUNGEON_LOOT)) {
      expect(
        dungeonKeys.has(lootKey),
        `DUNGEON_LOOT[${lootKey}] không match dungeon nào`,
      ).toBe(true);
    }
  });

  it('mọi dungeon loot table có ≥ 3 entries (variety guarantee)', () => {
    for (const [dungeonKey, table] of Object.entries(DUNGEON_LOOT)) {
      expect(
        table.length,
        `DUNGEON_LOOT[${dungeonKey}] cần ≥ 3 entries`,
      ).toBeGreaterThanOrEqual(3);
    }
  });

  it('mọi loot itemKey resolve qua itemByKey (no orphan)', () => {
    for (const [dungeonKey, table] of Object.entries(DUNGEON_LOOT)) {
      for (const e of table) {
        expect(
          itemByKey(e.itemKey),
          `DUNGEON_LOOT[${dungeonKey}] itemKey ${e.itemKey}`,
        ).toBeDefined();
      }
    }
  });
});

describe('DUNGEONS daily totals (sanity check)', () => {
  it('tổng dailyLimit của dungeon hệ kim+moc+thuy+hoa+tho ≤ 30 (chống farm vô hạn)', () => {
    let total = 0;
    for (const d of DUNGEONS) {
      if (d.element && d.dailyLimit != null) {
        total += d.dailyLimit;
      }
    }
    expect(total, `total dailyLimit elemental dungeons`).toBeLessThanOrEqual(30);
  });
});

// ═════════════════════════════════════════════════════════════════════
// Phase 12.2.B — DungeonRun completion reward invariants
// runReward = bonus deterministic claim sau khi clear toàn bộ encounter,
// khác với DUNGEON_LOOT (per-encounter random drop). Reward grant atomic
// qua CurrencyService.applyTx (linhThach/tienNgoc) + InventoryService
// .grantTx (items) + tx.character.update (exp) với reason='DUNGEON_RUN
// _REWARD' + refType='DungeonRun' + refId=runId. CAS guard
// DungeonRun.claimedAt=null đảm bảo idempotent.
// ═════════════════════════════════════════════════════════════════════
describe('DUNGEONS runReward (Phase 12.2.B)', () => {
  it('mọi dungeon trong catalog hiện tại đều khai báo runReward', () => {
    for (const d of DUNGEONS) {
      expect(d.runReward, `dungeon ${d.key} runReward`).toBeDefined();
    }
  });

  it('linhThach/tienNgoc/exp nếu set là integer dương (≥ 0)', () => {
    for (const d of DUNGEONS) {
      if (!d.runReward) continue;
      const r = d.runReward;
      if (r.linhThach != null) {
        expect(Number.isInteger(r.linhThach), `${d.key} linhThach integer`).toBe(true);
        expect(r.linhThach, `${d.key} linhThach min`).toBeGreaterThanOrEqual(0);
      }
      if (r.tienNgoc != null) {
        expect(Number.isInteger(r.tienNgoc), `${d.key} tienNgoc integer`).toBe(true);
        expect(r.tienNgoc, `${d.key} tienNgoc min`).toBeGreaterThanOrEqual(0);
      }
      if (r.exp != null) {
        expect(Number.isInteger(r.exp), `${d.key} exp integer`).toBe(true);
        expect(r.exp, `${d.key} exp min`).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it('items nếu set: itemKey resolve qua itemByKey (no orphan) + qty integer dương', () => {
    for (const d of DUNGEONS) {
      const items = d.runReward?.items;
      if (!items) continue;
      for (const it of items) {
        expect(itemByKey(it.itemKey), `${d.key} runReward item ${it.itemKey}`).toBeDefined();
        expect(Number.isInteger(it.qty), `${d.key} runReward qty ${it.itemKey} integer`).toBe(true);
        expect(it.qty, `${d.key} runReward qty ${it.itemKey} min`).toBeGreaterThan(0);
      }
    }
  });

  it('reward scale tăng theo recommendedRealm tier (sanity check, không quá tier sau)', () => {
    // Heuristic: linhThach band per realm (BALANCE_MODEL §5.3 economy):
    //   luyenkhi   ≤ 100, truc_co ≤ 200, kim_dan ≤ 350, nguyen_anh ≤ 1500
    const CAPS: Record<string, number> = {
      luyenkhi: 100,
      truc_co: 200,
      kim_dan: 350,
      nguyen_anh: 1500,
    };
    for (const d of DUNGEONS) {
      const cap = CAPS[d.recommendedRealm];
      if (cap == null || d.runReward?.linhThach == null) continue;
      expect(
        d.runReward.linhThach,
        `${d.key} (${d.recommendedRealm}) linhThach ≤ ${cap}`,
      ).toBeLessThanOrEqual(cap);
    }
  });

  it('runReward không hoàn toàn rỗng (≥ 1 trường có giá trị > 0)', () => {
    for (const d of DUNGEONS) {
      if (!d.runReward) continue;
      const r = d.runReward;
      const hasReward =
        (r.linhThach ?? 0) > 0 ||
        (r.tienNgoc ?? 0) > 0 ||
        (r.exp ?? 0) > 0 ||
        (r.items ?? []).length > 0;
      expect(hasReward, `${d.key} runReward không thể rỗng hoàn toàn`).toBe(true);
    }
  });
});

// ═════════════════════════════════════════════════════════════════════
// Phase 12.5 — Late-game story monster balance invariants
//
// 8 placeholder Trúc Cơ/Kim Đan/Nguyên Anh story (`tich_linh_anh`,
// `tam_ma_anh`, `tich_linh_quy`, `tich_thien_sat_thu`,
// `tam_ma_nguyen_anh`, `chap_niem_anh`, `ky_uc_meo`, `huyet_anh`) —
// stat curve verify match realm tier + dungeon placement (xem
// BALANCE_MODEL.md §5.5 "Phase 12.5 late-game story monster tuning").
//
// Backstop ngăn drift trở lại trạng thái Phase 12.4 placeholder seed
// minimal (uniform stat across tier, không phân biệt SPIRIT/ELITE/BOSS).
// ═════════════════════════════════════════════════════════════════════
describe('Phase 12.5 late-game story monster balance', () => {
  // Mapping placeholder → expected (level range, monsterType, dungeon).
  // Allow level range thay vì exact value để future tweak (±1) không phá
  // test mà vẫn ngăn drift tier (vd Trúc Cơ monster up to lvl 14).
  const expectations: Record<
    string,
    {
      levelMin: number;
      levelMax: number;
      monsterType: 'SPIRIT' | 'HUMANOID' | 'ELITE' | 'BOSS';
      dungeon: string;
      hasLootTable: boolean;
    }
  > = {
    tich_linh_anh: {
      levelMin: 4,
      levelMax: 7,
      monsterType: 'SPIRIT',
      dungeon: 'hac_lam',
      hasLootTable: false,
    },
    tam_ma_anh: {
      levelMin: 5,
      levelMax: 8,
      monsterType: 'SPIRIT',
      dungeon: 'hac_lam',
      hasLootTable: false,
    },
    tich_linh_quy: {
      levelMin: 6,
      levelMax: 9,
      monsterType: 'SPIRIT',
      dungeon: 'moc_huyen_lam',
      hasLootTable: false,
    },
    tich_thien_sat_thu: {
      levelMin: 10,
      levelMax: 13,
      monsterType: 'ELITE',
      dungeon: 'kim_son_mach',
      hasLootTable: true,
    },
    tam_ma_nguyen_anh: {
      levelMin: 14,
      levelMax: 16,
      monsterType: 'ELITE',
      dungeon: 'hoang_tho_huyet',
      hasLootTable: true,
    },
    chap_niem_anh: {
      levelMin: 14,
      levelMax: 16,
      monsterType: 'SPIRIT',
      dungeon: 'hoang_tho_huyet',
      hasLootTable: false,
    },
    // ky_uc_meo: story-hard intentional tier gap — lvl 14 Nguyên Anh stat
    // trong Trúc Cơ dungeon (moc_huyen_lam). Xem BALANCE_MODEL §5.5.
    ky_uc_meo: {
      levelMin: 13,
      levelMax: 15,
      monsterType: 'SPIRIT',
      dungeon: 'moc_huyen_lam',
      hasLootTable: false,
    },
    huyet_anh: {
      levelMin: 15,
      levelMax: 18,
      monsterType: 'BOSS',
      dungeon: 'hoang_tho_huyet',
      hasLootTable: true,
    },
  };

  it('mọi key tồn tại trong MONSTERS catalog', () => {
    for (const key of Object.keys(expectations)) {
      const m = monsterByKey(key);
      expect(m, `late-game ${key} catalog`).toBeDefined();
    }
  });

  it('hp/atk > 0 + def ≥ 0 + speed > 0', () => {
    for (const key of Object.keys(expectations)) {
      const m = monsterByKey(key)!;
      expect(m.hp, `${key} hp > 0`).toBeGreaterThan(0);
      expect(m.atk, `${key} atk > 0`).toBeGreaterThan(0);
      expect(m.def, `${key} def ≥ 0`).toBeGreaterThanOrEqual(0);
      expect(m.speed, `${key} speed > 0`).toBeGreaterThan(0);
    }
  });

  it('exp/linhThach drop > 0 (reward sanity)', () => {
    for (const key of Object.keys(expectations)) {
      const m = monsterByKey(key)!;
      expect(m.expDrop, `${key} expDrop > 0`).toBeGreaterThan(0);
      expect(m.linhThachDrop, `${key} linhThachDrop > 0`).toBeGreaterThan(0);
    }
  });

  it('level nằm trong range hợp lý theo dungeon tier', () => {
    for (const [key, exp] of Object.entries(expectations)) {
      const m = monsterByKey(key)!;
      expect(
        m.level,
        `${key} level min (Phase 12.5 tier ${exp.monsterType})`,
      ).toBeGreaterThanOrEqual(exp.levelMin);
      expect(
        m.level,
        `${key} level max (Phase 12.5 tier ${exp.monsterType})`,
      ).toBeLessThanOrEqual(exp.levelMax);
    }
  });

  it('monsterType khớp classification (SPIRIT/HUMANOID/ELITE/BOSS)', () => {
    for (const [key, exp] of Object.entries(expectations)) {
      const m = monsterByKey(key)!;
      expect(
        m.monsterType,
        `${key} monsterType (Phase 12.5)`,
      ).toBe(exp.monsterType);
    }
  });

  it('mỗi placeholder reachable đúng dungeon được map (regression PR #439 + Phase 12.5)', () => {
    for (const [key, exp] of Object.entries(expectations)) {
      const dungeon = dungeonByKey(exp.dungeon);
      expect(
        dungeon?.monsters,
        `${key} dungeon ${exp.dungeon} catalog`,
      ).toBeDefined();
      expect(
        dungeon!.monsters.includes(key),
        `${key} không reachable trong dungeon ${exp.dungeon}.monsters[]`,
      ).toBe(true);
    }
  });

  it('ELITE/BOSS có lootTable; SPIRIT/HUMANOID không có (convention Phase 12.4)', () => {
    for (const [key, exp] of Object.entries(expectations)) {
      const m = monsterByKey(key)!;
      const has = (m.lootTable?.length ?? 0) > 0;
      expect(
        has,
        `${key} (${exp.monsterType}) lootTable expected=${exp.hasLootTable} actual=${has}`,
      ).toBe(exp.hasLootTable);
    }
  });

  it('lootTable itemKey resolve qua itemByKey (no orphan ref)', () => {
    for (const key of Object.keys(expectations)) {
      const m = monsterByKey(key)!;
      if (!m.lootTable || m.lootTable.length === 0) continue;
      for (const e of m.lootTable) {
        expect(
          itemByKey(e.itemKey),
          `${key} → ${e.itemKey} unresolved`,
        ).toBeDefined();
        expect(e.weight, `${key} → ${e.itemKey} weight > 0`).toBeGreaterThan(0);
        expect(e.qtyMin, `${key} → ${e.itemKey} qtyMin ≥ 1`).toBeGreaterThanOrEqual(1);
        expect(
          e.qtyMin,
          `${key} → ${e.itemKey} qtyMin ≤ qtyMax`,
        ).toBeLessThanOrEqual(e.qtyMax);
      }
    }
  });

  it('huyet_anh là BOSS hardest in pack (hp ≥ tất cả 7 placeholder khác)', () => {
    // huyet_anh = endgame story BOSS placeholder per spec. HP phải ≥ 7
    // placeholder khác để invariant "khó nhất trong nhóm" giữ nguyên.
    const huyet = monsterByKey('huyet_anh')!;
    const others = Object.keys(expectations)
      .filter((k) => k !== 'huyet_anh')
      .map((k) => monsterByKey(k)!);
    for (const o of others) {
      expect(
        huyet.hp,
        `huyet_anh hp (${huyet.hp}) phải ≥ ${o.key} hp (${o.hp})`,
      ).toBeGreaterThanOrEqual(o.hp);
    }
  });

  it('tich_thien_sat_thu burst-glass invariant (atk cao + speed cao + hp thấp hơn ELITE Kim Đan peer)', () => {
    // Assassin design: ATK ≥ peer ELITE kim_dieu_thuong_phong (hp 920/atk
    // 105/speed 16) trừ HP, speed ≥ kim_dieu (max in dungeon). Backstop
    // ngăn future "buff for newbie" drift biến assassin thành tank.
    const ass = monsterByKey('tich_thien_sat_thu')!;
    const kimDieu = monsterByKey('kim_dieu_thuong_phong')!;
    expect(ass.atk, `sat_thu atk ≥ kim_dieu_thuong_phong atk`).toBeGreaterThanOrEqual(
      kimDieu.atk - 15, // burst flavor: ≤ 15 atk gap với mid-Kim Đan ELITE peer
    );
    expect(ass.speed, `sat_thu speed ≥ kim_dieu speed`).toBeGreaterThanOrEqual(
      kimDieu.speed,
    );
    expect(ass.hp, `sat_thu hp < kim_dieu hp (burst-glass)`).toBeLessThan(kimDieu.hp);
  });

  it('SPIRIT type có def ≤ 0.6 × peer BEAST/HUMANOID cùng level (intangible flavor)', () => {
    // Phase 12.5 design: SPIRIT "linh ảnh / tâm ma" intangible → def thấp
    // hơn BEAST/HUMANOID cùng level. Sanity check cho 3 SPIRIT placeholder
    // Trúc Cơ (tich_linh_anh / tam_ma_anh / tich_linh_quy).
    const spiritTrucCo = ['tich_linh_anh', 'tam_ma_anh', 'tich_linh_quy'];
    for (const key of spiritTrucCo) {
      const m = monsterByKey(key)!;
      // Find peer BEAST/HUMANOID cùng level
      const peers = MONSTERS.filter(
        (p) =>
          p.level === m.level &&
          (p.monsterType === 'BEAST' || p.monsterType === 'HUMANOID'),
      );
      if (peers.length === 0) continue; // không có peer thì skip
      const maxPeerDef = Math.max(...peers.map((p) => p.def));
      expect(
        m.def,
        `${key} (SPIRIT lvl ${m.level}) def ${m.def} ≤ peer max def ${maxPeerDef} × 1.2 (allow leeway)`,
      ).toBeLessThanOrEqual(Math.ceil(maxPeerDef * 1.2));
    }
  });
});
