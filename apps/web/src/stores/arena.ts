/**
 * Phase 14.1.B — Async Arena Foundation Pinia store.
 *
 * State machine:
 *   - `profile`: ArenaProfileSummary | null (lazy-loaded).
 *   - `opponents`: list opponents (refresh khi click "Refresh" hoặc challenge xong).
 *   - `lastResult`: ArenaMatchResult | null — match vừa đánh, dùng cho banner.
 *   - `history`: list matches (DESC by createdAt).
 *
 * UI dùng `loading` flags + `error` codes để hiển thị loading / empty / error
 * states.
 */
import { computed, ref } from 'vue';
import { defineStore } from 'pinia';
import * as api from '@/api/arena';

export const useArenaStore = defineStore('arena', () => {
  const profile = ref<api.ArenaProfileSummary | null>(null);
  const profileLoading = ref(false);
  const profileError = ref<string | null>(null);

  const opponents = ref<api.ArenaOpponentSummary[] | null>(null);
  const opponentsLoading = ref(false);
  const opponentsError = ref<string | null>(null);

  const lastResult = ref<api.ArenaMatchResult | null>(null);
  const challengeInFlight = ref(false);
  const challengeError = ref<string | null>(null);

  const history = ref<api.ArenaMatchResult[] | null>(null);
  const historyLoading = ref(false);
  const historyError = ref<string | null>(null);

  const totalAttacks = computed<number>(() => {
    const p = profile.value;
    if (!p) return 0;
    return p.wins + p.losses + p.draws;
  });

  function extractCode(e: unknown, fallback = 'UNKNOWN'): string {
    if (!e || typeof e !== 'object') return fallback;
    const rec = e as { code?: unknown };
    if (typeof rec.code === 'string') return rec.code;
    return fallback;
  }

  async function fetchProfile(): Promise<void> {
    profileLoading.value = true;
    profileError.value = null;
    try {
      profile.value = await api.fetchArenaProfile();
    } catch (e) {
      profileError.value = extractCode(e, 'PROFILE_FETCH_FAILED');
    } finally {
      profileLoading.value = false;
    }
  }

  async function fetchOpponents(limit?: number): Promise<void> {
    opponentsLoading.value = true;
    opponentsError.value = null;
    try {
      opponents.value = await api.fetchArenaOpponents(limit);
    } catch (e) {
      opponentsError.value = extractCode(e, 'OPPONENTS_FETCH_FAILED');
    } finally {
      opponentsLoading.value = false;
    }
  }

  /**
   * POST challenge. Trả về error code (string) khi fail, null khi success.
   * Caller hiển thị toast theo code.
   */
  async function challenge(defenderCharacterId: string): Promise<string | null> {
    if (challengeInFlight.value) return 'IN_FLIGHT';
    challengeInFlight.value = true;
    challengeError.value = null;
    try {
      const result = await api.challengeArenaOpponent(defenderCharacterId);
      lastResult.value = result;
      // Refresh profile + history sau challenge.
      await Promise.all([fetchProfile(), fetchHistory()]);
      return null;
    } catch (e) {
      const code = extractCode(e, 'CHALLENGE_FAILED');
      challengeError.value = code;
      return code;
    } finally {
      challengeInFlight.value = false;
    }
  }

  async function fetchHistory(limit?: number): Promise<void> {
    historyLoading.value = true;
    historyError.value = null;
    try {
      history.value = await api.fetchArenaHistory(limit, 'all');
    } catch (e) {
      historyError.value = extractCode(e, 'HISTORY_FETCH_FAILED');
    } finally {
      historyLoading.value = false;
    }
  }

  function clearLastResult(): void {
    lastResult.value = null;
  }

  return {
    profile,
    profileLoading,
    profileError,
    opponents,
    opponentsLoading,
    opponentsError,
    lastResult,
    challengeInFlight,
    challengeError,
    history,
    historyLoading,
    historyError,
    totalAttacks,
    fetchProfile,
    fetchOpponents,
    challenge,
    fetchHistory,
    clearLastResult,
  };
});
