import type { CharacterStatePayload, TitleDef, TitleSource } from '@xuantoi/shared';
import { i18n } from '@/i18n';
import { apiClient } from './client';

/**
 * Phase 11.9.C — Title (Danh hiệu) UI API client.
 *
 * Wire 3 endpoint:
 *   - `GET  /character/titles`         → list owned + full catalog + equipped.
 *   - `POST /character/title/equip`    → equip 1 title (single-slot).
 *   - `POST /character/title/unequip`  → clear equipped title.
 *
 * Server-authoritative — client chỉ gửi `titleKey` (equip), server validate
 * ownership + set `Character.title`. Catalog snapshot trả về cùng response
 * cho phép FE render lock state mà không cần import `TITLES` const trực tiếp
 * từ shared (giảm bundle size khi catalog thay đổi).
 */

interface Envelope<T> {
  ok: boolean;
  data?: T;
  error?: { code: string; message: string };
}

function fallbackError(op: string): Error {
  return new Error(i18n.global.t(`common.apiFallback.${op}`));
}

export interface OwnedTitleRow {
  titleKey: string;
  source: TitleSource;
  /** ISO timestamp from server. */
  unlockedAt: string;
  def: TitleDef;
}

export interface EquippedTitle {
  titleKey: string;
  def: TitleDef;
}

export interface TitlesStateResponse {
  owned: OwnedTitleRow[];
  /** Full catalog snapshot từ server (`TITLES`). */
  catalog: readonly TitleDef[];
  equipped: EquippedTitle | null;
}

export async function getTitlesState(): Promise<TitlesStateResponse> {
  const { data } = await apiClient.get<Envelope<TitlesStateResponse>>(
    '/character/titles',
  );
  if (!data.ok || !data.data) throw data.error ?? fallbackError('titlesState');
  return data.data;
}

export interface EquipTitleResponse {
  character: CharacterStatePayload;
  equipped: EquippedTitle | null;
}

export async function equipTitle(titleKey: string): Promise<EquipTitleResponse> {
  const { data } = await apiClient.post<Envelope<EquipTitleResponse>>(
    '/character/title/equip',
    { titleKey },
  );
  if (!data.ok || !data.data) throw data.error ?? fallbackError('titleEquip');
  return data.data;
}

export interface UnequipTitleResponse {
  character: CharacterStatePayload;
}

export async function unequipTitle(): Promise<UnequipTitleResponse> {
  const { data } = await apiClient.post<Envelope<UnequipTitleResponse>>(
    '/character/title/unequip',
    {},
  );
  if (!data.ok || !data.data) throw data.error ?? fallbackError('titleUnequip');
  return data.data;
}
