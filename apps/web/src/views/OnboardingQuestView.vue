<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRouter } from 'vue-router';
import { useAuthStore } from '@/stores/auth';
import { useOnboardingQuestStore } from '@/stores/onboardingQuest';
import { useToastStore } from '@/stores/toast';
import AppShell from '@/components/shell/AppShell.vue';
import XTPageEyebrow from '@/components/xianxia/XTPageEyebrow.vue';
import XTLuxHero from '@/components/xianxia/XTLuxHero.vue';
import type {
  OnboardingDayView,
  OnboardingTaskView,
} from '@/api/onboardingQuest';

/**
 * Phase 34.0 PR2 — 7-Day Onboarding Questline view (polished).
 *
 * Improvements over PR1:
 *   - Step progress bar (visual day-by-day completion).
 *   - Clear CTAs that deep-link into real features.
 *   - Category icons for task clarity.
 *   - Smooth transition between locked/available/completed states.
 *   - Key onboarding milestones highlighted: character creation, spiritual
 *     root, first cultivation, first quest, first combat, first equipment,
 *     Home unlock.
 */

const router = useRouter();
const auth = useAuthStore();
const store = useOnboardingQuestStore();
const toast = useToastStore();
const { t, locale } = useI18n();

const selectedDay = ref<number | null>(null);

const isVi = computed(() => locale.value === 'vi');

const dayList = computed<OnboardingDayView[]>(() => store.progress?.days ?? []);

const selectedDayView = computed<OnboardingDayView | null>(() => {
  if (selectedDay.value === null) return null;
  return dayList.value.find((d) => d.dayNumber === selectedDay.value) ?? null;
});

/** Progress percentage per day (0-100) for step indicator */
const dayProgressPcts = computed<number[]>(() => {
  return dayList.value.map((d) => {
    if (d.totalTasks === 0) return 0;
    return Math.round(((d.completedTasks + d.claimedTasks) / d.totalTasks) * 100);
  });
});

/** Current active day (first non-completed unlocked day) */
const currentDayNumber = computed<number>(() => {
  for (const d of dayList.value) {
    if (d.status === 'AVAILABLE' || d.status === 'IN_PROGRESS') return d.dayNumber;
  }
  return dayList.value.length > 0 ? dayList.value[dayList.value.length - 1].dayNumber : 1;
});

/** Category icon map */
const CATEGORY_ICONS: Record<string, string> = {
  tutorial: '📖',
  cultivation: '🧘',
  combat: '⚔️',
  story: '📜',
  social: '💬',
  system: '⚙️',
};

function categoryIcon(cat: string): string {
  return CATEGORY_ICONS[cat] ?? '📌';
}

/** CTA label based on task category and action route */
function ctaLabel(task: OnboardingTaskView): string {
  const routeMap: Record<string, string> = {
    '/daily-login': t('onboardingQuest.cta.dailyLogin'),
    '/inventory': t('onboardingQuest.cta.inventory'),
    '/cultivation': t('onboardingQuest.cta.cultivation'),
    '/quest': t('onboardingQuest.cta.quest'),
    '/profile': t('onboardingQuest.cta.profile'),
    '/spiritual-root': t('onboardingQuest.cta.spiritualRoot'),
    '/combat': t('onboardingQuest.cta.combat'),
    '/dungeon': t('onboardingQuest.cta.dungeon'),
    '/story-v2': t('onboardingQuest.cta.story'),
    '/sect': t('onboardingQuest.cta.sect'),
    '/chat': t('onboardingQuest.cta.chat'),
    '/mail': t('onboardingQuest.cta.mail'),
    '/home': t('onboardingQuest.cta.home'),
  };
  return routeMap[task.actionRoute] ?? t('onboardingQuest.actions.open');
}

function pickLocale(vi: string, en: string): string {
  return isVi.value ? vi : en;
}

