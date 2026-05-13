<script setup lang="ts">
/**
 * Phase 42.0 — Floating combat text.
 *
 * Render damage/heal/miss/block number nổi lên trên target. Component
 * "dumb" — chỉ render text, không tự push vào queue. Caller (combat HUD)
 * tạo từng instance qua `<FloatingCombatText ... />` hoặc queue host.
 */
import { computed } from 'vue';
import { getEffectByDamageType, type VisualEffectElement } from '@xuantoi/shared';

type DamageType =
  | 'normal'
  | 'crit'
  | 'miss'
  | 'block'
  | 'shield'
  | 'dot'
  | 'lifesteal'
  | 'counter'
  | 'heal';

const props = withDefaults(
  defineProps<{
    amount?: number | null;
    label?: string;
    type: DamageType;
    element?: VisualEffectElement | null;
    durationMs?: number;
    visualEffectLevel?: 'OFF' | 'LOW' | 'MEDIUM' | 'HIGH';
    reducedMotion?: boolean;
    testId?: string;
  }>(),
  {
    amount: null,
    label: undefined,
    element: null,
    durationMs: undefined,
    visualEffectLevel: 'MEDIUM',
    reducedMotion: false,
    testId: 'floating-combat-text',
  },
);

const effect = computed(() =>
  getEffectByDamageType(props.type, props.element ?? undefined),
);

const showAnimation = computed(
  () => !props.reducedMotion && props.visualEffectLevel !== 'OFF',
);

const containerClass = computed(() => {
  const parts: string[] = [
    'inline-block px-2 py-0.5 rounded text-sm font-semibold pointer-events-none select-none',
  ];
  if (props.type === 'crit') parts.push('text-amber-300 ve-anim-pulse-soft');
  else if (props.type === 'miss') parts.push('text-ink-300');
  else if (props.type === 'block') parts.push('text-blue-200');
  else if (props.type === 'shield') parts.push('text-yellow-200');
  else if (props.type === 'dot') parts.push('text-red-300');
  else if (props.type === 'lifesteal') parts.push('text-pink-200');
  else if (props.type === 'counter') parts.push('text-amber-200');
  else if (props.type === 'heal') parts.push('text-green-300');
  else parts.push('text-ink-50');
  if (props.element && props.element !== 'NONE') {
    parts.push(`ve-element-${props.element.toLowerCase()}`);
  }
  if (showAnimation.value) parts.push('ve-anim-float-up');
  return parts.join(' ');
});

const renderedLabel = computed<string>(() => {
  if (props.label) return props.label;
  if (props.type === 'miss') return 'MISS';
  if (props.type === 'block') return 'BLOCK';
  if (props.type === 'shield') return 'SHIELD';
  if (props.type === 'crit') return 'CRIT';
  return '';
});

const renderedAmount = computed<string>(() => {
  if (props.amount == null) return '';
  const sign = props.type === 'heal' ? '+' : '-';
  return `${sign}${formatAmount(props.amount)}`;
});

function formatAmount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}
</script>

<template>
  <span
    :class="containerClass"
    :data-testid="props.testId"
    :data-effect-key="effect.key"
    :data-reduced-motion="props.reducedMotion ? 'true' : 'false'"
    role="status"
  >
    <span v-if="renderedLabel" class="mr-1 uppercase tracking-wide text-xs">{{
      renderedLabel
    }}</span>
    <span v-if="renderedAmount">{{ renderedAmount }}</span>
  </span>
</template>
