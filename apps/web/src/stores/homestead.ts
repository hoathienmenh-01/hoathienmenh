import { computed, ref } from 'vue';
import { defineStore } from 'pinia';
import * as api from '@/api/homestead';

function errCode(e: unknown): string {
  return (
    (e as { code?: string }).code ??
    (e as { error?: { code?: string } }).error?.code ??
    'UNKNOWN'
  );
}

export const useHomesteadStore = defineStore('homestead', () => {
  const overview = ref<api.HomesteadOverview | null>(null);
  const loading = ref(false);
  const lastError = ref<string | null>(null);
  const fieldInFlight = ref<Set<number>>(new Set());
  const gardenInFlight = ref<Set<number>>(new Set());
  const upgradeInFlight = ref(false);
  const activeTab = ref<'fields' | 'garden'>('fields');
  const selectedCropKey = ref<string | null>(null);
  const selectedProductionKey = ref<string | null>(null);
  const lastHarvest = ref<api.HomesteadHarvestResult | null>(null);
  const lastGardenClaim = ref<api.HomesteadGardenClaimResult | null>(null);

  const homestead = computed(() => overview.value?.homestead ?? null);
  const fields = computed(() => overview.value?.fields ?? []);
  const garden = computed(() => overview.value?.garden ?? []);
  const cropCatalog = computed(() => overview.value?.cropCatalog ?? []);
  const gardenCatalog = computed(() => overview.value?.gardenCatalog ?? []);
  const upgrade = computed(() => overview.value?.upgrade ?? null);

  async function load(): Promise<void> {
    loading.value = true;
    lastError.value = null;
    try {
      overview.value = await api.getHomestead();
      selectedCropKey.value =
        selectedCropKey.value ??
        overview.value.cropCatalog.find((crop) => crop.unlocked)?.key ??
        overview.value.cropCatalog[0]?.key ??
        null;
      selectedProductionKey.value =
        selectedProductionKey.value ??
        overview.value.gardenCatalog.find((prod) => prod.unlocked)?.key ??
        overview.value.gardenCatalog[0]?.key ??
        null;
    } catch (e) {
      lastError.value = errCode(e);
    } finally {
      loading.value = false;
    }
  }

  async function upgradeHomestead(): Promise<string | null> {
    if (upgradeInFlight.value) return 'IN_FLIGHT';
    upgradeInFlight.value = true;
    lastError.value = null;
    try {
      await api.upgradeHomestead();
      await load();
      return null;
    } catch (e) {
      const code = errCode(e);
      lastError.value = code;
      return code;
    } finally {
      upgradeInFlight.value = false;
    }
  }

  async function plant(slotIndex: number, cropKey: string): Promise<string | null> {
    if (fieldInFlight.value.has(slotIndex)) return 'IN_FLIGHT';
    const next = new Set(fieldInFlight.value);
    next.add(slotIndex);
    fieldInFlight.value = next;
    lastError.value = null;
    try {
      await api.plantHomesteadField(slotIndex, cropKey);
      await load();
      return null;
    } catch (e) {
      const code = errCode(e);
      lastError.value = code;
      return code;
    } finally {
      const cleared = new Set(fieldInFlight.value);
      cleared.delete(slotIndex);
      fieldInFlight.value = cleared;
    }
  }

  async function harvest(slotIndex: number): Promise<string | null> {
    if (fieldInFlight.value.has(slotIndex)) return 'IN_FLIGHT';
    const next = new Set(fieldInFlight.value);
    next.add(slotIndex);
    fieldInFlight.value = next;
    lastError.value = null;
    try {
      lastHarvest.value = await api.harvestHomesteadField(slotIndex);
      await load();
      return null;
    } catch (e) {
      const code = errCode(e);
      lastError.value = code;
      return code;
    } finally {
      const cleared = new Set(fieldInFlight.value);
      cleared.delete(slotIndex);
      fieldInFlight.value = cleared;
    }
  }

  async function startGarden(slotIndex: number, productionKey: string): Promise<string | null> {
    if (gardenInFlight.value.has(slotIndex)) return 'IN_FLIGHT';
    const next = new Set(gardenInFlight.value);
    next.add(slotIndex);
    gardenInFlight.value = next;
    lastError.value = null;
    try {
      await api.startHomesteadGarden(slotIndex, productionKey);
      await load();
      return null;
    } catch (e) {
      const code = errCode(e);
      lastError.value = code;
      return code;
    } finally {
      const cleared = new Set(gardenInFlight.value);
      cleared.delete(slotIndex);
      gardenInFlight.value = cleared;
    }
  }

  async function claimGarden(slotIndex: number): Promise<string | null> {
    if (gardenInFlight.value.has(slotIndex)) return 'IN_FLIGHT';
    const next = new Set(gardenInFlight.value);
    next.add(slotIndex);
    gardenInFlight.value = next;
    lastError.value = null;
    try {
      lastGardenClaim.value = await api.claimHomesteadGarden(slotIndex);
      await load();
      return null;
    } catch (e) {
      const code = errCode(e);
      lastError.value = code;
      return code;
    } finally {
      const cleared = new Set(gardenInFlight.value);
      cleared.delete(slotIndex);
      gardenInFlight.value = cleared;
    }
  }

  function isFieldBusy(slotIndex: number): boolean {
    return fieldInFlight.value.has(slotIndex);
  }

  function isGardenBusy(slotIndex: number): boolean {
    return gardenInFlight.value.has(slotIndex);
  }

  return {
    overview,
    loading,
    lastError,
    fieldInFlight,
    gardenInFlight,
    upgradeInFlight,
    activeTab,
    selectedCropKey,
    selectedProductionKey,
    lastHarvest,
    lastGardenClaim,
    homestead,
    fields,
    garden,
    cropCatalog,
    gardenCatalog,
    upgrade,
    load,
    upgradeHomestead,
    plant,
    harvest,
    startGarden,
    claimGarden,
    isFieldBusy,
    isGardenBusy,
  };
});
