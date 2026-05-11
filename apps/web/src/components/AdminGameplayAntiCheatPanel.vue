<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useToastStore } from '@/stores/toast';
import {
  adminGameplayAntiCheatAck,
  adminGameplayAntiCheatList,
  adminGameplayAntiCheatResolve,
  adminGameplayAntiCheatScan,
  adminGameplayAntiCheatSummary,
  type GameplayAnomalyRow,
  type GameplayAnomalySeverity,
  type GameplayAnomalySource,
  type GameplayAnomalyStatus,
  type GameplayAnomalySummary,
  type GameplayAnomalyType,
  type GameplayScanSummaryView,
} from '@/api/admin';
import { extractApiErrorCodeOrDefault } from '@/lib/apiError';

/**
 * Phase 16.3 — Admin Gameplay Anti-cheat Panel.
 *
 * Hiển thị:
 *   - Summary cards: openCount / openCriticalCount / openWarnCount /
 *     openInfoCount / totalCount + latestDetected/Resolved.
 *   - Nút Run scan (confirm + toast).
 *   - Filter severity / status / type / source.
 *   - Table anomaly với Ack / Resolve.
 *
 * Detection-only: KHÔNG có button "ban" / "rollback" / "refund" trong
 * panel này. Admin sang panel khác (Users / Audit) để xử lý.
 *
 * Loading / error / empty state đầy đủ. Mọi action có confirm prompt.
 * Endpoint trả ok=false sẽ hiển thị toast lỗi với mã từ BE.
 *
 * Gates: tab này chỉ render khi role=ADMIN (parent AdminView guard). FE
 * KHÔNG gate role tự — BE mới là source of truth (`@RequireAdmin()`).
 */

const { t } = useI18n();
const toast = useToastStore();

const summary = ref<GameplayAnomalySummary | null>(null);
const anomalies = ref<GameplayAnomalyRow[]>([]);
const loadingSummary = ref(true);
const loadingAnomalies = ref(false);
const errorSummary = ref<string | null>(null);
const errorAnomalies = ref<string | null>(null);
const scanSubmitting = ref(false);
const lastScanSummary = ref<GameplayScanSummaryView | null>(null);

const filters = ref<{
  severity: string;
  status: string;
  type: string;
  source: string;
}>({
  severity: '',
  status: 'OPEN',
  type: '',
  source: '',
});

const SEVERITIES: readonly GameplayAnomalySeverity[] = [
  'INFO',
  'WARN',
  'CRITICAL',
];
const STATUSES: readonly GameplayAnomalyStatus[] = [
  'OPEN',
  'ACKNOWLEDGED',
  'RESOLVED',
];
const TYPES: readonly GameplayAnomalyType[] = [
  'EXP_GAIN_SPIKE',
  'CURRENCY_GAIN_SPIKE',
  'ITEM_GAIN_SPIKE',
  'DUNGEON_REWARD_FARM',
  'BOSS_REWARD_FARM',
  'MISSION_REWARD_FARM',
  'ARENA_REWARD_FARM',
  'TERRITORY_REWARD_SPIKE',
  'COMBAT_RESULT_MISMATCH',
  'REWARD_CAP_BYPASS_ATTEMPT',
];
const SOURCES: readonly GameplayAnomalySource[] = [
  'DUNGEON_RUN',
  'BOSS',
  'MISSION',
  'ARENA',
  'TERRITORY',
  'CURRENCY_LEDGER',
  'ITEM_LEDGER',
  'COMBAT_SNAPSHOT',
  'REWARD_CAP',
  'CULTIVATION',
  'OTHER',
];

onMounted(async () => {
  await Promise.all([refreshSummary(), refreshAnomalies()]);
});

async function refreshSummary(): Promise<void> {
  loadingSummary.value = true;
  errorSummary.value = null;
  try {
    summary.value = await adminGameplayAntiCheatSummary();
  } catch (e) {
    errorSummary.value = extractApiErrorCodeOrDefault(e, 'UNKNOWN');
  } finally {
    loadingSummary.value = false;
  }
}

