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
      <h2 class="xt-heading-co text-lg">Lối tắt tu hành</h2>
      <p class="text-xs text-[var(--xt-text-muted)]">
        Mỗi thẻ đều dẫn tới chức năng thật hoặc trang fallback an toàn.
      </p>
    </div>
    <div class="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <button
        v-for="action in actions"
        :key="action.key"
        type="button"
        class="xt-card xt-card--elevated group rounded-3xl border p-4 text-left focus:outline-none focus:ring-2 focus:ring-[rgba(95,227,198,0.55)]"
        :class="`xt-card--${action.tone}`"
        @click="emit('navigate', action.route)"
      >
        <div class="mb-4 flex items-center justify-between gap-3">
          <GameIcon :name="action.icon" />
          <span class="text-xs font-semibold text-[var(--xt-jade-bright)] opacity-0 transition group-hover:opacity-100">
            Mở →
          </span>
        </div>
        <p class="font-bold text-[var(--xt-scroll-paper-bright)]">{{ action.title }}</p>
        <p class="mt-1 text-xs text-[var(--xt-text-muted)]">{{ action.description }}</p>
      </button>
    </div>
  </section>
</template>
