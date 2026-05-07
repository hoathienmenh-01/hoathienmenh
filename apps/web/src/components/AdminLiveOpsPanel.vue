<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useToastStore } from '@/stores/toast';
import {
  adminLiveOpsStatus,
  adminLiveOpsToggle,
  adminSectWarRecalculate,
  adminSectWarStatus,
  type AdminLiveOpsEventStatusView,
  type AdminLiveOpsStatusView,
  type AdminSectWarStatusView,
} from '@/api/admin';
import { extractApiErrorCodeOrDefault } from '@/lib/apiError';

/**
 * Phase 13.1.B — Admin LiveOps Panel.
 *
 * Hiển thị catalog LiveOps events + override + computed today/active. Cho phép
 * admin toggle enabled/disabled (với optional reason), gọi sect-war status,
 * recalculate placeholder. Mọi mutation luôn yêu cầu confirm prompt.
 */

const { t } = useI18n();
const toast = useToastStore();

const status = ref<AdminLiveOpsStatusView | null>(null);
const sectWar = ref<AdminSectWarStatusView | null>(null);
const loading = ref(true);
const error = ref<string | null>(null);
const togglingKey = ref<string | null>(null);
const reasonByKey = ref<Record<string, string>>({});

onMounted(async () => {
  await Promise.all([refreshStatus(), refreshSectWar()]);
});

async function refreshStatus(): Promise<void> {
  loading.value = true;
  error.value = null;
  try {
    status.value = await adminLiveOpsStatus();
  } catch (e) {
    error.value = extractApiErrorCodeOrDefault(e, 'UNKNOWN');
  } finally {
    loading.value = false;
  }
}

async function refreshSectWar(): Promise<void> {
  try {
    sectWar.value = await adminSectWarStatus();
  } catch (e) {
    // Non-fatal; show inline warning.
    sectWar.value = null;
  }
}

async function onToggle(ev: AdminLiveOpsEventStatusView): Promise<void> {
  if (togglingKey.value) return;
  // Effective = catalog AND (override absent OR override.enabled).
  // Click "disable" if currently effectiveEnabled, else "enable".
  const nextEnabled = !ev.effectiveEnabled;
  // eslint-disable-next-line no-alert
  if (!confirm(t('adminLiveOps.confirmToggle', { key: ev.key, on: String(nextEnabled) }))) {
    return;
  }
  togglingKey.value = ev.key;
  try {
    await adminLiveOpsToggle({
      key: ev.key,
      enabled: nextEnabled,
      reason: reasonByKey.value[ev.key] ?? null,
    });
    toast.push({
      type: 'success',
      text: t('adminLiveOps.toast.toggled', { key: ev.key, on: String(nextEnabled) }),
    });
    await refreshStatus();
  } catch (e) {
    const code = extractApiErrorCodeOrDefault(e, 'UNKNOWN');
    toast.push({ type: 'error', text: t(`adminLiveOps.errors.${code}`, code) });
  } finally {
    togglingKey.value = null;
  }
}

async function onRecalc(): Promise<void> {
  // eslint-disable-next-line no-alert
  if (!confirm(t('adminLiveOps.confirmRecalc'))) return;
  try {
    await adminSectWarRecalculate({});
    toast.push({ type: 'success', text: t('adminLiveOps.toast.recalculated') });
    await refreshSectWar();
  } catch (e) {
    const code = extractApiErrorCodeOrDefault(e, 'UNKNOWN');
    toast.push({ type: 'error', text: t(`adminLiveOps.errors.${code}`, code) });
  }
}

const todaySet = computed(() => new Set(status.value?.todayKeys ?? []));
const activeSet = computed(() => new Set(status.value?.activeKeys ?? []));

defineExpose({ refreshStatus, refreshSectWar });
</script>

