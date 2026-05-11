import { computed, ref } from 'vue';
import { defineStore } from 'pinia';
import {
  NOTIFICATION_LIMITS,
  type NotificationRow,
  formatBellBadgeCount,
} from '@xuantoi/shared';
import {
  getUnreadCount,
  listNotifications,
  markAllRead,
  markRead,
} from '@/api/notification';

const POLL_INTERVAL_MS = 60_000;

/**
 * Phase 19.3 — Notification store.
 *
 * State sources:
 *   - REST `/notifications` poll mỗi 60s (cũng `refresh()` manual).
 *   - WS `notification:new` push -> apply qua `pushIncoming(row)`.
 *   - WS `notification:unread-count` push -> apply qua
 *     `setUnreadCount(n)`.
 *
 * Idempotent: nếu cùng `id` đến từ cả REST và WS, dedupe theo id.
 *
 * UX:
 *   - `badgeLabel` đã format ('' / '3' / '99+') sẵn sàng render.
 *   - `loading` / `error` để FE NotificationDropdown hiển thị state.
 */
export const useNotificationsStore = defineStore('notifications', () => {
  const items = ref<NotificationRow[]>([]);
  const unreadCount = ref<number>(0);
  const loading = ref<boolean>(false);
  const errorCode = ref<string | null>(null);
  const lastFetchAt = ref<number | null>(null);
  const nextCursor = ref<string | null>(null);
  let timer: ReturnType<typeof setInterval> | null = null;

  const badgeLabel = computed(() => formatBellBadgeCount(unreadCount.value));
  const hasUnread = computed(() => unreadCount.value > 0);

  async function refresh(): Promise<void> {
    loading.value = true;
    errorCode.value = null;
    try {
      const res = await listNotifications({
        limit: NOTIFICATION_LIMITS.LIST_PAGE_DEFAULT,
      });
      items.value = res.notifications;
      unreadCount.value = res.unreadCount;
      lastFetchAt.value = Date.now();
      const last = res.notifications[res.notifications.length - 1];
      nextCursor.value =
        res.notifications.length === NOTIFICATION_LIMITS.LIST_PAGE_DEFAULT
          ? (last?.createdAt ?? null)
          : null;
    } catch (e) {
      const err = e as { code?: string; message?: string };
      errorCode.value = err?.code ?? 'UNKNOWN';
    } finally {
      loading.value = false;
    }
  }

  async function refreshUnreadCount(): Promise<void> {
    try {
      const res = await getUnreadCount();
      unreadCount.value = res.unreadCount;
    } catch {
      // silent — fallback to existing count
    }
  }

  async function markOneRead(id: string): Promise<void> {
    try {
      const res = await markRead(id);
      const idx = items.value.findIndex((x) => x.id === id);
      if (idx >= 0) items.value[idx] = res.notification;
      unreadCount.value = res.unreadCount;
    } catch (e) {
      const err = e as { code?: string; message?: string };
      errorCode.value = err?.code ?? 'UNKNOWN';
    }
  }

  async function markAll(): Promise<void> {
    try {
      const res = await markAllRead();
      const now = new Date().toISOString();
      items.value = items.value.map((n) =>
        n.readAt ? n : { ...n, readAt: now },
      );
      unreadCount.value = res.unreadCount;
    } catch (e) {
      const err = e as { code?: string; message?: string };
      errorCode.value = err?.code ?? 'UNKNOWN';
    }
  }

  /**
   * Apply WS `notification:new` payload. Prepend ở đầu list (giữ
   * orderBy createdAt desc). Idempotent — dedupe theo id; nếu id
   * đã tồn tại thì KHÔNG increment unread (FE tự tin counter sẽ
   * được sync qua `notification:unread-count` ngay sau đó).
   */
  function pushIncoming(row: NotificationRow): void {
    const exists = items.value.findIndex((x) => x.id === row.id);
    if (exists >= 0) {
      items.value[exists] = row;
      return;
    }
    items.value = [row, ...items.value].slice(
      0,
      NOTIFICATION_LIMITS.LIST_PAGE_MAX,
    );
    if (!row.readAt) unreadCount.value += 1;
  }

  function setUnreadCount(n: number): void {
    if (!Number.isFinite(n) || n < 0) return;
    unreadCount.value = Math.floor(n);
  }

  function start(): void {
    if (timer) return;
    void refresh();
    timer = setInterval(() => {
      void refreshUnreadCount();
    }, POLL_INTERVAL_MS);
  }

  function stop(): void {
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
  }

  function reset(): void {
    items.value = [];
    unreadCount.value = 0;
    nextCursor.value = null;
    errorCode.value = null;
    lastFetchAt.value = null;
  }

  return {
    items,
    unreadCount,
    badgeLabel,
    hasUnread,
    loading,
    errorCode,
    lastFetchAt,
    nextCursor,
    refresh,
    refreshUnreadCount,
    markOneRead,
    markAll,
    pushIncoming,
    setUnreadCount,
    start,
    stop,
    reset,
  };
});
