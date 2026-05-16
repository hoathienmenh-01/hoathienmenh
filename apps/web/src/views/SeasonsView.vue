<script setup lang="ts">
import { computed, onMounted } from 'vue';
import { useI18n } from 'vue-i18n';
import { itemByKey } from '@xuantoi/shared';
import AppShell from '@/components/shell/AppShell.vue';
import XTPageEyebrow from '@/components/xianxia/XTPageEyebrow.vue';
import XTSealFrame from '@/components/xianxia/XTSealFrame.vue';
import { useSeasonStore } from '@/stores/seasons';
import { useToastStore } from '@/stores/toast';
import type { SeasonLeaderboardKind, SeasonRewardView } from '@/api/seasons';

const store = useSeasonStore();
const toast = useToastStore();
const { locale, t } = useI18n();

const leaderboardKinds: SeasonLeaderboardKind[] = [
  'POINTS',
  'ROGUELIKE_FLOOR',
  'BOSS_DEFEATS',
  'DUNGEON_CLEARS',
];

const season = computed(() => store.season);
const progress = computed(() => store.progress);
const rewards = computed(() => store.rewards);
const milestones = computed(() => store.milestones);
const leaderboard = computed(() => store.leaderboard);
const timeLeft = computed(() => {
  if (!season.value) return '';
  const ms = new Date(season.value.endAt).getTime() - Date.now();
  if (ms <= 0) return t('seasons.ended');
  const days = Math.floor(ms / 86_400_000);
  const hours = Math.floor((ms % 86_400_000) / 3_600_000);
  return t('seasons.timeLeftValue', { days, hours });
});

function title(obj: { titleVi?: string; titleEn?: string; name?: string }): string {
  return locale.value === 'en'
    ? obj.titleEn ?? obj.name ?? obj.titleVi ?? ''
    : obj.titleVi ?? obj.name ?? obj.titleEn ?? '';
}

function itemName(itemKey: string): string {
  return itemByKey(itemKey)?.name ?? itemKey;
}

function percent(current: number, target: number): number {
  if (target <= 0) return 0;
  return Math.min(100, Math.floor((current / target) * 100));
}

function errorText(code: string | null): string {
  if (!code) return '';
  return t(`seasons.errors.${code}`, t('seasons.errors.UNKNOWN'));
}

function errorCode(e: unknown): string {
  return (
    (e as { code?: string }).code ??
    (e as { error?: { code?: string } }).error?.code ??
    'UNKNOWN_ERROR'
  );
}

async function loadAll(): Promise<void> {
  await Promise.all([store.load(), store.loadLeaderboard(), store.loadMilestones()]);
}

async function onLeaderboard(kind: SeasonLeaderboardKind): Promise<void> {
  await store.loadLeaderboard(kind);
}

async function onClaim(reward: SeasonRewardView): Promise<void> {
  try {
    const result = await store.claim(reward.rewardKey);
    toast.push({
      type: 'success',
      text: t('seasons.claimToast', {
        linhThach: result.granted.linhThach,
        exp: result.granted.exp,
      }),
    });
  } catch (e) {
    toast.push({ type: 'error', text: errorText(errorCode(e)) });
  }
}

onMounted(() => {
  void loadAll();
});
</script>

