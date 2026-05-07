<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRouter } from 'vue-router';
import { useAuthStore } from '@/stores/auth';
import { useGameStore } from '@/stores/game';
import { useToastStore } from '@/stores/toast';
import {
  claimSectWarReward,
  getSectWarCurrent,
  type SectWarCurrent,
} from '@/api/sectWar';
import AppShell from '@/components/shell/AppShell.vue';
import SectWarLeaderboardPanel from '@/components/SectWarLeaderboardPanel.vue';
import SectWarMyProgressPanel from '@/components/SectWarMyProgressPanel.vue';
import SectWarActivityRulesPanel from '@/components/SectWarActivityRulesPanel.vue';
import SectWarRewardPanel from '@/components/SectWarRewardPanel.vue';
import { extractApiErrorCodeOrDefault } from '@/lib/apiError';

const auth = useAuthStore();
const game = useGameStore();
const toast = useToastStore();
const router = useRouter();
const { t } = useI18n();

const state = ref<SectWarCurrent | null>(null);
const loading = ref(true);
const submitting = ref(false);
const error = ref<string | null>(null);

const remainingMs = ref<number>(0);
let timerHandle: ReturnType<typeof setInterval> | null = null;

const remainingText = computed(() => {
  if (remainingMs.value <= 0) return t('sectWar.season.ended');
  const totalSec = Math.floor(remainingMs.value / 1000);
  const days = Math.floor(totalSec / 86400);
  const hours = Math.floor((totalSec % 86400) / 3600);
  const minutes = Math.floor((totalSec % 3600) / 60);
  return t('sectWar.season.remaining', { d: days, h: hours, m: minutes });
});

onMounted(async () => {
  await auth.hydrate();
  if (!auth.isAuthenticated) {
    router.replace('/auth');
    return;
  }
  await game.fetchState().catch(() => null);
  game.bindSocket();
  await refresh();
  startCountdown();
});

function startCountdown(): void {
  if (timerHandle) clearInterval(timerHandle);
  const tick = (): void => {
    if (!state.value) return;
    const ends = new Date(state.value.season.endsAtIso).getTime();
    remainingMs.value = Math.max(0, ends - Date.now());
  };
  tick();
  timerHandle = setInterval(tick, 30_000);
}

async function refresh(): Promise<void> {
  loading.value = true;
  error.value = null;
  try {
    state.value = await getSectWarCurrent();
  } catch (e) {
    const code = extractApiErrorCodeOrDefault(e, 'UNKNOWN');
    error.value = code;
  } finally {
    loading.value = false;
  }
}

async function onClaim(): Promise<void> {
  if (submitting.value || !state.value) return;
  submitting.value = true;
  try {
    const res = await claimSectWarReward();
    toast.push({
      type: 'success',
      text: t('sectWar.reward.claimToast', {
        rank: res.sectRank,
        linhThach: res.granted.linhThach,
        tienNgoc: res.granted.tienNgoc,
      }),
    });
    await refresh();
  } catch (e) {
    const code = extractApiErrorCodeOrDefault(e, 'UNKNOWN');
    const text = t(`sectWar.errors.${code}`, '__missing__');
    toast.push({
      type: 'error',
      text: text === '__missing__' ? t('sectWar.errors.UNKNOWN') : text,
    });
  } finally {
    submitting.value = false;
  }
}
</script>

<template>
  <AppShell>
    <header class="mb-4">
      <h2 class="text-xl tracking-widest">{{ t('sectWar.title') }}</h2>
      <p class="text-xs text-ink-300 mt-1">{{ t('sectWar.subtitle') }}</p>
    </header>

    <div v-if="loading" class="text-ink-300 text-sm" data-test="sect-war-loading">
      {{ t('sectWar.loading') }}
    </div>
    <div v-else-if="error" class="text-rose-300 text-sm" data-test="sect-war-error">
      {{ t(`sectWar.errors.${error}`, t('sectWar.errors.UNKNOWN')) }}
    </div>
    <div v-else-if="state" class="space-y-4" data-test="sect-war-content">
      <section
        class="rounded border border-ink-300/40 bg-ink-700/30 p-4 flex flex-wrap items-center justify-between gap-3"
      >
        <div>
          <div class="text-xs text-ink-300">
            {{ t('sectWar.season.label', { wk: state.weekKey }) }}
          </div>
          <div class="text-amber-300 text-sm" data-test="sect-war-remaining">
            {{ remainingText }}
          </div>
        </div>
        <div class="text-xs text-ink-300/80">
          {{ t('sectWar.season.range', {
            start: new Date(state.season.startsAtIso).toLocaleString(),
            end: new Date(state.season.endsAtIso).toLocaleString(),
          }) }}
        </div>
      </section>

      <SectWarMyProgressPanel :me="state.me" />

      <SectWarLeaderboardPanel
        :rows="state.leaderboard"
        :my-sect-id="state.me.sectId"
      />

      <SectWarRewardPanel
        :tiers="state.rewardTiers"
        :me="state.me"
        :submitting="submitting"
        @claim="onClaim"
      />

      <SectWarActivityRulesPanel :activities="state.activities" />
    </div>
  </AppShell>
</template>
