import { apiClient } from './client';

export type ReturnerTier = 'SHORT' | 'MEDIUM' | 'LONG';

export interface ReturnerStateView {
  characterId: string;
  inactiveDays: number;
  currentTier: ReturnerTier | null;
  lastCycleKey: string | null;
  lastTriggerAt: string | null;
  prevLoginAt: string | null;
  lastLoginAt: string | null;
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

export async function getReturnerState(): Promise<ReturnerStateView | null> {
  const { data } = await apiClient.get<
    Envelope<{ state: ReturnerStateView | null }>
  >('/returner/state');
  return unwrap(data).state;
}

export async function triggerReturnerCheck(): Promise<{
  tier: string | null;
  mailId: string | null;
}> {
  const { data } = await apiClient.post<
    Envelope<{ tier: string | null; mailId: string | null }>
  >('/returner/check', {});
  return unwrap(data);
}
