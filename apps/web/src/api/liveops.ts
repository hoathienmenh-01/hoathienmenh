import { apiClient } from './client';

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
