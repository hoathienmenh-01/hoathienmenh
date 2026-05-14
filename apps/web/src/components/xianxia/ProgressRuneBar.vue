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
    <div class="flex items-center justify-between text-xs font-semibold text-emerald-900/75">
      <span>{{ label }}</span>
      <span>{{ clamp(props.value) }}%</span>
    </div>
    <div class="h-3 overflow-hidden rounded-full border border-emerald-300/25 bg-emerald-50/80">
      <div
        class="h-full rounded-full bg-gradient-to-r from-emerald-300 via-teal-300 to-amber-300 shadow-[0_0_18px_rgba(74,169,143,0.35)] transition-all"
        :style="{ width: `${clamp(props.value)}%` }"
      />
    </div>
  </div>
</template>
