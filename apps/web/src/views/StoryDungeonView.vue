<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRouter } from 'vue-router';
import { realmByKey, getMapRegionByKey } from '@xuantoi/shared';
import { useAuthStore } from '@/stores/auth';
import { useGameStore } from '@/stores/game';
import { useStoryDungeonStore } from '@/stores/storyDungeon';
import { useToastStore } from '@/stores/toast';
import AppShell from '@/components/shell/AppShell.vue';
import XTPageEyebrow from '@/components/xianxia/XTPageEyebrow.vue';
import StoryDungeonRunPanel from '@/components/StoryDungeonRunPanel.vue';
import StoryDungeonDialoguePanel from '@/components/StoryDungeonDialoguePanel.vue';
import StoryDungeonRewardModal from '@/components/StoryDungeonRewardModal.vue';
import type {
  StoryDungeonClaimResult,
  StoryDungeonView as StoryDungeonViewModel,
} from '@/api/storyDungeon';

/**
 * Phase 12.8.C — Story Dungeon FE entry view.
 *
 * Server-authoritative: list catalog + active run từ
 * `GET /story/dungeons`; start/advance/clear/claim qua server CAS guard.
 * UI chỉ render trạng thái + dispatch action; KHÔNG tự cộng EXP/tiền/item.
 *
 * Layout:
 *  - Header: title + counters (total/available/cleared/locked).
 *  - Active run panel (StoryDungeonRunPanel) — inline khi server trả activeRun.
 *  - Filter bar (all / available / locked / cleared).
 *  - List cards: status badge + region + recommendedRealm + requiredQuest +
 *    monsters + boss + reward hint + Start CTA.
 *  - StoryDungeonDialoguePanel — mounted on demand cho entry/clear NPC text.
 *  - StoryDungeonRewardModal — mounted khi claim thành công.
 */

const auth = useAuthStore();
const game = useGameStore();
const store = useStoryDungeonStore();
const toast = useToastStore();
const router = useRouter();
const { t } = useI18n();

const loading = computed(() => store.loading);
const loaded = computed(() => store.loaded);
const lastError = computed(() => store.lastError);
const dungeons = computed(() => store.dungeons);
const activeRun = computed(() => store.activeRun);
const submittingKey = computed(() => store.submittingKey);

type StatusFilter = 'all' | 'available' | 'locked' | 'cleared';
const statusFilter = ref<StatusFilter>('all');
const FILTERS: StatusFilter[] = ['all', 'available', 'locked', 'cleared'];

const filteredDungeons = computed<StoryDungeonViewModel[]>(() => {
  if (statusFilter.value === 'all') return dungeons.value;
  return dungeons.value.filter((d) => d.status === statusFilter.value);
});

const totalCount = computed(() => store.totalCount);
const availableCount = computed(() => store.availableCount);
const clearedCount = computed(() => store.clearedCount);
const filteredCount = computed(() => filteredDungeons.value.length);

const claimModal = ref<StoryDungeonClaimResult | null>(null);
const dialogueNodeId = ref<string | null>(null);
const dialogueNpcFallback = ref<string | null>(null);

/** Catalog snapshot cho activeRun — lookup từ list bằng templateKey. */
const activeRunTemplate = computed<StoryDungeonViewModel | null>(() => {
  if (!activeRun.value) return null;
  return dungeons.value.find((d) => d.key === activeRun.value!.templateKey) ?? null;
});

function realmDisplay(key: string): string {
  return realmByKey(key)?.name ?? key;
}

function regionDisplay(key: string): string {
  return getMapRegionByKey(key)?.nameVi ?? key;
}

function statusBadgeClass(status: StoryDungeonViewModel['status']): string {
  if (status === 'available')
    return 'bg-emerald-700/40 text-emerald-100 border border-emerald-400/40';
  if (status === 'cleared')
    return 'bg-ink-600/40 text-ink-200 border border-ink-300/30';
  return 'bg-rose-700/40 text-rose-100 border border-rose-400/40';
}

function statusLabel(status: StoryDungeonViewModel['status']): string {
  return t(`storyDungeon.status.${status}`);
}

function isActiveOnDungeon(d: StoryDungeonViewModel): boolean {
  return activeRun.value?.templateKey === d.key;
}

function startDisabled(d: StoryDungeonViewModel): boolean {
  if (submittingKey.value !== null) return true;
  if (d.status !== 'available') return true;
  // Đang trong active run khác templateKey → block (server cũng reject ALREADY_IN_RUN).
  if (activeRun.value && activeRun.value.templateKey !== d.key) return true;
  return false;
}

function errorText(code: string): string {
  return t(`storyDungeon.errors.${code}`, t('storyDungeon.errors.UNKNOWN'));
}

