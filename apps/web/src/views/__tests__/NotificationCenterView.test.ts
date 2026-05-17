/**
 * Phase 15.16 (PR #628) — NotificationCenterView tests.
 *
 * Cover:
 *   - Empty state when no notifications + no mail.
 *   - Populated state with notifications + mail items.
 *   - Filter behavior switches between categories.
 *   - Mark all read action.
 *   - OnlineFriendsWidget renders in sidebar.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { createI18n } from 'vue-i18n';
import { setActivePinia, createPinia } from 'pinia';
import type { NotificationRow } from '@xuantoi/shared';
import type { MailView } from '@/api/mail';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const listMailMock = vi.fn();
const listNotificationsMock = vi.fn();
const getUnreadCountMock = vi.fn();
const markReadMock = vi.fn();
const markAllReadMock = vi.fn();
const getFriendsMock = vi.fn();
const wsOnMock = vi.fn(() => () => {});

vi.mock('@/api/mail', () => ({
  listMail: () => listMailMock(),
}));

vi.mock('@/api/notification', () => ({
  listNotifications: (q: unknown) => listNotificationsMock(q),
  getUnreadCount: () => getUnreadCountMock(),
  markRead: (id: unknown) => markReadMock(id),
  markAllRead: () => markAllReadMock(),
}));

vi.mock('@/api/social', () => ({
  getFriends: () => getFriendsMock(),
}));

vi.mock('@/ws/client', () => ({
  on: (_event: unknown, _cb: unknown) => wsOnMock(),
}));

vi.mock('vue-router', () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

vi.mock('@/components/xianxia/XTLuxHero.vue', () => ({
  default: {
    name: 'XTLuxHeroStub',
    template: '<div data-testid="xt-lux-hero"><slot /></div>',
    props: ['eyebrow', 'label', 'title', 'subtitle', 'tone', 'watermarkLetter', 'breadcrumb', 'testId'],
  },
}));

import NotificationCenterView from '@/views/NotificationCenterView.vue';

// ---------------------------------------------------------------------------
// i18n setup
// ---------------------------------------------------------------------------

const i18n = createI18n({
  legacy: false,
  locale: 'en',
  fallbackLocale: 'en',
  messages: {
    en: {
      common: { loading: 'Loading...' },
      notification: {
        title: 'Notifications',
        markAllRead: 'Mark all as read',
        loading: 'Loading notifications...',
        empty: 'No notifications yet.',
        errorGeneric: 'Failed to load notifications.',
        retry: 'Retry',
        FRIEND_REQUEST_RECEIVED: {
          title: 'New friend request',
          body: '{sender} sent you a friend request.',
        },
        FRIEND_REQUEST_ACCEPTED: {
          title: 'Friend request accepted',
          body: '{sender} accepted your friend request.',
        },
      },
      notificationCenter: {
        viewTitle: 'Notification Center',
        viewSubtitle: 'All your notifications in one place.',
        filter: {
          all: 'All',
          system: 'System',
          rewards: 'Rewards',
          sect: 'Sect',
          trading: 'Trading',
          combat: 'Combat',
          mission: 'Mission',
          social: 'Social',
        },
        empty: 'No notifications to display.',
        emptyHint: 'Notifications from mail, social, and game events will appear here.',
        time: {
          justNow: 'Just now',
          minutesAgo: '{n}m ago',
          hoursAgo: '{n}h ago',
          daysAgo: '{n}d ago',
        },
      },
      onlineFriends: {
        title: 'Friends',
        viewAll: 'View all',
        error: 'Failed to load friends.',
        noFriends: 'No friends yet. Add friends in the Social tab!',
        noneOnline: 'No friends online right now.',
        onlineCount: '{n} online',
        recentlyOffline: 'Offline',
      },
    },
  },
});

// ---------------------------------------------------------------------------
// Factories
// ---------------------------------------------------------------------------

function makeNotifRow(overrides: Partial<NotificationRow> = {}): NotificationRow {
  return {
    id: 'n-1',
    type: 'FRIEND_REQUEST_RECEIVED',
    titleKey: 'notification.FRIEND_REQUEST_RECEIVED.title',
    bodyKey: 'notification.FRIEND_REQUEST_RECEIVED.body',
    entityType: 'FRIEND_REQUEST',
    entityId: 'req-1',
    dataJson: { sender: 'TestUser' },
    readAt: null,
    createdAt: new Date().toISOString(),
    expiresAt: null,
    ...overrides,
  };
}

function makeMailItem(overrides: Partial<MailView> = {}): MailView {
  return {
    id: 'm-1',
    senderName: 'System',
    subject: 'Welcome reward',
    body: 'You received 100 Linh Thach.',
    rewardLinhThach: '100',
    rewardTienNgoc: 0,
    rewardExp: '0',
    rewardItems: [],
    readAt: null,
    claimedAt: null,
    expiresAt: null,
    createdAt: new Date().toISOString(),
    claimable: true,
    mailType: 'REWARD',
    status: 'UNREAD',
    deleted: false,
    ...overrides,
  };
}

function mountView() {
  return mount(NotificationCenterView, {
    global: { plugins: [i18n] },
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('NotificationCenterView', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    listNotificationsMock.mockReset();
    getUnreadCountMock.mockReset();
    markReadMock.mockReset();
    markAllReadMock.mockReset();
    listMailMock.mockReset();
    getFriendsMock.mockReset();
    wsOnMock.mockReset().mockReturnValue(() => {});

    // Default: empty results
    listNotificationsMock.mockResolvedValue({
      notifications: [],
      unreadCount: 0,
      total: 0,
    });
    listMailMock.mockResolvedValue([]);
    getFriendsMock.mockResolvedValue({ friends: [] });
  });

  it('renders empty state when no notifications and no mail', async () => {
    const w = mountView();
    await flushPromises();
    expect(w.find('[data-testid="notification-center-empty"]').exists()).toBe(true);
    expect(w.text()).toContain('No notifications to display.');
    expect(w.text()).toContain('Notifications from mail, social, and game events will appear here.');
  });

  it('renders notification items from store', async () => {
    const row = makeNotifRow({ id: 'n-1' });
    listNotificationsMock.mockResolvedValue({
      notifications: [row],
      unreadCount: 1,
      total: 1,
    });
    const w = mountView();
    await flushPromises();
    expect(w.find('[data-testid="notification-center-empty"]').exists()).toBe(false);
    expect(w.find('[data-testid="notification-center-list"]').exists()).toBe(true);
    const items = w.findAll('[data-testid="notification-center-item-notification"]');
    expect(items.length).toBe(1);
    expect(w.text()).toContain('New friend request');
  });

  it('renders mail items in list', async () => {
    const mail = makeMailItem({ id: 'm-1', mailType: 'REWARD' });
    listMailMock.mockResolvedValue([mail]);
    const w = mountView();
    await flushPromises();
    expect(w.find('[data-testid="notification-center-list"]').exists()).toBe(true);
    const items = w.findAll('[data-testid="notification-center-item-mail"]');
    expect(items.length).toBe(1);
    expect(w.text()).toContain('Welcome reward');
  });

  it('aggregates notifications and mail, sorted by createdAt desc', async () => {
    const oldMail = makeMailItem({
      id: 'm-old',
      subject: 'Old mail',
      createdAt: '2025-01-01T00:00:00.000Z',
    });
    const newNotif = makeNotifRow({
      id: 'n-new',
      createdAt: '2026-05-17T12:00:00.000Z',
    });
    listNotificationsMock.mockResolvedValue({
      notifications: [newNotif],
      unreadCount: 1,
      total: 1,
    });
    listMailMock.mockResolvedValue([oldMail]);
    const w = mountView();
    await flushPromises();
    const allItems = w.findAll('[data-testid^="notification-center-item-"]');
    expect(allItems.length).toBe(2);
    // First item should be the newer notification
    expect(allItems[0].text()).toContain('New friend request');
    expect(allItems[1].text()).toContain('Old mail');
  });

  it('filter "social" shows only social notifications', async () => {
    const notif = makeNotifRow({ id: 'n-social' });
    const mail = makeMailItem({
      id: 'm-reward',
      mailType: 'REWARD',
      subject: 'Reward mail',
    });
    listNotificationsMock.mockResolvedValue({
      notifications: [notif],
      unreadCount: 1,
      total: 1,
    });
    listMailMock.mockResolvedValue([mail]);
    const w = mountView();
    await flushPromises();

    // Default "all" filter shows both
    expect(w.findAll('[data-testid^="notification-center-item-"]').length).toBe(2);

    // Click "social" filter
    await w.find('[data-testid="notification-filter-social"]').trigger('click');
    await flushPromises();
    const items = w.findAll('[data-testid^="notification-center-item-"]');
    expect(items.length).toBe(1);
    expect(items[0].text()).toContain('New friend request');
  });

  it('filter "rewards" shows only reward mail', async () => {
    const notif = makeNotifRow({ id: 'n-social' });
    const mail = makeMailItem({
      id: 'm-reward',
      mailType: 'REWARD',
      subject: 'Reward mail',
    });
    listNotificationsMock.mockResolvedValue({
      notifications: [notif],
      unreadCount: 1,
      total: 1,
    });
    listMailMock.mockResolvedValue([mail]);
    const w = mountView();
    await flushPromises();

    await w.find('[data-testid="notification-filter-rewards"]').trigger('click');
    await flushPromises();
    const items = w.findAll('[data-testid^="notification-center-item-"]');
    expect(items.length).toBe(1);
    expect(items[0].text()).toContain('Reward mail');
  });

  it('filter with no matching items shows empty state', async () => {
    const notif = makeNotifRow({ id: 'n-social' });
    listNotificationsMock.mockResolvedValue({
      notifications: [notif],
      unreadCount: 1,
      total: 1,
    });
    const w = mountView();
    await flushPromises();

    // "combat" filter has nothing
    await w.find('[data-testid="notification-filter-combat"]').trigger('click');
    await flushPromises();
    expect(w.find('[data-testid="notification-center-empty"]').exists()).toBe(true);
  });

  it('mark all read button calls store.markAll', async () => {
    const notif = makeNotifRow({ id: 'n-1' });
    listNotificationsMock.mockResolvedValue({
      notifications: [notif],
      unreadCount: 1,
      total: 1,
    });
    markAllReadMock.mockResolvedValue({ updated: 1, unreadCount: 0 });
    const w = mountView();
    await flushPromises();

    const btn = w.find('[data-testid="notification-center-mark-all"]');
    expect(btn.exists()).toBe(true);
    await btn.trigger('click');
    await flushPromises();
    expect(markAllReadMock).toHaveBeenCalled();
  });

  it('renders OnlineFriendsWidget in sidebar', async () => {
    const w = mountView();
    await flushPromises();
    expect(w.find('[data-testid="online-friends-widget"]').exists()).toBe(true);
  });

  it('deleted mail is excluded from the list', async () => {
    const activeMail = makeMailItem({ id: 'm-active', deleted: false });
    const deletedMail = makeMailItem({ id: 'm-deleted', deleted: true });
    listMailMock.mockResolvedValue([activeMail, deletedMail]);
    const w = mountView();
    await flushPromises();
    const items = w.findAll('[data-testid="notification-center-item-mail"]');
    expect(items.length).toBe(1);
  });

  it('sect mail maps to sect category and is shown under sect filter', async () => {
    const sectMail = makeMailItem({
      id: 'm-sect',
      mailType: 'SECT',
      subject: 'Sect update',
    });
    listMailMock.mockResolvedValue([sectMail]);
    const w = mountView();
    await flushPromises();
    await w.find('[data-testid="notification-filter-sect"]').trigger('click');
    await flushPromises();
    const items = w.findAll('[data-testid="notification-center-item-mail"]');
    expect(items.length).toBe(1);
    expect(w.text()).toContain('Sect update');
  });

  it('purchase mail maps to trading category', async () => {
    const tradeMail = makeMailItem({
      id: 'm-trade',
      mailType: 'PURCHASE',
      subject: 'Purchase confirmation',
    });
    listMailMock.mockResolvedValue([tradeMail]);
    const w = mountView();
    await flushPromises();
    await w.find('[data-testid="notification-filter-trading"]').trigger('click');
    await flushPromises();
    const items = w.findAll('[data-testid="notification-center-item-mail"]');
    expect(items.length).toBe(1);
  });

  it('PVP mail maps to combat category', async () => {
    const pvpMail = makeMailItem({
      id: 'm-pvp',
      mailType: 'PVP',
      subject: 'PVP result',
    });
    listMailMock.mockResolvedValue([pvpMail]);
    const w = mountView();
    await flushPromises();
    await w.find('[data-testid="notification-filter-combat"]').trigger('click');
    await flushPromises();
    const items = w.findAll('[data-testid="notification-center-item-mail"]');
    expect(items.length).toBe(1);
  });
});
