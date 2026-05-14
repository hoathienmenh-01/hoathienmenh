/* eslint-disable @typescript-eslint/no-magic-numbers -- season balance constants. */

import { isEndgameItemKey } from './reward-policy';

export const SEASON_STATUSES = [
  'UPCOMING',
  'ACTIVE',
  'ENDED',
  'ARCHIVED',
] as const;

export type SeasonStatus = (typeof SEASON_STATUSES)[number];

export const SEASON_POINT_SOURCES = [
  'DUNGEON',
  'BOSS',
  'ROGUELIKE',
  'DAILY',
  'EVENT',
  'CRAFT',
  'BREAKTHROUGH',
] as const;

export type SeasonPointSource = (typeof SEASON_POINT_SOURCES)[number];

export const SEASON_MILESTONE_METRICS = [
  'BOSS_DEFEATS',
  'DUNGEON_CLEARS',
  'ROGUELIKE_FLOORS',
  'CRAFT_COUNT',
  'BREAKTHROUGHS',
] as const;

export type SeasonMilestoneMetric = (typeof SEASON_MILESTONE_METRICS)[number];

export const SEASON_LEADERBOARD_KINDS = [
  'POINTS',
  'ROGUELIKE_FLOOR',
  'BOSS_DEFEATS',
  'DUNGEON_CLEARS',
] as const;

export type SeasonLeaderboardKind = (typeof SEASON_LEADERBOARD_KINDS)[number];

export interface SeasonPointConfig {
  dailyCap: number;
  weeklyCap: number;
  sourcePoints: Record<SeasonPointSource, number>;
}

export interface SeasonRewardItem {
  itemKey: string;
  qty: number;
}

export interface SeasonRewardDef {
  rewardKey: string;
  minPoints: number;
  titleVi: string;
  titleEn: string;
  linhThach: number;
  exp: number;
  eventToken: number;
  items: ReadonlyArray<SeasonRewardItem>;
}

export interface SeasonMilestoneDef {
  milestoneKey: string;
  metric: SeasonMilestoneMetric;
  target: number;
  titleVi: string;
  titleEn: string;
  effectKey: string;
  effectVi: string;
  effectEn: string;
}

export const DEFAULT_SEASON_POINT_CONFIG: SeasonPointConfig = Object.freeze({
  dailyCap: 500,
  weeklyCap: 2_000,
  sourcePoints: Object.freeze({
    DUNGEON: 25,
    BOSS: 40,
    ROGUELIKE: 10,
    DAILY: 20,
    EVENT: 30,
    CRAFT: 8,
    BREAKTHROUGH: 75,
  }),
});

export const DEFAULT_SEASON_REWARDS: ReadonlyArray<SeasonRewardDef> = Object.freeze([
  {
    rewardKey: 'points_100',
    minPoints: 100,
    titleVi: 'Mốc 100 điểm',
    titleEn: '100 Point Milestone',
    linhThach: 100,
    exp: 250,
    eventToken: 5,
    items: Object.freeze([]),
  },
  {
    rewardKey: 'points_300',
    minPoints: 300,
    titleVi: 'Mốc 300 điểm',
    titleEn: '300 Point Milestone',
    linhThach: 250,
    exp: 600,
    eventToken: 10,
    items: Object.freeze([{ itemKey: 'huyet_chi_dan', qty: 1 }]),
  },
  {
    rewardKey: 'points_700',
    minPoints: 700,
    titleVi: 'Mốc 700 điểm',
    titleEn: '700 Point Milestone',
    linhThach: 500,
    exp: 1_200,
    eventToken: 20,
    items: Object.freeze([{ itemKey: 'thanh_lam_dan', qty: 1 }]),
  },
]);

export const DEFAULT_SEASON_MILESTONES: ReadonlyArray<SeasonMilestoneDef> =
  Object.freeze([
    {
      milestoneKey: 'boss_defeats_50',
      metric: 'BOSS_DEFEATS',
      target: 50,
      titleVi: 'Trừ yêu toàn server I',
      titleEn: 'Server Boss Hunt I',
      effectKey: 'season_boss_spirit_i',
      effectVi: '+2% linh khí sự kiện nhỏ khi mở khóa',
      effectEn: '+2% small event spirit buff when unlocked',
    },
    {
      milestoneKey: 'roguelike_floors_500',
      metric: 'ROGUELIKE_FLOORS',
      target: 500,
      titleVi: 'Bí cảnh khai mở I',
      titleEn: 'Secret Realm Push I',
      effectKey: 'season_roguelike_hint_i',
      effectVi: 'Mở lịch buff bí cảnh nhẹ cho mùa',
      effectEn: 'Unlocks a minor roguelike buff schedule',
    },
    {
      milestoneKey: 'craft_count_300',
      metric: 'CRAFT_COUNT',
      target: 300,
      titleVi: 'Bách luyện đồng tâm I',
      titleEn: 'Server Crafting I',
      effectKey: 'season_craft_glow_i',
      effectVi: 'Mở nhắc sự kiện nghề phụ nhẹ',
      effectEn: 'Unlocks a minor crafting event prompt',
    },
  ]);

