import { computed, ref } from 'vue';
import { defineStore } from 'pinia';
import * as api from '@/api/storyV2';

/**
 * Phase 33.2 — Story V2 store (Tu Tiên Lộ Quyển II–IV).
 *
 * State mirror server endpoints `Phase33StoryModule`:
 *   - `chapters`: list visible chapter (server lazy-create AVAILABLE row
 *     theo realm gate).
 *   - `questsByChapKey`: cache quest list per `chapKey` (lazy-load khi user
 *     drill vào chapter detail).
 *   - `dialoguesByQuestKey`: cache dialogue per `questKey`.
 *   - `selectedChapKey`: chapter người chơi đang xem detail (null = list).
 *   - `loaded` / `loading` / `lastError`: lifecycle flags.
 *   - `submittingKey`: questKey đang accept/progress/complete/claim → disable
 *     button đó.
 *
 * Tất cả mutation gọi server. Sau action thành công store reload chapter +
 * quest list từ server. KHÔNG optimistic update.
 */

function extractErrorCode(e: unknown): string {
  return (
    (e as { code?: string }).code ??
    (e as { error?: { code?: string } }).error?.code ??
    'UNKNOWN_ERROR'
  );
}

export const useStoryV2Store = defineStore('storyV2', () => {
  const chapters = ref<api.Phase33ChapterView[]>([]);
  const questsByChapKey = ref<Record<string, api.Phase33QuestView[]>>({});
  const dialoguesByQuestKey = ref<Record<string, api.Phase33DialogueView[]>>(
    {},
  );

  const selectedChapKey = ref<string | null>(null);

  const loaded = ref(false);
  const loading = ref(false);
  const lastError = ref<string | null>(null);

  const submittingKey = ref<string | null>(null);
  const submittingError = ref<string | null>(null);
  const lastClaimResult = ref<api.Phase33ClaimResult | null>(null);

  const selectedChapter = computed<api.Phase33ChapterView | null>(() => {
    if (!selectedChapKey.value) return null;
    return (
      chapters.value.find((c) => c.chapKey === selectedChapKey.value) ?? null
    );
  });

  const selectedChapterQuests = computed<api.Phase33QuestView[]>(() => {
    if (!selectedChapKey.value) return [];
    return questsByChapKey.value[selectedChapKey.value] ?? [];
  });

  async function loadChapters(): Promise<void> {
    loading.value = true;
    lastError.value = null;
    try {
      chapters.value = await api.fetchPhase33Chapters();
      loaded.value = true;
    } catch (e) {
      lastError.value = extractErrorCode(e);
    } finally {
      loading.value = false;
    }
  }

  async function loadQuests(chapKey: string): Promise<void> {
    loading.value = true;
    lastError.value = null;
    try {
      const quests = await api.fetchPhase33Quests(chapKey);
      questsByChapKey.value = {
        ...questsByChapKey.value,
        [chapKey]: quests,
      };
    } catch (e) {
      lastError.value = extractErrorCode(e);
    } finally {
      loading.value = false;
    }
  }

  async function loadDialogues(
    questKey: string,
    phase?: api.Phase33DialoguePhase,
  ): Promise<void> {
    try {
      const dialogues = await api.fetchPhase33Dialogues(questKey, phase);
      dialoguesByQuestKey.value = {
        ...dialoguesByQuestKey.value,
        [questKey]: dialogues,
      };
    } catch (e) {
      lastError.value = extractErrorCode(e);
    }
  }

  function selectChapter(chapKey: string | null): void {
    selectedChapKey.value = chapKey;
  }

  async function acceptQuest(questKey: string): Promise<void> {
    submittingKey.value = questKey;
    submittingError.value = null;
    try {
      await api.acceptPhase33Quest(questKey);
      // Reload chapter + quest list — server đã transit AVAILABLE→ACCEPTED
      // + auto-flip chapter AVAILABLE→IN_PROGRESS.
      if (selectedChapKey.value) await loadQuests(selectedChapKey.value);
      await loadChapters();
    } catch (e) {
      submittingError.value = extractErrorCode(e);
    } finally {
      submittingKey.value = null;
    }
  }

  async function progressQuest(
    questKey: string,
    stepId: string,
    amount = 1,
  ): Promise<void> {
    submittingKey.value = questKey;
    submittingError.value = null;
    try {
      await api.progressPhase33Quest(questKey, stepId, amount);
      if (selectedChapKey.value) await loadQuests(selectedChapKey.value);
    } catch (e) {
      submittingError.value = extractErrorCode(e);
    } finally {
      submittingKey.value = null;
    }
  }

  async function completeQuest(questKey: string): Promise<void> {
    submittingKey.value = questKey;
    submittingError.value = null;
    try {
      await api.completePhase33Quest(questKey);
      if (selectedChapKey.value) await loadQuests(selectedChapKey.value);
    } catch (e) {
      submittingError.value = extractErrorCode(e);
    } finally {
      submittingKey.value = null;
    }
  }

  async function claimQuest(questKey: string): Promise<void> {
    submittingKey.value = questKey;
    submittingError.value = null;
    try {
      lastClaimResult.value = await api.claimPhase33Quest(questKey);
      if (selectedChapKey.value) await loadQuests(selectedChapKey.value);
      await loadChapters();
    } catch (e) {
      submittingError.value = extractErrorCode(e);
    } finally {
      submittingKey.value = null;
    }
  }

  function clearSubmittingError(): void {
    submittingError.value = null;
  }

  return {
    chapters,
    questsByChapKey,
    dialoguesByQuestKey,
    selectedChapKey,
    selectedChapter,
    selectedChapterQuests,
    loaded,
    loading,
    lastError,
    submittingKey,
    submittingError,
    lastClaimResult,
    loadChapters,
    loadQuests,
    loadDialogues,
    selectChapter,
    acceptQuest,
    progressQuest,
    completeQuest,
    claimQuest,
    clearSubmittingError,
  };
});
