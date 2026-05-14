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
        <h2 class="text-lg font-bold text-slate-50">Hôm nay nên làm</h2>
        <p class="text-xs text-slate-400">Giữ nhịp tu hành, bí cảnh và tông môn.</p>
      </div>
      <span class="rounded-full border border-cyan-200/20 bg-cyan-300/10 px-3 py-1 text-xs text-cyan-100">
        {{ items.filter((item) => item.done).length }}/{{ items.length }}
      </span>
    </div>
    <ul class="space-y-3">
      <li
        v-for="item in items"
        :key="item.key"
        class="flex items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.03] p-3"
        :data-testid="`checklist-${item.key}`"
      >
        <GameIcon :name="item.icon" size="sm" />
        <div class="min-w-0 flex-1">
          <p class="text-sm font-semibold text-slate-100">{{ item.title }}</p>
          <p class="truncate text-xs text-slate-400">
            {{ item.description }}
            <span v-if="item.progressText" class="text-amber-200">{{ item.progressText }}</span>
          </p>
        </div>
        <span
          class="h-2.5 w-2.5 rounded-full"
          :class="item.done ? 'bg-emerald-300' : 'bg-amber-300'"
          aria-hidden="true"
        />
        <button
          type="button"
          class="rounded-xl border border-cyan-200/20 px-3 py-2 text-xs text-cyan-50 transition hover:bg-cyan-300/10 focus:outline-none focus:ring-2 focus:ring-cyan-300/60"
          @click="emit('navigate', item.route)"
        >
          Đi tới
        </button>
      </li>
    </ul>
  </XianxiaCard>
</template>
