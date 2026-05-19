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
import XTPageEyebrow from '@/components/xianxia/XTPageEyebrow.vue';
import XTLuxHero from '@/components/xianxia/XTLuxHero.vue';
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
      <XTLuxHero
        :eyebrow="t('luxHero.reportPlayer.eyebrow')"
        :label="t('luxHero.reportPlayer.label')"
        :title="t('report.title')"
        :subtitle="t('report.subtitle')"
        tone="gold"
        watermark-letter="P"
        :breadcrumb="t('luxHero.reportPlayer.breadcrumb')"
        test-id="report-player-view-hero"
      >
        <XTPageEyebrow caps="PHÁT GIÁC CAO THÙY" label="Phát Giác Cao Thùy" class="sr-only" />
      </XTLuxHero>

      <!-- Role hint -->
      <p class="text-sm text-gray-400 px-1" data-testid="report-player-role-hint">
        {{ t('reportPlayer.roleHint') }}
      </p>

      <!-- Cross-navigation -->
      <nav class="flex gap-2 text-xs mb-2" data-testid="report-player-cross-nav">
        <button
          class="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-gray-800/60 hover:bg-gray-700/60 transition"
          data-testid="cross-nav-social"
          @click="$router.push('/social')"
        >
          <span>{{ t('reportPlayer.crossNav.social') }}</span>
          <span class="text-gray-500 hidden sm:inline">{{ t('reportPlayer.crossNav.socialDesc') }}</span>
        </button>
        <button
          class="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-gray-800/60 hover:bg-gray-700/60 transition"
          data-testid="cross-nav-settings"
          @click="$router.push('/settings')"
        >
          <span>{{ t('reportPlayer.crossNav.settings') }}</span>
          <span class="text-gray-500 hidden sm:inline">{{ t('reportPlayer.crossNav.settingsDesc') }}</span>
        </button>
      </nav>

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
