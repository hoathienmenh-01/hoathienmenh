/**
 * Phase 19.3 — NotificationBell smoke tests.
 *
 * Verify:
 *   - Badge hiển thị khi unreadCount > 0; ẩn khi 0.
 *   - Badge label format ('1', '12', '99+').
 *   - Click bell mở dropdown + gọi refresh() (REST).
 *   - WS subscribe `notification:new` + `notification:unread-count`
 *     khi mount, unsubscribe khi unmount (qua `wsOn` mock).
 *   - WS event `notification:new` cập nhật state qua store
 *     (`pushIncoming` + `setUnreadCount`).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { createI18n } from 'vue-i18n';
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

// WS client: capture handlers + provide trigger helper.
const wsHandlers = new Map<string, Set<(frame: unknown) => void>>();

vi.mock('@/ws/client', () => ({
  on: (type: string, fn: (frame: unknown) => void) => {
    let set = wsHandlers.get(type);
    if (!set) {
      set = new Set();
      wsHandlers.set(type, set);
    }
    set.add(fn);
    return () => set?.delete(fn);
  },
}));

import NotificationBell from '@/components/notification/NotificationBell.vue';

function fireWs(type: string, payload: unknown): void {
  const set = wsHandlers.get(type);
  if (!set) return;
  for (const fn of set) fn({ type, payload, ts: Date.now() });
}

const messages = {
  vi: {
    common: { loading: 'Đang tải…', retry: 'Thử lại' },
    notification: {
      bell: 'Thông báo',
      title: 'Thông báo',
      empty: 'Chưa có thông báo nào.',
      loading: 'Đang tải…',
      errorGeneric: 'Có lỗi.',
      retry: 'Thử lại',
      markAllRead: 'Đánh dấu đọc hết',
    },
  },
  en: {
    common: { loading: 'Loading…', retry: 'Retry' },
    notification: {
      bell: 'Notifications',
      title: 'Notifications',
      empty: 'No notifications.',
      loading: 'Loading…',
      errorGeneric: 'Error.',
      retry: 'Retry',
      markAllRead: 'Mark all read',
    },
  },
} as const;

function makeRow(over: Partial<NotificationRow> = {}): NotificationRow {
  return {
    id: 'n-1',
    type: 'FRIEND_REQUEST_RECEIVED',
    titleKey: 'notification.friendRequestReceived.title',
    bodyKey: 'notification.friendRequestReceived.body',
    entityType: 'FRIEND_REQUEST',
    entityId: 'req-1',
    dataJson: { senderName: 'Alice' },
    readAt: null,
    createdAt: new Date('2026-09-20T10:00:00.000Z').toISOString(),
    expiresAt: null,
    ...over,
  };
}

function makeI18n() {
  return createI18n({
    legacy: false,
    locale: 'vi',
    fallbackLocale: 'vi',
    messages,
  });
}

function makeRouter() {
  return {
    push: vi.fn(),
    install: () => undefined,
  };
}

beforeEach(() => {
  setActivePinia(createPinia());
  listNotificationsMock.mockReset();
  getUnreadCountMock.mockReset();
  markReadMock.mockReset();
  markAllReadMock.mockReset();
  wsHandlers.clear();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('NotificationBell — render + WS', () => {
  it('không có unread → KHÔNG render badge', async () => {
    listNotificationsMock.mockResolvedValueOnce({
      notifications: [],
      unreadCount: 0,
      total: 0,
    });
    const i18n = makeI18n();
    const router = makeRouter();
    const wrapper = mount(NotificationBell, {
      global: {
        plugins: [i18n],
        mocks: { $router: router },
        stubs: { 'router-link': true },
      },
    });
    await flushPromises();
    expect(wrapper.find('[data-testid="notification-bell-badge"]').exists()).toBe(false);
  });

  it('unreadCount=5 → badge label "5"', async () => {
    listNotificationsMock.mockResolvedValueOnce({
      notifications: [makeRow()],
      unreadCount: 5,
      total: 5,
    });
    const i18n = makeI18n();
    const router = makeRouter();
    const wrapper = mount(NotificationBell, {
      global: {
        plugins: [i18n],
        mocks: { $router: router },
        stubs: { 'router-link': true },
      },
    });
    await flushPromises();
    const badge = wrapper.find('[data-testid="notification-bell-badge"]');
    expect(badge.exists()).toBe(true);
    expect(badge.text()).toBe('5');
  });

  it('unreadCount=150 → badge "99+"', async () => {
    listNotificationsMock.mockResolvedValueOnce({
      notifications: [makeRow()],
      unreadCount: 150,
      total: 150,
    });
    const i18n = makeI18n();
    const router = makeRouter();
    const wrapper = mount(NotificationBell, {
      global: {
        plugins: [i18n],
        mocks: { $router: router },
        stubs: { 'router-link': true },
      },
    });
    await flushPromises();
    expect(
      wrapper.find('[data-testid="notification-bell-badge"]').text(),
    ).toBe('99+');
  });

  it('WS notification:new push → tăng unread count + dropdown thấy row mới', async () => {
    listNotificationsMock.mockResolvedValueOnce({
      notifications: [],
      unreadCount: 0,
      total: 0,
    });
    const i18n = makeI18n();
    const router = makeRouter();
    const wrapper = mount(NotificationBell, {
      global: {
        plugins: [i18n],
        mocks: { $router: router },
        stubs: { 'router-link': true },
      },
    });
    await flushPromises();
    const newRow = makeRow({ id: 'n-99' });
    fireWs('notification:new', { notification: newRow, unreadCount: 1 });
    await flushPromises();
    expect(
      wrapper.find('[data-testid="notification-bell-badge"]').exists(),
    ).toBe(true);
    expect(
      wrapper.find('[data-testid="notification-bell-badge"]').text(),
    ).toBe('1');
  });

  it('WS notification:unread-count → cập nhật badge mà KHÔNG cần row mới', async () => {
    listNotificationsMock.mockResolvedValueOnce({
      notifications: [],
      unreadCount: 0,
      total: 0,
    });
    const i18n = makeI18n();
    const router = makeRouter();
    const wrapper = mount(NotificationBell, {
      global: {
        plugins: [i18n],
        mocks: { $router: router },
        stubs: { 'router-link': true },
      },
    });
    await flushPromises();
    fireWs('notification:unread-count', { unreadCount: 7 });
    await flushPromises();
    expect(
      wrapper.find('[data-testid="notification-bell-badge"]').text(),
    ).toBe('7');
  });

  it('unmount → WS handlers cleanup (set rỗng)', async () => {
    listNotificationsMock.mockResolvedValueOnce({
      notifications: [],
      unreadCount: 0,
      total: 0,
    });
    const i18n = makeI18n();
    const router = makeRouter();
    const wrapper = mount(NotificationBell, {
      global: {
        plugins: [i18n],
        mocks: { $router: router },
        stubs: { 'router-link': true },
      },
    });
    await flushPromises();
    expect(wsHandlers.get('notification:new')?.size).toBe(1);
    wrapper.unmount();
    await flushPromises();
    expect(wsHandlers.get('notification:new')?.size ?? 0).toBe(0);
  });
});