async function onStart(d: StoryDungeonViewModel): Promise<void> {
  try {
    await store.start(d.key);
    toast.push({
      type: 'success',
      text: t('storyDungeon.startToast', { name: d.titleVi }),
    });
    // Auto-mở entry dialogue panel nếu template có (UX hint).
    if (d.entryDialogueKey) {
      dialogueNodeId.value = d.entryDialogueKey;
      dialogueNpcFallback.value = d.titleVi;
    }
  } catch (e) {
    const code =
      (e as { code?: string }).code ??
      (e as { error?: { code?: string } }).error?.code ??
      'UNKNOWN_ERROR';
    toast.push({ type: 'error', text: errorText(code) });
  }
}

async function onAdvance(): Promise<void> {
  try {
    const next = await store.advance();
    if (next.currentStep >= next.totalSteps) {
      toast.push({
        type: 'success',
        text: t('storyDungeon.readyToClearToast'),
      });
    } else {
      toast.push({
        type: 'info',
        text: t('storyDungeon.advanceToast', {
          cur: next.currentStep,
          total: next.totalSteps,
        }),
      });
    }
  } catch (e) {
    const code =
      (e as { code?: string }).code ??
      (e as { error?: { code?: string } }).error?.code ??
      'UNKNOWN_ERROR';
    toast.push({ type: 'error', text: errorText(code) });
  }
}

async function onClear(): Promise<void> {
  try {
    const cleared = await store.clear();
    toast.push({ type: 'success', text: t('storyDungeon.clearToast') });
    // Auto-mở clear dialogue nếu template có.
    const tpl = dungeons.value.find((d) => d.key === cleared.templateKey);
    if (tpl?.clearDialogueKey) {
      dialogueNodeId.value = tpl.clearDialogueKey;
      dialogueNpcFallback.value = tpl.titleVi;
    }
  } catch (e) {
    const code =
      (e as { code?: string }).code ??
      (e as { error?: { code?: string } }).error?.code ??
      'UNKNOWN_ERROR';
    toast.push({ type: 'error', text: errorText(code) });
  }
}

async function onClaim(): Promise<void> {
  try {
    const result = await store.claim();
    claimModal.value = result;
    toast.push({
      type: 'success',
      text: t('storyDungeon.claimToast', {
        linhThach: result.granted.linhThach,
        exp: result.granted.exp,
      }),
    });
  } catch (e) {
    const code =
      (e as { code?: string }).code ??
      (e as { error?: { code?: string } }).error?.code ??
      'UNKNOWN_ERROR';
    toast.push({ type: 'error', text: errorText(code) });
  }
}

function onOpenDialogue(kind: 'entry' | 'clear'): void {
  const tpl = activeRunTemplate.value;
  if (!tpl) return;
  const nodeId = kind === 'entry' ? tpl.entryDialogueKey : tpl.clearDialogueKey;
  if (!nodeId) return;
  dialogueNodeId.value = nodeId;
  dialogueNpcFallback.value = tpl.titleVi;
}

function closeDialoguePanel(): void {
  dialogueNodeId.value = null;
  dialogueNpcFallback.value = null;
}

function closeClaimModal(): void {
  claimModal.value = null;
  store.clearLastClaimResult();
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
  await store.load();
});
</script>

