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
    class="inline-flex shrink-0 items-center gap-2 rounded-2xl border bg-slate-950/50 px-3 py-2 text-xs shadow-lg"
    :class="`resource-chip--${tone}`"
    data-testid="resource-chip"
  >
    <GameIcon :name="icon" size="sm" />
    <span class="text-slate-300">{{ label }}</span>
    <span class="font-bold text-slate-50">{{ value }}</span>
  </div>
</template>
