<script setup lang="ts">
/**
 * Cửu Thiên Mộng — Parallax background.
 *
 * Multi-layer parallax wrapper rendered behind the main scene art. Provides
 * depth via 3 slowly drifting cloud/mist bands plus a swarm of qi motes.
 *
 * Mounted in AppShell once and shared across views. Respects `reduced-motion`
 * by falling back to a static composition (still rendered, just no animation).
 */
import { computed, onMounted, onBeforeUnmount, ref } from 'vue';

withDefaults(
  defineProps<{
    /**
     * `tone` adjusts layer hue tint per route group so each scene feels
     * distinct without swapping textures.
     */
    tone?: 'default' | 'cultivation' | 'boss' | 'secret' | 'sect' | 'market';
  }>(),
  { tone: 'default' },
);

const prefersReducedMotion = ref(false);

let mq: MediaQueryList | null = null;
function syncReducedMotion(): void {
  prefersReducedMotion.value = mq?.matches ?? false;
}

onMounted(() => {
  if (typeof window === 'undefined') return;
  mq = window.matchMedia('(prefers-reduced-motion: reduce)');
  prefersReducedMotion.value = mq.matches;
  mq.addEventListener('change', syncReducedMotion);
});

onBeforeUnmount(() => {
  mq?.removeEventListener('change', syncReducedMotion);
});

const animate = computed(() => !prefersReducedMotion.value);
</script>

<template>
  <div
    class="xt-parallax pointer-events-none fixed inset-0 -z-10 overflow-hidden"
    :data-tone="tone"
    :data-animate="animate ? 'on' : 'off'"
    aria-hidden="true"
    data-testid="xt-parallax-bg"
  >
    <div class="xt-parallax-layer xt-parallax-layer--far" />
    <div class="xt-parallax-layer xt-parallax-layer--mid" />
    <div class="xt-parallax-layer xt-parallax-layer--near" />
  </div>
</template>