<template>
  <section class="border border-ink-300/40 rounded space-y-2" data-test="admin-liveops-panel">
    <div
      class="px-4 py-2 text-xs uppercase tracking-widest text-ink-300 border-b border-ink-300/30 flex items-center justify-between"
    >
      <span>{{ t('adminLiveOps.title') }}</span>
      <span v-if="status" class="text-ink-300/70 normal-case tracking-normal">
        {{ t('adminLiveOps.tz', { tz: status.tz }) }}
      </span>
    </div>

    <div v-if="loading" class="p-4 text-sm text-ink-300" data-test="admin-liveops-loading">
      {{ t('adminLiveOps.loading') }}
    </div>
    <div v-else-if="error" class="p-4 text-sm text-rose-300" data-test="admin-liveops-error">
      {{ t(`adminLiveOps.errors.${error}`, t('adminLiveOps.errors.UNKNOWN')) }}
    </div>
    <div v-else-if="status" class="p-3 space-y-3" data-test="admin-liveops-content">
      <div class="text-xs text-ink-300">
        {{ t('adminLiveOps.todayCount', { n: status.todayKeys.length }) }} ·
        {{ t('adminLiveOps.activeCount', { n: status.activeKeys.length }) }}
      </div>
      <table class="w-full text-sm">
        <thead class="text-xs text-ink-300/70">
          <tr>
            <th class="text-left px-2 py-1">{{ t('adminLiveOps.col.key') }}</th>
            <th class="text-left px-2 py-1">{{ t('adminLiveOps.col.type') }}</th>
            <th class="text-left px-2 py-1">{{ t('adminLiveOps.col.status') }}</th>
            <th class="text-left px-2 py-1">{{ t('adminLiveOps.col.override') }}</th>
            <th class="text-left px-2 py-1">{{ t('adminLiveOps.col.reason') }}</th>
            <th class="text-left px-2 py-1"></th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="ev in status.events"
            :key="ev.key"
            class="border-t border-ink-300/20"
            data-test="admin-liveops-row"
          >
            <td class="px-2 py-1">
              <div>{{ ev.key }}</div>
              <div class="text-[10px] text-ink-300/60">{{ t(ev.titleI18nKey, ev.key) }}</div>
            </td>
            <td class="px-2 py-1 text-xs text-ink-300/80">{{ ev.type }}</td>
            <td class="px-2 py-1 text-xs">
              <span
                :class="ev.effectiveEnabled ? 'text-emerald-300' : 'text-rose-300'"
                data-test="admin-liveops-status"
              >
                {{ ev.effectiveEnabled ? t('adminLiveOps.statusOn') : t('adminLiveOps.statusOff') }}
              </span>
              <span v-if="todaySet.has(ev.key)" class="ml-1 text-amber-300">·{{ t('adminLiveOps.today') }}</span>
              <span v-if="activeSet.has(ev.key)" class="ml-1 text-emerald-300">·{{ t('adminLiveOps.active') }}</span>
            </td>
            <td class="px-2 py-1 text-xs">
              <template v-if="ev.override">
                <span :class="ev.override.enabled ? 'text-emerald-300' : 'text-rose-300'">
                  {{ ev.override.enabled ? 'ON' : 'OFF' }}
                </span>
                <div class="text-[10px] text-ink-300/60">
                  {{ ev.override.updatedAt }}
                </div>
              </template>
              <span v-else class="text-ink-300/50">—</span>
            </td>
            <td class="px-2 py-1">
              <input
                type="text"
                :value="reasonByKey[ev.key] ?? ''"
                :placeholder="t('adminLiveOps.reasonPlaceholder')"
                maxlength="200"
                class="w-32 bg-ink-800 border border-ink-300/30 rounded px-1 py-0.5 text-xs"
                data-test="admin-liveops-reason"
                @input="reasonByKey[ev.key] = ($event.target as HTMLInputElement).value"
              />
            </td>
            <td class="px-2 py-1 text-right">
              <button
                type="button"
                class="px-2 py-0.5 rounded border text-xs disabled:opacity-50"
                :class="ev.effectiveEnabled
                  ? 'border-rose-300/40 text-rose-200'
                  : 'border-emerald-300/40 text-emerald-200'"
                :disabled="togglingKey === ev.key"
                data-test="admin-liveops-toggle"
                @click="onToggle(ev)"
              >
                {{ ev.effectiveEnabled
                  ? t('adminLiveOps.disableBtn')
                  : t('adminLiveOps.enableBtn') }}
              </button>
            </td>
          </tr>
        </tbody>
      </table>

      <hr class="border-ink-300/20" />

      <div class="flex items-center justify-between" data-test="admin-liveops-sectwar">
        <div class="text-sm">
          <div class="text-xs uppercase tracking-widest text-ink-300">
            {{ t('adminLiveOps.sectWar.title') }}
          </div>
          <div v-if="sectWar" class="text-ink-300/80 mt-1 text-xs">
            {{ t('adminLiveOps.sectWar.summary', {
              week: sectWar.weekKey,
              sects: sectWar.totalSects,
              contributors: sectWar.totalContributors,
              contributions: sectWar.totalContributions,
            }) }}
          </div>
          <div v-else class="text-ink-300/60 mt-1 text-xs">
            {{ t('adminLiveOps.sectWar.unavailable') }}
          </div>
        </div>
        <button
          type="button"
          class="px-3 py-1 rounded border border-amber-300/40 text-amber-200 text-xs"
          data-test="admin-liveops-recalc"
          @click="onRecalc"
        >
          {{ t('adminLiveOps.sectWar.recalcBtn') }}
        </button>
      </div>

      <div v-if="sectWar && sectWar.topSects.length > 0" class="text-xs">
        <div class="uppercase tracking-widest text-ink-300 mb-1">
          {{ t('adminLiveOps.sectWar.topHeader') }}
        </div>
        <ol class="space-y-0.5">
          <li
            v-for="(s, i) in sectWar.topSects"
            :key="s.sectId"
            class="flex justify-between text-ink-200/90"
          >
            <span>#{{ i + 1 }} {{ s.sectName || s.sectId }}</span>
            <span>{{ t('adminLiveOps.sectWar.row', {
              points: s.points,
              contributors: s.contributors,
            }) }}</span>
          </li>
        </ol>
      </div>
    </div>
  </section>
</template>
