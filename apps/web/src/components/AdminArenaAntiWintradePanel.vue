<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useToastStore } from '@/stores/toast';
import {
  adminArenaWintradeAck,
  adminArenaWintradeListAlerts,
  adminArenaWintradeResolve,
  adminArenaWintradeScan,
  type ArenaWintradeAlertRow,
  type ArenaWintradeScanSummary,
  type ArenaWintradeSeverity,
  type ArenaWintradeStatus,
  type ArenaWintradeType,
} from '@/api/admin';
import { extractApiErrorCodeOrDefault } from '@/lib/apiError';

/**
 * Phase 14.1.D — Admin Arena Anti-Wintrade Panel.
 *
 * Hiển thị:
 *   - Bảng alerts (severity / type / attacker / defender / status, nút
 *     Ack / Resolve).
 *   - Filter theo severity / status / type.
 *   - Nút "Run scan" (force-run full scan).
 *   - Last scan summary (created / skipped / critical / warning).
 *
 * Loading / error / empty state đầy đủ. Mọi action confirm prompt mirror
 * `AdminEconomySafetyPanel.vue` pattern. Endpoint trả ok=false sẽ hiển
 * thị toast lỗi với mã từ BE.
 *
 * Gates: tab này chỉ render khi role=ADMIN (parent AdminView guard). FE
 * KHÔNG gate role tự — BE mới là source of truth (`@RequireAdmin()`).
 */

const { t } = useI18n();
const toast = useToastStore();

const alerts = ref<ArenaWintradeAlertRow[]>([]);
const totalAlerts = ref(0);
const loadingAlerts = ref(false);
const errorAlerts = ref<string | null>(null);
const scanSubmitting = ref(false);
const lastScanSummary = ref<ArenaWintradeScanSummary | null>(null);

const filters = ref<{
  severity: ArenaWintradeSeverity | '';
  status: ArenaWintradeStatus | '';
  type: ArenaWintradeType | '';
}>({
  severity: '',
  status: 'OPEN',
  type: '',
});

const SEVERITIES: ArenaWintradeSeverity[] = ['INFO', 'WARN', 'CRITICAL'];
const STATUSES: ArenaWintradeStatus[] = [
  'OPEN',
  'ACKNOWLEDGED',
  'RESOLVED',
];
const TYPES: ArenaWintradeType[] = [
  'REPEATED_OPPONENT_PAIR',
  'RECIPROCAL_WIN_LOSS',
  'RATING_GAIN_SPIKE',
  'REWARD_FARM_PATTERN',
  'SEASON_SUSPICIOUS_ACTOR',
];

onMounted(async () => {
  await refreshAlerts();
});

async function refreshAlerts(): Promise<void> {
  loadingAlerts.value = true;
  errorAlerts.value = null;
  try {
    const r = await adminArenaWintradeListAlerts({
      severity: filters.value.severity || undefined,
      status: filters.value.status || undefined,
      type: filters.value.type || undefined,
      limit: 100,
    });
    alerts.value = r.items;
    totalAlerts.value = r.total;
  } catch (e) {
    errorAlerts.value = extractApiErrorCodeOrDefault(e, 'UNKNOWN');
  } finally {
    loadingAlerts.value = false;
  }
}

async function runScan(): Promise<void> {
  if (!confirm(t('admin.arenaAntiWintrade.confirmScan'))) return;
  scanSubmitting.value = true;
  try {
    const summary = await adminArenaWintradeScan();
    lastScanSummary.value = summary;
    toast.push({
      type: 'success',
      text: t('admin.arenaAntiWintrade.scanSuccess', {
        created: summary.alertsCreated,
        skipped: summary.alertsSkippedDuplicate,
      }),
    });
    await refreshAlerts();
  } catch (e) {
    toast.push({
      type: 'error',
      text: extractApiErrorCodeOrDefault(e, 'UNKNOWN'),
    });
  } finally {
    scanSubmitting.value = false;
  }
}

async function ackAlert(id: string): Promise<void> {
  if (!confirm(t('admin.arenaAntiWintrade.confirmAck'))) return;
  try {
    await adminArenaWintradeAck(id);
    toast.push({
      type: 'success',
      text: t('admin.arenaAntiWintrade.ackSuccess'),
    });
    await refreshAlerts();
  } catch (e) {
    toast.push({
      type: 'error',
      text: extractApiErrorCodeOrDefault(e, 'UNKNOWN'),
    });
  }
}

async function resolveAlert(id: string): Promise<void> {
  if (!confirm(t('admin.arenaAntiWintrade.confirmResolve'))) return;
  try {
    await adminArenaWintradeResolve(id);
    toast.push({
      type: 'success',
      text: t('admin.arenaAntiWintrade.resolveSuccess'),
    });
    await refreshAlerts();
  } catch (e) {
    toast.push({
      type: 'error',
      text: extractApiErrorCodeOrDefault(e, 'UNKNOWN'),
    });
  }
}

