<script setup lang="ts">
/**
 * Phase 15.5 — Admin Maintenance Window panel.
 *
 * Liệt kê maintenance windows + form tạo + button disable + button
 * recompute. Major actions (CRITICAL severity / FULL_LOCKDOWN target)
 * cần xác nhận qua `ConfirmModal`. Audit log do server tự ghi
 * (`ADMIN_MAINTENANCE_*`).
 *
 * Form validation bám validator shared (`validateMaintenanceWindowInput`)
 * — server cũng validate, đây chỉ là UX shortcut.
 */
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import {
  MAINTENANCE_SEVERITIES,
  MAINTENANCE_TARGETS,
  type MaintenanceSeverity,
  type MaintenanceTarget,
  type MaintenanceWindowAdminView,
} from '@xuantoi/shared';
import {
  adminCreateMaintenanceWindow,
  adminDisableMaintenanceWindow,
  adminListMaintenanceWindows,
  adminRecomputeMaintenanceStatus,
} from '@/api/maintenance';
import { useToastStore } from '@/stores/toast';
import { extractApiErrorCodeOrDefault } from '@/lib/apiError';
import MButton from '@/components/ui/MButton.vue';
import ConfirmModal from '@/components/ui/ConfirmModal.vue';

const { t, locale } = useI18n();
const toast = useToastStore();

const items = ref<MaintenanceWindowAdminView[]>([]);
const loading = ref(true);
const error = ref<string | null>(null);
const submitting = ref(false);
const recomputing = ref(false);
const disablingId = ref<string | null>(null);

interface FormState {
  key: string;
  severity: MaintenanceSeverity;
  target: MaintenanceTarget;
  titleVi: string;
  titleEn: string;
  messageVi: string;
  messageEn: string;
  startsAt: string;
  endsAt: string;
  allowAdminBypass: boolean;
  allowHealthcheck: boolean;
  allowMetrics: boolean;
  initialStatus: 'DRAFT' | 'SCHEDULED';
}

const form = ref<FormState>({
  key: '',
  severity: 'WARNING',
  target: 'ALL_PLAYERS',
  titleVi: '',
  titleEn: '',
  messageVi: '',
  messageEn: '',
  startsAt: '',
  endsAt: '',
  allowAdminBypass: true,
  allowHealthcheck: true,
  allowMetrics: true,
  initialStatus: 'SCHEDULED',
});

interface PendingCreate {
  payload: ReturnType<typeof buildPayload>;
  description: string;
}
const pendingCreate = ref<PendingCreate | null>(null);

interface PendingDisable {
  id: string;
  key: string;
}
const pendingDisable = ref<PendingDisable | null>(null);

function fmtDate(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(locale.value === 'en' ? 'en-US' : 'vi-VN');
}

function statusBadgeClass(s: string): string {
  switch (s) {
    case 'ACTIVE':
      return 'bg-rose-700/40 text-rose-100';
    case 'SCHEDULED':
      return 'bg-amber-700/40 text-amber-100';
    case 'DISABLED':
      return 'bg-ink-700/60 text-ink-300';
    case 'ENDED':
      return 'bg-emerald-700/40 text-emerald-100';
    default:
      return 'bg-ink-700/60 text-ink-200';
  }
}

const sorted = computed(() =>
  [...items.value].sort(
    (a, b) =>
      new Date(b.startsAt).getTime() - new Date(a.startsAt).getTime(),
  ),
);

async function refresh(): Promise<void> {
  loading.value = true;
  error.value = null;
  try {
    items.value = await adminListMaintenanceWindows();
  } catch (e) {
    const code = extractApiErrorCodeOrDefault(e, 'UNKNOWN');
    error.value = t(`adminMaintenance.errors.${code}`, t('adminMaintenance.errors.UNKNOWN'));
  } finally {
    loading.value = false;
  }
}

