<script setup lang="ts">
/**
 * Phase 18.3 — SecurityAlertPanel.
 *
 * Operational dashboard cho admin: theo dõi + phân loại + acknowledge /
 * resolve các SecurityAlert (severity WARN / CRITICAL) sinh ra từ
 * SecurityEvent (rate-limit abuse, login abuse, refresh-token reuse,
 * session suspicious, IP/USER block, admin forbidden, …).
 *
 * Layout:
 *   - Summary cards (openCritical / openWarn / blockedSubjects /
 *     tokenReuse24h / suspicious24h / rateLimitHits24h + generatedAt).
 *   - Filter bar (status / severity / type / source / from / to /
 *     userId / limit).
 *   - Alert table (id / type / severity / status / source / createdAt /
 *     actions).
 *   - Ack & Resolve modals (Resolve có note bắt buộc).
 *
 * Privacy:
 *   - Không hiển thị raw IP — chỉ user/session id (ko sensitive ở app
 *     scope).
 *   - `detailsJson` đã sanitize ở BE.
 *
 * i18n parity: `adminSecurityAlerts.*` (vi/en).
 */
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useToastStore } from '@/stores/toast';
import { extractApiErrorCodeOrDefault } from '@/lib/apiError';
import MButton from '@/components/ui/MButton.vue';
import ConfirmModal from '@/components/ui/ConfirmModal.vue';
import {
  adminAcknowledgeSecurityAlert,
  adminGetSecuritySummary,
  adminListSecurityAlerts,
  adminResolveSecurityAlert,
  type AdminSecurityAlertRow,
  type AdminSecurityAlertSummary,
  type SecurityAlertSeverity,
  type SecurityAlertSource,
  type SecurityAlertStatus,
  type SecurityAlertType,
} from '@/api/adminSecurity';

const { t } = useI18n();
const toast = useToastStore();

// ---------------- state ----------------

const summary = ref<AdminSecurityAlertSummary | null>(null);
const summaryLoading = ref(true);
const summaryError = ref<string | null>(null);

const alerts = ref<AdminSecurityAlertRow[]>([]);
const alertsLoading = ref(true);
const alertsError = ref<string | null>(null);
const nextCursor = ref<string | null>(null);

const filterStatus = ref<SecurityAlertStatus | 'ALL'>('OPEN');
const filterSeverity = ref<SecurityAlertSeverity | 'ALL'>('ALL');
const filterType = ref<SecurityAlertType | 'ALL'>('ALL');
const filterSource = ref<SecurityAlertSource | 'ALL'>('ALL');
const filterFrom = ref<string>('');
const filterTo = ref<string>('');
const filterUserId = ref<string>('');
const filterLimit = ref(50);

const pendingAck = ref<AdminSecurityAlertRow | null>(null);
const pendingResolve = ref<AdminSecurityAlertRow | null>(null);
const resolveNote = ref<string>('');
const mutatingId = ref<string | null>(null);

const ALERT_TYPES: SecurityAlertType[] = [
  'RATE_LIMIT_ABUSE',
  'LOGIN_ABUSE',
  'INVALID_TOKEN',
  'ADMIN_FORBIDDEN',
  'SUBJECT_BLOCKED',
  'BLOCK_LIFTED',
  'SESSION_CREATED',
  'SESSION_REVOKED',
  'REFRESH_TOKEN_REUSED',
  'SESSION_SUSPICIOUS',
  'OTHER',
];
const ALERT_SOURCES: SecurityAlertSource[] = [
  'RATE_LIMIT',
  'AUTH',
  'SESSION',
  'ADMIN',
  'BLOCK',
  'OTHER',
];

// ---------------- data load ----------------

async function refreshSummary(): Promise<void> {
  summaryLoading.value = true;
  summaryError.value = null;
  try {
    summary.value = await adminGetSecuritySummary();
  } catch (e) {
    summaryError.value = extractApiErrorCodeOrDefault(e, 'UNKNOWN');
  } finally {
    summaryLoading.value = false;
  }
}

