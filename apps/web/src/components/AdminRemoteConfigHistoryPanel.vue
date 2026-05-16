<script setup lang="ts">
/**
 * Phase 45.0 finish — Admin Remote Config History panel.
 *
 * Read-only audit log viewer cho `ADMIN_REMOTE_CONFIG_*` actions. Gọi
 * `GET /admin/remote-config/audit` (`@RequireAdmin`). Không lộ secret —
 * payload `value/reason` đã được admin tự nhập khi commit mutation. Pattern
 * mirror các Phase 15.x admin audit views, có search theo key + filter
 * theo action + cap rows mặc định 50, tối đa 200.
 *
 * UI nhẹ: list rows + filter — không edit. Format `value` theo type:
 *   - string/number/boolean → inline display.
 *   - object/array → JSON pretty + truncate (200 chars).
 *   - null/undefined → placeholder `—`.
 *
 * I18n VI/EN parity qua `adminRemoteConfigHistory.*`.
 */
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import {
  adminListRemoteConfigAudit,
  type AdminRemoteConfigAuditFilter,
  type RemoteConfigAuditEntry,
} from '@/api/remoteConfig';
import { useToastStore } from '@/stores/toast';
import { extractApiErrorCodeOrDefault } from '@/lib/apiError';
import MButton from '@/components/ui/MButton.vue';

const { t } = useI18n();
const toast = useToastStore();

const entries = ref<RemoteConfigAuditEntry[]>([]);
const loading = ref(true);
const error = ref<string | null>(null);

const keyFilter = ref('');
const actionFilter = ref<'' | RemoteConfigAuditEntry['action']>('');
const limit = ref(50);

const actionLabel = computed(() => {
  return (action: RemoteConfigAuditEntry['action']): string => {
    switch (action) {
      case 'ADMIN_REMOTE_CONFIG_UPDATE':
        return t('adminRemoteConfigHistory.filter.actionUpdate');
      case 'ADMIN_REMOTE_CONFIG_REFRESH_DEFAULTS':
        return t('adminRemoteConfigHistory.filter.actionRefreshDefaults');
      case 'ADMIN_REMOTE_CONFIG_CLEAR_CACHE':
        return t('adminRemoteConfigHistory.filter.actionClearCache');
      default:
        return action;
    }
  };
});

function formatValue(v: unknown): string {
  if (v === null || v === undefined) {
    return t('adminRemoteConfigHistory.row.valuePlaceholder');
  }
  if (typeof v === 'string') return v.length > 200 ? `${v.slice(0, 200)}…` : v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  try {
    const s = JSON.stringify(v);
    return s.length > 200 ? `${s.slice(0, 200)}…` : s;
  } catch {
    return String(v);
  }
}

function fmtAt(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString();
}

function clamp(n: number, min: number, max: number): number {
  if (!Number.isFinite(n)) return min;
  return Math.min(Math.max(Math.floor(n), min), max);
}

async function refresh(): Promise<void> {
  loading.value = true;
  error.value = null;
  const filter: AdminRemoteConfigAuditFilter = {};
  const key = keyFilter.value.trim();
  if (key) filter.key = key;
  if (actionFilter.value) filter.action = actionFilter.value;
  filter.limit = clamp(Number(limit.value) || 50, 1, 200);
  try {
    entries.value = await adminListRemoteConfigAudit(filter);
  } catch (e) {
    const code = extractApiErrorCodeOrDefault(e, 'UNKNOWN');
    error.value = code;
    toast.push({
      type: 'error',
      text:
        t(`adminRemoteConfigHistory.errors.${code}`, '__missing__') ===
        '__missing__'
          ? t('adminRemoteConfigHistory.errors.UNKNOWN')
          : t(`adminRemoteConfigHistory.errors.${code}`),
    });
  } finally {
    loading.value = false;
  }
}

onMounted(() => {
  void refresh();
});
</script>

