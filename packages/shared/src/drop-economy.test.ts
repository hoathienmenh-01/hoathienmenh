import { describe, it, expect } from 'vitest';
import {
  DROP_RULE_CATALOG,
  buildDropRuleCatalog,
  bodyRealmOrderToMaterialTier,
  effectiveDropTier,
  getBaseMonsterTypeDropRate,
  getMaterialCategoryMultiplier,
  getMaterialDropRule,
  getMaterialSourceHints,
  getTierDistance,
  getTierOffsetWeights,
  inferDropMonsterType,
  inferSourceTierFromLevel,
  realmKeyToMaterialTier,
  realmOrderForKey,
  realmOrderToMaterialTier,
  rollDropEconomyMaterial,
  rollDropEconomyMaterials,
  rollHasMaterialDrop,
  rollMaterialTier,
  sourceHintToDropSource,
  summarizeDropCatalog,
  type DropMonsterType,
  type DropRollContext,
} from './drop-economy';
import { itemByKey, ITEMS } from './items';
import { realmByKey } from './realms';

function seqRng(values: number[]): () => number {
  let i = 0;
  return () => {
    const v = values[i % values.length];
    i++;
    return v;
  };
}

describe('realmOrderToMaterialTier', () => {
  it('maps 28 known realms to expected tiers', () => {
    const cases: Array<[string, number]> = [
      ['phamnhan', 1],
      ['luyenkhi', 1],
      ['truc_co', 2],
      ['kim_dan', 3],
      ['nguyen_anh', 4],
      ['hoa_than', 4],
      ['luyen_hu', 5],
      ['hop_the', 5],
      ['dai_thua', 5],
      ['do_kiep', 6],
      ['nhan_tien', 6],
      ['dia_tien', 6],
      ['thien_tien', 6],
      ['huyen_tien', 7],
      ['kim_tien', 7],
      ['thai_at_kim_tien', 7],
      ['dai_la_kim_tien', 7],
      ['chuan_thanh', 8],
      ['thanh_nhan', 8],
      ['hon_nguyen', 8],
      ['dao_quan', 8],
      ['thien_dao', 9],
      ['ban_nguyen', 9],
      ['huyen_huyen', 9],
      ['vo_thuy', 9],
      ['vo_chung', 9],
      ['vinh_hang', 9],
      ['hu_khong_chi_ton', 9],
    ];
    for (const [key, tier] of cases) {
      const realm = realmByKey(key);
      expect(realm, `realm ${key} missing`).toBeDefined();
      expect(realmOrderToMaterialTier(realm!.order)).toBe(tier);
    }
  });

  it('clamps out-of-range orders', () => {
    expect(realmOrderToMaterialTier(-5)).toBe(1);
    expect(realmOrderToMaterialTier(100)).toBe(9);
    expect(realmOrderToMaterialTier(Number.NaN)).toBe(1);
  });

  it('bodyRealmOrderToMaterialTier mirrors qi realm mapping', () => {
    expect(bodyRealmOrderToMaterialTier(2)).toBe(2);
    expect(bodyRealmOrderToMaterialTier(21)).toBe(9);
  });

  it('realmKeyToMaterialTier resolves realm key', () => {
    expect(realmKeyToMaterialTier('truc_co')).toBe(2);
    expect(realmKeyToMaterialTier('thien_dao')).toBe(9);
    expect(realmKeyToMaterialTier('unknown_realm')).toBe(1);
  });

  it('realmOrderForKey returns 0 for unknown', () => {
    expect(realmOrderForKey('unknown')).toBe(0);
  });
});

describe('effectiveDropTier', () => {
  it('takes min(player, source)', () => {
    expect(effectiveDropTier(5, 2)).toBe(2);
    expect(effectiveDropTier(2, 5)).toBe(2);
    expect(effectiveDropTier(3, 3)).toBe(3);
  });

  it('clamps within [1, 9]', () => {
    expect(effectiveDropTier(0, 0)).toBe(1);
    expect(effectiveDropTier(20, 20)).toBe(9);
  });

  it('Đại Thừa farm Trúc Cơ map → tier 2 only', () => {
    const dt = realmKeyToMaterialTier('dai_thua');
    expect(dt).toBe(5);
    const tc = realmKeyToMaterialTier('truc_co');
    expect(tc).toBe(2);
    expect(effectiveDropTier(dt, tc)).toBe(2);
  });
});

