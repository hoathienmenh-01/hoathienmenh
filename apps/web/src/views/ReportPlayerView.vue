<script setup lang="ts">
/**
 * Phase 41.0 — Player Report (player → player) view.
 *
 * Form gửi report tới một character cụ thể + danh sách report của user.
 * KHÔNG auto-ban; chỉ ghi nhận chờ admin review.
 */
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import AppShell from '@/components/shell/AppShell.vue';
import XTHeroEyebrow from '@/components/xianxia/XTHeroEyebrow.vue';
import MButton from '@/components/ui/MButton.vue';
import LoadingState from '@/components/ui/LoadingState.vue';
import EmptyState from '@/components/ui/EmptyState.vue';
import ErrorState from '@/components/ui/ErrorState.vue';
import { useToastStore } from '@/stores/toast';
import { extractApiErrorCodeOrDefault } from '@/lib/apiError';
import {
  PLAYER_REPORT_LIMITS,
  PLAYER_REPORT_TYPES,
  type PlayerReportRow,
  type PlayerReportType,
} from '@xuantoi/shared';
import {
  createPlayerReport,
  listMyReports,
  type PlayerReportCreatePayload,
} from '@/api/playerExperience';

const { t } = useI18n();
const toast = useToastStore();

const form = ref({
  targetCharacterId: '',
  reportType: 'HARASSMENT' as PlayerReportType,
  description: '',
});
const submitting = ref(false);

const listLoading = ref(true);
const listError = ref<string | null>(null);
const rows = ref<PlayerReportRow[]>([]);

const descTooShort = computed(
  () =>
    form.value.description.trim().length > 0 &&
    form.value.description.trim().length < PLAYER_REPORT_LIMITS.DESCRIPTION_MIN,
);

async function loadList(): Promise<void> {
  listLoading.value = true;
  listError.value = null;
  try {
    const res = await listMyReports({ limit: 20 });
    rows.value = res.reports;
  } catch (e) {
    const code = extractApiErrorCodeOrDefault(e, 'UNKNOWN');
    listError.value = `report.errors.${code}`;
  } finally {
    listLoading.value = false;
  }
}

async function submit(): Promise<void> {
  if (submitting.value) return;
  if (!form.value.targetCharacterId.trim() || descTooShort.value) {
    toast.push({ type: 'error', text: t('report.form.errors.tooShort') });
    return;
  }
  submitting.value = true;
  try {
    const payload: PlayerReportCreatePayload = {
      targetCharacterId: form.value.targetCharacterId.trim(),
      reportType: form.value.reportType,
      description: form.value.description.trim(),
    };
    const created = await createPlayerReport(payload);
    rows.value = [created, ...rows.value];
    form.value.targetCharacterId = '';
    form.value.description = '';
    toast.push({ type: 'success', text: t('report.form.submitted') });
  } catch (e) {
    const code = extractApiErrorCodeOrDefault(e, 'UNKNOWN');
    toast.push({
      type: 'error',
      text: t(`report.errors.${code}`, t('report.errors.UNKNOWN')),
    });
  } finally {
    submitting.value = false;
  }
}

onMounted(() => {
  void loadList();
});
</script>

<template>
  <AppShell>
    <div class="max-w-3xl mx-auto space-y-6">
      <header>
        <XTHeroEyebrow han="发許高谁" label="Phát Giác Cao Thùy" />
        <h1 class="text-2xl tracking-widest font-bold mt-1">{{ t('report.title') }}</h1>
        <p class="text-xs text-ink-300 mt-1">{{ t('report.subtitle') }}</p>
      </header>

      <section
        class="bg-ink-700/30 border border-ink-300/20 rounded p-4 space-y-3 text-sm"
        data-testid="report-form"
      >
        <h2 class="text-amber-200 text-base">{{ t('report.form.title') }}</h2>
        <label class="block">
          <span class="text-ink-300">{{ t('report.form.fields.targetCharacterId') }}</span>
          <input
            v-model="form.targetCharacterId"
            type="text"
            class="w-full bg-ink-700/40 border border-ink-300/30 rounded px-2 py-1 mt-1"
          />
        </label>
        <label class="block">
          <span class="text-ink-300">{{ t('report.form.fields.reportType') }}</span>
          <select
            v-model="form.reportType"
            class="w-full bg-ink-700/40 border border-ink-300/30 rounded px-2 py-1 mt-1"
          >
            <option v-for="ty in PLAYER_REPORT_TYPES" :key="ty" :value="ty">
              {{ t(`report.types.${ty}`) }}
            </option>
          </select>
        </label>
        <label class="block">
          <span class="text-ink-300">{{ t('report.form.fields.description') }}</span>
          <textarea
            v-model="form.description"
            rows="5"
            class="w-full bg-ink-700/40 border border-ink-300/30 rounded px-2 py-1 mt-1"
            :maxlength="PLAYER_REPORT_LIMITS.DESCRIPTION_MAX"
          />
          <span v-if="descTooShort" class="text-red-400 text-xs">
            {{ t('report.form.errors.tooShort') }}
          </span>
        </label>
        <MButton
          :disabled="
            submitting || descTooShort || !form.targetCharacterId.trim() || !form.description.trim()
          "
          data-testid="report-submit"
          @click="submit()"
        >
          {{ t('report.form.submit') }}
        </MButton>
        <p class="text-xs text-ink-300">{{ t('report.form.disclaimer') }}</p>
      </section>

      <section data-testid="report-list" class="space-y-2">
        <h2 class="text-amber-200 text-base">{{ t('report.list.title') }}</h2>
        <LoadingState v-if="listLoading" data-testid="report-list-loading" />
        <ErrorState
          v-else-if="listError"
          :error-key="listError"
          data-testid="report-list-error"
          @retry="loadList()"
        />
        <EmptyState
          v-else-if="rows.length === 0"
          title-key="report.list.emptyTitle"
          description-key="report.list.emptyDescription"
          data-testid="report-list-empty"
        />
        <ul v-else class="space-y-2">
          <li
            v-for="row in rows"
            :key="row.id"
            data-testid="report-item"
            class="bg-ink-700/30 border border-ink-300/20 rounded p-3 text-sm space-y-1"
          >
            <div class="flex items-center justify-between">
              <span class="text-amber-200">
                {{ row.targetDisplayName ?? row.targetCharacterId }}
              </span>
              <span class="text-xs text-ink-300">
                {{ t(`report.statuses.${row.status}`) }}
              </span>
            </div>
            <p class="text-xs text-ink-300">
              {{ t(`report.types.${row.reportType}`) }} ·
              {{ new Date(row.createdAt).toLocaleString() }}
            </p>
            <p class="whitespace-pre-line">{{ row.description }}</p>
          </li>
        </ul>
      </section>
    </div>
  </AppShell>
</template>