function buildPayload() {
  return {
    key: form.value.key.trim(),
    severity: form.value.severity,
    target: form.value.target,
    titleVi: form.value.titleVi.trim(),
    titleEn: form.value.titleEn.trim() || null,
    messageVi: form.value.messageVi.trim(),
    messageEn: form.value.messageEn.trim() || null,
    startsAt: new Date(form.value.startsAt).toISOString(),
    endsAt: new Date(form.value.endsAt).toISOString(),
    allowAdminBypass: form.value.allowAdminBypass,
    allowHealthcheck: form.value.allowHealthcheck,
    allowMetrics: form.value.allowMetrics,
    initialStatus: form.value.initialStatus,
  };
}

async function submitCreate(): Promise<void> {
  // Major actions cần confirm.
  const isMajor =
    form.value.severity === 'CRITICAL' ||
    form.value.target === 'FULL_LOCKDOWN' ||
    form.value.initialStatus === 'SCHEDULED';
  if (isMajor) {
    pendingCreate.value = {
      payload: buildPayload(),
      description: `${form.value.severity} · ${form.value.target}`,
    };
    return;
  }
  await doCreate(buildPayload());
}

async function confirmCreate(): Promise<void> {
  if (!pendingCreate.value) return;
  const payload = pendingCreate.value.payload;
  pendingCreate.value = null;
  await doCreate(payload);
}

async function doCreate(payload: ReturnType<typeof buildPayload>): Promise<void> {
  submitting.value = true;
  try {
    await adminCreateMaintenanceWindow(payload);
    toast.push({ type: 'success', text: t('adminMaintenance.toast.created', { key: payload.key }) });
    form.value.key = '';
    form.value.titleVi = '';
    form.value.titleEn = '';
    form.value.messageVi = '';
    form.value.messageEn = '';
    await refresh();
  } catch (e) {
    const code = extractApiErrorCodeOrDefault(e, 'UNKNOWN');
    toast.push({ type: 'error', text: t(`adminMaintenance.errors.${code}`, t('adminMaintenance.errors.UNKNOWN')) });
  } finally {
    submitting.value = false;
  }
}

function askDisable(item: MaintenanceWindowAdminView): void {
  pendingDisable.value = { id: item.id, key: item.key };
}

async function confirmDisable(): Promise<void> {
  if (!pendingDisable.value) return;
  const { id, key } = pendingDisable.value;
  pendingDisable.value = null;
  disablingId.value = id;
  try {
    await adminDisableMaintenanceWindow(id);
    toast.push({ type: 'success', text: t('adminMaintenance.toast.disabled', { key }) });
    await refresh();
  } catch (e) {
    const code = extractApiErrorCodeOrDefault(e, 'UNKNOWN');
    toast.push({ type: 'error', text: t(`adminMaintenance.errors.${code}`, t('adminMaintenance.errors.UNKNOWN')) });
  } finally {
    disablingId.value = null;
  }
}

async function recompute(): Promise<void> {
  recomputing.value = true;
  try {
    const r = await adminRecomputeMaintenanceStatus();
    toast.push({
      type: 'success',
      text: t('adminMaintenance.toast.recomputed', {
        activated: r.activatedKeys.length,
        ended: r.endedKeys.length,
      }),
    });
    await refresh();
  } catch (e) {
    const code = extractApiErrorCodeOrDefault(e, 'UNKNOWN');
    toast.push({ type: 'error', text: t(`adminMaintenance.errors.${code}`, t('adminMaintenance.errors.UNKNOWN')) });
  } finally {
    recomputing.value = false;
  }
}

onMounted(() => {
  void refresh();
});
</script>

