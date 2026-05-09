/**
 * Phase 14.0.E — Territory Owner Reward catalog invariant tests.
 *
 * Cover:
 *   - validator returns [] cho catalog hiện tại.
 *   - mọi region trong MAP_REGIONS có entry tương ứng (parity).
 *   - mọi entry có regionKey hợp lệ + reward > 0.
 *   - linhThach / exp / item qty trong cap.
 *   - itemKey tham chiếu ITEMS catalog (không gãy).
 *   - không duplicate region / item entry.
 *   - helper deterministic: territoryOwnerRewardByRegion + has-value.
 */
import { describe, expect, it } from 'vitest';
import { itemByKey, MAP_REGIONS } from './index';
import {
  TERRITORY_OWNER_REWARDS,
  TERRITORY_OWNER_REWARD_EXP_CAP,
  TERRITORY_OWNER_REWARD_ITEM_ENTRIES_CAP,
  TERRITORY_OWNER_REWARD_ITEM_QTY_CAP,
  TERRITORY_OWNER_REWARD_LINH_THACH_CAP,
  territoryOwnerRewardByRegion,
  territoryOwnerRewardHasValue,
  validateTerritoryOwnerRewardCatalog,
} from './territory-owner-reward';

describe('TERRITORY_OWNER_REWARDS catalog invariants', () => {
  it('validator returns no errors', () => {
    expect(validateTerritoryOwnerRewardCatalog()).toEqual([]);
  });

  it('parity 1-1 with MAP_REGIONS (every region has reward entry)', () => {
    const rewardKeys = new Set(TERRITORY_OWNER_REWARDS.map((r) => r.regionKey));
    for (const r of MAP_REGIONS) {
      expect(rewardKeys.has(r.key)).toBe(true);
    }
    expect(rewardKeys.size).toBe(MAP_REGIONS.length);
  });

  it('every reward has at least one positive value (linhThach / exp / items)', () => {
    for (const def of TERRITORY_OWNER_REWARDS) {
      expect(territoryOwnerRewardHasValue(def)).toBe(true);
    }
  });

  it('caps respected — linhThach / exp / items', () => {
    for (const def of TERRITORY_OWNER_REWARDS) {
      expect(def.linhThach).toBeGreaterThanOrEqual(0);
      expect(def.linhThach).toBeLessThanOrEqual(
        TERRITORY_OWNER_REWARD_LINH_THACH_CAP,
      );
      expect(def.exp).toBeGreaterThanOrEqual(0);
      expect(def.exp).toBeLessThanOrEqual(TERRITORY_OWNER_REWARD_EXP_CAP);
      expect(def.itemRewards.length).toBeLessThanOrEqual(
        TERRITORY_OWNER_REWARD_ITEM_ENTRIES_CAP,
      );
      for (const it of def.itemRewards) {
        expect(it.qty).toBeGreaterThan(0);
        expect(it.qty).toBeLessThanOrEqual(
          TERRITORY_OWNER_REWARD_ITEM_QTY_CAP,
        );
      }
    }
  });

  it('every itemKey resolves in ITEMS catalog', () => {
    for (const def of TERRITORY_OWNER_REWARDS) {
      for (const it of def.itemRewards) {
        expect(itemByKey(it.itemKey)).toBeTruthy();
      }
    }
  });

  it('no duplicate region entries', () => {
    const seen = new Set<string>();
    for (const def of TERRITORY_OWNER_REWARDS) {
      expect(seen.has(def.regionKey)).toBe(false);
      seen.add(def.regionKey);
    }
  });

  it('no duplicate item entries within a region', () => {
    for (const def of TERRITORY_OWNER_REWARDS) {
      const seen = new Set<string>();
      for (const it of def.itemRewards) {
        expect(seen.has(it.itemKey)).toBe(false);
        seen.add(it.itemKey);
      }
    }
  });

  it('subject/body localized fallback strings non-empty (vi/en)', () => {
    for (const def of TERRITORY_OWNER_REWARDS) {
      expect(def.subjectVi.trim().length).toBeGreaterThan(0);
      expect(def.subjectEn.trim().length).toBeGreaterThan(0);
      expect(def.bodyVi.trim().length).toBeGreaterThan(0);
      expect(def.bodyEn.trim().length).toBeGreaterThan(0);
    }
  });

  it('territoryOwnerRewardByRegion lookup is deterministic + miss returns undefined', () => {
    expect(territoryOwnerRewardByRegion('son_coc')?.regionKey).toBe('son_coc');
    expect(territoryOwnerRewardByRegion('cuu_la_dien')?.regionKey).toBe(
      'cuu_la_dien',
    );
    expect(territoryOwnerRewardByRegion('not_a_region')).toBeUndefined();
  });
});
