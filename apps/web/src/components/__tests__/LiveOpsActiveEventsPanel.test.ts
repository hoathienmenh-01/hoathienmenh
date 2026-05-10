/**
 * Phase 15.3.A — LiveOpsActiveEventsPanel tests.
 *
 * Cover:
 *   - loading state khi mount, sau đó render list event ACTIVE.
 *   - empty state khi `getActiveLiveOpsEvents` trả [].
 *   - error state khi promise reject.
 *   - render multiplier label cho BOOST (`x1.50`) + DISCOUNT (`30% off`).
 *   - render reward summary cho FESTIVAL_GIFT (linhThach + tienNgoc + items).
 *   - claim button hiển thị cho FESTIVAL_GIFT khi `claimable=true`,
 *     ẩn (thay bằng "alreadyClaimed" text) khi `claimable=false`.
 *   - click claim → confirm prompt → POST API + toast success + refresh.
 *   - claim API throw `EVENT_ALREADY_CLAIMED` → toast error map đúng.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { createI18n } from 'vue-i18n';
import { createPinia, setActivePinia } from 'pinia';

const getActiveLiveOpsEventsMock = vi.fn();
const claimLiveOpsEventRewardMock = vi.fn();

vi.mock('@/api/liveops', () => ({
  getActiveLiveOpsEvents: (...a: unknown[]) =>
    getActiveLiveOpsEventsMock(...a),
  claimLiveOpsEventReward: (...a: unknown[]) =>
    claimLiveOpsEventRewardMock(...a),
}));

import LiveOpsActiveEventsPanel from '@/components/LiveOpsActiveEventsPanel.vue';
import { useToastStore } from '@/stores/toast';
import type { LiveOpsActiveEventPublicView } from '@/api/liveops';

const i18n = createI18n({
  legacy: false,
  locale: 'vi',
  fallbackLocale: 'vi',
  messages: {
    vi: {
      liveopsActiveEvents: {
        title: 'Sự kiện đang diễn ra',
        loading: 'Đang tải sự kiện…',
        empty: 'Chưa có sự kiện nào đang diễn ra.',
        refresh: 'Làm mới',
        endsIn: 'Còn {time}',
        discountLabel: 'Giảm {pct}%',
        boostLabel: 'x{mul}',
        rewardLinhThach: '{n} linh thạch',
        rewardTienNgoc: '{n} tiên ngọc',
        rewardItemsCount: '{n} vật phẩm',
        claimBtn: 'Nhận quà',
        claiming: 'Đang nhận…',
        alreadyClaimed: 'Đã nhận quà.',
        notWired: '(chưa hoạt động)',
        confirmClaim:
          'Nhận quà sự kiện "{title}"? Mỗi nhân vật chỉ nhận được 1 lần.',
        toast: {
          claimed:
            'Đã nhận quà: {linhThach} linh thạch · {tienNgoc} tiên ngọc · {items} vật phẩm.',
        },
        errors: {
          EVENT_ALREADY_CLAIMED: 'Bạn đã nhận quà sự kiện này rồi.',
          EVENT_NOT_ACTIVE: 'Sự kiện không còn hoạt động.',
          EVENT_NOT_CLAIMABLE: 'Sự kiện này không hỗ trợ nhận quà.',
          EVENT_NOT_FOUND: 'Sự kiện không tồn tại.',
          UNAUTHENTICATED: 'Cần đăng nhập trước khi nhận quà.',
          UNKNOWN: 'Không nhận được quà — thử lại.',
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

const SAMPLE_BOOST: LiveOpsActiveEventPublicView = {
  key: 'event_boost_1',
  type: 'DOUBLE_DUNGEON_DROP',
  title: 'Double Drop',
  description: 'Bí cảnh nhân đôi rớt đồ',
  startsAt: '2026-08-01T00:00:00.000Z',
  endsAt: '2026-08-02T00:00:00.000Z',
  publicConfig: { multiplier: 1.5, reward: null },
  claimable: false,
  runtimeSupported: true,
};

const SAMPLE_DISCOUNT: LiveOpsActiveEventPublicView = {
  key: 'event_disc_1',
  type: 'SHOP_DISCOUNT',
  title: 'Shop sale',
  description: 'Giảm giá NPC shop',
  startsAt: '2026-08-01T00:00:00.000Z',
  endsAt: '2026-08-02T00:00:00.000Z',
  publicConfig: { multiplier: 0.3, reward: null },
  claimable: false,
  runtimeSupported: true,
};

const SAMPLE_FESTIVAL_CLAIMABLE: LiveOpsActiveEventPublicView = {
  key: 'event_gift_1',
  type: 'FESTIVAL_GIFT',
  title: 'Tết 2026',
  description: 'Lì xì đầu năm',
  startsAt: '2026-02-01T00:00:00.000Z',
  endsAt: '2026-02-08T00:00:00.000Z',
  publicConfig: {
    multiplier: null,
    reward: { linhThach: 200, tienNgoc: 5, items: [{ itemKey: 'pill_1', qty: 3 }] },
  },
  claimable: true,
  runtimeSupported: true,
};

const SAMPLE_FESTIVAL_CLAIMED: LiveOpsActiveEventPublicView = {
  ...SAMPLE_FESTIVAL_CLAIMABLE,
  key: 'event_gift_2',
  claimable: false,
};

function mountPanel() {
  return mount(LiveOpsActiveEventsPanel, { global: { plugins: [i18n] } });
}

describe('LiveOpsActiveEventsPanel', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    getActiveLiveOpsEventsMock.mockReset();
    claimLiveOpsEventRewardMock.mockReset();
    vi.spyOn(window, 'confirm').mockReturnValue(true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('shows loading then renders empty state when API returns []', async () => {
    getActiveLiveOpsEventsMock.mockResolvedValueOnce([]);
    const w = mountPanel();
    expect(
      w.find('[data-testid="liveops-active-events-loading"]').exists(),
    ).toBe(true);
    await flushPromises();
    expect(
      w.find('[data-testid="liveops-active-events-empty"]').exists(),
    ).toBe(true);
  });

  it('renders error state when API throws', async () => {
    getActiveLiveOpsEventsMock.mockRejectedValueOnce(
      Object.assign(new Error('boom'), { code: 'UNKNOWN' }),
    );
    const w = mountPanel();
    await flushPromises();
    expect(
      w.find('[data-testid="liveops-active-events-error"]').exists(),
    ).toBe(true);
  });

  it('renders boost + discount labels + festival reward summary', async () => {
    getActiveLiveOpsEventsMock.mockResolvedValueOnce([
      SAMPLE_BOOST,
      SAMPLE_DISCOUNT,
      SAMPLE_FESTIVAL_CLAIMABLE,
    ]);
    const w = mountPanel();
    await flushPromises();
    // Boost
    expect(
      w
        .find('[data-testid="liveops-active-event-multiplier-event_boost_1"]')
        .text(),
    ).toBe('x1.50');
    // Discount
    expect(
      w
        .find('[data-testid="liveops-active-event-multiplier-event_disc_1"]')
        .text(),
    ).toBe('Giảm 30%');
    // Festival reward
    expect(
      w.find('[data-testid="liveops-active-event-reward-event_gift_1"]').text(),
    ).toContain('200 linh thạch');
    expect(
      w.find('[data-testid="liveops-active-event-reward-event_gift_1"]').text(),
    ).toContain('5 tiên ngọc');
    expect(
      w.find('[data-testid="liveops-active-event-reward-event_gift_1"]').text(),
    ).toContain('1 vật phẩm');
  });

  it('shows claim button when festival.claimable=true; "already claimed" otherwise', async () => {
    getActiveLiveOpsEventsMock.mockResolvedValueOnce([
      SAMPLE_FESTIVAL_CLAIMABLE,
      SAMPLE_FESTIVAL_CLAIMED,
    ]);
    const w = mountPanel();
    await flushPromises();
    expect(
      w
        .find('[data-testid="liveops-active-event-claim-event_gift_1"]')
        .exists(),
    ).toBe(true);
    expect(
      w
        .find('[data-testid="liveops-active-event-claim-event_gift_2"]')
        .exists(),
    ).toBe(false);
    expect(
      w
        .find('[data-testid="liveops-active-event-claimed-event_gift_2"]')
        .exists(),
    ).toBe(true);
  });

  it('clicking claim calls API + toasts success + refreshes list', async () => {
    getActiveLiveOpsEventsMock
      .mockResolvedValueOnce([SAMPLE_FESTIVAL_CLAIMABLE])
      .mockResolvedValueOnce([SAMPLE_FESTIVAL_CLAIMED]);
    claimLiveOpsEventRewardMock.mockResolvedValueOnce({
      eventKey: 'event_gift_1',
      claimedAt: '2026-02-01T05:00:00.000Z',
      granted: { linhThach: 200, tienNgoc: 5, items: [{ itemKey: 'pill_1', qty: 3 }] },
    });
    const w = mountPanel();
    await flushPromises();
    await w
      .find('[data-testid="liveops-active-event-claim-event_gift_1"]')
      .trigger('click');
    await flushPromises();
    expect(claimLiveOpsEventRewardMock).toHaveBeenCalledWith('event_gift_1');
    const toast = useToastStore();
    expect(
      toast.toasts.some(
        (t) =>
          t.type === 'success' &&
          t.text.includes('200 linh thạch') &&
          t.text.includes('5 tiên ngọc') &&
          t.text.includes('1 vật phẩm'),
      ),
    ).toBe(true);
    // Refresh fetched again.
    expect(getActiveLiveOpsEventsMock).toHaveBeenCalledTimes(2);
  });

  it('claim API rejects with EVENT_ALREADY_CLAIMED → toast error code', async () => {
    getActiveLiveOpsEventsMock.mockResolvedValueOnce([SAMPLE_FESTIVAL_CLAIMABLE]);
    claimLiveOpsEventRewardMock.mockRejectedValueOnce(
      Object.assign(new Error('claimed'), { code: 'EVENT_ALREADY_CLAIMED' }),
    );
    const w = mountPanel();
    await flushPromises();
    await w
      .find('[data-testid="liveops-active-event-claim-event_gift_1"]')
      .trigger('click');
    await flushPromises();
    const toast = useToastStore();
    expect(
      toast.toasts.some(
        (t) =>
          t.type === 'error' &&
          t.text.includes('Bạn đã nhận quà sự kiện này rồi.'),
      ),
    ).toBe(true);
  });
});
