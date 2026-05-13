<script setup lang="ts">
/**
 * Phase 42.0 — Generic effect queue host.
 *
 * Render `useEffectQueue()` output dưới dạng list. Caller chỉ cần truyền
 * danh sách `QueuedEffect` đã được sort + clamp; host responsibility là
 * map sang component thích hợp dựa trên effect type.
 */
import { computed } from 'vue';
import { getEffectByKey } from '@xuantoi/shared';
import type { QueuedEffect } from '@/composables/useEffectQueue';
import FloatingCombatText from './FloatingCombatText.vue';

const props = withDefaults(
  defineProps<{
    entries: readonly QueuedEffect[];
    visualEffectLevel?: 'OFF' | 'LOW' | 'MEDIUM' | 'HIGH';
    reducedMotion?: boolean;
    testId?: string;
  }>(),
  {
    visualEffectLevel: 'MEDIUM',
    reducedMotion: false,
    testId: 'effect-queue-host',
  },
);

interface RenderableEntry extends QueuedEffect {
  effectType: string;
  damageType: 'normal' | 'crit' | 'miss' | 'block' | 'shield' | 'dot' | 'lifesteal' | 'counter' | 'heal';
  amount: number | null;
  label: string | null;
}

const renderable = computed<RenderableEntry[]>(() =>
  props.entries.map((e) => {
    const def = getEffectByKey(e.effectKey);
    const t = def?.type ?? 'SYSTEM_TOAST';
    let damageType: RenderableEntry['damageType'] = 'normal';
    if (t === 'CRIT') damageType = 'crit';
    else if (t === 'MISS') damageType = 'miss';
    else if (t === 'BLOCK') damageType = 'block';
    else if (t === 'SHIELD') damageType = 'shield';
    else if (t === 'DOT') damageType = 'dot';
    else if (t === 'LIFESTEAL') damageType = 'lifesteal';
    else if (t === 'COUNTER') damageType = 'counter';
    else if (t === 'HEAL') damageType = 'heal';
    return {
      ...e,
      effectType: t,
      damageType,
      amount: typeof e.payload?.amount === 'number' ? (e.payload.amount as number) : null,
      label: typeof e.payload?.label === 'string' ? (e.payload.label as string) : null,
    };
  }),
);
</script>

<template>
  <div
    class="flex flex-col gap-1 pointer-events-none"
    :data-testid="props.testId"
    :data-count="renderable.length"
  >
    <FloatingCombatText
      v-for="entry in renderable"
      :key="entry.id"
      :type="entry.damageType"
      :amount="entry.amount"
      :label="entry.label ?? undefined"
      :visual-effect-level="visualEffectLevel"
      :reduced-motion="reducedMotion"
    />
  </div>
</template>
