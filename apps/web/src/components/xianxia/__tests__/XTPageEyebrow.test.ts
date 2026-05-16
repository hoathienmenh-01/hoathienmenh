import { describe, it, expect } from 'vitest';
import { mount } from '@vue/test-utils';
import XTPageEyebrow from '@/components/xianxia/XTPageEyebrow.vue';
import XTHeroEyebrow from '@/components/xianxia/XTHeroEyebrow.vue';

/**
 * Cửu Thiên Mộng PR3.5 — `XTPageEyebrow` primitive coverage (thuần Việt).
 *
 * Cover:
 *   - default: chỉ render label, không caps.
 *   - caps + label → render cả hai cùng dấu separator.
 *   - testId propagate.
 *   - HTML output không chứa ký tự Hán.
 *
 * Cover backward-compat `XTHeroEyebrow`:
 *   - prop `han` chứa Hán → bị strip (không render caps).
 *   - prop `han` không Hán → render caps fallback.
 *   - prop `caps` luôn ưu tiên.
 *   - HTML output luôn không chứa ký tự Hán.
 */
describe('XTPageEyebrow', () => {
  it('default: chỉ label, không caps, không Hán', () => {
    const w = mount(XTPageEyebrow, { props: { label: 'Tiên Du Quy Xứ' } });
    expect(w.find('[data-testid="xt-page-eyebrow"]').exists()).toBe(true);
    expect(w.find('.xt-page-eyebrow__caps').exists()).toBe(false);
    expect(w.text()).toContain('Tiên Du Quy Xứ');
    expect(/[\u4e00-\u9fff]/.test(w.html())).toBe(false);
  });

  it('caps + label: render cả hai với separator', () => {
    const w = mount(XTPageEyebrow, {
      props: { caps: 'CỬU THIÊN MỘNG', label: 'Cửu Thiên Mộng Cảnh' },
    });
    expect(w.find('.xt-page-eyebrow__caps').exists()).toBe(true);
    expect(w.find('.xt-page-eyebrow__caps').text()).toBe('CỬU THIÊN MỘNG');
    expect(w.text()).toContain('Cửu Thiên Mộng Cảnh');
    expect(w.text()).toContain('·');
  });

  it('testId propagate', () => {
    const w = mount(XTPageEyebrow, {
      props: { label: 'Test', testId: 'home-page-eyebrow' },
    });
    expect(w.attributes('data-testid')).toBe('home-page-eyebrow');
  });
});

describe('XTHeroEyebrow (backward-compat alias)', () => {
  it('prop han chứa Hán → bị strip, không render caps', () => {
    const han = String.fromCharCode(0x4e94) + String.fromCharCode(0x884c);
    const w = mount(XTHeroEyebrow, {
      props: { han, label: 'Ngũ Hành' },
    });
    expect(w.find('.xt-page-eyebrow__caps').exists()).toBe(false);
    expect(/[\u4e00-\u9fff]/.test(w.html())).toBe(false);
  });

  it('prop han không Hán → render caps fallback', () => {
    const w = mount(XTHeroEyebrow, {
      props: { han: 'CTM', label: 'Cửu Thiên Mộng' },
    });
    expect(w.find('.xt-page-eyebrow__caps').exists()).toBe(true);
    expect(w.find('.xt-page-eyebrow__caps').text()).toBe('CTM');
  });

  it('prop caps luôn ưu tiên hơn han', () => {
    const w = mount(XTHeroEyebrow, {
      props: { han: 'IGNORE', caps: 'CTM', label: 'Cửu Thiên Mộng' },
    });
    expect(w.find('.xt-page-eyebrow__caps').text()).toBe('CTM');
  });

  it('default testId là xt-hero-eyebrow', () => {
    const w = mount(XTHeroEyebrow, { props: { label: 'Test' } });
    expect(w.attributes('data-testid')).toBe('xt-hero-eyebrow');
  });
});
