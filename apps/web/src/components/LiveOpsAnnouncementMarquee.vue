<script setup lang="ts">
/**
 * Phase 15.3.B — Global LiveOps Announcement marquee/banner.
 *
 * Render:
 *   - 1 banner per visible announcement (ACTIVE & in-window & not-dismissed).
 *   - Severity colour (INFO/EVENT/WARNING/MAINTENANCE) qua CSS class.
 *   - Locale-aware title/message: prefer i18n locale `vi`/`en` (fallback
 *     vi nếu en null).
 *   - Countdown đến `endsAt` (giây/phút/giờ/ngày).
 *   - Local dismiss button — lưu sessionStorage.
 *   - Empty state: KHÔNG render (không chiếm chỗ).
 *
 * Lifecycle:
 *   - onMounted: fetch initial + hydrate dismiss state + register WS listeners
 *     cho `liveops:announcement` + `liveops:event`.
 *   - onBeforeUnmount: cleanup WS listeners + interval.
 *
 * WS handlers:
 *   - ANNOUNCEMENT_ACTIVE → upsert + push toast (severity-aware level).
 *   - ANNOUNCEMENT_ENDED  → remove, không toast (banner biến mất là đủ).
 *   - LIVEOPS_EVENT_ACTIVE / ENDED → push toast + bump `lastEventBroadcastAt`
 *     (LiveOpsActiveEventsPanel watch để refetch — tránh spam refresh).
 */
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import {
  pickLiveOpsAnnouncementText,
  type LiveOpsAnnouncementBroadcastPayload,
  type LiveOpsAnnouncementPublicView,
  type LiveOpsAnnouncementSeverity,
  type LiveOpsEventBroadcastPayload,
  type WsFrame,
} from '@xuantoi/shared';
import { useLiveOpsAnnouncementStore } from '@/stores/liveopsAnnouncements';
import { useToastStore } from '@/stores/toast';
import { on as wsOn } from '@/ws/client';

const { t, locale } = useI18n();
const store = useLiveOpsAnnouncementStore();
const toast = useToastStore();

const REFRESH_INTERVAL_MS = 60_000;
let timer: ReturnType<typeof setInterval> | null = null;
const unsubFns: Array<() => void> = [];

// `now` ref dùng để re-render countdown mỗi 30s — không trigger fetch.
const now = ref(Date.now());
let nowTimer: ReturnType<typeof setInterval> | null = null;

onMounted(async () => {
  await store.refresh();
  store.hydrateDismissedFromStorage();

  timer = setInterval(() => {
    void store.refresh();
  }, REFRESH_INTERVAL_MS);
  nowTimer = setInterval(() => {
    now.value = Date.now();
  }, 30_000);

  unsubFns.push(
    wsOn<LiveOpsAnnouncementBroadcastPayload>(
      'liveops:announcement',
      (frame: WsFrame<LiveOpsAnnouncementBroadcastPayload>) => {
        const p = frame.payload;
        store.applyAnnouncementBroadcast(p);
        if (p.type === 'ANNOUNCEMENT_ACTIVE') {
          const title = pickLiveOpsAnnouncementText(
            p.titleVi,
            p.titleEn,
            locale.value === 'en' ? 'en' : 'vi',
          );
          const message = pickLiveOpsAnnouncementText(
            p.messageVi,
            p.messageEn,
            locale.value === 'en' ? 'en' : 'vi',
          );
          toast.push({
            type: severityToToastType(p.severity),
            title,
            text: message,
          });
        }
      },
    ),
    wsOn<LiveOpsEventBroadcastPayload>(
      'liveops:event',
      (frame: WsFrame<LiveOpsEventBroadcastPayload>) => {
        const p = frame.payload;
        store.applyEventBroadcast(p);
        if (p.type === 'LIVEOPS_EVENT_ACTIVE') {
          toast.push({
            type: 'info',
            text: t('liveopsAnnouncementMarquee.toast.eventActive', {
              title: p.title,
            }),
          });
        } else if (p.type === 'LIVEOPS_EVENT_ENDED') {
          toast.push({
            type: 'info',
            text: t('liveopsAnnouncementMarquee.toast.eventEnded', {
              title: p.title,
            }),
          });
        }
      },
    ),
  );
});

onBeforeUnmount(() => {
  if (timer) clearInterval(timer);
  if (nowTimer) clearInterval(nowTimer);
  for (const fn of unsubFns) fn();
});

