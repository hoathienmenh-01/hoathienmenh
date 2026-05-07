<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { storyDungeonByKey, realmByKey } from '@xuantoi/shared';
import type {
  StoryDungeonRunView,
  StoryDungeonView,
} from '@/api/storyDungeon';

/**
 * Phase 12.8.C — Story Dungeon Run Panel.
 *
 * Hiển thị active run inline trong `/story-dungeons`:
 *   - Title + step progress (`{cur}/{total}`).
 *   - Encounter monster sắp đối đầu (currentMonster) hoặc kill log nếu đã clear.
 *   - Boss preview nếu template có.
 *   - Action buttons:
 *       ACTIVE + còn step → "advance"
 *       ACTIVE + step === total → "clear"
 *       CLEARED + chưa claim → "claim"
 *   - Dialogue trigger button (entry/clear) — emit lên parent để mount modal.
 *
 * Server-authoritative: status / step / killedMonsters đều từ server.
 * UI chỉ render + dispatch. KHÔNG cộng EXP/loot client-side.
 */

const props = defineProps<{
  run: StoryDungeonRunView;
  /** Catalog snapshot cho run (lookup từ store hoặc shared). Có thể null
   *  nếu template legacy / disabled — UI fallback render `templateKey` raw. */
  template: StoryDungeonView | null;
  submittingKey: string | null;
}>();

const emit = defineEmits<{
  (e: 'advance'): void;
  (e: 'clear'): void;
  (e: 'claim'): void;
  (e: 'open-dialogue', kind: 'entry' | 'clear'): void;
}>();

const { t } = useI18n();

const titleDisplay = computed(() => {
  return props.template?.titleVi ?? props.run.templateKey;
});

const recommendedRealmDisplay = computed(() => {
  const key = props.template?.recommendedRealm;
  if (!key) return null;
  return realmByKey(key)?.name ?? key;
});

const isActive = computed(() => props.run.status === 'ACTIVE');
const isCleared = computed(() => props.run.status === 'CLEARED');
const isClaimed = computed(() => props.run.status === 'CLAIMED');
const isReadyToClear = computed(
  () =>
    props.run.status === 'ACTIVE' &&
    props.run.currentStep >= props.run.totalSteps,
);

const advanceDisabled = computed(
  () =>
    !isActive.value ||
    isReadyToClear.value ||
    props.submittingKey !== null,
);
const clearDisabled = computed(
  () => !isReadyToClear.value || props.submittingKey !== null,
);
const claimDisabled = computed(
  () =>
    !isCleared.value ||
    props.run.claimedAt !== null ||
    props.submittingKey !== null,
);

const hasEntryDialogue = computed(() =>
  Boolean(props.template?.entryDialogueKey),
);
const hasClearDialogue = computed(() =>
  Boolean(props.template?.clearDialogueKey),
);

const rewardHint = computed(() => props.run.rewardHint);

function statusKey(status: StoryDungeonRunView['status']): string {
  return `storyDungeon.runStatus.${status}`;
}

/**
 * Resolve template fallback từ shared catalog nếu prop `template` null —
 * defensive cho legacy run (catalog disabled mid-flight).
 */
const resolvedTemplate = computed<StoryDungeonView | null>(() => {
  if (props.template) return props.template;
  const tpl = storyDungeonByKey(props.run.templateKey);
  if (!tpl) return null;
  return {
    key: tpl.key,
    titleI18nKey: tpl.titleI18nKey,
    descriptionI18nKey: tpl.descriptionI18nKey,
    titleVi: tpl.titleVi,
    descriptionVi: tpl.descriptionVi,
    requiredQuestKey: tpl.requiredQuestKey,
    requiredQuestStep: tpl.requiredQuestStep ?? null,
    regionKey: tpl.regionKey,
    recommendedRealm: tpl.recommendedRealm,
    minRealmKey: tpl.minRealmKey ?? null,
    npcKey: tpl.npcKey ?? null,
    entryDialogueKey: tpl.entryDialogueKey ?? null,
    clearDialogueKey: tpl.clearDialogueKey ?? null,
    monsters: [],
    boss: null,
    rewardHint: tpl.rewardHint ?? null,
    oneTime: tpl.oneTime,
    status: 'available',
  };
});
</script>

