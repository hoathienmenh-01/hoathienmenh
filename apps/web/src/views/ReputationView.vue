<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRouter } from 'vue-router';
import type { LongTermGoalCategory, ReputationGroup } from '@xuantoi/shared';
import { useAuthStore } from '@/stores/auth';
import { useGameStore } from '@/stores/game';
import { useReputationGoalsStore } from '@/stores/reputationGoals';
import type { LongTermGoalRow } from '@/api/reputation-goals';
import AppShell from '@/components/shell/AppShell.vue';
import XTPageEyebrow from '@/components/xianxia/XTPageEyebrow.vue';

type GroupFilter = 'all' | ReputationGroup;
type GoalFilter = 'all' | LongTermGoalCategory | 'completed' | 'active';

const auth = useAuthStore();
const game = useGameStore();
const store = useReputationGoalsStore();
const router = useRouter();
const { t } = useI18n();

const groupFilter = ref<GroupFilter>('all');
const goalFilter = ref<GoalFilter>('all');

const filteredReputation = computed(() =>
  store.reputation.filter(
    (row) => groupFilter.value === 'all' || row.group === groupFilter.value,
  ),
);

const filteredGoals = computed<LongTermGoalRow[]>(() =>
  store.goals.filter((row) => {
    if (goalFilter.value === 'completed') return row.completedAt !== null;
    if (goalFilter.value === 'active') return row.completedAt === null;
    if (goalFilter.value === 'all') return true;
    return row.def.category === goalFilter.value;
  }),
);

function progressPct(progress: number, goalAmount: number): number {
  if (goalAmount <= 0) return 0;
  return Math.min(100, Math.round((progress / goalAmount) * 100));
}

onMounted(async () => {
  await auth.hydrate();
  if (!auth.isAuthenticated) {
    router.replace('/auth');
    return;
  }
  await game.fetchState().catch(() => null);
  game.bindSocket();
  await store.fetchState().catch(() => null);
});
</script>

