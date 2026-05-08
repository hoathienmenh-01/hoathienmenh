/**
 * Phase 13.2.A — Sect Season (Mùa Tông Môn) API client.
 *
 * Mọi authoritative state đến từ server — endpoints chỉ trả view DTO. Season
 * + milestone catalog từ shared (server snapshot vào response để FE không
 * phụ thuộc shared trực tiếp). FE KHÔNG self-derive milestone status.
 *
 * Endpoints (read-only Phase 13.2.A):
 *   - GET /sect-season/current — full state (season, milestones, leaderboard, me).
 *   - GET /sect-season/leaderboard?seasonKey=... — top 10 sect.
 *   - GET /sect-season/me?seasonKey=... — personal status.
 */
import { apiClient } from './client';

export interface SectSeasonRewardGrant {
  linhThach?: number;
  tienNgoc?: number;
  items?: ReadonlyArray<{ itemKey: string; qty: number }>;
  titleKey?: string;
  buffKey?: string;
}

export interface SectSeasonMilestone {
  key: string;
  requiredPoints: number;
  reward: SectSeasonRewardGrant;
  labelI18nKey: string;
  descriptionI18nKey: string;
}

export interface SectSeasonDef {
  key: string;
  startsAtIso: string;
  endsAtIso: string;
  durationWeeks: number;
  timezone: string;
  labelI18nKey: string;
  descriptionI18nKey: string;
}

export interface SectSeasonLeaderboardRow {
  rank: number;
  sectId: string;
  sectName: string;
  points: number;
  contributors: number;
  weeksContributed: number;
}

export interface SectSeasonMyStatus {
  seasonKey: string;
  hasSect: boolean;
  sectId: string | null;
  sectName: string | null;
  personalPoints: number;
  weeksContributed: number;
  achievedMilestoneKeys: ReadonlyArray<string>;
  nextMilestoneKey: string | null;
}

export interface SectSeasonCurrent {
  seasonKey: string | null;
  season: SectSeasonDef | null;
  milestones: ReadonlyArray<SectSeasonMilestone>;
  leaderboard: ReadonlyArray<SectSeasonLeaderboardRow>;
  me: SectSeasonMyStatus | null;
}

export interface SectSeasonLeaderboardView {
  seasonKey: string;
  rows: ReadonlyArray<SectSeasonLeaderboardRow>;
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

export async function getSectSeasonCurrent(): Promise<SectSeasonCurrent> {
  const { data } = await apiClient.get<Envelope<SectSeasonCurrent>>('/sect-season/current');
  return unwrap(data);
}

export async function getSectSeasonLeaderboard(
  seasonKey?: string,
): Promise<SectSeasonLeaderboardView> {
  const url = seasonKey
    ? `/sect-season/leaderboard?seasonKey=${encodeURIComponent(seasonKey)}`
    : '/sect-season/leaderboard';
  const { data } = await apiClient.get<Envelope<SectSeasonLeaderboardView>>(url);
  return unwrap(data);
}

export async function getSectSeasonMe(
  seasonKey?: string,
): Promise<SectSeasonMyStatus | null> {
  const url = seasonKey
    ? `/sect-season/me?seasonKey=${encodeURIComponent(seasonKey)}`
    : '/sect-season/me';
  const { data } = await apiClient.get<Envelope<SectSeasonMyStatus | null>>(url);
  if (!data.ok) {
    const err = data.error ?? { code: 'UNKNOWN', message: 'UNKNOWN' };
    throw Object.assign(new Error(err.message), { code: err.code });
  }
  // /me có thể trả null khi out-of-season — không phải error.
  return data.data ?? null;
}
