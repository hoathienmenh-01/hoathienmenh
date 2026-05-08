import { i18n } from '@/i18n';
import { apiClient } from './client';

/**
 * Phase 12.10.A — NPC Affinity API client.
 *
 * Wire 2 endpoint:
 *   - `GET /story/npc-affinity`          → list all NPC affinities for character.
 *   - `GET /story/npc-affinity/:npcKey`  → get single NPC affinity.
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
