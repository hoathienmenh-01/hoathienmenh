<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useToastStore } from '@/stores/toast';
import {
  adminMarketAbuseAck,
  adminMarketAbuseList,
  adminMarketAbuseResolve,
  adminMarketAbuseScan,
  adminMarketAbuseSummary,
  type MarketAbuseRow,
  type MarketAbuseScanSummaryView,
  type MarketAbuseSeverity,
  type MarketAbuseSource,
  type MarketAbuseStatus,
  type MarketAbuseSummary,
  type MarketAbuseType,
} from '@/api/admin';
import { extractApiErrorCodeOrDefault } from '@/lib/apiError';

/**
 * Phase 16.4 — Admin Market Trade Abuse Panel.
 *
 * Hiển thị:
 *   - Summary cards: openCount / openCriticalCount / openWarnCount /
 *     openInfoCount / totalCount + latestCreated/Resolved.
 *   - Nút Run scan (confirm + toast).
 *   - Filter severity / status / type / source / itemKey / character.
 *   - Table anomaly với Ack / Resolve.
 *
 * Detection-only: KHÔNG có button "ban" / "rollback" / "refund". Admin
 * sang panel khác (Users / Listings) để xử lý.
 *
 * Loading / error / empty state đầy đủ. Mọi action có confirm prompt.
 * Endpoint trả ok=false sẽ hiển thị toast lỗi với mã từ BE.
 *
 * Gates: tab này chỉ render khi role=ADMIN (parent AdminView guard). FE
 * KHÔNG gate role tự — BE mới là source of truth (`@RequireAdmin()`).
 */

const { t } = useI18n();
const toast = useToastStore();

const summary = ref<MarketAbuseSummary | null>(null);
const anomalies = ref<MarketAbuseRow[]>([]);
const loadingSummary = ref(true);
const loadingAnomalies = ref(false);
const errorSummary = ref<string | null>(null);
const errorAnomalies = ref<string | null>(null);
const scanSubmitting = ref(false);
const lastScanSummary = ref<MarketAbuseScanSummaryView | null>(null);

const filters = ref<{
  severity: string;
  status: string;
  type: string;
  source: string;
  itemKey: string;
  sellerCharacterId: string;
  buyerCharacterId: string;
}>({
  severity: '',
  status: 'OPEN',
  type: '',
  source: '',
  itemKey: '',
  sellerCharacterId: '',
  buyerCharacterId: '',
});

const SEVERITIES: readonly MarketAbuseSeverity[] = [
  'INFO',
  'WARN',
  'CRITICAL',
];
const STATUSES: readonly MarketAbuseStatus[] = [
  'OPEN',
  'ACKNOWLEDGED',
  'RESOLVED',
];
const TYPES: readonly MarketAbuseType[] = [
  'PRICE_EXTREME_LOW',
  'PRICE_EXTREME_HIGH',
  'REPEATED_BUYER_SELLER_PAIR',
  'LISTING_SPAM',
  'MARKET_VOLUME_SPIKE',
  'UNKNOWN_REFERENCE_PRICE',
];
const SOURCES: readonly MarketAbuseSource[] = [
  'LISTING_CREATE',
  'LISTING_BUY',
  'SCAN_BATCH',
  'OTHER',
];

onMounted(async () => {
  await Promise.all([refreshSummary(), refreshAnomalies()]);
});

