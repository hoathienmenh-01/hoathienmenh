<script setup lang="ts">
import { useRouter } from 'vue-router';
import GameIcon from './GameIcon.vue';

const props = withDefaults(
  defineProps<{
    fallback?: string;
    label?: string;
  }>(),
  {
    fallback: '/dashboard',
    label: 'Quay lại',
  },
);

const router = useRouter();

function goBack(): void {
  if (typeof window !== 'undefined' && window.history.length > 1) {
    router.back();
    return;
  }
  void router.push(props.fallback);
}
</script>

<template>
  <button
    type="button"
    class="xt-back-button inline-flex min-h-10 items-center gap-2 rounded-2xl border px-3 py-2 text-sm font-semibold transition focus:outline-none focus:ring-2 focus:ring-[rgba(95,227,198,0.55)]"
    data-testid="xianxia-back-button"
    @click="goBack"
  >
    <GameIcon name="back" size="sm" />
    {{ label }}
  </button>
</template>

<style scoped>
.xt-back-button {
  border-color: var(--xt-border-jade);
  background: rgba(20, 28, 38, 0.62);
  color: var(--xt-text-primary);
  backdrop-filter: blur(8px);
}
.xt-back-button:hover {
  transform: translateY(-1px);
  border-color: rgba(242, 215, 137, 0.6);
  background: rgba(28, 22, 12, 0.7);
  color: var(--xt-gold-bright);
}
</style>
