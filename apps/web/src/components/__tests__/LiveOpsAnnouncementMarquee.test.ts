/**
 * Phase 15.3.B — LiveOpsAnnouncementMarquee tests.
 *
 * Cover:
 *   - empty state: render NULL khi không có announcement (không chiếm chỗ).
 *   - render banner ACTIVE với title VI + severity badge.
 *   - dismiss button → ẩn banner local (sessionStorage).
 *   - WS broadcast ANNOUNCEMENT_ACTIVE → push toast + upsert vào store.
 *   - WS broadcast ANNOUNCEMENT_ENDED → remove khỏi list.
 *   - WS broadcast LIVEOPS_EVENT_ACTIVE → push toast + bump
 *     `lastEventBroadcastAt`.
 *   - severity → toast type mapping (WARNING → warning, MAINTENANCE → error).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { createI18n } from 'vue-i18n';
import { createPinia, setActivePinia } from 'pinia';
import type {
  LiveOpsAnnouncementBroadcastPayload,
  LiveOpsAnnouncementPublicView,
  LiveOpsEventBroadcastPayload,
  WsFrame,
} from '@xuantoi/shared';

const getActiveAnnouncementsMock = vi.fn();
vi.mock('@/api/liveopsAnnouncement', () => ({
  getActiveLiveOpsAnnouncements: (...a: unknown[]) =>
    getActiveAnnouncementsMock(...a),
}));

// Capture WS handlers registered by the component.
type AnyHandler = (frame: WsFrame<unknown>) => void;
const wsHandlers = new Map<string, Set<AnyHandler>>();
vi.mock('@/ws/client', () => ({
  on: (type: string, fn: AnyHandler) => {
    let set = wsHandlers.get(type);
    if (!set) {
      set = new Set();
      wsHandlers.set(type, set);
    }
    set.add(fn);
    return () => set?.delete(fn);
  },
}));

import LiveOpsAnnouncementMarquee from '@/components/LiveOpsAnnouncementMarquee.vue';
import { useLiveOpsAnnouncementStore } from '@/stores/liveopsAnnouncements';
import { useToastStore } from '@/stores/toast';

const i18n = createI18n({
  legacy: false,
  locale: 'vi',
  fallbackLocale: 'vi',
  messages: {
    vi: {
      liveopsAnnouncementMarquee: {
        aria: 'Thông báo sự kiện',
        dismiss: 'Đóng thông báo',
        endsIn: 'Còn {time}',
        severity: {
          INFO: 'Thông tin',
          EVENT: 'Sự kiện',
          WARNING: 'Cảnh báo',
          MAINTENANCE: 'Bảo trì',
        },
        toast: {
          eventActive: 'Sự kiện đã bắt đầu: {title}',
          eventEnded: 'Sự kiện đã kết thúc: {title}',
        },
      },
      toast: {
        title: {
          info: 'Thông tin',
          warning: 'Cảnh báo',
          error: 'Lỗi',
          success: 'Thành công',
          system: 'Hệ thống',
        },
      },
    },
  },
});

function makeView(
  over: Partial<LiveOpsAnnouncementPublicView> = {},
): LiveOpsAnnouncementPublicView {
  return {
    key: 'ann-1',
    severity: 'INFO',
    target: 'ALL',
    titleVi: 'Tiêu đề VI',
    titleEn: 'Title EN',
    messageVi: 'Nội dung VI',
    messageEn: 'Body EN',
    startsAt: new Date(Date.now() - 60_000).toISOString(),
    endsAt: new Date(Date.now() + 3_600_000).toISOString(),
    ...over,
  };
}

function frame<T>(payload: T): WsFrame<T> {
  return { type: 'liveops:announcement', ts: Date.now(), payload } as WsFrame<T>;
}

beforeEach(() => {
  setActivePinia(createPinia());
  getActiveAnnouncementsMock.mockReset();
  wsHandlers.clear();
  try {
    sessionStorage.clear();
  } catch {
    /* ignore */
  }
});

afterEach(() => {
  vi.useRealTimers();
});

