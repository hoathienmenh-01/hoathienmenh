import { computed, ref } from 'vue';
import { defineStore } from 'pinia';
import * as api from '@/api/storyDungeon';

/**
 * Phase 12.8.C — Story Dungeon FE store (catalog + runtime).
 *
 * State mirror server `GET /story/dungeons`:
 *   - `dungeons`: catalog `enabled=true` + status (locked/available/cleared)
 *     per template, computed server-side từ QuestProgress + Character.realm.
 *   - `activeRun`: run đang ACTIVE / CLEARED-but-unclaimed (server đảm bảo
 *     invariant 1 ACTIVE / character qua `startRun` ALREADY_IN_RUN guard).
 *   - `loaded`/`loading`/`lastError`: lifecycle flags cho loading/empty/error UI.
 *   - `submittingKey`: action key đang chạy (templateKey cho `start`,
 *     `advance` / `clear` / `claim` cho run action) — disable button.
 *   - `submittingError`: code error gần nhất khi action fail.
 *   - `lastClaimResult`: snapshot kết quả claim gần nhất (cho modal +
 *     success toast hiển thị reward grant).
 *
 * Tất cả mutation đi qua server (start/advance/clear/claim). Sau action
 * thành công store reload list từ server (single source of truth).
 * KHÔNG có optimistic update — UI hiển thị state đúng theo server response.
 */

const SUBMIT_ADVANCE = 'advance';
const SUBMIT_CLEAR = 'clear';
const SUBMIT_CLAIM = 'claim';

function extractErrorCode(e: unknown): string {
  return (
    (e as { code?: string }).code ??
    (e as { error?: { code?: string } }).error?.code ??
    'UNKNOWN_ERROR'
  );
}

function notActiveRunError(): Error & { code: string } {
  const err = new Error('NO_ACTIVE_RUN') as Error & { code: string };
  err.code = 'NO_ACTIVE_RUN';
  return err;
}

export const useStoryDungeonStore = defineStore('storyDungeon', () => {
  const dungeons = ref<api.StoryDungeonView[]>([]);
  const activeRun = ref<api.StoryDungeonRunView | null>(null);
  const loaded = ref(false);
  const loading = ref(false);
  const lastError = ref<string | null>(null);

  const submittingKey = ref<string | null>(null);
  const submittingError = ref<string | null>(null);
  const lastClaimResult = ref<api.StoryDungeonClaimResult | null>(null);

  const totalCount = computed(() => dungeons.value.length);
  const availableCount = computed(
    () => dungeons.value.filter((d) => d.status === 'available').length,
  );
  const lockedCount = computed(
    () => dungeons.value.filter((d) => d.status === 'locked').length,
  );
  const clearedCount = computed(
    () => dungeons.value.filter((d) => d.status === 'cleared').length,
  );
  const hasActiveRun = computed(() => activeRun.value !== null);
  const isRunCleared = computed(
    () => activeRun.value?.status === 'CLEARED',
  );
  const isRunClaimable = computed(
    () =>
      activeRun.value?.status === 'CLEARED' && activeRun.value.claimedAt === null,
  );
  const isRunActive = computed(() => activeRun.value?.status === 'ACTIVE');
  const hasAnyAvailable = computed(() => availableCount.value > 0);

  function findDungeon(key: string): api.StoryDungeonView | undefined {
    return dungeons.value.find((d) => d.key === key);
  }

  /**
   * Trả về story dungeon entry (nếu có) cho 1 quest cụ thể — dùng cho
   * QuestView CTA "Vào bí cảnh cốt truyện".
   */
  function findDungeonForQuest(
    questKey: string,
  ): api.StoryDungeonView | undefined {
    return dungeons.value.find((d) => d.requiredQuestKey === questKey);
  }

  async function load(): Promise<void> {
    loading.value = true;
    lastError.value = null;
    try {
      const view = await api.fetchStoryDungeonList();
      dungeons.value = view.dungeons;
      activeRun.value = view.activeRun;
      loaded.value = true;
    } catch (e) {
      lastError.value = extractErrorCode(e);
    } finally {
      loading.value = false;
    }
  }

  /**
   * Start run mới hoặc resume ACTIVE run cùng templateKey (server idempotent).
   * Sau success reload list. Throw error code (caller có thể map → toast i18n).
   */
  async function start(templateKey: string): Promise<void> {
    submittingKey.value = templateKey;
    submittingError.value = null;
    try {
      await api.startStoryDungeon(templateKey);
      await load();
    } catch (e) {
      submittingError.value = extractErrorCode(e);
      throw e;
    } finally {
      submittingKey.value = null;
    }
  }

  /**
   * Advance step của activeRun (kill monster `currentStep`). Sau success
   * reload list (server đẩy currentStep + killedMonsters). KHÔNG cộng
   * loot client-side — story dungeon reward chỉ ở claim path.
   */
  async function advance(): Promise<api.StoryDungeonRunView> {
    const run = activeRun.value;
    if (!run) throw notActiveRunError();
    submittingKey.value = SUBMIT_ADVANCE;
    submittingError.value = null;
    try {
      const next = await api.advanceStoryDungeon(run.id);
      await load();
      return next;
    } catch (e) {
      submittingError.value = extractErrorCode(e);
      throw e;
    } finally {
      submittingKey.value = null;
    }
  }

  /**
   * Clear activeRun — yêu cầu currentStep === totalSteps (đã giết hết
   * monster). Server transition ACTIVE → CLEARED + auto-advance quest step.
   */
  async function clear(): Promise<api.StoryDungeonRunView> {
    const run = activeRun.value;
    if (!run) throw notActiveRunError();
    submittingKey.value = SUBMIT_CLEAR;
    submittingError.value = null;
    try {
      const cleared = await api.clearStoryDungeon(run.id);
      await load();
      return cleared;
    } catch (e) {
      submittingError.value = extractErrorCode(e);
      throw e;
    } finally {
      submittingKey.value = null;
    }
  }

  /**
   * Claim reward của activeRun (yêu cầu CLEARED + chưa CLAIMED). Sau
   * success reload list (status CLAIMED — server clear ACTIVE field).
   * Lưu kết quả vào `lastClaimResult` cho modal + reward toast.
   */
  async function claim(): Promise<api.StoryDungeonClaimResult> {
    const run = activeRun.value;
    if (!run) throw notActiveRunError();
    submittingKey.value = SUBMIT_CLAIM;
    submittingError.value = null;
    try {
      const result = await api.claimStoryDungeon(run.id);
      lastClaimResult.value = result;
      await load();
      return result;
    } catch (e) {
      submittingError.value = extractErrorCode(e);
      throw e;
    } finally {
      submittingKey.value = null;
    }
  }

  function clearLastClaimResult(): void {
    lastClaimResult.value = null;
  }

  function reset(): void {
    dungeons.value = [];
    activeRun.value = null;
    loaded.value = false;
    loading.value = false;
    lastError.value = null;
    submittingKey.value = null;
    submittingError.value = null;
    lastClaimResult.value = null;
  }

  return {
    dungeons,
    activeRun,
    loaded,
    loading,
    lastError,
    submittingKey,
    submittingError,
    lastClaimResult,
    totalCount,
    availableCount,
    lockedCount,
    clearedCount,
    hasActiveRun,
    isRunCleared,
    isRunClaimable,
    isRunActive,
    hasAnyAvailable,
    findDungeon,
    findDungeonForQuest,
    load,
    start,
    advance,
    clear,
    claim,
    clearLastClaimResult,
    reset,
  };
});
