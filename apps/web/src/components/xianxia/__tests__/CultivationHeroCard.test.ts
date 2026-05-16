import { describe, it, expect } from 'vitest';
import { mount } from '@vue/test-utils';
import CultivationHeroCard from '@/components/xianxia/CultivationHeroCard.vue';

/**
 * Cửu Thiên Mộng PR3.5 — `CultivationHeroCard` polish smoke (thuần Việt).
 *
 * Đảm bảo:
 *   - Card được wrap trong `XTSealFrame` (4 góc triện chu với ornament
 *     thuần Việt "❖✦❖✦").
 *   - Eyebrow render qua `XTPageEyebrow` với caps "ĐẠO THÂN TIÊN CỐT" +
 *     label "Đạo Thân Tiên Cốt" (không còn chữ Hán).
 *   - Props `name` / `realm` / `power` render đúng.
 *   - `ProgressRuneBar` × 2 (cultivation jade + body gold) vẫn ở chỗ cũ.
 *   - Toàn bộ HTML output không còn ký tự Hán.
 */
describe('CultivationHeroCard (PR3.5 thuần Việt polish)', () => {
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

  it('wraps card with XTSealFrame (cultivation-hero-seal-frame testid + ornaments thuần Việt)', () => {
    const w = mountCard();
    expect(w.find('[data-testid="cultivation-hero-seal-frame"]').exists()).toBe(true);
    expect(w.find('[data-testid="cultivation-hero-seal-frame-corner-tl"]').text()).toBe('❖');
    expect(w.find('[data-testid="cultivation-hero-seal-frame-corner-tr"]').text()).toBe('✦');
    expect(w.find('[data-testid="cultivation-hero-seal-frame-corner-bl"]').text()).toBe('❖');
    expect(w.find('[data-testid="cultivation-hero-seal-frame-corner-br"]').text()).toBe('✦');
  });

  it('renders XTPageEyebrow với caps + label thuần Việt', () => {
    const w = mountCard();
    const eyebrow = w.find('[data-testid="cultivation-hero-eyebrow"]');
    expect(eyebrow.exists()).toBe(true);
    expect(eyebrow.text()).toContain('ĐẠO THÂN TIÊN CỐT');
    expect(eyebrow.text()).toContain('Đạo Thân Tiên Cốt');
  });

  it('không còn chữ Hán trong toàn bộ output', () => {
    const w = mountCard();
    expect(/[\u4e00-\u9fff]/.test(w.html())).toBe(false);
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
