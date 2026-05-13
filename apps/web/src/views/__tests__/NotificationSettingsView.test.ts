import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { createI18n } from 'vue-i18n';
import { setActivePinia, createPinia } from 'pinia';

/**
 * Phase PWA-1 — NotificationSettingsView smoke tests.
 *
 * Covers:
 *   - Unsupported browser state.
 *   - Permission denied state.
 *   - Master enable button when not subscribed.
 *   - Disable button + per-type toggles when subscribed.
 *   - Toggle pref dispatches updatePrefs.
 */

const getVapidPublicKeyMock = vi.fn();
const subscribePushMock = vi.fn();
const unsubscribePushMock = vi.fn();
const getPushPreferencesMock = vi.fn();
const updatePushPreferencesMock = vi.fn();

vi.mock('@/api/webPush', async () => {
  return {
    getVapidPublicKey: (...a: unknown[]) => getVapidPublicKeyMock(...a),
    subscribePush: (...a: unknown[]) => subscribePushMock(...a),
    unsubscribePush: (...a: unknown[]) => unsubscribePushMock(...a),
    listPushSubscriptions: vi.fn().mockResolvedValue([]),
    getPushPreferences: (...a: unknown[]) => getPushPreferencesMock(...a),
    updatePushPreferences: (...a: unknown[]) => updatePushPreferencesMock(...a),
    urlBase64ToUint8Array: (s: string) => new Uint8Array(s.length),
  };
});

import NotificationSettingsView from '@/views/NotificationSettingsView.vue';

function buildI18n() {
  return createI18n({
    legacy: false,
    locale: 'vi',
    fallbackLocale: 'vi',
    missingWarn: false,
    missingFallbackWarn: false,
    messages: {
      vi: {
        common: {
          apiFallback: {
            pushVapid: 'Không tải được khoá.',
            pushSubscribe: 'Đăng ký thất bại.',
            pushUnsubscribe: 'Huỷ thất bại.',
            pushList: 'Không tải được.',
            pushPrefs: 'Không tải được.',
            pushPrefsUpdate: 'Cập nhật thất bại.',
          },
        },
        webPush: {
          title: 'Thông báo đẩy',
          subtitle: 'Sub',
          unsupported: 'Trình duyệt không hỗ trợ.',
          permissionDenied: 'Bạn đã chặn thông báo.',
          masterTitle: 'Bật trên thiết bị',
          masterDescription: 'Cho phép.',
          enable: 'Bật',
          disable: 'Tắt',
          perTypeTitle: 'Loại',
          on: 'Bật',
          off: 'Tắt',
          type: {
            boss: { title: 'Boss', description: 'Boss desc' },
            stamina: { title: 'Stamina', description: 'Stamina desc' },
            mail: { title: 'Mail', description: 'Mail desc' },
            daily: { title: 'Daily', description: 'Daily desc' },
          },
          errors: {
            PERMISSION_DENIED: 'Bị chặn',
            UNSUPPORTED: 'Không hỗ trợ',
            ERROR: 'Lỗi',
            UNKNOWN: 'Lỗi',
          },
        },
      },
    },
  });
}

function freshDefaults() {
  return {
    bossSpawnEnabled: true,
    staminaFullEnabled: true,
    mailEnabled: true,
    dailyReminderEnabled: false,
    quietHoursStart: null,
    quietHoursEnd: null,
    timezone: null,
    updatedAt: new Date().toISOString(),
  };
}

beforeEach(() => {
  setActivePinia(createPinia());
  getVapidPublicKeyMock.mockReset();
  subscribePushMock.mockReset();
  unsubscribePushMock.mockReset();
  getPushPreferencesMock.mockReset();
  updatePushPreferencesMock.mockReset();
  getPushPreferencesMock.mockResolvedValue(freshDefaults());
  updatePushPreferencesMock.mockResolvedValue(freshDefaults());
  getVapidPublicKeyMock.mockResolvedValue('AAAA');
});

