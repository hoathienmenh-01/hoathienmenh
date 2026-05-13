<script setup lang="ts">
import { computed, onMounted, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useAuthStore } from '@/stores/auth';
import { useDailyEncounterStore } from '@/stores/dailyEncounter';
import { useToastStore } from '@/stores/toast';
import AppShell from '@/components/shell/AppShell.vue';

/**
 * Phase 34.1 — Daily Random Encounter / Kỳ Ngộ view.
 *
 * Layout:
 *   - Header: title + dateKey + status badge.
 *   - Encounter card: name + description + rarity + reward profile.
 *   - Action bar: accept → choose (if any) → complete → claim, or skip.
 *
 * Server-authoritative — store mirrors state, never optimistic.
 */

const auth = useAuthStore();
const store = useDailyEncounterStore();
const toast = useToastStore();
const { t, locale } = useI18n();

const isVi = computed(() => locale.value === 'vi');
const e = computed(() => store.today);

function pickLocale(vi: string, en: string): string {
  return isVi.value ? vi : en;
}

function errText(code: string | null): string {
  if (!code) return '';
  const key = `encounter.error.${code}`;
  const text = t(key);
  return text === key ? t('encounter.error.UNKNOWN_ERROR') : text;
}

async function refresh(): Promise<void> {
  await store.loadToday();
  if (store.lastError)
    toast.push({ type: 'error', text: errText(store.lastError) });
}

async function onAccept(): Promise<void> {
  await store.accept();
  if (store.lastError) toast.push({ type: 'error', text: errText(store.lastError) });
}

async function onComplete(): Promise<void> {
  await store.complete();
  if (store.lastError) toast.push({ type: 'error', text: errText(store.lastError) });
}

async function onSkip(): Promise<void> {
  await store.skip();
  if (store.lastError) toast.push({ type: 'error', text: errText(store.lastError) });
}

async function onClaim(): Promise<void> {
  await store.claim();
  if (store.lastError) {
    toast.push({ type: 'error', text: errText(store.lastError) });
    return;
  }
  const last = store.lastClaim;
  if (last?.claimed) {
    toast.push({
      type: 'success',
      text: t('encounter.claimToast', {
        linhThach: last.linhThachGranted,
        exp: last.expGranted,
      }),
    });
  }
}

watch(
  () => auth.user,
  async (u) => {
    if (u) await refresh();
  },
);

onMounted(async () => {
  if (auth.user) await refresh();
});
</script>

<template>
  <AppShell>
    <section class="space-y-4 p-4">
      <header class="space-y-1">
        <h1 class="text-2xl font-bold">{{ t('encounter.title') }}</h1>
        <p class="text-sm text-gray-300">{{ t('encounter.subtitle') }}</p>
      </header>

      <p
        v-if="store.loading"
        class="rounded border border-gray-800 bg-gray-900 p-4 text-center text-gray-400"
      >
        {{ t('encounter.loading') }}
      </p>

      <article
        v-else-if="e"
        class="rounded-lg border border-amber-700 bg-gray-900 p-4"
        data-testid="encounter-card"
      >
        <div class="flex items-center justify-between text-xs uppercase">
          <span data-testid="encounter-date">{{ e.dateKey }}</span>
          <span class="rounded bg-gray-800 px-2 py-0.5">
            {{ t(`encounter.status.${e.status}`) }}
          </span>
        </div>
        <h2 class="mt-2 text-xl font-semibold">
          {{ pickLocale(e.titleVi, e.titleEn) }}
        </h2>
        <p class="mt-2 text-sm text-gray-300">
          {{ pickLocale(e.descriptionVi, e.descriptionEn) }}
        </p>
        <div class="mt-2 flex flex-wrap items-center gap-2 text-xs">
          <span
            class="rounded bg-amber-900/40 px-2 py-0.5 text-amber-200"
            data-testid="encounter-reward-linhThach"
          >
            +{{ e.rewardProfile.linhThach }}
            {{ t('encounter.reward.linhThach') }}
          </span>
          <span
            class="rounded bg-blue-900/40 px-2 py-0.5 text-blue-200"
            data-testid="encounter-reward-exp"
          >
            +{{ e.rewardProfile.exp }} {{ t('encounter.reward.exp') }}
          </span>
          <span class="rounded bg-purple-900/40 px-2 py-0.5 text-purple-200">
            {{ t(`encounter.rarity.${e.rarity}`) }}
          </span>
        </div>

        <div class="mt-4 flex flex-wrap gap-2">
          <button
            v-if="store.canAccept"
            type="button"
            class="rounded bg-amber-700 px-3 py-1 text-sm hover:bg-amber-600 disabled:opacity-50"
            :disabled="!!store.submitting"
            data-testid="encounter-accept"
            @click="onAccept"
          >
            {{ t('encounter.accept') }}
          </button>
          <button
            v-if="store.canComplete"
            type="button"
            class="rounded bg-emerald-700 px-3 py-1 text-sm hover:bg-emerald-600 disabled:opacity-50"
            :disabled="!!store.submitting"
            data-testid="encounter-complete"
            @click="onComplete"
          >
            {{ t('encounter.complete') }}
          </button>
          <button
            v-if="store.canClaim"
            type="button"
            class="rounded bg-yellow-600 px-3 py-1 text-sm hover:bg-yellow-500 disabled:opacity-50"
            :disabled="!!store.submitting"
            data-testid="encounter-claim"
            @click="onClaim"
          >
            {{ t('encounter.claim') }}
          </button>
          <button
            v-if="e.status === 'AVAILABLE' || e.status === 'ACCEPTED'"
            type="button"
            class="rounded border border-gray-700 px-3 py-1 text-sm text-gray-300 hover:bg-gray-800 disabled:opacity-50"
            :disabled="!!store.submitting"
            data-testid="encounter-skip"
            @click="onSkip"
          >
            {{ t('encounter.skip') }}
          </button>
        </div>
      </article>
    </section>
  </AppShell>
</template>
