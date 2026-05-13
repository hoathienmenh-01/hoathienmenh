<script setup lang="ts">
/**
 * Phase 42.0 — Combat feedback timeline.
 *
 * Render danh sách combat event đẹp hơn so với plain text log. KHÔNG sửa
 * combat formula — chỉ render từ event list caller cung cấp.
 */
import { computed } from 'vue';
import CombatFeedbackEvent from './CombatFeedbackEvent.vue';
import type { CombatFeedbackEventInput } from './CombatFeedbackEvent.vue';

const props = withDefaults(
  defineProps<{
    events: readonly CombatFeedbackEventInput[];
    showCombatLogDetail?: boolean;
    compactMode?: boolean;
    visualEffectLevel?: 'OFF' | 'LOW' | 'MEDIUM' | 'HIGH';
    reducedMotion?: boolean;
    testId?: string;
  }>(),
  {
    showCombatLogDetail: true,
    compactMode: false,
    visualEffectLevel: 'MEDIUM',
    reducedMotion: false,
    testId: 'combat-feedback-timeline',
  },
);

const visible = computed(() => {
  // Khi showCombatLogDetail = false → ẩn các event severity 'INFO'.
  if (props.showCombatLogDetail) return props.events;
  return props.events.filter((e) => e.severity !== 'INFO');
});
</script>

<template>
  <div
    class="flex flex-col gap-1"
    :data-testid="props.testId"
    :data-compact="props.compactMode ? 'true' : 'false'"
    :data-detail="props.showCombatLogDetail ? 'true' : 'false'"
    role="log"
  >
    <CombatFeedbackEvent
      v-for="ev in visible"
      :key="ev.id"
      :event="ev"
      :compact-mode="props.compactMode"
      :visual-effect-level="visualEffectLevel"
      :reduced-motion="reducedMotion"
    />
  </div>
</template>
