<script setup lang="ts">
/**
 * Cửu Thiên Mộng — `MSkeleton` (Phase 5 loading primitive).
 *
 * Mở rộng `SkeletonBlock` thành 1 primitive đa năng: text-lines, avatar
 * tròn, tile bento (block lớn có viền), card preview. Có shimmer animation
 * gradient cuộn từ trái → phải; tắt qua `prefers-reduced-motion`.
 *
 * Variants:
 *   - `text`: nhiều dòng text, prop `lines` (default 1).
 *   - `block`: 1 block hình chữ nhật, dùng prop `height` (default `h-4`).
 *   - `tile`: bento tile placeholder (border, padding sẵn).
 *   - `circle`: avatar / icon placeholder (kích thước `size`).
 *   - `card`: 1 mini card với title + 2 dòng body + 1 actions placeholder.
 *
 * Implementation note: bọc trong 1 single root `<span>` (display:contents)
 * để vue-test-utils + Teleport callers thấy 1 host node nhất quán; class
 * thật apply lên child template — tránh fragment edge-cases.
 */
import { computed } from 'vue';

type Variant = 'text' | 'block' | 'tile' | 'circle' | 'card';

const props = withDefaults(
  defineProps<{
    variant?: Variant;
    /** `text` variant — number of lines. */
    lines?: number;
    /** `block` variant — Tailwind height class or raw CSS height. */
    height?: string;
    /** `block` variant — Tailwind width class. */
    width?: string;
    /** `block`/`tile`/`card` variant — rounded class. */
    rounded?: string;
    /** `circle` variant — raw pixel size (default 32). */
    size?: number;
    /** Override animation: shimmer (default) or pulse (legacy). */
    animation?: 'shimmer' | 'pulse' | 'none';
    /** Test id. */
    testId?: string;
  }>(),
  {
    variant: 'block',
    lines: 1,
    height: 'h-4',
    width: 'w-full',
    rounded: 'rounded',
    size: 32,
    animation: 'shimmer',
    testId: undefined,
  },
);

const rootTestId = computed(() => props.testId ?? `m-skeleton-${props.variant}`);

const animClass = computed(() => {
  if (props.animation === 'pulse') return 'm-skeleton--pulse';
  if (props.animation === 'none') return '';
  return 'm-skeleton--shimmer';
});

const circleStyle = computed(() => ({
  width: `${props.size}px`,
  height: `${props.size}px`,
}));

const blockClass = computed(() => [
  'm-skeleton',
  animClass.value,
  props.rounded,
  props.height,
  props.width,
]);

const tileClass = computed(() => [
  'm-skeleton',
  'm-skeleton__tile',
  animClass.value,
  props.rounded,
]);

const circleClass = computed(() => [
  'm-skeleton',
  'rounded-full',
  animClass.value,
]);

const textLineCount = computed(() => Math.max(1, props.lines));
</script>

<template>
  <div
    v-if="variant === 'text'"
    class="m-skeleton__text"
    :data-testid="rootTestId"
    aria-hidden="true"
  >
    <div
      v-for="i in textLineCount"
      :key="i"
      :class="[
        'm-skeleton',
        animClass,
        'rounded',
        i === textLineCount && textLineCount > 1 ? 'w-3/5' : 'w-full',
      ]"
      style="height: 12px"
    />
  </div>
  <div
    v-else-if="variant === 'circle'"
    :class="circleClass"
    :style="circleStyle"
    :data-testid="rootTestId"
    aria-hidden="true"
  />
  <div
    v-else-if="variant === 'tile'"
    :class="tileClass"
    :data-testid="rootTestId"
    aria-hidden="true"
  >
    <slot />
  </div>
  <div
    v-else-if="variant === 'card'"
    class="m-skeleton__card"
    :data-testid="rootTestId"
    aria-hidden="true"
  >
    <div :class="['m-skeleton', animClass, 'rounded']" style="height: 14px; width: 40%" />
    <div :class="['m-skeleton', animClass, 'rounded']" style="height: 10px; width: 90%" />
    <div :class="['m-skeleton', animClass, 'rounded']" style="height: 10px; width: 70%" />
    <div :class="['m-skeleton', animClass, 'rounded']" style="height: 28px; width: 35%" />
  </div>
  <div
    v-else
    :class="blockClass"
    :data-testid="rootTestId"
    aria-hidden="true"
  />
</template>

<style scoped>
.m-skeleton {
  position: relative;
  background: rgba(36, 46, 58, 0.55);
  overflow: hidden;
}
.m-skeleton--pulse {
  animation: m-skeleton-pulse 1.6s ease-in-out infinite;
}
.m-skeleton--shimmer::after {
  content: '';
  position: absolute;
  inset: 0;
  background: linear-gradient(
    90deg,
    transparent 0%,
    rgba(95, 227, 198, 0.12) 40%,
    rgba(242, 215, 137, 0.18) 50%,
    rgba(95, 227, 198, 0.12) 60%,
    transparent 100%
  );
  transform: translateX(-100%);
  animation: m-skeleton-shimmer 1.6s var(--xt-ease-soft, ease-in-out) infinite;
}

.m-skeleton__text {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.m-skeleton__tile {
  width: 100%;
  height: 120px;
  border: 1px solid rgba(95, 227, 198, 0.12);
}
.m-skeleton__card {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 16px;
  border-radius: var(--xt-radius-lg);
  border: 1px solid rgba(95, 227, 198, 0.12);
  background: rgba(20, 28, 38, 0.6);
}

@keyframes m-skeleton-pulse {
  0%, 100% { opacity: 0.55; }
  50% { opacity: 0.85; }
}
@keyframes m-skeleton-shimmer {
  0% { transform: translateX(-100%); }
  100% { transform: translateX(100%); }
}

@media (prefers-reduced-motion: reduce) {
  .m-skeleton--shimmer::after,
  .m-skeleton--pulse {
    animation: none;
  }
}
</style>
