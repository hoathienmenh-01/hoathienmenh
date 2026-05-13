import { i18n } from '@/i18n';
import { apiClient } from './client';

/**
 * Phase 34.2 — Secret Realm / Bí Cảnh runtime client.
 *
 * Endpoints (mirror `SecretRealmRuntimeController` /secret-realms/v1):
 *   GET    /secret-realms/v1
 *   GET    /secret-realms/v1/history?limit=N
 *   POST   /secret-realms/v1/enter
 *   GET    /secret-realms/v1/runs/:runId
 *   POST   /secret-realms/v1/runs/:runId/progress
 *   POST   /secret-realms/v1/runs/:runId/complete
 *   POST   /secret-realms/v1/runs/:runId/claim
 */

interface Envelope<T> {
  ok: boolean;
  data?: T;
  error?: { code: string; message: string };
}

function fallbackError(): Error {
  return new Error(i18n.global.t('common.apiFallback.quest'));
}

export type SecretRealmStatus =
  | 'ENTERED'
  | 'CLEARED'
  | 'CLAIMED'
  | 'EXPIRED';

export type SecretRealmGateStatus = 'LOCKED' | 'AVAILABLE';

export interface SecretRealmObjectiveDef {
  key: string;
  kind: string;
  target: number;
  titleVi: string;
  titleEn: string;
}

export interface SecretRealmListEntry {
  key: string;
  nameVi: string;
  nameEn: string;
  descriptionVi: string;
  descriptionEn: string;
  status: SecretRealmGateStatus;
  requiredRealmOrder: number;
  cooldownHours: number;
  objectives: SecretRealmObjectiveDef[];
  rewardProfile: { linhThach: number; exp: number };
  lastClearedAt: string | null;
}

export interface SecretRealmRunView {
  id: string;
  secretRealmKey: string;
  status: SecretRealmStatus;
  startedAt: string;
  clearedAt: string | null;
  claimedAt: string | null;
  expiresAt: string | null;
  objectiveProgress: Record<string, number>;
  linhThachGranted: number;
  expGranted: number;
}

export interface SecretRealmClaimResult {
  claimed: boolean;
  linhThachGranted: number;
  expGranted: number;
  run: SecretRealmRunView;
}

export async function fetchSecretRealms(): Promise<SecretRealmListEntry[]> {
  const { data } = await apiClient.get<
    Envelope<{ realms: SecretRealmListEntry[] }>
  >('/secret-realms/v1');
  if (!data.ok || !data.data) throw data.error ?? fallbackError();
  return data.data.realms;
}

export async function fetchSecretRealmHistory(
  limit = 30,
): Promise<SecretRealmRunView[]> {
  const { data } = await apiClient.get<
    Envelope<{ history: SecretRealmRunView[] }>
  >(`/secret-realms/v1/history?limit=${limit}`);
  if (!data.ok || !data.data) throw data.error ?? fallbackError();
  return data.data.history;
}

export async function enterSecretRealm(
  realmKey: string,
): Promise<SecretRealmRunView> {
  const { data } = await apiClient.post<
    Envelope<{ run: SecretRealmRunView }>
  >('/secret-realms/v1/enter', { realmKey });
  if (!data.ok || !data.data) throw data.error ?? fallbackError();
  return data.data.run;
}

export async function fetchSecretRealmRun(
  runId: string,
): Promise<SecretRealmRunView> {
  const { data } = await apiClient.get<
    Envelope<{ run: SecretRealmRunView }>
  >(`/secret-realms/v1/runs/${encodeURIComponent(runId)}`);
  if (!data.ok || !data.data) throw data.error ?? fallbackError();
  return data.data.run;
}

export async function progressSecretRealmRun(
  runId: string,
  objectiveKey: string,
  delta: number,
): Promise<SecretRealmRunView> {
  const { data } = await apiClient.post<
    Envelope<{ run: SecretRealmRunView }>
  >(`/secret-realms/v1/runs/${encodeURIComponent(runId)}/progress`, {
    objectiveKey,
    delta,
  });
  if (!data.ok || !data.data) throw data.error ?? fallbackError();
  return data.data.run;
}

export async function completeSecretRealmRun(
  runId: string,
): Promise<SecretRealmRunView> {
  const { data } = await apiClient.post<
    Envelope<{ run: SecretRealmRunView }>
  >(`/secret-realms/v1/runs/${encodeURIComponent(runId)}/complete`);
  if (!data.ok || !data.data) throw data.error ?? fallbackError();
  return data.data.run;
}

export async function claimSecretRealmRun(
  runId: string,
): Promise<SecretRealmClaimResult> {
  const { data } = await apiClient.post<
    Envelope<SecretRealmClaimResult>
  >(`/secret-realms/v1/runs/${encodeURIComponent(runId)}/claim`);
  if (!data.ok || !data.data) throw data.error ?? fallbackError();
  return data.data;
}
