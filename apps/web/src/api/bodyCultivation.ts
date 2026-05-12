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

export interface BodyCultivationMaterialRequirement {
  itemKey: string;
  qty: number;
}

export interface BodyCultivationStatus {
  bodyRealmKey: string;
  bodyRealmName: string;
  bodyStage: number;
  bodyExp: string;
  bodyExpNext: string;
  bodyRate: number;
  bodyCultivating: boolean;
  bodyInjuryUntil: string | null;
  physiqueKey: string | null;
  statBonus: {
    hpMax: number;
    power: number;
    def: number;
    staminaMax: number;
    bossDamageReduction: number;
  };
  canBreakthrough: boolean;
  breakthroughRequirement: {
    fromOrder: number;
    toOrder: number;
    bodyExpCost: string;
    materials: BodyCultivationMaterialRequirement[];
    pillItemKey: string | null;
    minSuccessRate: number;
  } | null;
  missingMaterials: Array<{ itemKey: string; required: number; owned: number }>;
}

export interface BodyBreakthroughResult {
  success: boolean;
  status: BodyCultivationStatus;
}

export async function getBodyCultivationStatus(): Promise<BodyCultivationStatus> {
  const { data } = await apiClient.get<Envelope<{ bodyCultivation: BodyCultivationStatus }>>(
    '/character/body-cultivation',
  );
  if (!data.ok || !data.data) throw data.error ?? fallbackError('bodyCultivationState');
  return data.data.bodyCultivation;
}

export async function startBodyCultivation(): Promise<BodyCultivationStatus> {
  const { data } = await apiClient.post<Envelope<{ bodyCultivation: BodyCultivationStatus }>>(
    '/character/body-cultivation/start',
  );
  if (!data.ok || !data.data) throw data.error ?? fallbackError('bodyCultivationStart');
  return data.data.bodyCultivation;
}

export async function stopBodyCultivation(): Promise<BodyCultivationStatus> {
  const { data } = await apiClient.post<Envelope<{ bodyCultivation: BodyCultivationStatus }>>(
    '/character/body-cultivation/stop',
  );
  if (!data.ok || !data.data) throw data.error ?? fallbackError('bodyCultivationStop');
  return data.data.bodyCultivation;
}

export async function attemptBodyBreakthrough(): Promise<BodyBreakthroughResult> {
  const { data } = await apiClient.post<
    Envelope<{ bodyBreakthrough: BodyBreakthroughResult }>
  >('/character/body-cultivation/breakthrough');
  if (!data.ok || !data.data) throw data.error ?? fallbackError('bodyCultivationBreakthrough');
  return data.data.bodyBreakthrough;
}
