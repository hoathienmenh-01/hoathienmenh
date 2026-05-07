<script setup lang="ts">
import { onBeforeUnmount, onMounted } from 'vue';
import { useI18n } from 'vue-i18n';
import { useToastStore } from '@/stores/toast';
import { getLiveOpsToday } from '@/api/liveops';

/**
 * Phase 13.0 §F LiveOps Notice — silent renderless component nhúng vào
 * AppShell/HomeView. Mỗi 60s gọi `/liveops/today` (cùng cache với
 * BossSchedulePanel — backend pure compute), nếu boss schedule có slot
 * `upcoming` với secondsUntilStart ≤ 15 phút và slot.key chưa được flag
 * trong sessionStorage → push toast warning.
 *
 * Anti-spam: per-slot flag persistent trong sessionStorage
 * (`liveops:notify:<slot.key>:<slotStartIso>`); session-scoped nên reload
 * tab vẫn nhớ. Toast.push cũng có anti-spam riêng theo (type+text) 1200ms.
 *
 * Render = empty (renderless, không chiếm DOM space).
 */
const NOTICE_WINDOW_SECONDS = 15 * 60;
const POLL_INTERVAL_MS = 60_000;

const toast = useToastStore();
const { t } = useI18n();

let timer: ReturnType<typeof setInterval> | null = null;

function flagKey(slotKey: string, slotStartIso: string): string {
  return `liveops:notify:${slotKey}:${slotStartIso}`;
}

function alreadyNotified(slotKey: string, slotStartIso: string): boolean {
  try {
    return sessionStorage.getItem(flagKey(slotKey, slotStartIso)) === '1';
  } catch {
    return false;
  }
}

function markNotified(slotKey: string, slotStartIso: string): void {
  try {
    sessionStorage.setItem(flagKey(slotKey, slotStartIso), '1');
  } catch {
    // SSR / privacy mode — ignore
  }
}

function formatCountdown(secs: number): string {
  if (secs <= 60) return '<1m';
  const m = Math.ceil(secs / 60);
  return `${m}m`;
}

async function tick(): Promise<void> {
  const data = await getLiveOpsToday();
  if (!data) return;
  for (const slot of data.bossSchedule) {
    if (slot.status !== 'upcoming') continue;
    if (slot.secondsUntilStart <= 0) continue;
    if (slot.secondsUntilStart > NOTICE_WINDOW_SECONDS) continue;
    if (alreadyNotified(slot.key, slot.slotStartIso)) continue;

    const bossName = t(`liveops.boss.${slot.bossKey}`, slot.bossKey);
    const time = formatCountdown(slot.secondsUntilStart);
    toast.push({
      type: 'warning',
      text: t('liveopsToday.spawnSoonToast', { time }) + ' — ' + bossName,
    });
    markNotified(slot.key, slot.slotStartIso);
  }
}

onMounted(() => {
  void tick();
  timer = setInterval(() => void tick(), POLL_INTERVAL_MS);
});

onBeforeUnmount(() => {
  if (timer) clearInterval(timer);
});

defineExpose({ tick });
</script>

<template>
  <span data-testid="liveops-notice" hidden></span>
</template>
