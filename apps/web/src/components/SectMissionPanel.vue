<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useToastStore } from '@/stores/toast';
import {
  claimSectMission,
  getSectMissions,
  type SectMissionListView,
  type SectMissionView,
} from '@/api/sectMissions';
import { extractApiErrorCodeOrDefault } from '@/lib/apiError';

/**
 * Phase 13.1.B — Sect Mission Panel.
 *
 * Mục tiêu:
 *   - Render daily/weekly missions với progress bar.
 *   - Claim button gate: ready && !claimed.
 *   - Hiển thị contribution balance (spendable) + lifetime.
 *   - Error fallback i18n.
 *   - emit `claimed` cho parent re-fetch (e.g. shop balance).
 */

const { t } = useI18n();
const toast = useToastStore();
const emit = defineEmits<{
  (e: 'claimed', payload: { contribBalance: number; contribLifetime: number }): void;
}>();

const state = ref<SectMissionListView | null>(null);
const loading = ref(true);
const error = ref<string | null>(null);
const claimingKey = ref<string | null>(null);

const dailyMissions = computed(() =>
  state.value ? state.value.missions.filter((m) => m.cadence === 'DAILY') : [],
);
const weeklyMissions = computed(() =>
  state.value ? state.value.missions.filter((m) => m.cadence === 'WEEKLY') : [],
);

onMounted(async () => {
  await refresh();
});

async function refresh(): Promise<void> {
  loading.value = true;
  error.value = null;
  try {
    state.value = await getSectMissions();
  } catch (e) {
    error.value = extractApiErrorCodeOrDefault(e, 'UNKNOWN');
  } finally {
    loading.value = false;
  }
}

defineExpose({ refresh });

async function onClaim(mission: SectMissionView): Promise<void> {
  if (claimingKey.value || !state.value) return;
  claimingKey.value = mission.key;
  try {
    const res = await claimSectMission(mission.key);
    toast.push({
      type: 'success',
      text: t('sectMission.toast.claimed', {
        title: t(mission.titleI18nKey, mission.key),
        contrib: res.rewardContribution,
      }),
    });
    emit('claimed', {
      contribBalance: res.contribBalanceAfter,
      contribLifetime: res.contribLifetimeAfter,
    });
    await refresh();
  } catch (e) {
    const code = extractApiErrorCodeOrDefault(e, 'UNKNOWN');
    const text = t(`sectMission.errors.${code}`, '__missing__');
    toast.push({
      type: 'error',
      text: text === '__missing__' ? t('sectMission.errors.UNKNOWN') : text,
    });
  } finally {
    claimingKey.value = null;
  }
}

function progressPct(m: SectMissionView): number {
  if (m.target <= 0) return 0;
  return Math.min(100, Math.floor((m.progress / m.target) * 100));
}

function rewardText(m: SectMissionView): string {
  const parts: string[] = [
    t('sectMission.reward.contrib', { n: m.rewardContribution }),
  ];
  if (m.rewardCurrency === 'LINH_THACH' && m.rewardCurrencyAmount) {
    parts.push(t('sectMission.reward.linhThach', { n: m.rewardCurrencyAmount }));
  }
  if (m.rewardCurrency === 'TIEN_NGOC' && m.rewardCurrencyAmount) {
    parts.push(t('sectMission.reward.tienNgoc', { n: m.rewardCurrencyAmount }));
  }
  if (m.rewardItemKey && m.rewardItemQty) {
    parts.push(
      t('sectMission.reward.item', { k: m.rewardItemKey, n: m.rewardItemQty }),
    );
  }
  return parts.join(' · ');
}
</script>

