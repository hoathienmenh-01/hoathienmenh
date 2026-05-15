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
      return 'border-[var(--xt-border-mist)] bg-[var(--xt-mist-soft)] text-[var(--xt-text-mist)]';
    case 'WARNING':
      return 'border-[var(--xt-border-gold)] bg-[var(--xt-gold-soft)] text-[var(--xt-text-gold)]';
    case 'DANGER':
      return 'border-[var(--xt-border-seal)] bg-[var(--xt-ink-deep)]/70 text-[var(--xt-text-seal)]';
    case 'FATAL':
      return 'border-[var(--xt-seal-bright)] bg-[var(--xt-ink-abyss)]/80 text-[var(--xt-seal-bright)]';
  }
  return '';
});

const showMucRoi = computed(
  () =>
    !props.reducedMotion &&
    props.visualEffectLevel !== 'OFF' &&
    props.severity === 'FATAL',
);

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

    <!-- Mực rơi (ink curtain) overlay — chỉ render khi FATAL + có effect level. -->
    <Teleport to="body">
      <div
        v-if="showMucRoi"
        class="fixed inset-0 z-[9998] pointer-events-none overflow-hidden"
        data-testid="boss-muc-roi"
        aria-hidden="true"
      >
        <div
          class="absolute inset-x-0 -top-1/3 h-[160%] ve-anim-muc-roi-curtain"
          style="
            background:
              linear-gradient(180deg, rgba(7, 9, 14, 0.96) 0%, rgba(11, 16, 24, 0.85) 50%, transparent 100%),
              radial-gradient(ellipse at 50% 30%, rgba(208, 79, 79, 0.42) 0%, transparent 60%);
          "
        />
        <div
          class="absolute left-1/2 top-1/3 -translate-x-1/2 -translate-y-1/2 h-72 w-72 rounded-full ve-anim-muc-roi-splash"
          style="background: radial-gradient(circle, rgba(208, 79, 79, 0.78) 0%, rgba(208, 79, 79, 0) 65%)"
        />
      </div>
    </Teleport>
  </div>
</template>
