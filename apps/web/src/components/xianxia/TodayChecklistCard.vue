<script setup lang="ts">
import GameIcon from './GameIcon.vue';
import XianxiaCard from './XianxiaCard.vue';

export interface XianxiaChecklistItem {
  key: string;
  title: string;
  description: string;
  route: string;
  done: boolean;
  progressText?: string | null;
  icon: string;
}

defineProps<{
  items: XianxiaChecklistItem[];
}>();

const emit = defineEmits<{
  (e: 'navigate', route: string): void;
}>();
</script>

<template>
  <XianxiaCard accent="violet" data-testid="dashboard-checklist">
    <div class="mb-4 flex items-center justify-between gap-3">
      <div>
        <h2 class="text-lg font-bold text-[var(--xt-text-primary)]">Hôm nay nên làm</h2>
        <p class="text-xs text-[var(--xt-text-subtle)]">Giữ nhịp tu hành, bí cảnh và tông môn.</p>
      </div>
      <span class="rounded-full border border-[var(--xt-border-jade)] bg-[var(--xt-jade-soft)] px-3 py-1 text-xs font-semibold text-[var(--xt-text-primary)]">
        {{ items.filter((item) => item.done).length }}/{{ items.length }}
      </span>
    </div>
    <ul class="space-y-3">
      <li
        v-for="item in items"
        :key="item.key"
        class="flex items-center gap-3 rounded-2xl border border-[var(--xt-border-jade)] bg-[var(--xt-bg-surface)] p-3"
        :data-testid="`checklist-${item.key}`"
      >
        <GameIcon :name="item.icon" size="sm" />
        <div class="min-w-0 flex-1">
          <p class="text-sm font-semibold text-[var(--xt-text-primary)]">{{ item.title }}</p>
          <p class="truncate text-xs text-[var(--xt-text-muted)]">
            {{ item.description }}
            <span v-if="item.progressText" class="text-amber-700">{{ item.progressText }}</span>
          </p>
        </div>
        <span
          class="h-2.5 w-2.5 rounded-full"
          :class="item.done ? 'bg-[var(--xt-jade-bright)]' : 'bg-amber-400'"
          aria-hidden="true"
        />
        <button
          type="button"
          class="rounded-xl border border-[var(--xt-border-jade)] bg-white/60 px-3 py-2 text-xs font-semibold text-[var(--xt-text-primary)] transition hover:bg-[var(--xt-jade-soft)] focus:outline-none focus:ring-2 focus:ring-emerald-300/60"
          @click="emit('navigate', item.route)"
        >
          Đi tới
        </button>
      </li>
    </ul>
  </XianxiaCard>
</template>
