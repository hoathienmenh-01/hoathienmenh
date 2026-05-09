import { describe, it, expect } from 'vitest';
import {
  NPC_GIFT_PREFERENCES,
  NPC_GIFT_AFFINITY_DELTA_CAP_PER_GIFT,
  NPC_GIFT_DAILY_LIMIT_CAP,
  npcGiftPreferenceForKey,
  acceptedGiftItemFor,
  computeGiftAffinityDelta,
  validateNpcGiftCatalog,
} from './npc-gift';
import { NPC_AFFINITY } from './npc-affinity';

/**
 * Phase 12.10.B — NPC gift catalog invariants.
 *
 * Mục tiêu: pin-down các điểm dễ break (catalog drift, item key sai chính tả,
 * delta vượt cap, NPC mồ côi không có affinity catalog).
 */
describe('npc-gift catalog', () => {
  it('validateNpcGiftCatalog returns no errors for shipped catalog', () => {
    const errs = validateNpcGiftCatalog();
    expect(errs).toEqual([]);
  });

  it('every gift entry maps to NPC_AFFINITY catalog (no orphan)', () => {
    const affinityKeys = new Set(NPC_AFFINITY.map((n) => n.npcKey));
    for (const def of NPC_GIFT_PREFERENCES) {
      expect(
        affinityKeys.has(def.npcKey),
        `gift def ${def.npcKey} missing from NPC_AFFINITY`,
      ).toBe(true);
    }
  });

  it('npcGiftPreferenceForKey resolves known + unknown', () => {
    expect(npcGiftPreferenceForKey('npc_lang_van_sinh')?.dailyLimit).toBe(3);
    expect(npcGiftPreferenceForKey('npc_does_not_exist')).toBeUndefined();
  });

  it('acceptedGiftItemFor resolves only listed items per NPC', () => {
    const okEntry = acceptedGiftItemFor('npc_lang_van_sinh', 'linh_lo_dan');
    expect(okEntry?.affinityMin).toBe(5);
    expect(acceptedGiftItemFor('npc_lang_van_sinh', 'so_kiem')).toBeUndefined();
    expect(acceptedGiftItemFor('npc_unknown', 'linh_lo_dan')).toBeUndefined();
  });

  it('computeGiftAffinityDelta returns midpoint floor', () => {
    expect(
      computeGiftAffinityDelta({
        itemKey: 'x',
        affinityMin: 5,
        affinityMax: 7,
        flavor: '',
        flavorEn: '',
      }),
    ).toBe(6);
    expect(
      computeGiftAffinityDelta({
        itemKey: 'x',
        affinityMin: 4,
        affinityMax: 6,
        flavor: '',
        flavorEn: '',
      }),
    ).toBe(5);
  });

  it('every accepted item delta ≤ NPC_GIFT_AFFINITY_DELTA_CAP_PER_GIFT (8)', () => {
    for (const def of NPC_GIFT_PREFERENCES) {
      for (const it of def.acceptedItems) {
        expect(it.affinityMax).toBeLessThanOrEqual(
          NPC_GIFT_AFFINITY_DELTA_CAP_PER_GIFT,
        );
        expect(it.affinityMin).toBeLessThanOrEqual(it.affinityMax);
        expect(it.affinityMin).toBeGreaterThanOrEqual(1);
      }
    }
  });

  it('every dailyLimit ≤ NPC_GIFT_DAILY_LIMIT_CAP (5) and ≥ 1', () => {
    for (const def of NPC_GIFT_PREFERENCES) {
      expect(def.dailyLimit).toBeGreaterThanOrEqual(1);
      expect(def.dailyLimit).toBeLessThanOrEqual(NPC_GIFT_DAILY_LIMIT_CAP);
    }
  });

  it('no duplicate npcKey across gift catalog', () => {
    const keys = NPC_GIFT_PREFERENCES.map((d) => d.npcKey);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('no duplicate itemKey within a single NPC accepted list', () => {
    for (const def of NPC_GIFT_PREFERENCES) {
      const keys = def.acceptedItems.map((i) => i.itemKey);
      expect(new Set(keys).size, `${def.npcKey} has dup accepted items`).toBe(
        keys.length,
      );
    }
  });
});
