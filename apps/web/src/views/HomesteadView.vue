<script setup lang="ts">
import { computed, onMounted } from 'vue';
import { useI18n } from 'vue-i18n';
import AppShell from '@/components/shell/AppShell.vue';
import { useAuthStore } from '@/stores/auth';
import { useHomesteadStore } from '@/stores/homestead';
import { useToastStore } from '@/stores/toast';
import type {
  HomesteadCropCatalogEntry,
  HomesteadGardenCatalogEntry,
  HomesteadFieldSlotView,
  HomesteadGardenSlotView,
} from '@/api/homestead';

const auth = useAuthStore();
const store = useHomesteadStore();
const toast = useToastStore();
const { t, locale } = useI18n();

const isVi = computed(() => locale.value === 'vi');
const selectedCrop = computed(() =>
  store.cropCatalog.find((crop) => crop.key === store.selectedCropKey),
);
const selectedProduction = computed(() =>
  store.gardenCatalog.find((prod) => prod.key === store.selectedProductionKey),
);

function nameOf(entry: HomesteadCropCatalogEntry | HomesteadGardenCatalogEntry): string {
  return isVi.value ? entry.nameVi : entry.nameEn;
}

function timeText(seconds: number): string {
  if (seconds <= 0) return t('homestead.ready');
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

function slotItemName(slot: HomesteadFieldSlotView | HomesteadGardenSlotView): string {
  if (slot.state === 'EMPTY') return '';
  if ('cropKey' in slot) {
    return nameOf(store.cropCatalog.find((crop) => crop.key === slot.cropKey) ?? {
      key: slot.cropKey,
      nameVi: slot.cropKey,
      nameEn: slot.cropKey,
      tier: 1,
      outputItemKey: slot.outputItemKey,
      yieldQty: slot.expectedYield,
      growthMinutes: 0,
      spiritualEnergyCost: 0,
      dailyCapQty: 0,
      requiredRealmKey: null,
      unlocked: true,
    });
  }
  return nameOf(store.gardenCatalog.find((prod) => prod.key === slot.productionKey) ?? {
    key: slot.productionKey,
    nameVi: slot.productionKey,
    nameEn: slot.productionKey,
    tier: 1,
    outputItemKey: slot.outputItemKey,
    yieldQty: slot.expectedYield,
    durationMinutes: 0,
    spiritualEnergyCost: 0,
    dailyCapQty: 0,
    requiredRealmKey: null,
    rare: false,
    unlocked: true,
  });
}

function errorText(code: string | null): string {
  if (!code) return '';
  const key = `homestead.error.${code}`;
  const text = t(key);
  return text === key ? t('homestead.error.UNKNOWN') : text;
}

async function refresh(): Promise<void> {
  await store.load();
  if (store.lastError) toast.push({ type: 'error', text: errorText(store.lastError) });
}

async function onUpgrade(): Promise<void> {
  const code = await store.upgradeHomestead();
  if (code) {
    toast.push({ type: 'error', text: errorText(code) });
    return;
  }
  toast.push({ type: 'success', text: t('homestead.toast.upgraded') });
}

async function onPlant(slotIndex: number): Promise<void> {
  if (!store.selectedCropKey) return;
  const code = await store.plant(slotIndex, store.selectedCropKey);
  if (code) toast.push({ type: 'error', text: errorText(code) });
}

async function onHarvest(slotIndex: number): Promise<void> {
  const code = await store.harvest(slotIndex);
  if (code) {
    toast.push({ type: 'error', text: errorText(code) });
    return;
  }
  const last = store.lastHarvest;
  if (last) toast.push({ type: 'success', text: t('homestead.toast.harvested', { qty: last.qty }) });
}

async function onStartGarden(slotIndex: number): Promise<void> {
  if (!store.selectedProductionKey) return;
  const code = await store.startGarden(slotIndex, store.selectedProductionKey);
  if (code) toast.push({ type: 'error', text: errorText(code) });
}

async function onClaimGarden(slotIndex: number): Promise<void> {
  const code = await store.claimGarden(slotIndex);
  if (code) {
    toast.push({ type: 'error', text: errorText(code) });
    return;
  }
  const last = store.lastGardenClaim;
  if (last) toast.push({ type: 'success', text: t('homestead.toast.claimed', { qty: last.qty }) });
}

onMounted(async () => {
  if (auth.user) await refresh();
});
</script>

<template>
  <AppShell>
    <section class="space-y-4 p-4" data-testid="homestead-page">
      <header class="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 class="text-2xl font-bold">{{ t('homestead.title') }}</h1>
          <p class="text-sm text-gray-300">{{ t('homestead.subtitle') }}</p>
        </div>
        <button
          type="button"
          class="rounded border border-gray-700 px-3 py-2 text-sm hover:border-amber-500 disabled:opacity-50"
          :disabled="store.loading"
          @click="refresh"
        >
          {{ t('common.refresh') }}
        </button>
      </header>

      <p
        v-if="store.loading && !store.homestead"
        class="rounded border border-gray-800 bg-gray-900 p-4 text-center text-gray-400"
      >
        {{ t('homestead.loading') }}
      </p>

      <p
        v-else-if="store.lastError && !store.homestead"
        class="rounded border border-red-900 bg-red-950/40 p-4 text-sm text-red-200"
      >
        {{ errorText(store.lastError) }}
      </p>

      <template v-else-if="store.homestead">
        <article class="rounded-xl border border-amber-800 bg-gray-950 p-4 shadow">
          <div class="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
            <div>
              <p class="text-xs uppercase tracking-widest text-amber-300">
                {{ t('homestead.level', { level: store.homestead.level }) }}
              </p>
              <h2 class="text-xl font-semibold">
                {{ isVi ? store.homestead.nameVi : store.homestead.nameEn }}
              </h2>
              <p class="mt-2 text-sm text-gray-300">
                {{ t('homestead.offlineCap', { hours: store.homestead.offlineCapHours }) }}
              </p>
            </div>
            <div class="grid grid-cols-2 gap-2 text-sm md:grid-cols-4">
              <span class="rounded bg-gray-900 px-3 py-2">
                {{ t('homestead.energy') }}:
                <b>{{ store.homestead.spiritualEnergy }}/{{ store.homestead.storageCap }}</b>
              </span>
              <span class="rounded bg-gray-900 px-3 py-2">
                {{ t('homestead.fields') }}: <b>{{ store.homestead.fieldSlots }}</b>
              </span>
              <span class="rounded bg-gray-900 px-3 py-2">
                {{ t('homestead.garden') }}: <b>{{ store.homestead.gardenSlots }}</b>
              </span>
              <span class="rounded bg-gray-900 px-3 py-2">
                {{ t('homestead.maxTier') }}:
                <b>{{ store.homestead.maxCropTier }}/{{ store.homestead.maxGardenTier }}</b>
              </span>
            </div>
          </div>

          <div v-if="store.upgrade" class="mt-4 rounded-lg border border-gray-800 bg-gray-900 p-3">
            <div class="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <div class="text-sm text-gray-300">
                <p class="font-semibold text-gray-100">{{ t('homestead.upgradeTitle') }}</p>
                <p v-if="store.upgrade.available">
                  {{ t('homestead.upgradeCost', {
                    level: store.upgrade.toLevel,
                    linhThach: store.upgrade.linhThachCost,
                    energy: store.upgrade.spiritualEnergyCost,
                    realm: store.upgrade.requiredRealmKey ?? '-',
                  }) }}
                </p>
                <p v-else>{{ t('homestead.maxLevel') }}</p>
              </div>
              <button
                type="button"
                class="rounded bg-amber-700 px-4 py-2 text-sm font-semibold hover:bg-amber-600 disabled:opacity-50"
                :disabled="!store.upgrade.canUpgrade || store.upgradeInFlight"
                @click="onUpgrade"
              >
                {{ t('homestead.upgrade') }}
              </button>
            </div>
          </div>
        </article>

        <div class="flex gap-2">
          <button
            type="button"
            class="rounded px-4 py-2 text-sm"
            :class="store.activeTab === 'fields' ? 'bg-green-700' : 'bg-gray-800'"
            @click="store.activeTab = 'fields'"
          >
            {{ t('homestead.tabs.fields') }}
          </button>
          <button
            type="button"
            class="rounded px-4 py-2 text-sm"
            :class="store.activeTab === 'garden' ? 'bg-purple-700' : 'bg-gray-800'"
            @click="store.activeTab = 'garden'"
          >
            {{ t('homestead.tabs.garden') }}
          </button>
        </div>

        <section v-if="store.activeTab === 'fields'" class="space-y-3">
          <div class="rounded-lg border border-gray-800 bg-gray-950 p-3">
            <label class="text-sm font-semibold" for="crop-select">
              {{ t('homestead.selectCrop') }}
            </label>
            <select
              id="crop-select"
              v-model="store.selectedCropKey"
              class="mt-2 w-full rounded border border-gray-700 bg-gray-900 p-2 text-sm"
            >
              <option v-for="crop in store.cropCatalog" :key="crop.key" :value="crop.key">
                {{ nameOf(crop) }} · T{{ crop.tier }} · {{ crop.yieldQty }} {{ crop.outputItemKey }}
                · {{ crop.growthMinutes }}m · cap {{ crop.dailyCapQty }}/d
                {{ crop.unlocked ? '' : `(${t('homestead.locked')})` }}
              </option>
            </select>
            <p v-if="selectedCrop" class="mt-2 text-xs text-gray-400">
              {{ t('homestead.costLine', {
                energy: selectedCrop.spiritualEnergyCost,
                cap: selectedCrop.dailyCapQty,
                item: selectedCrop.outputItemKey,
              }) }}
            </p>
          </div>

          <div class="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
            <article
              v-for="slot in store.fields"
              :key="slot.slotIndex"
              class="rounded-lg border border-green-900 bg-gray-950 p-3"
              :data-testid="`homestead-field-${slot.slotIndex}`"
            >
              <div class="flex items-center justify-between">
                <h3 class="font-semibold">{{ t('homestead.slot', { n: slot.slotIndex + 1 }) }}</h3>
                <span class="rounded bg-gray-800 px-2 py-0.5 text-xs">{{ slot.state }}</span>
              </div>
              <p v-if="slot.state === 'EMPTY'" class="mt-3 text-sm text-gray-400">
                {{ t('homestead.emptyField') }}
              </p>
              <p v-else class="mt-3 text-sm text-gray-300">
                {{ slotItemName(slot) }} · +{{ slot.expectedYield }} {{ slot.outputItemKey }}
                <br />
                {{ timeText(slot.remainingSeconds) }}
              </p>
              <button
                v-if="slot.state === 'EMPTY'"
                type="button"
                class="mt-3 rounded bg-green-700 px-3 py-1 text-sm hover:bg-green-600 disabled:opacity-50"
                :disabled="!selectedCrop?.unlocked || store.isFieldBusy(slot.slotIndex)"
                @click="onPlant(slot.slotIndex)"
              >
                {{ t('homestead.plant') }}
              </button>
              <button
                v-else
                type="button"
                class="mt-3 rounded bg-amber-700 px-3 py-1 text-sm hover:bg-amber-600 disabled:opacity-50"
                :disabled="slot.state !== 'READY' || store.isFieldBusy(slot.slotIndex)"
                @click="onHarvest(slot.slotIndex)"
              >
                {{ t('homestead.harvest') }}
              </button>
            </article>
          </div>
        </section>

        <section v-else class="space-y-3">
          <div class="rounded-lg border border-gray-800 bg-gray-950 p-3">
            <label class="text-sm font-semibold" for="garden-select">
              {{ t('homestead.selectProduction') }}
            </label>
            <select
              id="garden-select"
              v-model="store.selectedProductionKey"
              class="mt-2 w-full rounded border border-gray-700 bg-gray-900 p-2 text-sm"
            >
              <option v-for="prod in store.gardenCatalog" :key="prod.key" :value="prod.key">
                {{ nameOf(prod) }} · T{{ prod.tier }} · {{ prod.yieldQty }} {{ prod.outputItemKey }}
                · {{ prod.durationMinutes }}m · cap {{ prod.dailyCapQty }}/d
                {{ prod.rare ? `· ${t('homestead.rare')}` : '' }}
                {{ prod.unlocked ? '' : `(${t('homestead.locked')})` }}
              </option>
            </select>
            <p v-if="selectedProduction" class="mt-2 text-xs text-gray-400">
              {{ t('homestead.costLine', {
                energy: selectedProduction.spiritualEnergyCost,
                cap: selectedProduction.dailyCapQty,
                item: selectedProduction.outputItemKey,
              }) }}
            </p>
          </div>

          <div class="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
            <article
              v-for="slot in store.garden"
              :key="slot.slotIndex"
              class="rounded-lg border border-purple-900 bg-gray-950 p-3"
              :data-testid="`homestead-garden-${slot.slotIndex}`"
            >
              <div class="flex items-center justify-between">
                <h3 class="font-semibold">{{ t('homestead.slot', { n: slot.slotIndex + 1 }) }}</h3>
                <span class="rounded bg-gray-800 px-2 py-0.5 text-xs">{{ slot.state }}</span>
              </div>
              <p v-if="slot.state === 'EMPTY'" class="mt-3 text-sm text-gray-400">
                {{ t('homestead.emptyGarden') }}
              </p>
              <p v-else class="mt-3 text-sm text-gray-300">
                {{ slotItemName(slot) }} · +{{ slot.expectedYield }} {{ slot.outputItemKey }}
                <br />
                {{ timeText(slot.remainingSeconds) }}
              </p>
              <button
                v-if="slot.state === 'EMPTY'"
                type="button"
                class="mt-3 rounded bg-purple-700 px-3 py-1 text-sm hover:bg-purple-600 disabled:opacity-50"
                :disabled="!selectedProduction?.unlocked || store.isGardenBusy(slot.slotIndex)"
                @click="onStartGarden(slot.slotIndex)"
              >
                {{ t('homestead.startGarden') }}
              </button>
              <button
                v-else
                type="button"
                class="mt-3 rounded bg-amber-700 px-3 py-1 text-sm hover:bg-amber-600 disabled:opacity-50"
                :disabled="slot.state !== 'READY' || store.isGardenBusy(slot.slotIndex)"
                @click="onClaimGarden(slot.slotIndex)"
              >
                {{ t('homestead.claim') }}
              </button>
            </article>
          </div>
        </section>
      </template>

      <p v-else class="rounded border border-gray-800 bg-gray-900 p-4 text-center text-gray-400">
        {{ t('homestead.empty') }}
      </p>
    </section>
  </AppShell>
</template>
