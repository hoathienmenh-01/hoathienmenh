import { computed, ref } from 'vue';
import { defineStore } from 'pinia';
import * as api from '@/api/dailyEncounter';

/**
 * Phase 34.1 — Daily Random Encounter / Kỳ Ngộ store.
 *
 * Mirror server state — không optimistic update.
 */
function extractErrorCode(e: unknown): string {
  return (
    (e as { code?: string }).code ??
    (e as { error?: { code?: string } }).error?.code ??
    'UNKNOWN_ERROR'
  );
}

export const useDailyEncounterStore = defineStore('dailyEncounter', () => {
  const today = ref<api.DailyEncounterView | null>(null);
  const history = ref<api.DailyEncounterView[]>([]);
  const loaded = ref(false);
  const loading = ref(false);
  const submitting = ref<string | null>(null);
  const lastError = ref<string | null>(null);
  const lastClaim = ref<api.DailyEncounterClaimResult | null>(null);

  const status = computed(() => today.value?.status ?? null);
  const canAccept = computed(() => status.value === 'AVAILABLE');
  const canComplete = computed(() => status.value === 'ACCEPTED');
  const canClaim = computed(() => status.value === 'COMPLETED');

  async function loadToday(): Promise<void> {
    loading.value = true;
    lastError.value = null;
    try {
      today.value = await api.fetchTodayEncounter();
      loaded.value = true;
    } catch (e) {
      lastError.value = extractErrorCode(e);
    } finally {
      loading.value = false;
    }
  }

  async function loadHistory(limit = 30): Promise<void> {
    try {
      history.value = await api.fetchEncounterHistory(limit);
    } catch (e) {
      lastError.value = extractErrorCode(e);
    }
  }

  async function accept(): Promise<void> {
    if (submitting.value) return;
    submitting.value = 'accept';
    lastError.value = null;
    try {
      today.value = await api.acceptTodayEncounter();
    } catch (e) {
      lastError.value = extractErrorCode(e);
    } finally {
      submitting.value = null;
    }
  }

  async function choose(choiceKey: string): Promise<void> {
    if (submitting.value) return;
    submitting.value = `choose:${choiceKey}`;
    lastError.value = null;
    try {
      today.value = await api.chooseTodayEncounter(choiceKey);
    } catch (e) {
      lastError.value = extractErrorCode(e);
    } finally {
      submitting.value = null;
    }
  }

  async function complete(): Promise<void> {
    if (submitting.value) return;
    submitting.value = 'complete';
    lastError.value = null;
    try {
      today.value = await api.completeTodayEncounter();
    } catch (e) {
      lastError.value = extractErrorCode(e);
    } finally {
      submitting.value = null;
    }
  }

  async function skip(): Promise<void> {
    if (submitting.value) return;
    submitting.value = 'skip';
    lastError.value = null;
    try {
      today.value = await api.skipTodayEncounter();
    } catch (e) {
      lastError.value = extractErrorCode(e);
    } finally {
      submitting.value = null;
    }
  }

  async function claim(): Promise<void> {
    if (submitting.value) return;
    submitting.value = 'claim';
    lastError.value = null;
    try {
      const result = await api.claimTodayEncounter();
      lastClaim.value = result;
      today.value = result.view;
    } catch (e) {
      lastError.value = extractErrorCode(e);
    } finally {
      submitting.value = null;
    }
  }

  function reset(): void {
    today.value = null;
    history.value = [];
    loaded.value = false;
    loading.value = false;
    submitting.value = null;
    lastError.value = null;
    lastClaim.value = null;
  }

  return {
    today,
    history,
    loaded,
    loading,
    submitting,
    lastError,
    lastClaim,
    status,
    canAccept,
    canComplete,
    canClaim,
    loadToday,
    loadHistory,
    accept,
    choose,
    complete,
    skip,
    claim,
    reset,
  };
});
