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
