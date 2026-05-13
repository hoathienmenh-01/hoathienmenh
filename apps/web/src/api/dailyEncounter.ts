import { i18n } from '@/i18n';
import { apiClient } from './client';

/**
 * Phase 34.1 — Daily Random Encounter / Kỳ Ngộ client.
 *
 * Endpoints (mirror `DailyEncounterController` /encounters/v1):
 *   GET    /encounters/v1/today
 *   GET    /encounters/v1/history?limit=N
 *   POST   /encounters/v1/today/accept
 *   POST   /encounters/v1/today/choose
 *   POST   /encounters/v1/today/complete
 *   POST   /encounters/v1/today/skip
 *   POST   /encounters/v1/today/claim
 */

interface Envelope<T> {
  ok: boolean;
  data?: T;
  error?: { code: string; message: string };
}

function fallbackError(): Error {
  return new Error(i18n.global.t('common.apiFallback.quest'));
}

export type DailyEncounterStatus =
  | 'AVAILABLE'
  | 'ACCEPTED'
  | 'COMPLETED'
  | 'CLAIMED'
  | 'SKIPPED';

export interface DailyEncounterView {
  encounterKey: string;
  rarity: string;
  dateKey: string;
  status: DailyEncounterStatus;
  choiceKey: string | null;
  titleVi: string;
  titleEn: string;
  descriptionVi: string;
  descriptionEn: string;
  rewardProfile: { linhThach: number; exp: number };
  acceptedAt: string | null;
  completedAt: string | null;
  claimedAt: string | null;
}

export interface DailyEncounterClaimResult {
  claimed: boolean;
  linhThachGranted: number;
  expGranted: number;
  view: DailyEncounterView;
}

export async function fetchTodayEncounter(): Promise<DailyEncounterView> {
  const { data } = await apiClient.get<Envelope<{ encounter: DailyEncounterView }>>(
    '/encounters/v1/today',
  );
  if (!data.ok || !data.data) throw data.error ?? fallbackError();
  return data.data.encounter;
}

export async function fetchEncounterHistory(
  limit = 30,
): Promise<DailyEncounterView[]> {
  const { data } = await apiClient.get<
    Envelope<{ history: DailyEncounterView[] }>
  >(`/encounters/v1/history?limit=${limit}`);
  if (!data.ok || !data.data) throw data.error ?? fallbackError();
  return data.data.history;
}

export async function acceptTodayEncounter(): Promise<DailyEncounterView> {
  const { data } = await apiClient.post<
    Envelope<{ encounter: DailyEncounterView }>
  >('/encounters/v1/today/accept');
  if (!data.ok || !data.data) throw data.error ?? fallbackError();
  return data.data.encounter;
}

export async function chooseTodayEncounter(
  choiceKey: string,
): Promise<DailyEncounterView> {
  const { data } = await apiClient.post<
    Envelope<{ encounter: DailyEncounterView }>
  >('/encounters/v1/today/choose', { choiceKey });
  if (!data.ok || !data.data) throw data.error ?? fallbackError();
  return data.data.encounter;
}

export async function completeTodayEncounter(): Promise<DailyEncounterView> {
  const { data } = await apiClient.post<
    Envelope<{ encounter: DailyEncounterView }>
  >('/encounters/v1/today/complete');
  if (!data.ok || !data.data) throw data.error ?? fallbackError();
  return data.data.encounter;
}

export async function skipTodayEncounter(): Promise<DailyEncounterView> {
  const { data } = await apiClient.post<
    Envelope<{ encounter: DailyEncounterView }>
  >('/encounters/v1/today/skip');
  if (!data.ok || !data.data) throw data.error ?? fallbackError();
  return data.data.encounter;
}

export async function claimTodayEncounter(): Promise<DailyEncounterClaimResult> {
  const { data } = await apiClient.post<
    Envelope<DailyEncounterClaimResult>
  >('/encounters/v1/today/claim');
  if (!data.ok || !data.data) throw data.error ?? fallbackError();
  return data.data;
}
