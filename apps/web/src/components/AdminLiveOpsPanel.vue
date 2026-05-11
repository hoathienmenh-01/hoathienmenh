<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useToastStore } from '@/stores/toast';
import {
  adminLiveOpsRunWeeklyCycle,
  adminLiveOpsStatus,
  adminLiveOpsToggle,
  adminSectSeasonCronStatus,
  adminSectWarRecalculate,
  adminSectWarSnapshot,
  adminSectWarStatus,
  adminSpawnBoss,
  adminTerritoryCronStatus,
  type AdminLiveOpsCronHealthView,
  type AdminLiveOpsCronWeeklyCycleSummary,
  type AdminLiveOpsEventStatusView,
  type AdminLiveOpsStatusView,
  type AdminSectSeasonCronStatusView,
  type AdminSectWarStatusView,
  type AdminTerritoryCronStatusView,
} from '@/api/admin';
import { extractApiErrorCodeOrDefault } from '@/lib/apiError';

/**
 * Phase 13.1.B — Admin LiveOps Panel.
 * Phase 13.1.C — extend với Force Boss Spawn (region/bossKey/level/reason)
 * + Sect War snapshot-for-record (POST /admin/sect-war/snapshot).
 *
 * Hiển thị catalog LiveOps events + override + computed today/active. Cho phép
 * admin toggle enabled/disabled (với optional reason), gọi sect-war status,
 * recalculate placeholder, force spawn boss theo region, snapshot sect-war.
 * Mọi mutation luôn yêu cầu confirm prompt.
 */

const { t } = useI18n();
const toast = useToastStore();

const status = ref<AdminLiveOpsStatusView | null>(null);
const sectWar = ref<AdminSectWarStatusView | null>(null);
const loading = ref(true);
const error = ref<string | null>(null);
const togglingKey = ref<string | null>(null);
const reasonByKey = ref<Record<string, string>>({});

// Phase 13.1.C — Force Boss Spawn form state.
const bossForm = ref({
  regionKey: '',
  bossKey: '',
  level: 1,
  force: false,
  reason: '',
});
const bossSubmitting = ref(false);
const snapshotSubmitting = ref(false);

// Phase 13.2.D + 14.0.F — Weekly cycle force-run state.
const weeklyCycleForm = ref({
  periodKey: '',
  bypassLease: false,
});
const weeklyCycleSubmitting = ref(false);
const weeklyCycleResult = ref<AdminLiveOpsCronWeeklyCycleSummary | null>(null);

// Phase 15.8 — Cron health status (territory + sect-season).
const territoryCronStatus = ref<AdminTerritoryCronStatusView | null>(null);
const sectSeasonCronStatus = ref<AdminSectSeasonCronStatusView | null>(null);
const cronStatusError = ref<string | null>(null);

function healthBadgeClass(status: AdminLiveOpsCronHealthView['status']): string {
  switch (status) {
    case 'OK':
      return 'bg-emerald-500/15 text-emerald-300 border-emerald-300/30';
    case 'STALE':
      return 'bg-amber-500/15 text-amber-300 border-amber-300/30';
    case 'DEGRADED':
      return 'bg-rose-500/15 text-rose-300 border-rose-300/30';
    case 'DISABLED':
    default:
      return 'bg-ink-300/10 text-ink-300/80 border-ink-300/30';
  }
}

async function refreshCronStatus(): Promise<void> {
  cronStatusError.value = null;
  try {
    const [territory, sect] = await Promise.all([
      adminTerritoryCronStatus(),
      adminSectSeasonCronStatus(),
    ]);
    territoryCronStatus.value = territory;
    sectSeasonCronStatus.value = sect;
  } catch (e) {
    cronStatusError.value = extractApiErrorCodeOrDefault(e, 'UNKNOWN');
  }
}

onMounted(async () => {
  await Promise.all([
    refreshStatus(),
    refreshSectWar(),
    refreshCronStatus(),
  ]);
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
  } catch {
    // Non-fatal; show inline warning.
    sectWar.value = null;
  }
}

