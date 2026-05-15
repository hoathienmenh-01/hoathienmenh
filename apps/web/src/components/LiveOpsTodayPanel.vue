<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { useI18n } from 'vue-i18n';
import {
  getLiveOpsToday,
  type BossScheduleViewModel,
  type LiveOpsTodayResponse,
  type SuggestedActivity,
} from '@/api/liveops';

/**
 * Phase 13.0 §D Today Activity Panel — retention hub: hiển thị
 *   - Hoạt động gợi ý (suggestedActivities — 1-3 CTA: boss active, event,
 *     boss upcoming).
 *   - Sự kiện đang mở (activeEvents non-boss).
 *   - Lịch boss hôm nay (3 daily + Huyết Nguyệt nếu Sat).
 *
 * API error / empty → render placeholder text, KHÔNG crash. Auto refresh
 * mỗi 60s để countdown sync (nhẹ — payload < 5KB).
 */
const { t } = useI18n();
const router = useRouter();

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

function formatCountdown(secs: number | undefined): string {
  if (secs === undefined || secs <= 0) return '';
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

const DEFAULT_DISPLAY_TZ = 'Asia/Ho_Chi_Minh';
const displayTz = computed(() => data.value?.timezone ?? DEFAULT_DISPLAY_TZ);

const activeEventsNonBoss = computed(() => {
  if (!data.value) return [];
  return data.value.activeEvents.filter((ev) => ev.type !== 'BOSS');
});

const suggested = computed<SuggestedActivity[]>(() => {
  if (!data.value) return [];
  return data.value.suggestedActivities;
});

const bossSchedule = computed<BossScheduleViewModel[]>(() => {
  if (!data.value) return [];
  return data.value.bossSchedule;
});

function statusLabel(status: BossScheduleViewModel['status']): string {
  return t(`liveopsToday.bossStatus.${status}`);
}

function statusClass(status: BossScheduleViewModel['status']): string {
  if (status === 'active') return 'border-emerald-500/60 bg-[var(--xt-jade-soft)] text-emerald-200';
  if (status === 'upcoming') return 'border-amber-500/50 bg-amber-500/10 text-amber-200';
  return 'border-ink-300/40 bg-ink-700/30 text-ink-300';
}

/**
 * Format slot time in API-supplied timezone (defaults to Asia/Ho_Chi_Minh).
 *
 * Slot ISO timestamps đến từ catalog đã đặt theo Asia/Ho_Chi_Minh; nếu render
 * theo browser TZ (vd UTC) thì user sẽ thấy "boss trưa" lúc 05:00 — sai.
 * Hardcode tz từ API response để slot time consistent giữa các region.
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
    // Fallback (Intl không support tz) — render theo browser TZ tốt hơn crash.
    const d = new Date(iso);
    const h = d.getHours().toString().padStart(2, '0');
    const m = d.getMinutes().toString().padStart(2, '0');
    return `${h}:${m}`;
  }
}

function suggestionLabel(s: SuggestedActivity): string {
  // Catalog event titleI18nKey vd `liveops.event.boss_daily_noon_hoa_diem_son.title`.
  // Vue-i18n không có key → fallback hiển thị key (debugging hint).
  return t(s.titleI18nKey, s.titleI18nKey);
}

function gotoSuggested(s: SuggestedActivity): void {
  // Per-suggestion button chỉ render cho kind='boss' (template v-if).
  // Defensive: vẫn check để không route sai khi caller mở rộng.
  if (s.kind === 'boss') {
    router.push({ name: 'boss' });
  }
}

function gotoBoss(): void {
  router.push({ name: 'boss' });
}

function gotoDungeon(): void {
  router.push({ name: 'dungeon' });
}

function gotoMission(): void {
  router.push({ name: 'missions' });
}

function gotoSectWar(): void {
  router.push({ name: 'sect-war' });
}
</script>

<template>
  <section
    data-testid="liveops-today-panel"
    class="rounded border border-ink-300/40 bg-ink-700/30 p-4 space-y-3"
  >
    <h3 class="text-sm tracking-widest text-ink-300 uppercase">
      {{ t('liveopsToday.title') }}
    </h3>

    <p
      v-if="loading && !data"
      data-testid="liveops-loading"
      class="text-xs text-ink-300"
    >
      {{ t('liveopsToday.loading') }}
    </p>

    <p
      v-else-if="!loading && !data"
      data-testid="liveops-error"
      class="text-xs text-ink-300"
    >
      {{ t('liveopsToday.error') }}
    </p>

    <template v-else-if="data">
      <!-- Suggested CTA strip -->
      <ul
        v-if="suggested.length > 0"
        data-testid="liveops-suggestions"
        class="space-y-2"
      >
        <li
          v-for="s in suggested"
          :key="s.key"
          class="flex items-center justify-between gap-3 rounded border px-3 py-2 text-sm"
          :class="
            s.kind === 'boss'
              ? 'border-rose-500/60 bg-rose-500/10'
              : 'border-amber-500/50 bg-amber-500/10'
          "
        >
          <span class="flex-1 flex flex-col gap-0.5">
            <span>
              <span class="font-medium">{{ suggestionLabel(s) }}</span>
              <span
                v-if="s.secondsUntilStart && s.secondsUntilStart > 0"
                class="ml-2 text-xs text-ink-300"
              >
                · {{ t('liveopsToday.startIn', { time: formatCountdown(s.secondsUntilStart) }) }}
              </span>
            </span>
            <span
              v-if="s.rewardHintI18nKey"
              :data-testid="`liveops-suggestion-reward-${s.key}`"
              class="text-[11px] text-ink-300"
            >
              {{ t('liveopsToday.rewardHintLabel') }}: {{ t(s.rewardHintI18nKey, s.rewardHintI18nKey) }}
            </span>
          </span>
          <button
            v-if="s.kind === 'boss'"
            type="button"
            class="shrink-0 rounded border border-ink-300/40 px-3 py-1 text-xs uppercase tracking-widest hover:bg-ink-300/10"
            @click="gotoSuggested(s)"
          >
            {{ t('liveopsToday.cta.goBoss') }}
          </button>
        </li>
      </ul>

      <p
        v-else
        data-testid="liveops-no-suggestion"
        class="text-xs text-ink-300"
      >
        {{ t('liveopsToday.noSuggestion') }}
      </p>

      <!-- Active non-boss events -->
      <div
        v-if="activeEventsNonBoss.length > 0"
        data-testid="liveops-active-events"
      >
        <h4 class="text-xs tracking-widest text-ink-300 uppercase mb-2">
          {{ t('liveopsToday.activeEventsTitle') }}
        </h4>
        <ul class="space-y-1">
          <li
            v-for="ev in activeEventsNonBoss"
            :key="ev.key"
            class="text-sm text-ink-100 flex flex-col gap-0.5"
          >
            <span>• {{ t(ev.titleI18nKey, ev.titleI18nKey) }}</span>
            <span
              v-if="ev.rewardHintI18nKey"
              :data-testid="`liveops-active-event-reward-${ev.key}`"
              class="ml-3 text-[11px] text-ink-300"
            >
              {{ t('liveopsToday.rewardHintLabel') }}: {{ t(ev.rewardHintI18nKey, ev.rewardHintI18nKey) }}
            </span>
          </li>
        </ul>
      </div>

      <!-- Boss schedule today -->
      <div
        v-if="bossSchedule.length > 0"
        data-testid="liveops-boss-schedule"
      >
        <h4 class="text-xs tracking-widest text-ink-300 uppercase mb-2">
          {{ t('liveopsToday.bossScheduleTitle') }}
        </h4>
        <ul class="space-y-2">
          <li
            v-for="slot in bossSchedule"
            :key="slot.key"
            class="flex items-center justify-between gap-3 rounded border px-3 py-2 text-xs"
            :class="statusClass(slot.status)"
          >
            <span class="flex flex-col gap-0.5">
              <span>
                <span class="font-mono">{{ localTime(slot.slotStartIso) }}</span>
                <span class="ml-2">{{ t(`liveops.event.${slot.key}.title`, slot.key) }}</span>
              </span>
              <span class="text-[10px] text-ink-400">
                {{ t(`liveops.boss.${slot.bossKey}`, slot.bossKey) }}
                · {{ t(`liveops.region.${slot.regionKey}`, slot.regionKey) }}
              </span>
              <span
                v-if="slot.rewardHintI18nKey"
                :data-testid="`liveops-schedule-reward-${slot.key}`"
                class="text-[10px] text-ink-300"
              >
                {{ t('liveopsToday.rewardHintLabel') }}: {{ t(slot.rewardHintI18nKey, slot.rewardHintI18nKey) }}
              </span>
            </span>
            <span class="shrink-0 text-[10px] uppercase tracking-widest">
              {{ statusLabel(slot.status) }}
            </span>
          </li>
        </ul>
      </div>

      <!-- Generic CTA fallback -->
      <div class="flex flex-wrap gap-2 pt-1">
        <button
          type="button"
          class="rounded border border-ink-300/40 px-3 py-1 text-xs uppercase tracking-widest hover:bg-ink-300/10"
          @click="gotoBoss"
        >
          {{ t('liveopsToday.cta.goBoss') }}
        </button>
        <button
          type="button"
          class="rounded border border-ink-300/40 px-3 py-1 text-xs uppercase tracking-widest hover:bg-ink-300/10"
          @click="gotoDungeon"
        >
          {{ t('liveopsToday.cta.goDungeon') }}
        </button>
        <button
          type="button"
          class="rounded border border-ink-300/40 px-3 py-1 text-xs uppercase tracking-widest hover:bg-ink-300/10"
          @click="gotoMission"
        >
          {{ t('liveopsToday.cta.goMission') }}
        </button>
        <button
          type="button"
          data-testid="liveops-cta-sect-war"
          class="rounded border border-amber-300/40 px-3 py-1 text-xs uppercase tracking-widest text-amber-200 hover:bg-amber-300/10"
          @click="gotoSectWar"
        >
          {{ t('liveopsToday.cta.goSectWar') }}
        </button>
      </div>
    </template>
  </section>
</template>