<template>
  <section
    class="bg-ink-700/40 border border-amber-400/40 rounded p-4 space-y-3"
    data-testid="story-dungeon-run-panel"
  >
    <header class="flex items-baseline justify-between gap-2 flex-wrap">
      <div class="flex items-baseline gap-2 flex-wrap">
        <span
          class="text-[10px] uppercase tracking-widest px-1.5 py-0.5 rounded border border-amber-400/40 text-amber-200"
        >
          {{ t('storyDungeon.run.activeBadge') }}
        </span>
        <h2
          class="font-bold text-amber-100"
          data-testid="story-dungeon-run-title"
        >
          {{ titleDisplay }}
        </h2>
      </div>
      <span
        class="text-xs px-2 py-0.5 rounded"
        :class="{
          'bg-amber-700/40 text-amber-100': isActive,
          'bg-emerald-700/40 text-emerald-100': isCleared,
          'bg-ink-600/40 text-ink-200': isClaimed,
        }"
        data-testid="story-dungeon-run-status"
      >
        {{ t(statusKey(run.status)) }}
      </span>
    </header>

    <div
      class="text-xs text-ink-300"
      data-testid="story-dungeon-run-progress"
    >
      {{ t('storyDungeon.run.progress', { cur: run.currentStep, total: run.totalSteps }) }}
    </div>

    <p
      v-if="recommendedRealmDisplay"
      class="text-xs text-ink-400"
      data-testid="story-dungeon-run-realm-hint"
    >
      {{ t('storyDungeon.run.realmHint', { realm: recommendedRealmDisplay }) }}
    </p>

    <div
      v-if="run.currentMonster"
      class="bg-ink-800/60 border border-ink-300/20 rounded px-3 py-2 text-sm"
      data-testid="story-dungeon-run-monster"
    >
      <div class="text-xs text-ink-300">
        {{ t('storyDungeon.run.currentMonster') }}
      </div>
      <div class="font-bold text-ink-100">
        {{ run.currentMonster.name }}
        <span class="text-xs text-ink-300 ml-1">
          {{ t('storyDungeon.run.monsterStat', {
            lv: run.currentMonster.level,
            hp: run.currentMonster.hp,
            atk: run.currentMonster.atk,
          }) }}
        </span>
      </div>
    </div>

    <div
      v-if="resolvedTemplate?.boss"
      class="text-xs text-ink-400"
      data-testid="story-dungeon-run-boss"
    >
      {{ t('storyDungeon.run.bossHint', { name: resolvedTemplate.boss.name }) }}
    </div>

    <div
      v-if="run.killedMonsters.length > 0"
      class="text-xs text-ink-300 space-y-0.5"
      data-testid="story-dungeon-run-killed"
    >
      <div class="text-ink-200 font-semibold">
        {{ t('storyDungeon.run.killedTitle', { n: run.killedMonsters.length }) }}
      </div>
      <ul class="list-disc list-inside">
        <li
          v-for="(k, idx) in run.killedMonsters"
          :key="`${k.monsterKey}-${idx}`"
          :data-testid="`story-dungeon-run-killed-${idx}`"
        >
          {{ k.monsterKey }}
        </li>
      </ul>
    </div>

    <div
      v-if="rewardHint"
      class="text-xs text-emerald-200"
      data-testid="story-dungeon-run-reward-preview"
    >
      {{ t('storyDungeon.run.rewardPreview', {
        linhThach: rewardHint.linhThach ?? 0,
        tienNgoc: rewardHint.tienNgoc ?? 0,
        exp: rewardHint.exp ?? 0,
      }) }}
    </div>

    <div class="flex items-center gap-2 flex-wrap">
      <button
        v-if="isActive && !isReadyToClear"
        type="button"
        class="px-3 py-1.5 rounded border border-sky-400/50 bg-sky-700/40 text-sky-100 hover:bg-sky-700/60 transition text-sm disabled:opacity-50 disabled:cursor-not-allowed"
        :disabled="advanceDisabled"
        data-testid="story-dungeon-run-advance"
        @click="emit('advance')"
      >
        {{ t('storyDungeon.run.advance') }}
      </button>

      <button
        v-if="isReadyToClear"
        type="button"
        class="px-3 py-1.5 rounded border border-emerald-400/50 bg-emerald-700/40 text-emerald-100 hover:bg-emerald-700/60 transition text-sm disabled:opacity-50 disabled:cursor-not-allowed"
        :disabled="clearDisabled"
        data-testid="story-dungeon-run-clear"
        @click="emit('clear')"
      >
        {{ t('storyDungeon.run.clear') }}
      </button>

      <button
        v-if="isCleared && run.claimedAt === null"
        type="button"
        class="px-3 py-1.5 rounded border border-amber-400/50 bg-amber-700/40 text-amber-100 hover:bg-amber-700/60 transition text-sm disabled:opacity-50 disabled:cursor-not-allowed"
        :disabled="claimDisabled"
        data-testid="story-dungeon-run-claim"
        @click="emit('claim')"
      >
        {{ t('storyDungeon.run.claim') }}
      </button>

      <button
        v-if="hasEntryDialogue"
        type="button"
        class="px-3 py-1.5 rounded border border-ink-300/40 bg-ink-700/40 text-ink-100 hover:bg-ink-700/60 transition text-sm"
        data-testid="story-dungeon-run-entry-dialogue"
        @click="emit('open-dialogue', 'entry')"
      >
        {{ t('storyDungeon.run.entryDialogue') }}
      </button>

      <button
        v-if="hasClearDialogue && (isCleared || isClaimed)"
        type="button"
        class="px-3 py-1.5 rounded border border-ink-300/40 bg-ink-700/40 text-ink-100 hover:bg-ink-700/60 transition text-sm"
        data-testid="story-dungeon-run-clear-dialogue"
        @click="emit('open-dialogue', 'clear')"
      >
        {{ t('storyDungeon.run.clearDialogue') }}
      </button>
    </div>
  </section>
</template>