describe('getTierDistance', () => {
  it('signed delta', () => {
    expect(getTierDistance(2, 3)).toBe(1);
    expect(getTierDistance(5, 2)).toBe(-3);
  });
});

describe('source hint mapping', () => {
  it('maps known source hints to DropSource', () => {
    expect(sourceHintToDropSource('NORMAL_MONSTER')).toBe('NORMAL_MONSTER');
    expect(sourceHintToDropSource('ELITE')).toBe('ELITE');
    expect(sourceHintToDropSource('BOSS')).toBe('BOSS');
    expect(sourceHintToDropSource('WORLD_BOSS')).toBe('WORLD_BOSS');
    expect(sourceHintToDropSource('DUNGEON')).toBe('DUNGEON');
    expect(sourceHintToDropSource('BODY_DUNGEON')).toBe('BODY_DUNGEON');
    expect(sourceHintToDropSource('EVENT')).toBe('EVENT');
  });
});

describe('monster type rates', () => {
  it('NORMAL < ELITE < BOSS < DUNGEON_BOSS < WORLD_BOSS', () => {
    const n = getBaseMonsterTypeDropRate('NORMAL');
    const e = getBaseMonsterTypeDropRate('ELITE');
    const b = getBaseMonsterTypeDropRate('BOSS');
    const db = getBaseMonsterTypeDropRate('DUNGEON_BOSS');
    const w = getBaseMonsterTypeDropRate('WORLD_BOSS');
    expect(n).toBeLessThan(e);
    expect(e).toBeLessThan(b);
    expect(b).toBeLessThan(db);
    expect(db).toBeLessThan(w);
  });

  it('NORMAL base rate is low (≤ 0.05)', () => {
    expect(getBaseMonsterTypeDropRate('NORMAL')).toBeLessThanOrEqual(0.05);
  });

  it('WORLD_BOSS base rate is high (≥ 0.6)', () => {
    expect(getBaseMonsterTypeDropRate('WORLD_BOSS')).toBeGreaterThanOrEqual(0.6);
  });
});

describe('tier offset weight tables', () => {
  it('NORMAL forbids above2 and severely limits above1', () => {
    const w = getTierOffsetWeights('NORMAL');
    expect(w.above2).toBe(0);
    expect(w.above1).toBeLessThanOrEqual(0.02);
  });

  it('ELITE allows some above1 but no above2', () => {
    const w = getTierOffsetWeights('ELITE');
    expect(w.above2).toBe(0);
    expect(w.above1).toBeGreaterThan(0);
  });

  it('BOSS allows tiny above2 only', () => {
    const w = getTierOffsetWeights('BOSS');
    expect(w.above2).toBeGreaterThan(0);
    expect(w.above2).toBeLessThanOrEqual(0.01);
  });

  it('WORLD_BOSS has the highest above1/above2', () => {
    const wb = getTierOffsetWeights('WORLD_BOSS');
    const boss = getTierOffsetWeights('BOSS');
    expect(wb.above1).toBeGreaterThan(boss.above1);
    expect(wb.above2).toBeGreaterThan(boss.above2);
  });
});

