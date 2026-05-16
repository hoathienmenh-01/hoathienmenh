<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRouter } from 'vue-router';
import {
  findDungeonsForQuestPlaceholder,
  NPC_RELATIONSHIP_QUEST_CHAINS,
} from '@xuantoi/shared';
import { useAuthStore } from '@/stores/auth';
import { useGameStore } from '@/stores/game';
import { useQuestStore } from '@/stores/quest';
import { useStoryDungeonStore } from '@/stores/storyDungeon';
import { useToastStore } from '@/stores/toast';
import AppShell from '@/components/shell/AppShell.vue';
import XTPageEyebrow from '@/components/xianxia/XTPageEyebrow.vue';
import XTLuxHero from '@/components/xianxia/XTLuxHero.vue';
import XTListStagger from '@/components/xianxia/XTListStagger.vue';
import type { QuestKind, QuestProgressView } from '@/api/quest';
import type { StoryDungeonView } from '@/api/storyDungeon';

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
const storyDungeonStore = useStoryDungeonStore();
const toast = useToastStore();
const router = useRouter();
const { t } = useI18n();

const loading = computed(() => questStore.loading);
const loaded = computed(() => questStore.loaded);
const lastError = computed(() => questStore.lastError);
const kindFilter = computed(() => questStore.kindFilter);
const filteredQuests = computed(() => questStore.filteredQuests);
const totalCount = computed(() => questStore.totalCount);
const completedCount = computed(
  () => questStore.quests.filter((q) => q.status === 'CLAIMED').length,
);

const KINDS: QuestKind[] = ['main', 'side', 'branch', 'hidden', 'realm', 'sect', 'npc', 'grind'];

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

/**
 * Phase 12.10.D — Returns the relationship chain a quest belongs to (catalog
 * lookup), or null if not part of any chain. Used để render badge "Duyên
 * phận" trong list.
 */
const QUEST_TO_CHAIN: Record<string, { chainKey: string; npcKey: string }> = (() => {
  const map: Record<string, { chainKey: string; npcKey: string }> = {};
  for (const c of NPC_RELATIONSHIP_QUEST_CHAINS) {
    for (const qk of c.questKeys) {
      map[qk] = { chainKey: c.chainKey, npcKey: c.npcKey };
    }
  }
  return map;
})();

function relationshipChainFor(
  q: QuestProgressView,
): { chainKey: string; npcKey: string } | null {
  return QUEST_TO_CHAIN[q.key] ?? null;
}

/**
 * Phase 12 Story discoverability hint — cho `kill+monster` step, resolve
 * dungeon nào player có thể gặp `step.targetId` qua DungeonRun. Dùng shared
 * helper `findDungeonsForQuestPlaceholder` (resolve cả direct key match lẫn
 * `MonsterDef.questTargetIds` alias). Trả về string formatted "name1, name2"
 * hoặc `null` nếu không có dungeon nào (orphan placeholder hoặc step không
 * phải kill+monster).
 */
function dungeonHintFor(step: QuestProgressView['steps'][number]): string | null {
  if (step.kind !== 'kill' || step.targetType !== 'monster') return null;
  const dungeons = findDungeonsForQuestPlaceholder(step.targetId);
  if (dungeons.length === 0) return null;
  return dungeons.map((d) => d.name).join(', ');
}

/**
 * Phase 12.8.C — Story Dungeon discoverability hint cho QuestView.
 * Trả về story dungeon entry nếu quest này required-by 1 story dungeon
 * (catalog `requiredQuestKey`). UI render CTA "Vào bí cảnh cốt truyện"
 * khi quest đang ACCEPTED + dungeon `available` (chưa locked / cleared).
 *
 * `cleared` template vẫn render CTA để player thấy hint nhưng button
 * disabled — story dungeon đã clear không thể start lại (oneTime).
 */
function storyDungeonForQuest(q: QuestProgressView): StoryDungeonView | null {
  return storyDungeonStore.findDungeonForQuest(q.key) ?? null;
}

function shouldShowStoryDungeonCta(q: QuestProgressView): boolean {
  // Hiển thị CTA cho ACCEPTED + AVAILABLE (player có context vào dungeon).
  // Ẩn cho LOCKED / CLAIMED — player đã đi qua hoặc chưa unlock quest.
  if (q.status !== 'ACCEPTED' && q.status !== 'AVAILABLE') return false;
  const sd = storyDungeonForQuest(q);
  if (!sd) return false;
  // Quest gate đã pass nhưng character chưa đủ realm → server returns
  // status='locked'. Vẫn show CTA để player biết tồn tại bí cảnh — page
  // story-dungeons sẽ render lý do locked.
  return true;
}