function severityClass(s: string): string {
  if (s === 'CRITICAL') return 'text-rose-300 font-semibold';
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
  <div class="space-y-6" data-testid="admin-arena-anti-wintrade-panel">
    <!-- Last scan summary -->
    <section
      v-if="lastScanSummary"
      class="border border-ink-300/30 rounded p-4 bg-ink-900/40"
      data-testid="admin-arena-anti-wintrade-summary"
    >
      <h3 class="text-base font-semibold mb-2">
        {{ t('admin.arenaAntiWintrade.lastScan') }}
      </h3>
      <ul class="text-sm space-y-1">
        <li>
          {{ t('admin.arenaAntiWintrade.scannedMatches') }}:
          <strong>{{ lastScanSummary.scannedMatches }}</strong>
        </li>
        <li>
          {{ t('admin.arenaAntiWintrade.alertsCreated') }}:
          <strong>{{ lastScanSummary.alertsCreated }}</strong>
        </li>
        <li>
          {{ t('admin.arenaAntiWintrade.alertsSkipped') }}:
          <strong>{{ lastScanSummary.alertsSkippedDuplicate }}</strong>
        </li>
        <li class="text-rose-300">
          CRITICAL: <strong>{{ lastScanSummary.criticalCount }}</strong>
        </li>
        <li class="text-amber-300">
          WARN: <strong>{{ lastScanSummary.warningCount }}</strong>
        </li>
      </ul>
    </section>

    <!-- Alerts -->
    <section
      class="border border-ink-300/30 rounded p-4 bg-ink-900/40"
      data-testid="admin-arena-anti-wintrade-alerts-section"
    >
      <header class="flex flex-wrap items-center gap-2 mb-3">
        <h3 class="text-base font-semibold mr-auto">
          {{ t('admin.arenaAntiWintrade.alerts') }}
          <span class="text-xs text-ink-300 ml-2"
            >({{ totalAlerts }} {{ t('admin.arenaAntiWintrade.total') }})</span
          >
        </h3>
        <select
          v-model="filters.severity"
          class="bg-transparent border border-ink-300/30 rounded px-2 py-1 text-sm"
          data-testid="admin-arena-anti-wintrade-filter-severity"
          @change="refreshAlerts"
        >
          <option value="">
            {{ t('admin.arenaAntiWintrade.filter.severityAll') }}
          </option>
          <option v-for="s in SEVERITIES" :key="s" :value="s">{{ s }}</option>
        </select>
        <select
          v-model="filters.status"
          class="bg-transparent border border-ink-300/30 rounded px-2 py-1 text-sm"
          data-testid="admin-arena-anti-wintrade-filter-status"
          @change="refreshAlerts"
        >
          <option value="">
            {{ t('admin.arenaAntiWintrade.filter.statusAll') }}
          </option>
          <option v-for="s in STATUSES" :key="s" :value="s">{{ s }}</option>
        </select>
        <select
          v-model="filters.type"
          class="bg-transparent border border-ink-300/30 rounded px-2 py-1 text-sm"
          data-testid="admin-arena-anti-wintrade-filter-type"
          @change="refreshAlerts"
        >
          <option value="">
            {{ t('admin.arenaAntiWintrade.filter.typeAll') }}
          </option>
          <option v-for="t2 in TYPES" :key="t2" :value="t2">{{ t2 }}</option>
        </select>
        <button
          class="px-3 py-1 bg-amber-500/80 text-ink-900 rounded text-sm disabled:opacity-50"
          :disabled="scanSubmitting"
          data-testid="admin-arena-anti-wintrade-scan-btn"
          @click="runScan"
        >
          {{
            scanSubmitting
              ? t('common.loading')
              : t('admin.arenaAntiWintrade.scanBtn')
          }}
        </button>
      </header>
      <p
        v-if="loadingAlerts"
        class="text-sm text-ink-300"
        data-testid="admin-arena-anti-wintrade-loading"
      >
        {{ t('common.loading') }}
      </p>
      <p
        v-else-if="errorAlerts"
        class="text-sm text-rose-300"
        data-testid="admin-arena-anti-wintrade-error"
      >
        {{ errorAlerts }}
      </p>
      <p
        v-else-if="alerts.length === 0"
        class="text-sm text-ink-300"
        data-testid="admin-arena-anti-wintrade-empty"
      >
        {{ t('admin.arenaAntiWintrade.empty') }}
      </p>
      <table v-else class="w-full text-sm" data-testid="admin-arena-anti-wintrade-table">
        <thead>
          <tr class="text-left border-b border-ink-300/30">
            <th>{{ t('admin.arenaAntiWintrade.severity') }}</th>
            <th>{{ t('admin.arenaAntiWintrade.type') }}</th>
            <th>{{ t('admin.arenaAntiWintrade.attackerCharacterId') }}</th>
            <th>{{ t('admin.arenaAntiWintrade.defenderCharacterId') }}</th>
            <th>{{ t('admin.arenaAntiWintrade.status') }}</th>
            <th>{{ t('admin.arenaAntiWintrade.createdAt') }}</th>
            <th>{{ t('admin.arenaAntiWintrade.actions') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="a in alerts"
            :key="a.id"
            class="border-b border-ink-300/20"
            data-testid="admin-arena-anti-wintrade-alert-row"
          >
            <td :class="severityClass(a.severity)">{{ a.severity }}</td>
            <td class="text-xs">{{ a.type }}</td>
            <td class="text-xs">{{ a.attackerCharacterId ?? '—' }}</td>
            <td class="text-xs">{{ a.defenderCharacterId ?? '—' }}</td>
            <td :class="statusClass(a.status)">{{ a.status }}</td>
            <td class="text-xs">{{ new Date(a.createdAt).toLocaleString() }}</td>
            <td class="space-x-1">
              <button
                v-if="a.status === 'OPEN'"
                class="px-2 py-0.5 bg-amber-500/60 text-ink-900 rounded text-xs"
                data-testid="admin-arena-anti-wintrade-alert-ack"
                @click="ackAlert(a.id)"
              >
                {{ t('admin.arenaAntiWintrade.ack') }}
              </button>
              <button
                v-if="a.status !== 'RESOLVED'"
                class="px-2 py-0.5 bg-emerald-500/60 text-ink-900 rounded text-xs"
                data-testid="admin-arena-anti-wintrade-alert-resolve"
                @click="resolveAlert(a.id)"
              >
                {{ t('admin.arenaAntiWintrade.resolve') }}
              </button>
            </td>
          </tr>
        </tbody>
      </table>
    </section>
  </div>
</template>
