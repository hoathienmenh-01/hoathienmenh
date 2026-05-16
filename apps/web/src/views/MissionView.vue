<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRouter } from 'vue-router';
import { useAuthStore } from '@/stores/auth';
import { useGameStore } from '@/stores/game';
import { useToastStore } from '@/stores/toast';
import {
  claimMission,
  listMissions,
  type MissionPeriod,
  type MissionProgressView,
} from '@/api/mission';
import AppShell from '@/components/shell/AppShell.vue';
import XTPageEyebrow from '@/components/xianxia/XTPageEyebrow.vue';
import XTSealFrame from '@/components/xianxia/XTSealFrame.vue';
import MButton from '@/components/ui/MButton.vue';
import { extractApiErrorCodeOrDefault } from '@/lib/apiError';
import { formatItemRewardList } from '@/lib/itemName';
import { applyMissionProgressFrame } from '@/lib/missionProgress';
import { on as wsOn } from '@/ws/client';
import type { MissionProgressFramePayload, WsFrame } from '@xuantoi/shared';

const auth = useAuthStore();
const game = useGameStore();
const toast = useToastStore();
const router = useRouter();
const { t } = useI18n();

const tab = ref<MissionPeriod>('DAILY');
const missions = ref<MissionProgressView[]>([]);
const loading = ref(false);
const claiming = ref<string | null>(null);
const now = ref(Date.now());
let tickHandle: number | null = null;
let unsubMissionProgress: (() => void) | null = null;

onMounted(async () => {
  await auth.hydrate();
  if (!auth.isAuthenticated) {
    router.replace('/auth');
    return;
  }
  await game.fetchState().catch(() => null);
  game.bindSocket();
  await refresh();
  tickHandle = window.setInterval(() => {
    now.value = Date.now();
  }, 1000);
  // Realtime push từ server (PR #63 BE) — apply delta vào missions array
  // tránh phải refetch full list mỗi khi player tu luyện / đánh boss / chat.
  unsubMissionProgress = wsOn<MissionProgressFramePayload>(
    'mission:progress',
    (frame: WsFrame<MissionProgressFramePayload>) => {
      if (!frame.payload) return;
      missions.value = applyMissionProgressFrame(missions.value, frame.payload);
    },
  );
});

onUnmounted(() => {
  if (tickHandle !== null) {
    window.clearInterval(tickHandle);
    tickHandle = null;
  }
  unsubMissionProgress?.();
  unsubMissionProgress = null;
});

async function refresh(): Promise<void> {
  loading.value = true;
  try {
    missions.value = await listMissions();
  } catch (e) {
    handleErr(e);
  } finally {
    loading.value = false;
  }
}

async function onClaim(m: MissionProgressView): Promise<void> {
  if (claiming.value) return;
  claiming.value = m.key;
  try {
    const result = await claimMission(m.key);
    missions.value = result.missions;
    toast.push({ type: 'success', text: t('mission.claimToast', { name: m.name }) });
    // Phase 16.5 — Daily Reward Cap: nếu server bảo capped=true → toast nhẹ
    // báo người chơi biết. Optional chaining bảo đảm pre-16.5 server không
    // crash FE (claim undefined → skip).
    if (result.claim?.capped) {
      toast.push({
        type: 'info',
        text: t('mission.dailyCapReached', '__missing__') === '__missing__'
          ? 'Hôm nay bạn đã đạt giới hạn nhận thưởng nguồn này.'
          : t('mission.dailyCapReached'),
      });
    }
    await game.fetchState().catch(() => null);
  } catch (e) {
    handleErr(e);
  } finally {
    claiming.value = null;
  }
}

function handleErr(e: unknown): void {
  const code = extractApiErrorCodeOrDefault(e, 'UNKNOWN');
  const text = t(`mission.errors.${code}`, '__missing__');
  toast.push({
    type: 'error',
    text: text === '__missing__' ? t('mission.errors.UNKNOWN') : text,
  });
}

const filtered = computed(() =>
  missions.value
    .filter((m) => m.period === tab.value)
    .sort((a, b) => {
      // Sẵn sàng nhận trước, sau đó chưa xong, cuối cùng đã claim.
      const ra = a.claimed ? 2 : a.completable ? 0 : 1;
      const rb = b.claimed ? 2 : b.completable ? 0 : 1;
      if (ra !== rb) return ra - rb;
      return a.name.localeCompare(b.name);
    }),
);

const summary = computed(() => {
  const byPeriod = (p: MissionPeriod) => {
    const rows = missions.value.filter((m) => m.period === p);
    const done = rows.filter((m) => m.claimed).length;
    const ready = rows.filter((m) => m.completable).length;
    return { total: rows.length, done, ready };
  };
  return {
    DAILY: byPeriod('DAILY'),
    WEEKLY: byPeriod('WEEKLY'),
    ONCE: byPeriod('ONCE'),
  };
});

function progressPct(m: MissionProgressView): number {
  if (m.goalAmount <= 0) return 0;
  return Math.min(100, Math.round((m.currentAmount / m.goalAmount) * 100));
}

function formatCountdown(iso: string | null): string {
  if (!iso) return '';
  const end = new Date(iso).getTime();
  const diff = end - now.value;
  if (diff <= 0) return t('mission.resetImminent');
  const totalSec = Math.floor(diff / 1000);
  const days = Math.floor(totalSec / 86400);
  const hours = Math.floor((totalSec % 86400) / 3600);
  const mins = Math.floor((totalSec % 3600) / 60);
  const secs = totalSec % 60;
  if (days > 0) return `${days}d ${hours}h ${mins}m`;
  if (hours > 0) return `${hours}h ${mins}m`;
  if (mins > 0) return `${mins}m ${secs}s`;
  return `${secs}s`;
}

