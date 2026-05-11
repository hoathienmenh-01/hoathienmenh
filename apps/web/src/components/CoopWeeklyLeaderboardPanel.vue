<template>
  <section
    class="space-y-3 rounded border border-ink-300/30 bg-ink-900/40 p-3"
    data-testid="coop-weekly-leaderboard-panel"
  >
    <header class="space-y-1">
      <h3 class="text-sm uppercase tracking-widest text-amber-200">
        {{ t('coopRewardCap.title') }}
      </h3>
      <p class="text-xs text-ink-300/80">
        {{ t('coopRewardCap.subtitle') }}
      </p>
    </header>

    <div
      v-if="loading"
      class="text-xs text-ink-300/80"
      data-testid="coop-reward-cap-loading"
    >
      …
    </div>

    <div
      v-else-if="errorMsg"
      class="text-xs text-red-300"
      data-testid="coop-reward-cap-error"
    >
      {{ errorMsg }}
    </div>

    <template v-else>
      <!-- My status -->
      <div
        v-if="status"
        class="space-y-2 rounded border border-ink-300/20 bg-ink-900/60 p-3"
        data-testid="coop-reward-cap-status"
      >
        <h4 class="text-[11px] uppercase tracking-widest text-amber-200">
          {{ t('coopRewardCap.status.title') }}
        </h4>
        <dl class="grid grid-cols-1 gap-1 text-[11px] text-ink-300/80 sm:grid-cols-2">
          <div data-testid="coop-reward-cap-week">
            {{ t('coopRewardCap.status.weekKey', { weekKey: status.weekKey }) }}
          </div>
          <div data-testid="coop-reward-cap-day">
            {{ t('coopRewardCap.status.dayKey', { dayKey: status.dayKey }) }}
          </div>
          <div data-testid="coop-reward-cap-boss-usage">
            {{
              t('coopRewardCap.status.bossUsage', {
                used: status.boss.dailyUsed,
                limit: status.boss.dailyLimit,
                wUsed: status.boss.weeklyUsed,
                wLimit: status.boss.weeklyLimit,
              })
            }}
          </div>
          <div data-testid="coop-reward-cap-dungeon-usage">
            {{
              t('coopRewardCap.status.dungeonUsage', {
                used: status.dungeon.dailyUsed,
                limit: status.dungeon.dailyLimit,
                wUsed: status.dungeon.weeklyUsed,
                wLimit: status.dungeon.weeklyLimit,
              })
            }}
          </div>
          <div data-testid="coop-reward-cap-points">
            {{
              t('coopRewardCap.status.weeklyPoints', {
                points: status.weeklyPoints,
              })
            }}
          </div>
          <div data-testid="coop-reward-cap-rank">
            {{
              t('coopRewardCap.status.weeklyRank', {
                rank:
                  status.weeklyRank !== null
                    ? status.weeklyRank
                    : t('coopRewardCap.status.weeklyRankNone'),
              })
            }}
          </div>
          <div
            v-if="status.weeklyRewardTier"
            data-testid="coop-reward-cap-tier"
          >
            {{
              t('coopRewardCap.status.weeklyTier', {
                tier: t(`coopRewardCap.tier.${status.weeklyRewardTier}`),
              })
            }}
          </div>
        </dl>

        <div class="flex flex-wrap items-center gap-2 text-[11px]">
          <span
            v-if="status.weeklyClaimStatus === 'CLAIMED'"
            class="text-amber-200/80"
            data-testid="coop-reward-cap-claimed"
          >
            {{ t('coopRewardCap.status.claimed') }}
          </span>
          <span
            v-else-if="claimable"
            class="text-amber-200/80"
            data-testid="coop-reward-cap-claimable"
          >
            {{ t('coopRewardCap.status.claimable') }}
          </span>
          <button
            v-if="claimable"
            type="button"
            class="ml-auto rounded border border-amber-400/60 bg-amber-900/40 px-3 py-1 text-[11px] uppercase tracking-widest text-amber-100 disabled:opacity-50"
            :disabled="busyClaim"
            data-testid="coop-reward-cap-claim"
            @click="onClaim"
          >
            {{ t('coopRewardCap.actions.claim') }}
          </button>
          <button
            type="button"
            class="rounded border border-ink-300/40 px-2 py-1 text-[10px] uppercase tracking-widest text-ink-200 disabled:opacity-50"
            :disabled="loading"
            data-testid="coop-reward-cap-refresh"
            @click="refresh"
          >
            {{ t('coopRewardCap.actions.refresh') }}
          </button>
        </div>
      </div>

      <div
        v-else
        class="text-xs text-ink-300/70"
        data-testid="coop-reward-cap-no-season"
      >
        {{ t('coopRewardCap.status.noSeason') }}
      </div>

      <!-- Leaderboard -->
      <div
        class="space-y-2 rounded border border-ink-300/20 bg-ink-900/60 p-3"
        data-testid="coop-weekly-leaderboard"
      >
        <h4 class="text-[11px] uppercase tracking-widest text-amber-200">
          {{ t('coopRewardCap.leaderboard.title') }}
        </h4>
        <p
          v-if="!leaderboard || leaderboard.entries.length === 0"
          class="text-[11px] text-ink-300/70"
          data-testid="coop-weekly-leaderboard-empty"
        >
          {{ t('coopRewardCap.leaderboard.empty') }}
        </p>
        <ul
          v-else
          class="space-y-1 text-[11px]"
          data-testid="coop-weekly-leaderboard-entries"
        >
          <li
            v-for="entry in leaderboard.entries"
            :key="`${entry.seasonId}:${entry.userId}`"
            class="flex flex-wrap items-center gap-2 rounded border border-ink-300/20 bg-ink-900/40 px-2 py-1"
            :data-testid="`coop-weekly-leaderboard-entry-${entry.userId}`"
          >
            <span class="w-8 text-amber-200/90">
              {{ entry.rank ?? '—' }}
            </span>
            <span class="flex-1 truncate">
              {{ entry.displayName ?? entry.userId.slice(0, 6) }}
            </span>
            <span class="text-ink-300/70">
              {{
                t('coopRewardCap.leaderboard.bossPoints') +
                  ': ' +
                  entry.bossContributionPoints
              }}
            </span>
            <span class="text-ink-300/70">
              {{
                t('coopRewardCap.leaderboard.dungeonPoints') +
                  ': ' +
                  entry.dungeonContributionPoints
              }}
            </span>
            <span class="text-amber-200/80">
              {{
                t('coopRewardCap.leaderboard.totalPoints') +
                  ': ' +
                  entry.totalPoints
              }}
            </span>
            <span
              v-if="entry.rewardTier"
              class="rounded border border-amber-400/40 px-1 text-[10px] uppercase tracking-widest text-amber-200"
            >
              {{ t(`coopRewardCap.tier.${entry.rewardTier}`) }}
            </span>
          </li>
        </ul>
        <p
          v-if="leaderboard && leaderboard.total > leaderboard.entries.length"
          class="text-[10px] text-ink-300/60"
          data-testid="coop-weekly-leaderboard-total"
        >
          {{
            t('coopRewardCap.leaderboard.totalEntries', {
              count: leaderboard.total,
            })
          }}
        </p>
      </div>
    </template>
  </section>