describe('material category multipliers', () => {
  it('ALCHEMY_BODY harder than ALCHEMY_QI', () => {
    expect(getMaterialCategoryMultiplier('ALCHEMY_BODY')).toBeLessThan(
      getMaterialCategoryMultiplier('ALCHEMY_QI'),
    );
  });
  it('BODY_BREAKTHROUGH ≤ QI_BREAKTHROUGH', () => {
    expect(getMaterialCategoryMultiplier('BODY_BREAKTHROUGH')).toBeLessThanOrEqual(
      getMaterialCategoryMultiplier('QI_BREAKTHROUGH'),
    );
  });
  it('TRIBULATION rarer than BREAKTHROUGH', () => {
    expect(getMaterialCategoryMultiplier('TRIBULATION')).toBeLessThan(
      getMaterialCategoryMultiplier('QI_BREAKTHROUGH'),
    );
  });
  it('ARTIFACT_CRAFT rarest', () => {
    const m = getMaterialCategoryMultiplier;
    const all: number[] = [
      m('ALCHEMY_QI'),
      m('ALCHEMY_BODY'),
      m('QI_BREAKTHROUGH'),
      m('BODY_BREAKTHROUGH'),
      m('TRIBULATION'),
      m('COMBAT_BUFF'),
      m('EQUIPMENT_CRAFT'),
      m('FURNACE_UPGRADE'),
      m('GENERAL'),
    ];
    for (const v of all) {
      expect(getMaterialCategoryMultiplier('ARTIFACT_CRAFT')).toBeLessThanOrEqual(v);
    }
  });
});

describe('drop rule catalog', () => {
  it('every rule itemKey resolves to a real ITEM', () => {
    for (const rule of DROP_RULE_CATALOG) {
      expect(itemByKey(rule.itemKey), `rule ${rule.key} item missing`).toBeDefined();
    }
  });

  it('every rule has valid materialTier ∈ [1, 9]', () => {
    for (const rule of DROP_RULE_CATALOG) {
      expect(rule.materialTier).toBeGreaterThanOrEqual(1);
      expect(rule.materialTier).toBeLessThanOrEqual(9);
    }
  });

  it('every rule has valid materialCategory', () => {
    const valid = new Set([
      'ALCHEMY_QI',
      'ALCHEMY_BODY',
      'QI_BREAKTHROUGH',
      'BODY_BREAKTHROUGH',
      'TRIBULATION',
      'COMBAT_BUFF',
      'EQUIPMENT_CRAFT',
      'ARTIFACT_CRAFT',
      'FURNACE_UPGRADE',
      'GENERAL',
      // Phase 26.3 — Cultivation Method V2 fragment drops
      'METHOD_FRAGMENT',
    ]);
    for (const rule of DROP_RULE_CATALOG) {
      expect(valid.has(rule.materialCategory)).toBe(true);
    }
  });

  it('every rule source is a combat-drop source', () => {
    const combat = new Set([
      'NORMAL_MONSTER',
      'ELITE',
      'BOSS',
      'WORLD_BOSS',
      'DUNGEON',
      'BODY_DUNGEON',
      'ALCHEMY_DUNGEON',
      'MAIN_QUEST',
      'DAILY_QUEST',
      'EVENT',
    ]);
    for (const rule of DROP_RULE_CATALOG) {
      expect(combat.has(rule.source)).toBe(true);
    }
  });

  it('ARTIFACT_CRAFT category rules all have low baseChance and tight daily caps', () => {
    // Phase 26.4 policy:
    //   - NORMAL_MONSTER / ELITE / SECT_SHOP / NPC_SHOP / MARKET / AUCTION
    //     / ADMIN_ONLY: daily cap = 0 (quái thường không rơi nguyên liệu
    //     pháp bảo hiếm; shop không bán nguyên liệu pháp bảo vô hạn).
    //   - BOSS / DUNGEON / BODY_DUNGEON / ALCHEMY_DUNGEON: cap ≤ 2/day,
    //     và tier ≥ 7 = 0 (boss thường / dungeon không drop endgame
    //     artifact material).
    //   - WORLD_BOSS: cap ≤ 2/day + có weekly cap.
    //   - EVENT: cap riêng theo event window (undefined cho phép unlimited
    //     trong event timeframe nhưng cần daily cap khác từ event config).
    const artifactRules = DROP_RULE_CATALOG.filter(
      (r) => r.materialCategory === 'ARTIFACT_CRAFT',
    );
    expect(artifactRules.length).toBeGreaterThan(0);
    for (const r of artifactRules) {
      expect(r.baseChance).toBeLessThan(0.05);
      if (
        r.source === 'NORMAL_MONSTER' ||
        r.source === 'ELITE' ||
        r.source === 'SECT_SHOP' ||
        r.source === 'NPC_SHOP' ||
        r.source === 'MARKET' ||
        r.source === 'AUCTION' ||
        r.source === 'ADMIN_ONLY'
      ) {
        expect(
          r.maxDailyQty,
          `${r.source} ${r.itemKey} should be daily-capped to 0`,
        ).toBe(0);
      } else if (
        r.source === 'BOSS' ||
        r.source === 'DUNGEON' ||
        r.source === 'BODY_DUNGEON' ||
        r.source === 'ALCHEMY_DUNGEON' ||
        r.source === 'WORLD_BOSS'
      ) {
        expect(r.maxDailyQty).toBeDefined();
        expect(r.maxDailyQty!).toBeLessThanOrEqual(2);
        if (r.materialTier >= 7 && r.source !== 'WORLD_BOSS') {
          expect(
            r.maxDailyQty,
            `${r.source} tier ${r.materialTier} ${r.itemKey} should be 0`,
          ).toBe(0);
        }
      }
    }
  });

  it('BODY_BREAKTHROUGH tier ≥ 4 rules have small daily cap', () => {
    const rules = DROP_RULE_CATALOG.filter(
      (r) => r.materialCategory === 'BODY_BREAKTHROUGH' && r.materialTier >= 4,
    );
    for (const r of rules) {
      expect(r.maxDailyQty).toBeDefined();
      expect(r.maxDailyQty!).toBeLessThanOrEqual(3);
    }
  });

  it('WORLD_BOSS rules of artifact/rare categories have weekly caps', () => {
    const wb = DROP_RULE_CATALOG.filter((r) => r.source === 'WORLD_BOSS');
    expect(wb.length).toBeGreaterThan(0);
    for (const r of wb) {
      if (r.materialCategory === 'ARTIFACT_CRAFT' || r.materialCategory === 'TRIBULATION') {
        expect(r.maxWeeklyQty, `world boss ${r.itemKey} should weekly-cap`).toBeDefined();
      }
    }
  });

  it('summarizeDropCatalog covers all sources/categories with non-negative counts', () => {
    const s = summarizeDropCatalog();
    expect(s.total).toBeGreaterThan(0);
    expect(s.total).toBe(DROP_RULE_CATALOG.length);
    expect(Object.values(s.bySource).reduce((a, b) => a + b, 0)).toBe(s.total);
    expect(Object.values(s.byCategory).reduce((a, b) => a + b, 0)).toBe(s.total);
  });

  it('getMaterialDropRule round-trips by key', () => {
    const sample = DROP_RULE_CATALOG[0];
    expect(getMaterialDropRule(sample.key)).toEqual(sample);
  });

  it('buildDropRuleCatalog stable result from same ITEMS input', () => {
    const a = buildDropRuleCatalog(ITEMS);
    const b = buildDropRuleCatalog(ITEMS);
    expect(a.length).toBe(b.length);
    expect(a[0]).toEqual(b[0]);
  });
});

