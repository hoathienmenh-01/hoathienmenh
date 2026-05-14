import type {
  LongTermGoalDef,
  ReputationGroup,
  ReputationGroupDef,
} from '@xuantoi/shared';
import { i18n } from '@/i18n';
import { apiClient } from './client';

interface Envelope<T> {
  ok: boolean;
  data?: T;
  error?: { code: string; message: string };
}

function fallbackError(op: string): Error {
  return new Error(i18n.global.t(`common.apiFallback.${op}`));
}

export interface ReputationRow {
  group: ReputationGroup;
  score: number;
  dailyGain: number;
  dailyCap: number;
  lastGainedAt: string | null;
  def: ReputationGroupDef;
}

export interface LongTermGoalRow {
  goalKey: string;
  progress: number;
  completedAt: string | null;
  def: LongTermGoalDef;
}

export async function getReputationState(): Promise<ReputationRow[]> {
  const { data } = await apiClient.get<Envelope<{ reputation: ReputationRow[] }>>(
    '/character/reputation/me',
  );
  if (!data.ok || !data.data) throw data.error ?? fallbackError('reputationState');
  return data.data.reputation;
}

export async function getLongTermGoalsState(): Promise<LongTermGoalRow[]> {
  const { data } = await apiClient.get<Envelope<{ goals: LongTermGoalRow[] }>>(
    '/character/long-term-goals/me',
  );
  if (!data.ok || !data.data) throw data.error ?? fallbackError('longTermGoalsState');
  return data.data.goals;
}
