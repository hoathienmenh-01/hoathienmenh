import { describe, expect, it, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import { createI18n } from 'vue-i18n';
import GameIcon from '@/components/xianxia/GameIcon.vue';
import RealmBadge from '@/components/xianxia/RealmBadge.vue';
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

  it('GameIcon mở rộng — combat/pvp/dungeon/quest/codex/mentor', () => {
    const cases: Array<[string, string]> = [
      ['combat', '⚔'],
      ['pvp', '⚔'],
      ['arena', '⚔'],
      ['dungeon', '⛰'],
      ['encounter', '✺'],
      ['quest', '✎'],
      ['codex', '📖'],
      ['mentor', '☘'],
      ['feedback', '✎'],
      ['wallet', '💰'],
      ['shop', '🏪'],
      ['gift', '🎁'],
      ['weapon', '⚔'],
      ['armor', '🛡'],
      ['fire', '🔥'],
      ['water', '💧'],
    ];
    for (const [name, glyph] of cases) {
      const w = mount(GameIcon, { props: { name } });
      expect(w.text(), name).toContain(glyph);
    }
  });

  it('GameIcon tone tint class reflect prop', () => {
    const cases = ['jade', 'gold', 'seal', 'violet', 'cyan', 'smoke'] as const;
    for (const tone of cases) {
      const w = mount(GameIcon, { props: { name: 'power', tone } });
      expect(w.classes()).toContain(`xt-game-icon--${tone}`);
    }
  });

  it('GameIcon data-icon attr phản ánh name', () => {
    const w = mount(GameIcon, { props: { name: 'codex' } });
    expect(w.attributes('data-icon')).toBe('codex');
  });

  it('GameIcon label → role=img + aria-label', () => {
    const w = mount(GameIcon, { props: { name: 'mail', label: 'Hộp thư' } });
    expect(w.attributes('role')).toBe('img');
    expect(w.attributes('aria-label')).toBe('Hộp thư');
  });

  it('GameIcon không có label → aria-hidden=true', () => {
    const w = mount(GameIcon, { props: { name: 'mail' } });
    expect(w.attributes('aria-hidden')).toBe('true');
  });

  it('RealmBadge default tier=pham → sigil ◈', () => {
    const w = mount(RealmBadge, { props: { label: 'Luyện Khí · Tầng 3' } });
    expect(w.text()).toContain('◈');
    expect(w.text()).toContain('Luyện Khí · Tầng 3');
    expect(w.classes()).toContain('xt-realm-badge--tier-pham');
    expect(w.attributes('data-tier')).toBe('pham');
  });

  it('RealmBadge tier mapping sigil', () => {
    const cases: Array<[string, string]> = [
      ['nhan_tien', '✦'],
      ['tien_gioi', '✺'],
      ['hon_nguyen', '☯'],
      ['ban_nguyen', '✶'],
      ['vinh_hang', '✷'],
    ];
    for (const [tier, sigil] of cases) {
      const w = mount(RealmBadge, {
        props: { label: 'X', tier: tier as never },
      });
      expect(w.text(), tier).toContain(sigil);
      expect(w.classes(), tier).toContain(`xt-realm-badge--tier-${tier}`);
    }
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

  it('visualEffectLevel=OFF thì particle tắt', () => {
    const wrapper = mount(SpiritualAmbientLayer, {
      props: { reducedMotion: false, visualEffectLevel: 'OFF' },
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

  it('Back button fallback về /dashboard nếu không có history', async () => {
    vi.spyOn(window.history, 'length', 'get').mockReturnValue(1);
    const wrapper = mount(XianxiaBackButton, {
      global: { plugins: [i18n] },
    });
    await wrapper.find('[data-testid="xianxia-back-button"]').trigger('click');
    expect(routerPushMock).toHaveBeenCalledWith('/dashboard');
  });
});
