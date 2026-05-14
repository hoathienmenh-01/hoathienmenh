import { computed, ref } from 'vue';
import { defineStore } from 'pinia';
import * as api from '@/api/seasons';

function extractErrorCode(e: unknown): string {
  return (
    (e as { code?: string }).code ??
    (e as { error?: { code?: string } }).error?.code ??
    'UNKNOWN_ERROR'
  );
}

export const useSeasonStore = defineStore('seasons', () => {
  const season = ref<api.SeasonView | null>(null);
  const progress = ref<api.SeasonProgressStats | null>(null);
  const rewards = ref<api.SeasonRewardView[]>([]);
  const leaderboard = ref<api.SeasonLeaderboardEntry[]>([]);
  const leaderboardKind = ref<api.SeasonLeaderboardKind>('POINTS');
  const milestones = ref<api.SeasonServerMilestone[]>([]);
  const loading = ref(false);
  const leaderboardLoading = ref(false);
  const milestoneLoading = ref(false);
  const loaded = ref(false);
  const lastError = ref<string | null>(null);
  const submittingRewardKey = ref<string | null>(null);
  const lastClaimResult = ref<api.SeasonClaimResult | null>(null);

  const hasSeason = computed(() => season.value !== null);
  const points = computed(() => progress.value?.points ?? 0);
  const claimableCount = computed(
    () => rewards.value.filter((r) => r.claimable && !r.claimed).length,
  );

  async function load(): Promise<void> {
    loading.value = true;
    lastError.value = null;
    try {
      const view = await api.fetchSeasonProgress();
      season.value = view.season;
      progress.value = view.progress;
      rewards.value = view.rewards;
      loaded.value = true;
    } catch (e) {
      lastError.value = extractErrorCode(e);
    } finally {
      loading.value = false;
    }
  }

  async function loadLeaderboard(
    kind: api.SeasonLeaderboardKind = leaderboardKind.value,
  ): Promise<void> {
    leaderboardLoading.value = true;
    try {
      const view = await api.fetchSeasonLeaderboard(kind);
      leaderboardKind.value = view.kind;
      if (view.season) season.value = view.season;
      leaderboard.value = view.entries;
    } catch (e) {
      lastError.value = extractErrorCode(e);
    } finally {
      leaderboardLoading.value = false;
    }
  }

  async function loadMilestones(): Promise<void> {
    milestoneLoading.value = true;
    try {
      const view = await api.fetchSeasonMilestones();
      if (view.season) season.value = view.season;
      milestones.value = view.milestones;
    } catch (e) {
      lastError.value = extractErrorCode(e);
    } finally {
      milestoneLoading.value = false;
    }
  }

  async function claim(rewardKey: string): Promise<api.SeasonClaimResult> {
    submittingRewardKey.value = rewardKey;
    try {
      const result = await api.claimSeasonReward(rewardKey);
      lastClaimResult.value = result;
      await Promise.all([load(), loadLeaderboard(), loadMilestones()]);
      return result;
    } catch (e) {
      lastError.value = extractErrorCode(e);
      throw e;
    } finally {
      submittingRewardKey.value = null;
    }
  }

  function reset(): void {
    season.value = null;
    progress.value = null;
    rewards.value = [];
    leaderboard.value = [];
    leaderboardKind.value = 'POINTS';
    milestones.value = [];
    loading.value = false;
    leaderboardLoading.value = false;
    milestoneLoading.value = false;
    loaded.value = false;
    lastError.value = null;
    submittingRewardKey.value = null;
    lastClaimResult.value = null;
  }

  return {
    season,
    progress,
    rewards,
    leaderboard,
    leaderboardKind,
    milestones,
    loading,
    leaderboardLoading,
    milestoneLoading,
    loaded,
    lastError,
    submittingRewardKey,
    lastClaimResult,
    hasSeason,
    points,
    claimableCount,
    load,
    loadLeaderboard,
    loadMilestones,
    claim,
    reset,
  };
});