function severityToToastType(
  s: LiveOpsAnnouncementSeverity,
): 'info' | 'warning' | 'error' | 'success' {
  if (s === 'WARNING') return 'warning';
  if (s === 'MAINTENANCE') return 'error';
  if (s === 'EVENT') return 'success';
  return 'info';
}

function severityClass(a: LiveOpsAnnouncementPublicView): string {
  return `marquee--${a.severity.toLowerCase()}`;
}

function viewTitle(a: LiveOpsAnnouncementPublicView): string {
  return pickLiveOpsAnnouncementText(
    a.titleVi,
    a.titleEn,
    locale.value === 'en' ? 'en' : 'vi',
  );
}

function viewMessage(a: LiveOpsAnnouncementPublicView): string {
  return pickLiveOpsAnnouncementText(
    a.messageVi,
    a.messageEn,
    locale.value === 'en' ? 'en' : 'vi',
  );
}

function countdownText(a: LiveOpsAnnouncementPublicView): string {
  const ms = new Date(a.endsAt).getTime() - now.value;
  if (!Number.isFinite(ms) || ms <= 0) return '';
  const totalSec = Math.floor(ms / 1000);
  const d = Math.floor(totalSec / 86400);
  const h = Math.floor((totalSec % 86400) / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  if (d > 0) return t('liveopsAnnouncementMarquee.endsIn', { time: `${d}d ${h}h` });
  if (h > 0) return t('liveopsAnnouncementMarquee.endsIn', { time: `${h}h ${m}m` });
  if (m > 0) return t('liveopsAnnouncementMarquee.endsIn', { time: `${m}m` });
  return t('liveopsAnnouncementMarquee.endsIn', { time: '<1m' });
}

const visible = computed(() => store.visible);
</script>

<template>
  <section
    v-if="visible.length > 0"
    class="liveops-announcement-marquee"
    role="region"
    :aria-label="t('liveopsAnnouncementMarquee.aria')"
  >
    <div
      v-for="a in visible"
      :key="a.key"
      :class="['marquee-banner', severityClass(a)]"
      data-test="liveops-announcement-marquee-banner"
      :data-announcement-key="a.key"
    >
      <div class="marquee-banner__badge">
        {{ t(`liveopsAnnouncementMarquee.severity.${a.severity}`) }}
      </div>
      <div class="marquee-banner__content">
        <div class="marquee-banner__title">{{ viewTitle(a) }}</div>
        <div class="marquee-banner__message">{{ viewMessage(a) }}</div>
        <div class="marquee-banner__countdown">{{ countdownText(a) }}</div>
      </div>
      <button
        type="button"
        class="marquee-banner__dismiss"
        :aria-label="t('liveopsAnnouncementMarquee.dismiss')"
        data-test="liveops-announcement-marquee-dismiss"
        @click="store.dismiss(a.key)"
      >
        ×
      </button>
    </div>
  </section>
</template>

<style scoped>
.liveops-announcement-marquee {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  margin: 0.5rem 0;
}

.marquee-banner {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 0.75rem 1rem;
  border-radius: 0.5rem;
  border: 1px solid;
  background: var(--bg-soft, #f5f5f5);
  font-size: 0.95rem;
}

.marquee-banner__badge {
  flex: 0 0 auto;
  padding: 0.25rem 0.5rem;
  border-radius: 0.25rem;
  font-size: 0.75rem;
  font-weight: 600;
  letter-spacing: 0.025em;
  text-transform: uppercase;
  background: rgba(0, 0, 0, 0.08);
}

.marquee-banner__content {
  flex: 1 1 auto;
  display: flex;
  flex-direction: column;
  gap: 0.125rem;
}

.marquee-banner__title {
  font-weight: 600;
}

.marquee-banner__message {
  opacity: 0.85;
}

.marquee-banner__countdown {
  font-size: 0.8rem;
  opacity: 0.75;
}

.marquee-banner__dismiss {
  flex: 0 0 auto;
  background: transparent;
  border: 0;
  font-size: 1.25rem;
  line-height: 1;
  cursor: pointer;
  padding: 0.25rem 0.5rem;
  color: inherit;
  opacity: 0.7;
}
.marquee-banner__dismiss:hover {
  opacity: 1;
}

.marquee--info {
  border-color: #5a8dee;
  background: #e7efff;
  color: #1c3a72;
}
.marquee--event {
  border-color: #2fa667;
  background: #e3f7ec;
  color: #155730;
}
.marquee--warning {
  border-color: #d97706;
  background: #fef3c7;
  color: #6b3a07;
}
.marquee--maintenance {
  border-color: #b91c1c;
  background: #fde8e8;
  color: #7a1818;
}
</style>
