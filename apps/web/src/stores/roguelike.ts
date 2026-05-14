import { computed, ref } from 'vue';
import { defineStore } from 'pinia';
import * as api from '@/api/roguelike';

const SUBMIT_CHOICE = 'choice';
const SUBMIT_CLAIM = 'claim';
const SUBMIT_ABANDON = 'abandon';

function extractErrorCode(e: unknown): string {
  return (
    (e as { code?: string }).code ??
    (e as { error?: { code?: string } }).error?.code ??
    'UNKNOWN_ERROR'
  );
}

export const useRoguelikeStore = defineStore('roguelike', () => {
  const realms = ref<api.RoguelikeRealmView[]>([]);
  const activeRun = ref<api.RoguelikeRunView | null>(null);
  const leaderboard = ref<api.RoguelikeLeaderboardEntry[]>([]);
  const loaded = ref(false);
  const leaderboardLoaded = ref(false);
  const loading = ref(false);
  const leaderboardLoading = ref(false);
  const lastError = ref<string | null>(null);
  const submittingKey = ref<string | null>(null);
  const submittingError = ref<string | null>(null);
  const lastClaimResult = ref<api.RoguelikeClaimResult | null>(null);

  const totalCount = computed(() => realms.value.length);
  const unlockedCount = computed(() => realms.value.filter((r) => r.unlocked).length);
  const hasActiveRun = computed(() => activeRun.value?.status === 'ACTIVE');
  const isRunEnded = computed(
    () =>
      activeRun.value?.status === 'COMPLETED' ||
      activeRun.value?.status === 'FAILED' ||
      activeRun.value?.status === 'ABANDONED',
  );
  const isRunClaimable = computed(
    () => activeRun.value?.status === 'COMPLETED' && !activeRun.value.claimedAt,
  );

  async function load(): Promise<void> {
    loading.value = true;
    lastError.value = null;
    try {
      const view = await api.fetchRoguelikeList();
      realms.value = view.realms;
      activeRun.value = view.activeRun;
      loaded.value = true;
    } catch (e) {
      lastError.value = extractErrorCode(e);
    } finally {
      loading.value = false;
    }
  }

  async function loadLeaderboard(): Promise<void> {
    leaderboardLoading.value = true;
    try {
      leaderboard.value = await api.fetchRoguelikeLeaderboard();
      leaderboardLoaded.value = true;
    } finally {
      leaderboardLoading.value = false;
    }
  }

  async function start(realmKey: string): Promise<void> {
    submittingKey.value = realmKey;
    submittingError.value = null;
    try {
      activeRun.value = await api.startRoguelikeRun(realmKey);
      await load();
    } catch (e) {
      submittingError.value = extractErrorCode(e);
      throw e;
    } finally {
      submittingKey.value = null;
    }
  }

  async function choose(choiceKey: string): Promise<api.RoguelikeRunView> {
    const run = activeRun.value;
    if (!run) {
      const err = new Error('NO_ACTIVE_RUN');
      (err as Error & { code: string }).code = 'NO_ACTIVE_RUN';
      throw err;
    }
    submittingKey.value = `${SUBMIT_CHOICE}:${choiceKey}`;
    submittingError.value = null;
    try {
      const next = await api.chooseRoguelikeFloor(run.id, choiceKey);
      activeRun.value = next;
      await loadLeaderboard();
      return next;
    } catch (e) {
      submittingError.value = extractErrorCode(e);
      throw e;
    } finally {
      submittingKey.value = null;
    }
  }

  async function abandon(): Promise<api.RoguelikeRunView> {
    const run = activeRun.value;
    if (!run) {
      const err = new Error('NO_ACTIVE_RUN');
      (err as Error & { code: string }).code = 'NO_ACTIVE_RUN';
      throw err;
    }
    submittingKey.value = SUBMIT_ABANDON;
    submittingError.value = null;
    try {
      const next = await api.abandonRoguelikeRun(run.id);
      activeRun.value = next;
      return next;
    } catch (e) {
      submittingError.value = extractErrorCode(e);
      throw e;
    } finally {
      submittingKey.value = null;
    }
  }

  async function claim(): Promise<api.RoguelikeClaimResult> {
    const run = activeRun.value;
    if (!run) {
      const err = new Error('NO_ACTIVE_RUN');
      (err as Error & { code: string }).code = 'NO_ACTIVE_RUN';
      throw err;
    }
    submittingKey.value = SUBMIT_CLAIM;
    submittingError.value = null;
    try {
      const result = await api.claimRoguelikeRun(run.id);
      lastClaimResult.value = result;
      activeRun.value = result.run;
      await Promise.all([load(), loadLeaderboard()]);
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
    realms.value = [];
    activeRun.value = null;
    leaderboard.value = [];
    loaded.value = false;
    leaderboardLoaded.value = false;
    loading.value = false;
    leaderboardLoading.value = false;
    lastError.value = null;
    submittingKey.value = null;
    submittingError.value = null;
    lastClaimResult.value = null;
  }

  return {
    realms,
    activeRun,
    leaderboard,
    loaded,
    leaderboardLoaded,
    loading,
    leaderboardLoading,
    lastError,
    submittingKey,
    submittingError,
    lastClaimResult,
    totalCount,
    unlockedCount,
    hasActiveRun,
    isRunEnded,
    isRunClaimable,
    load,
    loadLeaderboard,
    start,
    choose,
    abandon,
    claim,
    clearLastClaimResult,
    reset,
  };
});