describe('rollHasMaterialDrop', () => {
  it('returns false when rng ≥ baseRate', () => {
    expect(rollHasMaterialDrop('NORMAL', seqRng([0.99]))).toBe(false);
    expect(rollHasMaterialDrop('ELITE', seqRng([0.99]))).toBe(false);
    expect(rollHasMaterialDrop('BOSS', seqRng([0.99]))).toBe(false);
  });

  it('returns true when rng < baseRate', () => {
    expect(rollHasMaterialDrop('NORMAL', seqRng([0.0]))).toBe(true);
    expect(rollHasMaterialDrop('WORLD_BOSS', seqRng([0.5]))).toBe(true);
  });
});

describe('rollMaterialTier', () => {
  it('NORMAL never picks above2', () => {
    let hadAbove2 = false;
    for (let i = 0; i < 1000; i++) {
      const t = rollMaterialTier('NORMAL', 2, Math.random);
      if (t >= 4) hadAbove2 = true;
    }
    expect(hadAbove2).toBe(false);
  });

  it('BOSS may occasionally pick above2 (sameTier+2)', () => {
    let hadAbove2 = false;
    for (let i = 0; i < 5000; i++) {
      const t = rollMaterialTier('BOSS', 2, Math.random);
      if (t === 4) hadAbove2 = true;
      if (hadAbove2) break;
    }
    expect(hadAbove2).toBe(true);
  });
});

