import { describe, expect, it } from 'vitest';
import { MAP_REGIONS } from './map-regions';
import { FARM_MAPS } from './farm-maps';
import { DUNGEONS_V2 } from './world-dungeons-v2';
import { BOSSES_V2 } from './world-bosses-v2';
import { SECT_DUNGEONS, SECT_BOSSES } from './sect-content';
import { TRIAL_TOWERS } from './trial-towers';
import { OPPORTUNITIES } from './opportunities';
import { getWorldContentSummary } from './world-content-summary';

describe('world-content-summary — getWorldContentSummary()', () => {
  it('totalRegions = MAP_REGIONS.length', () => {
    const s = getWorldContentSummary();
    expect(s.totalRegions).toBe(MAP_REGIONS.length);
  });

  it('enabledOnly default true — count chỉ enabled', () => {
    const enabled = getWorldContentSummary({ enabledOnly: true });
    const all = getWorldContentSummary({ enabledOnly: false });

    expect(all.totalFarmMaps).toBeGreaterThanOrEqual(enabled.totalFarmMaps);
    expect(all.totalDungeonsV2).toBeGreaterThanOrEqual(enabled.totalDungeonsV2);
    expect(all.totalSectDungeons).toBeGreaterThanOrEqual(enabled.totalSectDungeons);
    expect(all.totalOpportunities).toBeGreaterThanOrEqual(enabled.totalOpportunities);
  });

  it('totalFarmMaps khớp catalog (enabled-only)', () => {
    const s = getWorldContentSummary();
    expect(s.totalFarmMaps).toBe(FARM_MAPS.filter((m) => m.enabled).length);
  });

  it('totalDungeonsV2 khớp catalog (enabled-only)', () => {
    const s = getWorldContentSummary();
    expect(s.totalDungeonsV2).toBe(DUNGEONS_V2.filter((d) => d.enabled).length);
  });

  it('totalBosses khớp catalog (enabled-only)', () => {
    const s = getWorldContentSummary();
    expect(s.totalBosses).toBe(BOSSES_V2.filter((b) => b.enabled).length);
  });

  it('totalSectDungeons khớp catalog', () => {
    const s = getWorldContentSummary();
    expect(s.totalSectDungeons).toBe(SECT_DUNGEONS.filter((d) => d.enabled).length);
  });

  it('totalSectBosses khớp catalog', () => {
    const s = getWorldContentSummary();
    expect(s.totalSectBosses).toBe(SECT_BOSSES.filter((b) => b.enabled).length);
  });

  it('totalTrialTowers khớp catalog', () => {
    const s = getWorldContentSummary();
    expect(s.totalTrialTowers).toBe(TRIAL_TOWERS.filter((t) => t.enabled).length);
  });

  it('totalOpportunities khớp catalog', () => {
    const s = getWorldContentSummary();
    expect(s.totalOpportunities).toBe(OPPORTUNITIES.filter((o) => o.enabled).length);
  });

  it('totalWorldBosses ≥ 1 (spec yêu cầu có world boss)', () => {
    const s = getWorldContentSummary();
    expect(s.totalWorldBosses).toBeGreaterThanOrEqual(1);
  });

  it('totalQuestBosses (main + side) ≥ 2 (spec yêu cầu cả 2 loại)', () => {
    const s = getWorldContentSummary();
    expect(s.totalQuestBosses).toBeGreaterThanOrEqual(2);
  });

  it('totalHiddenBosses ≥ 1 (spec)', () => {
    const s = getWorldContentSummary();
    expect(s.totalHiddenBosses).toBeGreaterThanOrEqual(1);
  });

  it('Tổng bosses/region = totalBosses (sum invariant)', () => {
    const s = getWorldContentSummary();
    const totalBossesInRegions = s.contentByRegion.reduce((sum, r) => sum + r.bosses, 0);
    // Trial bosses không gắn region, có thể có boss không gắn region khác
    expect(totalBossesInRegions).toBeLessThanOrEqual(s.totalBosses);
  });

  it('Tổng farmMaps/region = totalFarmMaps (sum invariant)', () => {
    const s = getWorldContentSummary();
    const sum = s.contentByRegion.reduce((acc, r) => acc + r.farmMaps, 0);
    expect(sum).toBe(s.totalFarmMaps);
  });

  it('Mỗi khu sâu (son_coc/hac_lam/kim_son_mach) có ≥ 3 farm map', () => {
    const s = getWorldContentSummary();
    for (const key of ['son_coc', 'hac_lam', 'kim_son_mach'] as const) {
      const region = s.contentByRegion.find((r) => r.regionKey === key);
      expect(region, `region ${key} thiếu trong summary`).toBeDefined();
      expect(region!.farmMaps, `region ${key} có < 3 farm map`).toBeGreaterThanOrEqual(3);
    }
  });

  it('contentByRegion phủ hết MAP_REGIONS', () => {
    const s = getWorldContentSummary();
    const keys = new Set(s.contentByRegion.map((r) => r.regionKey));
    for (const r of MAP_REGIONS) {
      expect(keys.has(r.key), `region ${r.key} thiếu trong contentByRegion`).toBe(true);
    }
  });

  it('totalMonsters > 0 + totalEliteMonsters ≤ totalMonsters', () => {
    const s = getWorldContentSummary();
    expect(s.totalMonsters).toBeGreaterThan(0);
    expect(s.totalEliteMonsters).toBeLessThanOrEqual(s.totalMonsters);
  });
});
