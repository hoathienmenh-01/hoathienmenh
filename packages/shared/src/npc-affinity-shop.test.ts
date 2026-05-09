/**
 * Phase 12.10.C — NPC Affinity Shop catalog invariant tests.
 */

import { describe, expect, it } from 'vitest';
import { ITEMS } from './items';
import { NPC_AFFINITY, AFFINITY_TIERS } from './npc-affinity';
import {
  NPC_AFFINITY_SHOPS,
  npcAffinityShopForNpc,
  npcAffinityShopItem,
  npcShopForAffinity,
  toNpcAffinityShopItemView,
  validateNpcAffinityShopCatalog,
} from './npc-affinity-shop';

describe('npc-affinity-shop catalog', () => {
  it('catalog passes validateNpcAffinityShopCatalog (no errors)', () => {
    expect(validateNpcAffinityShopCatalog()).toEqual([]);
  });

  it('every entry references a known item', () => {
    const itemKeys = new Set(ITEMS.map((i) => i.key));
    for (const e of NPC_AFFINITY_SHOPS) {
      expect(itemKeys.has(e.itemKey)).toBe(true);
    }
  });

  it('every NPC with NPC_AFFINITY config has at least 1 shop entry', () => {
    const seen = new Set(NPC_AFFINITY_SHOPS.map((e) => e.npcKey));
    for (const a of NPC_AFFINITY) {
      expect(seen.has(a.npcKey)).toBe(true);
    }
  });

  it('stockType=daily entries set dailyLimit, not weeklyLimit', () => {
    for (const e of NPC_AFFINITY_SHOPS) {
      if (e.stockType === 'daily') {
        expect(e.dailyLimit).toBeGreaterThanOrEqual(1);
        expect(e.dailyLimit).toBeLessThanOrEqual(30);
        expect(e.weeklyLimit).toBeUndefined();
      }
    }
  });

  it('stockType=weekly entries set weeklyLimit, not dailyLimit', () => {
    for (const e of NPC_AFFINITY_SHOPS) {
      if (e.stockType === 'weekly') {
        expect(e.weeklyLimit).toBeGreaterThanOrEqual(1);
        expect(e.weeklyLimit).toBeLessThanOrEqual(50);
        expect(e.dailyLimit).toBeUndefined();
      }
    }
  });

  it('cost is positive integer', () => {
    for (const e of NPC_AFFINITY_SHOPS) {
      expect(Number.isInteger(e.cost)).toBe(true);
      expect(e.cost).toBeGreaterThan(0);
    }
  });

  it('unlockHint and unlockHintEn non-empty (i18n parity)', () => {
    for (const e of NPC_AFFINITY_SHOPS) {
      expect(e.unlockHint.trim().length).toBeGreaterThan(0);
      expect(e.unlockHintEn.trim().length).toBeGreaterThan(0);
    }
  });

  it('per-NPC dailyLimit aggregate ≤ 30 (anti-grind)', () => {
    const sums = new Map<string, number>();
    for (const e of NPC_AFFINITY_SHOPS) {
      if (e.stockType === 'daily' && typeof e.dailyLimit === 'number') {
        sums.set(e.npcKey, (sums.get(e.npcKey) ?? 0) + e.dailyLimit);
      }
    }
    for (const total of sums.values()) {
      expect(total).toBeLessThanOrEqual(30);
    }
  });
});

describe('npcAffinityShopForNpc()', () => {
  it('returns all entries for a known NPC, regardless of tier', () => {
    const all = npcAffinityShopForNpc('npc_lang_van_sinh');
    expect(all.length).toBeGreaterThan(0);
    expect(all.every((e) => e.npcKey === 'npc_lang_van_sinh')).toBe(true);
  });

  it('returns empty list for NPC without shop entries', () => {
    expect(npcAffinityShopForNpc('npc_does_not_exist')).toEqual([]);
  });
});

describe('npcShopForAffinity()', () => {
  it('returns only entries unlocked at given tier', () => {
    // xa_la (order 0) — only xa_la-tier entries (none in current catalog).
    const xaLa = npcShopForAffinity('npc_lang_van_sinh', 'xa_la');
    for (const e of xaLa) {
      expect(['xa_la']).toContain(e.requiredAffinityTier);
    }
  });

  it('higher tier sees more entries (monotonic)', () => {
    const npc = 'npc_lang_van_sinh';
    const sizeQuenBiet = npcShopForAffinity(npc, 'quen_biet').length;
    const sizeBanHuu = npcShopForAffinity(npc, 'ban_huu').length;
    const sizeTriGiao = npcShopForAffinity(npc, 'tri_giao').length;
    expect(sizeBanHuu).toBeGreaterThanOrEqual(sizeQuenBiet);
    expect(sizeTriGiao).toBeGreaterThanOrEqual(sizeBanHuu);
  });

  it('tri_ky sees ALL entries for the NPC', () => {
    for (const npc of NPC_AFFINITY) {
      const all = npcAffinityShopForNpc(npc.npcKey);
      const tri_ky = npcShopForAffinity(npc.npcKey, 'tri_ky');
      expect(tri_ky.length).toBe(all.length);
    }
  });
});

describe('npcAffinityShopItem()', () => {
  it('returns def for known (npcKey, itemKey)', () => {
    const def = npcAffinityShopItem('npc_lang_van_sinh', 'huyet_chi_dan');
    expect(def).toBeDefined();
    expect(def?.cost).toBeGreaterThan(0);
  });

  it('returns undefined for unknown pair', () => {
    expect(npcAffinityShopItem('npc_lang_van_sinh', 'no_such_item')).toBeUndefined();
  });
});

describe('toNpcAffinityShopItemView()', () => {
  it('merges ItemDef + tier label', () => {
    const def = NPC_AFFINITY_SHOPS[0];
    const view = toNpcAffinityShopItemView(def);
    expect(view).not.toBeNull();
    expect(view?.item.key).toBe(def.itemKey);
    expect(view?.requiredTierLabel.length).toBeGreaterThan(0);
    expect(view?.requiredTierLabelEn.length).toBeGreaterThan(0);
  });

  it('returns null when itemKey is unknown (defensive)', () => {
    const fake = {
      ...NPC_AFFINITY_SHOPS[0],
      itemKey: 'no_such_item',
    };
    expect(toNpcAffinityShopItemView(fake)).toBeNull();
  });

  it('every entry can be rendered to view', () => {
    for (const def of NPC_AFFINITY_SHOPS) {
      expect(toNpcAffinityShopItemView(def)).not.toBeNull();
    }
  });
});

describe('AFFINITY_TIERS coverage in shop catalog', () => {
  it('catalog uses tier keys from AFFINITY_TIERS only', () => {
    const tierKeys = new Set(AFFINITY_TIERS.map((t) => t.key));
    for (const e of NPC_AFFINITY_SHOPS) {
      expect(tierKeys.has(e.requiredAffinityTier)).toBe(true);
    }
  });
});
