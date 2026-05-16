<script setup lang="ts">
/**
 * Phase 41.0 — Admin Feedback moderation view.
 *
 * List + filter by status/type + admin patch (status/severity/note).
 * Admin permission enforced server-side; UI ẩn nếu user không role MOD/ADMIN.
 */
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import AppShell from '@/components/shell/AppShell.vue';
import XTPageEyebrow from '@/components/xianxia/XTPageEyebrow.vue';
import LoadingState from '@/components/ui/LoadingState.vue';
import EmptyState from '@/components/ui/EmptyState.vue';
import ErrorState from '@/components/ui/ErrorState.vue';
import { useAuthStore } from '@/stores/auth';
import { useToastStore } from '@/stores/toast';
import { extractApiErrorCodeOrDefault } from '@/lib/apiError';
import {
  FEEDBACK_SEVERITIES,
  FEEDBACK_STATUSES,
  FEEDBACK_TYPES,
  type FeedbackSeverity,
  type FeedbackStatus,
  type FeedbackType,
  type PlayerFeedbackRow,
} from '@xuantoi/shared';
import {
  adminListFeedback,
  adminPatchFeedback,
} from '@/api/playerExperience';

const { t } = useI18n();
const auth = useAuthStore();
const toast = useToastStore();

const loading = ref(true);
const errorKey = ref<string | null>(null);
const rows = ref<PlayerFeedbackRow[]>([]);
const filterStatus = ref<FeedbackStatus | ''>('');
const filterType = ref<FeedbackType | ''>('');
const total = ref(0);

const isAdmin = computed(
  () => auth.user?.role === 'MOD' || auth.user?.role === 'ADMIN',
);

async function load(): Promise<void> {
  loading.value = true;
  errorKey.value = null;
  try {
    const res = await adminListFeedback({
      limit: 20,
      status: filterStatus.value === '' ? null : filterStatus.value,
      type: filterType.value === '' ? null : filterType.value,
    });
    rows.value = res.feedback;
    total.value = res.total;
  } catch (e) {
    const code = extractApiErrorCodeOrDefault(e, 'UNKNOWN');
    errorKey.value = `adminFeedback.errors.${code}`;
  } finally {
    loading.value = false;
  }
}

async function patchStatus(row: PlayerFeedbackRow, status: FeedbackStatus): Promise<void> {
  try {
    const updated = await adminPatchFeedback(row.id, { status });
    const idx = rows.value.findIndex((r) => r.id === row.id);
    if (idx >= 0) rows.value[idx] = updated;
    toast.push({ type: 'success', text: t('adminFeedback.patched') });
  } catch (e) {
    const code = extractApiErrorCodeOrDefault(e, 'UNKNOWN');
    toast.push({
      type: 'error',
      text: t(`adminFeedback.errors.${code}`, t('adminFeedback.errors.UNKNOWN')),
    });
  }
}

async function patchSeverity(
  row: PlayerFeedbackRow,
  severity: FeedbackSeverity,
): Promise<void> {
  try {
    const updated = await adminPatchFeedback(row.id, { severity });
    const idx = rows.value.findIndex((r) => r.id === row.id);
    if (idx >= 0) rows.value[idx] = updated;
  } catch (e) {
    const code = extractApiErrorCodeOrDefault(e, 'UNKNOWN');
    toast.push({
      type: 'error',
      text: t(`adminFeedback.errors.${code}`, t('adminFeedback.errors.UNKNOWN')),
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
        <XTPageEyebrow label="Dân Ý Tham Vấn" />
        <h1 class="text-2xl tracking-widest font-bold mt-1">{{ t('adminFeedback.title') }}</h1>
        <p class="text-xs text-ink-300 mt-1">{{ t('adminFeedback.subtitle') }}</p>
      </header>

      <EmptyState
        v-if="!isAdmin"
        title-key="adminFeedback.notAdminTitle"
        description-key="adminFeedback.notAdminDescription"
        data-testid="admin-feedback-forbidden"
      />

      <template v-else>
        <div class="flex flex-wrap gap-2 text-xs">
          <select
            v-model="filterStatus"
            class="bg-ink-700/40 border border-ink-300/30 rounded px-2 py-1"
            @change="load()"
          >
            <option value="">{{ t('feedback.list.allStatuses') }}</option>
            <option v-for="st in FEEDBACK_STATUSES" :key="st" :value="st">
              {{ t(`feedback.statuses.${st}`) }}
            </option>
          </select>
          <select
            v-model="filterType"
            class="bg-ink-700/40 border border-ink-300/30 rounded px-2 py-1"
            @change="load()"
          >
            <option value="">{{ t('adminFeedback.allTypes') }}</option>
            <option v-for="ty in FEEDBACK_TYPES" :key="ty" :value="ty">
              {{ t(`feedback.types.${ty}`) }}
            </option>
          </select>
          <span class="text-ink-300 self-center">
            {{ t('adminFeedback.total', { count: total }) }}
          </span>
        </div>

        <LoadingState v-if="loading" data-testid="admin-feedback-loading" />
        <ErrorState
          v-else-if="errorKey"
          :error-key="errorKey"
          data-testid="admin-feedback-error"
          @retry="load()"
        />
        <EmptyState
          v-else-if="rows.length === 0"
          title-key="adminFeedback.emptyTitle"
          description-key="adminFeedback.emptyDescription"
          data-testid="admin-feedback-empty"
        />
        <ul v-else class="space-y-2">
          <li
            v-for="row in rows"
            :key="row.id"
            data-testid="admin-feedback-item"
            class="bg-ink-700/30 border border-ink-300/20 rounded p-3 text-sm space-y-2"
          >
            <div class="flex items-center justify-between">
              <span class="text-amber-200">{{ row.title }}</span>
              <span class="text-xs text-ink-300">
                {{ row.reporterDisplayName ?? row.reporterCharacterId }} ·
                {{ new Date(row.createdAt).toLocaleString() }}
              </span>
            </div>
            <p class="whitespace-pre-line">{{ row.description }}</p>
            <div class="flex gap-2 text-xs items-center">
              <select
                :value="row.status"
                class="bg-ink-700/40 border border-ink-300/30 rounded px-2 py-1"
                @change="
                  patchStatus(row, ($event.target as HTMLSelectElement).value as FeedbackStatus)
                "
              >
                <option v-for="st in FEEDBACK_STATUSES" :key="st" :value="st">
                  {{ t(`feedback.statuses.${st}`) }}
                </option>
              </select>
              <select
                :value="row.severity"
                class="bg-ink-700/40 border border-ink-300/30 rounded px-2 py-1"
                @change="
                  patchSeverity(
                    row,
                    ($event.target as HTMLSelectElement).value as FeedbackSeverity,
                  )
                "
              >
                <option v-for="sv in FEEDBACK_SEVERITIES" :key="sv" :value="sv">
                  {{ t(`feedback.severities.${sv}`) }}
                </option>
              </select>
              <span class="text-ink-300">
                {{ t(`feedback.types.${row.type}`) }}
              </span>
            </div>
          </li>
        </ul>
      </template>
    </div>
  </AppShell>
</template>
