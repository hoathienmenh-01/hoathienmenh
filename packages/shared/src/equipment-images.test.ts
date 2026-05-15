import { describe, expect, it } from 'vitest';
import {
  getEquipmentImage,
  __equipmentImageTest,
} from './equipment-images';

describe('equipment-images.getEquipmentImage', () => {
  it('maps WEAPON + tier 3 → kiem3 sm', () => {
    expect(getEquipmentImage({ slot: 'WEAPON', tier: 3 })).toEqual({
      url: '/equipment/sm/kiem3.webp',
      artName: 'kiem',
      tier: 3,
      size: 'sm',
    });
  });

  it('maps ARMOR + tier 1 default size sm', () => {
    const res = getEquipmentImage({ slot: 'ARMOR', tier: 1 });
    expect(res?.url).toBe('/equipment/sm/ao1.webp');
  });

  it('maps HAT → mu and BOOTS → giay', () => {
    expect(getEquipmentImage({ slot: 'HAT', tier: 5 })?.artName).toBe('mu');
    expect(getEquipmentImage({ slot: 'BOOTS', tier: 5 })?.artName).toBe('giay');
  });

  it('maps BELT → dai and TRAM → daychuyen', () => {
    expect(getEquipmentImage({ slot: 'BELT', tier: 4 })?.artName).toBe('dai');
    expect(getEquipmentImage({ slot: 'TRAM', tier: 4 })?.artName).toBe(
      'daychuyen',
    );
  });

  it('maps ARTIFACT_1/2/3 → phapbao', () => {
    for (const slot of ['ARTIFACT_1', 'ARTIFACT_2', 'ARTIFACT_3'] as const) {
      expect(getEquipmentImage({ slot, tier: 2 })?.artName).toBe('phapbao');
    }
  });

  it('supports md size for detail view', () => {
    expect(
      getEquipmentImage({ slot: 'WEAPON', tier: 10, size: 'md' })?.url,
    ).toBe('/equipment/md/kiem10.webp');
  });

  it('clamps tier outside 1..10 range', () => {
    expect(getEquipmentImage({ slot: 'WEAPON', tier: 0 })?.tier).toBe(1);
    expect(getEquipmentImage({ slot: 'WEAPON', tier: 99 })?.tier).toBe(10);
    expect(getEquipmentImage({ slot: 'WEAPON', tier: 3.7 })?.tier).toBe(4);
  });

  it('returns null for missing slot/tier or unmapped slot', () => {
    expect(getEquipmentImage({ tier: 3 })).toBeNull();
    expect(getEquipmentImage({ slot: 'WEAPON' })).toBeNull();
    expect(getEquipmentImage({ slot: 'PILL_HP' as never, tier: 3 })).toBeNull();
  });

  it('accepts artName override for free ring/phap-bao art', () => {
    expect(
      getEquipmentImage({ artName: 'nhan', tier: 7, size: 'md' })?.url,
    ).toBe('/equipment/md/nhan7.webp');
    expect(getEquipmentImage({ artName: 'phapbao', tier: 9 })?.url).toBe(
      '/equipment/sm/phapbao9.webp',
    );
  });

  it('accepts loose lowercase slot strings used by progression helpers', () => {
    expect(getEquipmentImage({ slot: 'helmet', tier: 2 })?.artName).toBe('mu');
    expect(getEquipmentImage({ slot: 'ring', tier: 2 })?.artName).toBe('nhan');
    expect(
      getEquipmentImage({ slot: 'phap_bao', tier: 2 })?.artName,
    ).toBe('phapbao');
  });

  it('clampTier handles NaN and non-numeric input', () => {
    const { clampTier } = __equipmentImageTest;
    expect(clampTier(undefined)).toBeNull();
    expect(clampTier(NaN)).toBeNull();
    expect(clampTier(5)).toBe(5);
  });
});