<template>
  <section
    class="space-y-3 bg-ink-700/30 border border-ink-300/20 rounded p-3"
    data-testid="admin-remote-config-history-panel"
  >
    <header class="flex flex-wrap items-center justify-between gap-2">
      <div>
        <h2 class="text-lg text-amber-200">
          {{ t('adminRemoteConfigHistory.title') }}
        </h2>
        <p class="text-xs text-ink-300">
          {{ t('adminRemoteConfigHistory.hint') }}
        </p>
      </div>
      <div class="flex flex-wrap items-center gap-2">
        <MButton
          :disabled="loading"
          data-testid="admin-remote-config-history-apply"
          @click="refresh"
        >
          {{ t('adminRemoteConfigHistory.filter.apply') }}
        </MButton>
      </div>
    </header>

    <div
      class="flex flex-wrap items-end gap-2 text-sm"
      data-testid="admin-remote-config-history-filters"
    >
      <label class="flex flex-col gap-1">
        <span class="text-xs text-ink-300">{{
          t('adminRemoteConfigHistory.columns.key')
        }}</span>
        <input
          v-model="keyFilter"
          type="text"
          :placeholder="t('adminRemoteConfigHistory.filter.keyPlaceholder')"
          class="bg-ink-700/40 border border-ink-300/30 rounded px-2 py-1"
          data-testid="admin-remote-config-history-key"
        />
      </label>
      <label class="flex flex-col gap-1">
        <span class="text-xs text-ink-300">{{
          t('adminRemoteConfigHistory.filter.actionLabel')
        }}</span>
        <select
          v-model="actionFilter"
          class="bg-ink-700/40 border border-ink-300/30 rounded px-2 py-1"
          data-testid="admin-remote-config-history-action"
        >
          <option value="">
            {{ t('adminRemoteConfigHistory.filter.actionAll') }}
          </option>
          <option value="ADMIN_REMOTE_CONFIG_UPDATE">
            {{ t('adminRemoteConfigHistory.filter.actionUpdate') }}
          </option>
          <option value="ADMIN_REMOTE_CONFIG_REFRESH_DEFAULTS">
            {{ t('adminRemoteConfigHistory.filter.actionRefreshDefaults') }}
          </option>
          <option value="ADMIN_REMOTE_CONFIG_CLEAR_CACHE">
            {{ t('adminRemoteConfigHistory.filter.actionClearCache') }}
          </option>
        </select>
      </label>
      <label class="flex flex-col gap-1">
        <span class="text-xs text-ink-300">{{
          t('adminRemoteConfigHistory.filter.limitLabel')
        }}</span>
        <input
          v-model.number="limit"
          type="number"
          min="1"
          max="200"
          class="bg-ink-700/40 border border-ink-300/30 rounded px-2 py-1 w-24"
          data-testid="admin-remote-config-history-limit"
        />
      </label>
    </div>

    <div
      v-if="loading"
      class="text-ink-300 text-sm"
      data-testid="admin-remote-config-history-loading"
    >
      {{ t('adminRemoteConfigHistory.loading') }}
    </div>
    <div
      v-else-if="error"
      class="text-rose-400 text-sm"
      data-testid="admin-remote-config-history-error"
    >
      {{
        t(`adminRemoteConfigHistory.errors.${error}`, '__missing__') ===
          '__missing__'
          ? t('adminRemoteConfigHistory.errors.UNKNOWN')
          : t(`adminRemoteConfigHistory.errors.${error}`)
      }}
    </div>
    <div
      v-else-if="entries.length === 0"
      class="text-ink-300 text-sm italic"
      data-testid="admin-remote-config-history-empty"
    >
      {{ t('adminRemoteConfigHistory.empty') }}
    </div>
    <div v-else class="overflow-x-auto">
      <table
        class="w-full text-xs text-left border-collapse"
        data-testid="admin-remote-config-history-table"
      >
        <thead>
          <tr class="border-b border-ink-300/30 text-ink-300">
            <th class="py-1 pr-2 font-medium">
              {{ t('adminRemoteConfigHistory.columns.changedAt') }}
            </th>
            <th class="py-1 pr-2 font-medium">
              {{ t('adminRemoteConfigHistory.columns.actor') }}
            </th>
            <th class="py-1 pr-2 font-medium">
              {{ t('adminRemoteConfigHistory.columns.action') }}
            </th>
            <th class="py-1 pr-2 font-medium">
              {{ t('adminRemoteConfigHistory.columns.key') }}
            </th>
            <th class="py-1 pr-2 font-medium">
              {{ t('adminRemoteConfigHistory.columns.value') }}
            </th>
            <th class="py-1 pr-2 font-medium">
              {{ t('adminRemoteConfigHistory.columns.reason') }}
            </th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="entry in entries"
            :key="entry.id"
            class="border-b border-ink-300/10 align-top"
            :data-testid="`admin-remote-config-history-row-${entry.id}`"
          >
            <td class="py-1 pr-2 text-ink-200 whitespace-nowrap">
              {{ fmtAt(entry.createdAt) }}
            </td>
            <td class="py-1 pr-2 font-mono text-ink-200">
              {{ entry.actorUserId }}
            </td>
            <td class="py-1 pr-2 text-amber-200">
              {{ actionLabel(entry.action) }}
            </td>
            <td class="py-1 pr-2 font-mono text-ink-100">
              {{ entry.key ?? t('adminRemoteConfigHistory.row.noKey') }}
            </td>
            <td class="py-1 pr-2 font-mono text-emerald-200 break-all">
              {{ formatValue(entry.value) }}
            </td>
            <td class="py-1 pr-2 text-ink-200">
              {{ entry.reason ?? t('adminRemoteConfigHistory.row.noReason') }}
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </section>
</template>
