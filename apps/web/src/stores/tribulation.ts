import { computed, ref } from 'vue';
import { defineStore } from 'pinia';
import * as api from '@/api/tribulation';

/**
 * Phase 11.6.J — client-side filter selection cho history view.
 *   - `'all'`: không filter (default).
 *   - `'success'`: chỉ rows `success === true`.
 *   - `'fail'`: chỉ rows `success === false`.
 */
export type HistoryFilter = 'all' | 'success' | 'fail';

/**
 * Phase 11.6.D — server-authoritative Tribulation (Thiên Kiếp) store.
 *
 * State:
 *   - `lastOutcome`: outcome của lần attempt gần nhất (success/fail) hoặc
 *     `null` nếu chưa attempt phiên này. Dùng cho UI hiển thị banner
 *     "Vượt kiếp thành công" / "Thất bại — mất X EXP, cooldown đến Y" sau
 *     khi attempt.
 *   - `inFlight`: boolean — `true` khi đang chờ server respond. Disable
 *     button + chống double-click.
 *   - `lastError`: error code string (nếu attempt fail vì server reject —
 *     khác với fail vượt kiếp simulation). Caller dùng key i18n
 *     `tribulation.errors.{code}`.
 *
 * Action `attempt()`:
 *   - Server-authoritative — không optimistic. Trả về `null` (success
 *     attempt — caller xem `lastOutcome.success` để biết kiếp thành công
 *     hay thất bại) hoặc error code (string) nếu server từ chối attempt
 *     (NOT_AT_PEAK / COOLDOWN_ACTIVE / etc.).
 *   - `inFlight` set/clear quanh request để UI disable button.
 *
 * Note: Hai khái niệm fail khác nhau:
 *   1. `s.attempt()` return `'COOLDOWN_ACTIVE'`: server reject attempt, không
 *      ghi log, `lastOutcome` không đổi. Caller hiển thị toast lỗi.
 *   2. `s.attempt()` return `null` + `lastOutcome.success === false`:
 *      attempt được server accept, simulate ra fail, log đã ghi, EXP đã trừ,
 *      cooldown active. Caller hiển thị banner penalty.
 */
