<script setup lang="ts">
import GameIcon from './GameIcon.vue';

export interface XianxiaQuickAction {
  key: string;
  title: string;
  description: string;
  route: string;
  icon: string;
  tone: 'jade' | 'cyan' | 'violet' | 'gold' | 'danger';
}

defineProps<{
  actions: XianxiaQuickAction[];
}>();

const emit = defineEmits<{
  (e: 'navigate', route: string): void;
}>();
</script>

<template>
  <section data-testid="dashboard-quicklinks" class="space-y-3">
    <div>
      <h2 class="text-lg font-bold text-slate-50">Lối tắt tu hành</h2>
      <p class="text-xs text-slate-400">Mỗi thẻ đều dẫn tới chức năng thật hoặc trang fallback an toàn.</p>
    </div>
    <div class="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <button
        v-for="action in actions"
        :key="action.key"
        type="button"
        class="xt-card group rounded-3xl border p-4 text-left transition hover:-translate-y-1 focus:outline-none focus:ring-2 focus:ring-cyan-300/60"
        :class="`xt-card--${action.tone}`"
        @click="emit('navigate', action.route)"
      >
        <div class="mb-4 flex items-center justify-between gap-3">
          <GameIcon :name="action.icon" />
          <span class="text-xs text-cyan-100 opacity-0 transition group-hover:opacity-100">Mở →</span>
        </div>
        <p class="font-bold text-slate-50">{{ action.title }}</p>
        <p class="mt-1 text-xs text-slate-400">{{ action.description }}</p>
      </button>
    </div>
  </section>
</template>
