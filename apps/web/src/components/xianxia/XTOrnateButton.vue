<script setup lang="ts">
/**
 * Cửu Thiên Mộng — `XTOrnateButton` (UI-3.1 luxury button).
 *
 * Button cao cấp 4 variant: primary (gold), jade, seal (đỏ), ghost.
 * Mỗi variant có:
 *   - viền vàng kép + corner ornament nhỏ,
 *   - gradient fill,
 *   - shimmer sweep trên hover (CSS-only, disabled khi reduce-motion),
 *   - press inset shadow.
 *
 * Props:
 *   - `variant`: 'gold' (default) | 'jade' | 'seal' | 'ghost'.
 *   - `size`: 'sm' | 'md' (default) | 'lg'.
 *   - `to`: optional route, render `<RouterLink>` thay cho `<button>`.
 *   - `disabled`, `type`, `ariaLabel`, `testId`.
 *
 * Slot default: nội dung. Slot `icon` cho icon đầu (optional).
 */
import { RouterLink } from 'vue-router';

withDefaults(
  defineProps<{
    variant?: 'gold' | 'jade' | 'seal' | 'ghost';
    size?: 'sm' | 'md' | 'lg';
    to?: string | null;
    disabled?: boolean;
    type?: 'button' | 'submit' | 'reset';
    ariaLabel?: string;
    testId?: string;
  }>(),
  {
    variant: 'gold',
    size: 'md',
    to: null,
    disabled: false,
    type: 'button',
    ariaLabel: undefined,
    testId: 'xt-ornate-button',
  },
);

defineEmits<{ click: [event: MouseEvent] }>();
</script>

<template>
  <RouterLink
    v-if="to"
    :to="to"
    class="xt-ornate"
    :class="[`xt-ornate--${variant}`, `xt-ornate--${size}`]"
    :aria-label="ariaLabel"
    :data-testid="testId"
  >
    <span class="xt-ornate__shimmer" aria-hidden="true" />
    <span class="xt-ornate__corner xt-ornate__corner--tl" aria-hidden="true" />
    <span class="xt-ornate__corner xt-ornate__corner--tr" aria-hidden="true" />
    <span class="xt-ornate__corner xt-ornate__corner--bl" aria-hidden="true" />
    <span class="xt-ornate__corner xt-ornate__corner--br" aria-hidden="true" />
    <span v-if="$slots.icon" class="xt-ornate__icon">
      <slot name="icon" />
    </span>
    <span class="xt-ornate__label">
      <slot />
    </span>
  </RouterLink>
  <button
    v-else
    :type="type"
    class="xt-ornate"
    :class="[`xt-ornate--${variant}`, `xt-ornate--${size}`]"
    :disabled="disabled"
    :aria-label="ariaLabel"
    :data-testid="testId"
    @click="$emit('click', $event)"
  >
    <span class="xt-ornate__shimmer" aria-hidden="true" />
    <span class="xt-ornate__corner xt-ornate__corner--tl" aria-hidden="true" />
    <span class="xt-ornate__corner xt-ornate__corner--tr" aria-hidden="true" />
    <span class="xt-ornate__corner xt-ornate__corner--bl" aria-hidden="true" />
    <span class="xt-ornate__corner xt-ornate__corner--br" aria-hidden="true" />
    <span v-if="$slots.icon" class="xt-ornate__icon">
      <slot name="icon" />
    </span>
    <span class="xt-ornate__label">
      <slot />
    </span>
  </button>
</template>

