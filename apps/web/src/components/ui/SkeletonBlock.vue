<script setup lang="ts">
/**
 * Skeleton loader cao cấp — block ink-toned với shimmer ánh vàng/jade/seal.
 *
 * Props:
 *  - height: chiều cao CSS (vd `h-4`, `h-12`); default `h-4`.
 *  - width: tailwind width class; default `w-full`.
 *  - rounded: bo góc; default `rounded`.
 *  - tone: 'gold' (default) | 'jade' | 'seal' | 'neutral'.
 *  - testId: optional cho test query.
 */
withDefaults(
  defineProps<{
    height?: string;
    width?: string;
    rounded?: string;
    tone?: 'gold' | 'jade' | 'seal' | 'neutral';
    testId?: string;
  }>(),
  {
    height: 'h-4',
    width: 'w-full',
    rounded: 'rounded',
    tone: 'gold',
    testId: undefined,
  },
);
</script>

<template>
  <div
    class="xt-skeleton bg-ink-700/40 animate-pulse"
    :class="[height, width, rounded, `xt-skeleton--${tone}`]"
    :data-testid="testId ?? 'skeleton-block'"
    aria-hidden="true"
  />
</template>

<style scoped>
.xt-skeleton {
  position: relative;
  overflow: hidden;
  isolation: isolate;
}
.xt-skeleton::after {
  content: '';
  position: absolute;
  inset: 0;
  background: linear-gradient(
    90deg,
    transparent 0%,
    var(--xt-skel-shimmer, rgba(242, 215, 137, 0.18)) 50%,
    transparent 100%
  );
  transform: translateX(-100%);
  animation: xt-skel-shimmer 1.8s ease-in-out infinite;
  z-index: 1;
}
.xt-skeleton--gold {
  --xt-skel-shimmer: rgba(242, 215, 137, 0.18);
}
.xt-skeleton--jade {
  --xt-skel-shimmer: rgba(95, 227, 198, 0.18);
}
.xt-skeleton--seal {
  --xt-skel-shimmer: rgba(208, 79, 79, 0.16);
}
.xt-skeleton--neutral {
  --xt-skel-shimmer: rgba(185, 214, 232, 0.14);
}
@keyframes xt-skel-shimmer {
  0% {
    transform: translateX(-100%);
  }
  60%,
  100% {
    transform: translateX(100%);
  }
}
@media (prefers-reduced-motion: reduce) {
  .xt-skeleton::after {
    animation: none;
    opacity: 0;
  }
}
</style>
