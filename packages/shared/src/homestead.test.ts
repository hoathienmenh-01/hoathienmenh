import { describe, expect, it } from 'vitest';
import {
  HOMESTEAD_CROPS,
  HOMESTEAD_GARDEN_PRODUCTIONS,
  HOMESTEAD_LEVELS,
  canUseHomesteadTier,
  homesteadOfflineRegenEnergy,
  validateHomesteadCatalog,
} from './homestead';

describe('homestead catalog', () => {
  it('validates without catalog errors', () => {
    expect(validateHomesteadCatalog()).toEqual([]);
  });

  it('has bounded production caps for every crop and garden recipe', () => {
    for (const crop of HOMESTEAD_CROPS) {
      expect(crop.dailyCapQty).toBeGreaterThanOrEqual(crop.yieldQty);
      expect(crop.dailyCapQty).toBeLessThanOrEqual(24);
    }
    for (const prod of HOMESTEAD_GARDEN_PRODUCTIONS) {
      expect(prod.dailyCapQty).toBeGreaterThanOrEqual(prod.yieldQty);
      expect(prod.dailyCapQty).toBeLessThanOrEqual(prod.rare ? 2 : 8);
    }
  });

  it('increases slots and storage through levels without unbounded growth', () => {
    for (let i = 1; i < HOMESTEAD_LEVELS.length; i += 1) {
      expect(HOMESTEAD_LEVELS[i]!.fieldSlots).toBeGreaterThanOrEqual(
        HOMESTEAD_LEVELS[i - 1]!.fieldSlots,
      );
      expect(HOMESTEAD_LEVELS[i]!.storageCap).toBeGreaterThan(
        HOMESTEAD_LEVELS[i - 1]!.storageCap,
      );
    }
  });

  it('caps offline spiritual energy regeneration', () => {
    const updatedAt = new Date('2026-01-01T00:00:00.000Z');
    const now = new Date('2026-01-02T00:00:00.000Z');
    const regen = homesteadOfflineRegenEnergy({
      currentEnergy: 0,
      updatedAt,
      now,
      storageCap: 999,
    });
    expect(regen.energy).toBe(80);
  });

  it('enforces tier cap by homestead level and realm', () => {
    expect(canUseHomesteadTier(2, { homesteadLevel: 1, realmKey: 'truc_co' })).toEqual({
      allowed: false,
      reason: 'HOMESTEAD_LEVEL_TOO_LOW',
    });
    expect(canUseHomesteadTier(2, { homesteadLevel: 2, realmKey: 'luyenkhi' })).toEqual({
      allowed: false,
      reason: 'REALM_TOO_LOW',
    });
    expect(canUseHomesteadTier(2, { homesteadLevel: 2, realmKey: 'truc_co' })).toEqual({
      allowed: true,
      reason: null,
    });
  });
});
