/**
 * Phase 19.3 — useNotificationsStore tests.
 *
 * Cover:
 *   - `refresh()` set items + unread count.
 *   - `pushIncoming(row)` prepend + dedupe theo id + increment unread.
 *   - `setUnreadCount(n)` clamp negative + non-finite + floor.
 *   - `markOneRead(id)` set readAt + cập nhật unreadCount.
 *   - `markAll()` zero unread.
 *   - `badgeLabel` format theo `formatBellBadgeCount`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import type { NotificationRow } from '@xuantoi/shared';

const {
  listNotificationsMock,
  getUnreadCountMock,
  markReadMock,
  markAllReadMock,
} = vi.hoisted(() => ({
  listNotificationsMock: vi.fn(),
  getUnreadCountMock: vi.fn(),
  markReadMock: vi.fn(),
  markAllReadMock: vi.fn(),
}));

vi.mock('@/api/notification', () => ({
  listNotifications: listNotificationsMock,
  getUnreadCount: getUnreadCountMock,
  markRead: markReadMock,
  markAllRead: markAllReadMock,
}));

import { useNotificationsStore } from '@/stores/notifications';

function makeRow(over: Partial<NotificationRow> = {}): NotificationRow {
  return {
    id: 'n-1',
    type: 'FRIEND_REQUEST_RECEIVED',
    titleKey: 'notification.friendRequestReceived.title',
    bodyKey: 'notification.friendRequestReceived.body',
    entityType: 'FRIEND_REQUEST',
    entityId: 'req-1',
    dataJson: {},
    readAt: null,
    createdAt: new Date().toISOString(),
    expiresAt: null,
    ...over,
  };
}

beforeEach(() => {
  setActivePinia(createPinia());
  listNotificationsMock.mockReset();
  getUnreadCountMock.mockReset();
  markReadMock.mockReset();
  markAllReadMock.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('useNotificationsStore', () => {
  it('refresh() set items + unreadCount + lastFetchAt', async () => {
    const row = makeRow();
    listNotificationsMock.mockResolvedValueOnce({
      notifications: [row],
      unreadCount: 1,
      total: 1,
    });
    const store = useNotificationsStore();
    await store.refresh();
    expect(store.items).toEqual([row]);
    expect(store.unreadCount).toBe(1);
    expect(store.hasUnread).toBe(true);
    expect(store.badgeLabel).toBe('1');
    expect(store.lastFetchAt).not.toBeNull();
  });

  it('refresh() set errorCode khi API throw', async () => {
    listNotificationsMock.mockRejectedValueOnce(
      Object.assign(new Error('FAIL'), { code: 'INTERNAL_ERROR' }),
    );
    const store = useNotificationsStore();
    await store.refresh();
    expect(store.errorCode).toBe('INTERNAL_ERROR');
  });

  it('pushIncoming new row → prepend + unreadCount +1', () => {
    const store = useNotificationsStore();
    const r1 = makeRow({ id: 'n-1' });
    const r2 = makeRow({ id: 'n-2' });
    store.pushIncoming(r1);
    store.pushIncoming(r2);
    expect(store.items.map((x) => x.id)).toEqual(['n-2', 'n-1']);
    expect(store.unreadCount).toBe(2);
  });

  it('pushIncoming dedupe theo id — KHÔNG tăng unread lần 2', () => {
    const store = useNotificationsStore();
    const r1 = makeRow({ id: 'n-1' });
    store.pushIncoming(r1);
    store.pushIncoming(r1);
    expect(store.items).toHaveLength(1);
    expect(store.unreadCount).toBe(1);
  });

  it('setUnreadCount clamp non-finite / negative / floor', () => {
    const store = useNotificationsStore();
    store.setUnreadCount(5);
    expect(store.unreadCount).toBe(5);
    store.setUnreadCount(-3);
    expect(store.unreadCount).toBe(5);
    store.setUnreadCount(Number.NaN);
    expect(store.unreadCount).toBe(5);
    store.setUnreadCount(7.9);
    expect(store.unreadCount).toBe(7);
  });

  it('markOneRead set readAt + cập nhật unreadCount', async () => {
    const r1 = makeRow({ id: 'n-1' });
    const r1Read = { ...r1, readAt: new Date().toISOString() };
    listNotificationsMock.mockResolvedValueOnce({
      notifications: [r1],
      unreadCount: 1,
      total: 1,
    });
    markReadMock.mockResolvedValueOnce({
      notification: r1Read,
      unreadCount: 0,
    });
    const store = useNotificationsStore();
    await store.refresh();
    await store.markOneRead('n-1');
    expect(store.items[0].readAt).not.toBeNull();
    expect(store.unreadCount).toBe(0);
  });

  it('markAll set readAt cho tất cả + unread=0', async () => {
    const r1 = makeRow({ id: 'n-1' });
    const r2 = makeRow({ id: 'n-2' });
    listNotificationsMock.mockResolvedValueOnce({
      notifications: [r1, r2],
      unreadCount: 2,
      total: 2,
    });
    markAllReadMock.mockResolvedValueOnce({ markedCount: 2, unreadCount: 0 });
    const store = useNotificationsStore();
    await store.refresh();
    await store.markAll();
    expect(store.items.every((x) => x.readAt !== null)).toBe(true);
    expect(store.unreadCount).toBe(0);
  });

  it('badgeLabel format >99 → "99+"', () => {
    const store = useNotificationsStore();
    store.setUnreadCount(150);
    expect(store.badgeLabel).toBe('99+');
  });

  it('reset() xoá items + unread', async () => {
    const r1 = makeRow();
    listNotificationsMock.mockResolvedValueOnce({
      notifications: [r1],
      unreadCount: 1,
      total: 1,
    });
    const store = useNotificationsStore();
    await store.refresh();
    store.reset();
    expect(store.items).toEqual([]);
    expect(store.unreadCount).toBe(0);
  });

  it('start() chạy refresh + setInterval; stop() clear timer', async () => {
    vi.useFakeTimers();
    listNotificationsMock.mockResolvedValue({
      notifications: [],
      unreadCount: 0,
      total: 0,
    });
    getUnreadCountMock.mockResolvedValue({ unreadCount: 3 });
    const store = useNotificationsStore();
    store.start();
    await Promise.resolve();
    expect(listNotificationsMock).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(60_000);
    await Promise.resolve();
    expect(getUnreadCountMock).toHaveBeenCalled();
    store.stop();
    getUnreadCountMock.mockClear();
    vi.advanceTimersByTime(60_000);
    await Promise.resolve();
    expect(getUnreadCountMock).not.toHaveBeenCalled();
  });
});
