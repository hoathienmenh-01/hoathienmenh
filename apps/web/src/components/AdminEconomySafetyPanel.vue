<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useToastStore } from '@/stores/toast';
import {
  adminAnomalyAck,
  adminAnomalyResolve,
  adminAnomalyScanRun,
  adminLedgerCheckIssueAck,
  adminLedgerCheckIssueResolve,
  adminLedgerCheckIssues,
  adminLedgerCheckLatest,
  adminLedgerCheckRun,
  adminListAnomalies,
  type AnomalyScanSummary,
  type EconomyAnomalyRow,
  type EconomyLedgerCheckIssueRow,
  type EconomyLedgerCheckRunRow,
  type LedgerCheckRunSummary,
} from '@/api/admin';
import { extractApiErrorCodeOrDefault } from '@/lib/apiError';

/**
 * Phase 16.6 — Admin Economy Safety Panel.
 *
 * Hiển thị:
 *   - Latest ledger check run (status, dayBucket, issuesCreated, openIssues).
 *   - Bảng issues (severity / type / status, nút Ack / Resolve).
 *   - Bảng anomalies (severity / source / status, nút Ack / Resolve).
 *   - Nút "Run ledger check" + "Run anomaly scan" (force-run).
 *
 * Loading / error / empty state đầy đủ. Tất cả action có confirm prompt
 * (mirror AdminLiveOpsPanel.vue pattern). Endpoint trả ok=false sẽ hiển
 * thị toast lỗi với mã từ BE.
 *
 * Gates: tab này chỉ render khi role=ADMIN (parent AdminView guard). FE
 * KHÔNG gate role tự — BE mới là source of truth (`@RequireAdmin()`).
 */

const { t } = useI18n();
const toast = useToastStore();

const latestRun = ref<EconomyLedgerCheckRunRow | null>(null);
const openIssuesCount = ref(0);
const issues = ref<EconomyLedgerCheckIssueRow[]>([]);
const anomalies = ref<EconomyAnomalyRow[]>([]);
const loadingLatest = ref(true);
const loadingIssues = ref(false);
const loadingAnomalies = ref(false);
const errorLatest = ref<string | null>(null);
const errorIssues = ref<string | null>(null);
const errorAnomalies = ref<string | null>(null);
const runCheckSubmitting = ref(false);
const scanSubmitting = ref(false);
const lastRunSummary = ref<LedgerCheckRunSummary | null>(null);
const lastScanSummary = ref<AnomalyScanSummary | null>(null);

const issueFilters = ref<{ severity: string; status: string }>({
  severity: '',
  status: 'OPEN',
});
const anomalyFilters = ref<{ severity: string; status: string; source: string }>({
  severity: '',
  status: 'OPEN',
  source: '',
});

const SEVERITIES = ['INFO', 'WARN', 'CRITICAL'] as const;
const STATUSES = ['OPEN', 'ACKNOWLEDGED', 'RESOLVED'] as const;
const ANOMALY_SOURCES = [
  'CURRENCY_DELTA_24H',
  'RARE_ITEM_GAIN_24H',
  'REWARD_CAP_BYPASS',
  'ADMIN_GRANT_OVER_LIMIT',
  'MARKET_OUTLIER',
] as const;

onMounted(async () => {
  await Promise.all([
    refreshLatest(),
    refreshIssues(),
    refreshAnomalies(),
  ]);
});

async function refreshLatest(): Promise<void> {
  loadingLatest.value = true;
  errorLatest.value = null;
  try {
    const r = await adminLedgerCheckLatest();
    latestRun.value = r.run;
    openIssuesCount.value = r.openIssues;
  } catch (e) {
    errorLatest.value = extractApiErrorCodeOrDefault(e, 'UNKNOWN');
  } finally {
    loadingLatest.value = false;
  }
}

async function refreshIssues(): Promise<void> {
  loadingIssues.value = true;
  errorIssues.value = null;
  try {
    const r = await adminLedgerCheckIssues({
      severity: issueFilters.value.severity
        ? (issueFilters.value.severity as 'INFO' | 'WARN' | 'CRITICAL')
        : undefined,
      status: issueFilters.value.status
        ? (issueFilters.value.status as 'OPEN' | 'ACKNOWLEDGED' | 'RESOLVED')
        : undefined,
      limit: 50,
    });
    issues.value = r.items;
  } catch (e) {
    errorIssues.value = extractApiErrorCodeOrDefault(e, 'UNKNOWN');
  } finally {
    loadingIssues.value = false;
  }
}