export function isSeasonPointSource(value: unknown): value is SeasonPointSource {
  return (
    typeof value === 'string' &&
    (SEASON_POINT_SOURCES as readonly string[]).includes(value)
  );
}

export function isSeasonMilestoneMetric(
  value: unknown,
): value is SeasonMilestoneMetric {
  return (
    typeof value === 'string' &&
    (SEASON_MILESTONE_METRICS as readonly string[]).includes(value)
  );
}

export function normalizeSeasonPointConfig(value: unknown): SeasonPointConfig {
  if (!value || typeof value !== 'object') return DEFAULT_SEASON_POINT_CONFIG;
  const raw = value as Partial<SeasonPointConfig>;
  const sourcePoints = { ...DEFAULT_SEASON_POINT_CONFIG.sourcePoints };
  if (raw.sourcePoints && typeof raw.sourcePoints === 'object') {
    for (const src of SEASON_POINT_SOURCES) {
      const n = Number((raw.sourcePoints as Partial<Record<SeasonPointSource, number>>)[src]);
      if (Number.isSafeInteger(n) && n >= 0 && n <= 500) sourcePoints[src] = n;
    }
  }
  return {
    dailyCap: clampInt(raw.dailyCap, 1, 5_000, DEFAULT_SEASON_POINT_CONFIG.dailyCap),
    weeklyCap: clampInt(
      raw.weeklyCap,
      1,
      25_000,
      DEFAULT_SEASON_POINT_CONFIG.weeklyCap,
    ),
    sourcePoints,
  };
}

export function normalizeSeasonRewards(value: unknown): SeasonRewardDef[] {
  if (!Array.isArray(value)) return [...DEFAULT_SEASON_REWARDS];
  const rewards = value
    .map((raw): SeasonRewardDef | null => {
      if (!raw || typeof raw !== 'object') return null;
      const obj = raw as Partial<SeasonRewardDef>;
      if (typeof obj.rewardKey !== 'string' || obj.rewardKey.length < 1) return null;
      const items = Array.isArray(obj.items)
        ? obj.items
            .map((i): SeasonRewardItem | null => {
              if (!i || typeof i !== 'object') return null;
              const it = i as Partial<SeasonRewardItem>;
              if (typeof it.itemKey !== 'string' || isEndgameItemKey(it.itemKey)) {
                return null;
              }
              const qty = clampInt(it.qty, 1, 5, 1);
              return { itemKey: it.itemKey, qty };
            })
            .filter((i): i is SeasonRewardItem => i !== null)
            .slice(0, 3)
        : [];
      return {
        rewardKey: obj.rewardKey.slice(0, 80),
        minPoints: clampInt(obj.minPoints, 0, 100_000, 0),
        titleVi: stringOr(obj.titleVi, obj.rewardKey).slice(0, 120),
        titleEn: stringOr(obj.titleEn, obj.rewardKey).slice(0, 120),
        linhThach: clampInt(obj.linhThach, 0, 10_000, 0),
        exp: clampInt(obj.exp, 0, 50_000, 0),
        eventToken: clampInt(obj.eventToken, 0, 500, 0),
        items,
      };
    })
    .filter((r): r is SeasonRewardDef => r !== null)
    .slice(0, 20);
  return rewards.length > 0 ? rewards : [...DEFAULT_SEASON_REWARDS];
}

export function normalizeSeasonMilestones(value: unknown): SeasonMilestoneDef[] {
  if (!Array.isArray(value)) return [...DEFAULT_SEASON_MILESTONES];
  const milestones = value
    .map((raw): SeasonMilestoneDef | null => {
      if (!raw || typeof raw !== 'object') return null;
      const obj = raw as Partial<SeasonMilestoneDef>;
      if (typeof obj.milestoneKey !== 'string' || !isSeasonMilestoneMetric(obj.metric)) {
        return null;
      }
      return {
        milestoneKey: obj.milestoneKey.slice(0, 80),
        metric: obj.metric,
        target: clampInt(obj.target, 1, 1_000_000, 1),
        titleVi: stringOr(obj.titleVi, obj.milestoneKey).slice(0, 120),
        titleEn: stringOr(obj.titleEn, obj.milestoneKey).slice(0, 120),
        effectKey: stringOr(obj.effectKey, 'minor_buff').slice(0, 80),
        effectVi: stringOr(obj.effectVi, '').slice(0, 200),
        effectEn: stringOr(obj.effectEn, '').slice(0, 200),
      };
    })
    .filter((m): m is SeasonMilestoneDef => m !== null)
    .slice(0, 30);
  return milestones.length > 0 ? milestones : [...DEFAULT_SEASON_MILESTONES];
}

export function seasonRewardByKey(
  rewards: ReadonlyArray<SeasonRewardDef>,
  rewardKey: string,
): SeasonRewardDef | null {
  return rewards.find((r) => r.rewardKey === rewardKey) ?? null;
}

function clampInt(
  value: unknown,
  min: number,
  max: number,
  fallback: number,
): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(n)));
}

function stringOr(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.length > 0 ? value : fallback;
}