<style scoped>
.xt-ornate {
  position: relative;
  isolation: isolate;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  border-radius: 14px;
  border: 1px solid var(--btn-border, rgba(242, 215, 137, 0.65));
  background: var(--btn-bg, linear-gradient(180deg, rgba(58, 46, 24, 0.92) 0%, rgba(28, 22, 12, 0.96) 100%));
  color: var(--btn-text, #fff6e0);
  font-family: var(--xt-font-display), serif;
  font-weight: 600;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  cursor: pointer;
  overflow: hidden;
  transition:
    transform var(--xt-motion-fast, 140ms) var(--xt-ease-soft, ease),
    box-shadow var(--xt-motion-base, 220ms) var(--xt-ease-soft, ease),
    background var(--xt-motion-base, 220ms) ease,
    border-color var(--xt-motion-base, 220ms) ease;
  text-decoration: none;
  box-shadow:
    inset 0 1px 0 rgba(255, 246, 224, 0.18),
    inset 0 -1px 0 rgba(0, 0, 0, 0.4),
    0 6px 14px rgba(0, 0, 0, 0.4);
}

.xt-ornate:focus-visible {
  outline: 2px solid var(--btn-focus, rgba(95, 227, 198, 0.6));
  outline-offset: 2px;
}

.xt-ornate:hover {
  transform: translateY(-1px);
  box-shadow:
    inset 0 1px 0 rgba(255, 246, 224, 0.22),
    inset 0 -1px 0 rgba(0, 0, 0, 0.42),
    0 10px 22px rgba(0, 0, 0, 0.48),
    0 0 24px var(--btn-glow, rgba(242, 215, 137, 0.32));
  border-color: var(--btn-border-hover, rgba(242, 215, 137, 0.85));
}

.xt-ornate:active {
  transform: translateY(0);
  box-shadow: var(--xt-shadow-press);
}

.xt-ornate[disabled],
.xt-ornate[aria-disabled='true'] {
  opacity: 0.55;
  cursor: not-allowed;
  transform: none;
  pointer-events: none;
}

/* Size variants */
.xt-ornate--sm {
  padding: 6px 14px;
  font-size: 11px;
  letter-spacing: 0.18em;
}
.xt-ornate--md {
  padding: 10px 20px;
  font-size: 13px;
}
.xt-ornate--lg {
  padding: 14px 28px;
  font-size: 15px;
  letter-spacing: 0.22em;
}

/* Shimmer sweep */
.xt-ornate__shimmer {
  position: absolute;
  inset: 0;
  z-index: 0;
  pointer-events: none;
  background: linear-gradient(
    115deg,
    transparent 0%,
    transparent 35%,
    rgba(255, 246, 224, 0.28) 50%,
    transparent 65%,
    transparent 100%
  );
  transform: translateX(-120%);
  transition: transform 1.1s var(--xt-ease-out, ease);
}
.xt-ornate:hover .xt-ornate__shimmer {
  transform: translateX(120%);
}

/* Corner ornaments — small notch in each corner. */
.xt-ornate__corner {
  position: absolute;
  z-index: 1;
  width: 8px;
  height: 8px;
  pointer-events: none;
}
.xt-ornate__corner--tl {
  top: 3px;
  left: 3px;
  border-top: 1px solid var(--btn-border, rgba(242, 215, 137, 0.65));
  border-left: 1px solid var(--btn-border, rgba(242, 215, 137, 0.65));
}
.xt-ornate__corner--tr {
  top: 3px;
  right: 3px;
  border-top: 1px solid var(--btn-border, rgba(242, 215, 137, 0.65));
  border-right: 1px solid var(--btn-border, rgba(242, 215, 137, 0.65));
}
.xt-ornate__corner--bl {
  bottom: 3px;
  left: 3px;
  border-bottom: 1px solid var(--btn-border, rgba(242, 215, 137, 0.65));
  border-left: 1px solid var(--btn-border, rgba(242, 215, 137, 0.65));
}
.xt-ornate__corner--br {
  bottom: 3px;
  right: 3px;
  border-bottom: 1px solid var(--btn-border, rgba(242, 215, 137, 0.65));
  border-right: 1px solid var(--btn-border, rgba(242, 215, 137, 0.65));
}

.xt-ornate__icon {
  position: relative;
  z-index: 1;
  display: inline-flex;
  align-items: center;
}

.xt-ornate__label {
  position: relative;
  z-index: 1;
}

/* Variants */
.xt-ornate--gold {
  --btn-border: rgba(242, 215, 137, 0.7);
  --btn-border-hover: rgba(242, 215, 137, 0.95);
  --btn-bg: linear-gradient(
    180deg,
    rgba(74, 59, 24, 0.95) 0%,
    rgba(35, 27, 12, 0.96) 100%
  );
  --btn-text: var(--xt-scroll-paper-bright, #fff6e0);
  --btn-glow: rgba(242, 215, 137, 0.4);
  --btn-focus: rgba(242, 215, 137, 0.6);
}

.xt-ornate--jade {
  --btn-border: rgba(95, 227, 198, 0.7);
  --btn-border-hover: rgba(95, 227, 198, 0.95);
  --btn-bg: linear-gradient(
    180deg,
    rgba(27, 59, 52, 0.95) 0%,
    rgba(12, 30, 26, 0.96) 100%
  );
  --btn-text: var(--xt-jade-bright, #5fe3c6);
  --btn-glow: rgba(95, 227, 198, 0.42);
  --btn-focus: rgba(95, 227, 198, 0.7);
}

.xt-ornate--seal {
  --btn-border: rgba(208, 79, 79, 0.75);
  --btn-border-hover: rgba(208, 79, 79, 1);
  --btn-bg: linear-gradient(
    180deg,
    rgba(90, 28, 28, 0.95) 0%,
    rgba(50, 14, 14, 0.96) 100%
  );
  --btn-text: var(--xt-scroll-paper-bright, #fff6e0);
  --btn-glow: rgba(208, 79, 79, 0.45);
  --btn-focus: rgba(208, 79, 79, 0.65);
}

.xt-ornate--ghost {
  --btn-border: rgba(242, 215, 137, 0.4);
  --btn-border-hover: rgba(242, 215, 137, 0.7);
  --btn-bg: linear-gradient(
    180deg,
    rgba(28, 36, 46, 0.65) 0%,
    rgba(14, 19, 24, 0.82) 100%
  );
  --btn-text: var(--xt-text-primary, #f0e6cc);
  --btn-glow: rgba(242, 215, 137, 0.22);
  --btn-focus: rgba(242, 215, 137, 0.5);
}

@media (prefers-reduced-motion: reduce) {
  .xt-ornate {
    transition: none;
  }
  .xt-ornate:hover {
    transform: none;
  }
  .xt-ornate__shimmer {
    display: none;
  }
}
</style>
