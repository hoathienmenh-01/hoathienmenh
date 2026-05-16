import { describe, it, expect } from 'vitest';
import { mount } from '@vue/test-utils';
import XTSealFrame from '@/components/xianxia/XTSealFrame.vue';

/**
 * Cửu Thiên Mộng PR3 — `XTSealFrame` primitive coverage.
 *
 * Cover:
 *   - default props → 4 góc triện chu với glyph `真修丹道`, tone gold,
 *     rounded xl, inset relaxed, không có watermark.
 *   - cornerGlyphs < 4 ký tự → pad bằng glyph cuối.
 *   - cornerGlyphs > 4 ký tự → truncate 4 ký tự đầu.
 *   - cornerGlyphs empty → 4 góc bị ẩn (không render).
 *   - tone variants (`jade`, `seal`) → class root reflect.
 *   - rounded variants (`lg`, `xl`, `2xl`) → class root reflect.
 *   - inset variants (`tight`, `relaxed`) → class root reflect.
 *   - watermark prop → render element + aria-hidden + content.
 *   - interactive prop → class root reflect.
 *   - testId / ariaLabel propagate.
 *   - default slot render bên trong `.xt-seal-frame__content`.
 */
describe('XTSealFrame', () => {
  it('default: 4 góc với glyph 真修丹道 + tone gold + rounded xl + inset relaxed', () => {
    const w = mount(XTSealFrame);
    const root = w.element as HTMLElement;
    expect(root.classList.contains('xt-seal-frame')).toBe(true);
    expect(root.classList.contains('xt-seal-frame--gold')).toBe(true);
    expect(root.classList.contains('xt-seal-frame--rounded-xl')).toBe(true);
    expect(root.classList.contains('xt-seal-frame--inset-relaxed')).toBe(true);
    expect(w.find('[data-testid="xt-seal-frame-corner-tl"]').text()).toBe('真');
    expect(w.find('[data-testid="xt-seal-frame-corner-tr"]').text()).toBe('修');
    expect(w.find('[data-testid="xt-seal-frame-corner-bl"]').text()).toBe('丹');
    expect(w.find('[data-testid="xt-seal-frame-corner-br"]').text()).toBe('道');
  });

  it('cornerGlyphs < 4 ký tự → pad bằng glyph cuối', () => {
    const w = mount(XTSealFrame, { props: { cornerGlyphs: '天' } });
    expect(w.find('[data-testid="xt-seal-frame-corner-tl"]').text()).toBe('天');
    expect(w.find('[data-testid="xt-seal-frame-corner-tr"]').text()).toBe('天');
    expect(w.find('[data-testid="xt-seal-frame-corner-bl"]').text()).toBe('天');
    expect(w.find('[data-testid="xt-seal-frame-corner-br"]').text()).toBe('天');
  });

  it('cornerGlyphs > 4 ký tự → truncate 4 ký tự đầu', () => {
    const w = mount(XTSealFrame, { props: { cornerGlyphs: '九天梦境游' } });
    expect(w.find('[data-testid="xt-seal-frame-corner-tl"]').text()).toBe('九');
    expect(w.find('[data-testid="xt-seal-frame-corner-tr"]').text()).toBe('天');
    expect(w.find('[data-testid="xt-seal-frame-corner-bl"]').text()).toBe('梦');
    expect(w.find('[data-testid="xt-seal-frame-corner-br"]').text()).toBe('境');
  });

  it('cornerGlyphs empty → 4 góc ẩn (không render)', () => {
    const w = mount(XTSealFrame, { props: { cornerGlyphs: '' } });
    expect(w.find('[data-testid="xt-seal-frame-corner-tl"]').exists()).toBe(false);
    expect(w.find('[data-testid="xt-seal-frame-corner-tr"]').exists()).toBe(false);
    expect(w.find('[data-testid="xt-seal-frame-corner-bl"]').exists()).toBe(false);
    expect(w.find('[data-testid="xt-seal-frame-corner-br"]').exists()).toBe(false);
  });

  it('tone=jade reflect class', () => {
    const w = mount(XTSealFrame, { props: { tone: 'jade' } });
    expect(w.classes()).toContain('xt-seal-frame--jade');
    expect(w.classes()).not.toContain('xt-seal-frame--gold');
  });

  it('tone=seal reflect class', () => {
    const w = mount(XTSealFrame, { props: { tone: 'seal' } });
    expect(w.classes()).toContain('xt-seal-frame--seal');
  });

  it('rounded variants (lg / xl / 2xl) reflect class', () => {
    expect(mount(XTSealFrame, { props: { rounded: 'lg' } }).classes()).toContain(
      'xt-seal-frame--rounded-lg',
    );
    expect(mount(XTSealFrame, { props: { rounded: 'xl' } }).classes()).toContain(
      'xt-seal-frame--rounded-xl',
    );
    expect(mount(XTSealFrame, { props: { rounded: '2xl' } }).classes()).toContain(
      'xt-seal-frame--rounded-2xl',
    );
  });

  it('inset=tight reflect class', () => {
    const w = mount(XTSealFrame, { props: { inset: 'tight' } });
    expect(w.classes()).toContain('xt-seal-frame--inset-tight');
  });

  it('watermark prop → render element với aria-hidden + content', () => {
    const w = mount(XTSealFrame, { props: { watermark: '天' } });
    const wm = w.find('[data-testid="xt-seal-frame-watermark"]');
    expect(wm.exists()).toBe(true);
    expect(wm.text()).toBe('天');
    expect(wm.attributes('aria-hidden')).toBe('true');
  });

  it('không watermark → element không render', () => {
    const w = mount(XTSealFrame);
    expect(w.find('[data-testid="xt-seal-frame-watermark"]').exists()).toBe(false);
  });

  it('interactive prop → class root reflect', () => {
    const w = mount(XTSealFrame, { props: { interactive: true } });
    expect(w.classes()).toContain('xt-seal-frame--interactive');
  });

  it('testId + ariaLabel propagate + góc data-testid prefixed', () => {
    const w = mount(XTSealFrame, {
      props: { testId: 'hero-seal-frame', ariaLabel: 'Đạo Thân hero' },
    });
    expect(w.attributes('data-testid')).toBe('hero-seal-frame');
    expect(w.attributes('aria-label')).toBe('Đạo Thân hero');
    expect(w.find('[data-testid="hero-seal-frame-corner-tl"]').exists()).toBe(true);
  });

  it('default slot render bên trong `.xt-seal-frame__content`', () => {
    const w = mount(XTSealFrame, {
      slots: { default: '<span data-testid="slot-child">Tu Tiên</span>' },
    });
    const slot = w.find('[data-testid="slot-child"]');
    expect(slot.exists()).toBe(true);
    expect(slot.text()).toBe('Tu Tiên');
    // Slot phải nằm trong .xt-seal-frame__content (z-index: 2).
    expect(slot.element.parentElement?.classList.contains('xt-seal-frame__content')).toBe(true);
  });

  it('a11y: 4 góc + watermark + border tất cả aria-hidden', () => {
    const w = mount(XTSealFrame, { props: { watermark: '天' } });
    expect(w.find('[data-testid="xt-seal-frame-corner-tl"]').attributes('aria-hidden')).toBe(
      'true',
    );
    expect(w.find('[data-testid="xt-seal-frame-corner-tr"]').attributes('aria-hidden')).toBe(
      'true',
    );
    expect(w.find('[data-testid="xt-seal-frame-corner-bl"]').attributes('aria-hidden')).toBe(
      'true',
    );
    expect(w.find('[data-testid="xt-seal-frame-corner-br"]').attributes('aria-hidden')).toBe(
      'true',
    );
    expect(w.find('[data-testid="xt-seal-frame-watermark"]').attributes('aria-hidden')).toBe(
      'true',
    );
    expect(w.find('.xt-seal-frame__border').attributes('aria-hidden')).toBe('true');
  });
});
