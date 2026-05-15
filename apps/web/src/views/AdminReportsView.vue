<script setup lang="ts">
/**
 * Phase 41.0 — Admin Player Report moderation view.
 *
 * List + filter by status; admin patch status/note. KHÔNG auto-ban
 * target. Action ban thuộc admin user module ngoài Phase 41.0.
 */
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import AppShell from '@/components/shell/AppShell.vue';
import XTHeroEyebrow from '@/components/xianxia/XTHeroEyebrow.vue';
import LoadingState from '@/components/ui/LoadingState.vue';
import EmptyState from '@/components/ui/EmptyState.vue';
import ErrorState from '@/components/ui/ErrorState.vue';
import { useAuthStore } from '@/stores/auth';
import { useToastStore } from '@/stores/toast';
import { extractApiErrorCodeOrDefault } from '@/lib/apiError';
import {
  PLAYER_REPORT_STATUSES,
  type PlayerReportRow,
  type PlayerReportStatus,
} from '@xuantoi/shared';
import { adminListReports, adminPatchReport } from '@/api/playerExperience';

const { t } = useI18n();
const auth = useAuthStore();
const toast = useToastStore();

const loading = ref(true);
const errorKey = ref<string | null>(null);
const rows = ref<PlayerReportRow[]>([]);
const filterStatus = ref<PlayerReportStatus | ''>('');
const total = ref(0);

const isAdmin = computed(
  () => auth.user?.role === 'MOD' || auth.user?.role === 'ADMIN',
);

async function load(): Promise<void> {
  loading.value = true;
  errorKey.value = null;
  try {
    const res = await adminListReports({
      limit: 20,
      status: filterStatus.value === '' ? null : filterStatus.value,
    });
    rows.value = res.reports;
    total.value = res.total;
  } catch (e) {
    const code = extractApiErrorCodeOrDefault(e, 'UNKNOWN');
    errorKey.value = `adminReports.errors.${code}`;
  } finally {
    loading.value = false;
  }
}

async function patchStatus(row: PlayerReportRow, status: PlayerReportStatus): Promise<void> {
  try {
    const updated = await adminPatchReport(row.id, { status });
    const idx = rows.value.findIndex((r) => r.id === row.id);
    if (idx >= 0) rows.value[idx] = updated;
    toast.push({ type: 'success', text: t('adminReports.patched') });
  } catch (e) {
    const code = extractApiErrorCodeOrDefault(e, 'UNKNOWN');
    toast.push({
      type: 'error',
      text: t(`adminReports.errors.${code}`, t('adminReports.errors.UNKNOWN')),
    });
  }
}

onMounted(() => {
  if (isAdmin.value) void load();
  else loading.value = false;
});
</script>

<template>
  <AppShell>
    <div class="max-w-5xl mx-auto space-y-4">
      <header>
        <XTHeroEyebrow han="御史台" label="Ngự Sử Đài" />
        <h1 class="text-2xl tracking-widest font-bold mt-1">{{ t('adminReports.title') }}</h1>
        <p class="text-xs text-ink-300 mt-1">{{ t('adminReports.subtitle') }}</p>
      </header>

      <EmptyState
        v-if="!isAdmin"
        title-key="adminReports.notAdminTitle"
        description-key="adminReports.notAdminDescription"
        data-testid="admin-reports-forbidden"
      />

      <template v-else>
        <div class="flex flex-wrap gap-2 text-xs">
          <select
            v-model="filterStatus"
            class="bg-ink-700/40 border border-ink-300/30 rounded px-2 py-1"
            @change="load()"
          >
            <option value="">{{ t('adminReports.allStatuses') }}</option>
            <option v-for="st in PLAYER_REPORT_STATUSES" :key="st" :value="st">
              {{ t(`report.statuses.${st}`) }}
            </option>
          </select>
          <span class="text-ink-300 self-center">
            {{ t('adminReports.total', { count: total }) }}
          </span>
        </div>

        <LoadingState v-if="loading" data-testid="admin-reports-loading" />
        <ErrorState
          v-else-if="errorKey"
          :error-key="errorKey"
          data-testid="admin-reports-error"
          @retry="load()"
        />
        <EmptyState
          v-else-if="rows.length === 0"
          title-key="adminReports.emptyTitle"
          description-key="adminReports.emptyDescription"
          data-testid="admin-reports-empty"
        />
        <ul v-else class="space-y-2">
          <li
            v-for="row in rows"
            :key="row.id"
            data-testid="admin-reports-item"
            class="bg-ink-700/30 border border-ink-300/20 rounded p-3 text-sm space-y-2"
          >
            <div class="flex items-center justify-between">
              <span class="text-amber-200">
                {{ row.reporterDisplayName ?? row.reporterCharacterId }} →
                {{ row.targetDisplayName ?? row.targetCharacterId }}
              </span>
              <span class="text-xs text-ink-300">
                {{ t(`report.types.${row.reportType}`) }} ·
                {{ new Date(row.createdAt).toLocaleString() }}
              </span>
            </div>
            <p class="whitespace-pre-line">{{ row.description }}</p>
            <div class="flex gap-2 text-xs">
              <select
                :value="row.status"
                class="bg-ink-700/40 border border-ink-300/30 rounded px-2 py-1"
                @change="
                  patchStatus(
                    row,
                    ($event.target as HTMLSelectElement).value as PlayerReportStatus,
                  )
                "
              >
                <option v-for="st in PLAYER_REPORT_STATUSES" :key="st" :value="st">
                  {{ t(`report.statuses.${st}`) }}
                </option>
              </select>
            </div>
          </li>
        </ul>
      </template>
    </div>
  </AppShell>
</template>