<template>
  <AppShell>
    <div
      class="max-w-5xl mx-auto space-y-4"
      data-testid="story-dungeon-view"
    >
      <header class="flex items-baseline justify-between gap-3 flex-wrap">
        <div>
          <XTPageEyebrow label="Cổ Triết Mộng Cảnh" />
          <h1 class="text-2xl tracking-widest font-bold mt-1">
            {{ t('storyDungeon.title') }}
          </h1>
          <p class="text-sm text-ink-300">{{ t('storyDungeon.subtitle') }}</p>
        </div>
        <div class="text-right text-xs text-ink-300 space-y-0.5">
          <div data-testid="story-dungeon-total-count">
            {{ t('storyDungeon.totalCount', { n: totalCount }) }}
          </div>
          <div data-testid="story-dungeon-available-count">
            {{ t('storyDungeon.availableCount', { n: availableCount }) }}
          </div>
          <div data-testid="story-dungeon-cleared-count">
            {{ t('storyDungeon.clearedCount', { n: clearedCount }) }}
          </div>
        </div>
      </header>

      <!-- Active run panel (inline) -->
      <StoryDungeonRunPanel
        v-if="activeRun"
        :run="activeRun"
        :template="activeRunTemplate"
        :submitting-key="submittingKey"
        @advance="onAdvance"
        @clear="onClear"
        @claim="onClaim"
        @open-dialogue="onOpenDialogue"
      />

      <!-- Filter bar -->
      <nav
        class="flex flex-wrap gap-2 text-sm"
        data-testid="story-dungeon-filter-bar"
      >
        <button
          v-for="f in FILTERS"
          :key="f"
          type="button"
          class="px-3 py-1.5 rounded border transition"
          :class="
            statusFilter === f
              ? 'border-amber-400/60 bg-amber-700/40 text-amber-100'
              : 'border-ink-300/30 bg-ink-700/30 text-ink-200 hover:bg-ink-700/50'
          "
          :data-testid="`story-dungeon-filter-${f}`"
          @click="statusFilter = f"
        >
          {{ t(`storyDungeon.filter.${f}`) }}
        </button>
      </nav>

      <!-- Loading / error / empty / list -->
      <div
        v-if="loading && !loaded"
        class="text-ink-300 text-sm"
        data-testid="story-dungeon-loading"
      >
        {{ t('common.loadingData') }}
      </div>

      <div
        v-else-if="lastError"
        class="bg-rose-900/30 border border-rose-400/30 rounded p-4 text-sm text-rose-100"
        data-testid="story-dungeon-error"
      >
        {{ errorText(lastError) }}
      </div>

      <div
        v-else-if="loaded && filteredCount === 0"
        class="bg-ink-700/30 border border-ink-300/20 rounded p-6 text-center text-ink-300"
        data-testid="story-dungeon-empty"
      >
        {{
          statusFilter === 'all'
            ? t('storyDungeon.empty')
            : t('storyDungeon.emptyFiltered', { filter: t(`storyDungeon.filter.${statusFilter}`) })
        }}
      </div>

      <ul
        v-else
        class="grid grid-cols-1 md:grid-cols-2 gap-3"
        data-testid="story-dungeon-list"
      >
        <li
          v-for="d in filteredDungeons"
          :key="d.key"
          class="bg-ink-700/30 border border-ink-300/20 rounded p-4 space-y-2"
          :class="{ 'opacity-70': d.status === 'locked' }"
          :data-testid="`story-dungeon-row-${d.key}`"
        >
          <header class="flex items-baseline justify-between gap-2 flex-wrap">
            <div>
              <h3 class="font-bold text-amber-100">{{ d.titleVi }}</h3>
              <p class="text-xs text-ink-300">
                {{ t('storyDungeon.regionHint', { region: regionDisplay(d.regionKey) }) }}
                · {{ t('storyDungeon.realmHint', { realm: realmDisplay(d.recommendedRealm) }) }}
              </p>
            </div>
            <span
              class="text-xs px-2 py-0.5 rounded"
              :class="statusBadgeClass(d.status)"
              :data-testid="`story-dungeon-status-${d.key}`"
            >
              {{ statusLabel(d.status) }}
            </span>
          </header>

          <p class="text-xs text-ink-300 leading-relaxed">{{ d.descriptionVi }}</p>

          <dl class="grid grid-cols-2 gap-x-3 gap-y-1 text-xs text-ink-300">
            <div>
              <dt class="text-ink-400">{{ t('storyDungeon.metric.requiredQuest') }}</dt>
              <dd
                class="text-ink-100"
                :data-testid="`story-dungeon-quest-${d.key}`"
              >
                {{ d.requiredQuestKey }}
              </dd>
            </div>
            <div>
              <dt class="text-ink-400">{{ t('storyDungeon.metric.encounters') }}</dt>
              <dd class="text-ink-100">{{ d.monsters.length }}</dd>
            </div>
            <div v-if="d.boss" class="col-span-2">
              <dt class="text-ink-400">{{ t('storyDungeon.metric.boss') }}</dt>
              <dd class="text-ink-100">{{ d.boss.name }}</dd>
            </div>
            <div v-if="d.rewardHint" class="col-span-2">
              <dt class="text-ink-400">{{ t('storyDungeon.metric.bonusReward') }}</dt>
              <dd
                class="text-emerald-200"
                :data-testid="`story-dungeon-reward-${d.key}`"
              >
                {{ t('storyDungeon.rewardPreview', {
                  linhThach: d.rewardHint.linhThach ?? 0,
                  tienNgoc: d.rewardHint.tienNgoc ?? 0,
                  exp: d.rewardHint.exp ?? 0,
                }) }}
              </dd>
            </div>
          </dl>

          <div class="flex items-center justify-end gap-2 flex-wrap">
            <span
              v-if="d.oneTime"
              class="text-[10px] uppercase tracking-widest text-ink-400"
            >
              {{ t('storyDungeon.oneTimeBadge') }}
            </span>
            <span
              v-if="isActiveOnDungeon(d)"
              class="text-xs px-2 py-0.5 rounded bg-amber-700/40 text-amber-100 border border-amber-400/40"
              :data-testid="`story-dungeon-active-${d.key}`"
            >
              {{ t('storyDungeon.run.activeBadge') }}
            </span>
            <button
              type="button"
              class="px-3 py-1.5 rounded border border-amber-400/50 bg-amber-700/40 text-amber-100 hover:bg-amber-700/60 transition text-sm disabled:opacity-50 disabled:cursor-not-allowed"
              :disabled="startDisabled(d)"
              :data-testid="`story-dungeon-start-${d.key}`"
              @click="onStart(d)"
            >
              {{ isActiveOnDungeon(d) ? t('storyDungeon.resume') : t('storyDungeon.start') }}
            </button>
          </div>
        </li>
      </ul>
    </div>

    <StoryDungeonDialoguePanel
      :node-id="dialogueNodeId"
      :fallback-npc-name="dialogueNpcFallback"
      @close="closeDialoguePanel"
    />

    <StoryDungeonRewardModal
      :result="claimModal"
      @close="closeClaimModal"
    />
  </AppShell>
</template>
