<script setup lang="ts">
import { useToastStore } from '@/stores/toast';
import { storeToRefs } from 'pinia';

const store = useToastStore();
const { toasts } = storeToRefs(store);

function toneOf(type: string): 'success' | 'error' | 'info' | 'warning' {
  if (type === 'error' || type === 'warning' || type === 'success' || type === 'info') {
    return type;
  }
  return 'info';
}

function glyphOf(type: string): string {
  const t = toneOf(type);
  if (t === 'success') return '✦';
  if (t === 'error') return '✸';
  if (t === 'warning') return '⚑';
  return '❀';
}
</script>

<template>
  <div class="fixed top-4 right-4 z-50 flex flex-col gap-2 max-w-sm">
    <div
      v-for="t in toasts"
      :key="t.id"
      :class="['xt-toast', `xt-toast--${toneOf(t.type)}`]"
      role="status"
      :aria-live="toneOf(t.type) === 'error' ? 'assertive' : 'polite'"
      @click="store.remove(t.id)"
    >
      <span class="xt-toast__glyph" aria-hidden="true">{{ glyphOf(t.type) }}</span>
      <div class="xt-toast__body">
        <div v-if="t.title" class="xt-toast__title">{{ t.title }}</div>
        <div class="xt-toast__text">{{ t.text }}</div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.xt-toast {
  position: relative;
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 10px 14px 10px 12px;
  border-radius: 14px;
  border: 1px solid var(--xt-toast-border, rgba(242, 215, 137, 0.45));
  background:
    radial-gradient(
      120% 80% at 0% 0%,
      var(--xt-toast-glow, rgba(242, 215, 137, 0.18)) 0%,
      transparent 60%
    ),
    linear-gradient(180deg, rgba(20, 28, 38, 0.85) 0%, rgba(14, 19, 24, 0.94) 100%);
  color: var(--xt-text-primary, #ece6d2);
  font-size: 13px;
  line-height: 1.4;
  cursor: pointer;
  box-shadow:
    0 8px 28px rgba(0, 0, 0, 0.55),
    inset 0 0 0 1px rgba(242, 215, 137, 0.08);
  transition: opacity 220ms ease, transform 220ms ease;
}
.xt-toast__glyph {
  flex: 0 0 auto;
  font-family: var(--xt-font-decorative), serif;
  font-size: 18px;
  line-height: 1;
  margin-top: 2px;
  color: var(--xt-toast-glyph, rgba(242, 215, 137, 0.78));
  text-shadow: 0 0 8px var(--xt-toast-glow, rgba(242, 215, 137, 0.4));
}
.xt-toast__body {
  min-width: 0;
}
.xt-toast__title {
  font-weight: 600;
  font-family: var(--xt-font-display), serif;
  letter-spacing: 0.02em;
  margin-bottom: 2px;
}
.xt-toast__text {
  color: var(--xt-text-muted, #b9b1a2);
}

.xt-toast--success {
  --xt-toast-border: rgba(95, 227, 198, 0.55);
  --xt-toast-glow: rgba(95, 227, 198, 0.18);
  --xt-toast-glyph: rgba(95, 227, 198, 0.8);
}
.xt-toast--error {
  --xt-toast-border: rgba(208, 79, 79, 0.6);
  --xt-toast-glow: rgba(208, 79, 79, 0.18);
  --xt-toast-glyph: rgba(248, 174, 174, 0.92);
}
.xt-toast--warning {
  --xt-toast-border: rgba(242, 174, 80, 0.55);
  --xt-toast-glow: rgba(242, 174, 80, 0.18);
  --xt-toast-glyph: rgba(252, 213, 122, 0.92);
}
.xt-toast--info {
  --xt-toast-border: rgba(242, 215, 137, 0.45);
  --xt-toast-glow: rgba(242, 215, 137, 0.16);
  --xt-toast-glyph: rgba(242, 215, 137, 0.85);
}

@media (prefers-reduced-motion: reduce) {
  .xt-toast {
    transition: none;
  }
}
</style>
