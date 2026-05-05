import { computed, ref } from 'vue';
import { defineStore } from 'pinia';
import * as api from '@/api/breakthrough';

/**
 * Phase 11 nâng cao §5 PR3 — client-side filter cho history view. Mirror
 * `tribulation.ts` HistoryFilter pattern.
 *   - `'all'`: không filter (default).
 *   - `'success'`: chỉ rows `success === true`.
 *   - `'fail'`: chỉ rows `success === false`.
 */
export type BreakthroughHistoryFilter = 'all' | 'success' | 'fail';

/**
 * Phase 11 nâng cao §5 PR3 — server-authoritative Breakthrough RNG store.
 *
 * Wire 2 endpoint:
 *   - `POST /character/breakthrough/attempt`: trigger RNG attempt. Server
 *     ghi `BreakthroughAttemptLog` + advance realm khi success hoặc apply
 *     `tam_ma_light` debuff khi fail.
 *   - `GET /character/breakthrough/log`: fetch history rows DESC.
 *
 * State:
 *   - `lastOutcome`: outcome của lần attempt gần nhất (success/fail) hoặc
 *     `null` nếu chưa attempt phiên này. Dùng cho UI hiển thị banner
 *     "Đột phá thành công" / "Thất bại — Tâm Ma Khinh quấy nhiễu" sau
 *     khi attempt.
 *   - `inFlight`: boolean — `true` khi đang chờ server respond. Disable
 *     button + chống double-click.
 *   - `lastError`: error code string (nếu attempt fail vì server reject —
 *     khác với fail RNG simulation). Caller dùng key i18n
 *     `breakthrough.errors.{code}`.
 *   - `history` + pagination state: mirror tribulation pattern.
 *
 * Note: Hai khái niệm fail khác nhau:
 *   1. `attempt()` return `'NOT_AT_PEAK'`: server reject attempt, không
 *      ghi log, `lastOutcome` không đổi. Caller hiển thị toast lỗi.
 *   2. `attempt()` return `null` + `lastOutcome.success === false`:
 *      attempt được server accept, RNG roll fail, log đã ghi, debuff
 *      đã apply. Caller hiển thị banner penalty.
 */
