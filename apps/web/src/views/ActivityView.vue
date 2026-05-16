<script setup lang="ts">
/**
 * M6 self audit log — consumer of GET /logs/me (PR #88).
 * Tab toggle currency/item, keyset pagination via "load more" button.
 */
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRouter } from 'vue-router';
import { itemByKey } from '@xuantoi/shared';
import { useAuthStore } from '@/stores/auth';
import { useGameStore } from '@/stores/game';
import {
  fetchLogsMe,
  type LogEntry,
  type LogEntryCurrency,
  type LogEntryItem,
  type LogType,
} from '@/api/logs';
import AppShell from '@/components/shell/AppShell.vue';
import XTPageEyebrow from '@/components/xianxia/XTPageEyebrow.vue';
import XTLuxHero from '@/components/xianxia/XTLuxHero.vue';
import SkeletonBlock from '@/components/ui/SkeletonBlock.vue';
import MButton from '@/components/ui/MButton.vue';
import { extractApiErrorCodeOrDefault } from '@/lib/apiError';

const { t, te } = useI18n();
const auth = useAuthStore();
const game = useGameStore();
const router = useRouter();

const tab = ref<LogType>('currency');
const entries = ref<LogEntry[]>([]);
const cursor = ref<string | null>(null);
const loading = ref(false);
const loadingMore = ref(false);
const error = ref<string | null>(null);

function reasonLabel(reason: string): string {
  const key = `activity.reasons.${reason}`;
  return te(key) ? t(key) : reason;
}

function isCurrency(e: LogEntry): e is LogEntryCurrency {
  return e.kind === 'CURRENCY';
}
function isItem(e: LogEntry): e is LogEntryItem {
  return e.kind === 'ITEM';
}

function deltaSign(delta: string | number): 'pos' | 'neg' | 'zero' {
  const s = typeof delta === 'string' ? delta : String(delta);
  if (s.startsWith('-')) return 'neg';
  if (s === '0' || s === '0n') return 'zero';
  return 'pos';
}

function formatDelta(delta: string | number): string {
  const s = typeof delta === 'string' ? delta : String(delta);
  if (s.startsWith('-')) return s;
  if (s === '0') return '0';
  return `+${s}`;
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString();
}

function itemName(key: string): string {
  return itemByKey(key)?.name ?? key;
}

async function load(reset = false): Promise<void> {
  if (reset) {
    loading.value = true;
    entries.value = [];
    cursor.value = null;
  } else {
    loadingMore.value = true;
  }
  error.value = null;
  try {
    const result = await fetchLogsMe({
      type: tab.value,
      limit: 20,
      cursor: cursor.value,
    });
    entries.value = entries.value.concat(result.entries);
    cursor.value = result.nextCursor;
  } catch (e) {
    const code = extractApiErrorCodeOrDefault(e, 'UNKNOWN');
    error.value = code;
  } finally {
    loading.value = false;
    loadingMore.value = false;
  }
}

async function selectTab(next: LogType): Promise<void> {
  if (tab.value === next) return;
  tab.value = next;
  await load(true);
}

onMounted(async () => {
  await auth.hydrate();
  if (!auth.isAuthenticated) {
    router.replace('/auth');
    return;
  }
  await game.fetchState().catch(() => null);
  game.bindSocket();
  await load(true);
});

const errorMessage = computed(() => {
  if (!error.value) return null;
  const k = `activity.errors.${error.value}`;
  return te(k) ? t(k) : t('activity.errors.UNKNOWN');
});
</script>

<template>
  <AppShell>
    <div class="max-w-3xl mx-auto space-y-4">
      <XTLuxHero
        eyebrow="GIẢI TIỆC THỊNH HỘI"
        label="Giải Tiệc Thịnh Hội"
        :title="t('activity.title')"
        :subtitle="t('activity.subtitle')"
        tone="jade"
        watermark-letter="G"
        breadcrumb="Nhiệm Vụ · Hoạt Động"
        test-id="activity-view-hero"
      >
        <XTPageEyebrow caps="GIẢI TIỆC THỊNH HỘI" label="Giải Tiệc Thịnh Hội" class="sr-only" />
      </XTLuxHero>

      <nav class="flex gap-2" data-testid="activity-tabs">
        <button
          type="button"
          class="px-3 py-1.5 rounded text-sm border"
          :class="
            tab === 'currency'
              ? 'bg-amber-700/40 border-amber-300/40 text-amber-100'
              : 'bg-ink-700/30 border-ink-300/20 text-ink-300 hover:text-ink-50'
          "
          data-testid="activity-tab-currency"
          @click="selectTab('currency')"
        >
          {{ t('activity.tabs.currency') }}
        </button>
        <button
          type="button"
          class="px-3 py-1.5 rounded text-sm border"
          :class="
            tab === 'item'
              ? 'bg-amber-700/40 border-amber-300/40 text-amber-100'
              : 'bg-ink-700/30 border-ink-300/20 text-ink-300 hover:text-ink-50'
          "
          data-testid="activity-tab-item"
          @click="selectTab('item')"
        >
          {{ t('activity.tabs.item') }}
        </button>
      </nav>

      <div v-if="loading" class="space-y-2" data-testid="activity-skeleton">
        <SkeletonBlock v-for="i in 6" :key="i" height="h-12" />
      </div>

      <div
        v-else-if="errorMessage"
        class="bg-rose-900/30 border border-rose-300/30 rounded p-4 text-sm text-rose-100"
        data-testid="activity-error"
      >
        {{ errorMessage }}
      </div>

      <div
        v-else-if="entries.length === 0"
        class="bg-ink-700/30 border border-ink-300/20 rounded p-6 text-center text-ink-300"
        data-testid="activity-empty"
      >
        {{ t('activity.empty') }}
      </div>

      <ul v-else class="space-y-1" data-testid="activity-list">
        <li
          v-for="e in entries"
          :key="e.id"
          class="bg-ink-700/30 border border-ink-300/20 rounded p-3 flex items-center justify-between gap-3"
          :data-testid="`activity-row-${e.id}`"
        >
          <div class="min-w-0">
            <div class="text-sm text-amber-100 truncate">
              {{ reasonLabel(e.reason) }}
              <template v-if="isItem(e)">
                <span class="text-ink-300"> · </span>
                <span class="text-ink-50">{{ itemName(e.itemKey) }}</span>
              </template>
              <template v-else-if="isCurrency(e)">
                <span class="text-ink-300"> · </span>
                <span class="text-ink-50">{{ t(`activity.currencyLabel.${e.currency}`) }}</span>
              </template>
            </div>
            <div class="text-xs text-ink-300">{{ formatTime(e.createdAt) }}</div>
          </div>
          <div
            class="text-sm font-mono whitespace-nowrap"
            :class="{
              'text-emerald-300': deltaSign(isCurrency(e) ? e.delta : e.qtyDelta) === 'pos',
              'text-rose-300': deltaSign(isCurrency(e) ? e.delta : e.qtyDelta) === 'neg',
              'text-ink-300': deltaSign(isCurrency(e) ? e.delta : e.qtyDelta) === 'zero',
            }"
            :data-testid="`activity-delta-${e.id}`"
          >
            {{ formatDelta(isCurrency(e) ? e.delta : e.qtyDelta) }}
          </div>
        </li>
      </ul>

      <div v-if="cursor && !loading" class="text-center pt-2">
        <MButton
          :disabled="loadingMore"
          :loading="loadingMore"
          data-testid="activity-load-more"
          @click="load(false)"
        >
          {{ t('activity.loadMore') }}
        </MButton>
      </div>
    </div>
  </AppShell>
</template>
