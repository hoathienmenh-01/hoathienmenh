import { i18n } from '@/i18n';
import { apiClient } from './client';

interface Envelope<T> {
  ok: boolean;
  data?: T;
  error?: { code: string; message?: string };
}

function fallbackError(): Error {
  return new Error(i18n.global.t('common.apiFallback.seasons'));
}

export type SeasonStatus = 'UPCOMING' | 'ACTIVE' | 'ENDED' | 'ARCHIVED';
export type SeasonLeaderboardKind =
  | 'POINTS'
  | 'ROGUELIKE_FLOOR'
  | 'BOSS_DEFEATS'
  | 'DUNGEON_CLEARS';

export interface SeasonPointConfig {
  dailyCap: number;
  weeklyCap: number;
  sourcePoints: Record<string, number>;
}

export interface SeasonRewardItem {
  itemKey: string;
  qty: number;
}

export interface SeasonRewardView {
  rewardKey: string;
  minPoints: number;
  titleVi: string;
  titleEn: string;
  linhThach: number;
  exp: number;
  eventToken: number;
  items: SeasonRewardItem[];
  claimable?: boolean;
  claimed?: boolean;
}

export interface SeasonMilestoneDef {
  milestoneKey: string;
  metric: string;
  target: number;
  titleVi: string;
  titleEn: string;
  effectKey: string;
  effectVi: string;
  effectEn: string;
}

export interface SeasonView {
  seasonKey: string;
  name: string;
  description: string;
  status: SeasonStatus;
  startAt: string;
  endAt: string;
  pointConfig: SeasonPointConfig;
  rewards: SeasonRewardView[];
  milestones: SeasonMilestoneDef[];
}

export interface SeasonProgressStats {
  points: number;
  bestRoguelikeFloor: number;
  bossDefeats: number;
  dungeonClears: number;
  craftCount: number;
  breakthroughCount: number;
  dailyUsed: number;
  dailyCap: number;
  weeklyUsed: number;
  weeklyCap: number;
  lastPointAt: string | null;
}

export interface SeasonProgressView {
  season: SeasonView | null;
  progress: SeasonProgressStats | null;
  rewards: SeasonRewardView[];
}

export interface SeasonLeaderboardEntry {
  rank: number;
  characterId: string;
  characterName: string;
  score: number;
  tieBreaker: number;
  updatedAt: string;
}

export interface SeasonLeaderboardView {
  season: SeasonView | null;
  kind: SeasonLeaderboardKind;
  entries: SeasonLeaderboardEntry[];
}

export interface SeasonServerMilestone {
  milestoneKey: string;
  metric: string;
  target: number;
  progress: number;
  unlockedAt: string | null;
  effectKey: string | null;
  titleVi: string;
  titleEn: string;
  effectVi: string;
  effectEn: string;
}

export interface SeasonMilestoneView {
  season: SeasonView | null;
  milestones: SeasonServerMilestone[];
}

export interface SeasonClaimResult {
  rewardKey: string;
  claimedAt: string;
  granted: {
    linhThach: number;
    exp: number;
    eventToken: number;
    items: SeasonRewardItem[];
  };
}

export async function fetchCurrentSeason(): Promise<SeasonView | null> {
  const { data } = await apiClient.get<Envelope<{ season: SeasonView | null }>>(
    '/seasons/current',
  );
  if (!data.ok || data.data === undefined) throw data.error ?? fallbackError();
  return data.data.season;
}

export async function fetchSeasonProgress(): Promise<SeasonProgressView> {
  const { data } =
    await apiClient.get<Envelope<SeasonProgressView>>('/seasons/me/progress');
  if (!data.ok || !data.data) throw data.error ?? fallbackError();
  return data.data;
}

export async function fetchSeasonLeaderboard(
  kind: SeasonLeaderboardKind = 'POINTS',
): Promise<SeasonLeaderboardView> {
  const { data } = await apiClient.get<Envelope<SeasonLeaderboardView>>(
    '/seasons/leaderboard',
    { params: { kind, limit: 50 } },
  );
  if (!data.ok || !data.data) throw data.error ?? fallbackError();
  return data.data;
}

export async function fetchSeasonMilestones(): Promise<SeasonMilestoneView> {
  const { data } = await apiClient.get<Envelope<SeasonMilestoneView>>(
    '/seasons/server-milestones',
  );
  if (!data.ok || !data.data) throw data.error ?? fallbackError();
  return data.data;
}

export async function claimSeasonReward(
  rewardKey: string,
): Promise<SeasonClaimResult> {
  const { data } = await apiClient.post<Envelope<SeasonClaimResult>>(
    `/seasons/rewards/${encodeURIComponent(rewardKey)}/claim`,
    {},
  );
  if (!data.ok || !data.data) throw data.error ?? fallbackError();
  return data.data;
}