async function refreshSummary(): Promise<void> {
  loadingSummary.value = true;
  errorSummary.value = null;
  try {
    summary.value = await adminMarketAbuseSummary();
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
    const r = await adminMarketAbuseList({
      severity: filters.value.severity
        ? (filters.value.severity as MarketAbuseSeverity)
        : undefined,
      status: filters.value.status
        ? (filters.value.status as MarketAbuseStatus)
        : undefined,
      type: filters.value.type
        ? (filters.value.type as MarketAbuseType)
        : undefined,
      source: filters.value.source
        ? (filters.value.source as MarketAbuseSource)
        : undefined,
      itemKey: filters.value.itemKey || undefined,
      sellerCharacterId: filters.value.sellerCharacterId || undefined,
      buyerCharacterId: filters.value.buyerCharacterId || undefined,
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
  if (!confirm(t('admin.marketAbuse.confirmScan'))) return;
  scanSubmitting.value = true;
  try {
    lastScanSummary.value = await adminMarketAbuseScan();
    toast.push({
      type: 'success',
      text: t('admin.marketAbuse.scanDone', {
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
  if (!confirm(t('admin.marketAbuse.confirmAck'))) return;
  try {
    await adminMarketAbuseAck(id);
    toast.push({ type: 'success', text: t('admin.marketAbuse.ackDone') });
    await Promise.all([refreshSummary(), refreshAnomalies()]);
  } catch (e) {
    toast.push({
      type: 'error',
      text: extractApiErrorCodeOrDefault(e, 'UNKNOWN'),
    });
  }
}

async function resolveAnomaly(id: string): Promise<void> {
  if (!confirm(t('admin.marketAbuse.confirmResolve'))) return;
  const note = window.prompt(t('admin.marketAbuse.confirmResolve')) ?? undefined;
  // Cancel prompt (returns null) → bỏ ghi chú. Empty string OK.
  try {
    await adminMarketAbuseResolve(id, note);
    toast.push({
      type: 'success',
      text: t('admin.marketAbuse.resolveDone'),
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
  <div class="space-y-4" data-testid="admin-market-abuse-panel">
    <!-- Header + scan button -->
    <section class="border border-ink-300/30 rounded p-3 space-y-2">
      <header class="flex items-center justify-between gap-2">
        <div>
          <h3 class="text-lg font-bold">
            {{ t('admin.marketAbuse.title') }}
          </h3>
          <p class="text-xs text-ink-300">
            {{ t('admin.marketAbuse.subtitle') }}
          </p>
        </div>
        <button
          class="px-3 py-1 bg-amber-500/80 text-ink-900 rounded text-sm disabled:opacity-50"
          :disabled="scanSubmitting"
          data-testid="admin-market-abuse-scan-btn"
          @click="runScan"
        >
          {{
            scanSubmitting
              ? t('admin.marketAbuse.loading')
              : t('admin.marketAbuse.scanBtn')
          }}
        </button>
      </header>

      <!-- Summary cards -->
      <p v-if="loadingSummary" class="text-sm text-ink-300">
        {{ t('admin.marketAbuse.loading') }}
      </p>
      <p v-else-if="errorSummary" class="text-sm text-rose-300">
        {{ t('admin.marketAbuse.errorPrefix') }}{{ errorSummary }}
      </p>
      <div
        v-else-if="summary"
        class="grid grid-cols-2 sm:grid-cols-4 gap-2 text-sm"
        data-testid="admin-market-abuse-summary"
      >
        <div class="bg-ink-700/30 border border-ink-300/20 rounded p-2">
          <div class="text-xs text-ink-300">
            {{ t('admin.marketAbuse.summary.open') }}
          </div>
          <div class="text-xl font-bold">{{ summary.openCount }}</div>
        </div>
        <div class="bg-ink-700/30 border border-rose-300/40 rounded p-2">
          <div class="text-xs text-rose-300">
            {{ t('admin.marketAbuse.summary.critical') }}
          </div>
          <div class="text-xl font-bold">{{ summary.openCriticalCount }}</div>
        </div>
        <div class="bg-ink-700/30 border border-amber-300/40 rounded p-2">
          <div class="text-xs text-amber-300">
            {{ t('admin.marketAbuse.summary.warn') }}
          </div>
          <div class="text-xl font-bold">{{ summary.openWarnCount }}</div>
        </div>
        <div class="bg-ink-700/30 border border-ink-300/20 rounded p-2">
          <div class="text-xs text-ink-300">
            {{ t('admin.marketAbuse.summary.info') }}
          </div>
          <div class="text-xl font-bold">{{ summary.openInfoCount }}</div>
        </div>
        <div class="bg-ink-700/30 border border-ink-300/20 rounded p-2">
          <div class="text-xs text-ink-300">
            {{ t('admin.marketAbuse.summary.total') }}
          </div>
          <div class="text-base">{{ summary.totalCount }}</div>
        </div>
        <div class="bg-ink-700/30 border border-ink-300/20 rounded p-2">
          <div class="text-xs text-ink-300">
            {{ t('admin.marketAbuse.summary.latestCreatedAt') }}
          </div>
          <div class="text-xs">
            {{
              summary.latestCreatedAt ||
                t('admin.marketAbuse.summary.none')
            }}
          </div>
        </div>
        <div class="bg-ink-700/30 border border-ink-300/20 rounded p-2">
          <div class="text-xs text-ink-300">
            {{ t('admin.marketAbuse.summary.latestResolvedAt') }}
          </div>
          <div class="text-xs">
            {{
              summary.latestResolvedAt ||
                t('admin.marketAbuse.summary.none')
            }}
          </div>
        </div>
      </div>
    </section>

    <!-- Filter + Table -->
    <section
      class="border border-ink-300/30 rounded p-3 space-y-2"
      data-testid="admin-market-abuse-table-section"
    >
      <header class="flex flex-wrap gap-2 items-center text-sm">
        <select
          v-model="filters.severity"
          class="bg-ink-700 border border-ink-300/30 rounded px-2 py-1"
          data-testid="admin-market-abuse-filter-severity"
          @change="refreshAnomalies"
        >
          <option value="">
            {{ t('admin.marketAbuse.filter.severityAll') }}
          </option>
          <option v-for="s in SEVERITIES" :key="s" :value="s">{{ s }}</option>
        </select>
        <select
          v-model="filters.status"
          class="bg-ink-700 border border-ink-300/30 rounded px-2 py-1"
          data-testid="admin-market-abuse-filter-status"
          @change="refreshAnomalies"
        >
          <option value="">
            {{ t('admin.marketAbuse.filter.statusAll') }}
          </option>
          <option v-for="s in STATUSES" :key="s" :value="s">{{ s }}</option>
        </select>
        <select
          v-model="filters.type"
          class="bg-ink-700 border border-ink-300/30 rounded px-2 py-1"
          data-testid="admin-market-abuse-filter-type"
          @change="refreshAnomalies"
        >
          <option value="">
            {{ t('admin.marketAbuse.filter.typeAll') }}
          </option>
          <option v-for="ty in TYPES" :key="ty" :value="ty">{{ ty }}</option>
        </select>
        <select
          v-model="filters.source"
          class="bg-ink-700 border border-ink-300/30 rounded px-2 py-1"
          data-testid="admin-market-abuse-filter-source"
          @change="refreshAnomalies"
        >
          <option value="">
            {{ t('admin.marketAbuse.filter.sourceAll') }}
          </option>
          <option v-for="src in SOURCES" :key="src" :value="src">
            {{ src }}
          </option>
        </select>
        <input
          v-model.trim="filters.itemKey"
          class="bg-ink-700 border border-ink-300/30 rounded px-2 py-1"
          :placeholder="t('admin.marketAbuse.filter.itemKeyPlaceholder')"
          data-testid="admin-market-abuse-filter-itemkey"
          @change="refreshAnomalies"
        />
        <input
          v-model.trim="filters.sellerCharacterId"
          class="bg-ink-700 border border-ink-300/30 rounded px-2 py-1"
          :placeholder="t('admin.marketAbuse.filter.sellerPlaceholder')"
          data-testid="admin-market-abuse-filter-seller"
          @change="refreshAnomalies"
        />
        <input
          v-model.trim="filters.buyerCharacterId"
          class="bg-ink-700 border border-ink-300/30 rounded px-2 py-1"
          :placeholder="t('admin.marketAbuse.filter.buyerPlaceholder')"
          data-testid="admin-market-abuse-filter-buyer"
          @change="refreshAnomalies"
        />
      </header>

      <p
        v-if="loadingAnomalies"
        class="text-sm text-ink-300"
        data-testid="admin-market-abuse-loading"
      >
        {{ t('admin.marketAbuse.loading') }}
      </p>
      <p
        v-else-if="errorAnomalies"
        class="text-sm text-rose-300"
        data-testid="admin-market-abuse-error"
      >
        {{ t('admin.marketAbuse.errorPrefix') }}{{ errorAnomalies }}
      </p>
      <p
        v-else-if="showEmpty"
        class="text-sm text-ink-300"
        data-testid="admin-market-abuse-empty"
      >
        {{ t('admin.marketAbuse.empty') }}
      </p>
      <div v-else class="overflow-x-auto">
        <table class="w-full text-sm" data-testid="admin-market-abuse-table">
          <thead>
            <tr class="text-left text-ink-300">
              <th class="px-2 py-1">{{ t('admin.marketAbuse.table.type') }}</th>
              <th class="px-2 py-1">
                {{ t('admin.marketAbuse.table.severity') }}
              </th>
              <th class="px-2 py-1">
                {{ t('admin.marketAbuse.table.status') }}
              </th>
              <th class="px-2 py-1">
                {{ t('admin.marketAbuse.table.source') }}
              </th>
              <th class="px-2 py-1">
                {{ t('admin.marketAbuse.table.itemKey') }}
              </th>
              <th class="px-2 py-1">
                {{ t('admin.marketAbuse.table.seller') }}
              </th>
              <th class="px-2 py-1">
                {{ t('admin.marketAbuse.table.buyer') }}
              </th>
              <th class="px-2 py-1">
                {{ t('admin.marketAbuse.table.unitPrice') }}
              </th>
              <th class="px-2 py-1">
                {{ t('admin.marketAbuse.table.referencePrice') }}
              </th>
              <th class="px-2 py-1">
                {{ t('admin.marketAbuse.table.deviationRatio') }}
              </th>
              <th class="px-2 py-1">
                {{ t('admin.marketAbuse.table.windowKey') }}
              </th>
              <th class="px-2 py-1">
                {{ t('admin.marketAbuse.table.createdAt') }}
              </th>
              <th class="px-2 py-1">
                {{ t('admin.marketAbuse.table.actions') }}
              </th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="a in anomalies"
              :key="a.id"
              class="border-t border-ink-300/10"
              data-testid="admin-market-abuse-row"
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
                {{ a.itemKey ?? '-' }}
              </td>
              <td class="px-2 py-1 font-mono text-xs">
                {{ a.sellerCharacterId ?? '-' }}
              </td>
              <td class="px-2 py-1 font-mono text-xs">
                {{ a.buyerCharacterId ?? '-' }}
              </td>
              <td class="px-2 py-1 font-mono text-xs">
                {{ a.unitPrice ?? '-' }}
              </td>
              <td class="px-2 py-1 font-mono text-xs">
                {{ a.referencePrice ?? '-' }}
              </td>
              <td class="px-2 py-1 font-mono text-xs">
                {{
                  a.deviationRatio !== null
                    ? a.deviationRatio.toFixed(3)
                    : '-'
                }}
              </td>
              <td class="px-2 py-1 font-mono text-xs">{{ a.windowKey }}</td>
              <td class="px-2 py-1 text-xs">{{ a.createdAt }}</td>
              <td class="px-2 py-1">
                <button
                  v-if="a.status === 'OPEN'"
                  class="px-2 py-0.5 text-xs bg-amber-500/60 text-ink-900 rounded mr-1"
                  data-testid="admin-market-abuse-ack-btn"
                  @click="ackAnomaly(a.id)"
                >
                  {{ t('admin.marketAbuse.ack') }}
                </button>
                <button
                  v-if="a.status !== 'RESOLVED'"
                  class="px-2 py-0.5 text-xs bg-[var(--xt-jade)] text-ink-900 rounded"
                  data-testid="admin-market-abuse-resolve-btn"
                  @click="resolveAnomaly(a.id)"
                >
                  {{ t('admin.marketAbuse.resolve') }}
                </button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  </div>
</template>
