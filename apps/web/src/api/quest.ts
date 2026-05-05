import { i18n } from '@/i18n';
import { apiClient } from './client';

/**
 * Phase 12 Story PR-4 — minimal Quest accept client cho NPC dialogue choice.
 *
 * PR-5 sẽ expand: GET /quests/me list, POST /quests/progress, POST /quests/claim
 * + Pinia store + QuestView. PR-4 chỉ cần `acceptQuest()` cho choice button trong
 * `NpcDialogueModal.vue` (server-authoritative — không tự cộng quest progress).
 */

interface Envelope<T> {
  ok: boolean;
  data?: T;
  error?: { code: string; message: string };
}

function fallbackError(): Error {
  return new Error(i18n.global.t('common.apiFallback.quest'));
}

/**
 * POST /quests/accept — accept quest từ NPC dialogue choice.
 *
 * Throw `{code, message}` envelope nếu fail (UNAUTHENTICATED / NO_CHARACTER /
 * QUEST_UNKNOWN / QUEST_LOCKED_REALM / QUEST_LOCKED_PREREQUISITE / QUEST_NOT_AVAILABLE).
 * Caller map code → toast i18n key `npc.dialogue.errors.{code}`.
 */
export async function acceptQuest(questKey: string): Promise<void> {
  const { data } = await apiClient.post<Envelope<{ quest: unknown }>>(
    '/quests/accept',
    { questKey },
  );
  if (!data.ok) throw data.error ?? fallbackError();
}
