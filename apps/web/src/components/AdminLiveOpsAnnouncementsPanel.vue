<script setup lang="ts">
/**
 * Phase 15.3.B — Admin LiveOps Announcement panel.
 *
 * Liệt kê announcement (status badge + severity badge + window), cho phép admin:
 *   - Tạo announcement mới (key/severity/target/title VI/EN/message VI/EN/window).
 *   - Disable announcement đang chạy (status → DISABLED, kill switch).
 *   - Recompute status thủ công (gọi cron job force-run + WS broadcast).
 *
 * Mọi mutation luôn yêu cầu confirm prompt + audit log ở BE
 * (`ADMIN_LIVEOPS_ANNOUNCEMENT_*`). I18n VI/EN parity qua
 * `adminLiveOpsAnnouncements.*`.
 */
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import {
  LIVEOPS_ANNOUNCEMENT_SEVERITIES,
  LIVEOPS_ANNOUNCEMENT_TARGETS,
  type LiveOpsAnnouncementSeverity,
  type LiveOpsAnnouncementTarget,
} from '@xuantoi/shared';
import { useToastStore } from '@/stores/toast';
import {
  adminLiveOpsAnnouncementsCreate,
  adminLiveOpsAnnouncementsDisable,
  adminLiveOpsAnnouncementsList,
  adminLiveOpsAnnouncementsRecompute,
  type AdminLiveOpsAnnouncementCreateInput,
  type AdminLiveOpsAnnouncementView,
} from '@/api/admin';
import { extractApiErrorCodeOrDefault } from '@/lib/apiError';

const { t } = useI18n();
const toast = useToastStore();

const announcements = ref<AdminLiveOpsAnnouncementView[]>([]);
const loading = ref(true);
const error = ref<string | null>(null);
const submittingCreate = ref(false);
const recomputing = ref(false);
const disablingId = ref<string | null>(null);
const showForm = ref(false);

const SEVERITIES: ReadonlyArray<LiveOpsAnnouncementSeverity> = [
  ...LIVEOPS_ANNOUNCEMENT_SEVERITIES,
];
const TARGETS: ReadonlyArray<LiveOpsAnnouncementTarget> = [
  ...LIVEOPS_ANNOUNCEMENT_TARGETS,
];

interface CreateForm {
  key: string;
  severity: LiveOpsAnnouncementSeverity;
  target: LiveOpsAnnouncementTarget;
  titleVi: string;
  titleEn: string;
  messageVi: string;
  messageEn: string;
  startsAt: string;
  endsAt: string;
  initialStatus: 'DRAFT' | 'SCHEDULED';
}

function blankForm(): CreateForm {
  return {
    key: '',
    severity: 'INFO',
    target: 'ALL',
    titleVi: '',
    titleEn: '',
    messageVi: '',
    messageEn: '',
    startsAt: '',
    endsAt: '',
    initialStatus: 'SCHEDULED',
  };
}

const form = ref<CreateForm>(blankForm());

async function refresh(): Promise<void> {
  error.value = null;
  loading.value = true;
  try {
    announcements.value = await adminLiveOpsAnnouncementsList();
  } catch (e) {
    error.value = extractApiErrorCodeOrDefault(e, 'UNKNOWN');
  } finally {
    loading.value = false;
  }
}

onMounted(() => {
  void refresh();
});

const sorted = computed(() =>
  [...announcements.value].sort((a, b) =>
    a.startsAt < b.startsAt ? 1 : a.startsAt > b.startsAt ? -1 : 0,
  ),
);

async function onSubmitCreate(): Promise<void> {
  if (submittingCreate.value) return;
  submittingCreate.value = true;
  try {
    const input: AdminLiveOpsAnnouncementCreateInput = {
      key: form.value.key.trim(),
      severity: form.value.severity,
      target: form.value.target,
      titleVi: form.value.titleVi.trim(),
      titleEn: form.value.titleEn.trim() || null,
      messageVi: form.value.messageVi.trim(),
      messageEn: form.value.messageEn.trim() || null,
      startsAt: new Date(form.value.startsAt).toISOString(),
      endsAt: new Date(form.value.endsAt).toISOString(),
      initialStatus: form.value.initialStatus,
    };
    const v = await adminLiveOpsAnnouncementsCreate(input);
    toast.push({
      type: 'success',
      text: t('adminLiveOpsAnnouncements.toast.created', { key: v.key }),
    });
    form.value = blankForm();
    showForm.value = false;
    await refresh();
  } catch (e) {
    const code = extractApiErrorCodeOrDefault(e, 'UNKNOWN');
    toast.push({
      type: 'error',
      text: t(`adminLiveOpsAnnouncements.errors.${code}`, code),
    });
  } finally {
    submittingCreate.value = false;
  }
}

