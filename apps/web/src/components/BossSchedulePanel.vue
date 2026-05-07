<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import {
  getLiveOpsToday,
  type BossScheduleViewModel,
  type LiveOpsTodayResponse,
} from '@/api/liveops';

/**
 * Phase 13.0 §E BossView schedule panel — section "Lịch Boss hôm nay" trên
 * BossView. Hiển thị giờ + boss name + region + status badge cho 3 daily
 * boss + Huyết Nguyệt nếu Sat. Reuse `/liveops/today` API client (cache nhẹ
 * 60s nội bộ component — refresh tick để countdown sync).
 *
 * KHÔNG phá BossView active boss UI hiện có (panel đứng riêng trên đầu).
 * API error → ẩn panel (không crash). Empty (Mon-Fri ngoài 3 daily slot
 * + không Sat) → vẫn render 3 daily slot status `completed`.
 */
const { t } = useI18n();

const data = ref<LiveOpsTodayResponse | null>(null);
const loading = ref(false);
let timer: ReturnType<typeof setInterval> | null = null;

async function load(): Promise<void> {
  loading.value = true;
  try {
    data.value = await getLiveOpsToday();
  } finally {
    loading.value = false;
  }
}

onMounted(() => {
  load();
  timer = setInterval(load, 60_000);
});

onBeforeUnmount(() => {
  if (timer) clearInterval(timer);
});

const bossSchedule = computed<BossScheduleViewModel[]>(() => {
  if (!data.value) return [];
  return data.value.bossSchedule;
});

const DEFAULT_DISPLAY_TZ = 'Asia/Ho_Chi_Minh';
const displayTz = computed(() => data.value?.timezone ?? DEFAULT_DISPLAY_TZ);

/**
 * Format slot time in API-supplied timezone (defaults to Asia/Ho_Chi_Minh).
 * Slot ISO timestamps đến từ catalog đã đặt theo Asia/Ho_Chi_Minh; render theo
 * browser TZ sẽ sai cho user ngoài ICT. Hardcode tz để consistent giữa region.
 */
function localTime(iso: string): string {
  try {
    return new Intl.DateTimeFormat('en-GB', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
      timeZone: displayTz.value,
    }).format(new Date(iso));
  } catch {
    const d = new Date(iso);
    const h = d.getHours().toString().padStart(2, '0');
    const m = d.getMinutes().toString().padStart(2, '0');
    return `${h}:${m}`;
  }
}

function statusLabel(status: BossScheduleViewModel['status']): string {
  return t(`liveopsToday.bossStatus.${status}`);
}

function statusClass(status: BossScheduleViewModel['status']): string {
  if (status === 'active') return 'border-emerald-500/60 bg-emerald-500/10 text-emerald-200';
  if (status === 'upcoming') return 'border-amber-500/50 bg-amber-500/10 text-amber-200';
  return 'border-ink-300/40 bg-ink-700/30 text-ink-300';
}

function eventTitle(slot: BossScheduleViewModel): string {
  return t(`liveops.event.${slot.key}.title`, slot.key);
}

function bossDisplay(slot: BossScheduleViewModel): string {
  return t(`liveops.boss.${slot.bossKey}`, slot.bossKey);
}

function regionDisplay(slot: BossScheduleViewModel): string {
  return t(`liveops.region.${slot.regionKey}`, slot.regionKey);
}

function countdown(secs: number): string {
  if (secs <= 0) return '';
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}
</script>

<template>
  <section
    v-if="bossSchedule.length > 0 || loading"
    data-testid="boss-schedule-panel"
    class="rounded border border-ink-300/40 bg-ink-700/30 p-4 mb-4"
  >
    <h3 class="text-sm tracking-widest text-ink-300 uppercase mb-3">
      {{ t('liveopsToday.bossScheduleTitle') }}
    </h3>
    <p
      v-if="loading && bossSchedule.length === 0"
      data-testid="boss-schedule-loading"
      class="text-xs text-ink-300"
    >
      {{ t('liveopsToday.loading') }}
    </p>
    <ul v-else class="grid gap-2 sm:grid-cols-2">
      <li
        v-for="slot in bossSchedule"
        :key="slot.key"
        :data-testid="`boss-schedule-item-${slot.key}`"
        class="flex items-center justify-between gap-3 rounded border px-3 py-2 text-xs"
        :class="statusClass(slot.status)"
      >
        <div class="flex flex-col gap-0.5">
          <div class="flex items-center gap-2">
            <span class="font-mono text-sm">{{ localTime(slot.slotStartIso) }}</span>
            <span class="font-medium">{{ eventTitle(slot) }}</span>
          </div>
          <div class="text-[10px] text-ink-400">
            {{ bossDisplay(slot) }} · {{ regionDisplay(slot) }}
          </div>
          <div
            v-if="slot.status === 'upcoming' && slot.secondsUntilStart > 0"
            class="text-[10px] text-amber-300"
          >
            {{ t('liveopsToday.startIn', { time: countdown(slot.secondsUntilStart) }) }}
          </div>
        </div>
        <span class="shrink-0 text-[10px] uppercase tracking-widest">
          {{ statusLabel(slot.status) }}
        </span>
      </li>
    </ul>
  </section>
</template>