<template>
  <AppShell>
    <main class="max-w-7xl mx-auto px-4 py-6 space-y-6" data-testid="seasons-page">
      <XTSealFrame
        tone="gold"
        corner-ornaments="❀✦❀✦"
        watermark-letter="T"
        rounded="xl"
        inset="tight"
        test-id="seasons-view-seal-frame"
        aria-label="Vô Thường Phân Kiếp hero frame"
      >
        <header class="rounded-3xl border border-amber-300/30 bg-ink-800/70 p-5">
          <div class="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
            <div>
              <XTPageEyebrow caps="VÔ THƯỜNG PHÂN KIẾP" label="Vô Thường Phân Kiếp" />
              <p class="mt-1 text-xs uppercase tracking-[0.3em] text-amber-300">
                {{ t('seasons.kicker') }}
              </p>
              <h1 class="mt-2 text-3xl font-bold text-ink-50">
                {{ t('seasons.title') }}
              </h1>
              <p class="mt-2 max-w-3xl text-sm text-ink-300">
                {{ t('seasons.subtitle') }}
              </p>
            </div>
            <button
              type="button"
              class="rounded-xl border border-ink-300/30 px-4 py-2 text-sm hover:bg-ink-700"
              :disabled="store.loading"
              @click="loadAll()"
            >
              {{ t('common.refresh') }}
            </button>
          </div>
        </header>
      </XTSealFrame>

      <section
        v-if="store.lastError"
        class="rounded-2xl border border-red-400/40 bg-red-950/30 p-4 text-red-100"
      >
        {{ errorText(store.lastError) }}
      </section>

      <section v-if="store.loading && !store.loaded" class="rounded-3xl bg-ink-800/70 p-6">
        {{ t('common.loadingData') }}
      </section>

      <section
        v-else-if="!season"
        class="rounded-3xl border border-ink-300/20 bg-ink-800/70 p-6 text-ink-300"
      >
        <h2 class="text-xl font-bold text-ink-50">{{ t('seasons.emptyTitle') }}</h2>
        <p class="mt-2 text-sm">{{ t('seasons.emptyBody') }}</p>
      </section>

      <template v-else>
        <section class="grid gap-4 md:grid-cols-4">
          <div class="rounded-3xl border border-amber-300/30 bg-ink-800/70 p-5 md:col-span-2">
            <div class="text-xs uppercase tracking-[0.25em] text-amber-300">
              {{ season.status }}
            </div>
            <h2 class="mt-2 text-2xl font-bold text-ink-50">{{ season.name }}</h2>
            <p class="mt-2 text-sm text-ink-300">{{ season.description }}</p>
          </div>
          <div class="rounded-3xl border border-ink-300/20 bg-ink-800/70 p-5">
            <div class="text-xs text-ink-400">{{ t('seasons.timeLeft') }}</div>
            <div class="mt-2 text-2xl font-bold text-amber-200">{{ timeLeft }}</div>
          </div>
          <div class="rounded-3xl border border-ink-300/20 bg-ink-800/70 p-5">
            <div class="text-xs text-ink-400">{{ t('seasons.myPoints') }}</div>
            <div class="mt-2 text-2xl font-bold text-emerald-200">
              {{ progress?.points ?? 0 }}
            </div>
          </div>
        </section>

        <section class="grid gap-4 md:grid-cols-3">
          <div class="rounded-3xl border border-ink-300/20 bg-ink-800/70 p-5">
            <h2 class="text-xl font-bold">{{ t('seasons.progress') }}</h2>
            <dl class="mt-4 grid grid-cols-2 gap-3 text-sm">
              <div>
                <dt class="text-ink-400">{{ t('seasons.dailyCap') }}</dt>
                <dd class="font-bold">{{ progress?.dailyUsed ?? 0 }} / {{ progress?.dailyCap ?? 0 }}</dd>
              </div>
              <div>
                <dt class="text-ink-400">{{ t('seasons.weeklyCap') }}</dt>
                <dd class="font-bold">{{ progress?.weeklyUsed ?? 0 }} / {{ progress?.weeklyCap ?? 0 }}</dd>
              </div>
              <div>
                <dt class="text-ink-400">{{ t('seasons.bestFloor') }}</dt>
                <dd class="font-bold">{{ progress?.bestRoguelikeFloor ?? 0 }}</dd>
              </div>
              <div>
                <dt class="text-ink-400">{{ t('seasons.bossDefeats') }}</dt>
                <dd class="font-bold">{{ progress?.bossDefeats ?? 0 }}</dd>
              </div>
            </dl>
          </div>

          <div class="rounded-3xl border border-ink-300/20 bg-ink-800/70 p-5 md:col-span-2">
            <div class="flex items-center justify-between gap-3">
              <h2 class="text-xl font-bold">{{ t('seasons.rewards') }}</h2>
              <span class="text-xs text-amber-200">
                {{ t('seasons.claimableCount', { n: store.claimableCount }) }}
              </span>
            </div>
            <div v-if="!rewards.length" class="mt-4 text-sm text-ink-400">
              {{ t('seasons.emptyRewards') }}
            </div>
            <div v-else class="mt-4 grid gap-3 md:grid-cols-3">
              <article
                v-for="reward in rewards"
                :key="reward.rewardKey"
                class="rounded-2xl border border-ink-300/20 bg-ink-900/60 p-4"
              >
                <div class="font-bold">{{ title(reward) }}</div>
                <div class="mt-1 text-xs text-ink-400">
                  {{ t('seasons.requiresPoints', { n: reward.minPoints }) }}
                </div>
                <ul class="mt-3 space-y-1 text-sm text-ink-200">
                  <li v-if="reward.linhThach">+{{ reward.linhThach }} linh thạch</li>
                  <li v-if="reward.exp">+{{ reward.exp }} EXP</li>
                  <li v-if="reward.eventToken">+{{ reward.eventToken }} event token</li>
                  <li v-for="item in reward.items" :key="item.itemKey">
                    {{ item.qty }}× {{ itemName(item.itemKey) }}
                  </li>
                </ul>
                <button
                  type="button"
                  class="mt-4 w-full rounded-xl bg-amber-300 px-3 py-2 text-sm font-bold text-ink-900 disabled:opacity-50"
                  :disabled="
                    !reward.claimable ||
                      reward.claimed ||
                      store.submittingRewardKey === reward.rewardKey
                  "
                  @click="onClaim(reward)"
                >
                  {{
                    reward.claimed
                      ? t('seasons.claimed')
                      : reward.claimable
                        ? t('seasons.claim')
                        : t('seasons.locked')
                  }}
                </button>
              </article>
            </div>
          </div>
        </section>

        <section class="grid gap-4 lg:grid-cols-2">
          <div class="rounded-3xl border border-ink-300/20 bg-ink-800/70 p-5">
            <div class="flex flex-wrap items-center justify-between gap-3">
              <h2 class="text-xl font-bold">{{ t('seasons.leaderboard') }}</h2>
              <select
                class="rounded-xl border border-ink-300/30 bg-ink-900 px-3 py-2 text-sm"
                :value="store.leaderboardKind"
                @change="onLeaderboard(($event.target as HTMLSelectElement).value as SeasonLeaderboardKind)"
              >
                <option v-for="kind in leaderboardKinds" :key="kind" :value="kind">
                  {{ t(`seasons.leaderboardKind.${kind}`) }}
                </option>
              </select>
            </div>
            <div v-if="store.leaderboardLoading" class="mt-4 text-sm text-ink-300">
              {{ t('common.loadingData') }}
            </div>
            <ol v-else-if="leaderboard.length" class="mt-4 space-y-2">
              <li
                v-for="entry in leaderboard"
                :key="entry.characterId"
                class="flex items-center justify-between rounded-xl bg-ink-900/60 px-3 py-2 text-sm"
              >
                <span>#{{ entry.rank }} {{ entry.characterName }}</span>
                <b>{{ entry.score }}</b>
              </li>
            </ol>
            <p v-else class="mt-4 text-sm text-ink-400">
              {{ t('seasons.emptyLeaderboard') }}
            </p>
          </div>

          <div class="rounded-3xl border border-ink-300/20 bg-ink-800/70 p-5">
            <h2 class="text-xl font-bold">{{ t('seasons.serverMilestones') }}</h2>
            <div v-if="store.milestoneLoading" class="mt-4 text-sm text-ink-300">
              {{ t('common.loadingData') }}
            </div>
            <div v-else-if="!milestones.length" class="mt-4 text-sm text-ink-400">
              {{ t('seasons.emptyMilestones') }}
            </div>
            <div v-else class="mt-4 space-y-3">
              <article
                v-for="m in milestones"
                :key="m.milestoneKey"
                class="rounded-2xl border border-ink-300/20 bg-ink-900/60 p-4"
              >
                <div class="flex items-center justify-between gap-3">
                  <h3 class="font-bold">{{ title(m) }}</h3>
                  <span
                    class="rounded-full px-2 py-0.5 text-xs"
                    :class="m.unlockedAt ? 'bg-[var(--xt-jade-soft)] text-emerald-200' : 'bg-ink-700 text-ink-300'"
                  >
                    {{ m.unlockedAt ? t('seasons.unlocked') : t('seasons.locked') }}
                  </span>
                </div>
                <div class="mt-3 h-2 rounded-full bg-ink-700">
                  <div
                    class="h-2 rounded-full bg-amber-300"
                    :style="{ width: `${percent(m.progress, m.target)}%` }"
                  />
                </div>
                <div class="mt-2 text-xs text-ink-400">
                  {{ m.progress }} / {{ m.target }} ·
                  {{ locale === 'en' ? m.effectEn : m.effectVi }}
                </div>
              </article>
            </div>
          </div>
        </section>
      </template>
    </main>
  </AppShell>
</template>
