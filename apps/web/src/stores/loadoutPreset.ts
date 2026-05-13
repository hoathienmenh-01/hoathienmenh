import { computed, ref } from 'vue';
import { defineStore } from 'pinia';
import * as api from '@/api/loadoutPreset';

function extractErrorCode(e: unknown): string {
  return (
    (e as { code?: string }).code ??
    (e as { error?: { code?: string } }).error?.code ??
    'UNKNOWN_ERROR'
  );
}

export const useLoadoutPresetStore = defineStore('loadoutPreset', () => {
  const presets = ref<api.LoadoutPresetView[]>([]);
  const loaded = ref(false);
  const loading = ref(false);
  const submitting = ref<string | null>(null);
  const lastError = ref<string | null>(null);
  const lastApply = ref<api.LoadoutPresetApplyReport | null>(null);

  const byType = computed(
    () =>
      (type: api.LoadoutPresetType): api.LoadoutPresetView | undefined =>
        presets.value.find((p) => p.presetType === type),
  );

  async function loadAll(): Promise<void> {
    loading.value = true;
    lastError.value = null;
    try {
      presets.value = await api.fetchLoadoutPresets();
      loaded.value = true;
    } catch (e) {
      lastError.value = extractErrorCode(e);
    } finally {
      loading.value = false;
    }
  }

  async function createPreset(input: {
    presetType: api.LoadoutPresetType;
    name: string;
    equipment?: api.LoadoutPresetEquipmentEntry[];
  }): Promise<void> {
    if (submitting.value) return;
    submitting.value = `create:${input.presetType}`;
    lastError.value = null;
    try {
      const preset = await api.createLoadoutPreset(input);
      presets.value = [
        preset,
        ...presets.value.filter((p) => p.id !== preset.id),
      ].sort((a, b) => a.presetType.localeCompare(b.presetType));
    } catch (e) {
      lastError.value = extractErrorCode(e);
    } finally {
      submitting.value = null;
    }
  }

  async function updatePreset(
    presetId: string,
    input: { name?: string; equipment?: api.LoadoutPresetEquipmentEntry[] },
  ): Promise<void> {
    if (submitting.value) return;
    submitting.value = `update:${presetId}`;
    lastError.value = null;
    try {
      const preset = await api.updateLoadoutPreset(presetId, input);
      presets.value = presets.value.map((p) =>
        p.id === preset.id ? preset : p,
      );
    } catch (e) {
      lastError.value = extractErrorCode(e);
    } finally {
      submitting.value = null;
    }
  }

  async function deletePreset(presetId: string): Promise<void> {
    if (submitting.value) return;
    submitting.value = `delete:${presetId}`;
    lastError.value = null;
    try {
      await api.deleteLoadoutPreset(presetId);
      presets.value = presets.value.filter((p) => p.id !== presetId);
    } catch (e) {
      lastError.value = extractErrorCode(e);
    } finally {
      submitting.value = null;
    }
  }

  async function saveCurrent(input: {
    presetType: api.LoadoutPresetType;
    name: string;
  }): Promise<void> {
    if (submitting.value) return;
    submitting.value = `saveCurrent:${input.presetType}`;
    lastError.value = null;
    try {
      const preset = await api.saveCurrentLoadout(input);
      presets.value = [
        preset,
        ...presets.value.filter((p) => p.id !== preset.id),
      ].sort((a, b) => a.presetType.localeCompare(b.presetType));
    } catch (e) {
      lastError.value = extractErrorCode(e);
    } finally {
      submitting.value = null;
    }
  }

  async function validate(
    presetId: string,
  ): Promise<api.LoadoutPresetValidateResult | null> {
    lastError.value = null;
    try {
      return await api.validateLoadoutPreset(presetId);
    } catch (e) {
      lastError.value = extractErrorCode(e);
      return null;
    }
  }

  async function apply(presetId: string): Promise<void> {
    if (submitting.value) return;
    submitting.value = `apply:${presetId}`;
    lastError.value = null;
    try {
      lastApply.value = await api.applyLoadoutPreset(presetId);
      // Refresh after apply — preset's equipment list may have been updated
      // by transactional apply (slot conflicts auto-unequipped).
      await loadAll();
    } catch (e) {
      lastError.value = extractErrorCode(e);
    } finally {
      submitting.value = null;
    }
  }

  function reset(): void {
    presets.value = [];
    loaded.value = false;
    loading.value = false;
    submitting.value = null;
    lastError.value = null;
    lastApply.value = null;
  }

  return {
    presets,
    loaded,
    loading,
    submitting,
    lastError,
    lastApply,
    byType,
    loadAll,
    createPreset,
    updatePreset,
    deletePreset,
    saveCurrent,
    validate,
    apply,
    reset,
  };
});
