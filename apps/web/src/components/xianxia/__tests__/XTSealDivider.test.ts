import { describe, it, expect } from 'vitest';
import { mount } from '@vue/test-utils';
import XTSealDivider from '@/components/xianxia/XTSealDivider.vue';

/**
 * XTSealDivider primitive — PR3.5 thuần Việt divider.
 *
 * Cover:
 *   - default props → role=separator, mode=default, glyph ❖, tone gold,
 *     align center.
 *   - mode=dot → render `.xt-seal-divider__dot` thay vì seal.
 *   - mode=bare → không render seal hoặc dot.
 *   - glyph: 2 ký tự ok; >2 ký tự bị truncate.
 *   - tone=jade / seal → reflect vào class root.
 *   - align=left / right → class align reflect.
 *   - width raw CSS length → style.width; "full" → 100%.
 *   - testId + ariaLabel propagate.
 *   - glyph chứa Hán → fallback về ❖.
 */
describe('XTSealDivider', () => {
  it('default: role=separator + class baseline', () => {
    const w = mount(XTSealDivider);
    const root = w.element as HTMLElement;
    expect(root.getAttribute('role')).toBe('separator');
    expect(root.classList.contains('xt-seal-divider')).toBe(true);
    expect(root.classList.contains('xt-seal-divider--gold')).toBe(true);
    expect(root.classList.contains('xt-seal-divider--align-center')).toBe(true);
    expect(root.classList.contains('xt-seal-divider--mode-default')).toBe(true);
  });

  it('default: seal render với glyph thuần Việt ❖', () => {
    const w = mount(XTSealDivider);
    const seal = w.find('.xt-seal-divider__seal');
    expect(seal.exists()).toBe(true);
    expect(seal.text()).toBe('❖');
  });

  it('mode=dot → render dot, không render seal', () => {
    const w = mount(XTSealDivider, { props: { mode: 'dot' } });
    expect(w.find('.xt-seal-divider__dot').exists()).toBe(true);
    expect(w.find('.xt-seal-divider__seal').exists()).toBe(false);
  });

  it('mode=bare → không có dot hoặc seal', () => {
    const w = mount(XTSealDivider, { props: { mode: 'bare' } });
    expect(w.find('.xt-seal-divider__seal').exists()).toBe(false);
    expect(w.find('.xt-seal-divider__dot').exists()).toBe(false);
  });

  it('glyph 2 ký tự ok', () => {
    const w = mount(XTSealDivider, { props: { glyph: '✦✦' } });
    expect(w.find('.xt-seal-divider__seal').text()).toBe('✦✦');
  });

  it('glyph >2 ký tự bị truncate', () => {
    const w = mount(XTSealDivider, { props: { glyph: '❀❀❀❀' } });
    expect(w.find('.xt-seal-divider__seal').text()).toBe('❀❀');
  });

  it('glyph chứa Hán → fallback về ❖', () => {
    const han = String.fromCharCode(0x4e00);
    const w = mount(XTSealDivider, { props: { glyph: 'A' + han } });
    expect(w.find('.xt-seal-divider__seal').text()).toBe('❖');
  });

  it('tone=jade reflect class', () => {
    const w = mount(XTSealDivider, { props: { tone: 'jade' } });
    expect(w.classes()).toContain('xt-seal-divider--jade');
  });

  it('tone=seal reflect class', () => {
    const w = mount(XTSealDivider, { props: { tone: 'seal' } });
    expect(w.classes()).toContain('xt-seal-divider--seal');
  });

  it('align=left / right reflect class', () => {
    const left = mount(XTSealDivider, { props: { align: 'left' } });
    expect(left.classes()).toContain('xt-seal-divider--align-left');
    const right = mount(XTSealDivider, { props: { align: 'right' } });
    expect(right.classes()).toContain('xt-seal-divider--align-right');
  });

  it('width=full → style.width=100%', () => {
    const w = mount(XTSealDivider);
    expect((w.element as HTMLElement).style.width).toBe('100%');
  });

  it('width=raw CSS length → propagate', () => {
    const w = mount(XTSealDivider, { props: { width: '320px' } });
    expect((w.element as HTMLElement).style.width).toBe('320px');
  });

  it('testId + ariaLabel propagate', () => {
    const w = mount(XTSealDivider, {
      props: { testId: 'home-section-divider', ariaLabel: 'Sự kiện section' },
    });
    expect(w.attributes('data-testid')).toBe('home-section-divider');
    expect(w.attributes('aria-label')).toBe('Sự kiện section');
  });
});
