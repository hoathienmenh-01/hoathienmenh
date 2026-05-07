/**
 * Phase 13.1.B — Sect Missions API client.
 *
 * Endpoints:
 *   - GET  /sect/missions                 → SectMissionListView
 *   - POST /sect/missions/:key/claim      → SectMissionClaimResult
 *
 * Server gửi authoritative state. FE chỉ render + dispatch claim. Mọi
 * progress derive từ audit logs phía server (KHÔNG dùng client cache).
 */
import { apiClient } from './client';

export type SectMissionCadence = 'DAILY' | 'WEEKLY';

export interface SectMissionView {
  key: string;
  cadence: SectMissionCadence;
  activityKey: string;
  target: number;
  rewardContribution: number;
  rewardCurrency?: 'LINH_THACH' | 'TIEN_NGOC' | null;
  rewardCurrencyAmount?: number | null;
  rewardItemKey?: string | null;
  rewardItemQty?: number | null;
  titleI18nKey: string;
  descriptionI18nKey: string;
  hintI18nKey?: string | null;

  /** Server-derived progress (raw count). */
  progress: number;
  /** `progress >= target`. */
  ready: boolean;
  /** Đã claim trong period hiện tại. */
  claimed: boolean;
  /** Period key (`YYYY-MM-DD` daily | `YYYY-Www` weekly) trong tz default. */
  periodKey: string;
  /** Time window cho FE display. */
  periodStartIso: string;
  periodEndIso: string;
}

export interface SectMissionListView {
  /** Lifetime accumulated contribution earned (read-only). */
  contribLifetime: number;
  /** Spendable contribution balance hiện tại. */
  contribBalance: number;
  /** All missions with snapshot progress + claimed state. */
  missions: ReadonlyArray<SectMissionView>;
  /** Active sect ID (null nếu chưa vào sect). */
  sectId: string | null;
  sectName: string | null;
}

export interface SectMissionClaimResult {
  missionKey: string;
  cadence: SectMissionCadence;
  periodKey: string;
  rewardContribution: number;
  contribBalanceAfter: number;
  contribLifetimeAfter: number;
  rewardItemKey?: string | null;
  rewardItemQty?: number | null;
  rewardCurrency?: 'LINH_THACH' | 'TIEN_NGOC' | null;
  rewardCurrencyAmount?: number | null;
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

export async function getSectMissions(): Promise<SectMissionListView> {
  const { data } = await apiClient.get<Envelope<SectMissionListView>>(
    '/sect/missions',
  );
  return unwrap(data);
}

export async function claimSectMission(
  key: string,
): Promise<SectMissionClaimResult> {
  const { data } = await apiClient.post<Envelope<SectMissionClaimResult>>(
    `/sect/missions/${encodeURIComponent(key)}/claim`,
    {},
  );
  return unwrap(data);
}