</template>

<script setup lang="ts">
import type {
  CoopRewardStatusDto,
  CoopWeeklyLeaderboardResponse,
} from '@xuantoi/shared';
import { computed, onMounted, reactive, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import {
  claimCoopWeeklyReward,
  getCoopRewardStatus,
  getCoopWeeklyLeaderboard,
} from '@/api/coopRewardCap';
import { extractApiErrorCodeOrDefault } from '@/lib/apiError';
import { useToastStore } from '@/stores/toast';

const { t } = useI18n();
const toast = useToastStore();

const loading = ref(false);
const errorMsg = ref('');
const status = ref<CoopRewardStatusDto | null>(null);
const leaderboard = ref<CoopWeeklyLeaderboardResponse | null>(null);

const busy = reactive({ claim: false });
const busyClaim = computed(() => busy.claim);

const claimable = computed(() => {
  const s = status.value;
  if (!s) return false;
  if (!s.weeklyRewardTier || s.weeklyRewardTier === 'NONE') return false;
  return s.weeklyClaimStatus === 'PENDING' || s.weeklyClaimStatus === null;
});

function errMsg(e: unknown): string {
  const code = extractApiErrorCodeOrDefault(e, 'UNKNOWN');
  const key = `coopRewardCap.errors.${code}`;
  const fallback = t('coopRewardCap.errors.UNKNOWN');
  const msg = t(key);
  return msg === key ? fallback : msg;
}

async function refresh(): Promise<void> {
  loading.value = true;
  errorMsg.value = '';
  try {
    const [s, lb] = await Promise.all([
      getCoopRewardStatus(),
      getCoopWeeklyLeaderboard({ limit: 20 }),
    ]);
    status.value = s;
    leaderboard.value = lb;
  } catch (e) {
    errorMsg.value = errMsg(e);
  } finally {
    loading.value = false;
  }
}

async function onClaim(): Promise<void> {
  if (busy.claim) return;
  const s = status.value;
  if (!s || !s.currentSeasonId) return;
  busy.claim = true;
  try {
    await claimCoopWeeklyReward(s.currentSeasonId);
    toast.push({ type: 'success', text: t('coopRewardCap.toast.claimed') });
    await refresh();
  } catch (e) {
    toast.push({ type: 'error', text: errMsg(e) });
  } finally {
    busy.claim = false;
  }
}

onMounted(() => {
  void refresh();
});

defineExpose({ refresh });
</script>
