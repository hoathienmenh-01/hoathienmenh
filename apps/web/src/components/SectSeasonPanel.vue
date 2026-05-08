<script setup lang="ts">
/**
 * Phase 13.2.A — Sect Season tab nội dung.
 *
 * Render:
 *   - Header season hiện tại (label + countdown).
 *   - Personal status: total points, weeks contributed, milestone progress.
 *   - Milestone preview list (achieved icon + reward summary).
 *   - Leaderboard top 10 sect cho season.
 *   - Out-of-season fallback (FE chỉ hiện info banner, không crash).
 *
 * KHÔNG có claim button — Phase 13.2.A read-only. Reward claim sẽ ở
 * Phase 13.2.B+.
 */
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import {
  getSectSeasonCurrent,
  type SectSeasonCurrent,
  type SectSeasonMilestone,
} from '@/api/sectSeason';
import { extractApiErrorCodeOrDefault } from '@/lib/apiError';

const props = defineProps<{
  /** Sect ID của user — highlight hàng leaderboard nếu match. */
  mySectId?: string | null;
}>();

const { t } = useI18n();

const state = ref<SectSeasonCurrent | null>(null);
const loading = ref(true);
const error = ref<string | null>(null);
const remainingMs = ref<number>(0);
let timerHandle: ReturnType<typeof setInterval> | null = null;

const remainingText = computed(() => {
  if (!state.value?.season) return '';
  if (remainingMs.value <= 0) return t('sectSeason.season.ended');
  const totalSec = Math.floor(remainingMs.value / 1000);
  const days = Math.floor(totalSec / 86400);
  const hours = Math.floor((totalSec % 86400) / 3600);
  const minutes = Math.floor((totalSec % 3600) / 60);
  return t('sectSeason.season.remaining', { d: days, h: hours, m: minutes });
});

const personalPoints = computed(() => state.value?.me?.personalPoints ?? 0);
const weeksContributed = computed(() => state.value?.me?.weeksContributed ?? 0);
const achievedKeys = computed(
  () => new Set(state.value?.me?.achievedMilestoneKeys ?? []),
);
const nextMilestone = computed(() => {
  const nextKey = state.value?.me?.nextMilestoneKey;
  if (!nextKey) return null;
  return state.value?.milestones.find((m) => m.key === nextKey) ?? null;
});

function progressPercent(milestone: SectSeasonMilestone): number {
  if (milestone.requiredPoints <= 0) return 100;
  const p = Math.floor((personalPoints.value / milestone.requiredPoints) * 100);
  return Math.max(0, Math.min(100, p));
}

function isAchieved(milestone: SectSeasonMilestone): boolean {
  return achievedKeys.value.has(milestone.key);
}

function rewardSummary(milestone: SectSeasonMilestone): string {
  const parts: string[] = [];
  const r = milestone.reward;
  if (r.linhThach && r.linhThach > 0) {
    parts.push(t('sectSeason.reward.linhThach', { n: r.linhThach }));
  }
  if (r.tienNgoc && r.tienNgoc > 0) {
    parts.push(t('sectSeason.reward.tienNgoc', { n: r.tienNgoc }));
  }
  if (r.items && r.items.length > 0) {
    parts.push(t('sectSeason.reward.items', { n: r.items.length }));
  }
  if (r.titleKey) {
    parts.push(t('sectSeason.reward.titleAward', { k: r.titleKey }));
  }
  if (r.buffKey) {
    parts.push(t('sectSeason.reward.buff', { k: r.buffKey }));
  }
  return parts.join(' · ');
}

onMounted(async () => {
  await refresh();
  startCountdown();
});

async function refresh(): Promise<void> {
  loading.value = true;
  error.value = null;
  try {
    state.value = await getSectSeasonCurrent();
  } catch (e) {
    error.value = extractApiErrorCodeOrDefault(e, 'UNKNOWN');
  } finally {
    loading.value = false;
  }
}

function startCountdown(): void {
  if (timerHandle) clearInterval(timerHandle);
  const tick = (): void => {
    if (!state.value?.season) {
      remainingMs.value = 0;
      return;
    }
    const ends = new Date(state.value.season.endsAtIso).getTime();
    remainingMs.value = Math.max(0, ends - Date.now());
  };
  tick();
  timerHandle = setInterval(tick, 30_000);
}
</script>

