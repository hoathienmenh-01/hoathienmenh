import { computed, ref } from 'vue';
import { defineStore } from 'pinia';
import * as api from '@/api/bodyCultivation';

export const useBodyCultivationStore = defineStore('bodyCultivation', () => {
  const status = ref<api.BodyCultivationStatus | null>(null);
  const loaded = ref(false);
  const loading = ref(false);
  const actionLoading = ref(false);
  const errorCode = ref<string | null>(null);

  const progress = computed(() => {
    if (!status.value) return 0;
    const exp = BigInt(status.value.bodyExp);
    const next = BigInt(status.value.bodyExpNext);
    if (next === 0n) return 1;
    return Math.min(Number((exp * 10000n) / next) / 10000, 1);
  });

  function setStatus(next: api.BodyCultivationStatus): void {
    status.value = next;
    loaded.value = true;
    errorCode.value = null;
  }

  function codeFromError(e: unknown): string {
    return (
      (e as { code?: string }).code ??
      (e as { error?: { code?: string } }).error?.code ??
      'UNKNOWN'
    );
  }

  async function fetchState(): Promise<void> {
    loading.value = true;
    try {
      setStatus(await api.getBodyCultivationStatus());
    } catch (e) {
      errorCode.value = codeFromError(e);
      throw e;
    } finally {
      loading.value = false;
    }
  }

  async function start(): Promise<string | null> {
    actionLoading.value = true;
    try {
      setStatus(await api.startBodyCultivation());
      return null;
    } catch (e) {
      const code = codeFromError(e);
      errorCode.value = code;
      return code;
    } finally {
      actionLoading.value = false;
    }
  }

  async function stop(): Promise<string | null> {
    actionLoading.value = true;
    try {
      setStatus(await api.stopBodyCultivation());
      return null;
    } catch (e) {
      const code = codeFromError(e);
      errorCode.value = code;
      return code;
    } finally {
      actionLoading.value = false;
    }
  }

  async function breakthrough(): Promise<{ code: string | null; success: boolean | null }> {
    actionLoading.value = true;
    try {
      const result = await api.attemptBodyBreakthrough();
      setStatus(result.status);
      return { code: null, success: result.success };
    } catch (e) {
      const code = codeFromError(e);
      errorCode.value = code;
      return { code, success: null };
    } finally {
      actionLoading.value = false;
    }
  }

  function reset(): void {
    status.value = null;
    loaded.value = false;
    loading.value = false;
    actionLoading.value = false;
    errorCode.value = null;
  }

  return {
    status,
    loaded,
    loading,
    actionLoading,
    errorCode,
    progress,
    fetchState,
    start,
    stop,
    breakthrough,
    reset,
  };
});
