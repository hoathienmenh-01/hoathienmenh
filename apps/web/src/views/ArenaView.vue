<script setup lang="ts">
/**
 * Phase 14.1.B — Async Arena Foundation view.
 *
 * Layout:
 *   - Profile card: rating + W/L/D + attacks today.
 *   - Last result banner: outcome, damage summary, condensed log.
 *   - Opponents list: rating, sect, "Challenge" button.
 *   - Match history list: outcome + counterpart + rating delta.
 *
 * State machine handled qua `useArenaStore`. Loading / empty / error states
 * cho cả 3 panel (profile / opponents / history).
 */
import { computed, onMounted } from 'vue';
import { useI18n } from 'vue-i18n';
import { useArenaStore } from '@/stores/arena';
import { useToastStore } from '@/stores/toast';
import { useFeatureFlagsStore } from '@/stores/featureFlags';
import AppShell from '@/components/shell/AppShell.vue';
import MButton from '@/components/ui/MButton.vue';
import FeatureDisabledBanner from '@/components/FeatureDisabledBanner.vue';

const arena = useArenaStore();
const toast = useToastStore();
const featureFlags = useFeatureFlagsStore();
const { t } = useI18n();

// Phase 15.4 — Arena feature flag gate. Server vẫn gate cuối cùng
// (`ARENA_DISABLED` 503), FE chỉ ẩn challenge button + show banner để UX.
const arenaDisabled = computed(() => featureFlags.isDisabled('ARENA_ENABLED'));

onMounted(() => {
  void featureFlags.ensureLoaded();
  void arena.fetchProfile();
  void arena.fetchOpponents();
  void arena.fetchHistory();
  // Phase 14.1.C — load season + standing + leaderboard + reward preview.
  void arena.fetchSeason();
  void arena.fetchMyStanding();
  void arena.fetchLeaderboard({ limit: 20 });
  void arena.fetchRewardPreview();
});

const profile = computed(() => arena.profile);
const opponents = computed(() => arena.opponents ?? []);
const history = computed(() => arena.history ?? []);
const lastResult = computed(() => arena.lastResult);

// Phase 14.1.C — season getters.
const season = computed(() => arena.season);
const myStanding = computed(() => arena.myStanding);
const leaderboardEntries = computed(
  () => arena.leaderboard?.entries ?? [],
);
const leaderboardTotal = computed(() => arena.leaderboard?.total ?? 0);
const rewardTiers = computed(() => arena.rewardPreview?.tiers ?? []);

const showLeaderboardLoading = computed(
  () => arena.leaderboardLoading && !arena.leaderboard,
);
const leaderboardEmpty = computed(
  () => !arena.leaderboardLoading && leaderboardEntries.value.length === 0,
);
const showRewardLoading = computed(
  () => arena.rewardPreviewLoading && !arena.rewardPreview,
);

function formatDate(iso?: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString();
}

function historyDeltaForMe(
  m: { ratingDelta?: { attacker: number; defender: number }; attackerCharacterId: string },
): number | null {
  if (!m.ratingDelta) return null;
  const myId = profile.value?.characterId ?? '';
  if (m.attackerCharacterId === myId) return m.ratingDelta.attacker;
  return m.ratingDelta.defender;
}

function tierLabel(tier: string): string {
  const k = `arena.season.tier.${tier}`;
  return t(k);
}

const showProfileLoading = computed(
  () => arena.profileLoading && !arena.profile,
);
const showOpponentsLoading = computed(
  () => arena.opponentsLoading && !arena.opponents,
);
const showHistoryLoading = computed(
  () => arena.historyLoading && !arena.history,
);

const opponentsEmpty = computed(
  () => !arena.opponentsLoading && opponents.value.length === 0,
);
const historyEmpty = computed(
  () => !arena.historyLoading && history.value.length === 0,
);

function attacksRemainingLabel(): string {
  const p = profile.value;
  if (!p) return '';
  if (p.attacksRemaining < 0) return t('arena.profile.unlimited');
  return String(p.attacksRemaining);
}

async function challenge(opponentId: string): Promise<void> {
  const code = await arena.challenge(opponentId);
  if (!code) {
    toast.push({
      type: 'success',
      text: t('arena.toast.challengeSuccess'),
    });
    return;
  }
  const i18nKey = `arena.errors.${code}`;
  const text = t(i18nKey);
  toast.push({
    type: 'error',
    text: text === i18nKey ? t('arena.errors.UNKNOWN') : text,
  });
}

