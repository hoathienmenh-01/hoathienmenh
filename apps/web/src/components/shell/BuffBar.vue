<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useBuffsStore } from '@/stores/buffs';
import type { ActiveBuffRow } from '@/api/buffs';

/**
 * Phase 11.8.D — HUD `BuffBar` hiển thị active buff/debuff cho character
 * hiện tại.
 *
 * - Gọi `buffs.fetchState()` ở mount + tick mỗi 1s update countdown.
 * - Khi 1 buff sắp hết hạn (expiresAt <= now), refetch để server prune +
 *   trả frame tươi.
 * - Render từng pill (icon polarity + name + stacks + countdown).
 * - Empty state ẩn (không render) — không chiếm chỗ trên header khi không
 *   có buff.
 */
const buffs = useBuffsStore();
const { t } = useI18n();

const now = ref(Date.now());
let timer: ReturnType<typeof setInterval> | null = null;

onMounted(async () => {
  try {
    await buffs.fetchState();
  } catch {
    // Silent — HUD non-critical, không phá main UI nếu BE tạm chết.
  }
  timer = setInterval(() => {
    now.value = Date.now();
    // Refetch nếu có buff đã expire client-side để server auto-prune + sync.
    const expired = buffs.active.some(
      (r) => Date.parse(r.expiresAt) <= now.value,
    );
    if (expired) {
      void buffs.fetchState().catch(() => null);
    }
  }, 1000);
});

onUnmounted(() => {
  if (timer !== null) {
    clearInterval(timer);
    timer = null;
  }
});

const visibleRows = computed<ActiveBuffRow[]>(() => {
  // Ẩn buff đã expire tạm thời cho tới khi refetch trả về danh sách mới.
  return buffs.active.filter((r) => Date.parse(r.expiresAt) > now.value);
});

function remainingSec(expiresAt: string): number {
  const ms = Date.parse(expiresAt) - now.value;
  return Math.max(0, Math.ceil(ms / 1000));
}

function formatRemaining(expiresAt: string): string {
  const sec = remainingSec(expiresAt);
  if (sec >= 3600) {
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    return `${h}h${m.toString().padStart(2, '0')}m`;
  }
  if (sec >= 60) {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${m}m${s.toString().padStart(2, '0')}s`;
  }
  return `${sec}s`;
}

function pillClass(row: ActiveBuffRow): string {
  return row.def.polarity === 'buff'
    ? 'bg-emerald-700/40 border-emerald-500/40 text-emerald-100'
    : 'bg-rose-700/40 border-rose-500/40 text-rose-100';
}

function polaritySymbol(row: ActiveBuffRow): string {
  return row.def.polarity === 'buff' ? '⊕' : '⊖';
}
</script>

<template>
  <div
    v-if="visibleRows.length > 0"
    class="flex items-center gap-1 flex-wrap"
    data-testid="buff-bar"
    :aria-label="t('buffs.bar.aria')"
  >
    <span
      v-for="row in visibleRows"
      :key="row.buffKey"
      :class="[
        'flex items-center gap-1 px-1.5 py-0.5 rounded border text-[10px]',
        pillClass(row),
      ]"
      :data-testid="`buff-pill-${row.buffKey}`"
      :title="row.def.description"
    >
      <span aria-hidden="true">{{ polaritySymbol(row) }}</span>
      <span class="font-semibold">{{ row.def.name }}</span>
      <span
        v-if="row.stacks > 1"
        :data-testid="`buff-stacks-${row.buffKey}`"
        class="opacity-80"
      >
        ×{{ row.stacks }}
      </span>
      <span
        class="tabular-nums opacity-90"
        :data-testid="`buff-remaining-${row.buffKey}`"
      >
        {{ formatRemaining(row.expiresAt) }}
      </span>
    </span>
  </div>
</template>
