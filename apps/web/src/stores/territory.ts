/**
 * Phase 14.0.A + 14.0.B — Sect Territory Pinia store.
 *
 * Read-only fetcher cho regions / leaderboard / me / history. Phase 14.0.B
 * thêm history cache theo regionKey + admin settlement triggers.
 *
 * Server-authoritative; FE KHÔNG mutate điểm. Race-protected: mỗi fetcher
 * có flag `loading` riêng để fetch song song không đè trạng thái lẫn nhau.
 * Leaderboard / history cache theo `regionKey` để chuyển tab giữa các
 * region không fetch lại không cần thiết.
 */
import { ref } from 'vue';
import { defineStore } from 'pinia';
import * as api from '@/api/territory';

export const useTerritoryStore = defineStore('territory', () => {
  const regions = ref<api.TerritoryRegionsView | null>(null);
  const regionsLoading = ref(false);
  const regionsError = ref<string | null>(null);

  const me = ref<api.TerritoryMyView | null>(null);
  const meLoading = ref(false);
  const meError = ref<string | null>(null);

  /**
   * Cache leaderboard per region. Key: regionKey, Value: leaderboard view.
   * Chuyển tab giữa region trong cùng phiên không cần re-fetch.
   */
  const leaderboards = ref<Record<string, api.TerritoryLeaderboardView>>({});
  const leaderboardLoading = ref<Record<string, boolean>>({});
  const leaderboardError = ref<Record<string, string | null>>({});

  /**
   * Phase 14.0.B — settlement history cache per region. Tương tự
   * leaderboard cache. Sau settlement trigger, store gọi
   * `invalidateRegion(regionKey)` để force refresh.
   */
  const histories = ref<Record<string, api.TerritoryRegionHistoryView>>({});
  const historyLoading = ref<Record<string, boolean>>({});
  const historyError = ref<Record<string, string | null>>({});

  const settleLoading = ref(false);
  const settleError = ref<string | null>(null);
  const lastSettleResult = ref<api.TerritorySettlementRunResult | null>(null);

  /**
   * Phase 14.0.C — admin decay state. Tách khỏi settle để 2 admin action
   * không đè nhau khi chạy song song (UI hiển thị spinner riêng).
   */
  const decayLoading = ref(false);
  const decayError = ref<string | null>(null);
  const lastDecayResult = ref<api.TerritoryDecayResult | null>(null);

  function extractCode(e: unknown): string {
    return (
      (e as { code?: string }).code ??
      (e as { error?: { code?: string } }).error?.code ??
      'UNKNOWN'
    );
  }

  async function fetchRegions(): Promise<string | null> {
    if (regionsLoading.value) return 'IN_FLIGHT';
    regionsLoading.value = true;
    regionsError.value = null;
    try {
      regions.value = await api.getTerritoryRegions();
      return null;
    } catch (e) {
      const code = extractCode(e);
      regionsError.value = code;
      return code;
    } finally {
      regionsLoading.value = false;
    }
  }

  async function fetchMe(): Promise<string | null> {
    if (meLoading.value) return 'IN_FLIGHT';
    meLoading.value = true;
    meError.value = null;
    try {
      me.value = await api.getTerritoryMe();
      return null;
    } catch (e) {
      const code = extractCode(e);
      meError.value = code;
      return code;
    } finally {
      meLoading.value = false;
    }
  }

  async function fetchLeaderboard(regionKey: string): Promise<string | null> {
    if (leaderboardLoading.value[regionKey]) return 'IN_FLIGHT';
    leaderboardLoading.value = {
      ...leaderboardLoading.value,
      [regionKey]: true,
    };
    leaderboardError.value = {
      ...leaderboardError.value,
      [regionKey]: null,
    };
    try {
      const data = await api.getTerritoryRegionLeaderboard(regionKey);
      leaderboards.value = { ...leaderboards.value, [regionKey]: data };
      return null;
    } catch (e) {
      const code = extractCode(e);
      leaderboardError.value = {
        ...leaderboardError.value,
        [regionKey]: code,
      };
      return code;
    } finally {
      leaderboardLoading.value = {
        ...leaderboardLoading.value,
        [regionKey]: false,
      };
    }
  }

  async function fetchHistory(
    regionKey: string,
    opts: { force?: boolean } = {},
  ): Promise<string | null> {
    if (historyLoading.value[regionKey]) return 'IN_FLIGHT';
    if (!opts.force && histories.value[regionKey]) return null;
    historyLoading.value = {
      ...historyLoading.value,
      [regionKey]: true,
    };
    historyError.value = {
      ...historyError.value,
      [regionKey]: null,
    };
    try {
      const data = await api.getTerritoryRegionHistory(regionKey);
      histories.value = { ...histories.value, [regionKey]: data };
      return null;
    } catch (e) {
      const code = extractCode(e);
      historyError.value = {
        ...historyError.value,
        [regionKey]: code,
      };
      return code;
    } finally {
      historyLoading.value = {
        ...historyLoading.value,
        [regionKey]: false,
      };
    }
  }

  /**
   * Phase 14.0.B — admin trigger settlement (toàn bộ region) với
   * `periodKey` optional (server fallback `previousTerritoryPeriodKey()`).
   * Sau khi thành công, store invalidate cache regions/leaderboard/history
   * và refetch regions để FE thấy owner mới ngay.
   */
  async function adminSettleAll(periodKey?: string): Promise<string | null> {
    if (settleLoading.value) return 'IN_FLIGHT';
    settleLoading.value = true;
    settleError.value = null;
    try {
      const res = await api.adminTerritorySettleAll(periodKey);
      lastSettleResult.value = res;
      // Invalidate caches → refetch regions (owner đổi).
      histories.value = {};
      leaderboards.value = {};
      await fetchRegions();
      return null;
    } catch (e) {
      const code = extractCode(e);
      settleError.value = code;
      return code;
    } finally {
      settleLoading.value = false;
    }
  }

  async function adminSettleRegion(
    regionKey: string,
    periodKey?: string,
  ): Promise<string | null> {
    if (settleLoading.value) return 'IN_FLIGHT';
    settleLoading.value = true;
    settleError.value = null;
    try {
      await api.adminTerritorySettleRegion(regionKey, periodKey);
      // Invalidate region caches → refetch regions + history mới.
      const newHist = { ...histories.value };
      delete newHist[regionKey];
      histories.value = newHist;
      const newLb = { ...leaderboards.value };
      delete newLb[regionKey];
      leaderboards.value = newLb;
      await fetchRegions();
      return null;
    } catch (e) {
      const code = extractCode(e);
      settleError.value = code;
      return code;
    } finally {
      settleLoading.value = false;
    }
  }

  /**
   * Phase 14.0.C — admin trigger influence decay. Khác settlement ở chỗ
   * decay không đổi owner, chỉ giảm điểm. Sau khi thành công ta refetch
   * regions + me (sect rank/points có thể đổi sau decay) + invalidate
   * leaderboard cache. History KHÔNG cần invalidate (settlement snapshot
   * không bị decay sửa).
   */
  async function adminDecay(opts: {
    periodKey?: string;
    decayBps?: number;
  }): Promise<string | null> {
    if (decayLoading.value) return 'IN_FLIGHT';
    decayLoading.value = true;
    decayError.value = null;
    try {
      const res = await api.adminTerritoryDecay(opts);
      lastDecayResult.value = res;
      // Decay đổi điểm → invalidate aggregates.
      leaderboards.value = {};
      await Promise.all([fetchRegions(), me.value ? fetchMe() : Promise.resolve(null)]);
      return null;
    } catch (e) {
      const code = extractCode(e);
      decayError.value = code;
      return code;
    } finally {
      decayLoading.value = false;
    }
  }

  // ────────────────────────────────────────────────────────────────────
  // Phase 14.0.D — Weekly War Loop state
  // ────────────────────────────────────────────────────────────────────

  const warState = ref<api.TerritoryWarStateView | null>(null);
  const warStateLoading = ref(false);
  const warStateError = ref<string | null>(null);

  const warHistory = ref<api.TerritoryWarHistoryView | null>(null);
  const warHistoryLoading = ref(false);
  const warHistoryError = ref<string | null>(null);

  const warSettleLoading = ref(false);
  const warSettleError = ref<string | null>(null);
  // Phase 14.0.E — admin grant weekly territory owner reward state.
  const rewardGrantLoading = ref(false);
  const rewardGrantError = ref<string | null>(null);
  const lastRewardGrantResult =
    ref<api.TerritoryRewardGrantSummary | null>(null);
  const lastWarSettleResult =
    ref<api.TerritoryWarSettleCurrentResult | null>(null);

  async function fetchWarCurrent(): Promise<string | null> {
    if (warStateLoading.value) return 'IN_FLIGHT';
    warStateLoading.value = true;
    warStateError.value = null;
    try {
      warState.value = await api.getTerritoryWarCurrent();
      return null;
    } catch (e) {
      const code = extractCode(e);
      warStateError.value = code;
      return code;
    } finally {
      warStateLoading.value = false;
    }
  }

  async function fetchWarHistory(limit?: number): Promise<string | null> {
    if (warHistoryLoading.value) return 'IN_FLIGHT';
    warHistoryLoading.value = true;
    warHistoryError.value = null;
    try {
      warHistory.value = await api.getTerritoryWarHistory(limit);
      return null;
    } catch (e) {
      const code = extractCode(e);
      warHistoryError.value = code;
      return code;
    } finally {
      warHistoryLoading.value = false;
    }
  }

  /**
   * Phase 14.0.D — admin settle period HIỆN TẠI (idempotent qua UNIQUE
   * `(regionKey, periodKey)`). Sau khi xong, invalidate war state +
   * regions cache (owner đổi) + history cache.
   */
  async function adminSettleCurrentWar(): Promise<string | null> {
    if (warSettleLoading.value) return 'IN_FLIGHT';
    warSettleLoading.value = true;
    warSettleError.value = null;
    try {
      const res = await api.adminTerritoryWarSettleCurrent();
      lastWarSettleResult.value = res;
      // Owner đổi → invalidate caches phụ thuộc.
      histories.value = {};
      leaderboards.value = {};
      warHistory.value = null;
      await Promise.all([fetchRegions(), fetchWarCurrent()]);
      return null;
    } catch (e) {
      const code = extractCode(e);
      warSettleError.value = code;
      return code;
    } finally {
      warSettleLoading.value = false;
    }
  }

  /**
   * Phase 14.0.E — admin trigger grant weekly territory owner reward
   * mail. Idempotent server-side qua UNIQUE `(periodKey, regionKey,
   * characterId)`. Default `dryRun=false` (mutate state).
   */
  async function adminGrantWeeklyTerritoryReward(
    opts: { periodKey?: string; dryRun?: boolean } = {},
  ): Promise<string | null> {
    if (rewardGrantLoading.value) return 'IN_FLIGHT';
    rewardGrantLoading.value = true;
    rewardGrantError.value = null;
    try {
      const res = await api.adminTerritoryGrantWeeklyRewards(opts);
      lastRewardGrantResult.value = res;
      return null;
    } catch (e) {
      const code = extractCode(e);
      rewardGrantError.value = code;
      return code;
    } finally {
      rewardGrantLoading.value = false;
    }
  }

  function reset(): void {
    regions.value = null;
    regionsLoading.value = false;
    regionsError.value = null;
    me.value = null;
    meLoading.value = false;
    meError.value = null;
    leaderboards.value = {};
    leaderboardLoading.value = {};
    leaderboardError.value = {};
    histories.value = {};
    historyLoading.value = {};
    historyError.value = {};
    settleLoading.value = false;
    settleError.value = null;
    lastSettleResult.value = null;
    decayLoading.value = false;
    decayError.value = null;
    lastDecayResult.value = null;
    warState.value = null;
    warStateLoading.value = false;
    warStateError.value = null;
    warHistory.value = null;
    warHistoryLoading.value = false;
    warHistoryError.value = null;
    warSettleLoading.value = false;
    warSettleError.value = null;
    lastWarSettleResult.value = null;
    rewardGrantLoading.value = false;
    rewardGrantError.value = null;
    lastRewardGrantResult.value = null;
  }

  return {
    regions,
    regionsLoading,
    regionsError,
    me,
    meLoading,
    meError,
    leaderboards,
    leaderboardLoading,
    leaderboardError,
    histories,
    historyLoading,
    historyError,
    settleLoading,
    settleError,
    lastSettleResult,
    decayLoading,
    decayError,
    lastDecayResult,
    warState,
    warStateLoading,
    warStateError,
    warHistory,
    warHistoryLoading,
    warHistoryError,
    warSettleLoading,
    warSettleError,
    lastWarSettleResult,
    rewardGrantLoading,
    rewardGrantError,
    lastRewardGrantResult,
    fetchRegions,
    fetchMe,
    fetchLeaderboard,
    fetchHistory,
    adminSettleAll,
    adminSettleRegion,
    adminDecay,
    fetchWarCurrent,
    fetchWarHistory,
    adminSettleCurrentWar,
    adminGrantWeeklyTerritoryReward,
    reset,
  };
});