async function refreshAnomalies(): Promise<void> {
  loadingAnomalies.value = true;
  errorAnomalies.value = null;
  try {
    const r = await adminGameplayAntiCheatList({
      severity: filters.value.severity
        ? (filters.value.severity as GameplayAnomalySeverity)
        : undefined,
      status: filters.value.status
        ? (filters.value.status as GameplayAnomalyStatus)
        : undefined,
      type: filters.value.type
        ? (filters.value.type as GameplayAnomalyType)
        : undefined,
      source: filters.value.source
        ? (filters.value.source as GameplayAnomalySource)
        : undefined,
      limit: 50,
    });
    anomalies.value = r.items;
  } catch (e) {
    errorAnomalies.value = extractApiErrorCodeOrDefault(e, 'UNKNOWN');
  } finally {
    loadingAnomalies.value = false;
  }
}

async function runScan(): Promise<void> {
  if (!confirm(t('admin.gameplayAntiCheat.confirmScan'))) return;
  scanSubmitting.value = true;
  try {
    lastScanSummary.value = await adminGameplayAntiCheatScan();
    toast.push({
      type: 'success',
      text: t('admin.gameplayAntiCheat.scanDone', {
        created: lastScanSummary.value.totalCreated,
        skipped: lastScanSummary.value.totalSkipped,
        errored: lastScanSummary.value.totalErrored,
      }),
    });
    await Promise.all([refreshSummary(), refreshAnomalies()]);
  } catch (e) {
    toast.push({
      type: 'error',
      text: extractApiErrorCodeOrDefault(e, 'UNKNOWN'),
    });
  } finally {
    scanSubmitting.value = false;
  }
}

async function ackAnomaly(id: string): Promise<void> {
  if (!confirm(t('admin.gameplayAntiCheat.confirmAck'))) return;
  try {
    await adminGameplayAntiCheatAck(id);
    toast.push({ type: 'success', text: t('admin.gameplayAntiCheat.ackDone') });
    await Promise.all([refreshSummary(), refreshAnomalies()]);
  } catch (e) {
    toast.push({
      type: 'error',
      text: extractApiErrorCodeOrDefault(e, 'UNKNOWN'),
    });
  }
}

async function resolveAnomaly(id: string): Promise<void> {
  if (!confirm(t('admin.gameplayAntiCheat.confirmResolve'))) return;
  const note = window.prompt(t('admin.gameplayAntiCheat.confirmResolve')) ?? undefined;
  // Cancel prompt (returns null) → bỏ ghi chú. Empty string OK.
  try {
    await adminGameplayAntiCheatResolve(id, note);
    toast.push({
      type: 'success',
      text: t('admin.gameplayAntiCheat.resolveDone'),
    });
    await Promise.all([refreshSummary(), refreshAnomalies()]);
  } catch (e) {
    toast.push({
      type: 'error',
      text: extractApiErrorCodeOrDefault(e, 'UNKNOWN'),
    });
  }
}

function severityClass(s: string): string {
  if (s === 'CRITICAL') return 'text-rose-300 font-bold';
  if (s === 'WARN') return 'text-amber-300';
  return 'text-ink-300';
}

function statusClass(s: string): string {
  if (s === 'OPEN') return 'text-rose-300';
  if (s === 'ACKNOWLEDGED') return 'text-amber-300';
  return 'text-emerald-300';
}

const showEmpty = computed(
  () =>
    !loadingAnomalies.value &&
    !errorAnomalies.value &&
    anomalies.value.length === 0,
);
</script>

