<script setup lang="ts">
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import {
  adminEconomyRangeReport,
  adminLedgerCheckRun,
  type LedgerCheckRunSummary,
} from '@/api/admin';
import { extractApiErrorCodeOrDefault } from '@/lib/apiError';
import { useToastStore } from '@/stores/toast';
import type { EconomyReportResponse } from '@xuantoi/shared';

/**
 * Phase 16.1.B — Admin Economy Range Report panel.
 *
 * Cho phép admin chọn date range (mặc định = 7 ngày gần nhất) và xem:
 *   - Summary cards: tổng in / out / net linhThach + anomaly counts +
 *     latest ledger check run status.
 *   - Bảng breakdown theo source (8+ buckets) — in, out, net, entries.
 *   - Top 10 character net delta (link mở User detail panel có sẵn).
 *   - Pre-defined totals (market volume, shop spend, reforge-enchant, ...).
 *   - Nút "Run ledger check now" trigger manual run (Phase 16.6 reuse).
 *
 * Loading / empty / error states đầy đủ. KHÔNG auto-load on mount —
 * admin chủ động click "Load report" (endpoint có thể nặng nếu 31d).
 *
 * Gates: BE đã `@RequireAdmin()` — FE chỉ render trong Economy tab (parent
 * AdminView đã guard role). KHÔNG auto-ban, KHÔNG tự sửa data.
 */

const { t } = useI18n();
const toast = useToastStore();

function todayIso(): string {
  const d = new Date();
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const da = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${da}`;
}

function isoMinusDays(n: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - n);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const da = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${da}`;
}

const fromInput = ref(isoMinusDays(6));
const toInput = ref(todayIso());

const loading = ref(false);
const error = ref<string | null>(null);
const report = ref<EconomyReportResponse | null>(null);

const runCheckSubmitting = ref(false);
const lastRunSummary = ref<LedgerCheckRunSummary | null>(null);

const hasReport = computed(() => report.value !== null);
const isEmpty = computed(
  () =>
    report.value !== null &&
    report.value.bySource.length === 0 &&
    report.value.totalInLinhThach === '0' &&
    report.value.totalOutLinhThach === '0',
);

async function loadReport(): Promise<void> {
  loading.value = true;
  error.value = null;
  try {
    const r = await adminEconomyRangeReport(
      fromInput.value || undefined,
      toInput.value || undefined,
    );
    report.value = r;
  } catch (e) {
    const code = extractApiErrorCodeOrDefault(e, 'UNKNOWN');
    error.value = code;
    toast.push({
      type: 'error',
      text: t('admin.economyRangeReport.error.load', { code }),
    });
  } finally {
    loading.value = false;
  }
}

async function runCheckNow(): Promise<void> {
  if (runCheckSubmitting.value) return;
  if (
    !window.confirm(t('admin.economyRangeReport.runCheck.confirm') as string)
  ) {
    return;
  }
  runCheckSubmitting.value = true;
  try {
    const r = await adminLedgerCheckRun(false);
    lastRunSummary.value = r;
    toast.push({
      type: 'success',
      text: t(
        r.alreadyDone
          ? 'admin.economyRangeReport.runCheck.alreadyDone'
          : 'admin.economyRangeReport.runCheck.done',
        { issues: r.issuesCreated, status: r.status },
      ),
    });
    // Reload report so it reflects the new latestLedgerCheckRun.
    await loadReport();
  } catch (e) {
    const code = extractApiErrorCodeOrDefault(e, 'UNKNOWN');
    toast.push({
      type: 'error',
      text: t('admin.economyRangeReport.runCheck.failed', { code }),
    });
  } finally {
    runCheckSubmitting.value = false;
  }
}

function formatBigInt(s: string): string {
  // Optional grouping. Keep as-is for now (raw mono font).
  return s;
}
</script>