function withBrowserApis({
  permission = 'default' as 'default' | 'granted' | 'denied',
  subscribed = false,
  supported = true,
}) {
  if (!supported) {
    // Strip APIs to simulate older browser.
    delete (navigator as { serviceWorker?: unknown }).serviceWorker;
    delete (globalThis as { PushManager?: unknown }).PushManager;
    return;
  }
  const fakeSubscription = subscribed
    ? {
        endpoint: 'https://fcm.googleapis.com/fcm/send/x',
        toJSON: () => ({
          endpoint: 'https://fcm.googleapis.com/fcm/send/x',
          keys: { p256dh: 'p1', auth: 'a1' },
        }),
        unsubscribe: vi.fn().mockResolvedValue(undefined),
      }
    : null;
  const reg = {
    pushManager: {
      getSubscription: vi.fn().mockResolvedValue(fakeSubscription),
      subscribe: vi.fn().mockResolvedValue({
        endpoint: 'https://fcm.googleapis.com/fcm/send/x',
        toJSON: () => ({
          endpoint: 'https://fcm.googleapis.com/fcm/send/x',
          keys: { p256dh: 'p1', auth: 'a1' },
        }),
        unsubscribe: vi.fn().mockResolvedValue(undefined),
      }),
    },
  };
  Object.defineProperty(navigator, 'serviceWorker', {
    configurable: true,
    value: { ready: Promise.resolve(reg) },
  });
  (globalThis as { PushManager?: unknown }).PushManager = function () {};
  (globalThis as { Notification?: unknown }).Notification = Object.assign(
    function () {},
    {
      permission,
      requestPermission: vi.fn().mockResolvedValue(permission),
    },
  );
}

describe('Phase PWA-1 — NotificationSettingsView', () => {
  it('renders unsupported state when browser lacks SW + PushManager', async () => {
    withBrowserApis({ supported: false });
    const w = mount(NotificationSettingsView, {
      global: { plugins: [buildI18n()] },
    });
    await flushPromises();
    expect(w.find('[data-testid="webpush-unsupported"]').exists()).toBe(true);
  });

  it('renders denied state when Notification.permission === "denied"', async () => {
    withBrowserApis({ permission: 'denied' });
    const w = mount(NotificationSettingsView, {
      global: { plugins: [buildI18n()] },
    });
    await flushPromises();
    expect(w.find('[data-testid="webpush-denied"]').exists()).toBe(true);
  });

  it('shows enable button when not subscribed', async () => {
    withBrowserApis({ permission: 'default', subscribed: false });
    const w = mount(NotificationSettingsView, {
      global: { plugins: [buildI18n()] },
    });
    await flushPromises();
    expect(w.find('[data-testid="webpush-enable"]').exists()).toBe(true);
    expect(w.find('[data-testid="webpush-disable"]').exists()).toBe(false);
  });

  it('shows disable button + per-type prefs when subscribed', async () => {
    withBrowserApis({ permission: 'granted', subscribed: true });
    const w = mount(NotificationSettingsView, {
      global: { plugins: [buildI18n()] },
    });
    await flushPromises();
    expect(w.find('[data-testid="webpush-disable"]').exists()).toBe(true);
    expect(w.find('[data-testid="webpush-prefs"]').exists()).toBe(true);
    expect(w.find('[data-testid="webpush-toggle-boss"]').exists()).toBe(true);
    expect(w.find('[data-testid="webpush-toggle-stamina"]').exists()).toBe(true);
    expect(w.find('[data-testid="webpush-toggle-mail"]').exists()).toBe(true);
    expect(w.find('[data-testid="webpush-toggle-daily"]').exists()).toBe(true);
  });

  it('clicking a per-type toggle dispatches updatePushPreferences', async () => {
    withBrowserApis({ permission: 'granted', subscribed: true });
    const w = mount(NotificationSettingsView, {
      global: { plugins: [buildI18n()] },
    });
    await flushPromises();
    await w.find('[data-testid="webpush-toggle-mail"]').trigger('click');
    await flushPromises();
    expect(updatePushPreferencesMock).toHaveBeenCalledTimes(1);
    expect(updatePushPreferencesMock).toHaveBeenCalledWith({
      mailEnabled: false,
    });
  });

  it('clicking enable triggers permission request + subscribe API call', async () => {
    withBrowserApis({ permission: 'default', subscribed: false });
    subscribePushMock.mockResolvedValue({
      id: 's1',
      endpoint: 'https://fcm.googleapis.com/fcm/send/x',
      userAgent: 'UA',
      enabled: true,
      createdAt: new Date().toISOString(),
      lastUsedAt: null,
    });
    // Update Notification.permission to 'granted' after request.
    (
      globalThis as {
        Notification: { permission: string; requestPermission: () => Promise<string> };
      }
    ).Notification.requestPermission = vi.fn().mockResolvedValue('granted');
    const w = mount(NotificationSettingsView, {
      global: { plugins: [buildI18n()] },
    });
    await flushPromises();
    await w.find('[data-testid="webpush-enable"]').trigger('click');
    await flushPromises();
    expect(getVapidPublicKeyMock).toHaveBeenCalledTimes(1);
    expect(subscribePushMock).toHaveBeenCalledTimes(1);
  });
});
