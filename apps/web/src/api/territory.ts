/**
 * Phase 14.0.A + 14.0.B — Sect Territory API client.
 *
 * Endpoints read-only (FE):
 *   - GET /territory/regions                     → list 9 region + total influence + top sect + owner snapshot
 *   - GET /territory/regions/:key/leaderboard    → top sect trong region
 *   - GET /territory/regions/:key/history        → settlement history (Phase 14.0.B)
 *   - GET /territory/me                          → personal view (per-region rank/points của sect user)
 *
 * Endpoints admin-only (FE chỉ trigger nếu admin pattern đã có):
 *   - POST /admin/territory/settle?periodKey=... → chốt settlement toàn bộ region
 *   - POST /admin/territory/regions/:key/settle  → chốt 1 region riêng
 *
 * Server-authoritative; FE KHÔNG mutate điểm. Mọi influence ghi điểm xảy ra
 * server-side qua hook fail-soft (dungeon claim, boss reward) — FE chỉ hiển thị.
 */
import type { RegionKey } from '@xuantoi/shared';
import { apiClient } from './client';

/** Phase 14.0.C — buff preview (lite, FE only). */
export interface TerritoryRegionBuffPreviewLite {
  buffKey: string;
  buffType: string;
  value: number;
  cap: number;
  labelI18nKey: string;
  descriptionI18nKey: string;
  appliesTo: ReadonlyArray<string>;
  element: string | null;
}

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
  /** Phase 14.0.B — owner snapshot. `null` nếu chưa settle. */
  ownerSectId: string | null;
  ownerSectName: string | null;
  ownerPeriodKey: string | null;
  ownerSettledAt: string | null;
  /** Phase 14.0.C — buff catalog preview. */
  buffs: ReadonlyArray<TerritoryRegionBuffPreviewLite>;
  /** Phase 14.0.C — true nếu region đã có owner (buff đang active). */
  ownerBuffActive: boolean;
}

export interface TerritoryRegionsView {
  regions: ReadonlyArray<TerritoryRegionView>;
  /** Phase 14.0.C — period key context (FE display "Tuần này / Tuần trước"). */
  currentPeriodKey: string;
  previousPeriodKey: string;
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
  /** Phase 14.0.C — buff đang active của tông môn user (chiếm region). */
  activeBuffs: ReadonlyArray<TerritoryRegionBuffPreviewLite>;
  currentPeriodKey: string;
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

// ────────────────────────────────────────────────────────────────────────
// Phase 14.0.B — Settlement
// ────────────────────────────────────────────────────────────────────────

export interface TerritorySettlementSnapshotView {
  id: string;
  regionKey: RegionKey;
  periodKey: string;
  winnerSectId: string | null;
  winnerSectName: string | null;
  winnerPoints: number;
  runnerUpSectId: string | null;
  runnerUpSectName: string | null;
  runnerUpPoints: number;
  totalSects: number;
  totalPoints: number;
  settledAt: string;
  settledBy: string | null;
}

export interface TerritoryRegionHistoryView {
  regionKey: RegionKey;
  currentOwnerSectId: string | null;
  currentOwnerSectName: string | null;
  currentPeriodKey: string | null;
  currentSettledAt: string | null;
  snapshots: ReadonlyArray<TerritorySettlementSnapshotView>;
}

export interface TerritorySettlementRunResult {
  periodKey: string;
  settledAt: string;
  snapshots: ReadonlyArray<TerritorySettlementSnapshotView>;
  skippedRegions: ReadonlyArray<RegionKey>;
}

export async function getTerritoryRegionHistory(
  regionKey: string,
  limit: number = 20,
): Promise<TerritoryRegionHistoryView> {
  const { data } = await apiClient.get<Envelope<TerritoryRegionHistoryView>>(
    `/territory/regions/${encodeURIComponent(regionKey)}/history`,
    { params: { limit } },
  );
  return unwrap(data);
}

export async function adminTerritorySettleAll(
  periodKey?: string,
): Promise<TerritorySettlementRunResult> {
  const { data } = await apiClient.post<Envelope<TerritorySettlementRunResult>>(
    '/admin/territory/settle',
    null,
    { params: periodKey ? { periodKey } : undefined },
  );
  return unwrap(data);
}

export async function adminTerritorySettleRegion(
  regionKey: string,
  periodKey?: string,
): Promise<{
  regionKey: string;
  periodKey: string;
  skipped: boolean;
  snapshot: TerritorySettlementSnapshotView | null;
}> {
  const { data } = await apiClient.post<
    Envelope<{
      regionKey: string;
      periodKey: string;
      skipped: boolean;
      snapshot: TerritorySettlementSnapshotView | null;
    }>
  >(
    `/admin/territory/regions/${encodeURIComponent(regionKey)}/settle`,
    null,
    { params: periodKey ? { periodKey } : undefined },
  );
  return unwrap(data);
}

// ────────────────────────────────────────────────────────────────────────
// Phase 14.0.C — Influence Decay
// ────────────────────────────────────────────────────────────────────────

export interface TerritoryDecayResult {
  periodKey: string;
  decayBps: number;
  skipped: boolean;
  rowsAffected: number;
  pointsBefore: number;
  pointsAfter: number;
  delta: number;
  triggeredAt: string;
}

export async function adminTerritoryDecay(opts: {
  periodKey?: string;
  decayBps?: number;
}): Promise<TerritoryDecayResult> {
  const params: Record<string, string> = {};
  if (opts.periodKey) params.periodKey = opts.periodKey;
  if (opts.decayBps !== undefined) {
    params.decayBps = String(opts.decayBps);
  }
  const { data } = await apiClient.post<Envelope<TerritoryDecayResult>>(
    '/admin/territory/decay',
    null,
    { params: Object.keys(params).length > 0 ? params : undefined },
  );
  return unwrap(data);
}
