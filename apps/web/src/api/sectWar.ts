/**
 * Phase 13.1.A — Sect War (Tông Môn Chiến) API client.
 *
 * Mọi authoritative state đến từ server — endpoints chỉ trả view DTO. Activity
 * + reward tier definitions từ shared catalog (server snapshot lại trong
 * response để FE không cần import shared trực tiếp). FE KHÔNG mutate.
 *
 * Lưu ý JSON serialization: shared `maxRank` có thể là `Number.POSITIVE_INFINITY`
 * (participation tier) → JSON.stringify cho ra `null`. FE phải xử lý null như
 * "không cap" (rank ≥ minRank).
 */
import type {
  SectWarActivityKey,
  SectWarRewardTierKey,
  SectWarSourceType,
} from '@xuantoi/shared';
import { apiClient } from './client';

export interface SectWarActivityRule {
  key: SectWarActivityKey;
  points: number;
  dailyCap?: number;
  weeklyCap?: number;
  sourceType: SectWarSourceType;
  labelI18nKey: string;
  descriptionI18nKey: string;
}

export interface SectWarRewardTier {
  key: SectWarRewardTierKey;
  minRank: number;
  /** null = không cap (e.g. participation). Server gửi Infinity → JSON null. */
  maxRank: number | null;
  minPersonalPoints?: number;
  reward: {
    linhThach?: number;
    tienNgoc?: number;
    titleKey?: string;
    buffKey?: string;
    items?: ReadonlyArray<{ itemKey: string; qty: number }>;
  };
  labelI18nKey: string;
  descriptionI18nKey: string;
}

export interface SectWarSeason {
  weekKey: string;
  startsAtIso: string;
  endsAtIso: string;
  timezone: string;
}

export interface SectWarLeaderboardRow {
  rank: number;
  sectId: string;
  sectName: string;
  points: number;
  contributors: number;
}

export interface SectWarMyStatus {
  weekKey: string;
  hasSect: boolean;
  sectId: string | null;
  sectName: string | null;
  personalPoints: number;
  breakdown: ReadonlyArray<{
    activityKey: SectWarActivityKey;
    points: number;
    count: number;
  }>;
  sectRank: number | null;
  sectPoints: number | null;
  eligibleTierKey: SectWarRewardTierKey | null;
  alreadyClaimed: boolean;
  canClaim: boolean;
}

export interface SectWarCurrent {
  weekKey: string;
  season: SectWarSeason;
  activities: ReadonlyArray<SectWarActivityRule>;
  rewardTiers: ReadonlyArray<SectWarRewardTier>;
  leaderboard: ReadonlyArray<SectWarLeaderboardRow>;
  me: SectWarMyStatus;
}

export interface SectWarLeaderboardView {
  weekKey: string;
  rows: ReadonlyArray<SectWarLeaderboardRow>;
}

export interface SectWarClaimResult {
  weekKey: string;
  rewardTierKey: SectWarRewardTierKey;
  granted: { linhThach: number; tienNgoc: number };
  sectRank: number;
  personalPoints: number;
}

interface Envelope<T> {
  ok: boolean;
  data?: T;
  error?: { code: string; message: string };
}

function unwrap<T>(env: Envelope<T>): T {
  if (!env.ok || !env.data) {
    const err = env.error ?? { code: 'UNKNOWN', message: 'UNKNOWN' };
    throw Object.assign(new Error(err.message), { code: err.code });
  }
  return env.data;
}

export async function getSectWarCurrent(): Promise<SectWarCurrent> {
  const { data } = await apiClient.get<Envelope<SectWarCurrent>>('/sect-war/current');
  return unwrap(data);
}

export async function getSectWarLeaderboard(weekKey?: string): Promise<SectWarLeaderboardView> {
  const url = weekKey ? `/sect-war/leaderboard?weekKey=${encodeURIComponent(weekKey)}` : '/sect-war/leaderboard';
  const { data } = await apiClient.get<Envelope<SectWarLeaderboardView>>(url);
  return unwrap(data);
}

export async function getSectWarMe(): Promise<SectWarMyStatus> {
  const { data } = await apiClient.get<Envelope<SectWarMyStatus>>('/sect-war/me');
  return unwrap(data);
}

export async function claimSectWarReward(): Promise<SectWarClaimResult> {
  const { data } = await apiClient.post<Envelope<SectWarClaimResult>>('/sect-war/claim', {});
  return unwrap(data);
}
