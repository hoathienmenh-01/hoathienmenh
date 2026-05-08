/**
 * Phase 14.0.A — Sect Territory Influence Foundation API client.
 *
 * 3 endpoints read-only:
 *   - GET /territory/regions             → list 9 region + total influence + top sect
 *   - GET /territory/regions/:key/leaderboard → top sect trong region
 *   - GET /territory/me                  → personal view (per-region rank/points
 *                                            của sect user)
 *
 * Server-authoritative; FE KHÔNG mutate. Mọi influence ghi điểm xảy ra
 * server-side qua hook fail-soft (dungeon claim, boss reward) — FE chỉ hiển thị.
 */
import type { RegionKey } from '@xuantoi/shared';
import { apiClient } from './client';

export interface TerritoryRegionView {
  regionKey: RegionKey;
  nameVi: string;
  nameEn: string;
  flavorVi: string;
  flavorEn: string;
  unlockRealmKey: string;
  sortOrder: number;
  dominantElement: string | null;
  totalPoints: number;
  contributors: number;
  topSectId: string | null;
  topSectName: string | null;
  topSectPoints: number;
}

export interface TerritoryRegionsView {
  regions: ReadonlyArray<TerritoryRegionView>;
}

export interface TerritoryLeaderboardRow {
  rank: number;
  sectId: string;
  sectName: string;
  points: number;
  contributors: number;
}

export interface TerritoryLeaderboardView {
  regionKey: RegionKey;
  rows: ReadonlyArray<TerritoryLeaderboardRow>;
}

export interface TerritoryMyRegionRow {
  regionKey: RegionKey;
  nameVi: string;
  nameEn: string;
  sectPoints: number;
  sectRank: number | null;
  personalPoints: number;
}

export interface TerritoryMyView {
  hasSect: boolean;
  sectId: string | null;
  sectName: string | null;
  regions: ReadonlyArray<TerritoryMyRegionRow>;
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

export async function getTerritoryRegions(): Promise<TerritoryRegionsView> {
  const { data } =
    await apiClient.get<Envelope<TerritoryRegionsView>>('/territory/regions');
  return unwrap(data);
}

export async function getTerritoryRegionLeaderboard(
  regionKey: string,
): Promise<TerritoryLeaderboardView> {
  const { data } = await apiClient.get<Envelope<TerritoryLeaderboardView>>(
    `/territory/regions/${encodeURIComponent(regionKey)}/leaderboard`,
  );
  return unwrap(data);
}

export async function getTerritoryMe(): Promise<TerritoryMyView> {
  const { data } =
    await apiClient.get<Envelope<TerritoryMyView>>('/territory/me');
  return unwrap(data);
}