async function refreshAlerts(): Promise<void> {
  alertsLoading.value = true;
  alertsError.value = null;
  try {
    const res = await adminListSecurityAlerts({
      status: filterStatus.value === 'ALL' ? undefined : filterStatus.value,
      severity:
        filterSeverity.value === 'ALL' ? undefined : filterSeverity.value,
      type: filterType.value === 'ALL' ? undefined : filterType.value,
      source: filterSource.value === 'ALL' ? undefined : filterSource.value,
      from: filterFrom.value.trim() || undefined,
      to: filterTo.value.trim() || undefined,
      userId: filterUserId.value.trim() || undefined,
      limit: filterLimit.value,
    });
    alerts.value = res.alerts;
    nextCursor.value = res.nextCursor;
  } catch (e) {
    alertsError.value = extractApiErrorCodeOrDefault(e, 'UNKNOWN');
  } finally {
    alertsLoading.value = false;
  }
}

async function applyFilters(): Promise<void> {
  await Promise.all([refreshSummary(), refreshAlerts()]);
}

// ---------------- mutations ----------------

function openAckConfirm(alert: AdminSecurityAlertRow): void {
  pendingAck.value = alert;
}

function openResolveConfirm(alert: AdminSecurityAlertRow): void {
  pendingResolve.value = alert;
  resolveNote.value = '';
}

function cancelAck(): void {
  pendingAck.value = null;
}

function cancelResolve(): void {
  pendingResolve.value = null;
  resolveNote.value = '';
}

async function doAck(): Promise<void> {
  const alert = pendingAck.value;
  if (!alert) return;
  mutatingId.value = alert.id;
  try {
    const updated = await adminAcknowledgeSecurityAlert(alert.id);
    alerts.value = alerts.value.map((a) => (a.id === updated.id ? updated : a));
    toast.push({
      type: 'success',
      text: t('adminSecurityAlerts.ack.success', { id: alert.id }),
    });
    void refreshSummary();
  } catch (e) {
    pushApiErr(e);
  } finally {
    mutatingId.value = null;
    pendingAck.value = null;
  }
}

async function doResolve(): Promise<void> {
  const alert = pendingResolve.value;
  if (!alert) return;
  const note = resolveNote.value.trim();
  if (!note) {
    toast.push({
      type: 'error',
      text: t('adminSecurityAlerts.errors.INVALID_NOTE'),
    });
    return;
  }
  mutatingId.value = alert.id;
  try {
    const updated = await adminResolveSecurityAlert(alert.id, note);
    alerts.value = alerts.value.map((a) => (a.id === updated.id ? updated : a));
    toast.push({
      type: 'success',
      text: t('adminSecurityAlerts.resolve.success', { id: alert.id }),
    });
    void refreshSummary();
  } catch (e) {
    pushApiErr(e);
  } finally {
    mutatingId.value = null;
    pendingResolve.value = null;
    resolveNote.value = '';
  }
}

function pushApiErr(e: unknown): void {
  const code = extractApiErrorCodeOrDefault(e, 'UNKNOWN');
  toast.push({
    type: 'error',
    text:
      t(`adminSecurityAlerts.errors.${code}`, '__missing__') === '__missing__'
        ? t('adminSecurityAlerts.errors.UNKNOWN')
        : t(`adminSecurityAlerts.errors.${code}`),
  });
}

// ---------------- view helpers ----------------

function fmtDate(s: string | null): string {
  if (!s) return '—';
  try {
    return new Date(s).toLocaleString();
  } catch {
    return s;
  }
}

const summaryErrorText = computed(() =>
  summaryError.value
    ? t(`adminSecurityAlerts.errors.${summaryError.value}`, '__missing__') !==
      '__missing__'
      ? t(`adminSecurityAlerts.errors.${summaryError.value}`)
      : t('adminSecurityAlerts.errors.UNKNOWN')
    : '',
);

const alertsErrorText = computed(() =>
  alertsError.value
    ? t(`adminSecurityAlerts.errors.${alertsError.value}`, '__missing__') !==
      '__missing__'
      ? t(`adminSecurityAlerts.errors.${alertsError.value}`)
      : t('adminSecurityAlerts.errors.UNKNOWN')
    : '',
);

