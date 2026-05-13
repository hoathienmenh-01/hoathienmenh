<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useAuthStore } from '@/stores/auth';
import { useLoadoutPresetStore } from '@/stores/loadoutPreset';
import { useToastStore } from '@/stores/toast';
import AppShell from '@/components/shell/AppShell.vue';
import type {
  LoadoutPresetType,
  LoadoutPresetView,
} from '@/api/loadoutPreset';

/**
 * Phase 34.4 — Loadout Preset view.
 *
 * Tabs PvE / PvP / Boss / Cultivation / Custom. Per-tab card with apply/
 * save-current/delete actions. Validate before apply (server-side).
 */

const TYPES: LoadoutPresetType[] = [
  'PVE',
  'PVP',
  'BOSS',
  'CULTIVATION',
  'CUSTOM',
];

const auth = useAuthStore();
const store = useLoadoutPresetStore();
const toast = useToastStore();
const { t } = useI18n();

const selectedType = ref<LoadoutPresetType>('PVE');
const newName = ref('');

const presetForType = computed<LoadoutPresetView | null>(() => {
  return store.presets.find((p) => p.presetType === selectedType.value) ?? null;
});

function errText(code: string | null): string {
  if (!code) return '';
  const key = `loadoutPreset.error.${code}`;
  const text = t(key);
  return text === key ? t('loadoutPreset.error.UNKNOWN_ERROR') : text;
}

async function refresh(): Promise<void> {
  await store.loadAll();
  if (store.lastError)
    toast.push({ type: 'error', text: errText(store.lastError) });
}

async function onSaveCurrent(): Promise<void> {
  if (!newName.value.trim()) return;
  await store.saveCurrent({
    presetType: selectedType.value,
    name: newName.value.trim(),
  });
  if (store.lastError) {
    toast.push({ type: 'error', text: errText(store.lastError) });
    return;
  }
  newName.value = '';
  toast.push({ type: 'success', text: t('loadoutPreset.savedToast') });
}

async function onApply(p: LoadoutPresetView): Promise<void> {
  await store.apply(p.id);
  if (store.lastError) {
    toast.push({ type: 'error', text: errText(store.lastError) });
    return;
  }
  const last = store.lastApply;
  if (last) {
    toast.push({
      type: 'success',
      text: t('loadoutPreset.appliedToast', {
        applied: last.applied.length,
        skipped: last.skipped.length,
      }),
    });
  }
}

async function onDelete(p: LoadoutPresetView): Promise<void> {
  await store.deletePreset(p.id);
  if (store.lastError)
    toast.push({ type: 'error', text: errText(store.lastError) });
}

async function onValidate(p: LoadoutPresetView): Promise<void> {
  const r = await store.validate(p.id);
  if (!r) return;
  toast.push({
    type: r.ok ? 'success' : 'error',
    text: r.ok
      ? t('loadoutPreset.validateOk')
      : t('loadoutPreset.validateFail', {
          code: r.errors[0]?.code ?? 'UNKNOWN',
        }),
  });
}

watch(
  () => auth.user,
  async (u) => {
    if (u) await refresh();
  },
);

onMounted(async () => {
  if (auth.user) await refresh();
});
</script>