function gotoStoryDungeons(): void {
  router.push('/story-dungeons');
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
  // Load story dungeon catalog cho CTA "Vào bí cảnh cốt truyện". Fail-soft —
  // nếu fetch fail, CTA chỉ không hiển thị, không crash list quest.
  await storyDungeonStore.load().catch(() => null);
});
</script>

<template>
  <AppShell>
    <div class="max-w-4xl mx-auto space-y-4" data-testid="quest-view">
      <XTLuxHero
        :eyebrow="t('luxHero.quest.eyebrow')"
        :label="t('luxHero.quest.label')"
        :title="t('quest.title')"
        :subtitle="t('quest.subtitle')"
        tone="jade"
        watermark-letter="T"
        :breadcrumb="t('luxHero.quest.breadcrumb')"
        test-id="quest-view-hero"
      >
        <XTPageEyebrow caps="THIÊN MỆNH NHIỆM VỤ" label="Thiên Mệnh Nhiệm Vụ" class="sr-only" />
        <header class="flex items-baseline justify-end gap-3">
          <div class="text-right text-xs text-ink-300">
            <div data-testid="quest-total-count">
              {{ t('quest.totalCount', { n: totalCount }) }}
            </div>
            <div data-testid="quest-completed-count">
              {{ t('quest.completedCount', { n: completedCount }) }}
            </div>
          </div>
        </header>
      </XTLuxHero>

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

      <XTListStagger
        v-else
        tag="ul"
        class="space-y-3"
        data-testid="quest-list"
      >
        <li
          v-for="(q, idx) in filteredQuests"
          :key="q.key"
          class="bg-ink-700/30 border border-ink-300/20 rounded p-4 space-y-2 xt-hover-lift"
          :data-testid="`quest-row-${q.key}`"
          :style="{ '--xt-list-index': idx }"
        >
          <header class="flex items-baseline justify-between gap-2 flex-wrap">
            <div class="flex items-baseline gap-2 flex-wrap">
              <span
                class="text-[10px] uppercase tracking-widest px-1.5 py-0.5 rounded border border-amber-400/40 text-amber-200"
              >
                {{ t(`quest.kind.${q.kind}`) }}
              </span>
              <span
                v-if="q.chapterKey"
                class="text-[10px] uppercase tracking-widest px-1.5 py-0.5 rounded border border-violet-400/40 text-violet-200"
                :data-testid="`quest-chapter-tag-${q.key}`"
              >
                {{ t('quest.chapterTag', { chapter: q.chapterKey }) }}
              </span>
              <span
                v-if="relationshipChainFor(q)"
                class="text-[10px] uppercase tracking-widest px-1.5 py-0.5 rounded border border-rose-400/40 text-rose-200"
                :data-testid="`quest-chain-tag-${q.key}`"
                :title="relationshipChainFor(q)!.chainKey"
              >
                {{ t('npcAffinity.chains.tag') }}
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
          <div class="grid gap-1 sm:grid-cols-2 text-[11px] text-ink-400">
            <div v-if="q.objective" :data-testid="`quest-objective-${q.key}`">
              <span class="text-ink-300">{{ t('quest.objective') }}:</span> {{ q.objective }}
            </div>
            <div v-if="q.requirement" :data-testid="`quest-requirement-${q.key}`">
              <span class="text-ink-300">{{ t('quest.requirement') }}:</span> {{ q.requirement }}
            </div>
            <div v-if="q.giverNpcKey" :data-testid="`quest-npc-${q.key}`">
              <span class="text-ink-300">{{ t('quest.npc') }}:</span> {{ q.giverNpcKey }}
            </div>
            <div v-if="q.status === 'LOCKED'" :data-testid="`quest-lock-reason-${q.key}`">
              <span class="text-ink-300">{{ t('quest.lockReason') }}:</span> {{ t('quest.lockedHint') }}
            </div>
          </div>

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
              v-if="shouldShowStoryDungeonCta(q)"
              type="button"
              class="text-[11px] px-2 py-0.5 rounded border border-violet-400/50 bg-violet-700/30 text-violet-100 hover:bg-violet-700/50 transition"
              :data-testid="`quest-story-dungeon-cta-${q.key}`"
              @click="gotoStoryDungeons()"
            >
              📜 {{ t('quest.storyDungeonCta') }}
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
                  <span
                    v-if="dungeonHintFor(step)"
                    class="block ml-6 text-[11px] text-emerald-300/80"
                    :data-testid="`quest-step-hint-${q.key}-${step.id}`"
                  >
                    📍 {{ t('quest.stepHint.foundIn', { dungeons: dungeonHintFor(step) }) }}
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
      </XTListStagger>
    </div>
  </AppShell>
</template>
