/**
 * Phase 15.3.B — Pinia store cho LiveOps Announcement banner / marquee.
 *
 * Trách nhiệm:
 *   - Fetch list ACTIVE announcement từ `/liveops/announcements/active`.
 *   - Auto-refresh mỗi 60s khi có >0 announcement (giảm tải khi rảnh).
 *   - Listen WS event `liveops:announcement` (ANNOUNCEMENT_ACTIVE/ENDED)
 *     để update store + push toast — KHÔNG cần manual refresh.
 *   - Listen WS event `liveops:event` (LIVEOPS_EVENT_ACTIVE/ENDED) để
 *     push toast + emit signal cho `LiveOpsActiveEventsPanel` refresh.
 *   - Local dismiss state: user có thể đóng banner cụ thể, lưu vào
 *     `sessionStorage` (per-tab session, không cross-device).
 *
 * Anti-spam:
 *   - Toast store đã có anti-spam 1200ms cho cùng (type+text).
 *   - Dismiss state ngăn user thấy lại cùng announcement sau khi đóng.
 *   - WS listener KHÔNG re-broadcast khi nhận lại (server đã guard chỉ
 *     emit khi status thật sự transition).
 *
 * Public-safe:
 *   - Store chỉ chứa public-safe field (key/severity/target/title/message
 *     /window). KHÔNG có adminId/id.
 */
import { defineStore } from 'pinia';
import type {
  LiveOpsAnnouncementBroadcastPayload,
  LiveOpsAnnouncementPublicView,
  LiveOpsEventBroadcastPayload,
} from '@xuantoi/shared';
import { getActiveLiveOpsAnnouncements } from '@/api/liveopsAnnouncement';

const DISMISS_KEY_PREFIX = 'liveops:announcement:dismiss:';

function isDismissedKey(key: string): boolean {
  try {
    return sessionStorage.getItem(DISMISS_KEY_PREFIX + key) === '1';
  } catch {
    return false;
  }
}

function markDismissedKey(key: string): void {
  try {
    sessionStorage.setItem(DISMISS_KEY_PREFIX + key, '1');
  } catch {
    /* SSR / privacy mode */
  }
}

interface State {
  announcements: LiveOpsAnnouncementPublicView[];
  /** Set keys đã dismiss locally (mirror sessionStorage). */
  dismissedKeys: Set<string>;
  /** Last LiveOps event broadcast received — FE panel có thể watch để refetch. */
  lastEventBroadcastAt: number;
  /** Loading flag cho lần fetch đầu tiên. */
  loading: boolean;
}

export const useLiveOpsAnnouncementStore = defineStore(
  'liveopsAnnouncements',
  {
    state: (): State => ({
      announcements: [],
      dismissedKeys: new Set<string>(),
      lastEventBroadcastAt: 0,
      loading: true,
    }),
    getters: {
      /** Visible = ACTIVE & in-window & not-dismissed. */
      visible(state): LiveOpsAnnouncementPublicView[] {
        const now = Date.now();
        return state.announcements.filter((a) => {
          if (state.dismissedKeys.has(a.key)) return false;
          const start = new Date(a.startsAt).getTime();
          const end = new Date(a.endsAt).getTime();
          if (!Number.isFinite(start) || !Number.isFinite(end)) return false;
          return start <= now && now < end;
        });
      },
      hasVisible(): boolean {
        return this.visible.length > 0;
      },
    },
    actions: {
      async refresh(): Promise<void> {
        const list = await getActiveLiveOpsAnnouncements();
        this.announcements = list;
        this.loading = false;
      },
      hydrateDismissedFromStorage(): void {
        const keys = this.announcements.map((a) => a.key);
        const dismissed = new Set<string>();
        for (const k of keys) {
          if (isDismissedKey(k)) dismissed.add(k);
        }
        this.dismissedKeys = dismissed;
      },
      dismiss(key: string): void {
        this.dismissedKeys.add(key);
        markDismissedKey(key);
      },
      /**
       * Apply WS announcement broadcast → upsert announcement vào list cho
       * ANNOUNCEMENT_ACTIVE; remove cho ANNOUNCEMENT_ENDED.
       */
      applyAnnouncementBroadcast(
        payload: LiveOpsAnnouncementBroadcastPayload,
      ): void {
        if (payload.type === 'ANNOUNCEMENT_ACTIVE') {
          const existsIdx = this.announcements.findIndex(
            (a) => a.key === payload.key,
          );
          const view: LiveOpsAnnouncementPublicView = {
            key: payload.key,
            severity: payload.severity,
            target: payload.target,
            titleVi: payload.titleVi,
            titleEn: payload.titleEn,
            messageVi: payload.messageVi,
            messageEn: payload.messageEn,
            startsAt: payload.startsAt,
            endsAt: payload.endsAt,
          };
          if (existsIdx >= 0) this.announcements[existsIdx] = view;
          else this.announcements.push(view);
        } else if (payload.type === 'ANNOUNCEMENT_ENDED') {
          this.announcements = this.announcements.filter(
            (a) => a.key !== payload.key,
          );
        }
      },
      /** Apply WS event broadcast — chỉ touch `lastEventBroadcastAt`. */
      applyEventBroadcast(_payload: LiveOpsEventBroadcastPayload): void {
        this.lastEventBroadcastAt = Date.now();
      },
    },
  },
);
