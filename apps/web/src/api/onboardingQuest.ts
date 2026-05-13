import { i18n } from '@/i18n';
import { apiClient } from './client';

/**
 * Phase 34.0 — 7-Day Onboarding Questline client.
 *
 * Wire 6 endpoint của `OnboardingQuestModule`:
 *   - `GET  /onboarding-quest/v1/progress`
 *   - `GET  /onboarding-quest/v1/days/:dayNumber`
 *   - `POST /onboarding-quest/v1/tasks/:taskKey/accept`
 *   - `POST /onboarding-quest/v1/tasks/:taskKey/complete`
 *   - `POST /onboarding-quest/v1/tasks/:taskKey/claim`
 *   - `POST /onboarding-quest/v1/recompute`
 *
 * Server-authoritative: status/reward chạy server-side; FE chỉ render +
 * trigger action, KHÔNG tự cộng reward. Mọi mutation reload state từ
 * response.
 */

interface Envelope<T> {
  ok: boolean;
  data?: T;
  error?: { code: string; message: string };
}

function fallbackError(): Error {
  return new Error(i18n.global.t('common.apiFallback.quest'));
}

export type OnboardingTaskStatus =
  | 'LOCKED'
  | 'AVAILABLE'
  | 'COMPLETED'
  | 'CLAIMED';

export type OnboardingDayStatus =
  | 'LOCKED'
  | 'AVAILABLE'
  | 'IN_PROGRESS'
  | 'COMPLETED';

export type OnboardingCategory =
  | 'tutorial'
  | 'cultivation'
  | 'combat'
  | 'story'
  | 'social'
  | 'system';

export interface OnboardingTaskView {
  taskKey: string;
  dayNumber: number;
  titleVi: string;
  titleEn: string;
  descriptionVi: string;
  descriptionEn: string;
  actionRoute: string;
  category: OnboardingCategory;
  status: OnboardingTaskStatus;
  completedAt: string | null;
  claimedAt: string | null;
  reward: {
    linhThach: number;
    exp: number;
    titleKey?: string;
  };
}

export interface OnboardingDayView {
  dayNumber: number;
  titleVi: string;
  titleEn: string;
  themeVi: string;
  themeEn: string;
  status: OnboardingDayStatus;
  unlockedAt: string | null;
  completedAt: string | null;
  totalTasks: number;
  completedTasks: number;
  claimedTasks: number;
  tasks: OnboardingTaskView[];
}

export interface OnboardingProgressView {
  totalDays: number;
  totalTasks: number;
  completedTasks: number;
  claimedTasks: number;
  days: OnboardingDayView[];
}

export interface OnboardingClaimResult {
  taskKey: string;
  status: OnboardingTaskStatus;
  claimed: boolean;
  linhThachGranted: number;
  expGranted: number;
  titleKey?: string;
}

export async function fetchOnboardingProgress(): Promise<OnboardingProgressView> {
  const { data } = await apiClient.get<Envelope<OnboardingProgressView>>(
    '/onboarding-quest/v1/progress',
  );
  if (!data.ok || !data.data) throw data.error ?? fallbackError();
  return data.data;
}

export async function fetchOnboardingDay(
  dayNumber: number,
): Promise<OnboardingDayView> {
  const { data } = await apiClient.get<Envelope<OnboardingDayView>>(
    `/onboarding-quest/v1/days/${dayNumber}`,
  );
  if (!data.ok || !data.data) throw data.error ?? fallbackError();
  return data.data;
}

export async function acceptOnboardingTask(
  taskKey: string,
): Promise<OnboardingTaskView> {
  const { data } = await apiClient.post<Envelope<OnboardingTaskView>>(
    `/onboarding-quest/v1/tasks/${encodeURIComponent(taskKey)}/accept`,
  );
  if (!data.ok || !data.data) throw data.error ?? fallbackError();
  return data.data;
}

export async function completeOnboardingTask(
  taskKey: string,
): Promise<OnboardingTaskView> {
  const { data } = await apiClient.post<Envelope<OnboardingTaskView>>(
    `/onboarding-quest/v1/tasks/${encodeURIComponent(taskKey)}/complete`,
  );
  if (!data.ok || !data.data) throw data.error ?? fallbackError();
  return data.data;
}

export async function claimOnboardingTask(
  taskKey: string,
): Promise<OnboardingClaimResult> {
  const { data } = await apiClient.post<Envelope<OnboardingClaimResult>>(
    `/onboarding-quest/v1/tasks/${encodeURIComponent(taskKey)}/claim`,
  );
  if (!data.ok || !data.data) throw data.error ?? fallbackError();
  return data.data;
}

export async function recomputeOnboarding(): Promise<OnboardingProgressView> {
  const { data } = await apiClient.post<Envelope<OnboardingProgressView>>(
    '/onboarding-quest/v1/recompute',
  );
  if (!data.ok || !data.data) throw data.error ?? fallbackError();
  return data.data;
}