function errorText(code: string | null): string {
  if (!code) return '';
  const key = `onboardingQuest.error.${code}`;
  const text = t(key);
  return text === key ? t('onboardingQuest.error.UNKNOWN_ERROR') : text;
}

async function refresh(): Promise<void> {
  await store.loadProgress();
  if (store.lastError) {
    toast.push({ type: 'error', text: errorText(store.lastError) });
  }
}

async function onComplete(task: OnboardingTaskView): Promise<void> {
  await store.completeTask(task.taskKey);
  if (store.lastError) {
    toast.push({ type: 'error', text: errorText(store.lastError) });
    return;
  }
  toast.push({
    type: 'success',
    text: t('onboardingQuest.completeToast', {
      name: pickLocale(task.titleVi, task.titleEn),
    }),
  });
}

async function onClaim(task: OnboardingTaskView): Promise<void> {
  await store.claimTask(task.taskKey);
  if (store.lastError) {
    toast.push({ type: 'error', text: errorText(store.lastError) });
    return;
  }
  const last = store.lastClaim;
  if (last && last.claimed) {
    if (last.titleKey) {
      const titleLabel = t(`onboardingQuest.${last.titleKey}_title`);
      toast.push({
        type: 'success',
        text: t('onboardingQuest.claimToastTitle', {
          title:
            titleLabel === `onboardingQuest.${last.titleKey}_title`
              ? last.titleKey
              : titleLabel,
        }),
      });
    } else {
      toast.push({
        type: 'success',
        text: t('onboardingQuest.claimToast', {
          linhThach: last.linhThachGranted,
          exp: last.expGranted,
        }),
      });
    }
  }
  store.clearLastClaim();
}

function onOpen(task: OnboardingTaskView): void {
  router.push(task.actionRoute).catch(() => {});
}

function selectDay(d: OnboardingDayView): void {
  if (d.status === 'LOCKED') return;
  selectedDay.value = d.dayNumber;
}

function clearSelected(): void {
  selectedDay.value = null;
}

watch(
  () => auth.user,
  async (u) => {
    if (u) await refresh();
  },
  { immediate: false },
);

onMounted(async () => {
  if (auth.user) await refresh();
});
</script>