async function onToggle(ev: AdminLiveOpsEventStatusView): Promise<void> {
  if (togglingKey.value) return;
  // Effective = catalog AND (override absent OR override.enabled).
  // Click "disable" if currently effectiveEnabled, else "enable".
  const nextEnabled = !ev.effectiveEnabled;
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

// Phase 13.1.C — Force Boss Spawn handler.
async function onForceSpawn(): Promise<void> {
  if (bossSubmitting.value) return;
  const region = bossForm.value.regionKey.trim();
  if (!region) {
    toast.push({ type: 'error', text: t('adminLiveOps.boss.errorRegionRequired') });
    return;
  }
  if (!confirm(
    t('adminLiveOps.boss.confirm', {
      region,
      bossKey: bossForm.value.bossKey || '(auto)',
      level: bossForm.value.level,
    }),
  )) {
    return;
  }
  bossSubmitting.value = true;
  try {
    const r = await adminSpawnBoss({
      regionKey: region,
      bossKey: bossForm.value.bossKey.trim() || undefined,
      level: bossForm.value.level,
      force: bossForm.value.force,
      reason: bossForm.value.reason.trim() || undefined,
    });
    toast.push({
      type: 'success',
      text: t('adminLiveOps.boss.toast.spawned', {
        bossKey: r.bossKey,
        region: r.regionKey,
        level: r.level,
      }),
    });
    bossForm.value.reason = '';
  } catch (e) {
    const code = extractApiErrorCodeOrDefault(e, 'UNKNOWN');
    toast.push({ type: 'error', text: t(`adminLiveOps.errors.${code}`, code) });
  } finally {
    bossSubmitting.value = false;
  }
}

// Phase 13.2.D + 14.0.F — Weekly cycle force-run handler.
async function onRunWeeklyCycle(): Promise<void> {
  if (weeklyCycleSubmitting.value) return;
  if (!confirm(t('adminLiveOps.weeklyCycle.confirm'))) return;
  weeklyCycleSubmitting.value = true;
  try {
    const r = await adminLiveOpsRunWeeklyCycle({
      periodKey: weeklyCycleForm.value.periodKey.trim() || undefined,
      bypassLease: weeklyCycleForm.value.bypassLease,
    });
    weeklyCycleResult.value = r;
    toast.push({
      type: 'success',
      text: t('adminLiveOps.weeklyCycle.toast.ok'),
    });
  } catch (e) {
    const code = extractApiErrorCodeOrDefault(e, 'UNKNOWN');
    toast.push({ type: 'error', text: t(`adminLiveOps.errors.${code}`, code) });
  } finally {
    weeklyCycleSubmitting.value = false;
  }
}

// Phase 13.1.C — Sect War snapshot-for-record handler.
async function onSnapshot(): Promise<void> {
  if (snapshotSubmitting.value) return;
  if (!confirm(t('adminLiveOps.sectWar.confirmSnapshot'))) return;
  snapshotSubmitting.value = true;
  try {
    const r = await adminSectWarSnapshot({});
    sectWar.value = r;
    toast.push({ type: 'success', text: t('adminLiveOps.sectWar.toast.snapshot') });
  } catch (e) {
    const code = extractApiErrorCodeOrDefault(e, 'UNKNOWN');
    toast.push({ type: 'error', text: t(`adminLiveOps.errors.${code}`, code) });
  } finally {
    snapshotSubmitting.value = false;
  }
}

const todaySet = computed(() => new Set(status.value?.todayKeys ?? []));
const activeSet = computed(() => new Set(status.value?.activeKeys ?? []));

/**
 * Phase 13.1.C — region select options derived từ catalog BOSS events
 * trong status response (server-truth). Fallback empty nếu chưa load.
 */
const bossRegionOptions = computed<string[]>(() => {
  const events = status.value?.events ?? [];
  const set = new Set<string>();
  for (const ev of events) {
    if (ev.regionKey) set.add(ev.regionKey);
  }
  return Array.from(set).sort();
});

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

      <!-- Phase 13.1.C — Force Boss Spawn section. -->
      <section class="text-xs space-y-2" data-test="admin-liveops-boss">
        <div class="uppercase tracking-widest text-ink-300">
          {{ t('adminLiveOps.boss.title') }}
        </div>
        <div class="text-ink-300/70">
          {{ t('adminLiveOps.boss.help') }}
        </div>
        <div class="grid grid-cols-2 md:grid-cols-5 gap-2">
          <label class="flex flex-col gap-0.5">
            <span class="text-ink-300/70">{{ t('adminLiveOps.boss.regionLabel') }}</span>
            <select
              v-model="bossForm.regionKey"
              class="bg-ink-800 border border-ink-300/30 rounded px-1 py-0.5"
              data-test="admin-liveops-boss-region"
            >
              <option value="">{{ t('adminLiveOps.boss.regionPlaceholder') }}</option>
              <option v-for="r in bossRegionOptions" :key="r" :value="r">{{ r }}</option>
            </select>
          </label>
          <label class="flex flex-col gap-0.5">
            <span class="text-ink-300/70">{{ t('adminLiveOps.boss.bossKeyLabel') }}</span>
            <input
              v-model="bossForm.bossKey"
              type="text"
              maxlength="64"
              class="bg-ink-800 border border-ink-300/30 rounded px-1 py-0.5"
              :placeholder="t('adminLiveOps.boss.bossKeyPlaceholder')"
              data-test="admin-liveops-boss-key"
            />
          </label>
          <label class="flex flex-col gap-0.5">
            <span class="text-ink-300/70">{{ t('adminLiveOps.boss.levelLabel') }}</span>
            <input
              v-model.number="bossForm.level"
              type="number"
              min="1"
              max="10"
              step="1"
              class="bg-ink-800 border border-ink-300/30 rounded px-1 py-0.5"
              data-test="admin-liveops-boss-level"
            />
          </label>
          <label class="flex flex-col gap-0.5">
            <span class="text-ink-300/70">{{ t('adminLiveOps.boss.reasonLabel') }}</span>
            <input
              v-model="bossForm.reason"
              type="text"
              maxlength="200"
              class="bg-ink-800 border border-ink-300/30 rounded px-1 py-0.5"
              :placeholder="t('adminLiveOps.boss.reasonPlaceholder')"
              data-test="admin-liveops-boss-reason"
            />
          </label>
          <div class="flex items-end gap-2">
            <label class="flex items-center gap-1 text-ink-200">
              <input
                v-model="bossForm.force"
                type="checkbox"
                data-test="admin-liveops-boss-force"
              />
              {{ t('adminLiveOps.boss.forceLabel') }}
            </label>
            <button
              type="button"
              class="ml-auto px-3 py-1 rounded border border-rose-300/40 text-rose-200 disabled:opacity-50"
              :disabled="bossSubmitting"
              data-test="admin-liveops-boss-submit"
              @click="onForceSpawn"
            >
              {{ bossSubmitting
                ? t('adminLiveOps.boss.submitting')
                : t('adminLiveOps.boss.submitBtn') }}
            </button>
          </div>
        </div>
      </section>

      <hr class="border-ink-300/20" />

      <!-- Phase 15.8 — Cron health badges (territory + sect-season). -->
      <section class="text-xs space-y-2" data-test="admin-liveops-cron-health">
        <div class="flex items-center justify-between">
          <div class="uppercase tracking-widest text-ink-300">
            {{ t('adminLiveOps.cronHealth.title') }}
          </div>
          <button
            type="button"
            class="px-2 py-0.5 rounded border border-ink-300/30 text-ink-200 text-[10px]"
            data-test="admin-liveops-cron-health-refresh"
            @click="refreshCronStatus()"
          >
            {{ t('adminLiveOps.cronHealth.refresh') }}
          </button>
        </div>
        <div
          v-if="cronStatusError"
          class="text-rose-300"
          data-test="admin-liveops-cron-health-error"
        >
          {{ t('adminLiveOps.cronHealth.error', { code: cronStatusError }) }}
        </div>
        <div class="grid grid-cols-1 md:grid-cols-2 gap-2">
          <div
            v-if="territoryCronStatus"
            class="rounded border border-ink-300/20 p-2 space-y-1"
            data-test="admin-liveops-cron-territory"
          >
            <div class="flex items-center justify-between">
              <div class="text-ink-300/80">
                {{ t('adminLiveOps.cronHealth.territoryLabel') }}
              </div>
              <span
                class="px-1.5 py-0.5 rounded border text-[10px] uppercase tracking-widest"
                :class="healthBadgeClass(territoryCronStatus.health.status)"
                data-test="admin-liveops-cron-territory-badge"
              >
                {{ territoryCronStatus.health.status }}
              </span>
            </div>
            <div class="text-[11px] text-ink-300/70">
              {{ t('adminLiveOps.cronHealth.lastSuccess', {
                at: territoryCronStatus.health.lastSuccessAt ?? t('adminLiveOps.cronHealth.never')
              }) }}
            </div>
            <div
              v-if="territoryCronStatus.health.lastErrorAt"
              class="text-[11px] text-rose-300/80"
              data-test="admin-liveops-cron-territory-last-error"
            >
              {{ t('adminLiveOps.cronHealth.lastError', {
                at: territoryCronStatus.health.lastErrorAt
              }) }}
            </div>
            <div
              v-if="territoryCronStatus.health.staleReason"
              class="text-[11px] text-amber-300/80"
              data-test="admin-liveops-cron-territory-reason"
            >
              {{ territoryCronStatus.health.staleReason }}
            </div>
          </div>
          <div
            v-if="sectSeasonCronStatus"
            class="rounded border border-ink-300/20 p-2 space-y-1"
            data-test="admin-liveops-cron-sect-season"
          >
            <div class="flex items-center justify-between">
              <div class="text-ink-300/80">
                {{ t('adminLiveOps.cronHealth.sectSeasonLabel') }}
              </div>
              <span
                class="px-1.5 py-0.5 rounded border text-[10px] uppercase tracking-widest"
                :class="healthBadgeClass(sectSeasonCronStatus.health.status)"
                data-test="admin-liveops-cron-sect-season-badge"
              >
                {{ sectSeasonCronStatus.health.status }}
              </span>
            </div>
            <div class="text-[11px] text-ink-300/70">
              {{ t('adminLiveOps.cronHealth.lastSuccess', {
                at: sectSeasonCronStatus.health.lastSuccessAt ?? t('adminLiveOps.cronHealth.never')
              }) }}
            </div>
            <div
              v-if="sectSeasonCronStatus.health.lastErrorAt"
              class="text-[11px] text-rose-300/80"
              data-test="admin-liveops-cron-sect-season-last-error"
            >
              {{ t('adminLiveOps.cronHealth.lastError', {
                at: sectSeasonCronStatus.health.lastErrorAt
              }) }}
            </div>
            <div
              v-if="sectSeasonCronStatus.health.staleReason"
              class="text-[11px] text-amber-300/80"
              data-test="admin-liveops-cron-sect-season-reason"
            >
              {{ sectSeasonCronStatus.health.staleReason }}
            </div>
          </div>
        </div>
      </section>

      <hr class="border-ink-300/20" />

      <!-- Phase 13.2.D + 14.0.F — Weekly cycle force-run section. -->
      <section class="text-xs space-y-2" data-test="admin-liveops-weekly-cycle">
        <div class="uppercase tracking-widest text-ink-300">
          {{ t('adminLiveOps.weeklyCycle.title') }}
        </div>
        <div class="text-ink-300/70">
          {{ t('adminLiveOps.weeklyCycle.help') }}
        </div>
        <div class="grid grid-cols-2 md:grid-cols-4 gap-2 items-end">
          <label class="flex flex-col gap-0.5">
            <span class="text-ink-300/70">
              {{ t('adminLiveOps.weeklyCycle.periodLabel') }}
            </span>
            <input
              v-model="weeklyCycleForm.periodKey"
              type="text"
              maxlength="64"
              class="bg-ink-800 border border-ink-300/30 rounded px-1 py-0.5"
              :placeholder="t('adminLiveOps.weeklyCycle.periodPlaceholder')"
              data-test="admin-liveops-weekly-period"
            />
          </label>
          <label class="flex items-center gap-1 text-ink-200">
            <input
              v-model="weeklyCycleForm.bypassLease"
              type="checkbox"
              data-test="admin-liveops-weekly-bypass"
            />
            {{ t('adminLiveOps.weeklyCycle.bypassLeaseLabel') }}
          </label>
          <div class="md:col-span-2 flex items-end">
            <button
              type="button"
              class="ml-auto px-3 py-1 rounded border border-amber-300/40 text-amber-200 disabled:opacity-50"
              :disabled="weeklyCycleSubmitting"
              data-test="admin-liveops-weekly-submit"
              @click="onRunWeeklyCycle"
            >
              {{ weeklyCycleSubmitting
                ? t('adminLiveOps.weeklyCycle.submitting')
                : t('adminLiveOps.weeklyCycle.submitBtn') }}
            </button>
          </div>
        </div>
        <div
          v-if="weeklyCycleResult"
          class="text-ink-200/90"
          data-test="admin-liveops-weekly-summary"
        >
          {{ t('adminLiveOps.weeklyCycle.summary', {
            settled: weeklyCycleResult.territory.territorySettled,
            skipped: weeklyCycleResult.territory.territorySkipped,
            mails: weeklyCycleResult.territory.rewardMailsCreated,
            already: weeklyCycleResult.territory.rewardSkippedAlreadyGranted,
            snapshots: weeklyCycleResult.sectSeason.seasonSnapshotsCreated,
          }) }}
          <div
            class="text-[11px] text-ink-300/80 mt-0.5"
            data-test="admin-liveops-weekly-rewards"
          >
            {{ t('adminLiveOps.weeklyCycle.rewards', {
              champ: weeklyCycleResult.sectSeason.championMailsCreated,
              champExisted: weeklyCycleResult.sectSeason.championAlreadyGranted,
              mvp: weeklyCycleResult.sectSeason.mvpMailsCreated,
              mvpExisted: weeklyCycleResult.sectSeason.mvpAlreadyGranted,
            }) }}
          </div>
          <div
            v-if="weeklyCycleResult.territory.errors.length || weeklyCycleResult.sectSeason.errors.length"
            class="mt-1 text-rose-300"
            data-test="admin-liveops-weekly-errors"
          >
            <div class="text-[10px] uppercase tracking-widest">
              {{ t('adminLiveOps.weeklyCycle.errorsLabel') }}
            </div>
            <ul class="list-disc pl-4">
              <li v-for="(err, i) in weeklyCycleResult.territory.errors" :key="`t-${i}`">
                {{ err.stage }}: {{ err.message }}
              </li>
              <li v-for="(err, i) in weeklyCycleResult.sectSeason.errors" :key="`s-${i}`">
                {{ err.stage }}: {{ err.message }}
              </li>
            </ul>
          </div>
        </div>
      </section>

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
        <div class="flex items-center gap-2">
          <button
            type="button"
            class="px-3 py-1 rounded border border-sky-300/40 text-sky-200 text-xs disabled:opacity-50"
            :disabled="snapshotSubmitting"
            data-test="admin-liveops-snapshot"
            @click="onSnapshot"
          >
            {{ snapshotSubmitting
              ? t('adminLiveOps.sectWar.snapshotting')
              : t('adminLiveOps.sectWar.snapshotBtn') }}
          </button>
          <button
            type="button"
            class="px-3 py-1 rounded border border-amber-300/40 text-amber-200 text-xs"
            data-test="admin-liveops-recalc"
            @click="onRecalc"
          >
            {{ t('adminLiveOps.sectWar.recalcBtn') }}
          </button>
        </div>
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