onMounted(() => {
  void refreshSummary();
  void refreshAlerts();
});
</script>

<template>
  <div class="space-y-4" data-testid="security-alert-panel">
    <header class="space-y-1">
      <h2 class="text-lg text-amber-200">
        {{ t('adminSecurityAlerts.title') }}
      </h2>
      <p class="text-xs text-ink-300">
        {{ t('adminSecurityAlerts.subtitle') }}
      </p>
    </header>

    <!-- SUMMARY CARDS -->
    <section
      class="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-2"
      data-testid="security-alert-summary"
    >
      <div
        v-if="summaryLoading"
        class="text-xs text-ink-300 col-span-full"
        data-testid="summary-loading"
      >
        {{ t('adminSecurityAlerts.summary.loading') }}
      </div>
      <div
        v-else-if="summaryError"
        class="text-xs text-red-400 col-span-full"
        data-testid="summary-error"
      >
        {{ summaryErrorText }}
      </div>
      <template v-else-if="summary">
        <div
          class="bg-red-900/30 border border-red-500/40 rounded p-2"
          data-testid="card-open-critical"
        >
          <div class="text-xs text-red-200">
            {{ t('adminSecurityAlerts.summary.openCritical') }}
          </div>
          <div class="text-2xl text-red-100">{{ summary.openCritical }}</div>
        </div>
        <div
          class="bg-amber-900/30 border border-amber-500/40 rounded p-2"
          data-testid="card-open-warn"
        >
          <div class="text-xs text-amber-200">
            {{ t('adminSecurityAlerts.summary.openWarn') }}
          </div>
          <div class="text-2xl text-amber-100">{{ summary.openWarn }}</div>
        </div>
        <div
          class="bg-ink-700/40 border border-ink-300/20 rounded p-2"
          data-testid="card-blocked"
        >
          <div class="text-xs text-ink-300">
            {{ t('adminSecurityAlerts.summary.blockedSubjects') }}
          </div>
          <div class="text-2xl">{{ summary.blockedSubjects }}</div>
        </div>
        <div
          class="bg-ink-700/40 border border-ink-300/20 rounded p-2"
          data-testid="card-token-reuse"
        >
          <div class="text-xs text-ink-300">
            {{ t('adminSecurityAlerts.summary.tokenReuse24h') }}
          </div>
          <div class="text-2xl">{{ summary.tokenReuseLast24h }}</div>
        </div>
        <div
          class="bg-ink-700/40 border border-ink-300/20 rounded p-2"
          data-testid="card-suspicious"
        >
          <div class="text-xs text-ink-300">
            {{ t('adminSecurityAlerts.summary.suspicious24h') }}
          </div>
          <div class="text-2xl">
            {{ summary.suspiciousSessionsLast24h }}
          </div>
        </div>
        <div
          class="bg-ink-700/40 border border-ink-300/20 rounded p-2"
          data-testid="card-rate-limit"
        >
          <div class="text-xs text-ink-300">
            {{ t('adminSecurityAlerts.summary.rateLimitHits24h') }}
          </div>
          <div class="text-2xl">{{ summary.rateLimitHitsLast24h }}</div>
        </div>
      </template>
    </section>

    <!-- FILTERS -->
    <section
      class="bg-ink-700/30 border border-ink-300/20 rounded p-3 text-sm flex flex-wrap items-end gap-3"
      data-testid="security-alert-filters"
    >
      <label class="flex flex-col gap-1">
        <span class="text-ink-300 text-xs">{{
          t('adminSecurityAlerts.filters.status')
        }}</span>
        <select
          v-model="filterStatus"
          class="bg-ink-700/40 border border-ink-300/30 rounded px-2 py-1"
          data-testid="filter-status"
        >
          <option value="ALL">{{ t('adminSecurityAlerts.filters.all') }}</option>
          <option value="OPEN">OPEN</option>
          <option value="ACKNOWLEDGED">ACKNOWLEDGED</option>
          <option value="RESOLVED">RESOLVED</option>
        </select>
      </label>
      <label class="flex flex-col gap-1">
        <span class="text-ink-300 text-xs">{{
          t('adminSecurityAlerts.filters.severity')
        }}</span>
        <select
          v-model="filterSeverity"
          class="bg-ink-700/40 border border-ink-300/30 rounded px-2 py-1"
          data-testid="filter-severity"
        >
          <option value="ALL">{{ t('adminSecurityAlerts.filters.all') }}</option>
          <option value="INFO">INFO</option>
          <option value="WARN">WARN</option>
          <option value="CRITICAL">CRITICAL</option>
        </select>
      </label>
      <label class="flex flex-col gap-1">
        <span class="text-ink-300 text-xs">{{
          t('adminSecurityAlerts.filters.type')
        }}</span>
        <select
          v-model="filterType"
          class="bg-ink-700/40 border border-ink-300/30 rounded px-2 py-1"
          data-testid="filter-type"
        >
          <option value="ALL">{{ t('adminSecurityAlerts.filters.all') }}</option>
          <option v-for="ty in ALERT_TYPES" :key="ty" :value="ty">{{ ty }}</option>
        </select>
      </label>
      <label class="flex flex-col gap-1">
        <span class="text-ink-300 text-xs">{{
          t('adminSecurityAlerts.filters.source')
        }}</span>
        <select
          v-model="filterSource"
          class="bg-ink-700/40 border border-ink-300/30 rounded px-2 py-1"
          data-testid="filter-source"
        >
          <option value="ALL">{{ t('adminSecurityAlerts.filters.all') }}</option>
          <option v-for="s in ALERT_SOURCES" :key="s" :value="s">{{ s }}</option>
        </select>
      </label>
      <label class="flex flex-col gap-1">
        <span class="text-ink-300 text-xs">{{
          t('adminSecurityAlerts.filters.from')
        }}</span>
        <input
          v-model="filterFrom"
          type="datetime-local"
          class="bg-ink-700/40 border border-ink-300/30 rounded px-2 py-1"
          data-testid="filter-from"
        />
      </label>
      <label class="flex flex-col gap-1">
        <span class="text-ink-300 text-xs">{{
          t('adminSecurityAlerts.filters.to')
        }}</span>
        <input
          v-model="filterTo"
          type="datetime-local"
          class="bg-ink-700/40 border border-ink-300/30 rounded px-2 py-1"
          data-testid="filter-to"
        />
      </label>
      <label class="flex flex-col gap-1">
        <span class="text-ink-300 text-xs">{{
          t('adminSecurityAlerts.filters.userId')
        }}</span>
        <input
          v-model="filterUserId"
          class="bg-ink-700/40 border border-ink-300/30 rounded px-2 py-1"
          placeholder="user-…"
          data-testid="filter-user-id"
        />
      </label>
      <label class="flex flex-col gap-1">
        <span class="text-ink-300 text-xs">{{
          t('adminSecurityAlerts.filters.limit')
        }}</span>
        <input
          v-model.number="filterLimit"
          type="number"
          min="1"
          max="200"
          class="bg-ink-700/40 border border-ink-300/30 rounded px-2 py-1 w-24"
          data-testid="filter-limit"
        />
      </label>
      <MButton
        data-testid="filter-apply"
        :disabled="alertsLoading || summaryLoading"
        @click="applyFilters"
      >
        {{ t('adminSecurityAlerts.filters.apply') }}
      </MButton>
    </section>

    <!-- ALERT TABLE -->
    <section class="space-y-2" data-testid="security-alert-list-section">
      <h3 class="text-base text-amber-200">
        {{ t('adminSecurityAlerts.list.title') }}
      </h3>
      <div
        v-if="alertsLoading"
        class="text-xs text-ink-300"
        data-testid="alerts-loading"
      >
        {{ t('adminSecurityAlerts.list.loading') }}
      </div>
      <div
        v-else-if="alertsError"
        class="text-xs text-red-400"
        data-testid="alerts-error"
      >
        {{ alertsErrorText }}
      </div>
      <div
        v-else-if="alerts.length === 0"
        class="text-xs text-ink-300"
        data-testid="alerts-empty"
      >
        {{ t('adminSecurityAlerts.list.empty') }}
      </div>
      <div v-else class="overflow-x-auto">
        <table class="w-full text-xs" data-testid="alerts-table">
          <thead>
            <tr class="text-ink-300">
              <th class="text-left p-2">
                {{ t('adminSecurityAlerts.list.id') }}
              </th>
              <th class="text-left p-2">
                {{ t('adminSecurityAlerts.list.type') }}
              </th>
              <th class="text-left p-2">
                {{ t('adminSecurityAlerts.list.severity') }}
              </th>
              <th class="text-left p-2">
                {{ t('adminSecurityAlerts.list.status') }}
              </th>
              <th class="text-left p-2">
                {{ t('adminSecurityAlerts.list.source') }}
              </th>
              <th class="text-left p-2">
                {{ t('adminSecurityAlerts.list.createdAt') }}
              </th>
              <th class="text-left p-2">
                {{ t('adminSecurityAlerts.list.actions') }}
              </th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="row in alerts"
              :key="row.id"
              class="border-t border-ink-300/10"
              :data-testid="`alert-row-${row.id}`"
            >
              <td class="p-2 font-mono">{{ row.id }}</td>
              <td class="p-2">{{ row.type }}</td>
              <td class="p-2">
                <span
                  :class="
                    row.severity === 'CRITICAL'
                      ? 'text-red-400'
                      : row.severity === 'WARN'
                        ? 'text-amber-300'
                        : 'text-ink-200'
                  "
                >{{ row.severity }}</span
                >
              </td>
              <td class="p-2">{{ row.status }}</td>
              <td class="p-2">{{ row.source }}</td>
              <td class="p-2">{{ fmtDate(row.createdAt) }}</td>
              <td class="p-2 flex gap-2">
                <MButton
                  v-if="row.status === 'OPEN'"
                  :disabled="mutatingId === row.id"
                  :data-testid="`ack-${row.id}`"
                  @click="openAckConfirm(row)"
                >
                  {{ t('adminSecurityAlerts.actions.ack') }}
                </MButton>
                <MButton
                  v-if="row.status !== 'RESOLVED'"
                  :disabled="mutatingId === row.id"
                  :data-testid="`resolve-${row.id}`"
                  @click="openResolveConfirm(row)"
                >
                  {{ t('adminSecurityAlerts.actions.resolve') }}
                </MButton>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>

    <!-- ACK CONFIRM MODAL -->
    <ConfirmModal
      :open="pendingAck !== null"
      :title="t('adminSecurityAlerts.ack.title')"
      :message="
        pendingAck
          ? t('adminSecurityAlerts.ack.message', { id: pendingAck.id })
          : ''
      "
      :loading="mutatingId !== null && pendingAck !== null"
      test-id="confirm-ack"
      @confirm="doAck"
      @cancel="cancelAck"
    />

    <!-- RESOLVE MODAL — needs a note text input -->
    <ConfirmModal
      :open="pendingResolve !== null"
      :title="t('adminSecurityAlerts.resolve.title')"
      :message="
        pendingResolve
          ? t('adminSecurityAlerts.resolve.message', { id: pendingResolve.id })
          : ''
      "
      :loading="mutatingId !== null && pendingResolve !== null"
      :danger="true"
      test-id="confirm-resolve"
      @confirm="doResolve"
      @cancel="cancelResolve"
    >
      <template #default>
        <label class="flex flex-col gap-1 text-xs mt-2">
          <span class="text-ink-300">{{
            t('adminSecurityAlerts.resolve.noteLabel')
          }}</span>
          <textarea
            v-model="resolveNote"
            rows="3"
            maxlength="1000"
            class="bg-ink-700/40 border border-ink-300/30 rounded px-2 py-1"
            data-testid="resolve-note-input"
            :placeholder="t('adminSecurityAlerts.resolve.notePlaceholder')"
          />
        </label>
      </template>
    </ConfirmModal>
  </div>
</template>
