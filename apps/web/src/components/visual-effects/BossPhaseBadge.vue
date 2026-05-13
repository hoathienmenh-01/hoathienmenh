<script setup lang="ts">
/**
 * Phase 42.0 — Boss phase badge (compact pill bên cạnh boss name).
 */
import { computed } from 'vue';
import type { BossWarningType } from '@/lib/visual-effect-adapters';

const props = withDefaults(
  defineProps<{
    phase: BossWarningType;
    label?: string | null;
    visualEffectLevel?: 'OFF' | 'LOW' | 'MEDIUM' | 'HIGH';
    reducedMotion?: boolean;
    testId?: string;
  }>(),
  {
    label: null,
    visualEffectLevel: 'MEDIUM',
    reducedMotion: false,
    testId: 'boss-phase-badge',
  },
);

const cssClass = computed(() => {
  switch (props.phase) {
    case 'BOSS_ENRAGE':
      return 'border-red-300/70 text-red-200';
    case 'BOSS_CHARGING':
      return 'border-amber-300/70 text-amber-200';
    case 'BOSS_LOW_HP':
      return 'border-orange-300/70 text-orange-200';
    case 'BOSS_DEFEATED':
      return 'border-emerald-300/70 text-emerald-200';
    case 'BOSS_SHIELD':
      return 'border-yellow-200/70 text-yellow-200';
    case 'BOSS_HEALING':
      return 'border-green-300/70 text-green-200';
    default:
      return 'border-blue-300/70 text-blue-200';
  }
});

const containerClass = computed(() => {
  const parts = [
    'inline-flex items-center px-2 py-0.5 rounded border text-xs font-semibold uppercase',
    cssClass.value,
  ];
  if (
    !props.reducedMotion &&
    props.visualEffectLevel === 'HIGH' &&
    (props.phase === 'BOSS_ENRAGE' || props.phase === 'BOSS_LOW_HP')
  ) {
    parts.push('ve-anim-pulse-soft');
  }
  return parts.join(' ');
});

const displayLabel = computed(
  () => props.label ?? props.phase.replace(/^BOSS_/, '').replace(/_/g, ' '),
);
</script>

<template>
  <span
    :class="containerClass"
    :data-testid="props.testId"
    :data-phase="props.phase"
    role="status"
  >
    {{ displayLabel }}
  </span>
</template>
