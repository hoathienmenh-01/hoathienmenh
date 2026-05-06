import { computed, ref } from 'vue';
import { defineStore } from 'pinia';
import * as api from '@/api/quest';

/**
 * Phase 12 Story Runtime MVP (PR-5) — Quest list / accept / claim store.
 *
 * State mirror server `GET /quests/me`:
 *   - `quests`: full list quest visible (LOCKED / AVAILABLE / ACCEPTED /
 *     COMPLETED / CLAIMED). Server đã lazy-create AVAILABLE row + filter
 *     theo realm gate + prereq.
 *   - `loaded` / `loading` / `lastError`: lifecycle flags cho loading/empty/error UI.
 *   - `kindFilter`: client-side filter theo `QuestKind` (null = tất cả).
 *   - `submittingKey`: questKey đang accept/claim (null = idle) — disable button.
 *   - `submittingError`: code error gần nhất khi accept/claim fail.
 *   - `lastClaimResult`: kết quả claim gần nhất (cho toast "đã nhận thưởng X").
 *
 * Tất cả mutation đi qua server (`POST /quests/accept` / `POST /quests/claim`).
 * Sau action thành công store reload list từ server (single source of truth).
 * KHÔNG có optimistic update — UI hiển thị state đúng theo server response.
 */

function extractErrorCode(e: unknown): string {
  return (
    (e as { code?: string }).code ??
    (e as { error?: { code?: string } }).error?.code ??
    'UNKNOWN_ERROR'
  );
}

export const useQuestStore = defineStore('quest', () => {
  const quests = ref<api.QuestProgressView[]>([]);
  const loaded = ref(false);
  const loading = ref(false);
  const lastError = ref<string | null>(null);

  const kindFilter = ref<api.QuestKind | null>(null);

  const submittingKey = ref<string | null>(null);
  const submittingError = ref<string | null>(null);
  const lastClaimResult = ref<api.QuestClaimResult | null>(null);

  /** Filtered list theo `kindFilter` (null = tất cả). */
  const filteredQuests = computed<api.QuestProgressView[]>(() => {
    if (!kindFilter.value) return quests.value;
    return quests.value.filter((q) => q.kind === kindFilter.value);
  });

  const totalCount = computed(() => quests.value.length);
  const filteredCount = computed(() => filteredQuests.value.length);

  /** Quest đang nhận (ACCEPTED / COMPLETED) — đếm cho badge nav. */
  const activeCount = computed(
    () =>
      quests.value.filter(
        (q) => q.status === 'ACCEPTED' || q.status === 'COMPLETED',
      ).length,
  );

  /** Quest có thể claim (COMPLETED + chưa claimedAt) — đếm cho badge nav. */
  const claimableCount = computed(
    () => quests.value.filter((q) => q.status === 'COMPLETED').length,
  );

  function findQuest(key: string): api.QuestProgressView | undefined {
    return quests.value.find((q) => q.key === key);
  }

  function setKindFilter(kind: api.QuestKind | null): void {
    kindFilter.value = kind;
  }

  async function load(): Promise<void> {
    loading.value = true;
    lastError.value = null;
    try {
      quests.value = await api.fetchQuests();
      loaded.value = true;
    } catch (e) {
      lastError.value = extractErrorCode(e);
    } finally {
      loading.value = false;
    }
  }

  /**
   * Accept quest. Sau success reload list (server đổi status AVAILABLE→ACCEPTED).
   * Throw error code (caller có thể map → toast i18n).
   */
  async function accept(questKey: string): Promise<void> {
    submittingKey.value = questKey;
    submittingError.value = null;
    try {
      await api.acceptQuest(questKey);
      // Reload từ server để có status mới + step state.
      await load();
    } catch (e) {
      submittingError.value = extractErrorCode(e);
      throw e;
    } finally {
      submittingKey.value = null;
    }
  }

  /**
   * Claim reward. Sau success reload list (server đổi status COMPLETED→CLAIMED).
   * Lưu kết quả claim vào `lastClaimResult` cho toast hiển thị reward grant.
   * Throw error code (caller có thể map → toast i18n).
   */
  async function claim(questKey: string): Promise<api.QuestClaimResult> {
    submittingKey.value = questKey;
    submittingError.value = null;
    try {
      const result = await api.claimQuest(questKey);
      lastClaimResult.value = result;
      // Reload từ server để có status CLAIMED + claimedAt.
      await load();
      return result;
    } catch (e) {
      submittingError.value = extractErrorCode(e);
      throw e;
    } finally {
      submittingKey.value = null;
    }
  }

  function reset(): void {
    quests.value = [];
    loaded.value = false;
    loading.value = false;
    lastError.value = null;
    kindFilter.value = null;
    submittingKey.value = null;
    submittingError.value = null;
    lastClaimResult.value = null;
  }

  return {
    quests,
    loaded,
    loading,
    lastError,
    kindFilter,
    submittingKey,
    submittingError,
    lastClaimResult,
    filteredQuests,
    totalCount,
    filteredCount,
    activeCount,
    claimableCount,
    findQuest,
    setKindFilter,
    load,
    accept,
    claim,
    reset,
  };
});
