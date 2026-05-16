<script setup lang="ts">
/**
 * Phase 32.0 — Player Codex View (Tu Tiên Bách Khoa / Bestiary / Guidebook).
 *
 * Tabs:
 *   - Tổng quan: progress summary + type filter.
 *   - Danh sách: browse entries by type (filter ITEM/MONSTER/MAP/…).
 *   - Chi tiết: detail panel (kèm marketPrice link nếu có).
 */
import { onMounted, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useToastStore } from '@/stores/toast';
import {
  getCodexProgress,
  listCodex,
  getCodexDetail,
  type CodexEntryRow,
  type CodexDetailRow,
} from '@/api/codex';
import { extractApiErrorCodeOrDefault } from '@/lib/apiError';
import AppShell from '@/components/shell/AppShell.vue';
import XTPageEyebrow from '@/components/xianxia/XTPageEyebrow.vue';
import XTLuxHero from '@/components/xianxia/XTLuxHero.vue';
import { CODEX_ENTRY_TYPES, type CodexEntryType } from '@xuantoi/shared';

const { t } = useI18n();
const toast = useToastStore();

const loading = ref(false);
const progress = ref<{ overallPct: number; bestiaryPct: number; isComplete: boolean } | null>(null);
const entries = ref<CodexEntryRow[]>([]);
const total = ref(0);
const selectedType = ref<CodexEntryType | ''>('');
const selectedDetail = ref<CodexDetailRow | null>(null);

async function refresh() {
  loading.value = true;
  try {
    const [prog, list] = await Promise.all([
      getCodexProgress(),
      listCodex({ type: selectedType.value || undefined, limit: 50 }),
    ]);
    progress.value = prog;
    entries.value = list.items;
    total.value = list.total;
  } catch (e) {
    toast.push({ type: 'error', text: extractApiErrorCodeOrDefault(e, t('common.error')) });
  } finally {
    loading.value = false;
  }
}

async function openDetail(entryKey: string) {
  try {
    selectedDetail.value = await getCodexDetail(entryKey);
  } catch (e) {
    toast.push({ type: 'error', text: extractApiErrorCodeOrDefault(e, t('common.error')) });
  }
}

watch(selectedType, () => refresh());
onMounted(refresh);
</script>

<template>
  <AppShell>
    <div class="space-y-4 p-4">
      <XTLuxHero
        :eyebrow="t('luxHero.codex.eyebrow')"
        :label="t('luxHero.codex.label')"
        :title="t('codex.title')"
        :subtitle="t('codex.subtitle', '')"
        tone="jade"
        watermark-letter="T"
        :breadcrumb="t('luxHero.codex.breadcrumb')"
        test-id="codex-view-hero"
      >
        <XTPageEyebrow caps="THIÊN HẠNH NGHI PHỔ" label="Thiên Hạnh Nghi Phổ" class="sr-only" />
      </XTLuxHero>

      <!-- Progress summary -->
      <div v-if="progress" class="flex gap-4 text-sm bg-gray-800 rounded p-3">
        <div>{{ t('codex.overallProgress') }}: <span class="font-bold text-amber-300">{{ progress.overallPct }}%</span></div>
        <div>{{ t('codex.bestiaryProgress') }}: <span class="font-bold text-red-300">{{ progress.bestiaryPct }}%</span></div>
        <div v-if="progress.isComplete" class="text-green-400 font-bold">{{ t('codex.complete') }}</div>
      </div>

      <!-- Type filter -->
      <div class="flex gap-2 flex-wrap">
        <button
          class="px-2 py-1 rounded text-sm"
          :class="selectedType === '' ? 'bg-amber-600 text-white' : 'bg-gray-700 text-gray-300'"
          @click="selectedType = ''"
        >
          {{ t('common.all') }}
        </button>
        <button
          v-for="ty in CODEX_ENTRY_TYPES"
          :key="ty"
          class="px-2 py-1 rounded text-sm"
          :class="selectedType === ty ? 'bg-amber-600 text-white' : 'bg-gray-700 text-gray-300'"
          @click="selectedType = ty"
        >
          {{ ty }}
        </button>
      </div>

      <!-- Entry list -->
      <div v-if="loading" class="text-gray-400">{{ t('common.loading') }}</div>
      <div v-else class="grid grid-cols-1 md:grid-cols-2 gap-2">
        <div
          v-for="e in entries"
          :key="e.entryKey"
          class="bg-gray-800 rounded p-3 cursor-pointer hover:bg-gray-700 transition"
          @click="openDetail(e.entryKey)"
        >
          <div class="font-semibold">{{ e.displayName }}</div>
          <div class="text-xs text-gray-400">
            {{ e.type }} · {{ e.quality ?? '' }} · {{ e.discovered ? t('codex.discovered') : t('codex.undiscovered') }}
          </div>
        </div>
        <div v-if="entries.length === 0" class="col-span-2 text-gray-500 text-center py-4">
          {{ t('codex.noEntries') }}
        </div>
      </div>
      <div v-if="total > entries.length" class="text-xs text-gray-500">
        {{ t('codex.showingOf', { shown: entries.length, total }) }}
      </div>

      <!-- Detail panel (modal-like overlay) -->
      <div
        v-if="selectedDetail"
        class="fixed inset-0 bg-black/60 flex items-center justify-center z-50"
        @click.self="selectedDetail = null"
      >
        <div class="bg-gray-900 rounded-lg p-6 max-w-lg w-full max-h-[90vh] overflow-auto space-y-3">
          <div class="flex justify-between items-center">
            <h2 class="text-lg font-bold">{{ selectedDetail.entry.displayName }}</h2>
            <button class="text-gray-400 hover:text-white" @click="selectedDetail = null">✕</button>
          </div>
          <p class="text-sm text-gray-300">{{ selectedDetail.entry.description }}</p>
          <div class="text-xs text-gray-500 space-y-1">
            <div>{{ t('codex.type') }}: {{ selectedDetail.entry.type }}</div>
            <div v-if="selectedDetail.entry.quality">{{ t('codex.quality') }}: {{ selectedDetail.entry.quality }}</div>
            <div v-if="selectedDetail.entry.tier">{{ t('codex.tier') }}: {{ selectedDetail.entry.tier }}</div>
          </div>
          <div v-if="selectedDetail.marketPrice" class="bg-gray-800 rounded p-3 text-sm space-y-1">
            <div class="font-semibold text-amber-300">{{ t('codex.marketPriceTitle') }}</div>
            <div>{{ t('codex.avg24h') }}: {{ selectedDetail.marketPrice.avgPrice24h }}</div>
            <div>{{ t('codex.avg7d') }}: {{ selectedDetail.marketPrice.avgPrice7d }}</div>
            <div>{{ t('codex.vol24h') }}: {{ selectedDetail.marketPrice.volume24h }}</div>
          </div>
        </div>
      </div>
    </div>
  </AppShell>
</template>
