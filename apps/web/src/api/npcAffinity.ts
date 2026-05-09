import { i18n } from '@/i18n';
import { apiClient } from './client';

/**
 * Phase 12.10.A — NPC Affinity API client.
 *
 * Wire 2 endpoint:
 *   - `GET /story/npc-affinity`          → list all NPC affinities for character.
 *   - `GET /story/npc-affinity/:npcKey`  → get single NPC affinity.
 *
 * Phase 12.10.B — bổ sung gift API:
 *   - `POST /story/npc-affinity/:npcKey/gift`            → consume 1 item, +affinity.
 *   - `GET  /story/npc-affinity/gift/daily`              → counts hôm nay theo UTC bucket.
 */

interface Envelope<T> {
  ok: boolean;
  data?: T;
  error?: { code: string; message: string };
}

function fallbackError(op: string): Error {
  return new Error(i18n.global.t(`common.apiFallback.${op}`));
}

export interface NpcAffinityTierView {
  key: string;
  label: string;
  labelEn: string;
  minScore: number;
  order: number;
}

export interface NpcAffinityUnlockHintView {
  tierKey: string;
  tierLabel: string;
  tierLabelEn: string;
  tierMinScore: number;
  description: string;
  descriptionEn: string;
  reached: boolean;
}

export interface NpcAffinityView {
  npcKey: string;
  npcName: string;
  score: number;
  minScore: number;
  maxScore: number;
  initialScore: number;
  currentTier: NpcAffinityTierView;
  nextTier: (NpcAffinityTierView & { pointsToReach: number }) | null;
  unlocks: NpcAffinityUnlockHintView[];
}

export interface NpcAffinityCaps {
  perChoice: number;
  perQuestReward: number;
}

export async function fetchNpcAffinities(): Promise<{
  affinities: NpcAffinityView[];
  caps: NpcAffinityCaps;
}> {
  const { data } = await apiClient.get<
    Envelope<{ affinities: NpcAffinityView[]; caps: NpcAffinityCaps }>
  >('/story/npc-affinity');
  if (!data.ok || !data.data) throw data.error ?? fallbackError('npcAffinity');
  return data.data;
}

export async function fetchNpcAffinity(npcKey: string): Promise<NpcAffinityView> {
  const { data } = await apiClient.get<Envelope<{ affinity: NpcAffinityView }>>(
    `/story/npc-affinity/${encodeURIComponent(npcKey)}`,
  );
  if (!data.ok || !data.data) throw data.error ?? fallbackError('npcAffinity');
  return data.data.affinity;
}

// ====================================================================
// Phase 12.10.B — Gift action
// ====================================================================

/**
 * Phase 12.10.B — kết quả 1 lần gift NPC. Mirror server `GiftNpcResult`.
 *
 * `remainingToday` = `dailyLimit - usedToday` SAU khi gift thành công, FE
 * dùng để disable button khi == 0. `tierChanged` để toast "đạt tier mới".
 */
export interface NpcGiftResultView {
  npcKey: string;
  itemKey: string;
  affinityDelta: number;
  previousScore: number;
  newScore: number;
  tierChanged: boolean;
  dayBucket: string;
  sequence: number;
  remainingToday: number;
  dailyLimit: number;
}

/** Phase 12.10.B — daily counts cho FE locked state mỗi NPC. */
export interface NpcGiftDailyCount {
  npcKey: string;
  dayBucket: string;
  usedToday: number;
  dailyLimit: number;
  remainingToday: number;
}

/**
 * Phase 12.10.B — POST `/story/npc-affinity/:npcKey/gift`.
 * Server consume 1 item từ inventory + apply affinity + ghi log atomic.
 */
export async function giftNpc(
  npcKey: string,
  itemKey: string,
): Promise<{ affinity: NpcAffinityView; gift: NpcGiftResultView }> {
  const { data } = await apiClient.post<
    Envelope<{ affinity: NpcAffinityView; gift: NpcGiftResultView }>
  >(`/story/npc-affinity/${encodeURIComponent(npcKey)}/gift`, { itemKey });
  if (!data.ok || !data.data) throw data.error ?? fallbackError('npcAffinity');
  return data.data;
}

/**
 * Phase 12.10.B — GET `/story/npc-affinity/gift/daily`.
 * Trả counts hôm nay (UTC) — FE dùng để disable button khi đạt limit hoặc
 * hiển thị "x/y today".
 */
export async function fetchNpcGiftDaily(): Promise<NpcGiftDailyCount[]> {
  const { data } = await apiClient.get<Envelope<{ counts: NpcGiftDailyCount[] }>>(
    '/story/npc-affinity/gift/daily',
  );
  if (!data.ok || !data.data) throw data.error ?? fallbackError('npcAffinity');
  return data.data.counts;
}