async function onDisable(row: AdminLiveOpsAnnouncementView): Promise<void> {
  if (disablingId.value) return;
  if (!confirm(t('adminLiveOpsAnnouncements.toast.disabled', { key: row.key }))) {
    return;
  }
  disablingId.value = row.id;
  try {
    await adminLiveOpsAnnouncementsDisable(row.id);
    toast.push({
      type: 'success',
      text: t('adminLiveOpsAnnouncements.toast.disabled', { key: row.key }),
    });
    await refresh();
  } catch (e) {
    const code = extractApiErrorCodeOrDefault(e, 'UNKNOWN');
    toast.push({
      type: 'error',
      text: t(`adminLiveOpsAnnouncements.errors.${code}`, code),
    });
  } finally {
    disablingId.value = null;
  }
}

async function onRecompute(): Promise<void> {
  if (recomputing.value) return;
  recomputing.value = true;
  try {
    const summary = await adminLiveOpsAnnouncementsRecompute();
    toast.push({
      type: 'info',
      text: t('adminLiveOpsAnnouncements.toast.recomputed', {
        activated: summary.activated.length,
        ended: summary.ended.length,
      }),
    });
    await refresh();
  } catch (e) {
    const code = extractApiErrorCodeOrDefault(e, 'UNKNOWN');
    toast.push({
      type: 'error',
      text: t(`adminLiveOpsAnnouncements.errors.${code}`, code),
    });
  } finally {
    recomputing.value = false;
  }
}
</script>

