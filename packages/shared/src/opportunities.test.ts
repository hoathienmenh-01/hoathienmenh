import { describe, expect, it } from 'vitest';
import { MAP_REGIONS } from './map-regions';
import {
  OPPORTUNITIES,
  OPPORTUNITY_RARITIES,
  OPPORTUNITY_RISK_LEVELS,
  getOpportunitiesByRarity,
  getOpportunitiesByRegion,
  getOpportunityByKey,
  getOpportunityRarityDailyCap,
  isRewardWithinRarityCap,
} from './opportunities';

describe('opportunities — catalog integrity', () => {
  it('key unique', () => {
    const keys = OPPORTUNITIES.map((o) => o.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('regionKey thuộc MAP_REGIONS', () => {
    const known = new Set(MAP_REGIONS.map((r) => r.key));
    for (const o of OPPORTUNITIES) {
      expect(known.has(o.regionKey)).toBe(true);
    }
  });

  it('rarity thuộc OPPORTUNITY_RARITIES', () => {
    const allowed = new Set(OPPORTUNITY_RARITIES);
    for (const o of OPPORTUNITIES) {
      expect(allowed.has(o.rarity)).toBe(true);
    }
  });

  it('riskLevel thuộc OPPORTUNITY_RISK_LEVELS', () => {
    const allowed = new Set(OPPORTUNITY_RISK_LEVELS);
    for (const o of OPPORTUNITIES) {
      expect(allowed.has(o.riskLevel)).toBe(true);
    }
  });

  it('triggerChance ∈ (0..1]', () => {
    for (const o of OPPORTUNITIES) {
      expect(o.triggerChance).toBeGreaterThan(0);
      expect(o.triggerChance).toBeLessThanOrEqual(1);
    }
  });

  it('maxDailyTriggers ≥ 1', () => {
    for (const o of OPPORTUNITIES) {
      expect(o.maxDailyTriggers).toBeGreaterThanOrEqual(1);
    }
  });

  it('RARE & EPIC bắt buộc có maxWeeklyTriggers', () => {
    for (const o of OPPORTUNITIES) {
      if (o.rarity === 'RARE' || o.rarity === 'EPIC') {
        expect(o.maxWeeklyTriggers, `${o.key} ${o.rarity} thiếu weekly cap`).toBeGreaterThanOrEqual(1);
      }
    }
  });

  it('Mỗi opportunity có ≥ 2 choices (player phải có option)', () => {
    for (const o of OPPORTUNITIES) {
      expect(o.choices.length, `${o.key} thiếu choice`).toBeGreaterThanOrEqual(2);
    }
  });

  it('Bao phủ đủ 4 rarity', () => {
    for (const r of OPPORTUNITY_RARITIES) {
      const ops = getOpportunitiesByRarity(r);
      expect(ops.length, `rarity ${r} thiếu seed`).toBeGreaterThanOrEqual(1);
    }
  });
});

describe('opportunities — getOpportunityRarityDailyCap (anti-P2W)', () => {
  it('COMMON daily=5, weekly=null', () => {
    expect(getOpportunityRarityDailyCap('COMMON')).toEqual({ daily: 5, weekly: null });
  });

  it('UNCOMMON daily=3, weekly=null', () => {
    expect(getOpportunityRarityDailyCap('UNCOMMON')).toEqual({ daily: 3, weekly: null });
  });

  it('RARE daily=1, weekly=5', () => {
    expect(getOpportunityRarityDailyCap('RARE')).toEqual({ daily: 1, weekly: 5 });
  });

  it('EPIC daily=1, weekly=1', () => {
    expect(getOpportunityRarityDailyCap('EPIC')).toEqual({ daily: 1, weekly: 1 });
  });

  it('Cap monotonic: COMMON daily ≥ UNCOMMON daily ≥ RARE daily ≥ EPIC daily', () => {
    const c = getOpportunityRarityDailyCap('COMMON').daily;
    const u = getOpportunityRarityDailyCap('UNCOMMON').daily;
    const r = getOpportunityRarityDailyCap('RARE').daily;
    const e = getOpportunityRarityDailyCap('EPIC').daily;
    expect(c).toBeGreaterThanOrEqual(u);
    expect(u).toBeGreaterThanOrEqual(r);
    expect(r).toBeGreaterThanOrEqual(e);
  });
});

describe('opportunities — isRewardWithinRarityCap (anti-P2W)', () => {
  it('COMMON cấm tienNgoc và linhThach ≤ 100', () => {
    expect(isRewardWithinRarityCap('COMMON', { linhThach: 100 })).toBe(true);
    expect(isRewardWithinRarityCap('COMMON', { linhThach: 101 })).toBe(false);
    expect(isRewardWithinRarityCap('COMMON', { linhThach: 50, tienNgoc: 1 })).toBe(false);
  });

  it('UNCOMMON cấm tienNgoc và linhThach ≤ 250', () => {
    expect(isRewardWithinRarityCap('UNCOMMON', { linhThach: 250 })).toBe(true);
    expect(isRewardWithinRarityCap('UNCOMMON', { linhThach: 300 })).toBe(false);
    expect(isRewardWithinRarityCap('UNCOMMON', { tienNgoc: 1 })).toBe(false);
  });

  it('RARE tienNgoc ≤ 1, linhThach ≤ 500', () => {
    expect(isRewardWithinRarityCap('RARE', { linhThach: 500, tienNgoc: 1 })).toBe(true);
    expect(isRewardWithinRarityCap('RARE', { linhThach: 600 })).toBe(false);
    expect(isRewardWithinRarityCap('RARE', { tienNgoc: 2 })).toBe(false);
  });

  it('EPIC tienNgoc ≤ 3, linhThach ≤ 1000', () => {
    expect(isRewardWithinRarityCap('EPIC', { linhThach: 1000, tienNgoc: 3 })).toBe(true);
    expect(isRewardWithinRarityCap('EPIC', { linhThach: 1200 })).toBe(false);
    expect(isRewardWithinRarityCap('EPIC', { tienNgoc: 5 })).toBe(false);
  });

  it('Mọi choice trong catalog reward phải pass anti-P2W cap', () => {
    for (const o of OPPORTUNITIES) {
      for (const c of o.choices) {
        expect(
          isRewardWithinRarityCap(o.rarity, c.reward),
          `${o.key}/${c.key} (rarity=${o.rarity}) reward vượt cap`,
        ).toBe(true);
      }
    }
  });
});

describe('opportunities — indexing helpers', () => {
  it('getOpportunityByKey undefined when not found', () => {
    expect(getOpportunityByKey('does_not_exist')).toBeUndefined();
  });

  it('getOpportunitiesByRegion trả đúng tập', () => {
    const sonCoc = getOpportunitiesByRegion('son_coc');
    for (const o of sonCoc) expect(o.regionKey).toBe('son_coc');
  });
});