function refresh(): void {
  void arena.fetchOpponents();
  void arena.fetchHistory();
  void arena.fetchProfile();
  void arena.fetchSeason();
  void arena.fetchMyStanding();
  void arena.fetchLeaderboard({ limit: 20 });
  void arena.fetchRewardPreview();
}

function clearBanner(): void {
  arena.clearLastResult();
}

function outcomeKind(outcome: string, attackerId: string): 'win' | 'lose' | 'draw' {
  if (outcome === 'DRAW') return 'draw';
  const myId = profile.value?.characterId ?? '';
  const meIsAttacker = attackerId === myId;
  if (outcome === 'ATTACKER_WIN') return meIsAttacker ? 'win' : 'lose';
  if (outcome === 'DEFENDER_WIN') return meIsAttacker ? 'lose' : 'win';
  return 'draw';
}
</script>

<template>
  <AppShell>
    <section class="px-4 py-6 max-w-4xl mx-auto" data-testid="arena-view">
      <header class="mb-6">
        <h1 class="text-2xl font-bold text-amber-200">{{ t('arena.title') }}</h1>
        <p class="text-sm text-slate-400 mt-1">{{ t('arena.subtitle') }}</p>
      </header>

      <!-- Phase 15.4 — Arena disabled banner. -->
      <FeatureDisabledBanner
        v-if="arenaDisabled"
        message-key="arena.disabled.message"
        test-id="arena-disabled-banner"
        class="mb-4"
      />

      <!-- Phase 14.1.C — Season banner + my standing -->
      <div
        class="rounded-xl border border-indigo-500/30 bg-slate-900/60 p-4 mb-6"
        data-testid="arena-season"
      >
        <div v-if="arena.seasonLoading && !season" class="text-slate-400" data-testid="arena-season-loading">
          {{ t('common.loading') }}
        </div>
        <div v-else-if="arena.seasonError" class="text-red-400" data-testid="arena-season-error">
          {{ t('arena.errors.SEASON_FETCH_FAILED') }}
        </div>
        <div v-else-if="season" class="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div class="text-xs text-slate-400">{{ t('arena.season.title') }}</div>
            <div class="text-lg font-semibold text-indigo-200" data-testid="arena-season-key">
              {{ season.seasonKey }}
            </div>
            <div class="text-xs text-slate-500 mt-1">
              {{ t(`arena.season.status.${season.status}`) }}
              · {{ t('arena.season.cadence.weekly') }}
              · {{ season.timezone }}
            </div>
            <div class="text-xs text-slate-500">
              {{ t('arena.season.starts') }}: {{ formatDate(season.startsAtIso) }}
              · {{ t('arena.season.ends') }}: {{ formatDate(season.endsAtIso) }}
              <span v-if="season.settledAtIso">
                · {{ t('arena.season.settledAt') }}: {{ formatDate(season.settledAtIso) }}
              </span>
            </div>
          </div>
          <div
            v-if="myStanding"
            class="grid grid-cols-2 sm:grid-cols-4 gap-2 text-center min-w-[16rem]"
            data-testid="arena-season-standing"
          >
            <div>
              <div class="text-xs text-slate-400">{{ t('arena.season.myStanding.rating') }}</div>
              <div class="text-lg font-bold text-amber-300">{{ myStanding.rating }}</div>
            </div>
            <div>
              <div class="text-xs text-slate-400">{{ t('arena.season.myStanding.tier') }}</div>
              <div class="text-lg font-bold text-indigo-300">{{ tierLabel(myStanding.tier) }}</div>
            </div>
            <div>
              <div class="text-xs text-slate-400">{{ t('arena.season.myStanding.rank') }}</div>
              <div class="text-lg font-bold text-slate-100">
                {{ myStanding.rank ?? t('arena.season.myStanding.noRank') }}
              </div>
            </div>
            <div>
              <div class="text-xs text-slate-400">{{ t('arena.season.myStanding.wins') }}/{{ t('arena.season.myStanding.losses') }}</div>
              <div class="text-lg font-bold text-slate-100">{{ myStanding.wins }}/{{ myStanding.losses }}</div>
            </div>
          </div>
        </div>
      </div>

      <!-- Profile -->
      <div
        class="rounded-xl border border-amber-500/30 bg-slate-900/60 p-4 mb-6"
        data-testid="arena-profile"
      >
        <div v-if="showProfileLoading" class="text-slate-400" data-testid="arena-profile-loading">
          {{ t('common.loading') }}
        </div>
        <div
          v-else-if="arena.profileError"
          class="text-red-400"
          data-testid="arena-profile-error"
        >
          {{ t('arena.errors.PROFILE_FETCH_FAILED') }}
        </div>
        <div v-else-if="profile" class="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div>
            <div class="text-xs text-slate-400">{{ t('arena.profile.rating') }}</div>
            <div class="text-xl font-bold text-amber-300" data-testid="arena-profile-rating">
              {{ profile.rating }}
            </div>
            <div class="text-xs text-slate-500">{{ t('arena.profile.tier') }}: {{ profile.tier }}</div>
          </div>
          <div>
            <div class="text-xs text-slate-400">{{ t('arena.profile.wins') }}</div>
            <div class="text-xl font-bold text-emerald-400" data-testid="arena-profile-wins">{{ profile.wins }}</div>
          </div>
          <div>
            <div class="text-xs text-slate-400">{{ t('arena.profile.losses') }}</div>
            <div class="text-xl font-bold text-red-400" data-testid="arena-profile-losses">{{ profile.losses }}</div>
          </div>
          <div>
            <div class="text-xs text-slate-400">{{ t('arena.profile.attacksToday') }}</div>
            <div class="text-xl font-bold text-slate-200" data-testid="arena-profile-attacks">
              {{ profile.attacksToday }}
              <span class="text-sm text-slate-500">/ {{ attacksRemainingLabel() }}</span>
            </div>
          </div>
        </div>
      </div>

      <!-- Last result banner -->
      <div
        v-if="lastResult"
        class="rounded-xl border bg-slate-900/60 p-4 mb-6"
        :class="{
          'border-emerald-500/40': outcomeKind(lastResult.outcome, lastResult.attackerCharacterId) === 'win',
          'border-red-500/40': outcomeKind(lastResult.outcome, lastResult.attackerCharacterId) === 'lose',
          'border-slate-500/40': outcomeKind(lastResult.outcome, lastResult.attackerCharacterId) === 'draw',
        }"
        data-testid="arena-last-result"
      >
        <div class="flex justify-between items-start">
          <div>
            <div class="text-lg font-bold" data-testid="arena-last-result-outcome">
              <span v-if="outcomeKind(lastResult.outcome, lastResult.attackerCharacterId) === 'win'" class="text-emerald-300">
                {{ t('arena.result.win') }}
              </span>
              <span v-else-if="outcomeKind(lastResult.outcome, lastResult.attackerCharacterId) === 'lose'" class="text-red-300">
                {{ t('arena.result.lose') }}
              </span>
              <span v-else class="text-slate-300">{{ t('arena.result.draw') }}</span>
            </div>
            <div class="text-sm text-slate-400 mt-1">
              {{ t('arena.result.vs', { name: lastResult.defenderName }) }}
            </div>
            <div class="text-xs text-slate-500 mt-2" data-testid="arena-last-result-damage">
              {{ t('arena.result.damageAttacker', { d: lastResult.totalAttackerDamage }) }}
              ·
              {{ t('arena.result.damageDefender', { d: lastResult.totalDefenderDamage }) }}
              ·
              {{ t('arena.result.rounds', { n: lastResult.rounds }) }}
            </div>
            <ul class="mt-3 text-xs space-y-1 text-slate-400" data-testid="arena-last-result-log">
              <li v-for="line in lastResult.battleLog" :key="line.round">
                {{ t('arena.result.logLine', {
                  r: line.round,
                  side: t(`arena.result.side.${line.attackerSide}`),
                  d: line.finalDamage,
                  ahp: line.attackerHp,
                  dhp: line.defenderHp,
                }) }}
              </li>
            </ul>
          </div>
          <button
            type="button"
            class="text-slate-400 hover:text-slate-200 text-sm"
            data-testid="arena-last-result-dismiss"
            @click="clearBanner"
          >
            {{ t('common.dismiss') }}
          </button>
        </div>
      </div>

      <!-- Opponents -->
      <div class="mb-6">
        <div class="flex justify-between items-center mb-2">
          <h2 class="text-lg font-semibold text-slate-200">{{ t('arena.opponents.title') }}</h2>
          <MButton
            data-testid="arena-refresh"
            @click="refresh"
          >
            {{ t('arena.opponents.refresh') }}
          </MButton>
        </div>
        <div v-if="showOpponentsLoading" class="text-slate-400" data-testid="arena-opponents-loading">
          {{ t('common.loading') }}
        </div>
        <div v-else-if="arena.opponentsError" class="text-red-400" data-testid="arena-opponents-error">
          {{ t('arena.errors.OPPONENTS_FETCH_FAILED') }}
        </div>
        <div v-else-if="opponentsEmpty" class="text-slate-500 italic" data-testid="arena-opponents-empty">
          {{ t('arena.opponents.empty') }}
        </div>
        <ul v-else class="space-y-2" data-testid="arena-opponents-list">
          <li
            v-for="opp in opponents"
            :key="opp.characterId"
            class="rounded-lg border border-slate-700 bg-slate-900/40 p-3 flex items-center justify-between"
            :data-testid="`arena-opponent-${opp.characterId}`"
          >
            <div>
              <div class="font-medium text-slate-100">{{ opp.characterName }}</div>
              <div class="text-xs text-slate-400">
                {{ t('arena.opponents.rating', { r: opp.rating }) }}
                · {{ t('arena.opponents.realm', { realm: opp.realmKey, stage: opp.realmStage }) }}
                <span v-if="opp.sectName"> · {{ opp.sectName }}</span>
              </div>
            </div>
            <MButton
              :disabled="arena.challengeInFlight || arenaDisabled"
              :data-testid="`arena-challenge-${opp.characterId}`"
              @click="challenge(opp.characterId)"
            >
              {{ arena.challengeInFlight ? t('arena.challenge.inFlight') : t('arena.challenge.button') }}
            </MButton>
          </li>
        </ul>
      </div>

      <!-- Phase 14.1.C — Leaderboard -->
      <div class="mb-6">
        <div class="flex items-center justify-between mb-2">
          <h2 class="text-lg font-semibold text-slate-200">{{ t('arena.leaderboard.title') }}</h2>
          <span class="text-xs text-slate-500">{{ t('arena.leaderboard.totalCount', { n: leaderboardTotal }) }}</span>
        </div>
        <div
          v-if="showLeaderboardLoading"
          class="text-slate-400"
          data-testid="arena-leaderboard-loading"
        >
          {{ t('common.loading') }}
        </div>
        <div
          v-else-if="arena.leaderboardError"
          class="text-red-400"
          data-testid="arena-leaderboard-error"
        >
          {{ t('arena.errors.LEADERBOARD_FETCH_FAILED') }}
        </div>
        <div
          v-else-if="leaderboardEmpty"
          class="text-slate-500 italic"
          data-testid="arena-leaderboard-empty"
        >
          {{ t('arena.leaderboard.empty') }}
        </div>
        <table
          v-else
          class="w-full text-sm border-collapse"
          data-testid="arena-leaderboard-table"
        >
          <thead class="text-slate-400 text-xs">
            <tr>
              <th class="text-left py-1 pr-2">{{ t('arena.leaderboard.rank') }}</th>
              <th class="text-left py-1 pr-2">{{ t('arena.leaderboard.name') }}</th>
              <th class="text-left py-1 pr-2">{{ t('arena.leaderboard.tier') }}</th>
              <th class="text-right py-1 pr-2">{{ t('arena.leaderboard.rating') }}</th>
              <th class="text-right py-1 pr-2">{{ t('arena.leaderboard.wins') }}</th>
              <th class="text-right py-1">{{ t('arena.leaderboard.losses') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="e in leaderboardEntries"
              :key="e.characterId"
              class="border-t border-slate-800"
              :data-testid="`arena-leaderboard-row-${e.characterId}`"
            >
              <td class="py-1 pr-2 text-amber-300 font-semibold">{{ e.rank }}</td>
              <td class="py-1 pr-2 text-slate-100">
                {{ e.characterName }}
                <span v-if="e.sectName" class="text-xs text-slate-500"> · {{ e.sectName }}</span>
              </td>
              <td class="py-1 pr-2 text-indigo-300">{{ tierLabel(e.tier) }}</td>
              <td class="py-1 pr-2 text-right text-amber-200">{{ e.rating }}</td>
              <td class="py-1 pr-2 text-right text-emerald-400">{{ e.wins }}</td>
              <td class="py-1 text-right text-red-400">{{ e.losses }}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <!-- Phase 14.1.C — Reward preview -->
      <div class="mb-6">
        <h2 class="text-lg font-semibold text-slate-200 mb-2">{{ t('arena.rewardPreview.title') }}</h2>
        <div
          v-if="showRewardLoading"
          class="text-slate-400"
          data-testid="arena-rewards-loading"
        >
          {{ t('common.loading') }}
        </div>
        <div
          v-else-if="arena.rewardPreviewError"
          class="text-red-400"
          data-testid="arena-rewards-error"
        >
          {{ t('arena.errors.REWARDS_FETCH_FAILED') }}
        </div>
        <ul
          v-else
          class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-2"
          data-testid="arena-rewards-list"
        >
          <li
            v-for="row in rewardTiers"
            :key="row.tier"
            class="rounded-lg border border-slate-700 bg-slate-900/40 p-3"
            :data-testid="`arena-reward-${row.tier}`"
          >
            <div class="text-sm font-semibold text-indigo-300">{{ tierLabel(row.tier) }}</div>
            <div class="text-xs text-slate-400 mt-1">
              <span v-if="row.reward.linhThach > 0">
                {{ t('arena.rewardPreview.linhThach') }}: {{ row.reward.linhThach }}
              </span>
              <span v-if="row.reward.tienNgoc > 0" class="block">
                {{ t('arena.rewardPreview.tienNgoc') }}: {{ row.reward.tienNgoc }}
              </span>
              <span v-if="row.reward.exp > 0" class="block">
                {{ t('arena.rewardPreview.exp') }}: {{ row.reward.exp }}
              </span>
              <span v-if="row.reward.items.length > 0" class="block">
                {{ t('arena.rewardPreview.items') }}:
                <span v-for="it in row.reward.items" :key="it.itemKey" class="text-slate-300">
                  {{ it.itemKey }}×{{ it.qty }}<span class="text-slate-500">,</span>
                </span>
              </span>
              <span v-if="row.reward.linhThach === 0 && row.reward.tienNgoc === 0 && row.reward.exp === 0 && row.reward.items.length === 0">
                {{ t('arena.rewardPreview.noReward') }}
              </span>
            </div>
          </li>
        </ul>
      </div>

      <!-- History -->
      <div>
        <h2 class="text-lg font-semibold text-slate-200 mb-2">{{ t('arena.history.title') }}</h2>
        <div v-if="showHistoryLoading" class="text-slate-400" data-testid="arena-history-loading">
          {{ t('common.loading') }}
        </div>
        <div v-else-if="arena.historyError" class="text-red-400" data-testid="arena-history-error">
          {{ t('arena.errors.HISTORY_FETCH_FAILED') }}
        </div>
        <div v-else-if="historyEmpty" class="text-slate-500 italic" data-testid="arena-history-empty">
          {{ t('arena.history.empty') }}
        </div>
        <ul v-else class="space-y-1" data-testid="arena-history-list">
          <li
            v-for="m in history"
            :key="m.matchId"
            class="rounded border border-slate-800 bg-slate-900/30 px-3 py-2 text-sm flex justify-between"
          >
            <div>
              <span
                v-if="outcomeKind(m.outcome, m.attackerCharacterId) === 'win'"
                class="text-emerald-400"
              >{{ t('arena.result.win') }}</span>
              <span
                v-else-if="outcomeKind(m.outcome, m.attackerCharacterId) === 'lose'"
                class="text-red-400"
              >{{ t('arena.result.lose') }}</span>
              <span v-else class="text-slate-400">{{ t('arena.result.draw') }}</span>
              <span class="text-slate-500 mx-2">·</span>
              <span class="text-slate-200">
                {{
                  m.attackerCharacterId === profile?.characterId
                    ? m.defenderName
                    : m.attackerName
                }}
              </span>
            </div>
            <div class="text-xs text-slate-500 flex items-center gap-2">
              <span
                v-if="historyDeltaForMe(m) !== null"
                :class="{
                  'text-emerald-400': (historyDeltaForMe(m) ?? 0) > 0,
                  'text-red-400': (historyDeltaForMe(m) ?? 0) < 0,
                  'text-slate-400': (historyDeltaForMe(m) ?? 0) === 0,
                }"
                :data-testid="`arena-history-delta-${m.matchId}`"
              >
                {{ t('arena.season.ratingDelta') }}
                {{ (historyDeltaForMe(m) ?? 0) > 0 ? '+' : '' }}{{ historyDeltaForMe(m) }}
              </span>
              <span>{{ t('arena.history.rounds', { n: m.rounds }) }}</span>
            </div>
          </li>
        </ul>
      </div>
    </section>
  </AppShell>
</template>
