import { apiClient } from './client';
import type {
  LiveOpsEventReward,
  LiveOpsScheduledEventType,
} from '@xuantoi/shared';

export type LiveOpsEventType = 'DAILY' | 'WEEKLY' | 'LIMITED' | 'BOSS' | 'STORY';
export type BossSlotStatus = 'upcoming' | 'active' | 'completed';
export type SuggestedActivityKind = 'boss' | 'event' | 'daily' | 'weekly';

export interface LiveOpsEventViewModel {
  key: string;
  type: LiveOpsEventType;
  titleI18nKey: string;
  descriptionI18nKey: string;
  rewardHintI18nKey?: string;
  bossKey?: string;
  regionKey?: string;
  dailyTime?: string;
  daysOfWeek?: number[];
  durationMinutes?: number;
}

export interface LiveOpsNextEventViewModel extends LiveOpsEventViewModel {
  slotStartIso: string;
  slotEndIso: string;
  secondsUntilStart: number;
}

export interface BossScheduleViewModel {
  key: string;
  bossKey: string;
  regionKey: string;
  slotStartIso: string;
  slotEndIso: string;
  status: BossSlotStatus;
  secondsUntilStart: number;
  rewardHintI18nKey?: string;
}

export interface SuggestedActivity {
  key: string;
  kind: SuggestedActivityKind;
  titleI18nKey: string;
  bossKey?: string;
  regionKey?: string;
  secondsUntilStart?: number;
  rewardHintI18nKey?: string;
}

export interface LiveOpsTodayResponse {
  nowIso: string;
  timezone: string;
  todayEvents: LiveOpsEventViewModel[];
  activeEvents: LiveOpsEventViewModel[];
  nextEvent: LiveOpsNextEventViewModel | null;
  bossSchedule: BossScheduleViewModel[];
  suggestedActivities: SuggestedActivity[];
}

interface Envelope<T> {
  ok: boolean;
  data?: T;
  error?: { code: string; message: string };
}

export async function getLiveOpsToday(): Promise<LiveOpsTodayResponse | null> {
  try {
    const { data } = await apiClient.get<Envelope<LiveOpsTodayResponse>>(
      '/liveops/today',
    );
    if (!data.ok || !data.data) return null;
    return data.data;
  } catch {
    return null;
  }
}

/**
 * Phase 15.3.A — public-safe view of an ACTIVE LiveOps scheduled event.
 *
 * Mirror `apps/api/src/modules/liveops-event-scheduler/liveops-event-scheduler.service.ts`
 * `LiveOpsActiveEventPublicView` (admin metadata stripped).
 */
export interface LiveOpsActiveEventPublicView {
  key: string;
  type: LiveOpsScheduledEventType;
  title: string;
  description: string;
  startsAt: string;
  endsAt: string;
  publicConfig: {
    multiplier: number | null;
    reward: LiveOpsEventReward | null;
  };
  /** True nếu type=FESTIVAL_GIFT và character này chưa claim. */
  claimable: boolean;
  /** True nếu runtime đã wire (FE có thể hiển thị badge). */
  runtimeSupported: boolean;
}

/** Phase 15.3.A — result of a successful FESTIVAL_GIFT claim. */
export interface LiveOpsClaimResult {
  eventKey: string;
  claimedAt: string;
  granted: LiveOpsEventReward;
}

/**
 * `GET /liveops/events/active` — list ACTIVE events for player UI. Anonymous
 * viewer được phép xem (claimable=false). Trả `[]` nếu API lỗi (fail-soft —
 * panel sẽ render empty state thay vì crash trang).
 */
export async function getActiveLiveOpsEvents(): Promise<
  LiveOpsActiveEventPublicView[]
> {
  try {
    const { data } = await apiClient.get<
      Envelope<LiveOpsActiveEventPublicView[]>
    >('/liveops/events/active');
    if (!data.ok || !data.data) return [];
    return data.data;
  } catch {
    return [];
  }
}

/**
 * `POST /liveops/events/:eventKey/claim` — claim FESTIVAL_GIFT 1 lần.
 *
 * Throws on error so caller có thể distinguish:
 *   - `EVENT_ALREADY_CLAIMED` (409)
 *   - `EVENT_NOT_ACTIVE` (409)
 *   - `EVENT_NOT_CLAIMABLE` (409 — wrong type)
 *   - `EVENT_NOT_FOUND` (404)
 *   - `NO_CHARACTER` (404)
 *   - `UNAUTHENTICATED` (401)
 */
export async function claimLiveOpsEventReward(
  eventKey: string,
): Promise<LiveOpsClaimResult> {
  const { data } = await apiClient.post<Envelope<LiveOpsClaimResult>>(
    `/liveops/events/${encodeURIComponent(eventKey)}/claim`,
    {},
  );
  if (!data.ok || !data.data) {
    throw new Error(data.error?.code ?? 'UNKNOWN');
  }
  return data.data;
}