<template>
  <AppShell>
    <div class="max-w-5xl mx-auto space-y-4">
      <header class="flex items-baseline justify-between gap-3 flex-wrap">
        <div>
          <XTPageEyebrow label="Hiệp Danh Thiên Hạ" />
          <h1 class="text-2xl tracking-widest font-bold mt-1">{{ t('reputation.title') }}</h1>
          <p class="text-xs text-ink-300 mt-1">{{ t('reputation.subtitle') }}</p>
        </div>
        <div class="text-xs text-ink-300" data-testid="reputation-summary">
          {{
            t('reputation.summary', {
              score: store.totalReputation,
              completed: store.completedGoals,
              total: store.totalGoals,
            })
          }}
        </div>
      </header>

      <section
        v-if="!store.loaded"
        class="bg-ink-700/30 border border-ink-300/20 rounded p-6 text-center text-ink-300"
        data-testid="reputation-loading"
      >
        {{ t('reputation.loading') }}
      </section>

      <template v-else>
        <section class="bg-ink-800/60 border border-ink-300/20 rounded p-4 space-y-3">
          <div class="flex items-center gap-2 flex-wrap text-xs">
            <h2 class="text-lg font-semibold tracking-widest mr-auto">
              {{ t('reputation.groupsTitle') }}
            </h2>
            <label class="text-ink-300">{{ t('reputation.filter.group') }}</label>
            <select
              v-model="groupFilter"
              class="bg-ink-900 border border-ink-300/30 rounded px-2 py-1 text-ink-100"
              data-testid="reputation-filter-group"
            >
              <option value="all">{{ t('reputation.filter.all') }}</option>
              <option
                v-for="row in store.reputation"
                :key="row.group"
                :value="row.group"
              >
                {{ row.def.nameVi }}
              </option>
            </select>
          </div>

          <div class="grid gap-3 md:grid-cols-2">
            <article
              v-for="row in filteredReputation"
              :key="row.group"
              class="rounded border border-ink-300/20 bg-ink-900/40 p-3 space-y-2"
              :data-testid="`reputation-card-${row.group}`"
            >
              <div class="flex items-center justify-between gap-3">
                <h3 class="font-semibold text-amber-100">{{ row.def.nameVi }}</h3>
                <span class="text-xs text-ink-300">
                  {{ t('reputation.score', { score: row.score }) }}
                </span>
              </div>
              <p class="text-xs text-ink-300">{{ row.def.descriptionVi }}</p>
              <div class="space-y-1">
                <div class="flex justify-between text-[11px] text-ink-300">
                  <span>{{ t('reputation.dailyCap') }}</span>
                  <span>{{ row.dailyGain }}/{{ row.dailyCap }}</span>
                </div>
                <div class="h-2 rounded bg-ink-950 overflow-hidden">
                  <div
                    class="h-full bg-[var(--xt-jade-bright)]"
                    :style="{ width: `${progressPct(row.dailyGain, row.dailyCap)}%` }"
                  />
                </div>
              </div>
            </article>
          </div>
        </section>

        <section class="bg-ink-800/60 border border-ink-300/20 rounded p-4 space-y-3">
          <div class="flex items-center gap-2 flex-wrap text-xs">
            <h2 class="text-lg font-semibold tracking-widest mr-auto">
              {{ t('reputation.goalsTitle') }}
            </h2>
            <label class="text-ink-300">{{ t('reputation.filter.goal') }}</label>
            <select
              v-model="goalFilter"
              class="bg-ink-900 border border-ink-300/30 rounded px-2 py-1 text-ink-100"
              data-testid="goals-filter"
            >
              <option value="all">{{ t('reputation.filter.all') }}</option>
              <option value="active">{{ t('reputation.goalStatus.active') }}</option>
              <option value="completed">{{ t('reputation.goalStatus.completed') }}</option>
              <option value="realm">{{ t('reputation.goalCategory.realm') }}</option>
              <option value="body">{{ t('reputation.goalCategory.body') }}</option>
              <option value="pet">{{ t('reputation.goalCategory.pet') }}</option>
              <option value="dungeon">{{ t('reputation.goalCategory.dungeon') }}</option>
              <option value="boss">{{ t('reputation.goalCategory.boss') }}</option>
              <option value="sect">{{ t('reputation.goalCategory.sect') }}</option>
            </select>
          </div>

          <div
            v-if="filteredGoals.length === 0"
            class="rounded border border-ink-300/20 bg-ink-900/40 p-6 text-center text-ink-300"
            data-testid="goals-empty"
          >
            {{ t('reputation.empty') }}
          </div>

          <div v-else class="space-y-3" data-testid="long-term-goals-panel">
            <article
              v-for="row in filteredGoals"
              :key="row.goalKey"
              class="rounded border border-ink-300/20 bg-ink-900/40 p-3 space-y-2"
              :data-testid="`goal-card-${row.goalKey}`"
            >
              <div class="flex items-center gap-2 flex-wrap">
                <h3 class="font-semibold text-ink-100">{{ row.def.nameVi }}</h3>
                <span class="text-[10px] px-1.5 py-0.5 rounded border border-ink-300/30 text-ink-300">
                  {{ t(`reputation.goalCategory.${row.def.category}`) }}
                </span>
                <span
                  class="ml-auto text-[10px] px-1.5 py-0.5 rounded border"
                  :class="
                    row.completedAt
                      ? 'border-emerald-500/40 text-emerald-200 bg-emerald-700/30'
                      : 'border-amber-500/40 text-amber-200 bg-amber-700/30'
                  "
                >
                  {{
                    row.completedAt
                      ? t('reputation.goalStatus.completed')
                      : t('reputation.goalStatus.active')
                  }}
                </span>
              </div>
              <p class="text-xs text-ink-300">{{ row.def.descriptionVi }}</p>
              <div class="space-y-1">
                <div class="flex justify-between text-[11px] text-ink-300">
                  <span>{{ t('reputation.progress') }}</span>
                  <span>{{ row.progress }}/{{ row.def.goalAmount }}</span>
                </div>
                <div class="h-2 rounded bg-ink-950 overflow-hidden">
                  <div
                    class="h-full bg-amber-500"
                    :style="{ width: `${progressPct(row.progress, row.def.goalAmount)}%` }"
                  />
                </div>
              </div>
            </article>
          </div>
        </section>
      </template>
    </div>
  </AppShell>
</template>