<template>
  <div data-test="sect-season-panel" class="space-y-4">
    <div v-if="loading" class="text-ink-300 text-sm" data-test="sect-season-loading">
      {{ t('sectSeason.loading') }}
    </div>
    <div v-else-if="error" class="text-rose-300 text-sm" data-test="sect-season-error">
      {{ t(`sectSeason.errors.${error}`, t('sectSeason.errors.UNKNOWN')) }}
    </div>
    <div v-else-if="state && !state.season" data-test="sect-season-out-of-range" class="text-ink-300 text-sm rounded border border-ink-300/40 bg-ink-700/30 p-4">
      {{ t('sectSeason.outOfRange') }}
    </div>
    <div v-else-if="state && state.season" class="space-y-4" data-test="sect-season-content">
      <!-- Header: season label + countdown + range -->
      <section
        class="rounded border border-amber-300/30 bg-ink-700/30 p-4 flex flex-wrap items-center justify-between gap-3"
        data-test="sect-season-header"
      >
        <div>
          <div class="text-amber-200 text-sm tracking-widest uppercase">
            {{ t(state.season.labelI18nKey, t('sectSeason.season.fallbackLabel', { k: state.season.key })) }}
          </div>
          <div class="text-xs text-ink-300/80 mt-1" data-test="sect-season-key">
            {{ t('sectSeason.season.keyLabel', { k: state.season.key }) }}
          </div>
          <div class="text-amber-300 text-sm mt-1" data-test="sect-season-remaining">
            {{ remainingText }}
          </div>
        </div>
        <div class="text-xs text-ink-300/80 text-right">
          {{ t('sectSeason.season.range', {
            start: new Date(state.season.startsAtIso).toLocaleDateString(),
            end: new Date(state.season.endsAtIso).toLocaleDateString(),
            weeks: state.season.durationWeeks,
          }) }}
        </div>
      </section>

      <!-- Personal status -->
      <section
        class="rounded border border-ink-300/40 bg-ink-700/20 p-4"
        data-test="sect-season-my-progress"
      >
        <h3 class="text-sm tracking-widest uppercase text-amber-200 mb-2">
          {{ t('sectSeason.myProgress.title') }}
        </h3>
        <div v-if="!state.me" class="text-ink-300 text-sm" data-test="sect-season-no-me">
          {{ t('sectSeason.myProgress.noData') }}
        </div>
        <div v-else class="grid grid-cols-1 md:grid-cols-3 gap-3 text-sm">
          <div>
            <div class="text-xs text-ink-300/70">{{ t('sectSeason.myProgress.sect') }}</div>
            <div data-test="sect-season-my-sect" class="text-ink-100">
              {{ state.me.hasSect && state.me.sectName ? state.me.sectName : t('sectSeason.myProgress.noSect') }}
            </div>
          </div>
          <div>
            <div class="text-xs text-ink-300/70">{{ t('sectSeason.myProgress.personalPoints') }}</div>
            <div data-test="sect-season-my-points" class="text-amber-200 text-lg">
              {{ state.me.personalPoints.toLocaleString() }}
            </div>
          </div>
          <div>
            <div class="text-xs text-ink-300/70">{{ t('sectSeason.myProgress.weeksContributed') }}</div>
            <div data-test="sect-season-my-weeks" class="text-ink-100">
              {{ t('sectSeason.myProgress.weeksOf', {
                contributed: weeksContributed,
                total: state.season.durationWeeks,
              }) }}
            </div>
          </div>
        </div>
        <div v-if="nextMilestone" class="mt-3 text-xs text-ink-300/80" data-test="sect-season-next-milestone-hint">
          {{ t('sectSeason.myProgress.nextHint', {
            label: t(nextMilestone.labelI18nKey, nextMilestone.key),
            need: Math.max(0, nextMilestone.requiredPoints - personalPoints),
          }) }}
        </div>
      </section>

      <!-- Milestones -->
      <section
        class="rounded border border-ink-300/40 bg-ink-700/20 p-4"
        data-test="sect-season-milestones"
      >
        <h3 class="text-sm tracking-widest uppercase text-amber-200 mb-2">
          {{ t('sectSeason.milestone.title') }}
        </h3>
        <ul class="divide-y divide-ink-300/20">
          <li
            v-for="m in state.milestones"
            :key="m.key"
            class="py-2 flex items-start gap-3"
            :data-test="`sect-season-milestone-row-${m.key}`"
          >
            <div
              class="mt-0.5 w-5 h-5 flex items-center justify-center rounded-full border text-xs"
              :class="isAchieved(m)
                ? 'border-amber-300 bg-amber-300/20 text-amber-200'
                : 'border-ink-300/40 text-ink-300/40'"
              :data-test="`sect-season-milestone-status-${m.key}`"
              :aria-label="isAchieved(m) ? t('sectSeason.milestone.achieved') : t('sectSeason.milestone.locked')"
            >
              {{ isAchieved(m) ? '✓' : '·' }}
            </div>
            <div class="flex-1">
              <div class="flex items-baseline justify-between gap-2 flex-wrap">
                <div class="text-sm" :class="isAchieved(m) ? 'text-amber-200' : 'text-ink-200'">
                  {{ t(m.labelI18nKey, m.key) }}
                </div>
                <div class="text-xs text-ink-300/70">
                  {{ t('sectSeason.milestone.required', { n: m.requiredPoints }) }}
                </div>
              </div>
              <div class="text-xs text-ink-300/80 mt-1">
                {{ t(m.descriptionI18nKey, '') }}
              </div>
              <div class="text-xs text-amber-200/80 mt-1" :data-test="`sect-season-milestone-reward-${m.key}`">
                {{ rewardSummary(m) }}
              </div>
              <div
                class="mt-1 h-1 rounded bg-ink-300/20 overflow-hidden"
                :data-test="`sect-season-milestone-progress-${m.key}`"
                :aria-valuenow="progressPercent(m)"
                role="progressbar"
              >
                <div
                  class="h-full"
                  :class="isAchieved(m) ? 'bg-amber-300' : 'bg-amber-300/40'"
                  :style="{ width: progressPercent(m) + '%' }"
                />
              </div>
            </div>
          </li>
        </ul>
      </section>

      <!-- Leaderboard -->
      <section
        class="rounded border border-ink-300/40 bg-ink-700/20 p-4"
        data-test="sect-season-leaderboard"
      >
        <h3 class="text-sm tracking-widest uppercase text-amber-200 mb-2">
          {{ t('sectSeason.leaderboard.title') }}
        </h3>
        <div v-if="state.leaderboard.length === 0" class="text-ink-300 text-sm" data-test="sect-season-leaderboard-empty">
          {{ t('sectSeason.leaderboard.empty') }}
        </div>
        <table v-else class="w-full text-sm">
          <thead class="text-xs text-ink-300/70 uppercase">
            <tr>
              <th class="text-left py-1">{{ t('sectSeason.leaderboard.col.rank') }}</th>
              <th class="text-left py-1">{{ t('sectSeason.leaderboard.col.sect') }}</th>
              <th class="text-right py-1">{{ t('sectSeason.leaderboard.col.points') }}</th>
              <th class="text-right py-1">{{ t('sectSeason.leaderboard.col.contributors') }}</th>
              <th class="text-right py-1">{{ t('sectSeason.leaderboard.col.weeks') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="row in state.leaderboard"
              :key="row.sectId"
              :data-test="`sect-season-leaderboard-row`"
              :class="props.mySectId === row.sectId ? 'bg-amber-300/10' : ''"
            >
              <td class="py-1 text-ink-200">#{{ row.rank }}</td>
              <td class="py-1 text-ink-100">
                {{ row.sectName }}
                <span v-if="props.mySectId === row.sectId" class="text-xs text-amber-200">
                  {{ t('sectSeason.leaderboard.youTag') }}
                </span>
              </td>
              <td class="py-1 text-right text-amber-200">{{ row.points.toLocaleString() }}</td>
              <td class="py-1 text-right text-ink-200">{{ row.contributors }}</td>
              <td class="py-1 text-right text-ink-200">{{ row.weeksContributed }}</td>
            </tr>
          </tbody>
        </table>
      </section>
    </div>
  </div>
</template>