<template>
  <section
    class="admin-liveops-announcements"
    data-test="admin-liveops-announcements-panel"
  >
    <header class="flex items-center justify-between mb-2 gap-2 flex-wrap">
      <h3 class="font-semibold">{{ t('adminLiveOpsAnnouncements.title') }}</h3>
      <div class="flex gap-2">
        <button
          type="button"
          class="btn-secondary"
          :disabled="recomputing"
          data-test="admin-liveops-announcements-recompute"
          @click="onRecompute"
        >
          {{ t('adminLiveOpsAnnouncements.actions.recompute') }}
        </button>
        <button
          type="button"
          class="btn-secondary"
          :disabled="loading"
          @click="refresh"
        >
          {{ t('adminLiveOpsAnnouncements.refreshBtn') }}
        </button>
        <button
          type="button"
          class="btn-primary"
          data-test="admin-liveops-announcements-new"
          @click="showForm = !showForm"
        >
          {{ t('adminLiveOpsAnnouncements.newBtn') }}
        </button>
      </div>
    </header>

    <form
      v-if="showForm"
      class="grid gap-2 p-3 mb-3 border rounded"
      data-test="admin-liveops-announcements-form"
      @submit.prevent="onSubmitCreate"
    >
      <h4 class="font-medium">{{ t('adminLiveOpsAnnouncements.form.title') }}</h4>
      <label class="grid gap-1">
        <span>{{ t('adminLiveOpsAnnouncements.form.key') }}</span>
        <input
          v-model="form.key"
          required
          minlength="3"
          maxlength="64"
          data-test="admin-liveops-announcements-form-key"
        />
      </label>
      <div class="grid grid-cols-2 gap-2">
        <label class="grid gap-1">
          <span>{{ t('adminLiveOpsAnnouncements.form.severity') }}</span>
          <select v-model="form.severity">
            <option v-for="s in SEVERITIES" :key="s" :value="s">{{ s }}</option>
          </select>
        </label>
        <label class="grid gap-1">
          <span>{{ t('adminLiveOpsAnnouncements.form.target') }}</span>
          <select v-model="form.target">
            <option v-for="tg in TARGETS" :key="tg" :value="tg">{{ tg }}</option>
          </select>
        </label>
      </div>
      <label class="grid gap-1">
        <span>{{ t('adminLiveOpsAnnouncements.form.titleVi') }}</span>
        <input
          v-model="form.titleVi"
          required
          maxlength="120"
          data-test="admin-liveops-announcements-form-titleVi"
        />
      </label>
      <label class="grid gap-1">
        <span>{{ t('adminLiveOpsAnnouncements.form.titleEn') }}</span>
        <input v-model="form.titleEn" maxlength="120" />
      </label>
      <label class="grid gap-1">
        <span>{{ t('adminLiveOpsAnnouncements.form.messageVi') }}</span>
        <textarea
          v-model="form.messageVi"
          required
          maxlength="500"
          rows="2"
          data-test="admin-liveops-announcements-form-messageVi"
        />
      </label>
      <label class="grid gap-1">
        <span>{{ t('adminLiveOpsAnnouncements.form.messageEn') }}</span>
        <textarea v-model="form.messageEn" maxlength="500" rows="2" />
      </label>
      <div class="grid grid-cols-2 gap-2">
        <label class="grid gap-1">
          <span>{{ t('adminLiveOpsAnnouncements.form.startsAt') }}</span>
          <input
            v-model="form.startsAt"
            type="datetime-local"
            required
            data-test="admin-liveops-announcements-form-startsAt"
          />
        </label>
        <label class="grid gap-1">
          <span>{{ t('adminLiveOpsAnnouncements.form.endsAt') }}</span>
          <input
            v-model="form.endsAt"
            type="datetime-local"
            required
            data-test="admin-liveops-announcements-form-endsAt"
          />
        </label>
      </div>
      <label class="grid gap-1">
        <span>{{ t('adminLiveOpsAnnouncements.form.initialStatus') }}</span>
        <select v-model="form.initialStatus">
          <option value="DRAFT">DRAFT</option>
          <option value="SCHEDULED">SCHEDULED</option>
        </select>
      </label>
      <div class="flex gap-2">
        <button
          type="submit"
          class="btn-primary"
          :disabled="submittingCreate"
          data-test="admin-liveops-announcements-form-submit"
        >
          {{ t('adminLiveOpsAnnouncements.form.submit') }}
        </button>
        <button
          type="button"
          class="btn-secondary"
          @click="showForm = false"
        >
          {{ t('adminLiveOpsAnnouncements.form.cancel') }}
        </button>
      </div>
    </form>

    <div v-if="loading" class="text-muted">
      {{ t('adminLiveOpsAnnouncements.loading') }}
    </div>
    <div
      v-else-if="sorted.length === 0"
      class="text-muted"
      data-test="admin-liveops-announcements-empty"
    >
      {{ t('adminLiveOpsAnnouncements.empty') }}
    </div>
    <table v-else class="w-full text-sm" data-test="admin-liveops-announcements-table">
      <thead>
        <tr>
          <th class="text-left">{{ t('adminLiveOpsAnnouncements.row.key') }}</th>
          <th class="text-left">{{ t('adminLiveOpsAnnouncements.row.severity') }}</th>
          <th class="text-left">{{ t('adminLiveOpsAnnouncements.row.status') }}</th>
          <th class="text-left">{{ t('adminLiveOpsAnnouncements.row.target') }}</th>
          <th class="text-left">{{ t('adminLiveOpsAnnouncements.row.window') }}</th>
          <th class="text-right">{{ t('adminLiveOpsAnnouncements.row.actions') }}</th>
        </tr>
      </thead>
      <tbody>
        <tr
          v-for="row in sorted"
          :key="row.id"
          :data-test="`admin-liveops-announcements-row-${row.key}`"
        >
          <td>{{ row.key }}</td>
          <td>{{ row.severity }}</td>
          <td>{{ row.status }}</td>
          <td>{{ row.target }}</td>
          <td>{{ row.startsAt }} → {{ row.endsAt }}</td>
          <td class="text-right">
            <button
              v-if="row.status !== 'DISABLED' && row.status !== 'ENDED'"
              type="button"
              class="btn-secondary"
              :disabled="disablingId === row.id"
              :data-test="`admin-liveops-announcements-disable-${row.key}`"
              @click="onDisable(row)"
            >
              {{ t('adminLiveOpsAnnouncements.actions.disable') }}
            </button>
          </td>
        </tr>
      </tbody>
    </table>

    <div v-if="error" class="text-error mt-2" role="alert">
      {{ t(`adminLiveOpsAnnouncements.errors.${error}`, error) }}
    </div>
  </section>
</template>

<style scoped>
.admin-liveops-announcements {
  padding: 0.75rem;
  border: 1px solid var(--border, #ccc);
  border-radius: 0.5rem;
}
.text-muted {
  opacity: 0.7;
  font-style: italic;
}
.text-error {
  color: #b91c1c;
}
</style>
