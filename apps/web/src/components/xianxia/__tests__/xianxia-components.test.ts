import { describe, expect, it, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import { createI18n } from 'vue-i18n';
import GameIcon from '@/components/xianxia/GameIcon.vue';
import SpiritualAmbientLayer from '@/components/xianxia/SpiritualAmbientLayer.vue';
import TodayChecklistCard from '@/components/xianxia/TodayChecklistCard.vue';
import XianxiaBackButton from '@/components/xianxia/XianxiaBackButton.vue';

const routerPushMock = vi.fn();
const routerBackMock = vi.fn();
vi.mock('vue-router', () => ({
  useRouter: () => ({ push: routerPushMock, back: routerBackMock }),
  RouterLink: {
    props: ['to'],
    template: '<a :href="to"><slot /></a>',
  },
}));

const i18n = createI18n({
  legacy: false,
  locale: 'vi',
  messages: {
    vi: {
      common: { back: 'Quay lại' },
    },
  },
});

describe('xianxia UI primitives', () => {
  it('GameIcon fallback hoạt động', () => {
    const wrapper = mount(GameIcon, {
      props: { name: 'unknown-key' },
    });
    expect(wrapper.text()).toContain('•');
  });

  it('SpiritualAmbientLayer render particles khi effect enabled', () => {
    const wrapper = mount(SpiritualAmbientLayer, {
      props: { reducedMotion: false, visualEffectLevel: 'MEDIUM' },
    });
    expect(wrapper.find('[data-testid="spiritual-ambient-layer"]').exists()).toBe(true);
    expect(wrapper.findAll('[data-testid="qi-particle"]').length).toBeGreaterThan(0);
  });

  it('reduceMotion=true thì particle tắt', () => {
    const wrapper = mount(SpiritualAmbientLayer, {
      props: { reducedMotion: true, visualEffectLevel: 'HIGH' },
    });
    expect(wrapper.find('[data-testid="spiritual-ambient-layer"]').exists()).toBe(true);
    expect(wrapper.findAll('[data-testid="qi-particle"]').length).toBe(0);
  });

  it('TodayChecklist render data và phát navigate event', async () => {
    const wrapper = mount(TodayChecklistCard, {
      props: {
        items: [
          {
            key: 'START_CULTIVATION',
            title: 'Tu luyện',
            description: 'Nhập định',
            route: '/cultivation',
            done: false,
            icon: 'cultivation',
          },
        ],
      },
      global: { plugins: [i18n] },
    });
    expect(wrapper.text()).toContain('Tu luyện');
    await wrapper.find('button').trigger('click');
    expect(wrapper.emitted('navigate')?.[0]).toEqual(['/cultivation']);
  });

  it('TodayChecklist empty state không crash', () => {
    const wrapper = mount(TodayChecklistCard, {
      props: { items: [] },
      global: { plugins: [i18n] },
    });
    expect(wrapper.text()).toContain('0/0');
  });

  it('Back button fallback về /home nếu không có history', async () => {
    vi.spyOn(window.history, 'length', 'get').mockReturnValue(1);
    const wrapper = mount(XianxiaBackButton, {
      global: { plugins: [i18n] },
    });
    await wrapper.find('[data-testid="xianxia-back-button"]').trigger('click');
    expect(routerPushMock).toHaveBeenCalledWith('/home');
  });
});