<template>
  <AppShell>
    <section class="space-y-4 p-4">
      <XTLuxHero
        :eyebrow="t('luxHero.onboardingQuest.eyebrow')"
        :label="t('luxHero.onboardingQuest.label')"
        :title="t('onboardingQuest.title')"
        :subtitle="t('onboardingQuest.subtitle')"
        tone="gold"
        watermark-letter="S"
        :breadcrumb="t('luxHero.onboardingQuest.breadcrumb')"
        test-id="onboarding-quest-view-hero"
      >
        <XTPageEyebrow caps="SO KIEN TIEN LO" label="So Kien Tien Lo" class="sr-only" />
        <p class="text-sm text-amber-300 mt-2">
          {{
            t('onboardingQuest.overallProgress', {
              claimed: store.totalClaimed,
              total: store.totalTasks,
              pct: store.overallPct,
            })
          }}
        </p>
      </XTLuxHero>

      <!-- Step Progress Bar -->
      <div
        v-if="dayList.length > 0"
        class="step-progress"
        data-testid="onboarding-step-progress"
      >
        <div class="step-progress-bar">
          <div
            v-for="(d, idx) in dayList"
            :key="d.dayNumber"
            class="step-node"
            :class="{
              'step-locked': d.status === 'LOCKED',
              'step-available': d.status === 'AVAILABLE',
              'step-in-progress': d.status === 'IN_PROGRESS',
              'step-completed': d.status === 'COMPLETED',
              'step-active': d.dayNumber === currentDayNumber,
            }"
            :data-testid="`step-node-${d.dayNumber}`"
          >
            <button
              type="button"
              :disabled="d.status === 'LOCKED'"
              class="step-circle"
              :aria-label="t('onboardingQuest.dayLabel', { n: d.dayNumber })"
              @click="selectDay(d)"
            >
              <span v-if="d.status === 'COMPLETED'" class="step-check">✓</span>
              <span v-else>{{ d.dayNumber }}</span>
            </button>
            <span class="step-label">{{ pickLocale(d.titleVi, d.titleEn) }}</span>
            <div v-if="idx < dayList.length - 1" class="step-connector" :class="{ filled: d.status === 'COMPLETED' }" />
          </div>
        </div>
        <div class="step-overall">
          <div class="step-overall-bar">
            <div class="step-overall-fill" :style="{ width: store.overallPct + '%' }" />
          </div>
          <span class="step-overall-text">{{ store.overallPct }}%</span>
        </div>
      </div>

      <!-- Loading state -->
      <div
        v-if="store.loading && !store.loaded"
        class="rounded border border-gray-700 bg-gray-900 p-6 text-center"
        data-testid="onboarding-loading"
      >
        <div class="inline-block animate-spin rounded-full h-6 w-6 border-2 border-amber-400 border-t-transparent" />
        <p class="text-gray-400 mt-2">{{ t('onboardingQuest.loading') }}</p>
      </div>

      <!-- Day grid -->
      <div v-else-if="selectedDay === null">
        <p
          v-if="dayList.length === 0 && store.loaded"
          class="rounded border border-gray-700 bg-gray-900 p-4 text-center text-gray-400"
        >
          {{ t('onboardingQuest.empty') }}
        </p>
        <div
          v-else
          class="grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4"
          data-testid="onboarding-day-grid"
        >
          <button
            v-for="d in dayList"
            :key="d.dayNumber"
            type="button"
            :disabled="d.status === 'LOCKED'"
            :class="[
              'rounded-lg border p-3 text-left transition relative overflow-hidden',
              d.status === 'LOCKED'
                ? 'cursor-not-allowed border-gray-800 bg-gray-900/50 text-gray-500'
                : d.status === 'COMPLETED'
                  ? 'border-emerald-700 bg-emerald-900/20 hover:border-emerald-400'
                  : d.dayNumber === currentDayNumber
                    ? 'border-amber-400 bg-gray-900 ring-1 ring-amber-400/30'
                    : 'border-amber-700 bg-gray-900 hover:border-amber-400',
            ]"
            :data-testid="`onboarding-day-card-${d.dayNumber}`"
            @click="selectDay(d)"
          >
            <!-- Day progress mini-bar -->
            <div
              v-if="d.status !== 'LOCKED'"
              class="absolute bottom-0 left-0 h-1 bg-amber-500/40 transition-all"
              :style="{ width: dayProgressPcts[d.dayNumber - 1] + '%' }"
            />
            <div class="flex items-center justify-between text-xs uppercase">
              <span class="font-bold">{{ t('onboardingQuest.dayLabel', { n: d.dayNumber }) }}</span>
              <span :class="[
                'rounded px-2 py-0.5',
                d.status === 'COMPLETED' ? 'bg-emerald-800 text-emerald-200' :
                d.status === 'IN_PROGRESS' ? 'bg-amber-800 text-amber-200' :
                'bg-gray-800 text-gray-300'
              ]">
                {{ t(`onboardingQuest.dayStatus.${d.status}`) }}
              </span>
            </div>
            <p class="mt-1 text-base font-semibold">
              {{ pickLocale(d.titleVi, d.titleEn) }}
            </p>
            <p class="mt-1 text-xs text-gray-400">
              {{ pickLocale(d.themeVi, d.themeEn) }}
            </p>
            <p class="mt-2 text-xs text-gray-300">
              {{
                t('onboardingQuest.doneCount', {
                  done: d.completedTasks,
                  total: d.totalTasks,
                })
              }}
            </p>
            <!-- CTA hint for current day -->
            <p
              v-if="d.dayNumber === currentDayNumber && d.status !== 'COMPLETED'"
              class="mt-2 text-xs text-amber-300 font-medium"
              data-testid="onboarding-current-day-cta"
            >
              {{ t('onboardingQuest.currentDayCta') }}
            </p>
          </button>
        </div>
      </div>

      <!-- Day detail -->
      <div v-else-if="selectedDayView" class="space-y-3">
        <button
          type="button"
          class="text-sm text-amber-300 hover:underline flex items-center gap-1"
          data-testid="onboarding-back"
          @click="clearSelected"
        >
          <span>←</span> {{ t('onboardingQuest.back') }}
        </button>
        <h2 class="text-xl font-semibold">
          {{
            t('onboardingQuest.dayLabel', { n: selectedDayView.dayNumber })
          }}
          —
          {{ pickLocale(selectedDayView.titleVi, selectedDayView.titleEn) }}
        </h2>
        <p class="text-sm text-gray-300">
          {{ pickLocale(selectedDayView.themeVi, selectedDayView.themeEn) }}
        </p>
        <!-- Day progress summary -->
        <div class="flex items-center gap-3 text-xs text-gray-400">
          <div class="flex-1 h-2 bg-gray-800 rounded-full overflow-hidden">
            <div
              class="h-full bg-amber-500 rounded-full transition-all"
              :style="{ width: dayProgressPcts[selectedDayView.dayNumber - 1] + '%' }"
            />
          </div>
          <span>{{ selectedDayView.completedTasks }}/{{ selectedDayView.totalTasks }}</span>
        </div>

        <ul class="space-y-2">
          <li
            v-for="task in selectedDayView.tasks"
            :key="task.taskKey"
            :data-testid="`onboarding-task-${task.taskKey}`"
            :class="[
              'rounded border p-3 transition',
              task.status === 'CLAIMED' ? 'border-emerald-800 bg-emerald-900/10' :
              task.status === 'COMPLETED' ? 'border-amber-700 bg-amber-900/10' :
              'border-gray-800 bg-gray-900'
            ]"
          >
            <div class="flex items-center justify-between gap-2">
              <div class="flex items-start gap-2">
                <span class="text-lg mt-0.5" :title="task.category">{{ categoryIcon(task.category) }}</span>
                <div>
                  <p class="font-semibold">
                    {{ pickLocale(task.titleVi, task.titleEn) }}
                  </p>
                  <p class="text-xs text-gray-400">
                    {{ pickLocale(task.descriptionVi, task.descriptionEn) }}
                  </p>
                </div>
              </div>
              <span
                :class="[
                  'rounded px-2 py-0.5 text-xs whitespace-nowrap',
                  task.status === 'CLAIMED' ? 'bg-emerald-800 text-emerald-200' :
                  task.status === 'COMPLETED' ? 'bg-amber-800 text-amber-200' :
                  task.status === 'AVAILABLE' ? 'bg-blue-800 text-blue-200' :
                  'bg-gray-800 text-gray-400'
                ]"
                :data-testid="`onboarding-task-status-${task.taskKey}`"
              >
                {{ t(`onboardingQuest.taskStatus.${task.status}`) }}
              </span>
            </div>
            <div class="mt-2 flex flex-wrap items-center gap-2 text-xs">
              <span class="rounded bg-amber-900/40 px-2 py-0.5 text-amber-200">
                +{{ task.reward.linhThach }}
                {{ t('onboardingQuest.reward.linhThach') }}
              </span>
              <span
                v-if="task.reward.exp > 0"
                class="rounded bg-blue-900/40 px-2 py-0.5 text-blue-200"
              >
                +{{ task.reward.exp }} {{ t('onboardingQuest.reward.exp') }}
              </span>
              <span
                v-if="task.reward.titleKey"
                class="rounded bg-purple-900/40 px-2 py-0.5 text-purple-200"
              >
                {{ t('onboardingQuest.reward.title') }}
              </span>
              <span class="ml-auto text-gray-500">
                {{ t(`onboardingQuest.category.${task.category}`) }}
              </span>
            </div>
            <div class="mt-2 flex flex-wrap gap-2">
              <!-- Deep-link CTA button -->
              <button
                v-if="task.status === 'AVAILABLE' || task.status === 'COMPLETED'"
                type="button"
                class="rounded border border-amber-600 px-3 py-1.5 text-xs font-medium text-amber-200 hover:bg-amber-600/20 transition"
                :data-testid="`onboarding-open-${task.taskKey}`"
                @click="onOpen(task)"
              >
                {{ ctaLabel(task) }}  →
              </button>
              <button
                v-if="task.status === 'AVAILABLE'"
                type="button"
                class="rounded bg-amber-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-amber-600 disabled:opacity-50 transition"
                :disabled="store.submittingKey === task.taskKey"
                :data-testid="`onboarding-complete-${task.taskKey}`"
                @click="onComplete(task)"
              >
                {{ t('onboardingQuest.actions.complete') }}
              </button>
              <button
                v-if="task.status === 'COMPLETED'"
                type="button"
                class="rounded bg-emerald-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-600 disabled:opacity-50 transition"
                :disabled="store.submittingKey === task.taskKey"
                :data-testid="`onboarding-claim-${task.taskKey}`"
                @click="onClaim(task)"
              >
                {{ t('onboardingQuest.actions.claim') }}
              </button>
              <span
                v-if="task.status === 'CLAIMED'"
                class="rounded bg-emerald-900/40 px-3 py-1.5 text-xs text-emerald-300 flex items-center gap-1"
                :data-testid="`onboarding-claimed-${task.taskKey}`"
              >
                ✓ {{ t('onboardingQuest.actions.claimed') }}
              </span>
            </div>
          </li>
        </ul>
      </div>
    </section>
  </AppShell>
