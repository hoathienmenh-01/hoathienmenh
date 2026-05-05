import { i18n } from '@/i18n';
import { apiClient } from './client';

/**
 * Phase 12 Story PR-4 — NPC dialogue UI client.
 *
 * Wire 2 endpoint:
 *   - `GET /npcs/me`: list NPC visible (server filter `realmGateOrder` + dialogue
 *     branch picker theo realm + quest status).
 *   - `GET /npcs/:npcKey/dialogue`: refetch dialogue cho NPC sau action (vd accept
 *     quest → dialogue branch có thể đã đổi vì quest_status).
 *
 * Tất cả runtime data (filter, choice annotation, quest status) chạy server-side;
 * FE chỉ render. KHÔNG có mutation endpoint mới — choice với `acceptQuestKey`
 * tái dùng `POST /quests/accept` (Phase 12 PR-2 #426).
 */

interface Envelope<T> {
  ok: boolean;
  data?: T;
  error?: { code: string; message: string };
}

function fallbackError(op: string): Error {
  return new Error(i18n.global.t(`common.apiFallback.${op}`));
}

/** Status snapshot quest mà choice đang reference (`acceptQuestKey`). */
export type ChoiceQuestStatus =
  | 'NOT_STARTED'
  | 'AVAILABLE'
  | 'ACCEPTED'
  | 'COMPLETED'
  | 'CLAIMED'
  | 'LOCKED';

export type NpcFaction =
  | 'hoa_thien_mon'
  | 'tich_thien_dien'
  | 'huyen_kiem_tong'
  | 'van_bao_thuong_hoi'
  | 'huyet_ha_ma_tong'
  | 'tien_dinh_bach_de'
  | 'wandering';

export interface NpcDialogueChoiceView {
  key: string;
  label: string;
  nextDialogueId: string | null;
  acceptQuestKey: string | null;
  acceptQuestStatus: ChoiceQuestStatus | null;
  closeDialogue: boolean;
}

export interface NpcDialogueView {
  dialogueId: string;
  speakerNpcKey: string;
  text: string;
  choices: NpcDialogueChoiceView[];
}

export interface NpcView {
  key: string;
  name: string;
  faction: NpcFaction | null;
  realmGateOrder: number;
  description: string;
  loreSummary: string;
  questCount: number;
  dialogue: NpcDialogueView | null;
}

/**
 * GET /npcs/me — list NPC visible cho character hiện tại (gate `realmGateOrder
 * <= character.realmOrder`). Mỗi NPC có `dialogue` đã filter branch + annotate
 * quest status cho choice. Empty array nếu character realm = phamnhan và không
 * có NPC nào được unlock (lý thuyết ko xảy ra — phamnhan đã có 2 NPC catalog).
 */
export async function fetchNpcs(): Promise<NpcView[]> {
  const { data } = await apiClient.get<Envelope<{ npcs: NpcView[] }>>('/npcs/me');
  if (!data.ok || !data.data) throw data.error ?? fallbackError('npc');
  return data.data.npcs;
}

/**
 * GET /npcs/:npcKey/dialogue — refetch dialogue cho 1 NPC sau action (vd accept
 * quest). Throw `{code}` envelope khi NPC_UNKNOWN / NPC_LOCKED_REALM /
 * NO_DIALOGUE / NO_CHARACTER / UNAUTHENTICATED.
 */
export async function fetchNpcDialogue(npcKey: string): Promise<NpcDialogueView> {
  const { data } = await apiClient.get<Envelope<{ dialogue: NpcDialogueView }>>(
    `/npcs/${encodeURIComponent(npcKey)}/dialogue`,
  );
  if (!data.ok || !data.data) throw data.error ?? fallbackError('npc');
  return data.data.dialogue;
}
