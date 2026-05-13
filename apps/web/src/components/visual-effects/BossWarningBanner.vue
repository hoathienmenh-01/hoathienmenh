<script setup lang="ts">
/**
 * Phase 42.0 — Boss warning banner.
 *
 * Hiển thị banner cảnh báo khi boss appear / charging / enrage / low_hp ...
 * Caller cung cấp severity + message + (optional) turnsRemaining.
 */
import { computed } from 'vue';
import {
  getBossWarningEffect,
  type VisualEffectElement,
} from '@xuantoi/shared';
import type { BossWarningType } from '@/lib/visual-effect-adapters';

const props = withDefaults(
  defineProps<{
    bossName: string;
    warningType: BossWarningType;
    severity?: 'INFO' | 'WARNING' | 'DANGER' | 'FATAL';
    turnsRemaining?: number | null;
    message?: string | null;
    hpPercent?: number | null;
    element?: VisualEffectElement | null;
    visualEffectLevel?: 'OFF' | 'LOW' | 'MEDIUM' | 'HIGH';
    reducedMotion?: boolean;
    testId?: string;
  }>(),
  {
    severity: 'WARNING',
    turnsRemaining: null,
    message: null,
    hpPercent: null,
    element: null,
    visualEffectLevel: 'MEDIUM',
    reducedMotion: false,
    testId: 'boss-warning-banner',
  },
);

const effect = computed(() => getBossWarningEffect(props.warningType));

const severityClass = computed(() => {
  switch (props.severity) {
    case 'INFO':
      return 'border-blue-300/60 bg-blue-900/30 text-blue-100';
    case 'WARNING':
      return 'border-amber-300/60 bg-amber-900/30 text-amber-100';
    case 'DANGER':
      return 'border-red-400/60 bg-red-900/30 text-red-100';
    case 'FATAL':
      return 'border-rose-400/70 bg-rose-900/40 text-rose-100';
  }
  return '';
});

const containerClass = computed(() => {
  const parts: string[] = [
    'border rounded-md px-3 py-2 flex flex-col gap-0.5',
    severityClass.value,
  ];
  if (props.element && props.element !== 'NONE') {
    parts.push(`ve-element-${props.element.toLowerCase()}`);
  }
  if (
    !props.reducedMotion &&
    props.visualEffectLevel !== 'OFF' &&
    (props.severity === 'DANGER' || props.severity === 'FATAL')
  ) {
    parts.push('ve-anim-boss-warning-pulse');
  }
  return parts.join(' ');
});

const showCountdown = computed(
  () => props.turnsRemaining != null && props.turnsRemaining > 0,
);
</script>

<template>
  <div
    :class="containerClass"
    :data-testid="props.testId"
    :data-warning-type="props.warningType"
    :data-severity="props.severity"
    :data-effect-key="effect.key"
    role="alert"
  >
    <p class="text-sm font-semibold flex items-center gap-2">
      <span class="uppercase tracking-wide text-xs opacity-80">{{ props.warningType }}</span>
      <span>{{ props.bossName }}</span>
    </p>
    <p v-if="props.message" class="text-sm">{{ props.message }}</p>
    <p v-if="showCountdown" class="text-xs opacity-80 tabular-nums">
      {{ props.turnsRemaining }} turn(s)
    </p>
    <p
      v-if="props.hpPercent != null"
      class="text-xs opacity-80 tabular-nums"
      data-testid="boss-warning-hp"
    >
      HP {{ Math.round(props.hpPercent * 100) }}%
    </p>
  </div>
</template>
