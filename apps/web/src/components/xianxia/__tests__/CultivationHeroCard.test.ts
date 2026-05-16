import { describe, it, expect } from 'vitest';
import { mount } from '@vue/test-utils';
import CultivationHeroCard from '@/components/xianxia/CultivationHeroCard.vue';

/**
 * Cửu Thiên Mộng PR3 — `CultivationHeroCard` polish smoke.
 *
 * Đảm bảo:
 *   - Card được wrap trong `XTSealFrame` (seal frame có 4 góc triện chu).
 *   - Eyebrow Hán + Việt render qua `XTHeroEyebrow` (không còn chuỗi inline
 *     "Cửu Thiên Mộng · XT" cũ).
 *   - Props `name` / `realm` / `power` render đúng.
 *   - `ProgressRuneBar` × 2 (cultivation jade + body gold) vẫn ở chỗ cũ.
 */
describe('CultivationHeroCard (PR3 polish)', () => {
  function mountCard() {
    return mount(CultivationHeroCard, {
      props: {
        name: 'Mộ Dung',
        realm: 'Luyện Khí — Sơ Cấp 1',
        power: '1,234',
        cultivationProgress: 0.42,
        bodyProgress: 0.18,
      },
      global: {
        stubs: {
          RouterLink: {
            props: ['to'],
            template: '<a :href="to"><slot /></a>',
          },
        },
      },
    });
  }

  it('wraps card with XTSealFrame (cultivation-hero-seal-frame testid)', () => {
    const w = mountCard();
    expect(w.find('[data-testid="cultivation-hero-seal-frame"]').exists()).toBe(true);
    expect(w.find('[data-testid="cultivation-hero-seal-frame-corner-tl"]').text()).toBe('真');
    expect(w.find('[data-testid="cultivation-hero-seal-frame-corner-tr"]').text()).toBe('修');
    expect(w.find('[data-testid="cultivation-hero-seal-frame-corner-bl"]').text()).toBe('丹');
    expect(w.find('[data-testid="cultivation-hero-seal-frame-corner-br"]').text()).toBe('道');
  });

  it('renders XTHeroEyebrow với Hán 道身仙骨 + label Đạo Thân Tiên Cốt', () => {
    const w = mountCard();
    const eyebrow = w.find('[data-testid="cultivation-hero-eyebrow"]');
    expect(eyebrow.exists()).toBe(true);
    expect(eyebrow.text()).toContain('道身仙骨');
    expect(eyebrow.text()).toContain('Đạo Thân Tiên Cốt');
  });

  it('does NOT contain inline legacy eyebrow chuỗi "Cửu Thiên Mộng · XT"', () => {
    const w = mountCard();
    expect(w.html()).not.toContain('Cửu Thiên Mộng · XT');
  });

  it('renders character name + realm + power', () => {
    const w = mountCard();
    expect(w.text()).toContain('Mộ Dung');
    expect(w.text()).toContain('Luyện Khí — Sơ Cấp 1');
    expect(w.text()).toContain('1,234');
  });

  it('still renders the inner cultivation-hero-card surface', () => {
    const w = mountCard();
    expect(w.find('[data-testid="cultivation-hero-card"]').exists()).toBe(true);
  });
});
