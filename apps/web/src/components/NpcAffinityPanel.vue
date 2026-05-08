<script setup lang="ts">
import { computed, onMounted, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useNpcAffinityStore } from '@/stores/npcAffinity';
import type { NpcAffinityView } from '@/api/npcAffinity';

/**
 * Phase 12.10.A — NPC Relationship panel.
 *
 * Renders read-only list of all NPC affinities for the current character.
 * Server-authoritative — mutations happen via dialogue choice / quest reward;
 * panel reloads after `StoryDialogueModal` applies effects (parent refresh
 * via store).
 */

const props = withDefaults(
  defineProps<{
    /** True = auto-load on mount. Default true. Set false in tests / manual control. */
    autoLoad?: boolean;
  }>(),
  { autoLoad: true },
);

const store = useNpcAffinityStore();
const { t, locale } = useI18n();

const loading = computed(() => store.loading);
const error = computed(() => store.error);
const affinities = computed(() => store.affinities);

function tierLabel(view: NpcAffinityView): string {
  return locale.value === 'en' && view.currentTier.labelEn
    ? view.currentTier.labelEn
    : view.currentTier.label;
}

function nextTierLabel(view: NpcAffinityView): string {
  if (!view.nextTier) return '';
  return locale.value === 'en' && view.nextTier.labelEn
    ? view.nextTier.labelEn
    : view.nextTier.label;
}

function unlockDescription(unlock: NpcAffinityView['unlocks'][number]): string {
  return locale.value === 'en' && unlock.descriptionEn
    ? unlock.descriptionEn
    : unlock.description;
}

function progressPercent(view: NpcAffinityView): number {
  // Score from minScore..maxScore mapped to 0..100.
  const range = view.maxScore - view.minScore;
  if (range <= 0) return 0;
  const offset = view.score - view.minScore;
  return Math.max(0, Math.min(100, Math.round((offset / range) * 100)));
}

onMounted(() => {
  if (props.autoLoad && !store.loaded) {
    void store.load();
  }
});

watch(
  () => props.autoLoad,
  (v) => {
    if (v && !store.loaded && !store.loading) void store.load();
  },
);
</script>

<template>
  <section
    class="bg-ink-700/40 border border-ink-300/20 rounded-lg p-4 space-y-3"
    data-testid="npc-affinity-panel"
  >
    <header class="flex items-baseline justify-between">
      <h3 class="text-base font-semibold text-amber-100">
        {{ t('npcAffinity.title') }}
      </h3>
      <button
        type="button"
        class="text-xs text-ink-300 hover:text-ink-50 underline"
        :disabled="loading"
        data-testid="npc-affinity-refresh"
        @click="store.refresh()"
      >
        {{ t('common.refresh') }}
      </button>
    </header>

    <p class="text-xs text-ink-300 italic">{{ t('npcAffinity.subtitle') }}</p>

    <div
      v-if="loading"
      class="text-sm text-ink-300 py-4 text-center"
      data-testid="npc-affinity-loading"
    >
      {{ t('common.loadingData') }}
    </div>

    <div
      v-else-if="error"
      class="text-sm text-rose-300 py-4 text-center"
      data-testid="npc-affinity-error"
    >
      {{ t(`npcAffinity.errors.${error}`, t('npcAffinity.errors.UNKNOWN')) }}
    </div>

    <div
      v-else-if="affinities.length === 0"
      class="text-sm text-ink-300 py-4 text-center"
      data-testid="npc-affinity-empty"
    >
      {{ t('npcAffinity.empty') }}
    </div>

    <ul v-else class="space-y-3" data-testid="npc-affinity-list">
      <li
        v-for="aff in affinities"
        :key="aff.npcKey"
        class="bg-ink-800/40 border border-ink-300/15 rounded p-3 space-y-2"
        :data-testid="`npc-affinity-item-${aff.npcKey}`"
      >
        <div class="flex items-baseline justify-between gap-3">
          <h4
            class="text-sm font-semibold text-ink-50"
            :data-testid="`npc-affinity-name-${aff.npcKey}`"
          >
            {{ aff.npcName }}
          </h4>
          <span
            class="text-xs text-amber-300 font-medium"
            :data-testid="`npc-affinity-tier-${aff.npcKey}`"
          >
            {{ tierLabel(aff) }}
          </span>
        </div>

        <div class="flex items-center gap-2">
          <div class="flex-1 h-1.5 bg-ink-700 rounded-full overflow-hidden">
            <div
              class="h-full bg-amber-300/70 transition-all"
              :style="{ width: `${progressPercent(aff)}%` }"
              :data-testid="`npc-affinity-bar-${aff.npcKey}`"
            />
          </div>
          <span
            class="text-xs text-ink-300 tabular-nums"
            :data-testid="`npc-affinity-score-${aff.npcKey}`"
          >
            {{ aff.score }}/{{ aff.maxScore }}
          </span>
        </div>

        <p
          v-if="aff.nextTier"
          class="text-xs text-ink-300"
          :data-testid="`npc-affinity-next-${aff.npcKey}`"
        >
          {{
            t('npcAffinity.nextTierHint', {
              tier: nextTierLabel(aff),
              points: aff.nextTier.pointsToReach,
            })
          }}
        </p>
        <p v-else class="text-xs text-emerald-300 italic">
          {{ t('npcAffinity.maxTierReached') }}
        </p>

        <ul
          v-if="aff.unlocks.length > 0"
          class="text-xs space-y-1 pt-1 border-t border-ink-300/10"
          :data-testid="`npc-affinity-unlocks-${aff.npcKey}`"
        >
          <li
            v-for="u in aff.unlocks"
            :key="u.tierKey"
            class="flex items-baseline gap-2"
            :class="u.reached ? 'text-emerald-200' : 'text-ink-400'"
          >
            <span class="font-medium">
              {{
                locale === 'en' && u.tierLabelEn ? u.tierLabelEn : u.tierLabel
              }}
            </span>
            <span class="text-ink-300">·</span>
            <span class="flex-1">{{ unlockDescription(u) }}</span>
            <span v-if="u.reached" class="text-[10px]">✓</span>
          </li>
        </ul>
      </li>
    </ul>
  </section>
</template>
