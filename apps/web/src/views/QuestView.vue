<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRouter } from 'vue-router';
import { useAuthStore } from '@/stores/auth';
import { useGameStore } from '@/stores/game';
import { useQuestStore } from '@/stores/quest';
import { useToastStore } from '@/stores/toast';
import AppShell from '@/components/shell/AppShell.vue';
import type { QuestKind, QuestProgressView } from '@/api/quest';

/**
 * Phase 12 Story Runtime MVP (PR-5) — Quest list view.
 *
 * Server-authoritative: list quest visible (server lazy-create AVAILABLE
 * row theo realm gate + prereq), accept (CAS guard), claim (atomic ledger).
 * UI chỉ render trạng thái + dispatch action; KHÔNG tự cộng reward.
 *
 * UI MODULE RULE — list + filter (kind) + count + loading/empty/error +
 * accept/claim button gated by status + i18n vi/en. Pagination chưa cần
 * (max 25 quest catalog hiện tại) — sẽ thêm khi catalog mở rộng.
 */

const auth = useAuthStore();
const game = useGameStore();
const questStore = useQuestStore();
const toast = useToastStore();
const router = useRouter();
const { t } = useI18n();

const loading = computed(() => questStore.loading);
const loaded = computed(() => questStore.loaded);
const lastError = computed(() => questStore.lastError);
const kindFilter = computed(() => questStore.kindFilter);
const filteredQuests = computed(() => questStore.filteredQuests);
const totalCount = computed(() => questStore.totalCount);

const KINDS: QuestKind[] = ['main', 'realm', 'sect', 'npc', 'grind'];

function setFilter(kind: QuestKind | null): void {
  questStore.setKindFilter(kind);
}

/** Submitting state để disable button cho quest đang accept/claim. */
const submittingKey = computed(() => questStore.submittingKey);

function isAcceptable(q: QuestProgressView): boolean {
  return q.status === 'AVAILABLE';
}

function isClaimable(q: QuestProgressView): boolean {
  return q.status === 'COMPLETED';
}

function isAccepted(q: QuestProgressView): boolean {
  return q.status === 'ACCEPTED';
}

function isClaimed(q: QuestProgressView): boolean {
  return q.status === 'CLAIMED';
}

function isLocked(q: QuestProgressView): boolean {
  return q.status === 'LOCKED';
}

async function onAccept(q: QuestProgressView): Promise<void> {
  try {
    await questStore.accept(q.key);
    toast.push({
      type: 'success',
      text: t('quest.acceptOk', { quest: q.name }),
    });
  } catch (e) {
    const code =
      (e as { code?: string }).code ??
      (e as { error?: { code?: string } }).error?.code ??
      'UNKNOWN_ERROR';
    toast.push({
      type: 'error',
      text: t(`quest.errors.${code}`, t('quest.errors.UNKNOWN')),
    });
  }
}

async function onClaim(q: QuestProgressView): Promise<void> {
  try {
    const result = await questStore.claim(q.key);
    toast.push({
      type: 'success',
      text: t('quest.claimOk', {
        quest: q.name,
        linhThach: result.granted.linhThach,
        exp: result.granted.exp,
      }),
    });
  } catch (e) {
    const code =
      (e as { code?: string }).code ??
      (e as { error?: { code?: string } }).error?.code ??
      'UNKNOWN_ERROR';
    toast.push({
      type: 'error',
      text: t(`quest.errors.${code}`, t('quest.errors.UNKNOWN')),
    });
  }
}

/** Toggle expand details cho 1 quest (steps + rewards). */
const expandedKey = ref<string | null>(null);
function toggleExpand(key: string): void {
  expandedKey.value = expandedKey.value === key ? null : key;
}

onMounted(async () => {
  await auth.hydrate();
  if (!auth.isAuthenticated) {
    router.replace('/auth');
    return;
  }
  await game.fetchState().catch(() => null);
  if (!game.character) {
    router.replace('/onboarding');
    return;
  }
  await questStore.load();
});
</script>