<template>
  <section class="border border-ink-300/40 rounded" data-test="sect-mission-panel">
    <div
      class="px-4 py-2 text-xs uppercase tracking-widest text-ink-300 border-b border-ink-300/30 flex items-center justify-between"
    >
      <span>{{ t('sectMission.title') }}</span>
      <span v-if="state" class="text-amber-300/80 normal-case tracking-normal">
        {{ t('sectMission.balance', {
          balance: state.contribBalance,
          lifetime: state.contribLifetime,
        }) }}
      </span>
    </div>

    <div v-if="loading" class="p-4 text-sm text-ink-300" data-test="sect-mission-loading">
      {{ t('sectMission.loading') }}
    </div>
    <div v-else-if="error" class="p-4 text-sm text-rose-300" data-test="sect-mission-error">
      {{ t(`sectMission.errors.${error}`, t('sectMission.errors.UNKNOWN')) }}
    </div>
    <div v-else-if="state" class="p-4 space-y-4" data-test="sect-mission-list">
      <div v-if="!state.sectId" class="text-sm text-amber-300">
        {{ t('sectMission.noSect') }}
      </div>

      <div v-if="state.sectId">
        <div class="text-xs uppercase tracking-widest text-ink-300 mb-2">
          {{ t('sectMission.dailyHeader') }}
        </div>
        <div v-if="dailyMissions.length === 0" class="text-sm text-ink-300/70">
          {{ t('sectMission.empty') }}
        </div>
        <ul v-else class="space-y-2">
          <li
            v-for="m in dailyMissions"
            :key="m.key"
            class="border border-ink-300/30 rounded p-3"
            data-test="sect-mission-row"
          >
            <div class="flex items-start justify-between gap-3">
              <div class="flex-1 min-w-0">
                <div class="text-sm">{{ t(m.titleI18nKey, m.key) }}</div>
                <div class="text-xs text-ink-300/80">
                  {{ t(m.descriptionI18nKey, '') }}
                </div>
                <div class="mt-2 h-2 bg-ink-700/50 rounded overflow-hidden">
                  <div
                    class="h-full bg-emerald-400/70"
                    :style="{ width: progressPct(m) + '%' }"
                  ></div>
                </div>
                <div class="mt-1 text-xs text-ink-300">
                  {{ t('sectMission.progress', {
                    cur: m.progress,
                    tar: m.target,
                  }) }}
                </div>
              </div>
              <div class="text-right space-y-1 shrink-0">
                <div class="text-xs text-amber-300">{{ rewardText(m) }}</div>
                <button
                  type="button"
                  class="px-3 py-1 rounded border border-amber-300/40 text-amber-200 text-xs disabled:opacity-50 disabled:cursor-not-allowed"
                  :disabled="!m.ready || m.claimed || claimingKey === m.key"
                  data-test="sect-mission-claim"
                  @click="onClaim(m)"
                >
                  <span v-if="m.claimed">{{ t('sectMission.claimed') }}</span>
                  <span v-else-if="!m.ready">{{ t('sectMission.notReady') }}</span>
                  <span v-else>{{ t('sectMission.claimBtn') }}</span>
                </button>
              </div>
            </div>
          </li>
        </ul>
      </div>

      <div v-if="state.sectId">
        <div class="text-xs uppercase tracking-widest text-ink-300 mb-2 mt-4">
          {{ t('sectMission.weeklyHeader') }}
        </div>
        <div v-if="weeklyMissions.length === 0" class="text-sm text-ink-300/70">
          {{ t('sectMission.empty') }}
        </div>
        <ul v-else class="space-y-2">
          <li
            v-for="m in weeklyMissions"
            :key="m.key"
            class="border border-ink-300/30 rounded p-3"
            data-test="sect-mission-row"
          >
            <div class="flex items-start justify-between gap-3">
              <div class="flex-1 min-w-0">
                <div class="text-sm">{{ t(m.titleI18nKey, m.key) }}</div>
                <div class="text-xs text-ink-300/80">
                  {{ t(m.descriptionI18nKey, '') }}
                </div>
                <div class="mt-2 h-2 bg-ink-700/50 rounded overflow-hidden">
                  <div
                    class="h-full bg-sky-400/70"
                    :style="{ width: progressPct(m) + '%' }"
                  ></div>
                </div>
                <div class="mt-1 text-xs text-ink-300">
                  {{ t('sectMission.progress', {
                    cur: m.progress,
                    tar: m.target,
                  }) }}
                </div>
              </div>
              <div class="text-right space-y-1 shrink-0">
                <div class="text-xs text-amber-300">{{ rewardText(m) }}</div>
                <button
                  type="button"
                  class="px-3 py-1 rounded border border-amber-300/40 text-amber-200 text-xs disabled:opacity-50 disabled:cursor-not-allowed"
                  :disabled="!m.ready || m.claimed || claimingKey === m.key"
                  data-test="sect-mission-claim"
                  @click="onClaim(m)"
                >
                  <span v-if="m.claimed">{{ t('sectMission.claimed') }}</span>
                  <span v-else-if="!m.ready">{{ t('sectMission.notReady') }}</span>
                  <span v-else>{{ t('sectMission.claimBtn') }}</span>
                </button>
              </div>
            </div>
          </li>
        </ul>
      </div>
    </div>
  </section>
</template>
