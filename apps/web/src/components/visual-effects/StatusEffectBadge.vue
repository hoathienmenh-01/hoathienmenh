<script setup lang="ts">
/**
 * Phase 42.0 — Status effect badge (BUFF/DEBUFF icon + stack + duration).
 *
 * Tiêu dùng `StatusEffectDef` từ shared catalog. Không tự fetch state;
 * caller render trong `<StatusEffectBar>` hoặc HUD.
 */
import { computed } from 'vue';
import { getStatusEffectByKey, type StatusEffectType } from '@xuantoi/shared';

const props = withDefaults(
  defineProps<{
    statusKey: StatusEffectType;
    stack?: number;
    durationRemaining?: number | null;
    visualEffectLevel?: 'OFF' | 'LOW' | 'MEDIUM' | 'HIGH';
    reducedMotion?: boolean;
    testId?: string;
  }>(),
  {
    stack: 1,
    durationRemaining: null,
    visualEffectLevel: 'MEDIUM',
    reducedMotion: false,
    testId: 'status-effect-badge',
  },
);

const def = computed(() => getStatusEffectByKey(props.statusKey));

const cssClass = computed(() => {
  if (!def.value) return 'border border-ink-300/30';
  const parts = [def.value.cssClass, 'border rounded px-1 py-0.5 inline-flex items-center gap-1 text-xs'];
  if (!props.reducedMotion && props.visualEffectLevel === 'HIGH' && def.value.positive) {
    parts.push('ve-anim-glow-subtle');
  }
  return parts.join(' ');
});

const tooltip = computed(() => def.value?.tooltipVi ?? '');
const label = computed(() => def.value?.labelVi ?? props.statusKey);
const displayStack = computed(() =>
  def.value?.stackable && props.stack > 1 ? `×${props.stack}` : '',
);
const displayDuration = computed(() =>
  props.durationRemaining != null && props.durationRemaining >= 0
    ? `${props.durationRemaining}`
    : '',
);
</script>

<template>
  <span
    v-if="def"
    :class="cssClass"
    :title="tooltip"
    :data-testid="props.testId"
    :data-status-key="def.key"
    :data-positive="def.positive ? 'true' : 'false'"
    role="status"
  >
    <span class="font-medium">{{ label }}</span>
    <span v-if="displayStack" class="opacity-80">{{ displayStack }}</span>
    <span v-if="displayDuration" class="opacity-60 tabular-nums">{{
      displayDuration
    }}</span>
  </span>
</template>