<template>
  <AppShell>
    <div class="max-w-4xl mx-auto space-y-4" data-testid="quest-view">
      <header class="flex items-baseline justify-between gap-3">
        <div>
          <h1 class="text-2xl tracking-widest font-bold">
            {{ t('quest.title') }}
          </h1>
          <p class="text-sm text-ink-300">{{ t('quest.subtitle') }}</p>
        </div>
        <div class="text-right text-xs text-ink-300">
          <div data-testid="quest-total-count">
            {{ t('quest.totalCount', { n: totalCount }) }}
          </div>
        </div>
      </header>

      <nav
        class="flex flex-wrap gap-2 text-sm"
        data-testid="quest-filter-bar"
      >
        <button
          type="button"
          class="px-3 py-1.5 rounded border transition"
          :class="
            kindFilter === null
              ? 'border-amber-400/60 bg-amber-700/40 text-amber-100'
              : 'border-ink-300/30 bg-ink-700/30 text-ink-200 hover:bg-ink-700/50'
          "
          data-testid="quest-filter-all"
          @click="setFilter(null)"
        >
          {{ t('quest.filter.all') }}
        </button>
        <button
          v-for="k in KINDS"
          :key="k"
          type="button"
          class="px-3 py-1.5 rounded border transition"
          :class="
            kindFilter === k
              ? 'border-amber-400/60 bg-amber-700/40 text-amber-100'
              : 'border-ink-300/30 bg-ink-700/30 text-ink-200 hover:bg-ink-700/50'
          "
          :data-testid="`quest-filter-${k}`"
          @click="setFilter(k)"
        >
          {{ t(`quest.kind.${k}`) }}
        </button>
      </nav>

      <div
        v-if="loading && !loaded"
        class="text-ink-300 text-sm"
        data-testid="quest-loading"
      >
        {{ t('common.loadingData') }}
      </div>

      <div
        v-else-if="lastError"
        class="bg-rose-900/30 border border-rose-400/30 rounded p-4 text-sm text-rose-100"
        data-testid="quest-error"
      >
        {{ t(`quest.errors.${lastError}`, t('quest.errors.UNKNOWN')) }}
      </div>

      <div
        v-else-if="loaded && filteredQuests.length === 0"
        class="bg-ink-700/30 border border-ink-300/20 rounded p-6 text-center text-ink-300"
        data-testid="quest-empty"
      >
        {{
          kindFilter
            ? t('quest.emptyFiltered', { kind: t(`quest.kind.${kindFilter}`) })
            : t('quest.empty')
        }}
      </div>

      <ul
        v-else
        class="space-y-3"
        data-testid="quest-list"
      >
        <li
          v-for="q in filteredQuests"
          :key="q.key"
          class="bg-ink-700/30 border border-ink-300/20 rounded p-4 space-y-2"
          :data-testid="`quest-row-${q.key}`"
        >
          <header class="flex items-baseline justify-between gap-2 flex-wrap">
            <div class="flex items-baseline gap-2 flex-wrap">
              <span
                class="text-[10px] uppercase tracking-widest px-1.5 py-0.5 rounded border border-amber-400/40 text-amber-200"
              >
                {{ t(`quest.kind.${q.kind}`) }}
              </span>
              <h3 class="font-bold text-amber-100">{{ q.name }}</h3>
            </div>
            <span
              class="text-xs px-2 py-0.5 rounded"
              :class="{
                'bg-slate-700/60 text-slate-200': isLocked(q),
                'bg-sky-700/40 text-sky-100': q.status === 'AVAILABLE',
                'bg-amber-700/40 text-amber-100': isAccepted(q),
                'bg-emerald-700/40 text-emerald-100': isClaimable(q),
                'bg-ink-600/40 text-ink-200': isClaimed(q),
              }"
              :data-testid="`quest-status-${q.key}`"
            >
              {{ t(`quest.status.${q.status}`) }}
            </span>
          </header>

          <p class="text-xs text-ink-300 leading-relaxed">{{ q.description }}</p>

          <div class="flex items-center gap-3 flex-wrap">
            <button
              type="button"
              class="text-[11px] text-ink-300 underline hover:text-ink-100"
              :data-testid="`quest-toggle-${q.key}`"
              @click="toggleExpand(q.key)"
            >
              {{
                expandedKey === q.key
                  ? t('quest.collapse')
                  : t('quest.expand')
              }}
            </button>

            <button
              v-if="isAcceptable(q)"
              type="button"
              class="ml-auto px-3 py-1.5 rounded border border-sky-400/50 bg-sky-700/40 text-sky-100 hover:bg-sky-700/60 transition text-sm disabled:opacity-50 disabled:cursor-not-allowed"
              :disabled="submittingKey !== null"
              :data-testid="`quest-accept-${q.key}`"
              @click="onAccept(q)"
            >
              {{ t('quest.accept') }}
            </button>

            <button
              v-else-if="isClaimable(q)"
              type="button"
              class="ml-auto px-3 py-1.5 rounded border border-emerald-400/50 bg-emerald-700/40 text-emerald-100 hover:bg-emerald-700/60 transition text-sm disabled:opacity-50 disabled:cursor-not-allowed"
              :disabled="submittingKey !== null"
              :data-testid="`quest-claim-${q.key}`"
              @click="onClaim(q)"
            >
              {{ t('quest.claim') }}
            </button>

            <span
              v-else-if="isAccepted(q)"
              class="ml-auto text-xs text-amber-200 italic"
              :data-testid="`quest-accepted-hint-${q.key}`"
            >
              {{ t('quest.acceptedHint') }}
            </span>

            <span
              v-else-if="isClaimed(q)"
              class="ml-auto text-xs text-ink-300 italic"
              :data-testid="`quest-claimed-hint-${q.key}`"
            >
              {{ t('quest.claimedHint') }}
            </span>

            <span
              v-else-if="isLocked(q)"
              class="ml-auto text-xs text-slate-300 italic"
              :data-testid="`quest-locked-hint-${q.key}`"
            >
              {{ t('quest.lockedHint') }}
            </span>
          </div>

          <div
            v-if="expandedKey === q.key"
            class="border-t border-ink-300/20 pt-2 space-y-2 text-xs"
            :data-testid="`quest-details-${q.key}`"
          >
            <div>
              <h4 class="font-semibold text-ink-100 mb-1">
                {{ t('quest.steps') }}
              </h4>
              <ul class="space-y-1 pl-3">
                <li
                  v-for="step in q.steps"
                  :key="step.id"
                  class="text-ink-300"
                >
                  <span class="text-[10px] uppercase mr-2">
                    {{ t(`quest.stepKind.${step.kind}`) }}
                  </span>
                  <span :class="step.done ? 'line-through text-ink-400' : ''">
                    {{ step.description }}
                  </span>
                  <span class="ml-2 text-amber-200">
                    {{ step.currentCount }}/{{ step.count }}
                  </span>
                </li>
              </ul>
            </div>

            <div>
              <h4 class="font-semibold text-ink-100 mb-1">
                {{ t('quest.rewards') }}
              </h4>
              <ul class="flex flex-wrap gap-2 text-ink-300">
                <li v-if="q.rewards.linhThach">
                  {{ t('quest.reward.linhThach', { n: q.rewards.linhThach }) }}
                </li>
                <li v-if="q.rewards.tienNgoc">
                  {{ t('quest.reward.tienNgoc', { n: q.rewards.tienNgoc }) }}
                </li>
                <li v-if="q.rewards.exp">
                  {{ t('quest.reward.exp', { n: q.rewards.exp }) }}
                </li>
                <li v-if="q.rewards.congHien">
                  {{ t('quest.reward.congHien', { n: q.rewards.congHien }) }}
                </li>
                <li
                  v-for="it in q.rewards.items ?? []"
                  :key="it.itemKey"
                  class="text-amber-100"
                >
                  {{ t('quest.reward.item', { itemKey: it.itemKey, qty: it.qty }) }}
                </li>
              </ul>
            </div>
          </div>
        </li>
      </ul>
    </div>
  </AppShell>
</template>
