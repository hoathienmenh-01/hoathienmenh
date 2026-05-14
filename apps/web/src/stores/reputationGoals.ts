import { computed, ref } from 'vue';
import { defineStore } from 'pinia';
import * as api from '@/api/reputation-goals';

export const useReputationGoalsStore = defineStore('reputationGoals', () => {
  const reputation = ref<api.ReputationRow[]>([]);
  const goals = ref<api.LongTermGoalRow[]>([]);
  const loaded = ref(false);

  async function fetchState(): Promise<void> {
    const [repRows, goalRows] = await Promise.all([
      api.getReputationState(),
      api.getLongTermGoalsState(),
    ]);
    reputation.value = repRows;
    goals.value = goalRows;
    loaded.value = true;
  }

  const totalReputation = computed(() =>
    reputation.value.reduce((sum, row) => sum + row.score, 0),
  );
  const completedGoals = computed(
    () => goals.value.filter((row) => row.completedAt !== null).length,
  );
  const totalGoals = computed(() => goals.value.length);

  function reset(): void {
    reputation.value = [];
    goals.value = [];
    loaded.value = false;
  }

  return {
    reputation,
    goals,
    loaded,
    totalReputation,
    completedGoals,
    totalGoals,
    fetchState,
    reset,
  };
});
