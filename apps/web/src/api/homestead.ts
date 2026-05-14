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

export interface HomesteadView {
  id: string;
  level: number;
  nameVi: string;
  nameEn: string;
  spiritualEnergy: number;
  storageCap: number;
  fieldSlots: number;
  gardenSlots: number;
  maxCropTier: number;
  maxGardenTier: number;
  energyUpdatedAt: string;
  serverTime: string;
  offlineCapHours: number;
}

export interface HomesteadUpgradeView {
  available: boolean;
  canUpgrade: boolean;
  toLevel: number | null;
  linhThachCost: number;
  spiritualEnergyCost: number;
  requiredRealmKey: string | null;
}

export interface HomesteadCapsView {
  storageCap: number;
  fieldSlots: number;
  gardenSlots: number;
  offlineCapHours: number;
}

export type HomesteadFieldSlotView =
  | { slotIndex: number; state: 'EMPTY' }
  | {
      slotIndex: number;
      state: 'GROWING' | 'READY';
      cropKey: string;
      outputItemKey: string;
      expectedYield: number;
      plantedAt: string;
      readyAt: string;
      remainingSeconds: number;
    };

export type HomesteadGardenSlotView =
  | { slotIndex: number; state: 'EMPTY' }
  | {
      slotIndex: number;
      state: 'PROCESSING' | 'READY';
      productionKey: string;
      outputItemKey: string;
      expectedYield: number;
      startedAt: string;
      readyAt: string;
      remainingSeconds: number;
    };

export interface HomesteadCropCatalogEntry {
  key: string;
  nameVi: string;
  nameEn: string;
  tier: number;
  outputItemKey: string;
  yieldQty: number;
  growthMinutes: number;
  spiritualEnergyCost: number;
  dailyCapQty: number;
  requiredRealmKey: string | null;
  unlocked: boolean;
}

export interface HomesteadGardenCatalogEntry {
  key: string;
  nameVi: string;
  nameEn: string;
  tier: number;
  outputItemKey: string;
  yieldQty: number;
  durationMinutes: number;
  spiritualEnergyCost: number;
  dailyCapQty: number;
  rare: boolean;
  requiredRealmKey: string | null;
  unlocked: boolean;
}

export interface HomesteadOverview {
  homestead: HomesteadView;
  upgrade: HomesteadUpgradeView;
  caps: HomesteadCapsView;
  fields: HomesteadFieldSlotView[];
  garden: HomesteadGardenSlotView[];
  cropCatalog: HomesteadCropCatalogEntry[];
  gardenCatalog: HomesteadGardenCatalogEntry[];
}

export interface HomesteadFieldsResponse {
  homestead: HomesteadView;
  slots: HomesteadFieldSlotView[];
  cropCatalog: HomesteadCropCatalogEntry[];
  caps: HomesteadCapsView;
}

export interface HomesteadGardenResponse {
  homestead: HomesteadView;
  slots: HomesteadGardenSlotView[];
  productionCatalog: HomesteadGardenCatalogEntry[];
  caps: HomesteadCapsView;
}

export interface HomesteadUpgradeResult {
  fromLevel: number;
  toLevel: number;
  linhThachConsumed: number;
  spiritualEnergyConsumed: number;
  homestead: HomesteadView;
}

export interface HomesteadHarvestResult {
  slotIndex: number;
  cropKey: string;
  itemKey: string;
  qty: number;
  dayBucket: string;
  dailyUsedQty: number;
  dailyLimitQty: number;
}

export interface HomesteadGardenClaimResult {
  slotIndex: number;
  productionKey: string;
  itemKey: string;
  qty: number;
  dayBucket: string;
  dailyUsedQty: number;
  dailyLimitQty: number;
}

export async function getHomestead(): Promise<HomesteadOverview> {
  const { data } = await apiClient.get<Envelope<HomesteadOverview>>('/homestead');
  if (!data.ok || !data.data) throw data.error ?? fallbackError('homesteadState');
  return data.data;
}

export async function upgradeHomestead(): Promise<HomesteadUpgradeResult> {
  const { data } = await apiClient.post<Envelope<HomesteadUpgradeResult>>(
    '/homestead/upgrade',
    {},
  );
  if (!data.ok || !data.data) throw data.error ?? fallbackError('homesteadUpgrade');
  return data.data;
}

export async function getHomesteadFields(): Promise<HomesteadFieldsResponse> {
  const { data } = await apiClient.get<Envelope<HomesteadFieldsResponse>>('/homestead/fields');
  if (!data.ok || !data.data) throw data.error ?? fallbackError('homesteadState');
  return data.data;
}

export async function plantHomesteadField(
  slotIndex: number,
  cropKey: string,
): Promise<HomesteadFieldSlotView> {
  const { data } = await apiClient.post<Envelope<HomesteadFieldSlotView>>(
    '/homestead/fields/plant',
    { slotIndex, cropKey },
  );
  if (!data.ok || !data.data) throw data.error ?? fallbackError('homesteadPlant');
  return data.data;
}

export async function harvestHomesteadField(
  slotIndex: number,
): Promise<HomesteadHarvestResult> {
  const { data } = await apiClient.post<Envelope<HomesteadHarvestResult>>(
    '/homestead/fields/harvest',
    { slotIndex },
  );
  if (!data.ok || !data.data) throw data.error ?? fallbackError('homesteadHarvest');
  return data.data;
}

export async function getHomesteadGarden(): Promise<HomesteadGardenResponse> {
  const { data } = await apiClient.get<Envelope<HomesteadGardenResponse>>('/homestead/garden');
  if (!data.ok || !data.data) throw data.error ?? fallbackError('homesteadState');
  return data.data;
}

export async function startHomesteadGarden(
  slotIndex: number,
  productionKey: string,
): Promise<HomesteadGardenSlotView> {
  const { data } = await apiClient.post<Envelope<HomesteadGardenSlotView>>(
    '/homestead/garden/start',
    { slotIndex, productionKey },
  );
  if (!data.ok || !data.data) throw data.error ?? fallbackError('homesteadGardenStart');
  return data.data;
}

export async function claimHomesteadGarden(
  slotIndex: number,
): Promise<HomesteadGardenClaimResult> {
  const { data } = await apiClient.post<Envelope<HomesteadGardenClaimResult>>(
    '/homestead/garden/claim',
    { slotIndex },
  );
  if (!data.ok || !data.data) throw data.error ?? fallbackError('homesteadGardenClaim');
  return data.data;
}