describe('LiveOpsAnnouncementMarquee', () => {
  it('empty state — không render banner khi không có announcement', async () => {
    getActiveAnnouncementsMock.mockResolvedValue([]);
    const wrapper = mount(LiveOpsAnnouncementMarquee, {
      global: { plugins: [i18n] },
    });
    await flushPromises();
    expect(
      wrapper.find('[data-test="liveops-announcement-marquee-banner"]').exists(),
    ).toBe(false);
  });

  it('render ACTIVE banner với severity badge + title VI', async () => {
    getActiveAnnouncementsMock.mockResolvedValue([makeView()]);
    const wrapper = mount(LiveOpsAnnouncementMarquee, {
      global: { plugins: [i18n] },
    });
    await flushPromises();
    const banner = wrapper.find(
      '[data-test="liveops-announcement-marquee-banner"]',
    );
    expect(banner.exists()).toBe(true);
    expect(banner.text()).toContain('Tiêu đề VI');
    expect(banner.text()).toContain('Nội dung VI');
    expect(banner.text()).toContain('Thông tin'); // severity badge VI
  });

  it('dismiss button → ẩn banner cụ thể', async () => {
    getActiveAnnouncementsMock.mockResolvedValue([
      makeView({ key: 'ann-keep' }),
      makeView({ key: 'ann-go' }),
    ]);
    const wrapper = mount(LiveOpsAnnouncementMarquee, {
      global: { plugins: [i18n] },
    });
    await flushPromises();
    expect(
      wrapper.findAll('[data-test="liveops-announcement-marquee-banner"]'),
    ).toHaveLength(2);

    // Click dismiss của banner ann-go
    const banners = wrapper.findAll(
      '[data-test="liveops-announcement-marquee-banner"]',
    );
    const targetIdx = banners.findIndex(
      (b) => b.attributes('data-announcement-key') === 'ann-go',
    );
    await banners[targetIdx]!
      .find('[data-test="liveops-announcement-marquee-dismiss"]')
      .trigger('click');
    await flushPromises();

    const remaining = wrapper.findAll(
      '[data-test="liveops-announcement-marquee-banner"]',
    );
    expect(remaining).toHaveLength(1);
    expect(remaining[0]!.attributes('data-announcement-key')).toBe('ann-keep');
  });

  it('WS ANNOUNCEMENT_ACTIVE → upsert vào store + push toast', async () => {
    getActiveAnnouncementsMock.mockResolvedValue([]);
    mount(LiveOpsAnnouncementMarquee, { global: { plugins: [i18n] } });
    await flushPromises();

    const handlers = wsHandlers.get('liveops:announcement');
    expect(handlers).toBeDefined();
    expect(handlers!.size).toBeGreaterThan(0);

    const payload: LiveOpsAnnouncementBroadcastPayload = {
      type: 'ANNOUNCEMENT_ACTIVE',
      key: 'ann-ws',
      severity: 'WARNING',
      target: 'ALL',
      title: 'WS title',
      message: 'WS message',
      titleVi: 'WS VI',
      titleEn: 'WS EN',
      messageVi: 'WS msg VI',
      messageEn: 'WS msg EN',
      startsAt: new Date(Date.now() - 60_000).toISOString(),
      endsAt: new Date(Date.now() + 3_600_000).toISOString(),
    };
    for (const fn of handlers!) fn(frame(payload));
    await flushPromises();

    const store = useLiveOpsAnnouncementStore();
    expect(store.announcements.find((a) => a.key === 'ann-ws')).toBeDefined();

    const toast = useToastStore();
    expect(toast.toasts.some((t) => t.type === 'warning')).toBe(true);
  });

  it('WS ANNOUNCEMENT_ENDED → remove khỏi list', async () => {
    getActiveAnnouncementsMock.mockResolvedValue([makeView({ key: 'ann-end' })]);
    mount(LiveOpsAnnouncementMarquee, { global: { plugins: [i18n] } });
    await flushPromises();

    const store = useLiveOpsAnnouncementStore();
    expect(store.announcements.length).toBe(1);

    const handlers = wsHandlers.get('liveops:announcement')!;
    const ended: LiveOpsAnnouncementBroadcastPayload = {
      type: 'ANNOUNCEMENT_ENDED',
      key: 'ann-end',
      severity: 'INFO',
      target: 'ALL',
      title: 'X',
      message: 'X',
      titleVi: 'X',
      titleEn: null,
      messageVi: 'X',
      messageEn: null,
      startsAt: new Date(Date.now() - 3_600_000).toISOString(),
      endsAt: new Date(Date.now() - 60_000).toISOString(),
    };
    for (const fn of handlers) fn(frame(ended));
    await flushPromises();

    expect(store.announcements.length).toBe(0);
  });

  it('WS LIVEOPS_EVENT_ACTIVE → push toast + bump lastEventBroadcastAt', async () => {
    getActiveAnnouncementsMock.mockResolvedValue([]);
    mount(LiveOpsAnnouncementMarquee, { global: { plugins: [i18n] } });
    await flushPromises();

    const store = useLiveOpsAnnouncementStore();
    const before = store.lastEventBroadcastAt;

    const handlers = wsHandlers.get('liveops:event')!;
    const eventPayload: LiveOpsEventBroadcastPayload = {
      type: 'LIVEOPS_EVENT_ACTIVE',
      eventKey: 'event-x',
      eventType: 'DOUBLE_DUNGEON_DROP',
      title: 'Double drop',
      description: 'desc',
      startsAt: new Date(Date.now() - 60_000).toISOString(),
      endsAt: new Date(Date.now() + 3_600_000).toISOString(),
      runtimeSupported: true,
    };
    for (const fn of handlers) fn(frame(eventPayload));
    await flushPromises();

    expect(store.lastEventBroadcastAt).toBeGreaterThan(before);

    const toast = useToastStore();
    expect(
      toast.toasts.some((t) => t.text.includes('Double drop')),
    ).toBe(true);
  });
});