<template>
  <div class="space-y-4" data-testid="admin-gameplay-anticheat-panel">
    <!-- Header + scan button -->
    <section class="border border-ink-300/30 rounded p-3 space-y-2">
      <header class="flex items-center justify-between gap-2">
        <div>
          <h3 class="text-lg font-bold">
            {{ t('admin.gameplayAntiCheat.title') }}
          </h3>
          <p class="text-xs text-ink-300">
            {{ t('admin.gameplayAntiCheat.subtitle') }}
          </p>
        </div>
        <button
          class="px-3 py-1 bg-amber-500/80 text-ink-900 rounded text-sm disabled:opacity-50"
          :disabled="scanSubmitting"
          data-testid="admin-gameplay-anticheat-scan-btn"
          @click="runScan"
        >
          {{
            scanSubmitting
              ? t('admin.gameplayAntiCheat.loading')
              : t('admin.gameplayAntiCheat.scanBtn')
          }}
        </button>
      </header>

      <!-- Summary cards -->
      <p v-if="loadingSummary" class="text-sm text-ink-300">
        {{ t('admin.gameplayAntiCheat.loading') }}
      </p>
      <p v-else-if="errorSummary" class="text-sm text-rose-300">
        {{ t('admin.gameplayAntiCheat.errorPrefix') }}{{ errorSummary }}
      </p>
      <div
        v-else-if="summary"
        class="grid grid-cols-2 sm:grid-cols-4 gap-2 text-sm"
        data-testid="admin-gameplay-anticheat-summary"
      >
        <div class="bg-ink-700/30 border border-ink-300/20 rounded p-2">
          <div class="text-xs text-ink-300">
            {{ t('admin.gameplayAntiCheat.summary.open') }}
          </div>
          <div class="text-xl font-bold">{{ summary.openCount }}</div>
        </div>
        <div class="bg-ink-700/30 border border-rose-300/40 rounded p-2">
          <div class="text-xs text-rose-300">
            {{ t('admin.gameplayAntiCheat.summary.critical') }}
          </div>
          <div class="text-xl font-bold">{{ summary.openCriticalCount }}</div>
        </div>
        <div class="bg-ink-700/30 border border-amber-300/40 rounded p-2">
          <div class="text-xs text-amber-300">
            {{ t('admin.gameplayAntiCheat.summary.warn') }}
          </div>
          <div class="text-xl font-bold">{{ summary.openWarnCount }}</div>
        </div>
        <div class="bg-ink-700/30 border border-ink-300/20 rounded p-2">
          <div class="text-xs text-ink-300">
            {{ t('admin.gameplayAntiCheat.summary.info') }}
          </div>
          <div class="text-xl font-bold">{{ summary.openInfoCount }}</div>
        </div>
        <div class="bg-ink-700/30 border border-ink-300/20 rounded p-2">
          <div class="text-xs text-ink-300">
            {{ t('admin.gameplayAntiCheat.summary.total') }}
          </div>
          <div class="text-base">{{ summary.totalCount }}</div>
        </div>
        <div class="bg-ink-700/30 border border-ink-300/20 rounded p-2">
          <div class="text-xs text-ink-300">
            {{ t('admin.gameplayAntiCheat.summary.latestCreatedAt') }}
          </div>
          <div class="text-xs">
            {{
              summary.latestCreatedAt ||
                t('admin.gameplayAntiCheat.summary.none')
            }}
          </div>
        </div>
        <div class="bg-ink-700/30 border border-ink-300/20 rounded p-2">
          <div class="text-xs text-ink-300">
            {{ t('admin.gameplayAntiCheat.summary.latestResolvedAt') }}
          </div>
          <div class="text-xs">
            {{
              summary.latestResolvedAt ||
                t('admin.gameplayAntiCheat.summary.none')
            }}
          </div>
        </div>
      </div>
    </section>

    <!-- Filter + Table -->
    <section
      class="border border-ink-300/30 rounded p-3 space-y-2"
      data-testid="admin-gameplay-anticheat-table-section"
    >
      <header class="flex flex-wrap gap-2 items-center text-sm">
        <select
          v-model="filters.severity"
          class="bg-ink-700 border border-ink-300/30 rounded px-2 py-1"
          data-testid="admin-gameplay-anticheat-filter-severity"
          @change="refreshAnomalies"
        >
          <option value="">
            {{ t('admin.gameplayAntiCheat.filter.severityAll') }}
          </option>
          <option v-for="s in SEVERITIES" :key="s" :value="s">{{ s }}</option>
        </select>
        <select
          v-model="filters.status"
          class="bg-ink-700 border border-ink-300/30 rounded px-2 py-1"
          data-testid="admin-gameplay-anticheat-filter-status"
          @change="refreshAnomalies"
        >
          <option value="">
            {{ t('admin.gameplayAntiCheat.filter.statusAll') }}
          </option>
          <option v-for="s in STATUSES" :key="s" :value="s">{{ s }}</option>
        </select>
        <select
          v-model="filters.type"
          class="bg-ink-700 border border-ink-300/30 rounded px-2 py-1"
          data-testid="admin-gameplay-anticheat-filter-type"
          @change="refreshAnomalies"
        >
          <option value="">
            {{ t('admin.gameplayAntiCheat.filter.typeAll') }}
          </option>
          <option v-for="ty in TYPES" :key="ty" :value="ty">{{ ty }}</option>
        </select>
        <select
          v-model="filters.source"
          class="bg-ink-700 border border-ink-300/30 rounded px-2 py-1"
          data-testid="admin-gameplay-anticheat-filter-source"
          @change="refreshAnomalies"
        >
          <option value="">
            {{ t('admin.gameplayAntiCheat.filter.sourceAll') }}
          </option>
          <option v-for="src in SOURCES" :key="src" :value="src">
            {{ src }}
          </option>
        </select>
      </header>

      <p
        v-if="loadingAnomalies"
        class="text-sm text-ink-300"
        data-testid="admin-gameplay-anticheat-loading"
      >
        {{ t('admin.gameplayAntiCheat.loading') }}
      </p>
      <p
        v-else-if="errorAnomalies"
        class="text-sm text-rose-300"
        data-testid="admin-gameplay-anticheat-error"
      >
        {{ t('admin.gameplayAntiCheat.errorPrefix') }}{{ errorAnomalies }}
      </p>
      <p
        v-else-if="showEmpty"
        class="text-sm text-ink-300"
        data-testid="admin-gameplay-anticheat-empty"
      >
        {{ t('admin.gameplayAntiCheat.empty') }}
      </p>
      <div v-else class="overflow-x-auto">
        <table
          class="w-full text-sm"
          data-testid="admin-gameplay-anticheat-table"
        >
          <thead>
            <tr class="text-left text-ink-300">
              <th class="px-2 py-1">
                {{ t('admin.gameplayAntiCheat.table.type') }}
              </th>
              <th class="px-2 py-1">
                {{ t('admin.gameplayAntiCheat.table.severity') }}
              </th>
              <th class="px-2 py-1">
                {{ t('admin.gameplayAntiCheat.table.status') }}
              </th>
              <th class="px-2 py-1">
                {{ t('admin.gameplayAntiCheat.table.source') }}
              </th>
              <th class="px-2 py-1">
                {{ t('admin.gameplayAntiCheat.table.character') }}
              </th>
              <th class="px-2 py-1">
                {{ t('admin.gameplayAntiCheat.table.windowKey') }}
              </th>
              <th class="px-2 py-1">
                {{ t('admin.gameplayAntiCheat.table.createdAt') }}
              </th>
              <th class="px-2 py-1">
                {{ t('admin.gameplayAntiCheat.table.actions') }}
              </th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="a in anomalies"
              :key="a.id"
              class="border-t border-ink-300/10"
              data-testid="admin-gameplay-anticheat-row"
            >
              <td class="px-2 py-1 font-mono text-xs">{{ a.type }}</td>
              <td class="px-2 py-1" :class="severityClass(a.severity)">
                {{ a.severity }}
              </td>
              <td class="px-2 py-1" :class="statusClass(a.status)">
                {{ a.status }}
              </td>
              <td class="px-2 py-1 font-mono text-xs">{{ a.source }}</td>
              <td class="px-2 py-1 font-mono text-xs">
                {{ a.characterId ?? '-' }}
              </td>
              <td class="px-2 py-1 font-mono text-xs">{{ a.windowKey }}</td>
              <td class="px-2 py-1 text-xs">{{ a.createdAt }}</td>
              <td class="px-2 py-1">
                <button
                  v-if="a.status === 'OPEN'"
                  class="px-2 py-0.5 text-xs bg-amber-500/60 text-ink-900 rounded mr-1"
                  data-testid="admin-gameplay-anticheat-ack-btn"
                  @click="ackAnomaly(a.id)"
                >
                  {{ t('admin.gameplayAntiCheat.ack') }}
                </button>
                <button
                  v-if="a.status !== 'RESOLVED'"
                  class="px-2 py-0.5 text-xs bg-emerald-500/60 text-ink-900 rounded"
                  data-testid="admin-gameplay-anticheat-resolve-btn"
                  @click="resolveAnomaly(a.id)"
                >
                  {{ t('admin.gameplayAntiCheat.resolve') }}
                </button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  </div>
</template>
