<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRoute, useRouter } from 'vue-router';
import { useAuthStore } from '@/stores/auth';
import { useGameStore } from '@/stores/game';
import { useToastStore } from '@/stores/toast';
import {
  claimSectWarReward,
  getSectWarCurrent,
  type SectWarCurrent,
} from '@/api/sectWar';
import AppShell from '@/components/shell/AppShell.vue';
import XTHeroEyebrow from '@/components/xianxia/XTHeroEyebrow.vue';
import SectWarLeaderboardPanel from '@/components/SectWarLeaderboardPanel.vue';
import SectWarMyProgressPanel from '@/components/SectWarMyProgressPanel.vue';
import SectWarActivityRulesPanel from '@/components/SectWarActivityRulesPanel.vue';
import SectWarRewardPanel from '@/components/SectWarRewardPanel.vue';
import SectMissionPanel from '@/components/SectMissionPanel.vue';
import SectShopPanel from '@/components/SectShopPanel.vue';
import SectSeasonPanel from '@/components/SectSeasonPanel.vue';
import SectSeasonHistoryPanel from '@/components/SectSeasonHistoryPanel.vue';
import { extractApiErrorCodeOrDefault } from '@/lib/apiError';

type SectWarTab =
  | 'overview'
  | 'leaderboard'
  | 'missions'
  | 'shop'
  | 'rewards'
  | 'season'
  | 'hallOfFame';
const ALL_TABS: ReadonlyArray<SectWarTab> = [
  'overview',
  'leaderboard',
  'missions',
  'shop',
  'rewards',
  'season',
  'hallOfFame',
];

const auth = useAuthStore();
const game = useGameStore();
const toast = useToastStore();
const router = useRouter();
const route = useRoute();
const { t } = useI18n();

const state = ref<SectWarCurrent | null>(null);
const loading = ref(true);
const submitting = ref(false);
const error = ref<string | null>(null);

const queryTab = (route.query.tab as string | undefined) ?? '';
const initialTab: SectWarTab = (ALL_TABS as ReadonlyArray<string>).includes(queryTab)
  ? (queryTab as SectWarTab)
  : 'overview';
const tab = ref<SectWarTab>(initialTab);

function setTab(next: SectWarTab): void {
  tab.value = next;
  // Persist via query để deep-link/back works.
  router.replace({ query: { ...route.query, tab: next } }).catch(() => null);
}

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
      <XTHeroEyebrow han="宗门大战" label="Tông Môn Đại Chiến" />
      <h2 class="text-xl tracking-widest mt-1">{{ t('sectWar.title') }}</h2>
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

      <nav
        class="flex flex-wrap gap-2 text-xs"
        role="tablist"
        data-test="sect-war-tabs"
      >
        <button
          v-for="key in ALL_TABS"
          :key="key"
          type="button"
          role="tab"
          :aria-selected="tab === key"
          class="px-3 py-1 rounded border tracking-widest uppercase"
          :class="tab === key
            ? 'border-amber-300/70 text-amber-200 bg-ink-700/40'
            : 'border-ink-300/40 text-ink-300 hover:border-amber-300/40'"
          :data-test="`sect-war-tab-${key}`"
          @click="setTab(key)"
        >
          {{ t(`sectWar.tab.${key}`) }}
        </button>
      </nav>

      <section v-if="tab === 'overview'" data-test="sect-war-tab-content-overview">
        <SectWarMyProgressPanel :me="state.me" />
        <SectWarActivityRulesPanel class="mt-4" :activities="state.activities" />
      </section>

      <section v-else-if="tab === 'leaderboard'" data-test="sect-war-tab-content-leaderboard">
        <SectWarLeaderboardPanel
          :rows="state.leaderboard"
          :my-sect-id="state.me.sectId"
        />
      </section>

      <section v-else-if="tab === 'missions'" data-test="sect-war-tab-content-missions">
        <SectMissionPanel />
      </section>

      <section v-else-if="tab === 'shop'" data-test="sect-war-tab-content-shop">
        <SectShopPanel />
      </section>

      <section v-else-if="tab === 'rewards'" data-test="sect-war-tab-content-rewards">
        <SectWarRewardPanel
          :tiers="state.rewardTiers"
          :me="state.me"
          :submitting="submitting"
          @claim="onClaim"
        />
      </section>

      <section v-else-if="tab === 'season'" data-test="sect-war-tab-content-season">
        <SectSeasonPanel :my-sect-id="state.me.sectId" />
      </section>

      <section
        v-else-if="tab === 'hallOfFame'"
        data-test="sect-war-tab-content-hallOfFame"
      >
        <SectSeasonHistoryPanel />
      </section>
    </div>
  </AppShell>
</template>
