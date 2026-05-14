<script setup lang="ts">
withDefaults(
  defineProps<{
    accent?: 'jade' | 'cyan' | 'violet' | 'gold' | 'danger';
    elevated?: boolean;
  }>(),
  {
    accent: 'cyan',
    elevated: true,
  },
);
</script>

<template>
  <section
    class="xt-card rounded-3xl border p-4 text-slate-100"
    :class="[`xt-card--${accent}`, elevated ? 'xt-card--elevated' : '']"
  >
    <slot />
  </section>
</template>