function rewardSummary(m: MissionProgressView): string {
  const parts: string[] = [];
  if (m.rewards.linhThach) parts.push(`${m.rewards.linhThach} ${t('mission.reward.linhThach')}`);
  if (m.rewards.tienNgoc) parts.push(`${m.rewards.tienNgoc} ${t('mission.reward.tienNgoc')}`);
  if (m.rewards.exp) parts.push(`${m.rewards.exp} ${t('mission.reward.exp')}`);
  if (m.rewards.congHien) parts.push(`${m.rewards.congHien} ${t('mission.reward.congHien')}`);
  if (m.rewards.items?.length) {
    parts.push(formatItemRewardList(m.rewards.items, t));
  }
  return parts.length > 0 ? parts.join(' · ') : '—';
}
</script>

<template>
  <AppShell>
    <XTSealFrame
      tone="jade"
      corner-ornaments="❖❧❖❧"
      watermark-letter="M"
      rounded="xl"
      inset="tight"
      test-id="mission-view-seal-frame"
      aria-label="Phụng Đạo Sứ Mệnh hero frame"
      class="mb-4"
    >
      <XTPageEyebrow caps="PHỤNG ĐẠO SỨ MỆNH" label="Phụng Đạo Sứ Mệnh" />
      <h2 class="text-xl tracking-widest mt-1">{{ t('mission.title') }}</h2>
    </XTSealFrame>

    <div class="flex gap-2 mb-4 flex-wrap">
      <MButton
        :class="tab === 'DAILY' ? '!bg-ink-50 !text-ink-900' : ''"
        @click="tab = 'DAILY'"
      >
        {{ t('mission.tab.daily') }}
        <span class="text-[10px] ml-1 text-ink-300">
          ({{ summary.DAILY.done }}/{{ summary.DAILY.total }})
        </span>
      </MButton>
      <MButton
        :class="tab === 'WEEKLY' ? '!bg-ink-50 !text-ink-900' : ''"
        @click="tab = 'WEEKLY'"
      >
        {{ t('mission.tab.weekly') }}
        <span class="text-[10px] ml-1 text-ink-300">
          ({{ summary.WEEKLY.done }}/{{ summary.WEEKLY.total }})
        </span>
      </MButton>
      <MButton
        :class="tab === 'ONCE' ? '!bg-ink-50 !text-ink-900' : ''"
        @click="tab = 'ONCE'"
      >
        {{ t('mission.tab.once') }}
        <span class="text-[10px] ml-1 text-ink-300">
          ({{ summary.ONCE.done }}/{{ summary.ONCE.total }})
        </span>
      </MButton>
      <MButton class="ml-auto" :disabled="loading" @click="refresh">
        {{ t('common.reload') }}
      </MButton>
    </div>

    <div v-if="loading && missions.length === 0" class="text-ink-300 text-sm">
      {{ t('common.loadingData') }}
    </div>

    <div v-else-if="filtered.length === 0" class="text-ink-300 text-sm">
      {{ t('mission.empty') }}
    </div>

    <ul v-else class="space-y-3">
      <li
        v-for="m in filtered"
        :key="m.key"
        class="border border-ink-300/40 rounded p-4 bg-ink-700/30"
      >
        <div class="flex items-start gap-3 flex-wrap">
          <div class="flex-1 min-w-0">
            <div class="flex items-center gap-2 flex-wrap">
              <span class="text-ink-50 font-bold">{{ m.name }}</span>
              <span
                class="text-[10px] px-1.5 py-0.5 rounded bg-ink-900/60 text-ink-300"
              >
                {{ t(`mission.quality.${m.quality}`) }}
              </span>
              <span
                v-if="m.claimed"
                class="text-[10px] px-1.5 py-0.5 rounded bg-emerald-700/40 text-emerald-200"
              >
                {{ t('mission.status.claimed') }}
              </span>
              <span
                v-else-if="m.completable"
                class="text-[10px] px-1.5 py-0.5 rounded bg-amber-700/40 text-amber-200"
              >
                {{ t('mission.status.ready') }}
              </span>
            </div>
            <div class="text-xs text-ink-300 mt-1">{{ m.description }}</div>
            <div class="text-[11px] text-ink-300 mt-2">
              {{ t('mission.reward.label') }}: {{ rewardSummary(m) }}
            </div>
          </div>
          <div class="flex flex-col items-end gap-2 min-w-[10rem]">
            <div class="text-[11px] text-ink-300">
              {{ m.currentAmount }} / {{ m.goalAmount }}
            </div>
            <div class="w-40 h-1.5 rounded bg-ink-900/60 overflow-hidden">
              <div
                class="h-full transition-all"
                :class="m.claimed ? 'bg-emerald-600' : m.completable ? 'bg-amber-400' : 'bg-ink-300'"
                :style="{ width: progressPct(m) + '%' }"
              />
            </div>
            <div
              v-if="m.windowEnd && !m.claimed"
              class="text-[10px] text-ink-300"
            >
              {{ t('mission.resetIn') }}: {{ formatCountdown(m.windowEnd) }}
            </div>
            <MButton
              v-if="!m.claimed"
              :disabled="!m.completable || claiming === m.key"
              @click="onClaim(m)"
            >
              {{ claiming === m.key ? t('common.loading') : t('mission.claim') }}
            </MButton>
          </div>
        </div>
      </li>
    </ul>
  </AppShell>
</template>