<template>
  <section
    class="space-y-3"
    data-testid="admin-economy-range-report-panel"
  >
    <header class="flex items-start justify-between gap-3">
      <div>
        <h2 class="text-base text-cyan-200 font-semibold">
          {{ t('admin.economyRangeReport.title') }}
        </h2>
        <p class="text-xs text-ink-300 mt-1 max-w-2xl">
          {{ t('admin.economyRangeReport.subtitle') }}
        </p>
      </div>
    </header>

    <!-- Range picker -->
    <div
      class="bg-ink-700/30 border border-ink-300/20 rounded p-3 grid grid-cols-1 md:grid-cols-4 gap-3"
    >
      <label class="flex flex-col text-xs">
        <span class="text-ink-300 uppercase tracking-wide">{{
          t('admin.economyRangeReport.from')
        }}</span>
        <input
          v-model="fromInput"
          type="date"
          data-testid="admin-economy-range-report-from"
          class="mt-1 bg-ink-900/50 border border-ink-300/30 rounded px-2 py-1 text-ink-50"
        />
      </label>
      <label class="flex flex-col text-xs">
        <span class="text-ink-300 uppercase tracking-wide">{{
          t('admin.economyRangeReport.to')
        }}</span>
        <input
          v-model="toInput"
          type="date"
          data-testid="admin-economy-range-report-to"
          class="mt-1 bg-ink-900/50 border border-ink-300/30 rounded px-2 py-1 text-ink-50"
        />
      </label>
      <div class="flex items-end gap-2">
        <button
          type="button"
          class="px-3 py-1 text-xs bg-amber-500 text-ink-900 rounded font-bold disabled:opacity-50"
          :disabled="loading"
          data-testid="admin-economy-range-report-load-btn"
          @click="loadReport()"
        >
          {{
            loading
              ? t('admin.economyRangeReport.loading')
              : t('admin.economyRangeReport.load')
          }}
        </button>
        <button
          type="button"
          class="px-3 py-1 text-xs bg-rose-700 text-ink-50 rounded disabled:opacity-50"
          :disabled="runCheckSubmitting"
          data-testid="admin-economy-range-report-run-check-btn"
          @click="runCheckNow()"
        >
          {{
            runCheckSubmitting
              ? t('admin.economyRangeReport.runCheck.running')
              : t('admin.economyRangeReport.runCheck.label')
          }}
        </button>
      </div>
    </div>

    <!-- Error state -->
    <div
      v-if="error"
      data-testid="admin-economy-range-report-error"
      class="text-rose-300 text-xs bg-rose-950/30 border border-rose-500/30 rounded p-3"
    >
      {{ t('admin.economyRangeReport.error.load', { code: error }) }}
    </div>

    <!-- Empty state (no report loaded yet) -->
    <div
      v-else-if="!hasReport && !loading"
      data-testid="admin-economy-range-report-empty"
      class="text-ink-300 text-xs italic"
    >
      {{ t('admin.economyRangeReport.emptyInitial') }}
    </div>

    <!-- Loaded report -->
    <div v-else-if="hasReport && report" class="space-y-3">
      <!-- Empty-data state inside loaded report -->
      <div
        v-if="isEmpty"
        data-testid="admin-economy-range-report-empty-data"
        class="text-ink-300 text-xs italic"
      >
        {{
          t('admin.economyRangeReport.emptyData', {
            from: report.range.from,
            to: report.range.to,
          })
        }}
      </div>

      <!-- Summary cards -->
      <div
        class="grid grid-cols-1 md:grid-cols-5 gap-2 text-xs"
        data-testid="admin-economy-range-report-summary"
      >
        <div class="bg-ink-700/30 border border-ink-300/20 rounded p-2">
          <div class="text-ink-300 uppercase tracking-wide text-[10px]">
            {{ t('admin.economyRangeReport.totalIn') }}
          </div>
          <div class="font-mono text-emerald-200">
            {{ formatBigInt(report.totalInLinhThach) }}
          </div>
        </div>
        <div class="bg-ink-700/30 border border-ink-300/20 rounded p-2">
          <div class="text-ink-300 uppercase tracking-wide text-[10px]">
            {{ t('admin.economyRangeReport.totalOut') }}
          </div>
          <div class="font-mono text-rose-200">
            {{ formatBigInt(report.totalOutLinhThach) }}
          </div>
        </div>
        <div class="bg-ink-700/30 border border-ink-300/20 rounded p-2">
          <div class="text-ink-300 uppercase tracking-wide text-[10px]">
            {{ t('admin.economyRangeReport.totalNet') }}
          </div>
          <div class="font-mono text-amber-200">
            {{ formatBigInt(report.totalNetLinhThach) }}
          </div>
        </div>
        <div class="bg-ink-700/30 border border-ink-300/20 rounded p-2">
          <div class="text-ink-300 uppercase tracking-wide text-[10px]">
            {{ t('admin.economyRangeReport.openAnomalies') }}
          </div>
          <div class="font-mono text-rose-300">
            {{ report.anomalySummary.openCount }}
          </div>
        </div>
        <div class="bg-ink-700/30 border border-ink-300/20 rounded p-2">
          <div class="text-ink-300 uppercase tracking-wide text-[10px]">
            {{ t('admin.economyRangeReport.latestRun') }}
          </div>
          <div
            v-if="report.latestLedgerCheckRun"
            class="font-mono text-ink-50"
            data-testid="admin-economy-range-report-latest-run"
          >
            {{ report.latestLedgerCheckRun.status }}
            <span class="text-ink-300 ml-1"
              >({{ report.latestLedgerCheckRun.dayBucket }})</span
            >
          </div>
          <div v-else class="text-ink-300 italic text-[10px]">
            {{ t('admin.economyRangeReport.noLatestRun') }}
          </div>
        </div>
      </div>

      <!-- Category totals -->
      <div
        class="grid grid-cols-2 md:grid-cols-5 gap-2 text-xs"
        data-testid="admin-economy-range-report-totals"
      >
        <div class="bg-ink-700/30 border border-ink-300/20 rounded p-2">
          <div class="text-ink-300 uppercase tracking-wide text-[10px]">
            {{ t('admin.economyRangeReport.marketVolume') }}
          </div>
          <div class="font-mono">{{ formatBigInt(report.marketVolume) }}</div>
        </div>
        <div class="bg-ink-700/30 border border-ink-300/20 rounded p-2">
          <div class="text-ink-300 uppercase tracking-wide text-[10px]">
            {{ t('admin.economyRangeReport.shopSpend') }}
          </div>
          <div class="font-mono">{{ formatBigInt(report.shopSpend) }}</div>
        </div>
        <div class="bg-ink-700/30 border border-ink-300/20 rounded p-2">
          <div class="text-ink-300 uppercase tracking-wide text-[10px]">
            {{ t('admin.economyRangeReport.sectShopSpend') }}
          </div>
          <div class="font-mono">{{ formatBigInt(report.sectShopSpend) }}</div>
        </div>
        <div class="bg-ink-700/30 border border-ink-300/20 rounded p-2">
          <div class="text-ink-300 uppercase tracking-wide text-[10px]">
            {{ t('admin.economyRangeReport.reforgeEnchantSpend') }}
          </div>
          <div class="font-mono">
            {{ formatBigInt(report.reforgeEnchantSpend) }}
          </div>
        </div>
        <div class="bg-ink-700/30 border border-ink-300/20 rounded p-2">
          <div class="text-ink-300 uppercase tracking-wide text-[10px]">
            {{ t('admin.economyRangeReport.adminGrantTotal') }}
          </div>
          <div class="font-mono">
            {{ formatBigInt(report.adminGrantTotal) }}
          </div>
        </div>
        <div class="bg-ink-700/30 border border-ink-300/20 rounded p-2">
          <div class="text-ink-300 uppercase tracking-wide text-[10px]">
            {{ t('admin.economyRangeReport.liveOpsRewardTotal') }}
          </div>
          <div class="font-mono">
            {{ formatBigInt(report.liveOpsRewardTotal) }}
          </div>
        </div>
        <div class="bg-ink-700/30 border border-ink-300/20 rounded p-2">
          <div class="text-ink-300 uppercase tracking-wide text-[10px]">
            {{ t('admin.economyRangeReport.dailyLoginRewardTotal') }}
          </div>
          <div class="font-mono">
            {{ formatBigInt(report.dailyLoginRewardTotal) }}
          </div>
        </div>
        <div class="bg-ink-700/30 border border-ink-300/20 rounded p-2">
          <div class="text-ink-300 uppercase tracking-wide text-[10px]">
            {{ t('admin.economyRangeReport.dungeonRewardTotal') }}
          </div>
          <div class="font-mono">
            {{ formatBigInt(report.dungeonRewardTotal) }}
          </div>
        </div>
        <div class="bg-ink-700/30 border border-ink-300/20 rounded p-2">
          <div class="text-ink-300 uppercase tracking-wide text-[10px]">
            {{ t('admin.economyRangeReport.bossRewardTotal') }}
          </div>
          <div class="font-mono">
            {{ formatBigInt(report.bossRewardTotal) }}
          </div>
        </div>
        <div class="bg-ink-700/30 border border-ink-300/20 rounded p-2">
          <div class="text-ink-300 uppercase tracking-wide text-[10px]">
            {{ t('admin.economyRangeReport.sectSeasonRewardTotal') }}
          </div>
          <div class="font-mono">
            {{ formatBigInt(report.sectSeasonRewardTotal) }}
          </div>
        </div>
      </div>

      <!-- Source breakdown -->
      <div data-testid="admin-economy-range-report-by-source">
        <h3 class="text-sm text-amber-200 mb-1">
          {{ t('admin.economyRangeReport.bySourceTitle') }}
        </h3>
        <div
          v-if="report.bySource.length === 0"
          class="text-ink-300 italic text-xs"
        >
          {{ t('admin.economyRangeReport.bySourceEmpty') }}
        </div>
        <table v-else class="w-full text-xs">
          <thead>
            <tr class="text-ink-300 text-left">
              <th class="py-1">
                {{ t('admin.economyRangeReport.col.source') }}
              </th>
              <th class="py-1 text-right">
                {{ t('admin.economyRangeReport.col.in') }}
              </th>
              <th class="py-1 text-right">
                {{ t('admin.economyRangeReport.col.out') }}
              </th>
              <th class="py-1 text-right">
                {{ t('admin.economyRangeReport.col.net') }}
              </th>
              <th class="py-1 text-right">
                {{ t('admin.economyRangeReport.col.entries') }}
              </th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="row in report.bySource"
              :key="row.source"
              class="border-t border-ink-300/10"
            >
              <td class="py-1 font-mono">{{ row.source }}</td>
              <td class="py-1 text-right font-mono text-emerald-200">
                {{ formatBigInt(row.inLinhThach) }}
              </td>
              <td class="py-1 text-right font-mono text-rose-200">
                {{ formatBigInt(row.outLinhThach) }}
              </td>
              <td class="py-1 text-right font-mono text-amber-200">
                {{ formatBigInt(row.netLinhThach) }}
              </td>
              <td class="py-1 text-right font-mono">{{ row.entryCount }}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <!-- Top character delta -->
      <div data-testid="admin-economy-range-report-top-delta">
        <h3 class="text-sm text-amber-200 mb-1">
          {{ t('admin.economyRangeReport.topDeltaTitle') }}
        </h3>
        <div
          v-if="report.topCharacterDelta.length === 0"
          class="text-ink-300 italic text-xs"
        >
          {{ t('admin.economyRangeReport.topDeltaEmpty') }}
        </div>
        <table v-else class="w-full text-xs">
          <thead>
            <tr class="text-ink-300 text-left">
              <th class="py-1">{{ t('admin.economyRangeReport.col.rank') }}</th>
              <th class="py-1">
                {{ t('admin.economyRangeReport.col.character') }}
              </th>
              <th class="py-1">{{ t('admin.economyRangeReport.col.email') }}</th>
              <th class="py-1 text-right">
                {{ t('admin.economyRangeReport.col.in') }}
              </th>
              <th class="py-1 text-right">
                {{ t('admin.economyRangeReport.col.out') }}
              </th>
              <th class="py-1 text-right">
                {{ t('admin.economyRangeReport.col.net') }}
              </th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="(row, idx) in report.topCharacterDelta"
              :key="row.characterId"
              class="border-t border-ink-300/10"
            >
              <td class="py-1 font-mono">{{ idx + 1 }}</td>
              <td class="py-1">
                {{ row.characterName ?? row.characterId }}
              </td>
              <td class="py-1 text-ink-300">{{ row.userEmail ?? '—' }}</td>
              <td class="py-1 text-right font-mono text-emerald-200">
                {{ formatBigInt(row.inLinhThach) }}
              </td>
              <td class="py-1 text-right font-mono text-rose-200">
                {{ formatBigInt(row.outLinhThach) }}
              </td>
              <td class="py-1 text-right font-mono text-amber-200">
                {{ formatBigInt(row.netLinhThach) }}
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <div class="text-[10px] text-ink-300 italic">
        {{
          t('admin.economyRangeReport.generatedAt', {
            generatedAt: report.generatedAt,
            from: report.range.from,
            to: report.range.to,
            days: report.range.days,
          })
        }}
      </div>
    </div>
  </section>
</template>
