import { i18n } from '@/i18n';
import { apiClient } from './client';
import type {
  ArtifactEquipSlot,
  EquipSlot,
  LoadoutApplyResult,
  LoadoutPresetMode,
  LoadoutPresetView,
} from '@xuantoi/shared';

/**
 * Phase QOL-2 — Loadout Preset API client.
 *
 * Wire `/loadouts` endpoints to FE. Server-authoritative:
 *   - tạo preset chỉ lưu snapshot id (KHÔNG snapshot stat).
 *   - apply() rewrite `equippedSlot` / `isEquipped` qua $transaction;
 *     nếu missing reference → warnings + KHÔNG apply.
 */

interface Envelope<T> {
  ok: boolean;
  data?: T;
  error?: { code: string; message: string };
}

function fallbackError(op: string): Error {
  return new Error(i18n.global.t(`common.apiFallback.${op}`));
}

function unwrap<T>(env: Envelope<T>, op: string): T {
  if (!env.ok || env.data === undefined) {
    if (env.error?.code) {
      throw env.error;
    }
    throw fallbackError(op);
  }
  return env.data;
}

export interface LoadoutPresetInput {
  name: string;
  mode: LoadoutPresetMode;
  equipmentSlots?: Partial<Record<EquipSlot, string>> | null;
  skillSlots?: readonly string[] | null;
  artifactSlots?: Partial<Record<ArtifactEquipSlot, string>> | null;
}

export async function listLoadoutPresets(): Promise<LoadoutPresetView[]> {
  const { data } = await apiClient.get<Envelope<{ presets: LoadoutPresetView[] }>>(
    '/loadouts',
  );
  return unwrap(data, 'loadoutList').presets;
}

export async function createLoadoutPreset(
  input: LoadoutPresetInput,
): Promise<LoadoutPresetView> {
  const { data } = await apiClient.post<Envelope<{ preset: LoadoutPresetView }>>(
    '/loadouts',
    input,
  );
  return unwrap(data, 'loadoutCreate').preset;
}

export async function updateLoadoutPreset(
  id: string,
  patch: Partial<LoadoutPresetInput>,
): Promise<LoadoutPresetView> {
  const { data } = await apiClient.patch<Envelope<{ preset: LoadoutPresetView }>>(
    `/loadouts/${id}`,
    patch,
  );
  return unwrap(data, 'loadoutUpdate').preset;
}

export async function deleteLoadoutPreset(id: string): Promise<void> {
  const { data } = await apiClient.delete<Envelope<{ deleted: true }>>(
    `/loadouts/${id}`,
  );
  unwrap(data, 'loadoutDelete');
}

export async function applyLoadoutPreset(
  id: string,
): Promise<LoadoutApplyResult> {
  const { data } = await apiClient.post<Envelope<LoadoutApplyResult>>(
    `/loadouts/${id}/apply`,
  );
  return unwrap(data, 'loadoutApply');
}

export async function setLoadoutDefault(
  id: string,
  mode: Exclude<LoadoutPresetMode, 'CUSTOM'>,
): Promise<LoadoutPresetView> {
  const { data } = await apiClient.post<Envelope<{ preset: LoadoutPresetView }>>(
    `/loadouts/${id}/set-default`,
    { mode },
  );
  return unwrap(data, 'loadoutSetDefault').preset;
}
