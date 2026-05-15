<script setup lang="ts">
/**
 * Phase 41.0 — Player Feedback Center.
 *
 * - Form gửi feedback (type/title/description/severity).
 * - Danh sách feedback của chính user (keyset).
 * - Sanitize text qua shared helper trước khi submit để hint UX.
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
  FEEDBACK_LIMITS,
  FEEDBACK_SEVERITIES,
  FEEDBACK_STATUSES,
  FEEDBACK_TYPES,
  type FeedbackSeverity,
  type FeedbackStatus,
  type FeedbackType,
  type PlayerFeedbackRow,
} from '@xuantoi/shared';
import {
  createFeedback,
  listMyFeedback,
  type FeedbackCreatePayload,
} from '@/api/playerExperience';

const { t } = useI18n();
const toast = useToastStore();

const form = ref({
  type: 'BUG_REPORT' as FeedbackType,
  title: '',
  description: '',
  severity: 'MEDIUM' as FeedbackSeverity,
});
const submitting = ref(false);

const listLoading = ref(true);
const listError = ref<string | null>(null);
const rows = ref<PlayerFeedbackRow[]>([]);
const filterStatus = ref<FeedbackStatus | ''>('');

const titleTooShort = computed(
  () =>
    form.value.title.trim().length > 0 &&
    form.value.title.trim().length < FEEDBACK_LIMITS.TITLE_MIN,
);
const descTooShort = computed(
  () =>
    form.value.description.trim().length > 0 &&
    form.value.description.trim().length < FEEDBACK_LIMITS.DESCRIPTION_MIN,
);

async function loadList(): Promise<void> {
  listLoading.value = true;
  listError.value = null;
  try {
    const res = await listMyFeedback({
      limit: 20,
      status: filterStatus.value === '' ? null : filterStatus.value,
    });
    rows.value = res.feedback;
  } catch (e) {
    const code = extractApiErrorCodeOrDefault(e, 'UNKNOWN');
    listError.value = `feedback.errors.${code}`;
  } finally {
    listLoading.value = false;
  }
}

async function submit(): Promise<void> {
  if (submitting.value) return;
  if (titleTooShort.value || descTooShort.value) {
    toast.push({ type: 'error', text: t('feedback.form.errors.tooShort') });
    return;
  }
  submitting.value = true;
  try {
    const payload: FeedbackCreatePayload = {
      type: form.value.type,
      title: form.value.title.trim(),
      description: form.value.description.trim(),
      severity: form.value.severity,
    };
    const created = await createFeedback(payload);
    rows.value = [created, ...rows.value];
    form.value.title = '';
    form.value.description = '';
    toast.push({ type: 'success', text: t('feedback.form.submitted') });
  } catch (e) {
    const code = extractApiErrorCodeOrDefault(e, 'UNKNOWN');
    toast.push({ type: 'error', text: t(`feedback.errors.${code}`, t('feedback.errors.UNKNOWN')) });
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
        <XTHeroEyebrow han="请安仪" label="Thỉnh An Nghi" />
        <h1 class="text-2xl tracking-widest font-bold mt-1">{{ t('feedback.title') }}</h1>
        <p class="text-xs text-ink-300 mt-1">{{ t('feedback.subtitle') }}</p>
      </header>

      <!-- Form -->
      <section
        class="bg-ink-700/30 border border-ink-300/20 rounded p-4 space-y-3 text-sm"
        data-testid="feedback-form"
      >
        <h2 class="text-amber-200 text-base">{{ t('feedback.form.title') }}</h2>
        <label class="block">
          <span class="text-ink-300">{{ t('feedback.form.fields.type') }}</span>
          <select
            v-model="form.type"
            class="w-full bg-ink-700/40 border border-ink-300/30 rounded px-2 py-1 mt-1"
          >
            <option v-for="ty in FEEDBACK_TYPES" :key="ty" :value="ty">
              {{ t(`feedback.types.${ty}`) }}
            </option>
          </select>
        </label>
        <label class="block">
          <span class="text-ink-300">{{ t('feedback.form.fields.title') }}</span>
          <input
            v-model="form.title"
            type="text"
            class="w-full bg-ink-700/40 border border-ink-300/30 rounded px-2 py-1 mt-1"
            :maxlength="FEEDBACK_LIMITS.TITLE_MAX"
          />
          <span v-if="titleTooShort" class="text-red-400 text-xs">
            {{ t('feedback.form.errors.tooShort') }}
          </span>
        </label>
        <label class="block">
          <span class="text-ink-300">{{ t('feedback.form.fields.description') }}</span>
          <textarea
            v-model="form.description"
            rows="5"
            class="w-full bg-ink-700/40 border border-ink-300/30 rounded px-2 py-1 mt-1"
            :maxlength="FEEDBACK_LIMITS.DESCRIPTION_MAX"
          />
          <span v-if="descTooShort" class="text-red-400 text-xs">
            {{ t('feedback.form.errors.tooShort') }}
          </span>
        </label>
        <label class="block">
          <span class="text-ink-300">{{ t('feedback.form.fields.severity') }}</span>
          <select
            v-model="form.severity"
            class="w-full bg-ink-700/40 border border-ink-300/30 rounded px-2 py-1 mt-1"
          >
            <option v-for="sv in FEEDBACK_SEVERITIES" :key="sv" :value="sv">
              {{ t(`feedback.severities.${sv}`) }}
            </option>
          </select>
        </label>
        <MButton
          :disabled="
            submitting || titleTooShort || descTooShort || !form.title.trim() || !form.description.trim()
          "
          data-testid="feedback-submit"
          @click="submit()"
        >
          {{ t('feedback.form.submit') }}
        </MButton>
      </section>

      <!-- List -->
      <section data-testid="feedback-list" class="space-y-2">
        <div class="flex items-center justify-between">
          <h2 class="text-amber-200 text-base">{{ t('feedback.list.title') }}</h2>
          <select
            v-model="filterStatus"
            class="bg-ink-700/40 border border-ink-300/30 rounded px-2 py-1 text-xs"
            @change="loadList()"
          >
            <option value="">{{ t('feedback.list.allStatuses') }}</option>
            <option v-for="st in FEEDBACK_STATUSES" :key="st" :value="st">
              {{ t(`feedback.statuses.${st}`) }}
            </option>
          </select>
        </div>
        <LoadingState v-if="listLoading" data-testid="feedback-list-loading" />
        <ErrorState
          v-else-if="listError"
          :error-key="listError"
          data-testid="feedback-list-error"
          @retry="loadList()"
        />
        <EmptyState
          v-else-if="rows.length === 0"
          title-key="feedback.list.emptyTitle"
          description-key="feedback.list.emptyDescription"
          data-testid="feedback-list-empty"
        />
        <ul v-else class="space-y-2">
          <li
            v-for="row in rows"
            :key="row.id"
            data-testid="feedback-item"
            class="bg-ink-700/30 border border-ink-300/20 rounded p-3 text-sm space-y-1"
          >
            <div class="flex items-center justify-between">
              <span class="text-amber-200">{{ row.title }}</span>
              <span class="text-xs text-ink-300">
                {{ t(`feedback.statuses.${row.status}`) }}
              </span>
            </div>
            <p class="text-xs text-ink-300">
              {{ t(`feedback.types.${row.type}`) }} ·
              {{ t(`feedback.severities.${row.severity}`) }} ·
              {{ new Date(row.createdAt).toLocaleString() }}
            </p>
            <p class="whitespace-pre-line">{{ row.description }}</p>
          </li>
        </ul>
      </section>
    </div>
  </AppShell>
</template>
