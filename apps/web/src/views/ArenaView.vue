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
import AppShell from '@/components/shell/AppShell.vue';
import MButton from '@/components/ui/MButton.vue';

const arena = useArenaStore();
const toast = useToastStore();
const { t } = useI18n();

onMounted(() => {
  void arena.fetchProfile();
  void arena.fetchOpponents();
  void arena.fetchHistory();
});

const profile = computed(() => arena.profile);
const opponents = computed(() => arena.opponents ?? []);
const history = computed(() => arena.history ?? []);
const lastResult = computed(() => arena.lastResult);

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
              :disabled="arena.challengeInFlight"
              :data-testid="`arena-challenge-${opp.characterId}`"
              @click="challenge(opp.characterId)"
            >
              {{ arena.challengeInFlight ? t('arena.challenge.inFlight') : t('arena.challenge.button') }}
            </MButton>
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
            <div class="text-xs text-slate-500">
              {{ t('arena.history.rounds', { n: m.rounds }) }}
            </div>
          </li>
        </ul>
      </div>
    </section>
  </AppShell>
</template>
