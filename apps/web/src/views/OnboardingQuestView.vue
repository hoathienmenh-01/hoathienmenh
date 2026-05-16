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
 * Phase 34.0 — 7-Day Onboarding Questline view.
 *
 * Layout:
 *   - Header: title + overall progress %.
 *   - Day grid: 7 cards (D1..D7) — locked/unlocked.
 *   - Day detail (when selected): task list with action route + claim CTA.
 *
 * Server-authoritative — FE chỉ render + dispatch action, KHÔNG cộng reward
 * client-side. Sau action thành công store reload progress từ server.
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
  // Best-effort routing — actionRoute là Vue path (e.g. '/inventory').
  // Nếu route không tồn tại, router push trả về NavigationFailure — bắt nhẹ.
  router.push(task.actionRoute).catch(() => {
    // ignore — leave user on the same page.
  });
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
        eyebrow="SƠ KIẾN TIÊN LỘ"
        label="Sơ Kiến Tiên Lộ"
        :title="t('onboardingQuest.title')"
        :subtitle="t('onboardingQuest.subtitle')"
        tone="gold"
        watermark-letter="S"
        breadcrumb="Khởi Đầu · 7 Ngày"
        test-id="onboarding-quest-view-hero"
      >
        <XTPageEyebrow caps="SƠ KIẾN TIÊN LỘ" label="Sơ Kiến Tiên Lộ" class="sr-only" />
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

      <!-- Day grid -->
      <div v-if="selectedDay === null">
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
              'rounded-lg border p-3 text-left transition',
              d.status === 'LOCKED'
                ? 'cursor-not-allowed border-gray-800 bg-gray-900/50 text-gray-500'
                : 'border-amber-700 bg-gray-900 hover:border-amber-400',
            ]"
            :data-testid="`onboarding-day-card-${d.dayNumber}`"
            @click="selectDay(d)"
          >
            <div class="flex items-center justify-between text-xs uppercase">
              <span>{{ t('onboardingQuest.dayLabel', { n: d.dayNumber }) }}</span>
              <span class="rounded bg-gray-800 px-2 py-0.5">
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
          </button>
        </div>
      </div>

      <!-- Day detail -->
      <div v-else-if="selectedDayView" class="space-y-3">
        <button
          type="button"
          class="text-sm text-amber-300 hover:underline"
          data-testid="onboarding-back"
          @click="clearSelected"
        >
          {{ t('onboardingQuest.back') }}
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

        <ul class="space-y-2">
          <li
            v-for="task in selectedDayView.tasks"
            :key="task.taskKey"
            :data-testid="`onboarding-task-${task.taskKey}`"
            class="rounded border border-gray-800 bg-gray-900 p-3"
          >
            <div class="flex items-center justify-between gap-2">
              <div>
                <p class="font-semibold">
                  {{ pickLocale(task.titleVi, task.titleEn) }}
                </p>
                <p class="text-xs text-gray-400">
                  {{ pickLocale(task.descriptionVi, task.descriptionEn) }}
                </p>
              </div>
              <span
                class="rounded bg-gray-800 px-2 py-0.5 text-xs"
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
              <button
                type="button"
                class="rounded border border-gray-700 px-2 py-1 text-xs text-gray-200 hover:border-amber-400"
                :data-testid="`onboarding-open-${task.taskKey}`"
                @click="onOpen(task)"
              >
                {{ t('onboardingQuest.actions.open') }}
              </button>
              <button
                v-if="task.status === 'AVAILABLE'"
                type="button"
                class="rounded bg-amber-700 px-2 py-1 text-xs text-white hover:bg-amber-600 disabled:opacity-50"
                :disabled="store.submittingKey === task.taskKey"
                :data-testid="`onboarding-complete-${task.taskKey}`"
                @click="onComplete(task)"
              >
                {{ t('onboardingQuest.actions.complete') }}
              </button>
              <button
                v-if="task.status === 'COMPLETED'"
                type="button"
                class="rounded bg-emerald-700 px-2 py-1 text-xs text-white hover:bg-emerald-600 disabled:opacity-50"
                :disabled="store.submittingKey === task.taskKey"
                :data-testid="`onboarding-claim-${task.taskKey}`"
                @click="onClaim(task)"
              >
                {{ t('onboardingQuest.actions.claim') }}
              </button>
              <span
                v-if="task.status === 'CLAIMED'"
                class="rounded bg-gray-800 px-2 py-1 text-xs text-gray-400"
                :data-testid="`onboarding-claimed-${task.taskKey}`"
              >
                {{ t('onboardingQuest.actions.claimed') }}
              </span>
            </div>
          </li>
        </ul>
      </div>
    </section>
  </AppShell>
</template>