export const useTribulationStore = defineStore('tribulation', () => {
  const lastOutcome = ref<api.TribulationOutcomeView | null>(null);
  const inFlight = ref(false);
  const lastError = ref<string | null>(null);

  /**
   * Phase 14.3.A — preview state cho upcoming kiếp.
   *   - `preview === undefined`: chưa fetch (initial).
   *   - `preview === null`: server trả null (transition KHÔNG cần kiếp —
   *     low-tier hoặc realm cuối).
   *   - `preview === TribulationPreviewView`: snapshot deterministic,
   *     không trigger RNG/log. Caller dùng `successChance.final` cho UI %
   *     hint, `supports[]` cho tooltip nguồn bonus, v.v.
   */
  const preview = ref<api.TribulationPreviewView | null | undefined>(undefined);
  const previewLoading = ref(false);
  const previewError = ref<string | null>(null);

  /**
   * Phase 11.6.G — history of past attempts. `null` = chưa fetch (initial),
   * `[]` = fetched but empty (chưa attempt lần nào). `historyLoading`/
   * `historyError` cho UI loading + retry banner.
   */
  const history = ref<api.TribulationAttemptLogView[] | null>(null);
  const historyLoading = ref(false);
  const historyError = ref<string | null>(null);

  /**
   * Phase 11.6.H — current pagination limit (server `?limit=N`). Mirror
   * `TRIBULATION_LOG_DEFAULT_LIMIT` (20) initially. `loadMoreHistory()`
   * tăng dần (+DEFAULT) cho tới khi đạt `TRIBULATION_LOG_MAX_LIMIT` (100).
   * Server responds DESC by `createdAt` → mỗi lần fetch lại với limit lớn
   * hơn sẽ trả về cả rows cũ + thêm rows cũ hơn nữa (replace, không append
   * client-side; cần re-fetch để consistent với server snapshot).
   */
  const historyLimit = ref<number>(api.TRIBULATION_LOG_DEFAULT_LIMIT);

  /**
   * Phase 11.6.H — true khi có khả năng còn rows cũ hơn để load thêm.
   * Heuristic: rows hiện tại đã đầy `historyLimit` (server trả đủ) AND
   * `historyLimit` chưa chạm MAX. Nếu rows < limit → server đã trả hết
   * (no more rows). Nếu limit === MAX → đã đạt giới hạn server cap.
   */
  const historyHasMore = computed<boolean>(() => {
    const rows = history.value;
    if (!rows) return false;
    if (rows.length < historyLimit.value) return false;
    return historyLimit.value < api.TRIBULATION_LOG_MAX_LIMIT;
  });

  /**
   * Phase 11.6.H — true khi đã đạt MAX limit và rows lấp đầy — không thể
   * load thêm dù còn rows cũ hơn ở server. UI hiển thị hint "Đã đạt giới
   * hạn 100 lượt" thay vì button.
   */
  const historyMaxReached = computed<boolean>(() => {
    const rows = history.value;
    if (!rows) return false;
    if (historyLimit.value < api.TRIBULATION_LOG_MAX_LIMIT) return false;
    return rows.length >= api.TRIBULATION_LOG_MAX_LIMIT;
  });

  /**
   * Phase 11.6.J — client-side filter cho history list. Pure presentation
   * filter; không đụng API/server query. Default `'all'` = không filter.
   * Filter chỉ áp dụng lên rows đã load — load-more logic (`historyHasMore`)
   * vẫn tính trên full list (server-side). Nếu filter loại hết rows hiển
   * thị, view show "no match" hint riêng.
   */
  const historyFilter = ref<HistoryFilter>('all');

  /**
   * Phase 11.6.J — `history` đã filter theo `historyFilter`. `null` =
   * chưa fetch (preserve null); `[]` = đã fetch nhưng filter loại hết.
   * Caller dùng cái này thay cho `history` trong `<v-for>` để render.
   */
  const filteredHistory = computed<api.TribulationAttemptLogView[] | null>(
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
   * Phase 11.6.K — stats summary tính trên FULL history (không phải
   * filteredHistory) để counts không thay đổi khi user toggle filter UI.
   * `null` history (chưa fetch) → counts = 0. Empty array → counts = 0.
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

  /**
   * Phase 11.6.J — set filter selection. Validate input để tránh assign
   * giá trị vô nghĩa. Không trigger API — pure local UI state.
   */
  function setHistoryFilter(filter: HistoryFilter): void {
    if (filter !== 'all' && filter !== 'success' && filter !== 'fail') {
      return;
    }
    historyFilter.value = filter;
  }

  function clearLastOutcome(): void {
    lastOutcome.value = null;
  }

  /**
   * Phase 14.3.A — fetch preview snapshot từ
   * `GET /character/tribulation/preview`. Idempotent. Race-protected via
   * `previewLoading`. `null` = transition không cần kiếp; non-null =
   * deterministic estimate (server không roll RNG, không ghi log).
   *
   * Trả về error code (string) hoặc `null` thành công.
   */
  async function fetchPreview(): Promise<string | null> {
    if (previewLoading.value) return 'IN_FLIGHT';
    previewLoading.value = true;
    previewError.value = null;
    try {
      const res = await api.fetchTribulationPreview();
      preview.value = res;
      return null;
    } catch (e) {
      const code =
        (e as { code?: string }).code ??
        (e as { error?: { code?: string } }).error?.code ??
        'UNKNOWN';
      previewError.value = code;
      return code;
    } finally {
      previewLoading.value = false;
    }
  }

  /**
   * Server-authoritative attempt. Returns error code (string) on failure,
   * `null` on success (caller phải xem `lastOutcome.success` để biết kiếp
   * thành công hay thất bại).
   *
   * Phase 14.3.C — `selectedSupportItemKeys?` (≤ 3 keys, thuộc shared
   * `listTribulationSupportConsumables()`). Server verify ownership in tx +
   * consume in tx. FE chỉ gửi keys; server resolve label + recalc bonus.
   */
  async function attempt(
    selectedSupportItemKeys?: readonly string[],
  ): Promise<string | null> {
    if (inFlight.value) return 'IN_FLIGHT';
    inFlight.value = true;
    lastError.value = null;
    try {
      const outcome = await api.attemptTribulation(selectedSupportItemKeys);
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
   * Phase 11.6.G — fetch history from `GET /character/tribulation/log`.
   * Idempotent. Race-protected via `historyLoading` (chống double-fetch khi
   * mount nhanh nhiều lần). Trả về error code string hoặc `null` thành công.
   *
   * Phase 11.6.H — `limit?` arg semantics:
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
   * Phase 11.6.H — load more history rows bằng cách tăng `historyLimit`
   * thêm `TRIBULATION_LOG_DEFAULT_LIMIT` (20) rồi re-fetch. Trả về:
   *   - `'IN_FLIGHT'`: đang fetch, caller phải đợi.
   *   - `'MAX_REACHED'`: đã đạt MAX limit, không thể load thêm.
   *   - `null`: success, `history` đã được replace với rows mới (nhiều hơn).
   *   - `<error_code>`: fetch fail, caller xử lý (e.g. show toast).
   *
   * Race-safe — gọi nhiều lần liên tiếp vẫn chỉ 1 fetch chạy nhờ
   * `historyLoading` guard.
   */
  async function loadMoreHistory(): Promise<string | null> {
    if (historyLoading.value) return 'IN_FLIGHT';
    if (historyLimit.value >= api.TRIBULATION_LOG_MAX_LIMIT) {
      return 'MAX_REACHED';
    }
    const newLimit = clampLimit(
      historyLimit.value + api.TRIBULATION_LOG_DEFAULT_LIMIT,
    );
    return fetchHistory(newLimit);
  }

  // ── Phase 14.3.D — Encounter system state ─────────────────────────────

  /**
   * Phase 14.3.D — encounter snapshot từ
   * `GET /character/tribulation/encounter/current`.
   *   - `undefined`: chưa fetch.
   *   - `null`: server trả null (transition không có catalog).
   *   - `EncounterCurrentView`: snapshot, includes `pending` row nếu user
   *     đã start nhưng chưa resolve.
   */
  const encounter = ref<api.TribulationEncounterCurrentView | null | undefined>(
    undefined,
  );
  const encounterLoading = ref(false);
  const encounterError = ref<string | null>(null);
  const encounterStarting = ref(false);
  const encounterResolving = ref(false);

  /**
   * Phase 14.3.D — true khi đã có pending encounter row (user đã startEncounter
   * nhưng chưa resolveEncounter). UI dùng để toggle giữa "Bắt đầu" và
   * "Vượt kiếp" button.
   */
  const encounterPending = computed<boolean>(() => {
    const row = encounter.value?.pending;
    return !!row && row.state === 'pending';
  });

  /**
   * Phase 14.3.D — fetch current encounter snapshot. Idempotent. Race-safe.
   */
  async function fetchEncounter(): Promise<string | null> {
    if (encounterLoading.value) return 'IN_FLIGHT';
    encounterLoading.value = true;
    encounterError.value = null;
    try {
      const res = await api.fetchTribulationEncounterCurrent();
      encounter.value = res;
      return null;
    } catch (e) {
      const code =
        (e as { code?: string }).code ??
        (e as { error?: { code?: string } }).error?.code ??
        'UNKNOWN';
      encounterError.value = code;
      return code;
    } finally {
      encounterLoading.value = false;
    }
  }

  /**
   * Phase 14.3.D — start encounter (snapshot selected items).
   * Idempotent server-side. Refetch encounter sau khi start để FE thấy
   * pending row.
   */
  async function startEncounter(
    selectedSupportItemKeys?: readonly string[],
  ): Promise<string | null> {
    if (encounterStarting.value) return 'IN_FLIGHT';
    encounterStarting.value = true;
    encounterError.value = null;
    try {
      await api.startTribulationEncounter(selectedSupportItemKeys);
      // Refetch để pull pending row + cooldown/successChance fresh.
      await api.fetchTribulationEncounterCurrent().then((res) => {
        encounter.value = res;
      });
      return null;
    } catch (e) {
      const code =
        (e as { code?: string }).code ??
        (e as { error?: { code?: string } }).error?.code ??
        'UNKNOWN';
      encounterError.value = code;
      return code;
    } finally {
      encounterStarting.value = false;
    }
  }

  /**
   * Phase 14.3.D — resolve current pending encounter. Server simulate +
   * consume + atomic update. Outcome lưu vào `lastOutcome` (mirror
   * `attempt()`). Idempotent server-side: re-call sau resolved trả cached
   * outcome (no double breakthrough/consume/reward).
   */
  async function resolveEncounter(): Promise<string | null> {
    if (encounterResolving.value) return 'IN_FLIGHT';
    encounterResolving.value = true;
    encounterError.value = null;
    try {
      const outcome = await api.resolveTribulationEncounter();
      lastOutcome.value = outcome;
      // Refetch encounter (state → resolved) + invalidate preview để FE thấy
      // realm mới.
      await api.fetchTribulationEncounterCurrent().then((res) => {
        encounter.value = res;
      });
      return null;
    } catch (e) {
      const code =
        (e as { code?: string }).code ??
        (e as { error?: { code?: string } }).error?.code ??
        'UNKNOWN';
      encounterError.value = code;
      return code;
    } finally {
      encounterResolving.value = false;
    }
  }

  function reset(): void {
    lastOutcome.value = null;
    inFlight.value = false;
    lastError.value = null;
    history.value = null;
    historyLoading.value = false;
    historyError.value = null;
    historyLimit.value = api.TRIBULATION_LOG_DEFAULT_LIMIT;
    historyFilter.value = 'all';
    preview.value = undefined;
    previewLoading.value = false;
    previewError.value = null;
    encounter.value = undefined;
    encounterLoading.value = false;
    encounterError.value = null;
    encounterStarting.value = false;
    encounterResolving.value = false;
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
    preview,
    previewLoading,
    previewError,
    encounter,
    encounterLoading,
    encounterError,
    encounterStarting,
    encounterResolving,
    encounterPending,
    clearLastOutcome,
    fetchPreview,
    attempt,
    fetchHistory,
    loadMoreHistory,
    setHistoryFilter,
    fetchEncounter,
    startEncounter,
    resolveEncounter,
    reset,
  };
});

/**
 * Phase 11.6.H — clamp limit về [1, MAX] (mirror server-side clamp trong
 * `TribulationService.listAttemptLogs`). Tránh gửi `?limit=999999` qua API.
 */
function clampLimit(limit: number): number {
  if (!Number.isFinite(limit)) return api.TRIBULATION_LOG_DEFAULT_LIMIT;
  return Math.max(
    1,
    Math.min(api.TRIBULATION_LOG_MAX_LIMIT, Math.floor(limit)),
  );
}
