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
    class="xt-card rounded-3xl border p-4 transition hover:-translate-y-1"
    :class="`xt-card--${tone}`"
    data-testid="stat-card"
  >
    <div class="flex items-start justify-between gap-3">
      <div>
        <p class="text-xs uppercase tracking-[0.22em] text-emerald-900/60">{{ label }}</p>
        <p class="mt-2 text-2xl font-bold text-emerald-950">{{ value }}</p>
      </div>
      <GameIcon :name="icon" />
    </div>
    <p class="mt-3 text-xs text-emerald-900/65">{{ description }}</p>
  </div>
</template>
