<script setup lang="ts">
defineProps<{
  label: string;
}>();
</script>

<template>
  <span
    class="inline-flex items-center rounded-full border border-violet-200/25 bg-violet-300/10 px-3 py-1 text-xs font-semibold text-violet-100 shadow-[0_0_18px_rgba(167,139,250,0.18)]"
    data-testid="realm-badge"
  >
    {{ label }}
  </span>
</template>
