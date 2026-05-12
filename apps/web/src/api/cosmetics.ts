import { apiClient } from './client';
import type {
  CosmeticDef,
  CosmeticType,
  CosmeticView,
} from '@xuantoi/shared';

export type { CosmeticDef, CosmeticType, CosmeticView };

export interface CosmeticLoadoutView {
  activeAuraId: string | null;
  activeTitleId: string | null;
  activeAvatarFrameId: string | null;
  activeChatBadgeId: string | null;
  activeProfileDecorationId: string | null;
  activeElementAuraId: string | null;
}

export interface CosmeticOwnedRow {
  cosmeticId: string;
  source: string;
  ownedAt: string;
  expiresAt: string | null;
}

export interface CosmeticMeResponse {
  catalog: CosmeticView[];
  loadout: CosmeticLoadoutView;
  owned: CosmeticOwnedRow[];
}

export interface CosmeticCatalogResponse {
  catalog: CosmeticDef[];
  types: readonly CosmeticType[];
}

interface Envelope<T> {
  ok: boolean;
  data?: T;
  error?: { code: string; message: string };
}

export async function fetchCosmeticProfile(
  characterId: string,
): Promise<{ loadout: CosmeticLoadoutView }> {
  const { data } = await apiClient.get<Envelope<{ loadout: CosmeticLoadoutView }>>(
    `/cosmetics/profile/${encodeURIComponent(characterId)}`,
  );
  if (!data.ok || !data.data) throw data.error ?? new Error('Failed to load cosmetic profile');
  return data.data;
}

export async function fetchCosmeticCatalog(): Promise<CosmeticCatalogResponse> {
  const { data } = await apiClient.get<Envelope<CosmeticCatalogResponse>>(
    '/cosmetics/catalog',
  );
  if (!data.ok || !data.data) throw data.error ?? new Error('Failed to load cosmetic catalog');
  return data.data;
}

export async function fetchCosmeticMe(): Promise<CosmeticMeResponse> {
  const { data } = await apiClient.get<Envelope<CosmeticMeResponse>>('/cosmetics/me');
  if (!data.ok || !data.data) throw data.error ?? new Error('Failed to load cosmetics');
  return data.data;
}

export async function equipCosmetic(
  cosmeticId: string,
): Promise<CosmeticLoadoutView> {
  const { data } = await apiClient.post<Envelope<{ loadout: CosmeticLoadoutView }>>(
    '/cosmetics/equip',
    { cosmeticId },
  );
  if (!data.ok || !data.data) throw data.error ?? new Error('Failed to equip cosmetic');
  return data.data.loadout;
}

export async function unequipCosmetic(
  type: CosmeticType,
): Promise<CosmeticLoadoutView> {
  const { data } = await apiClient.post<Envelope<{ loadout: CosmeticLoadoutView }>>(
    '/cosmetics/unequip',
    { type },
  );
  if (!data.ok || !data.data) throw data.error ?? new Error('Failed to unequip cosmetic');
  return data.data.loadout;
}
