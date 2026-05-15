<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useAuthStore } from '@/stores/auth';
import { useToastStore } from '@/stores/toast';
import AppShell from '@/components/shell/AppShell.vue';
import XTHeroEyebrow from '@/components/xianxia/XTHeroEyebrow.vue';
import {
  fetchInventoryQol,
  lockInventoryBatch,
  lockInventoryItem,
  unlockInventoryItem,
  type InventoryQolView,
  type InventoryView,
} from '@/api/inventory';

/**
 * Phase 34.3 — Inventory auto-sort / lock view.
 *
 * Server-side sort + filter via `/inventory/qol/v1/items?sort=...&bucket=...&search=...`.
 * Bulk select + bulk lock/unlock. Locked items show a lock icon and cannot
 * be sold/disassembled/used (enforced server-side; UI mirrors state).
 */

const SORT_KEYS = [
  'default',
  'quality_desc',
  'quality_asc',
  'kind',
  'equipped_first',
  'locked_first',
  'newest',
  'oldest',
] as const;

const BUCKETS = [
  'all',
  'equipment',
  'artifact',
  'consumable',
  'material',
  'skill_book',
  'quest',
  'locked',
] as const;

const auth = useAuthStore();
const toast = useToastStore();
const { t, locale } = useI18n();

const view = ref<InventoryQolView | null>(null);
const sort = ref<(typeof SORT_KEYS)[number]>('default');
const bucket = ref<(typeof BUCKETS)[number]>('all');
const search = ref('');
const loading = ref(false);
const submitting = ref(false);
const lastError = ref<string | null>(null);
const selectedIds = ref<Set<string>>(new Set());

const isVi = computed(() => locale.value === 'vi');

function pickName(it: InventoryView): string {
  return isVi.value ? it.item.name : it.item.name;
}

function errText(code: string | null): string {
  if (!code) return '';
  const key = `inventoryAutoSort.error.${code}`;
  const text = t(key);
  return text === key ? t('inventoryAutoSort.error.UNKNOWN_ERROR') : text;
}

async function refresh(): Promise<void> {
  loading.value = true;
  lastError.value = null;
  try {
    view.value = await fetchInventoryQol({
      sort: sort.value,
      bucket: bucket.value,
      search: search.value.trim() || undefined,
    });
  } catch (e) {
    lastError.value =
      (e as { code?: string }).code ??
      (e as { error?: { code?: string } }).error?.code ??
      'UNKNOWN_ERROR';
    toast.push({ type: 'error', text: errText(lastError.value) });
  } finally {
    loading.value = false;
  }
}

function toggleSelected(id: string): void {
  const next = new Set(selectedIds.value);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  selectedIds.value = next;
}

function clearSelection(): void {
  selectedIds.value = new Set();
}

async function onLockOne(it: InventoryView): Promise<void> {
  if (submitting.value) return;
  submitting.value = true;
  try {
    if (it.locked) await unlockInventoryItem(it.id);
    else await lockInventoryItem(it.id);
    await refresh();
  } catch (e) {
    const code =
      (e as { code?: string }).code ??
      (e as { error?: { code?: string } }).error?.code ??
      'UNKNOWN_ERROR';
    toast.push({ type: 'error', text: errText(code) });
  } finally {
    submitting.value = false;
  }
}

async function onBulkLock(lock: boolean): Promise<void> {
  if (submitting.value) return;
  const ids = Array.from(selectedIds.value);
  if (ids.length === 0) return;
  submitting.value = true;
  try {
    const result = await lockInventoryBatch(ids, lock);
    clearSelection();
    await refresh();
    toast.push({
      type: 'success',
      text: lock
        ? t('inventoryAutoSort.bulkLockedToast', { n: result.changed })
        : t('inventoryAutoSort.bulkUnlockedToast', { n: result.changed }),
    });
  } catch (e) {
    const code =
      (e as { code?: string }).code ??
      (e as { error?: { code?: string } }).error?.code ??
      'UNKNOWN_ERROR';
    toast.push({ type: 'error', text: errText(code) });
  } finally {
    submitting.value = false;
  }
}

