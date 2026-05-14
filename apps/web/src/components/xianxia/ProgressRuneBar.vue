<script setup lang="ts">
const props = withDefaults(
  defineProps<{
    value: number;
    label: string;
  }>(),
  {
    value: 0,
  },
);

function clamp(v: number): number {
  return Math.min(Math.max(v, 0), 100);
}
</script>

<template>
  <div class="space-y-1" data-testid="progress-rune-bar">
    <div class="flex items-center justify-between text-xs text-slate-300">
      <span>{{ label }}</span>
      <span>{{ clamp(props.value) }}%</span>
    </div>
    <div class="h-3 overflow-hidden rounded-full border border-cyan-200/15 bg-slate-950/70">
      <div
        class="h-full rounded-full bg-gradient-to-r from-emerald-300 via-cyan-300 to-violet-300 shadow-[0_0_18px_rgba(34,211,238,0.35)] transition-all"
        :style="{ width: `${clamp(props.value)}%` }"
      />
    </div>
  </div>
</template>
