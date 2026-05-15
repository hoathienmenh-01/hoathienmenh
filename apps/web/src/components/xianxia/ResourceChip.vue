<script setup lang="ts">
import GameIcon from './GameIcon.vue';

withDefaults(
  defineProps<{
    icon: string;
    label: string;
    value: string | number;
    tone?: 'jade' | 'cyan' | 'violet' | 'gold';
  }>(),
  {
    tone: 'cyan',
  },
);
</script>

<template>
  <div
    class="xt-resource-chip inline-flex shrink-0 items-center gap-2 rounded-2xl border px-3 py-2 text-xs"
    :class="`resource-chip--${tone}`"
    data-testid="resource-chip"
  >
    <GameIcon :name="icon" size="sm" />
    <span class="xt-resource-chip__label">{{ label }}</span>
    <span class="xt-resource-chip__value">{{ value }}</span>
  </div>
</template>

<style scoped>
.xt-resource-chip {
  background: rgba(14, 19, 24, 0.62);
  backdrop-filter: blur(8px);
  box-shadow:
    inset 0 1px 0 rgba(255, 246, 224, 0.06),
    0 4px 12px rgba(0, 0, 0, 0.42);
  transition: all var(--xt-motion-fast, 140ms) ease;
}

.xt-resource-chip:hover {
  transform: translateY(-1px);
  box-shadow:
    inset 0 1px 0 rgba(255, 246, 224, 0.12),
    0 6px 16px rgba(0, 0, 0, 0.5);
}

.xt-resource-chip__label {
  color: var(--xt-text-muted);
}

.xt-resource-chip__value {
  font-weight: 700;
  color: var(--xt-scroll-paper-bright);
  font-family: var(--xt-font-display);
}
</style>
