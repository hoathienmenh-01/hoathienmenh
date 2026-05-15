<script setup lang="ts">
import GameIcon from './GameIcon.vue';

withDefaults(
  defineProps<{
    icon: string;
    label: string;
    value: string | number;
    description: string;
    tone?: 'jade' | 'cyan' | 'violet' | 'gold' | 'danger';
  }>(),
  {
    tone: 'cyan',
  },
);
</script>

<template>
  <div
    class="xt-card xt-card--elevated rounded-3xl border p-4"
    :class="`xt-card--${tone}`"
    data-testid="stat-card"
  >
    <div class="flex items-start justify-between gap-3">
      <div>
        <p class="xt-eyebrow !text-[10px]">{{ label }}</p>
        <p class="xt-heading-co mt-2 text-2xl">{{ value }}</p>
      </div>
      <GameIcon :name="icon" />
    </div>
    <p class="mt-3 text-xs text-[var(--xt-text-muted)]">{{ description }}</p>
  </div>
</template>
