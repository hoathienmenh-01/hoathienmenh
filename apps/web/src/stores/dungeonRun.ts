import { computed, ref } from 'vue';
import { defineStore } from 'pinia';
import * as api from '@/api/dungeonRun';

/**
 * Phase 12.2.C — DungeonRun runtime store (multi-encounter expedition).
 *
 * State mirror server `GET /dungeons/me`:
 *   - `available`: per-dungeon availability (unlocked/startable/lockReason +
 *     dailyUsed/dailyLimit) — server-side computed (realm gate + daily count
 *     + stamina). FE chỉ render flag, KHÔNG tự tính.
 *   - `activeRun`: run đang ACTIVE/COMPLETED nếu có. Server đảm bảo invariant
 *     1 active run / character (ALREADY_IN_RUN khi cố start cái thứ 2).
 *   - `loaded`/`loading`/`lastError`: lifecycle flags cho loading/empty/error UI.
 *   - `submittingKey`: action key đang chạy (templateKey cho start, 'next' /
 *     'claim' cho run action) — disable button.
 *   - `submittingError`: code error gần nhất khi action fail.
 *   - `lastClaimResult`: snapshot kết quả claim gần nhất (cho modal +
 *     success toast hiển thị reward grant).
 *
 * Tất cả mutation đi qua server (`POST /dungeons/:templateKey/start`,
 * `POST /dungeon-runs/:runId/next`, `POST /dungeon-runs/:runId/claim`).
 * Sau action thành công store reload list từ server (single source of truth).
 * KHÔNG có optimistic update — UI hiển thị state đúng theo server response.
 */

const SUBMIT_NEXT = 'next';
const SUBMIT_CLAIM = 'claim';

function extractErrorCode(e: unknown): string {
  return (
    (e as { code?: string }).code ??
    (e as { error?: { code?: string } }).error?.code ??
    'UNKNOWN_ERROR'
  );
}

export const useDungeonRunStore = defineStore('dungeonRun', () => {
  const available = ref<api.DungeonAvailabilityView[]>([]);
  const activeRun = ref<api.DungeonRunView | null>(null);
  const loaded = ref(false);
  const loading = ref(false);
  const lastError = ref<string | null>(null);

  const submittingKey = ref<string | null>(null);
  const submittingError = ref<string | null>(null);
  const lastClaimResult = ref<api.DungeonClaimResult | null>(null);

  const totalCount = computed(() => available.value.length);
  const startableCount = computed(
    () => available.value.filter((a) => a.startable).length,
  );
  const hasActiveRun = computed(() => activeRun.value !== null);
  const isRunCompleted = computed(
    () => activeRun.value?.status === 'COMPLETED',
  );
  const isRunClaimable = computed(
    () => activeRun.value?.status === 'COMPLETED' && activeRun.value.claimedAt === null,
  );

  function findAvailability(
    templateKey: string,
  ): api.DungeonAvailabilityView | undefined {
    return available.value.find((a) => a.dungeon.key === templateKey);
  }

  async function load(): Promise<void> {
    loading.value = true;
    lastError.value = null;
    try {
      const view = await api.fetchDungeonRunList();
      available.value = view.available;
      activeRun.value = view.activeRun;
      loaded.value = true;
    } catch (e) {
      lastError.value = extractErrorCode(e);
    } finally {
      loading.value = false;
    }
  }

  /**
   * Start run mới. Sau success reload list (server đảm bảo activeRun mới
   * + daily count tăng). Throw error code (caller có thể map → toast i18n).
   */
  async function start(templateKey: string): Promise<void> {
    submittingKey.value = templateKey;
    submittingError.value = null;
    try {
      await api.startDungeonRun(templateKey);
      await load();
    } catch (e) {
      submittingError.value = extractErrorCode(e);
      throw e;
    } finally {
      submittingKey.value = null;
    }
  }

  /**
   * Advance encounter của activeRun. Sau success reload list (server đẩy
   * encounterIndex hoặc set status=COMPLETED). KHÔNG cộng exp/loot
   * client-side — chỉ COMPLETED + claim mới grant bonus reward.
   */
  async function next(): Promise<api.DungeonRunView> {
    const run = activeRun.value;
    if (!run) {
      const err = new Error('NO_ACTIVE_RUN');
      (err as Error & { code: string }).code = 'NO_ACTIVE_RUN';
      throw err;
    }
    submittingKey.value = SUBMIT_NEXT;
    submittingError.value = null;
    try {
      const next = await api.nextDungeonEncounter(run.id);
      // Refresh list để có activeRun fresh + daily count nếu COMPLETED.
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
   * Claim reward của activeRun (yêu cầu COMPLETED + chưa CLAIMED). Sau
   * success reload list (server đẩy status CLAIMED + clear activeRun nếu
   * không còn run nào ACTIVE). Lưu kết quả claim vào `lastClaimResult` cho
   * modal + toast hiển thị reward grant.
   */
  async function claim(): Promise<api.DungeonClaimResult> {
    const run = activeRun.value;
    if (!run) {
      const err = new Error('NO_ACTIVE_RUN');
      (err as Error & { code: string }).code = 'NO_ACTIVE_RUN';
      throw err;
    }
    submittingKey.value = SUBMIT_CLAIM;
    submittingError.value = null;
    try {
      const result = await api.claimDungeonRun(run.id);
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
    available.value = [];
    activeRun.value = null;
    loaded.value = false;
    loading.value = false;
    lastError.value = null;
    submittingKey.value = null;
    submittingError.value = null;
    lastClaimResult.value = null;
  }

  return {
    available,
    activeRun,
    loaded,
    loading,
    lastError,
    submittingKey,
    submittingError,
    lastClaimResult,
    totalCount,
    startableCount,
    hasActiveRun,
    isRunCompleted,
    isRunClaimable,
    findAvailability,
    load,
    start,
    next,
    claim,
    clearLastClaimResult,
    reset,
  };
});
