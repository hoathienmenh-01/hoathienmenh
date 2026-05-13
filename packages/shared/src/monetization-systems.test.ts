/**
 * Phase 27.1–27.5 — Monetization Systems V1 catalog invariants.
 *
 * Test này chống regression catalog: nếu PR sau cố thêm endgame item,
 * vượt cap, hoặc duplicate key sẽ FAIL.
 */
import { describe, it, expect } from 'vitest';
import {
  BATTLE_PASS_MISSIONS_V1,
  BATTLE_PASS_MISSION_EXP_CAP,
  BATTLE_PASS_MAX_MISSIONS_PER_SCOPE,
  BATTLE_PASS_PAID_UNLOCK_PRODUCT_KEY,
  GROWTH_FUND_V2_VARIANTS,
  LIMITED_SHOP_ITEMS,
  LIMITED_SHOP_KEYS,
  LIMITED_SHOP_PERIOD_BY_KEY,
  SWEEP_TICKET_ITEM_KEYS,
  clampMissionProgress,
  getBattlePassMission,
  getBattlePassMissionsByScope,
  getBattlePassMissionsBySource,
  getGrowthFundV2Variant,
  getGrowthFundV2Milestone,
  getLimitedShopItem,
  getLimitedShopItemsByShop,
  isMissionComplete,
  isSweepTicketItemKey,
  validateMonetizationSystemsCatalog,
} from './monetization-systems';
import { SHOP_PRODUCTS } from './monetization-foundation';

describe('Phase 27.1–27.5 — Monetization Systems V1 catalog', () => {
  it('catalog validation passes', () => {
    const result = validateMonetizationSystemsCatalog();
    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it('battle pass mission keys are unique', () => {
    const keys = BATTLE_PASS_MISSIONS_V1.map((m) => m.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('every battle pass mission expReward stays within cap', () => {
    for (const m of BATTLE_PASS_MISSIONS_V1) {
      expect(m.expReward).toBeGreaterThan(0);
      expect(m.expReward).toBeLessThanOrEqual(BATTLE_PASS_MISSION_EXP_CAP);
    }
  });

  it('battle pass missions per scope stay within UI cap', () => {
    for (const scope of ['DAILY', 'WEEKLY', 'SEASON'] as const) {
      const list = getBattlePassMissionsByScope(scope);
      expect(list.length).toBeLessThanOrEqual(BATTLE_PASS_MAX_MISSIONS_PER_SCOPE);
    }
  });

  it('battle pass paid unlock product exists in shop foundation', () => {
    const product = SHOP_PRODUCTS.find(
      (p) => p.key === BATTLE_PASS_PAID_UNLOCK_PRODUCT_KEY,
    );
    expect(product).toBeDefined();
    expect(product?.purchaseLimitType).toBe('LIFETIME');
    expect(product?.purchaseLimitCount).toBe(1);
  });

  it('getBattlePassMission returns correct mission', () => {
    const m = getBattlePassMission('bp_daily_cultivation_tick');
    expect(m).toBeDefined();
    expect(m?.scope).toBe('DAILY');
  });

  it('getBattlePassMissionsBySource returns missions sharing source', () => {
    const list = getBattlePassMissionsBySource('DUNGEON_CLEAR');
    expect(list.length).toBeGreaterThanOrEqual(2);
    expect(list.every((m) => m.source === 'DUNGEON_CLEAR')).toBe(true);
  });

  it('growth fund V2 `tien` milestones realmOrder strictly increasing', () => {
    const tien = getGrowthFundV2Variant('tien');
    expect(tien).toBeDefined();
    let lastOrder = -Infinity;
    for (const m of tien!.milestones) {
      expect(m.realmOrder).toBeGreaterThan(lastOrder);
      lastOrder = m.realmOrder;
    }
  });

  it('growth fund V2 covers Luyen Hu → Nhan Tien', () => {
    const tien = getGrowthFundV2Variant('tien')!;
    const keys = tien.milestones.map((m) => m.key);
    expect(keys).toContain('luyen_hu');
    expect(keys).toContain('nhan_tien');
  });

  it('growth fund V2 milestone lookup', () => {
    const m = getGrowthFundV2Milestone('tien', 'hop_the');
    expect(m).toBeDefined();
    expect(m?.realmOrder).toBe(7);
    expect(getGrowthFundV2Milestone('tien', 'unknown')).toBeUndefined();
    expect(getGrowthFundV2Milestone('unknown', 'hop_the')).toBeUndefined();
  });

  it('limited shop covers all three periods', () => {
    for (const shopKey of LIMITED_SHOP_KEYS) {
      const items = getLimitedShopItemsByShop(shopKey);
      expect(items.length).toBeGreaterThan(0);
      expect(items.every((it) => it.shopKey === shopKey)).toBe(true);
    }
  });

  it('limited shop period mapping is correct', () => {
    expect(LIMITED_SHOP_PERIOD_BY_KEY.DAILY_SHOP).toBe('DAILY');
    expect(LIMITED_SHOP_PERIOD_BY_KEY.WEEKLY_SHOP).toBe('WEEKLY');
    expect(LIMITED_SHOP_PERIOD_BY_KEY.MONTHLY_SHOP).toBe('MONTHLY');
  });

  it('limited shop item keys unique cross-shop', () => {
    const keys = LIMITED_SHOP_ITEMS.map((i) => i.itemKey);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('limited shop disallows forbidden endgame items', () => {
    const forbidden = ['hau_tho_tran_hon_an', 'ban_nguyen_chi_bao', 'hu_khong_chi_bao'];
    for (const item of LIMITED_SHOP_ITEMS) {
      for (const r of item.reward) {
        if (r.kind === 'item') {
          expect(forbidden).not.toContain(r.key);
        }
      }
    }
  });

  it('limited shop purchaseLimitCount stays bounded', () => {
    for (const item of LIMITED_SHOP_ITEMS) {
      expect(item.purchaseLimitCount).toBeGreaterThan(0);
      // Anti-P2W: monthly cap không quá lớn.
      if (item.shopKey === 'MONTHLY_SHOP') {
        expect(item.purchaseLimitCount).toBeLessThanOrEqual(5);
      }
    }
  });

  it('getLimitedShopItem returns single item', () => {
    const item = getLimitedShopItem('daily_sweep_dungeon');
    expect(item).toBeDefined();
    expect(item?.shopKey).toBe('DAILY_SHOP');
    expect(getLimitedShopItem('not_real')).toBeUndefined();
  });

  it('isSweepTicketItemKey discriminates', () => {
    expect(isSweepTicketItemKey('BI_CANH_TICKET')).toBe(true);
    expect(isSweepTicketItemKey('sweep_ticket_dungeon')).toBe(true);
    expect(isSweepTicketItemKey('totally_fake_item')).toBe(false);
  });

  it('sweep ticket item keys list is non-empty', () => {
    expect(SWEEP_TICKET_ITEM_KEYS.length).toBeGreaterThan(0);
  });

  it('mission progress helpers', () => {
    expect(isMissionComplete(60, 60)).toBe(true);
    expect(isMissionComplete(59, 60)).toBe(false);
    expect(isMissionComplete(Number.NaN, 60)).toBe(false);
    expect(clampMissionProgress(10, 5, 100)).toBe(15);
    expect(clampMissionProgress(95, 50, 100)).toBe(145);
    expect(clampMissionProgress(-10, 5, 100)).toBe(5);
    expect(clampMissionProgress(50, -5, 100)).toBe(50);
  });
});