describe('rollDropEconomyMaterial — combat invariants', () => {
  it('returns null when source is not combat (shop/market)', () => {
    const ctx: DropRollContext = {
      playerRealmOrder: 5,
      sourceTier: 3,
      monsterType: 'BOSS',
      source: 'NPC_SHOP',
      rng: () => 0,
    };
    expect(rollDropEconomyMaterial(ctx)).toBeNull();
  });

  it('returns null when monster-type rate fails', () => {
    const ctx: DropRollContext = {
      playerRealmOrder: 5,
      sourceTier: 3,
      monsterType: 'NORMAL',
      source: 'NORMAL_MONSTER',
      rng: () => 0.99,
    };
    expect(rollDropEconomyMaterial(ctx)).toBeNull();
  });

  it('returns a result with valid metadata when drop succeeds', () => {
    const ctx: DropRollContext = {
      playerRealmOrder: 2,
      sourceTier: 2,
      monsterType: 'BOSS',
      source: 'BOSS',
      rng: seqRng([0.0, 0.5, 0.3, 0.5]),
    };
    const res = rollDropEconomyMaterial(ctx);
    expect(res).not.toBeNull();
    expect(res!.qty).toBeGreaterThan(0);
    expect(res!.materialTier).toBeGreaterThanOrEqual(1);
    expect(res!.materialTier).toBeLessThanOrEqual(9);
  });
});

describe('rollDropEconomyMaterials — multi roll with cap carry', () => {
  it('respects daily cap across rolls', () => {
    const cappedRules = [
      {
        key: 'cap_test',
        itemKey: 'linh_thao_t1',
        materialTier: 1,
        materialCategory: 'ALCHEMY_QI' as const,
        rarity: 'COMMON' as const,
        minQty: 1,
        maxQty: 1,
        baseChance: 1,
        source: 'BOSS' as const,
        maxDailyQty: 2,
        enabled: true,
      },
    ];
    const ctx: DropRollContext = {
      playerRealmOrder: 5,
      sourceTier: 1,
      monsterType: 'BOSS',
      source: 'BOSS',
      rng: () => 0.0,
    };
    const out = rollDropEconomyMaterials(ctx, cappedRules, 10);
    const total = out.reduce((acc, r) => acc + r.qty, 0);
    expect(total).toBeLessThanOrEqual(2);
  });
});