</template>


<style scoped>
.step-progress {
  padding: 1rem 0;
}
.step-progress-bar {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  position: relative;
  margin-bottom: 0.75rem;
}
.step-node {
  display: flex;
  flex-direction: column;
  align-items: center;
  position: relative;
  flex: 1;
}
.step-circle {
  width: 2rem;
  height: 2rem;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 0.75rem;
  font-weight: 700;
  border: 2px solid #555;
  background: #1a1a1a;
  color: #888;
  cursor: pointer;
  transition: all 0.2s;
}
.step-circle:disabled {
  cursor: not-allowed;
}
.step-locked .step-circle {
  border-color: #333;
  color: #555;
  opacity: 0.5;
}
.step-available .step-circle {
  border-color: #d97706;
  color: #fbbf24;
}
.step-in-progress .step-circle {
  border-color: #f59e0b;
  background: #451a03;
  color: #fcd34d;
  box-shadow: 0 0 8px rgba(245, 158, 11, 0.3);
}
.step-completed .step-circle {
  border-color: #059669;
  background: #064e3b;
  color: #6ee7b7;
}
.step-active .step-circle {
  box-shadow: 0 0 12px rgba(245, 158, 11, 0.5);
  transform: scale(1.1);
}
.step-check {
  font-size: 0.9rem;
}
.step-label {
  font-size: 0.65rem;
  text-align: center;
  margin-top: 0.25rem;
  color: #999;
  max-width: 5rem;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.step-connector {
  position: absolute;
  top: 1rem;
  left: calc(50% + 1rem);
  right: calc(-50% + 1rem);
  height: 2px;
  background: #333;
}
.step-connector.filled {
  background: #059669;
}
.step-overall {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}
.step-overall-bar {
  flex: 1;
  height: 0.375rem;
  background: #333;
  border-radius: 9999px;
  overflow: hidden;
}
.step-overall-fill {
  height: 100%;
  background: linear-gradient(90deg, #d97706, #f59e0b);
  border-radius: 9999px;
  transition: width 0.4s ease;
}
.step-overall-text {
  font-size: 0.75rem;
  color: #d97706;
  font-weight: 600;
  min-width: 2.5rem;
  text-align: right;
}
</style>
