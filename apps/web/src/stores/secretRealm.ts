import { computed, ref } from 'vue';
import { defineStore } from 'pinia';
import * as api from '@/api/secretRealm';

function extractErrorCode(e: unknown): string {
  return (
    (e as { code?: string }).code ??
    (e as { error?: { code?: string } }).error?.code ??
    'UNKNOWN_ERROR'
  );
}

export const useSecretRealmStore = defineStore('secretRealm', () => {
  const realms = ref<api.SecretRealmListEntry[]>([]);
  const activeRun = ref<api.SecretRealmRunView | null>(null);
  const history = ref<api.SecretRealmRunView[]>([]);
  const loaded = ref(false);
  const loading = ref(false);
  const submitting = ref<string | null>(null);
  const lastError = ref<string | null>(null);
  const lastClaim = ref<api.SecretRealmClaimResult | null>(null);

  const availableRealms = computed(() =>
    realms.value.filter((r) => r.status === 'AVAILABLE'),
  );

  async function loadAll(): Promise<void> {
    loading.value = true;
    lastError.value = null;
    try {
      realms.value = await api.fetchSecretRealms();
      loaded.value = true;
    } catch (e) {
      lastError.value = extractErrorCode(e);
    } finally {
      loading.value = false;
    }
  }

  async function loadHistory(limit = 30): Promise<void> {
    try {
      history.value = await api.fetchSecretRealmHistory(limit);
    } catch (e) {
      lastError.value = extractErrorCode(e);
    }
  }

  async function enter(realmKey: string): Promise<void> {
    if (submitting.value) return;
    submitting.value = `enter:${realmKey}`;
    lastError.value = null;
    try {
      activeRun.value = await api.enterSecretRealm(realmKey);
    } catch (e) {
      lastError.value = extractErrorCode(e);
    } finally {
      submitting.value = null;
    }
  }

  async function refreshRun(runId: string): Promise<void> {
    try {
      activeRun.value = await api.fetchSecretRealmRun(runId);
    } catch (e) {
      lastError.value = extractErrorCode(e);
    }
  }

  async function progress(
    runId: string,
    objectiveKey: string,
    delta: number,
  ): Promise<void> {
    if (submitting.value) return;
    submitting.value = `progress:${objectiveKey}`;
    lastError.value = null;
    try {
      activeRun.value = await api.progressSecretRealmRun(
        runId,
        objectiveKey,
        delta,
      );
    } catch (e) {
      lastError.value = extractErrorCode(e);
    } finally {
      submitting.value = null;
    }
  }

  async function complete(runId: string): Promise<void> {
    if (submitting.value) return;
    submitting.value = `complete:${runId}`;
    lastError.value = null;
    try {
      activeRun.value = await api.completeSecretRealmRun(runId);
    } catch (e) {
      lastError.value = extractErrorCode(e);
    } finally {
      submitting.value = null;
    }
  }

  async function claim(runId: string): Promise<void> {
    if (submitting.value) return;
    submitting.value = `claim:${runId}`;
    lastError.value = null;
    try {
      const result = await api.claimSecretRealmRun(runId);
      lastClaim.value = result;
      activeRun.value = result.run;
    } catch (e) {
      lastError.value = extractErrorCode(e);
    } finally {
      submitting.value = null;
    }
  }

  function reset(): void {
    realms.value = [];
    activeRun.value = null;
    history.value = [];
    loaded.value = false;
    loading.value = false;
    submitting.value = null;
    lastError.value = null;
    lastClaim.value = null;
  }

  return {
    realms,
    activeRun,
    history,
    loaded,
    loading,
    submitting,
    lastError,
    lastClaim,
    availableRealms,
    loadAll,
    loadHistory,
    enter,
    refreshRun,
    progress,
    complete,
    claim,
    reset,
  };
});