async function refreshAnomalies(): Promise<void> {
  loadingAnomalies.value = true;
  errorAnomalies.value = null;
  try {
    const r = await adminListAnomalies({
      severity: anomalyFilters.value.severity
        ? (anomalyFilters.value.severity as 'INFO' | 'WARN' | 'CRITICAL')
        : undefined,
      status: anomalyFilters.value.status
        ? (anomalyFilters.value.status as 'OPEN' | 'ACKNOWLEDGED' | 'RESOLVED')
        : undefined,
      source: anomalyFilters.value.source
        ? (anomalyFilters.value.source as
            | 'CURRENCY_DELTA_24H'
            | 'RARE_ITEM_GAIN_24H'
            | 'REWARD_CAP_BYPASS'
            | 'ADMIN_GRANT_OVER_LIMIT'
            | 'MARKET_OUTLIER')
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

async function runLedgerCheck(): Promise<void> {
  if (!confirm(t('admin.economySafety.confirmRun'))) return;
  runCheckSubmitting.value = true;
  try {
    lastRunSummary.value = await adminLedgerCheckRun(false);
    toast.push({
      type: 'success',
      text: t('admin.economySafety.runDone', {
        issues: lastRunSummary.value.issuesCreated,
        status: lastRunSummary.value.status,
      }),
    });
    await Promise.all([refreshLatest(), refreshIssues()]);
  } catch (e) {
    toast.push({
      type: 'error',
      text: extractApiErrorCodeOrDefault(e, 'UNKNOWN'),
    });
  } finally {
    runCheckSubmitting.value = false;
  }
}

async function runAnomalyScan(): Promise<void> {
  if (!confirm(t('admin.economySafety.confirmScan'))) return;
  scanSubmitting.value = true;
  try {
    lastScanSummary.value = await adminAnomalyScanRun();
    toast.push({
      type: 'success',
      text: t('admin.economySafety.scanDone', {
        created: lastScanSummary.value.totalAnomaliesCreated,
        skipped: lastScanSummary.value.totalAnomaliesSkipped,
      }),
    });
    await refreshAnomalies();
  } catch (e) {
    toast.push({
      type: 'error',
      text: extractApiErrorCodeOrDefault(e, 'UNKNOWN'),
    });
  } finally {
    scanSubmitting.value = false;
  }
}

async function ackIssue(id: string): Promise<void> {
  try {
    await adminLedgerCheckIssueAck(id);
    toast.push({ type: 'success', text: t('admin.economySafety.ackDone') });
    await Promise.all([refreshLatest(), refreshIssues()]);
  } catch (e) {
    toast.push({
      type: 'error',
      text: extractApiErrorCodeOrDefault(e, 'UNKNOWN'),
    });
  }
}

async function resolveIssue(id: string): Promise<void> {
  try {
    await adminLedgerCheckIssueResolve(id);
    toast.push({ type: 'success', text: t('admin.economySafety.resolveDone') });
    await Promise.all([refreshLatest(), refreshIssues()]);
  } catch (e) {
    toast.push({
      type: 'error',
      text: extractApiErrorCodeOrDefault(e, 'UNKNOWN'),
    });
  }
}

async function ackAnomaly(id: string): Promise<void> {
  try {
    await adminAnomalyAck(id);
    toast.push({ type: 'success', text: t('admin.economySafety.ackDone') });
    await refreshAnomalies();
  } catch (e) {
    toast.push({
      type: 'error',
      text: extractApiErrorCodeOrDefault(e, 'UNKNOWN'),
    });
  }
}

async function resolveAnomaly(id: string): Promise<void> {
  try {
    await adminAnomalyResolve(id);
    toast.push({ type: 'success', text: t('admin.economySafety.resolveDone') });
    await refreshAnomalies();
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
</script>

<template>
  <div class="space-y-4" data-testid="admin-economy-safety-panel">
    <!-- Latest run -->
    <section
      class="border border-ink-300/30 rounded p-3 space-y-2"
      data-testid="admin-economy-safety-latest"
    >
      <header class="flex items-center justify-between">
        <h3 class="text-lg font-bold">{{ t('admin.economySafety.latestRun.title') }}</h3>
        <button
          class="px-3 py-1 bg-amber-500/80 text-ink-900 rounded text-sm disabled:opacity-50"
          :disabled="runCheckSubmitting"
          data-testid="admin-economy-safety-run-btn"
          @click="runLedgerCheck"
        >
          {{ runCheckSubmitting ? t('common.loading') : t('admin.economySafety.runBtn') }}
        </button>
      </header>
      <p v-if="loadingLatest" class="text-sm text-ink-300">{{ t('common.loading') }}</p>
      <p v-else-if="errorLatest" class="text-sm text-rose-300">{{ errorLatest }}</p>
      <div
        v-else-if="!latestRun"
        class="text-sm text-ink-300"
        data-testid="admin-economy-safety-empty"
      >
        {{ t('admin.economySafety.empty') }}
      </div>
      <ul v-else class="text-sm space-y-1">
        <li><strong>{{ t('admin.economySafety.dayBucket') }}:</strong> {{ latestRun.dayBucket }}</li>
        <li><strong>{{ t('admin.economySafety.status') }}:</strong> {{ latestRun.status }}</li>
        <li><strong>{{ t('admin.economySafety.startedAt') }}:</strong> {{ latestRun.startedAt }}</li>
        <li><strong>{{ t('admin.economySafety.openIssues') }}:</strong> {{ openIssuesCount }}</li>
      </ul>
    </section>

    <!-- Issues table -->
    <section
      class="border border-ink-300/30 rounded p-3 space-y-2"
      data-testid="admin-economy-safety-issues"
    >
      <header class="flex items-center gap-3 flex-wrap">
        <h3 class="text-lg font-bold">{{ t('admin.economySafety.issues.title') }}</h3>
        <select
          v-model="issueFilters.severity"
          class="bg-transparent border border-ink-300/30 rounded px-2 py-1 text-sm"
          @change="refreshIssues"
        >
          <option value="">{{ t('admin.economySafety.filter.severityAll') }}</option>
          <option v-for="s in SEVERITIES" :key="s" :value="s">{{ s }}</option>
        </select>
        <select
          v-model="issueFilters.status"
          class="bg-transparent border border-ink-300/30 rounded px-2 py-1 text-sm"
          @change="refreshIssues"
        >
          <option value="">{{ t('admin.economySafety.filter.statusAll') }}</option>
          <option v-for="s in STATUSES" :key="s" :value="s">{{ s }}</option>
        </select>
      </header>
      <p v-if="loadingIssues" class="text-sm text-ink-300">{{ t('common.loading') }}</p>
      <p v-else-if="errorIssues" class="text-sm text-rose-300">{{ errorIssues }}</p>
      <p
        v-else-if="issues.length === 0"
        class="text-sm text-ink-300"
        data-testid="admin-economy-safety-issues-empty"
      >
        {{ t('admin.economySafety.empty') }}
      </p>
      <table v-else class="w-full text-sm">
        <thead>
          <tr class="text-left border-b border-ink-300/30">
            <th>{{ t('admin.economySafety.severity') }}</th>
            <th>{{ t('admin.economySafety.type') }}</th>
            <th>{{ t('admin.economySafety.characterId') }}</th>
            <th>{{ t('admin.economySafety.status') }}</th>
            <th>{{ t('admin.economySafety.actions') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="issue in issues"
            :key="issue.id"
            class="border-b border-ink-300/20"
            data-testid="admin-economy-safety-issue-row"
          >
            <td :class="severityClass(issue.severity)">{{ issue.severity }}</td>
            <td>{{ issue.type }}</td>
            <td class="text-xs">{{ issue.characterId ?? '—' }}</td>
            <td :class="statusClass(issue.status)">{{ issue.status }}</td>
            <td class="space-x-1">
              <button
                v-if="issue.status === 'OPEN'"
                class="px-2 py-0.5 bg-amber-500/60 text-ink-900 rounded text-xs"
                data-testid="admin-economy-safety-issue-ack"
                @click="ackIssue(issue.id)"
              >
                {{ t('admin.economySafety.ack') }}
              </button>
              <button
                v-if="issue.status !== 'RESOLVED'"
                class="px-2 py-0.5 bg-emerald-500/60 text-ink-900 rounded text-xs"
                data-testid="admin-economy-safety-issue-resolve"
                @click="resolveIssue(issue.id)"
              >
                {{ t('admin.economySafety.resolve') }}
              </button>
            </td>
          </tr>
        </tbody>
      </table>
    </section>

    <!-- Anomalies table -->
    <section
      class="border border-ink-300/30 rounded p-3 space-y-2"
      data-testid="admin-economy-safety-anomalies"
    >
      <header class="flex items-center gap-3 flex-wrap">
        <h3 class="text-lg font-bold">{{ t('admin.economySafety.anomalies.title') }}</h3>
        <select
          v-model="anomalyFilters.severity"
          class="bg-transparent border border-ink-300/30 rounded px-2 py-1 text-sm"
          @change="refreshAnomalies"
        >
          <option value="">{{ t('admin.economySafety.filter.severityAll') }}</option>
          <option v-for="s in SEVERITIES" :key="s" :value="s">{{ s }}</option>
        </select>
        <select
          v-model="anomalyFilters.status"
          class="bg-transparent border border-ink-300/30 rounded px-2 py-1 text-sm"
          @change="refreshAnomalies"
        >
          <option value="">{{ t('admin.economySafety.filter.statusAll') }}</option>
          <option v-for="s in STATUSES" :key="s" :value="s">{{ s }}</option>
        </select>
        <select
          v-model="anomalyFilters.source"
          class="bg-transparent border border-ink-300/30 rounded px-2 py-1 text-sm"
          @change="refreshAnomalies"
        >
          <option value="">{{ t('admin.economySafety.filter.sourceAll') }}</option>
          <option v-for="s in ANOMALY_SOURCES" :key="s" :value="s">{{ s }}</option>
        </select>
        <button
          class="ml-auto px-3 py-1 bg-amber-500/80 text-ink-900 rounded text-sm disabled:opacity-50"
          :disabled="scanSubmitting"
          data-testid="admin-economy-safety-scan-btn"
          @click="runAnomalyScan"
        >
          {{ scanSubmitting ? t('common.loading') : t('admin.economySafety.scanBtn') }}
        </button>
      </header>
      <p v-if="loadingAnomalies" class="text-sm text-ink-300">{{ t('common.loading') }}</p>
      <p v-else-if="errorAnomalies" class="text-sm text-rose-300">{{ errorAnomalies }}</p>
      <p
        v-else-if="anomalies.length === 0"
        class="text-sm text-ink-300"
        data-testid="admin-economy-safety-anomalies-empty"
      >
        {{ t('admin.economySafety.empty') }}
      </p>
      <table v-else class="w-full text-sm">
        <thead>
          <tr class="text-left border-b border-ink-300/30">
            <th>{{ t('admin.economySafety.severity') }}</th>
            <th>{{ t('admin.economySafety.source') }}</th>
            <th>{{ t('admin.economySafety.characterId') }}</th>
            <th>{{ t('admin.economySafety.status') }}</th>
            <th>{{ t('admin.economySafety.actions') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="a in anomalies"
            :key="a.id"
            class="border-b border-ink-300/20"
            data-testid="admin-economy-safety-anomaly-row"
          >
            <td :class="severityClass(a.severity)">{{ a.severity }}</td>
            <td>{{ a.source }}</td>
            <td class="text-xs">{{ a.characterId ?? '—' }}</td>
            <td :class="statusClass(a.status)">{{ a.status }}</td>
            <td class="space-x-1">
              <button
                v-if="a.status === 'OPEN'"
                class="px-2 py-0.5 bg-amber-500/60 text-ink-900 rounded text-xs"
                data-testid="admin-economy-safety-anomaly-ack"
                @click="ackAnomaly(a.id)"
              >
                {{ t('admin.economySafety.ack') }}
              </button>
              <button
                v-if="a.status !== 'RESOLVED'"
                class="px-2 py-0.5 bg-emerald-500/60 text-ink-900 rounded text-xs"
                data-testid="admin-economy-safety-anomaly-resolve"
                @click="resolveAnomaly(a.id)"
              >
                {{ t('admin.economySafety.resolve') }}
              </button>
            </td>
          </tr>
        </tbody>
      </table>
    </section>
  </div>
</template>
