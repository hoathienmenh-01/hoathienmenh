<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRouter } from 'vue-router';
import { useAuthStore } from '@/stores/auth';
import { useGameStore } from '@/stores/game';
import { useStoryV2Store } from '@/stores/storyV2';
import { useToastStore } from '@/stores/toast';
import AppShell from '@/components/shell/AppShell.vue';
import XTHeroEyebrow from '@/components/xianxia/XTHeroEyebrow.vue';
import type {
  Phase33ChapterView,
  Phase33QuestView,
} from '@/api/storyV2';

/**
 * Phase 33.2 — Story V2 View (Tu Tiên Lộ Quyển II–IV).
 *
 * Server-authoritative wire 7 endpoint của `Phase33StoryModule`:
 *   - `GET /story/v2/chapters` → list visible chapter (realm gate).
 *   - `GET /story/v2/chapters/:chap/quests` → quest list per chapter.
 *   - `GET /story/v2/quests/:quest/dialogues` → dialogue cho quest.
 *   - `POST /story/v2/quests/{accept,progress,complete,claim}` → mutation.
 *
 * Layout:
 *  - Header: title + counters (total/in-progress/completed).
 *  - Chapter grid (default view): cards per chapter với progress bar.
 *  - Chapter detail (when selected): quest list (main/side/branch/hidden/
 *    daily/weekly tabs) + dialogue panel per quest.
 *  - Quest card: status badge + steps progress + accept/complete/claim CTA.
 *
 * Lite UI — đủ render 19 chương / 722 quest catalog; FE KHÔNG cộng reward.
 */

const auth = useAuthStore();
const game = useGameStore();
const store = useStoryV2Store();
const toast = useToastStore();
const router = useRouter();
const { t, locale } = useI18n();

const loading = computed(() => store.loading);
const loaded = computed(() => store.loaded);
const lastError = computed(() => store.lastError);
const chapters = computed(() => store.chapters);
const selectedChapKey = computed(() => store.selectedChapKey);
const selectedChapter = computed(() => store.selectedChapter);
const selectedChapterQuests = computed(() => store.selectedChapterQuests);
const submittingKey = computed(() => store.submittingKey);

type QuestKindTab =
  | 'all'
  | 'main'
  | 'side'
  | 'branch'
  | 'hidden'
  | 'daily'
  | 'weekly';
const TABS: QuestKindTab[] = [
  'all',
  'main',
  'side',
  'branch',
  'hidden',
  'daily',
  'weekly',
];
const questTab = ref<QuestKindTab>('main');

const tabFilteredQuests = computed<Phase33QuestView[]>(() => {
  if (questTab.value === 'all') return selectedChapterQuests.value;
  return selectedChapterQuests.value.filter((q) => q.kind === questTab.value);
});

const totalChapterCount = computed(() => chapters.value.length);
const inProgressChapterCount = computed(
  () => chapters.value.filter((c) => c.status === 'IN_PROGRESS').length,
);
const completedChapterCount = computed(
  () => chapters.value.filter((c) => c.status === 'COMPLETED').length,
);

function selectChapter(chap: Phase33ChapterView): void {
  store.selectChapter(chap.chapKey);
  void store.loadQuests(chap.chapKey);
}

function backToChapterList(): void {
  store.selectChapter(null);
}

function chapterTitle(chap: Phase33ChapterView): string {
  return locale.value === 'en' ? chap.titleEn : chap.titleVi;
}

function chapterTheme(chap: Phase33ChapterView): string {
  return locale.value === 'en' ? chap.themeEn : chap.themeVi;
}

function chapterProgressPct(chap: Phase33ChapterView): number {
  if (chap.mainQuestsTotal === 0) return 0;
  return Math.round(
    (chap.mainQuestsCompletedCount / chap.mainQuestsTotal) * 100,
  );
}

function questTitle(q: Phase33QuestView): string {
  return locale.value === 'en' ? q.titleEn : q.titleVi;
}

function questDescription(q: Phase33QuestView): string {
  return locale.value === 'en' ? q.descriptionEn : q.descriptionVi;
}

function errorText(code: string | null): string {
  if (!code) return '';
  return t(`storyV2.error.${code}`, t(`storyV2.error.UNKNOWN_ERROR`));
}

async function onAccept(quest: Phase33QuestView): Promise<void> {
  await store.acceptQuest(quest.questKey);
  if (store.submittingError) {
    toast.push({ type: 'error', text: errorText(store.submittingError) });
    store.clearSubmittingError();
  } else {
    toast.push({
      type: 'success',
      text: t('storyV2.acceptToast', { name: questTitle(quest) }),
    });
  }
}

async function onComplete(quest: Phase33QuestView): Promise<void> {
  await store.completeQuest(quest.questKey);
  if (store.submittingError) {
    toast.push({ type: 'error', text: errorText(store.submittingError) });
    store.clearSubmittingError();
  } else {
    toast.push({
      type: 'success',
      text: t('storyV2.completeToast', { name: questTitle(quest) }),
    });
  }
}

