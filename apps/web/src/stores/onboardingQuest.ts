import { computed, ref } from 'vue';
import { defineStore } from 'pinia';
import * as api from '@/api/onboardingQuest';

/**
 * Phase 34.0 — 7-Day Onboarding Questline store.
 *
 * Mirror server state — KHÔNG optimistic update (reward server-authoritative).
 *
 * State:
 *   - `progress`: full 7-day overview (lazy-loaded khi mount view).
 *   - `loaded` / `loading` / `lastError`: lifecycle flags.
 *   - `submittingKey`: taskKey đang accept/complete/claim (disable button).
 *   - `lastClaim`: result snapshot lần claim gần nhất (cho toast/notification).
 *
 * Mọi action gọi server → server trả về state mới → store cập nhật.
 */

function extractErrorCode(e: unknown): string {
  return (
    (e as { code?: string }).code ??
    (e as { error?: { code?: string } }).error?.code ??
    'UNKNOWN_ERROR'
  );
}

export const useOnboardingQuestStore = defineStore('onboardingQuest', () => {
  const progress = ref<api.OnboardingProgressView | null>(null);
  const loaded = ref(false);
  const loading = ref(false);
  const lastError = ref<string | null>(null);
  const submittingKey = ref<string | null>(null);
  const lastClaim = ref<api.OnboardingClaimResult | null>(null);

  const totalCompleted = computed(() => progress.value?.completedTasks ?? 0);
  const totalClaimed = computed(() => progress.value?.claimedTasks ?? 0);
  const totalTasks = computed(() => progress.value?.totalTasks ?? 0);
  const overallPct = computed(() => {
    const total = totalTasks.value;
    if (total === 0) return 0;
    return Math.round((totalClaimed.value / total) * 100);
  });

  async function loadProgress(): Promise<void> {
    loading.value = true;
    lastError.value = null;
    try {
      progress.value = await api.fetchOnboardingProgress();
      loaded.value = true;
    } catch (e) {
      lastError.value = extractErrorCode(e);
    } finally {
      loading.value = false;
    }
  }

  async function acceptTask(taskKey: string): Promise<void> {
    if (submittingKey.value) return;
    submittingKey.value = taskKey;
    lastError.value = null;
    try {
      await api.acceptOnboardingTask(taskKey);
      await loadProgress();
    } catch (e) {
      lastError.value = extractErrorCode(e);
    } finally {
      submittingKey.value = null;
    }
  }

  async function completeTask(taskKey: string): Promise<void> {
    if (submittingKey.value) return;
    submittingKey.value = taskKey;
    lastError.value = null;
    try {
      await api.completeOnboardingTask(taskKey);
      await loadProgress();
    } catch (e) {
      lastError.value = extractErrorCode(e);
    } finally {
      submittingKey.value = null;
    }
  }

  async function claimTask(taskKey: string): Promise<void> {
    if (submittingKey.value) return;
    submittingKey.value = taskKey;
    lastError.value = null;
    try {
      const result = await api.claimOnboardingTask(taskKey);
      lastClaim.value = result;
      await loadProgress();
    } catch (e) {
      lastError.value = extractErrorCode(e);
    } finally {
      submittingKey.value = null;
    }
  }

  async function recompute(): Promise<void> {
    if (submittingKey.value) return;
    submittingKey.value = '__recompute__';
    lastError.value = null;
    try {
      progress.value = await api.recomputeOnboarding();
    } catch (e) {
      lastError.value = extractErrorCode(e);
    } finally {
      submittingKey.value = null;
    }
  }

  function clearLastClaim(): void {
    lastClaim.value = null;
  }

  function reset(): void {
    progress.value = null;
    loaded.value = false;
    loading.value = false;
    lastError.value = null;
    submittingKey.value = null;
    lastClaim.value = null;
  }

  return {
    // state
    progress,
    loaded,
    loading,
    lastError,
    submittingKey,
    lastClaim,
    // computed
    totalCompleted,
    totalClaimed,
    totalTasks,
    overallPct,
    // actions
    loadProgress,
    acceptTask,
    completeTask,
    claimTask,
    recompute,
    clearLastClaim,
    reset,
  };
});
