import { ref, computed } from 'vue';
import { defineStore } from 'pinia';
import * as api from '@/api/npcAffinity';

/**
 * Phase 12.10.A — NPC Affinity Pinia store.
 *
 * Holds NPC affinity list for the current character. Read-only view — mutations
 * happen server-side via dialogue choice / quest reward; store reloads after
 * `StoryDialogueModal` applies effects.
 */
export const useNpcAffinityStore = defineStore('npcAffinity', () => {
  const affinities = ref<api.NpcAffinityView[]>([]);
  const caps = ref<api.NpcAffinityCaps | null>(null);
  const loaded = ref(false);
  const loading = ref(false);
  const error = ref<string | null>(null);

  const count = computed(() => affinities.value.length);

  function findByNpcKey(npcKey: string): api.NpcAffinityView | undefined {
    return affinities.value.find((a) => a.npcKey === npcKey);
  }

  async function load(): Promise<void> {
    loading.value = true;
    error.value = null;
    try {
      const result = await api.fetchNpcAffinities();
      affinities.value = result.affinities;
      caps.value = result.caps;
      loaded.value = true;
    } catch (e) {
      error.value =
        (e as { code?: string }).code ??
        (e as { error?: { code?: string } }).error?.code ??
        'UNKNOWN';
    } finally {
      loading.value = false;
    }
  }

  async function refresh(): Promise<void> {
    await load();
  }

  function reset(): void {
    affinities.value = [];
    caps.value = null;
    loaded.value = false;
    loading.value = false;
    error.value = null;
  }

  return {
    affinities,
    caps,
    loaded,
    loading,
    error,
    count,
    findByNpcKey,
    load,
    refresh,
    reset,
  };
});