watch([sort, bucket], () => {
  refresh();
});

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
        <XTHeroEyebrow han="乾坤整资" label="Càn Khôn Chỉnh Tư" />
        <h1 class="text-2xl font-bold mt-1">{{ t('inventoryAutoSort.title') }}</h1>
        <p class="text-sm text-gray-300">
          {{ t('inventoryAutoSort.subtitle') }}
        </p>
      </header>

      <!-- Filter / sort bar -->
      <div
        class="flex flex-wrap items-center gap-2"
        data-testid="inventory-auto-sort-controls"
      >
        <select
          v-model="sort"
          class="rounded border border-gray-700 bg-gray-950 px-2 py-1 text-sm text-white"
          data-testid="inventory-auto-sort-sort-select"
        >
          <option v-for="k in SORT_KEYS" :key="k" :value="k">
            {{ t(`inventoryAutoSort.sort.${k}`) }}
          </option>
        </select>
        <select
          v-model="bucket"
          class="rounded border border-gray-700 bg-gray-950 px-2 py-1 text-sm text-white"
          data-testid="inventory-auto-sort-bucket-select"
        >
          <option v-for="b in BUCKETS" :key="b" :value="b">
            {{ t(`inventoryAutoSort.bucket.${b}`) }}
          </option>
        </select>
        <input
          v-model="search"
          type="text"
          :placeholder="t('inventoryAutoSort.searchPlaceholder')"
          class="flex-1 rounded border border-gray-700 bg-gray-950 px-2 py-1 text-sm text-white"
          data-testid="inventory-auto-sort-search"
          @keydown.enter="refresh"
        />
        <button
          type="button"
          class="rounded bg-amber-700 px-3 py-1 text-sm hover:bg-amber-600 disabled:opacity-50"
          :disabled="loading"
          data-testid="inventory-auto-sort-apply"
          @click="refresh"
        >
          {{ t('inventoryAutoSort.applyFilters') }}
        </button>
      </div>

      <!-- Bulk action bar -->
      <div
        v-if="selectedIds.size > 0"
        class="flex flex-wrap items-center gap-2 rounded border border-amber-700 bg-amber-900/20 p-2"
        data-testid="inventory-auto-sort-bulk-bar"
      >
        <span class="text-sm text-amber-200">
          {{
            t('inventoryAutoSort.selected', { n: selectedIds.size })
          }}
        </span>
        <button
          type="button"
          class="rounded bg-yellow-700 px-3 py-1 text-sm hover:bg-yellow-600 disabled:opacity-50"
          :disabled="submitting"
          data-testid="inventory-auto-sort-bulk-lock"
          @click="onBulkLock(true)"
        >
          {{ t('inventoryAutoSort.bulkLock') }}
        </button>
        <button
          type="button"
          class="rounded bg-gray-700 px-3 py-1 text-sm hover:bg-gray-600 disabled:opacity-50"
          :disabled="submitting"
          data-testid="inventory-auto-sort-bulk-unlock"
          @click="onBulkLock(false)"
        >
          {{ t('inventoryAutoSort.bulkUnlock') }}
        </button>
        <button
          type="button"
          class="rounded border border-gray-700 px-3 py-1 text-sm text-gray-300 hover:bg-gray-800"
          data-testid="inventory-auto-sort-bulk-clear"
          @click="clearSelection"
        >
          {{ t('inventoryAutoSort.clearSelection') }}
        </button>
      </div>

      <!-- Item grid -->
      <p
        v-if="loading"
        class="rounded border border-gray-800 bg-gray-900 p-4 text-center text-gray-400"
      >
        {{ t('inventoryAutoSort.loading') }}
      </p>
      <p
        v-else-if="!view || view.items.length === 0"
        class="rounded border border-gray-800 bg-gray-900 p-4 text-center text-gray-400"
        data-testid="inventory-auto-sort-empty"
      >
        {{ t('inventoryAutoSort.empty') }}
      </p>
      <div
        v-else
        class="grid grid-cols-1 gap-2 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4"
        data-testid="inventory-auto-sort-grid"
      >
        <article
          v-for="it in view.items"
          :key="it.id"
          class="rounded border bg-gray-900 p-2 text-sm"
          :class="
            selectedIds.has(it.id)
              ? 'border-amber-500'
              : 'border-gray-800'
          "
          :data-testid="`inventory-auto-sort-item-${it.id}`"
        >
          <div class="flex items-start justify-between gap-2">
            <label class="flex flex-1 items-start gap-2">
              <input
                type="checkbox"
                :checked="selectedIds.has(it.id)"
                class="mt-1"
                :data-testid="`inventory-auto-sort-checkbox-${it.id}`"
                @change="toggleSelected(it.id)"
              />
              <div class="flex-1">
                <p class="font-semibold">{{ pickName(it) }}</p>
                <p class="text-xs text-gray-400">{{ it.item.quality }}</p>
              </div>
            </label>
            <button
              type="button"
              class="text-lg"
              :class="it.locked ? 'text-amber-400' : 'text-gray-500'"
              :data-testid="`inventory-auto-sort-lock-${it.id}`"
              :disabled="submitting"
              @click="onLockOne(it)"
            >
              <span v-if="it.locked">🔒</span>
              <span v-else>🔓</span>
            </button>
          </div>
          <div class="mt-1 flex items-center justify-between text-xs text-gray-400">
            <span>x{{ it.qty }}</span>
            <span v-if="it.equippedSlot">
              {{ t(`inventoryAutoSort.slot.${it.equippedSlot}`) }}
            </span>
          </div>
        </article>
      </div>

      <p
        v-if="view"
        class="text-xs text-gray-500"
        data-testid="inventory-auto-sort-counts"
      >
        {{
          t('inventoryAutoSort.counts', {
            filtered: view.filtered,
            total: view.total,
          })
        }}
      </p>
    </section>
  </AppShell>
</template>
