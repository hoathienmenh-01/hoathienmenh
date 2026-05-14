<script setup lang="ts">
import { useRouter } from 'vue-router';
import GameIcon from './GameIcon.vue';

const props = withDefaults(
  defineProps<{
    fallback?: string;
    label?: string;
  }>(),
  {
    fallback: '/home',
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
    class="inline-flex min-h-10 items-center gap-2 rounded-2xl border border-cyan-200/20 bg-slate-950/45 px-3 py-2 text-sm text-cyan-50 transition hover:-translate-y-0.5 hover:border-cyan-200/45 hover:bg-cyan-300/10 focus:outline-none focus:ring-2 focus:ring-cyan-300/60"
    data-testid="xianxia-back-button"
    @click="goBack"
  >
    <GameIcon name="back" size="sm" />
    {{ label }}
  </button>
</template>
