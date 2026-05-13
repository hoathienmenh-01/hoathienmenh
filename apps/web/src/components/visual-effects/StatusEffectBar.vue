<script setup lang="ts">
/**
 * Phase 42.0 — Status effect bar (row of badges).
 */
import type { StatusEffectType } from '@xuantoi/shared';
import StatusEffectBadge from './StatusEffectBadge.vue';

export interface StatusEffectInstance {
  key: StatusEffectType;
  stack?: number;
  durationRemaining?: number | null;
}

withDefaults(
  defineProps<{
    statuses: readonly StatusEffectInstance[];
    visualEffectLevel?: 'OFF' | 'LOW' | 'MEDIUM' | 'HIGH';
    reducedMotion?: boolean;
    testId?: string;
  }>(),
  {
    visualEffectLevel: 'MEDIUM',
    reducedMotion: false,
    testId: 'status-effect-bar',
  },
);
</script>

<template>
  <div
    class="flex flex-wrap gap-1"
    :data-testid="testId"
    role="list"
  >
    <StatusEffectBadge
      v-for="s in statuses"
      :key="`${s.key}-${s.durationRemaining ?? 0}-${s.stack ?? 1}`"
      :status-key="s.key"
      :stack="s.stack ?? 1"
      :duration-remaining="s.durationRemaining ?? null"
      :visual-effect-level="visualEffectLevel"
      :reduced-motion="reducedMotion"
    />
  </div>
</template>