describe('Balance simulation — Trúc Cơ scenarios (10k rolls)', () => {
  const N = 10000;
  const trucCoOrder = realmByKey('truc_co')!.order;
  const trucCoTier = realmOrderToMaterialTier(trucCoOrder);

  function simulate(
    monsterType: DropMonsterType,
    source: DropRollContext['source'],
    playerOrder: number,
    sourceTier: number,
  ): Map<number, number> {
    const counts = new Map<number, number>();
    let rngI = 0;
    const rng = () => {
      // Use Math.random — we want statistical distribution, not deterministic
      rngI++;
      return Math.random();
    };
    for (let i = 0; i < N; i++) {
      const res = rollDropEconomyMaterial({
        playerRealmOrder: playerOrder,
        sourceTier,
        monsterType,
        source,
        rng,
      });
      if (!res) continue;
      counts.set(res.materialTier, (counts.get(res.materialTier) ?? 0) + 1);
    }
    return counts;
  }

  it('Trúc Cơ farm NORMAL Trúc Cơ: tier 4+ = 0, tier 3 cực thấp', () => {
    const counts = simulate('NORMAL', 'NORMAL_MONSTER', trucCoOrder, trucCoTier);
    const tier4Plus = (counts.get(4) ?? 0) + (counts.get(5) ?? 0);
    expect(tier4Plus).toBe(0);
    const total = Array.from(counts.values()).reduce((a, b) => a + b, 0);
    const tier3 = counts.get(3) ?? 0;
    if (total > 0) {
      // tier 3 should be < 5% of drops (weight 0.01 / sum ≈ 0.01).
      expect(tier3 / total).toBeLessThan(0.05);
    }
  });

  it('Trúc Cơ farm ELITE Trúc Cơ: tier 4+ = 0, tier 3 thấp', () => {
    const counts = simulate('ELITE', 'ELITE', trucCoOrder, trucCoTier);
    const tier4Plus = (counts.get(4) ?? 0) + (counts.get(5) ?? 0);
    expect(tier4Plus).toBe(0);
    const total = Array.from(counts.values()).reduce((a, b) => a + b, 0);
    const tier3 = counts.get(3) ?? 0;
    if (total > 0) {
      expect(tier3 / total).toBeLessThan(0.1);
    }
  });

  it('Trúc Cơ farm BOSS Trúc Cơ: tier 2 chính, tier 4 cực hiếm (≤ 1%)', () => {
    const counts = simulate('BOSS', 'BOSS', trucCoOrder, trucCoTier);
    const total = Array.from(counts.values()).reduce((a, b) => a + b, 0);
    if (total > 0) {
      const tier2 = counts.get(2) ?? 0;
      const tier4 = counts.get(4) ?? 0;
      // Tier 2 should be modal.
      expect(tier2 / total).toBeGreaterThan(0.3);
      expect(tier4 / total).toBeLessThanOrEqual(0.02);
    }
  });

  it('Đại Thừa player farm Trúc Cơ map → no tier ≥ 6 drops', () => {
    const daiThuaOrder = realmByKey('dai_thua')!.order;
    const counts = simulate('NORMAL', 'NORMAL_MONSTER', daiThuaOrder, trucCoTier);
    for (let t = 6; t <= 9; t++) {
      expect(counts.get(t) ?? 0).toBe(0);
    }
  });

  it('ARTIFACT_CRAFT rate < ALCHEMY_QI rate (category multiplier check)', () => {
    expect(getMaterialCategoryMultiplier('ARTIFACT_CRAFT')).toBeLessThan(
      getMaterialCategoryMultiplier('ALCHEMY_QI'),
    );
  });
});

describe('legacy monster type inference', () => {
  it('BEAST/HUMANOID/SPIRIT → NORMAL', () => {
    expect(inferDropMonsterType('BEAST')).toBe('NORMAL');
    expect(inferDropMonsterType('HUMANOID')).toBe('NORMAL');
    expect(inferDropMonsterType('SPIRIT')).toBe('NORMAL');
  });
  it('ELITE → ELITE, BOSS → BOSS', () => {
    expect(inferDropMonsterType('ELITE')).toBe('ELITE');
    expect(inferDropMonsterType('BOSS')).toBe('BOSS');
  });
  it('undefined → NORMAL', () => {
    expect(inferDropMonsterType(undefined)).toBe('NORMAL');
  });
});

describe('inferSourceTierFromLevel', () => {
  it('level 5 → tier 1, level 50 → tier 4, level 300 → tier 9', () => {
    expect(inferSourceTierFromLevel(5)).toBe(1);
    expect(inferSourceTierFromLevel(50)).toBe(4);
    expect(inferSourceTierFromLevel(300)).toBe(9);
  });
});

describe('getMaterialSourceHints', () => {
  it('returns prioritized source list for a material item', () => {
    // Pick a known Phase 26.1 material with multiple sourceHints.
    const item = itemByKey('huyet_tinh_nho_t1');
    expect(item, 'huyet_tinh_nho_t1 must exist').toBeDefined();
    const hints = getMaterialSourceHints('huyet_tinh_nho_t1');
    expect(hints.length).toBeGreaterThan(0);
    // First entry's source should be priority-ordered (BOSS/WORLD_BOSS first,
    // ELITE before NORMAL).
    const idxOf = (s: string) => hints.findIndex((h) => h.source === s);
    const elite = idxOf('ELITE');
    const normal = idxOf('NORMAL_MONSTER');
    if (elite !== -1 && normal !== -1) {
      expect(elite).toBeLessThan(normal);
    }
  });

  it('returns empty for unknown item', () => {
    expect(getMaterialSourceHints('not_an_item').length).toBe(0);
  });
});
