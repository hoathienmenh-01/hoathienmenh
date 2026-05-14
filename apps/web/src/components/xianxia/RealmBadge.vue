<script setup lang="ts">
defineProps<{
  label: string;
}>();
</script>

<template>
  <span
    class="inline-flex items-center rounded-full border border-amber-300/40 bg-amber-100/60 px-3 py-1 text-xs font-semibold text-emerald-950 shadow-[0_0_18px_rgba(216,183,106,0.18)]"
    data-testid="realm-badge"
  >
    {{ label }}
  </span>
</template>
