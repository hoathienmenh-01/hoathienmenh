import { i18n } from '@/i18n';
import { apiClient } from './client';

/**
 * Phase 34.4 — Loadout Preset client.
 *
 * Endpoints (mirror `LoadoutPresetController` /loadouts/v1):
 *   GET    /loadouts/v1
 *   GET    /loadouts/v1/:presetId
 *   POST   /loadouts/v1
 *   PUT    /loadouts/v1/:presetId
 *   DELETE /loadouts/v1/:presetId
 *   POST   /loadouts/v1/save-current
 *   POST   /loadouts/v1/:presetId/validate
 *   POST   /loadouts/v1/:presetId/apply
 */

interface Envelope<T> {
  ok: boolean;
  data?: T;
  error?: { code: string; message: string };
}

function fallbackError(): Error {
  return new Error(i18n.global.t('common.apiFallback.quest'));
}

export type LoadoutPresetType =
  | 'PVE'
  | 'PVP'
  | 'BOSS'
  | 'CULTIVATION'
  | 'CUSTOM';

export type EquipSlot =
  | 'WEAPON'
  | 'ARMOR'
  | 'BELT'
  | 'BOOTS'
  | 'HAT'
  | 'TRAM'
  | 'ARTIFACT_1'
  | 'ARTIFACT_2'
  | 'ARTIFACT_3';

export interface LoadoutPresetEquipmentEntry {
  slot: EquipSlot;
  inventoryItemId: string;
}

export interface LoadoutPresetView {
  id: string;
  characterId: string;
  presetType: LoadoutPresetType;
  name: string;
  equipment: LoadoutPresetEquipmentEntry[];
  isActiveForPve: boolean;
  isActiveForPvp: boolean;
  isActiveForBoss: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface LoadoutPresetApplyReport {
  preset: LoadoutPresetView;
  applied: LoadoutPresetEquipmentEntry[];
  skipped: { slot: EquipSlot; reason: string }[];
}

export interface LoadoutPresetValidateResult {
  ok: boolean;
  errors: { slot: EquipSlot; code: string }[];
}

export async function fetchLoadoutPresets(): Promise<LoadoutPresetView[]> {
  const { data } = await apiClient.get<
    Envelope<{ presets: LoadoutPresetView[] }>
  >('/loadouts/v1');
  if (!data.ok || !data.data) throw data.error ?? fallbackError();
  return data.data.presets;
}

export async function fetchLoadoutPreset(
  presetId: string,
): Promise<LoadoutPresetView> {
  const { data } = await apiClient.get<
    Envelope<{ preset: LoadoutPresetView }>
  >(`/loadouts/v1/${encodeURIComponent(presetId)}`);
  if (!data.ok || !data.data) throw data.error ?? fallbackError();
  return data.data.preset;
}

export async function createLoadoutPreset(input: {
  presetType: LoadoutPresetType;
  name: string;
  equipment?: LoadoutPresetEquipmentEntry[];
}): Promise<LoadoutPresetView> {
  const { data } = await apiClient.post<
    Envelope<{ preset: LoadoutPresetView }>
  >('/loadouts/v1', input);
  if (!data.ok || !data.data) throw data.error ?? fallbackError();
  return data.data.preset;
}

export async function updateLoadoutPreset(
  presetId: string,
  input: { name?: string; equipment?: LoadoutPresetEquipmentEntry[] },
): Promise<LoadoutPresetView> {
  const { data } = await apiClient.put<
    Envelope<{ preset: LoadoutPresetView }>
  >(`/loadouts/v1/${encodeURIComponent(presetId)}`, input);
  if (!data.ok || !data.data) throw data.error ?? fallbackError();
  return data.data.preset;
}

export async function deleteLoadoutPreset(presetId: string): Promise<void> {
  const { data } = await apiClient.delete<Envelope<unknown>>(
    `/loadouts/v1/${encodeURIComponent(presetId)}`,
  );
  if (!data.ok) throw data.error ?? fallbackError();
}

export async function saveCurrentLoadout(input: {
  presetType: LoadoutPresetType;
  name: string;
}): Promise<LoadoutPresetView> {
  const { data } = await apiClient.post<
    Envelope<{ preset: LoadoutPresetView }>
  >('/loadouts/v1/save-current', input);
  if (!data.ok || !data.data) throw data.error ?? fallbackError();
  return data.data.preset;
}

export async function validateLoadoutPreset(
  presetId: string,
): Promise<LoadoutPresetValidateResult> {
  const { data } = await apiClient.post<
    Envelope<LoadoutPresetValidateResult>
  >(`/loadouts/v1/${encodeURIComponent(presetId)}/validate`);
  if (!data.ok || !data.data) throw data.error ?? fallbackError();
  return data.data;
}

export async function applyLoadoutPreset(
  presetId: string,
): Promise<LoadoutPresetApplyReport> {
  const { data } = await apiClient.post<
    Envelope<LoadoutPresetApplyReport>
  >(`/loadouts/v1/${encodeURIComponent(presetId)}/apply`);
  if (!data.ok || !data.data) throw data.error ?? fallbackError();
  return data.data;
}
