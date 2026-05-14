import { describe, it, expect, afterEach } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { createI18n } from 'vue-i18n';
import FeaturedActivitiesCard from '@/components/xianxia/FeaturedActivitiesCard.vue';

/**
 * UI-2.0 FeaturedActivitiesCard smoke tests:
 *  - render items với title/status/cooldown/reward chips.
 *  - empty state khi mảng rỗng.
 *  - emit navigate(route) khi click button join.
 */
const i18n = createI18n({
  legacy: false,
  locale: 'vi',
  fallbackLocale: 'vi',
  messages: {
    vi: {
      xt: {
        dashboard: {
          featured: {
            title: 'Hoạt Động Nổi Bật',
            empty: 'Chưa có hoạt động nổi bật.',
            join: 'Tham Gia',
            cooldownActive: 'Hồi',
            rewardPreview: 'Thưởng',
          },
        },
      },
    },
  },
});

let wrapper: ReturnType<typeof mount> | null = null;

afterEach(() => {
  wrapper?.unmount();
  wrapper = null;
  document.body.innerHTML = '';
});

describe('FeaturedActivitiesCard', () => {
  it('items rỗng → render empty state', async () => {
    wrapper = mount(FeaturedActivitiesCard, {
      attachTo: document.body,
      global: { plugins: [i18n] },
      props: { items: [] },
    });
    await flushPromises();
    expect(
      document.querySelector('[data-testid="dashboard-featured-empty"]'),
    ).not.toBeNull();
  });

  it('render items với title + status + reward chips', async () => {
    wrapper = mount(FeaturedActivitiesCard, {
      attachTo: document.body,
      global: { plugins: [i18n] },
      props: {
        items: [
          {
            key: 'boss',
            title: 'Yêu Vương',
            icon: 'boss',
            status: 'Đang mở',
            rewards: ['Linh Thạch', 'Pháp Bảo'],
            tone: 'combat',
            route: '/boss',
          },
        ],
      },
    });
    await flushPromises();
    expect(
      document.querySelector('[data-testid="featured-boss"]'),
    ).not.toBeNull();
    expect(document.body.textContent).toContain('Yêu Vương');
    expect(document.body.textContent).toContain('Đang mở');
    expect(document.body.textContent).toContain('Linh Thạch');
  });

  it('click join → emit navigate(route)', async () => {
    wrapper = mount(FeaturedActivitiesCard, {
      attachTo: document.body,
      global: { plugins: [i18n] },
      props: {
        items: [{ key: 'tower', title: 'Tháp', icon: 'tower', route: '/tower' }],
      },
    });
    await flushPromises();
    document
      .querySelector<HTMLButtonElement>('[data-testid="featured-tower-go"]')!
      .click();
    await flushPromises();
    expect(wrapper.emitted('navigate')).toEqual([['/tower']]);
  });

  it('item không có route → button join disabled, KHÔNG emit', async () => {
    wrapper = mount(FeaturedActivitiesCard, {
      attachTo: document.body,
      global: { plugins: [i18n] },
      props: {
        items: [{ key: 'soon', title: 'Sắp ra mắt', icon: 'event', route: null }],
      },
    });
    await flushPromises();
    const btn = document.querySelector<HTMLButtonElement>(
      '[data-testid="featured-soon-go"]',
    );
    expect(btn?.disabled).toBe(true);
    btn!.click();
    await flushPromises();
    expect(wrapper.emitted('navigate')).toBeUndefined();
  });
});
