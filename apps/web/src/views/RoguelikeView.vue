<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { itemByKey, type RoguelikeChoiceDef } from '@xuantoi/shared';
import AppShell from '@/components/shell/AppShell.vue';
import { useRoguelikeStore } from '@/stores/roguelike';
import { useToastStore } from '@/stores/toast';
import type { RoguelikeClaimResult, RoguelikeRealmView } from '@/api/roguelike';

const store = useRoguelikeStore();
const toast = useToastStore();
const { locale, t } = useI18n();

const claimModal = ref<RoguelikeClaimResult | null>(null);

const loading = computed(() => store.loading);
const activeRun = computed(() => store.activeRun);
const realms = computed(() => store.realms);
const leaderboard = computed(() => store.leaderboard);
const submittingKey = computed(() => store.submittingKey);
const historyDesc = computed(() =>
  [...(activeRun.value?.floorHistory ?? [])].reverse().slice(0, 8),
);

function localName(obj: { nameVi?: string; nameEn?: string; name?: string }): string {
  return locale.value === 'en'
    ? obj.nameEn ?? obj.name ?? obj.nameVi ?? ''
    : obj.nameVi ?? obj.name ?? obj.nameEn ?? '';
}

function choiceName(choice: RoguelikeChoiceDef): string {
  return locale.value === 'en' ? choice.titleEn : choice.titleVi;
}

function choiceDesc(choice: RoguelikeChoiceDef): string {
  return locale.value === 'en' ? choice.descriptionEn : choice.descriptionVi;
}

function outcomeText(entry: { outcomeVi: string; outcomeEn: string }): string {
  return locale.value === 'en' ? entry.outcomeEn : entry.outcomeVi;
}

function itemName(itemKey: string): string {
  return itemByKey(itemKey)?.name ?? itemKey;
}

function requiredRealmText(realm: RoguelikeRealmView): string {
  return String(realm.realm.requiredRealmOrder);
}

function canStart(realm: RoguelikeRealmView): boolean {
  return (
    realm.unlocked &&
    realm.dailyUsed < realm.dailyLimit &&
    !store.hasActiveRun &&
    submittingKey.value === null
  );
}

function errorText(code: string | null): string {
  if (!code) return '';
  return t(`roguelike.errors.${code}`, t('roguelike.errors.UNKNOWN'));
}

async function loadAll(): Promise<void> {
  await Promise.all([store.load(), store.loadLeaderboard()]);
}

async function onStart(realm: RoguelikeRealmView): Promise<void> {
  try {
    await store.start(realm.realm.key);
    toast.push({ type: 'success', text: t('roguelike.startToast') });
  } catch (e) {
    toast.push({ type: 'error', text: errorText(errorCode(e)) });
  }
}

async function onChoose(choice: RoguelikeChoiceDef): Promise<void> {
  try {
    const next = await store.choose(choice.key);
    toast.push({
      type: next.status === 'ACTIVE' ? 'info' : 'success',
      text:
        next.status === 'ACTIVE'
          ? t('roguelike.choiceToast', { floor: next.currentFloor })
          : t(`roguelike.statusToast.${next.status}`),
    });
  } catch (e) {
    toast.push({ type: 'error', text: errorText(errorCode(e)) });
  }
}

async function onAbandon(): Promise<void> {
  try {
    await store.abandon();
    toast.push({ type: 'info', text: t('roguelike.abandonToast') });
  } catch (e) {
    toast.push({ type: 'error', text: errorText(errorCode(e)) });
  }
}

async function onClaim(): Promise<void> {
  try {
    const result = await store.claim();
    claimModal.value = result;
    toast.push({
      type: 'success',
      text: t('roguelike.claimToast', {
        linhThach: result.granted.linhThach,
        exp: result.granted.exp,
      }),
    });
  } catch (e) {
    toast.push({ type: 'error', text: errorText(errorCode(e)) });
  }
}

function errorCode(e: unknown): string {
  return (
    (e as { code?: string }).code ??
    (e as { error?: { code?: string } }).error?.code ??
    'UNKNOWN_ERROR'
  );
}

onMounted(() => {
  void loadAll();
});
</script>

