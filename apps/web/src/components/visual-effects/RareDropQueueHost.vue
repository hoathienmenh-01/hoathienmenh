<script setup lang="ts">
/**
 * Phase 42.0 — Rare drop popup queue host.
 *
 * Receives an external list of pending rare-drop entries (from caller's
 * state store) and renders them under `maxVisible`. Component is dumb —
 * caller manages the underlying queue (via `useEffectQueue`) or its own
 * state.
 */
import { computed } from 'vue';
import RareDropPopup from './RareDropPopup.vue';
import type { VisualEffectElement, VisualEffectRarity } from '@xuantoi/shared';

export interface RareDropEntry {
  id: string;
  itemName: string;
  itemKey?: string | null;
  rarity: VisualEffectRarity;
  tier?: number | null;
  source?: string | null;
  element?: VisualEffectElement | null;
  effectKey?: string;
  quantity?: number;
  message?: string | null;
}

const props = withDefaults(
  defineProps<{
    entries: readonly RareDropEntry[];
    maxVisible?: number;
    visualEffectLevel?: 'OFF' | 'LOW' | 'MEDIUM' | 'HIGH';
    reducedMotion?: boolean;
    testId?: string;
  }>(),
  {
    maxVisible: 3,
    visualEffectLevel: 'MEDIUM',
    reducedMotion: false,
    testId: 'rare-drop-queue-host',
  },
);

const visible = computed(() => props.entries.slice(0, props.maxVisible));
</script>

<template>
  <div
    class="flex flex-col gap-2 pointer-events-none"
    :data-testid="props.testId"
    :data-visible="visible.length"
    :data-total="props.entries.length"
  >
    <RareDropPopup
      v-for="entry in visible"
      :key="entry.id"
      :item-name="entry.itemName"
      :item-key="entry.itemKey ?? null"
      :rarity="entry.rarity"
      :tier="entry.tier ?? null"
      :source="entry.source ?? null"
      :element="entry.element ?? null"
      :effect-key="entry.effectKey"
      :quantity="entry.quantity ?? 1"
      :message="entry.message ?? null"
      :visual-effect-level="visualEffectLevel"
      :reduced-motion="reducedMotion"
    />
  </div>
</template>