async function onClaim(quest: Phase33QuestView): Promise<void> {
  await store.claimQuest(quest.questKey);
  if (store.submittingError) {
    toast.push({ type: 'error', text: errorText(store.submittingError) });
    store.clearSubmittingError();
  } else {
    const granted = store.lastClaimResult?.granted;
    toast.push({
      type: 'success',
      text: t('storyV2.claimToast', {
        name: questTitle(quest),
        linhThach: granted?.linhThach ?? 0,
        exp: granted?.exp ?? 0,
      }),
    });
  }
}

watch(selectedChapKey, (next) => {
  if (next) {
    questTab.value = 'main';
  }
});

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
  await store.loadChapters();
});
</script>

<template>
  <AppShell>
    <div class="max-w-6xl mx-auto space-y-4" data-testid="story-v2-view">
      <!-- Header -->
      <header class="flex items-baseline justify-between gap-3 flex-wrap">
        <div>
          <XTHeroEyebrow han="仙遃叙事" label="Tiên Duệ Tự Sự" />
          <h1 class="text-2xl tracking-widest font-bold mt-1">
            {{ t('storyV2.title') }}
          </h1>
          <p class="text-sm text-ink-300">{{ t('storyV2.subtitle') }}</p>
        </div>
        <div class="text-right text-xs text-ink-300 space-y-0.5">
          <div data-testid="story-v2-total-count">
            {{ t('storyV2.totalCount', { n: totalChapterCount }) }}
          </div>
          <div data-testid="story-v2-in-progress-count">
            {{ t('storyV2.inProgressCount', { n: inProgressChapterCount }) }}
          </div>
          <div data-testid="story-v2-completed-count">
            {{ t('storyV2.completedCount', { n: completedChapterCount }) }}
          </div>
        </div>
      </header>

      <!-- Loading / error -->
      <div
        v-if="loading && !loaded"
        class="text-ink-300 text-sm"
        data-testid="story-v2-loading"
      >
        {{ t('common.loadingData') }}
      </div>
      <div
        v-else-if="lastError"
        class="bg-rose-900/30 border border-rose-400/30 rounded p-4 text-sm text-rose-100"
        data-testid="story-v2-error"
      >
        {{ errorText(lastError) }}
      </div>

      <!-- Chapter list view (when no chapter selected) -->
      <div
        v-else-if="!selectedChapter"
        class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3"
        data-testid="story-v2-chapter-list"
      >
        <div
          v-if="loaded && chapters.length === 0"
          class="col-span-full bg-ink-700/30 border border-ink-300/20 rounded p-6 text-center text-ink-300"
          data-testid="story-v2-empty"
        >
          {{ t('storyV2.empty') }}
        </div>
        <button
          v-for="chap in chapters"
          :key="chap.chapKey"
          type="button"
          class="bg-ink-700/30 border border-ink-300/20 rounded p-4 text-left hover:border-amber-400/40 hover:bg-ink-700/50 transition"
          :class="{
            'opacity-50 cursor-not-allowed': chap.status === 'LOCKED',
          }"
          :data-testid="`story-v2-chapter-card-${chap.chapKey}`"
          :disabled="chap.status === 'LOCKED'"
          @click="chap.status !== 'LOCKED' && selectChapter(chap)"
        >
          <div class="flex items-baseline justify-between gap-2">
            <h3 class="text-lg font-semibold tracking-wide">
              {{ chapterTitle(chap) }}
            </h3>
            <span
              class="text-[10px] uppercase px-2 py-0.5 rounded border"
              :class="{
                'border-ink-300/40 text-ink-300': chap.status === 'LOCKED',
                'border-amber-400/60 text-amber-200':
                  chap.status === 'AVAILABLE',
                'border-cyan-400/60 text-cyan-200':
                  chap.status === 'IN_PROGRESS',
                'border-emerald-400/60 text-emerald-200':
                  chap.status === 'COMPLETED',
              }"
              :data-testid="`story-v2-chapter-status-${chap.chapKey}`"
            >
              {{ t(`storyV2.chapterStatus.${chap.status}`) }}
            </span>
          </div>
          <p class="mt-2 text-xs text-ink-300 line-clamp-2">
            {{ chapterTheme(chap) }}
          </p>
          <div class="mt-3 text-xs text-ink-300">
            {{
              t('storyV2.mainProgress', {
                done: chap.mainQuestsCompletedCount,
                total: chap.mainQuestsTotal,
              })
            }}
          </div>
          <div class="mt-1 h-1.5 bg-ink-700/60 rounded overflow-hidden">
            <div
              class="h-full bg-amber-500/70 transition-all"
              :style="{ width: `${chapterProgressPct(chap)}%` }"
            />
          </div>
        </button>
      </div>

      <!-- Chapter detail view (when chapter selected) -->
      <div v-else class="space-y-4" data-testid="story-v2-chapter-detail">
        <div class="flex items-baseline justify-between gap-2 flex-wrap">
          <div>
            <button
              type="button"
              class="text-xs text-ink-300 hover:text-amber-200 transition"
              data-testid="story-v2-back-btn"
              @click="backToChapterList"
            >
              {{ t('storyV2.back') }}
            </button>
            <h2 class="mt-1 text-xl font-semibold tracking-wide">
              {{ chapterTitle(selectedChapter) }}
            </h2>
            <p class="text-sm text-ink-300">
              {{ chapterTheme(selectedChapter) }}
            </p>
          </div>
        </div>

        <!-- Quest kind tabs -->
        <nav
          class="flex flex-wrap gap-2 text-xs"
          data-testid="story-v2-quest-tabs"
        >
          <button
            v-for="tab in TABS"
            :key="tab"
            type="button"
            class="px-3 py-1.5 rounded border transition"
            :class="
              questTab === tab
                ? 'border-amber-400/60 bg-amber-700/40 text-amber-100'
                : 'border-ink-300/30 bg-ink-700/30 text-ink-200 hover:bg-ink-700/50'
            "
            :data-testid="`story-v2-tab-${tab}`"
            @click="questTab = tab"
          >
            {{ t(`storyV2.kindTab.${tab}`) }}
          </button>
        </nav>

        <div
          v-if="tabFilteredQuests.length === 0"
          class="bg-ink-700/30 border border-ink-300/20 rounded p-6 text-center text-ink-300"
          data-testid="story-v2-no-quest"
        >
          {{ t('storyV2.noQuest') }}
        </div>

        <ul class="space-y-3" data-testid="story-v2-quest-list">
          <li
            v-for="q in tabFilteredQuests"
            :key="q.questKey"
            class="bg-ink-700/30 border border-ink-300/20 rounded p-3"
            :data-testid="`story-v2-quest-${q.questKey}`"
          >
            <div class="flex items-baseline justify-between gap-2 flex-wrap">
              <h4 class="font-semibold">
                {{ questTitle(q) }}
              </h4>
              <span
                class="text-[10px] uppercase px-2 py-0.5 rounded border"
                :class="{
                  'border-ink-300/40 text-ink-300': q.status === 'LOCKED',
                  'border-amber-400/60 text-amber-200':
                    q.status === 'AVAILABLE',
                  'border-cyan-400/60 text-cyan-200': q.status === 'ACCEPTED',
                  'border-emerald-400/60 text-emerald-200':
                    q.status === 'COMPLETED',
                  'border-violet-400/60 text-violet-200':
                    q.status === 'CLAIMED',
                }"
                :data-testid="`story-v2-quest-status-${q.questKey}`"
              >
                {{ t(`storyV2.questStatus.${q.status}`) }}
              </span>
            </div>
            <p class="mt-1 text-xs text-ink-300">
              {{ questDescription(q) }}
            </p>
            <ul class="mt-2 space-y-0.5 text-xs">
              <li
                v-for="s in q.steps"
                :key="s.id"
                :class="{
                  'text-emerald-300': s.done,
                  'text-ink-200': !s.done,
                }"
                :data-testid="`story-v2-step-${q.questKey}-${s.id}`"
              >
                <span class="opacity-60">[{{ s.kind }}]</span>
                {{ s.description }}
                <span class="opacity-80">
                  ({{ s.currentCount }}/{{ s.count }})
                </span>
              </li>
            </ul>
            <div class="mt-2 flex flex-wrap gap-2 text-xs">
              <button
                v-if="q.status === 'AVAILABLE'"
                type="button"
                class="px-2.5 py-1 rounded border border-amber-400/40 text-amber-200 hover:bg-amber-700/30 transition disabled:opacity-40"
                :disabled="submittingKey === q.questKey"
                :data-testid="`story-v2-accept-${q.questKey}`"
                @click="onAccept(q)"
              >
                {{ t('storyV2.actions.accept') }}
              </button>
              <button
                v-if="q.status === 'ACCEPTED' && q.completable"
                type="button"
                class="px-2.5 py-1 rounded border border-cyan-400/40 text-cyan-200 hover:bg-cyan-700/30 transition disabled:opacity-40"
                :disabled="submittingKey === q.questKey"
                :data-testid="`story-v2-complete-${q.questKey}`"
                @click="onComplete(q)"
              >
                {{ t('storyV2.actions.complete') }}
              </button>
              <button
                v-if="q.status === 'COMPLETED'"
                type="button"
                class="px-2.5 py-1 rounded border border-emerald-400/40 text-emerald-200 hover:bg-emerald-700/30 transition disabled:opacity-40"
                :disabled="submittingKey === q.questKey"
                :data-testid="`story-v2-claim-${q.questKey}`"
                @click="onClaim(q)"
              >
                {{ t('storyV2.actions.claim') }}
              </button>
              <span
                v-if="q.status === 'CLAIMED'"
                class="px-2.5 py-1 text-violet-300"
                :data-testid="`story-v2-claimed-label-${q.questKey}`"
              >
                {{ t('storyV2.actions.claimed') }}
              </span>
            </div>
          </li>
        </ul>
      </div>
    </div>
  </AppShell>
</template>