export const useBreakthroughStore = defineStore('breakthrough', () => {
  const lastOutcome = ref<api.BreakthroughAttemptOutcomeView | null>(null);
  const inFlight = ref(false);
  const lastError = ref<string | null>(null);

  /**
   * History của past attempts. `null` = chưa fetch (initial), `[]` =
   * fetched but empty (chưa attempt lần nào).
   */
  const history = ref<api.BreakthroughAttemptLogView[] | null>(null);
  const historyLoading = ref(false);
  const historyError = ref<string | null>(null);

  /**
   * Current pagination limit (server `?limit=N`). Mirror
   * `BREAKTHROUGH_LOG_DEFAULT_LIMIT` (20) initially. `loadMoreHistory()`
   * tăng dần (+DEFAULT) cho tới khi đạt `BREAKTHROUGH_LOG_MAX_LIMIT` (100).
   * Server responds DESC by `createdAt` → mỗi lần fetch lại với limit lớn
   * hơn sẽ trả về cả rows cũ + thêm rows cũ hơn nữa (replace, không append
   * client-side; cần re-fetch để consistent với server snapshot).
   */
  const historyLimit = ref<number>(api.BREAKTHROUGH_LOG_DEFAULT_LIMIT);

  /**
   * True khi có khả năng còn rows cũ hơn để load thêm. Heuristic: rows hiện
   * tại đã đầy `historyLimit` (server trả đủ) AND `historyLimit` chưa chạm
   * MAX. Nếu rows < limit → server đã trả hết. Nếu limit === MAX → đã đạt
   * giới hạn server cap.
   */
  const historyHasMore = computed<boolean>(() => {
    const rows = history.value;
    if (!rows) return false;
    if (rows.length < historyLimit.value) return false;
    return historyLimit.value < api.BREAKTHROUGH_LOG_MAX_LIMIT;
  });

  /**
   * True khi đã đạt MAX limit và rows lấp đầy — không thể load thêm dù còn
   * rows cũ hơn ở server. UI hiển thị hint "Đã đạt giới hạn 100 lượt"
   * thay vì button.
   */
  const historyMaxReached = computed<boolean>(() => {
    const rows = history.value;
    if (!rows) return false;
    if (historyLimit.value < api.BREAKTHROUGH_LOG_MAX_LIMIT) return false;
    return rows.length >= api.BREAKTHROUGH_LOG_MAX_LIMIT;
  });

  /**
   * Client-side filter. Pure presentation; không đụng API/server query.
   * Default `'all'`. Filter chỉ áp dụng lên rows đã load — load-more logic
   * vẫn tính trên full list. Nếu filter loại hết rows hiển thị, view show
   * "no match" hint riêng.
   */
  const historyFilter = ref<BreakthroughHistoryFilter>('all');

  /**
   * `history` đã filter theo `historyFilter`. `null` = chưa fetch (preserve
   * null); `[]` = đã fetch nhưng filter loại hết. Caller dùng cái này thay
   * cho `history` trong `<v-for>` để render.
   */
  const filteredHistory = computed<api.BreakthroughAttemptLogView[] | null>(
    () => {
      const rows = history.value;
      if (!rows) return null;
      const filter = historyFilter.value;
      if (filter === 'all') return rows;
      if (filter === 'success') return rows.filter((r) => r.success);
      if (filter === 'fail') return rows.filter((r) => !r.success);
      return rows;
    },
  );

  /**
   * Stats summary tính trên FULL history để counts không thay đổi khi user
   * toggle filter UI. `null` history (chưa fetch) → counts = 0.
   */
  const historyTotalCount = computed<number>(
    () => history.value?.length ?? 0,
  );
  const historySuccessCount = computed<number>(
    () => history.value?.filter((r) => r.success).length ?? 0,
  );
  const historyFailCount = computed<number>(
    () => history.value?.filter((r) => !r.success).length ?? 0,
  );

  /** Set filter selection. Validate input để tránh assign giá trị vô nghĩa. */
  function setHistoryFilter(filter: BreakthroughHistoryFilter): void {
    if (filter !== 'all' && filter !== 'success' && filter !== 'fail') {
      return;
    }
    historyFilter.value = filter;
  }

  function clearLastOutcome(): void {
    lastOutcome.value = null;
  }

  /**
   * Server-authoritative attempt. Returns error code (string) on failure,
   * `null` on success (caller phải xem `lastOutcome.success` để biết
   * RNG thành công hay thất bại).
   */
  async function attempt(): Promise<string | null> {
    if (inFlight.value) return 'IN_FLIGHT';
    inFlight.value = true;
    lastError.value = null;
    try {
      const outcome = await api.attemptBreakthrough();
      lastOutcome.value = outcome;
      return null;
    } catch (e) {
      const code =
        (e as { code?: string }).code ??
        (e as { error?: { code?: string } }).error?.code ??
        'UNKNOWN';
      lastError.value = code;
      return code;
    } finally {
      inFlight.value = false;
    }
  }

  /**
   * Fetch history from `GET /character/breakthrough/log`. Idempotent.
   * Race-protected via `historyLoading`. Trả về error code string hoặc
   * `null` thành công.
   *
   * `limit?` arg semantics:
   *   - Provided: clamp về [1, MAX] → store thành `historyLimit` (cho phép
   *     post-attempt refetch dùng cùng size đã expand) → call API với clamp.
   *   - Omitted: dùng `historyLimit.value` hiện tại (preserve user expand).
   */
  async function fetchHistory(limit?: number): Promise<string | null> {
    if (historyLoading.value) return 'IN_FLIGHT';
    historyLoading.value = true;
    historyError.value = null;
    if (limit !== undefined) {
      historyLimit.value = clampLimit(limit);
    }
    try {
      const res = await api.fetchAttemptLog(historyLimit.value);
      history.value = res.rows;
      return null;
    } catch (e) {
      const code =
        (e as { code?: string }).code ??
        (e as { error?: { code?: string } }).error?.code ??
        'UNKNOWN';
      historyError.value = code;
      return code;
    } finally {
      historyLoading.value = false;
    }
  }

  /**
   * Load more history rows bằng cách tăng `historyLimit` thêm
   * `BREAKTHROUGH_LOG_DEFAULT_LIMIT` (20) rồi re-fetch.
   *   - `'IN_FLIGHT'`: đang fetch, caller phải đợi.
   *   - `'MAX_REACHED'`: đã đạt MAX limit.
   *   - `null`: success, `history` đã được replace với rows nhiều hơn.
   *   - `<error_code>`: fetch fail, caller xử lý.
   */
  async function loadMoreHistory(): Promise<string | null> {
    if (historyLoading.value) return 'IN_FLIGHT';
    if (historyLimit.value >= api.BREAKTHROUGH_LOG_MAX_LIMIT) {
      return 'MAX_REACHED';
    }
    const newLimit = clampLimit(
      historyLimit.value + api.BREAKTHROUGH_LOG_DEFAULT_LIMIT,
    );
    return fetchHistory(newLimit);
  }

  function reset(): void {
    lastOutcome.value = null;
    inFlight.value = false;
    lastError.value = null;
    history.value = null;
    historyLoading.value = false;
    historyError.value = null;
    historyLimit.value = api.BREAKTHROUGH_LOG_DEFAULT_LIMIT;
    historyFilter.value = 'all';
  }

  return {
    lastOutcome,
    inFlight,
    lastError,
    history,
    historyLoading,
    historyError,
    historyLimit,
    historyHasMore,
    historyMaxReached,
    historyFilter,
    filteredHistory,
    historyTotalCount,
    historySuccessCount,
    historyFailCount,
    clearLastOutcome,
    attempt,
    fetchHistory,
    loadMoreHistory,
    setHistoryFilter,
    reset,
  };
});

/**
 * Clamp limit về [1, MAX] (mirror server-side clamp). Tránh gửi `?limit=999999`.
 */
function clampLimit(limit: number): number {
  if (!Number.isFinite(limit)) return api.BREAKTHROUGH_LOG_DEFAULT_LIMIT;
  return Math.max(
    1,
    Math.min(api.BREAKTHROUGH_LOG_MAX_LIMIT, Math.floor(limit)),
  );
}
