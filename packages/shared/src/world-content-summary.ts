/**
 * Phase 26.5 — World Content summary helper.
 *
 * Tổng hợp catalog count theo khu vực — phục vụ admin/dev kiểm soát content
 * không bị thiếu (Phần 1 spec: getWorldContentSummary()).
 *
 * Pure aggregation — không Prisma, không runtime.
 */
import { FARM_MAPS } from './farm-maps';
import { DUNGEONS } from './combat';
import { STORY_DUNGEONS } from './story-dungeons';
import { MAP_REGIONS, type RegionKey } from './map-regions';
import { MONSTERS } from './combat';
import { mapV1MonsterTypeToV2 } from './monster-taxonomy';
import { DUNGEONS_V2 } from './world-dungeons-v2';
import { BOSSES_V2 } from './world-bosses-v2';
import { SECT_DUNGEONS, SECT_BOSSES } from './sect-content';
import { TRIAL_TOWERS } from './trial-towers';
import { OPPORTUNITIES } from './opportunities';

// ───────────────────────────────────────────────────────────────────────────
// Types
// ───────────────────────────────────────────────────────────────────────────

export interface WorldContentRegionSummary {
  regionKey: RegionKey;
  farmMaps: number;
  dungeons: number;
  storyDungeons: number;
  bosses: number;
  worldBosses: number;
  eventBosses: number;
  questBosses: number;
  hiddenBosses: number;
  trialBosses: number;
  monsters: number;
  eliteMonsters: number;
  opportunities: number;
}

export interface WorldContentSummary {
  totalRegions: number;
  totalFarmMaps: number;
  totalDungeons: number;
  totalDungeonsV2: number;
  totalStoryDungeons: number;
  totalSectDungeons: number;
  totalTrialTowers: number;
  totalBosses: number;
  totalWorldBosses: number;
  totalEventBosses: number;
  totalSectBosses: number;
  totalQuestBosses: number;
  totalHiddenBosses: number;
  totalTrialBosses: number;
  totalMonsters: number;
  totalEliteMonsters: number;
  totalOpportunities: number;
  contentByRegion: readonly WorldContentRegionSummary[];
}

// ───────────────────────────────────────────────────────────────────────────
// Aggregator
// ───────────────────────────────────────────────────────────────────────────

/**
 * `enabledOnly=true` (default) — chỉ count content `enabled=true`.
 * Set `false` để count toàn bộ catalog (admin/dev).
 */
export function getWorldContentSummary(
  opts: { enabledOnly?: boolean } = {},
): WorldContentSummary {
  const enabledOnly = opts.enabledOnly ?? true;
  const checkEnabled = <T extends { enabled: boolean }>(arr: readonly T[]) =>
    enabledOnly ? arr.filter((x) => x.enabled) : arr;

  const farmMaps = checkEnabled(FARM_MAPS);
  const dungeonsV2 = checkEnabled(DUNGEONS_V2);
  const sectDungeons = checkEnabled(SECT_DUNGEONS);
  const trialTowers = checkEnabled(TRIAL_TOWERS);
  const bossesV2 = checkEnabled(BOSSES_V2);
  const sectBosses = checkEnabled(SECT_BOSSES);
  const opportunities = checkEnabled(OPPORTUNITIES);

  const worldBosses = bossesV2.filter((b) => b.category === 'WORLD_BOSS').length;
  const eventBosses = bossesV2.filter((b) => b.category === 'EVENT_BOSS').length;
  const questBosses = bossesV2.filter(
    (b) => b.category === 'MAIN_QUEST_BOSS' || b.category === 'SIDE_QUEST_BOSS',
  ).length;
  const hiddenBosses = bossesV2.filter((b) => b.category === 'HIDDEN_BOSS').length;
  const trialBosses = bossesV2.filter((b) => b.category === 'TRIAL_BOSS').length;

  // Monster count V1 (legacy combat catalog). V2 taxonomy mapped via
  // mapV1MonsterTypeToV2.
  const totalMonsters = MONSTERS.length;
  const totalEliteMonsters = MONSTERS.filter(
    (m) => mapV1MonsterTypeToV2(m.monsterType) === 'ELITE',
  ).length;

  // Per-region rollup
  const contentByRegion: WorldContentRegionSummary[] = MAP_REGIONS.map((region) => {
    const inRegion = (entry: { regionKey?: RegionKey | string | null }) =>
      entry.regionKey === region.key;

    const regionFarmMaps = farmMaps.filter(inRegion).length;
    const regionDungeons = dungeonsV2.filter(inRegion).length;
    const regionStoryDungeons = STORY_DUNGEONS.filter(inRegion).length;
    const regionBosses = bossesV2.filter(inRegion);
    const regionMonsters = MONSTERS.filter((m) => m.regionKey === region.key);

    return {
      regionKey: region.key,
      farmMaps: regionFarmMaps,
      dungeons: regionDungeons,
      storyDungeons: regionStoryDungeons,
      bosses: regionBosses.length,
      worldBosses: regionBosses.filter((b) => b.category === 'WORLD_BOSS').length,
      eventBosses: regionBosses.filter((b) => b.category === 'EVENT_BOSS').length,
      questBosses: regionBosses.filter(
        (b) => b.category === 'MAIN_QUEST_BOSS' || b.category === 'SIDE_QUEST_BOSS',
      ).length,
      hiddenBosses: regionBosses.filter((b) => b.category === 'HIDDEN_BOSS').length,
      trialBosses: regionBosses.filter((b) => b.category === 'TRIAL_BOSS').length,
      monsters: regionMonsters.length,
      eliteMonsters: regionMonsters.filter(
        (m) => mapV1MonsterTypeToV2(m.monsterType) === 'ELITE',
      ).length,
      opportunities: opportunities.filter(inRegion).length,
    };
  });

  return {
    totalRegions: MAP_REGIONS.length,
    totalFarmMaps: farmMaps.length,
    totalDungeons: DUNGEONS.length,
    totalDungeonsV2: dungeonsV2.length,
    totalStoryDungeons: STORY_DUNGEONS.length,
    totalSectDungeons: sectDungeons.length,
    totalTrialTowers: trialTowers.length,
    totalBosses: bossesV2.length,
    totalWorldBosses: worldBosses,
    totalEventBosses: eventBosses,
    totalSectBosses: sectBosses.length,
    totalQuestBosses: questBosses,
    totalHiddenBosses: hiddenBosses,
    totalTrialBosses: trialBosses,
    totalMonsters,
    totalEliteMonsters,
    totalOpportunities: opportunities.length,
    contentByRegion,
  };
}