<template>
  <AppShell>
    <section class="space-y-4 p-4">
      <header class="space-y-1">
        <h1 class="text-2xl font-bold">{{ t('loadoutPreset.title') }}</h1>
        <p class="text-sm text-gray-300">{{ t('loadoutPreset.subtitle') }}</p>
      </header>

      <!-- Type tabs -->
      <div
        class="flex flex-wrap gap-2"
        data-testid="loadout-preset-type-tabs"
      >
        <button
          v-for="type in TYPES"
          :key="type"
          type="button"
          class="rounded px-3 py-1 text-sm transition"
          :class="
            type === selectedType
              ? 'bg-amber-700 text-white'
              : 'bg-gray-800 text-gray-300 hover:bg-gray-700'
          "
          :data-testid="`loadout-preset-tab-${type}`"
          @click="selectedType = type"
        >
          {{ t(`loadoutPreset.presetType.${type}`) }}
        </button>
      </div>

      <p
        v-if="store.loading"
        class="rounded border border-gray-800 bg-gray-900 p-4 text-center text-gray-400"
      >
        {{ t('loadoutPreset.loading') }}
      </p>

      <!-- Empty state: save-current form -->
      <section
        v-else-if="!presetForType"
        class="rounded-lg border border-gray-800 bg-gray-900 p-4"
        data-testid="loadout-preset-empty"
      >
        <p class="text-sm text-gray-300">
          {{ t('loadoutPreset.noPreset') }}
        </p>
        <div class="mt-3 flex flex-wrap gap-2">
          <input
            v-model="newName"
            type="text"
            class="flex-1 rounded border border-gray-700 bg-gray-950 px-3 py-1 text-sm text-white focus:border-amber-600 focus:outline-none"
            :placeholder="t('loadoutPreset.namePlaceholder')"
            data-testid="loadout-preset-name-input"
          />
          <button
            type="button"
            class="rounded bg-amber-700 px-3 py-1 text-sm hover:bg-amber-600 disabled:opacity-50"
            :disabled="!newName.trim() || !!store.submitting"
            data-testid="loadout-preset-save-current"
            @click="onSaveCurrent"
          >
            {{ t('loadoutPreset.saveCurrent') }}
          </button>
        </div>
      </section>

      <!-- Preset card -->
      <article
        v-else
        class="rounded-lg border border-emerald-700 bg-gray-900 p-4"
        :data-testid="`loadout-preset-card-${presetForType.id}`"
      >
        <div class="flex items-center justify-between">
          <div>
            <h2 class="text-lg font-semibold">{{ presetForType.name }}</h2>
            <p class="text-xs text-gray-400">
              {{ t(`loadoutPreset.presetType.${presetForType.presetType}`) }}
            </p>
          </div>
          <span class="text-xs text-gray-500">
            {{
              t('loadoutPreset.slotCount', {
                n: presetForType.equipment.length,
              })
            }}
          </span>
        </div>

        <ul class="mt-3 space-y-1 text-xs">
          <li
            v-for="entry in presetForType.equipment"
            :key="entry.slot"
            class="rounded border border-gray-800 bg-gray-950 px-2 py-1"
            :data-testid="`loadout-preset-slot-${entry.slot}`"
          >
            <span class="font-semibold">
              {{ t(`loadoutPreset.slot.${entry.slot}`) }}
            </span>
            <span class="ml-2 text-gray-400">{{ entry.inventoryItemId }}</span>
          </li>
        </ul>

        <div class="mt-4 flex flex-wrap gap-2">
          <button
            type="button"
            class="rounded bg-yellow-600 px-3 py-1 text-sm hover:bg-yellow-500 disabled:opacity-50"
            :disabled="!!store.submitting"
            :data-testid="`loadout-preset-apply-${presetForType.id}`"
            @click="onApply(presetForType)"
          >
            {{ t('loadoutPreset.apply') }}
          </button>
          <button
            type="button"
            class="rounded bg-blue-700 px-3 py-1 text-sm hover:bg-blue-600 disabled:opacity-50"
            :disabled="!!store.submitting"
            :data-testid="`loadout-preset-validate-${presetForType.id}`"
            @click="onValidate(presetForType)"
          >
            {{ t('loadoutPreset.validate') }}
          </button>
          <button
            type="button"
            class="rounded border border-red-700 px-3 py-1 text-sm text-red-300 hover:bg-red-900/40 disabled:opacity-50"
            :disabled="!!store.submitting"
            :data-testid="`loadout-preset-delete-${presetForType.id}`"
            @click="onDelete(presetForType)"
          >
            {{ t('loadoutPreset.delete') }}
          </button>
        </div>
      </article>
    </section>
  </AppShell>
</template>