<template>
  <div class="space-y-4" data-testid="admin-maintenance-panel">
    <header class="flex items-center gap-3">
      <h2 class="text-lg text-amber-200">{{ t('adminMaintenance.title') }}</h2>
      <p class="text-xs text-ink-300">{{ t('adminMaintenance.hint') }}</p>
      <div class="ml-auto flex gap-2">
        <MButton
          :disabled="loading"
          data-testid="admin-maintenance-refresh"
          @click="refresh"
        >
          {{ t('adminMaintenance.actions.refresh') }}
        </MButton>
        <MButton
          :disabled="recomputing"
          data-testid="admin-maintenance-recompute"
          @click="recompute"
        >
          {{ t('adminMaintenance.actions.recompute') }}
        </MButton>
      </div>
    </header>

    <p v-if="error" class="text-rose-300 text-sm">{{ error }}</p>

    <!-- CREATE FORM -->
    <section class="bg-ink-700/30 border border-ink-300/20 rounded p-3 space-y-3">
      <h3 class="text-sm text-amber-200">{{ t('adminMaintenance.form.title') }}</h3>
      <div class="grid grid-cols-1 md:grid-cols-2 gap-2 text-sm">
        <label class="block">
          <span class="text-ink-300">{{ t('adminMaintenance.form.key') }}</span>
          <input
            v-model="form.key"
            class="w-full bg-ink-700/40 border border-ink-300/30 rounded px-2 py-1 mt-1"
            placeholder="mw-2026-08-01"
            data-testid="admin-maintenance-form-key"
          />
        </label>
        <label class="block">
          <span class="text-ink-300">{{ t('adminMaintenance.form.severity') }}</span>
          <select
            v-model="form.severity"
            class="w-full bg-ink-700/40 border border-ink-300/30 rounded px-2 py-1 mt-1"
            data-testid="admin-maintenance-form-severity"
          >
            <option v-for="s in MAINTENANCE_SEVERITIES" :key="s" :value="s">{{ s }}</option>
          </select>
        </label>
        <label class="block">
          <span class="text-ink-300">{{ t('adminMaintenance.form.target') }}</span>
          <select
            v-model="form.target"
            class="w-full bg-ink-700/40 border border-ink-300/30 rounded px-2 py-1 mt-1"
            data-testid="admin-maintenance-form-target"
          >
            <option v-for="tg in MAINTENANCE_TARGETS" :key="tg" :value="tg">{{ tg }}</option>
          </select>
        </label>
        <label class="block">
          <span class="text-ink-300">{{ t('adminMaintenance.form.initialStatus') }}</span>
          <select
            v-model="form.initialStatus"
            class="w-full bg-ink-700/40 border border-ink-300/30 rounded px-2 py-1 mt-1"
            data-testid="admin-maintenance-form-initialStatus"
          >
            <option value="DRAFT">DRAFT</option>
            <option value="SCHEDULED">SCHEDULED</option>
          </select>
        </label>
        <label class="block">
          <span class="text-ink-300">{{ t('adminMaintenance.form.titleVi') }}</span>
          <input
            v-model="form.titleVi"
            class="w-full bg-ink-700/40 border border-ink-300/30 rounded px-2 py-1 mt-1"
            data-testid="admin-maintenance-form-titleVi"
          />
        </label>
        <label class="block">
          <span class="text-ink-300">{{ t('adminMaintenance.form.titleEn') }}</span>
          <input
            v-model="form.titleEn"
            class="w-full bg-ink-700/40 border border-ink-300/30 rounded px-2 py-1 mt-1"
          />
        </label>
        <label class="block md:col-span-2">
          <span class="text-ink-300">{{ t('adminMaintenance.form.messageVi') }}</span>
          <textarea
            v-model="form.messageVi"
            rows="2"
            class="w-full bg-ink-700/40 border border-ink-300/30 rounded px-2 py-1 mt-1"
            data-testid="admin-maintenance-form-messageVi"
          />
        </label>
        <label class="block md:col-span-2">
          <span class="text-ink-300">{{ t('adminMaintenance.form.messageEn') }}</span>
          <textarea
            v-model="form.messageEn"
            rows="2"
            class="w-full bg-ink-700/40 border border-ink-300/30 rounded px-2 py-1 mt-1"
          />
        </label>
        <label class="block">
          <span class="text-ink-300">{{ t('adminMaintenance.form.startsAt') }}</span>
          <input
            v-model="form.startsAt"
            type="datetime-local"
            class="w-full bg-ink-700/40 border border-ink-300/30 rounded px-2 py-1 mt-1"
            data-testid="admin-maintenance-form-startsAt"
          />
        </label>
        <label class="block">
          <span class="text-ink-300">{{ t('adminMaintenance.form.endsAt') }}</span>
          <input
            v-model="form.endsAt"
            type="datetime-local"
            class="w-full bg-ink-700/40 border border-ink-300/30 rounded px-2 py-1 mt-1"
            data-testid="admin-maintenance-form-endsAt"
          />
        </label>
        <label class="flex items-center gap-2 text-ink-200">
          <input v-model="form.allowAdminBypass" type="checkbox" />
          <span>{{ t('adminMaintenance.form.allowAdminBypass') }}</span>
        </label>
        <label class="flex items-center gap-2 text-ink-200">
          <input v-model="form.allowHealthcheck" type="checkbox" />
          <span>{{ t('adminMaintenance.form.allowHealthcheck') }}</span>
        </label>
        <label class="flex items-center gap-2 text-ink-200">
          <input v-model="form.allowMetrics" type="checkbox" />
          <span>{{ t('adminMaintenance.form.allowMetrics') }}</span>
        </label>
      </div>
      <MButton
        :disabled="submitting"
        data-testid="admin-maintenance-form-submit"
        @click="submitCreate"
      >
        {{ t('adminMaintenance.actions.create') }}
      </MButton>
    </section>

    <!-- LIST -->
    <section class="space-y-2">
      <h3 class="text-sm text-amber-200">{{ t('adminMaintenance.list.title') }}</h3>
      <p v-if="loading" class="text-ink-300 text-xs">{{ t('common.loading') }}</p>
      <p
        v-else-if="!sorted.length"
        class="text-ink-300 text-xs"
        data-testid="admin-maintenance-empty"
      >
        {{ t('adminMaintenance.list.empty') }}
      </p>
      <div
        v-for="item in sorted"
        :key="item.id"
        class="bg-ink-700/30 border border-ink-300/20 rounded p-3 text-sm"
        :data-testid="`admin-maintenance-row-${item.id}`"
      >
        <div class="flex items-center gap-2 mb-1">
          <span class="font-bold text-ink-50">{{ item.key }}</span>
          <span
            class="px-2 py-0.5 text-[10px] rounded"
            :class="statusBadgeClass(item.status)"
          >{{ item.status }}</span>
          <span class="px-2 py-0.5 text-[10px] rounded bg-ink-700/60">{{ item.severity }}</span>
          <span class="px-2 py-0.5 text-[10px] rounded bg-ink-700/60">{{ item.target }}</span>
          <MButton
            v-if="item.status !== 'DISABLED' && item.status !== 'ENDED'"
            class="ml-auto"
            :disabled="disablingId === item.id"
            :data-testid="`admin-maintenance-disable-${item.id}`"
            @click="askDisable(item)"
          >
            {{ t('adminMaintenance.actions.disable') }}
          </MButton>
        </div>
        <div class="text-ink-200">{{ item.titleVi }}</div>
        <div class="text-ink-300 text-xs whitespace-pre-line">{{ item.messageVi }}</div>
        <div class="text-[11px] text-ink-300 mt-1">
          {{ t('adminMaintenance.list.window', { from: fmtDate(item.startsAt), to: fmtDate(item.endsAt) }) }}
        </div>
        <div class="text-[11px] text-ink-300">
          adminBypass: {{ item.allowAdminBypass }} · healthcheck: {{ item.allowHealthcheck }} · metrics: {{ item.allowMetrics }}
        </div>
      </div>
    </section>

    <ConfirmModal
      :open="!!pendingCreate"
      :title="t('adminMaintenance.confirm.create.title')"
      :message="pendingCreate ? t('adminMaintenance.confirm.create.message', { description: pendingCreate.description }) : ''"
      danger
      test-id="admin-maintenance-confirm-create"
      @confirm="confirmCreate"
      @cancel="pendingCreate = null"
    />

    <ConfirmModal
      :open="!!pendingDisable"
      :title="t('adminMaintenance.confirm.disable.title')"
      :message="pendingDisable ? t('adminMaintenance.confirm.disable.message', { key: pendingDisable.key }) : ''"
      danger
      test-id="admin-maintenance-confirm-disable"
      @confirm="confirmDisable"
      @cancel="pendingDisable = null"
    />
  </div>
</template>