<template>
  <AppShell>
    <main class="max-w-7xl mx-auto px-4 py-6 space-y-6">
      <header class="rounded-3xl border border-amber-300/30 bg-ink-800/70 p-5">
        <div class="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div>
            <p class="text-xs uppercase tracking-[0.3em] text-amber-300">
              {{ t('roguelike.kicker') }}
            </p>
            <h1 class="mt-2 text-3xl font-bold text-ink-50">
              {{ t('roguelike.title') }}
            </h1>
            <p class="mt-2 max-w-3xl text-sm text-ink-300">
              {{ t('roguelike.subtitle') }}
            </p>
          </div>
          <button
            type="button"
            class="rounded-xl border border-ink-300/30 px-4 py-2 text-sm hover:bg-ink-700"
            :disabled="loading"
            @click="loadAll()"
          >
            {{ t('common.refresh') }}
          </button>
        </div>
        <div class="mt-4 grid gap-3 md:grid-cols-3">
          <div class="rounded-2xl bg-ink-900/60 p-3">
            <div class="text-xs text-ink-300">{{ t('roguelike.realmCount') }}</div>
            <div class="text-2xl font-bold">{{ store.totalCount }}</div>
          </div>
          <div class="rounded-2xl bg-ink-900/60 p-3">
            <div class="text-xs text-ink-300">{{ t('roguelike.unlockedCount') }}</div>
            <div class="text-2xl font-bold">{{ store.unlockedCount }}</div>
          </div>
          <div class="rounded-2xl bg-ink-900/60 p-3">
            <div class="text-xs text-ink-300">{{ t('roguelike.activeStatus') }}</div>
            <div class="text-2xl font-bold">
              {{ activeRun ? t(`roguelike.status.${activeRun.status}`) : '—' }}
            </div>
          </div>
        </div>
      </header>

      <section
        v-if="store.lastError"
        class="rounded-2xl border border-red-400/40 bg-red-950/30 p-4 text-red-100"
      >
        {{ errorText(store.lastError) }}
      </section>

      <section v-if="activeRun" class="grid gap-4 lg:grid-cols-[1.25fr_0.75fr]">
        <div class="rounded-3xl border border-amber-300/30 bg-ink-800/70 p-5">
          <div class="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p class="text-xs uppercase tracking-[0.25em] text-amber-300">
                {{ t('roguelike.runCard') }}
              </p>
              <h2 class="mt-1 text-2xl font-bold">
                {{ t('roguelike.floor', { n: activeRun.currentFloor }) }}
              </h2>
              <p v-if="activeRun.currentFloorDef" class="mt-1 text-sm text-ink-300">
                {{ localName(activeRun.currentFloorDef) }}
                · {{ t(`roguelike.floorType.${activeRun.currentFloorDef.floorType}`) }}
              </p>
            </div>
            <span class="rounded-full bg-amber-300/15 px-3 py-1 text-sm text-amber-100">
              {{ t(`roguelike.status.${activeRun.status}`) }}
            </span>
          </div>

          <div class="mt-5 grid gap-3 md:grid-cols-4">
            <div class="rounded-2xl bg-ink-900/60 p-3">
              <div class="text-xs text-ink-300">HP</div>
              <div class="mt-1 text-xl font-bold">{{ activeRun.hp }} / {{ activeRun.hpMax }}</div>
            </div>
            <div class="rounded-2xl bg-ink-900/60 p-3">
              <div class="text-xs text-ink-300">{{ t('roguelike.resource') }}</div>
              <div class="mt-1 text-xl font-bold">{{ activeRun.resource }}</div>
            </div>
            <div class="rounded-2xl bg-ink-900/60 p-3">
              <div class="text-xs text-ink-300">{{ t('roguelike.score') }}</div>
              <div class="mt-1 text-xl font-bold">{{ activeRun.score }}</div>
            </div>
            <div class="rounded-2xl bg-ink-900/60 p-3">
              <div class="text-xs text-ink-300">{{ t('roguelike.rewardMul') }}</div>
              <div class="mt-1 text-xl font-bold">×{{ activeRun.rewardMultiplier.toFixed(2) }}</div>
            </div>
          </div>

          <div class="mt-5">
            <h3 class="text-sm font-bold text-ink-100">{{ t('roguelike.activeBuffs') }}</h3>
            <div v-if="activeRun.activeBuffs.length" class="mt-2 flex flex-wrap gap-2">
              <span
                v-for="buff in activeRun.activeBuffs"
                :key="buff.key + buff.remainingFloors"
                class="rounded-full bg-emerald-400/10 px-3 py-1 text-xs text-emerald-100"
              >
                {{ localName(buff) }} {{ buff.valuePct > 0 ? '+' : '' }}{{ buff.valuePct }}%
                · {{ t('roguelike.buffTurns', { n: buff.remainingFloors }) }}
              </span>
            </div>
            <p v-else class="mt-2 text-sm text-ink-400">{{ t('roguelike.noBuffs') }}</p>
          </div>

          <div v-if="activeRun.status === 'ACTIVE'" class="mt-5">
            <h3 class="text-sm font-bold text-ink-100">{{ t('roguelike.choices') }}</h3>
            <div class="mt-3 grid gap-3 md:grid-cols-3">
              <button
                v-for="choice in activeRun.choices"
                :key="choice.key"
                type="button"
                class="rounded-2xl border border-ink-300/30 bg-ink-900/60 p-4 text-left hover:border-amber-300 disabled:opacity-60"
                :disabled="submittingKey !== null"
                @click="onChoose(choice)"
              >
                <div class="font-bold text-amber-100">{{ choiceName(choice) }}</div>
                <p class="mt-2 text-sm text-ink-300">{{ choiceDesc(choice) }}</p>
                <div class="mt-3 text-xs text-ink-400">
                  HP {{ choice.hpDeltaPct }} · {{ t('roguelike.score') }} +{{ choice.scoreDelta }}
                  · ×{{ choice.rewardMultiplier }}
                </div>
              </button>
            </div>
            <button
              type="button"
              class="mt-4 rounded-xl border border-red-300/40 px-4 py-2 text-sm text-red-100 hover:bg-red-950/40"
              :disabled="submittingKey !== null"
              @click="onAbandon()"
            >
              {{ t('roguelike.abandon') }}
            </button>
          </div>

          <div v-else class="mt-5 flex flex-wrap gap-3">
            <button
              v-if="store.isRunClaimable"
              type="button"
              class="rounded-xl bg-amber-300 px-4 py-2 text-sm font-bold text-ink-900 disabled:opacity-60"
              :disabled="submittingKey !== null"
              @click="onClaim()"
            >
              {{ t('roguelike.claim') }}
            </button>
            <button
              type="button"
              class="rounded-xl border border-ink-300/30 px-4 py-2 text-sm hover:bg-ink-700"
              @click="loadAll()"
            >
              {{ t('common.refresh') }}
            </button>
          </div>
        </div>

        <aside class="space-y-4">
          <div class="rounded-3xl border border-ink-300/20 bg-ink-800/70 p-5">
            <h3 class="font-bold">{{ t('roguelike.rewardPreview') }}</h3>
            <div class="mt-3 space-y-2 text-sm">
              <div class="flex justify-between">
                <span>Linh Thạch</span>
                <b>{{ activeRun.rewardPreview.linhThach }}</b>
              </div>
              <div class="flex justify-between">
                <span>EXP</span>
                <b>{{ activeRun.rewardPreview.exp }}</b>
              </div>
              <div class="flex justify-between">
                <span>{{ t('roguelike.milestones') }}</span>
                <b>{{ activeRun.rewardPreview.milestoneFloors.join(', ') || '—' }}</b>
              </div>
              <div v-if="activeRun.rewardPreview.items.length" class="pt-2">
                <div
                  v-for="item in activeRun.rewardPreview.items"
                  :key="item.itemKey"
                  class="flex justify-between"
                >
                  <span>{{ itemName(item.itemKey) }}</span>
                  <b>×{{ item.qty }}</b>
                </div>
              </div>
            </div>
          </div>

          <div class="rounded-3xl border border-ink-300/20 bg-ink-800/70 p-5">
            <h3 class="font-bold">{{ t('roguelike.log') }}</h3>
            <ol v-if="historyDesc.length" class="mt-3 space-y-3">
              <li
                v-for="entry in historyDesc"
                :key="entry.floorNumber"
                class="rounded-2xl bg-ink-900/60 p-3 text-sm"
              >
                <div class="font-bold">
                  {{ t('roguelike.floor', { n: entry.floorNumber }) }}
                  · {{ t(`roguelike.floorType.${entry.floorType}`) }}
                </div>
                <p class="mt-1 text-ink-300">{{ outcomeText(entry) }}</p>
              </li>
            </ol>
            <p v-else class="mt-3 text-sm text-ink-400">{{ t('roguelike.emptyLog') }}</p>
          </div>
        </aside>
      </section>

      <section class="grid gap-4 lg:grid-cols-[1fr_0.8fr]">
        <div class="rounded-3xl border border-ink-300/20 bg-ink-800/70 p-5">
          <h2 class="text-xl font-bold">{{ t('roguelike.realmList') }}</h2>
          <div v-if="loading && !realms.length" class="mt-4 text-sm text-ink-300">
            {{ t('common.loadingData') }}
          </div>
          <div v-else-if="!realms.length" class="mt-4 text-sm text-ink-300">
            {{ t('roguelike.emptyRealms') }}
          </div>
          <div v-else class="mt-4 grid gap-3 md:grid-cols-2">
            <article
              v-for="realm in realms"
              :key="realm.realm.key"
              class="rounded-2xl border border-ink-300/20 bg-ink-900/60 p-4"
            >
              <div class="flex items-start justify-between gap-3">
                <div>
                  <h3 class="font-bold text-ink-50">{{ localName(realm.realm) }}</h3>
                  <p class="mt-1 text-sm text-ink-300">
                    {{ t('roguelike.realmReq', { realm: requiredRealmText(realm) }) }}
                  </p>
                </div>
                <span class="rounded-full px-2 py-1 text-xs" :class="realm.unlocked ? 'bg-emerald-400/15 text-emerald-100' : 'bg-red-400/15 text-red-100'">
                  {{ realm.unlocked ? t('roguelike.unlocked') : t('roguelike.locked') }}
                </span>
              </div>
              <div class="mt-3 grid grid-cols-2 gap-2 text-xs text-ink-300">
                <div>{{ t('roguelike.daily') }}: {{ realm.dailyUsed }} / {{ realm.dailyLimit }}</div>
                <div>{{ t('roguelike.weekly') }}: {{ realm.weeklyClaimsUsed }} / {{ realm.weeklyClaimLimit }}</div>
                <div>HP: {{ realm.realm.baseHp }}</div>
                <div>{{ t('roguelike.rewardMul') }}: ×{{ realm.realm.rewardMultiplier }}</div>
              </div>
              <button
                type="button"
                class="mt-4 w-full rounded-xl bg-amber-300 px-4 py-2 text-sm font-bold text-ink-900 disabled:cursor-not-allowed disabled:opacity-50"
                :disabled="!canStart(realm)"
                @click="onStart(realm)"
              >
                {{ t('roguelike.start') }}
              </button>
            </article>
          </div>
        </div>

        <div class="rounded-3xl border border-ink-300/20 bg-ink-800/70 p-5">
          <h2 class="text-xl font-bold">{{ t('roguelike.leaderboard') }}</h2>
          <div v-if="store.leaderboardLoading" class="mt-4 text-sm text-ink-300">
            {{ t('common.loadingData') }}
          </div>
          <ol v-else-if="leaderboard.length" class="mt-4 space-y-2">
            <li
              v-for="(entry, idx) in leaderboard"
              :key="entry.characterId"
              class="flex items-center justify-between rounded-2xl bg-ink-900/60 px-4 py-3 text-sm"
            >
              <span>#{{ idx + 1 }} · {{ entry.characterName }}</span>
              <b>{{ t('roguelike.floorScore', { floor: entry.bestFloor, score: entry.bestScore }) }}</b>
            </li>
          </ol>
          <p v-else class="mt-4 text-sm text-ink-400">{{ t('roguelike.emptyLeaderboard') }}</p>
        </div>
      </section>

      <div
        v-if="claimModal"
        class="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
        role="dialog"
        aria-modal="true"
      >
        <div class="w-full max-w-lg rounded-3xl border border-amber-300/30 bg-ink-800 p-6">
          <h2 class="text-xl font-bold text-amber-100">{{ t('roguelike.claimedTitle') }}</h2>
          <div class="mt-4 space-y-2 text-sm">
            <div class="flex justify-between">
              <span>Linh Thạch</span>
              <b>{{ claimModal.granted.linhThach }}</b>
            </div>
            <div class="flex justify-between">
              <span>EXP</span>
              <b>{{ claimModal.granted.exp }}</b>
            </div>
            <div
              v-for="item in claimModal.granted.items"
              :key="item.itemKey"
              class="flex justify-between"
            >
              <span>{{ itemName(item.itemKey) }}</span>
              <b>×{{ item.qty }}</b>
            </div>
          </div>
          <button
            type="button"
            class="mt-6 w-full rounded-xl bg-amber-300 px-4 py-2 font-bold text-ink-900"
            @click="claimModal = null"
          >
            {{ t('common.close') }}
          </button>
        </div>
      </div>
    </main>
  </AppShell>
</template>
