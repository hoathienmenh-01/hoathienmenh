import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import XTCounter from '@/components/xianxia/XTCounter.vue';

/**
 * XTCounter — Cửu Thiên Mộng Phase 6 micro animation.
 *
 * Cover:
 *   - default props → render giá trị format với grouping.
 *   - prefix + suffix render.
 *   - decimals giữ chính xác cho final value (snap to target trong reduce-
 *     motion env mặc định của jsdom).
 *   - useGrouping=false → không dùng comma.
 *   - format callback override mặc định.
 *   - aria-live=polite.
 */
describe('XTCounter', () => {
  let originalMatchMedia: typeof window.matchMedia | undefined;
  beforeEach(() => {
    originalMatchMedia = window.matchMedia;
    window.matchMedia = vi.fn().mockReturnValue({ matches: true }) as unknown as typeof window.matchMedia;
  });
  afterEach(() => {
    window.matchMedia = originalMatchMedia!;
  });

  it('render value với grouping mặc định', () => {
    const w = mount(XTCounter, { props: { value: 12345 } });
    expect(w.text()).toContain('12,345');
  });

  it('prefix + suffix render xung quanh giá trị', () => {
    const w = mount(XTCounter, {
      props: { value: 99, prefix: '+', suffix: ' EXP' },
    });
    expect(w.text()).toBe('+99 EXP');
  });

  it('decimals giữ chính xác', () => {
    const w = mount(XTCounter, { props: { value: 12.345, decimals: 2 } });
    expect(w.text()).toContain('12.35');
  });

  it('useGrouping=false bỏ comma', () => {
    const w = mount(XTCounter, {
      props: { value: 1234567, useGrouping: false },
    });
    expect(w.text()).toContain('1234567');
    expect(w.text()).not.toContain(',');
  });

  it('format callback override mặc định', () => {
    const w = mount(XTCounter, {
      props: { value: 5, format: (n: number) => `~${n.toFixed(1)}x` },
    });
    expect(w.text()).toContain('~5.0x');
  });

  it('aria-live polite trên root', () => {
    const w = mount(XTCounter, { props: { value: 1 } });
    expect(w.attributes('aria-live')).toBe('polite');
  });

  it('testId propagate', () => {
    const w = mount(XTCounter, {
      props: { value: 1, testId: 'home-power-counter' },
    });
    expect(w.attributes('data-testid')).toBe('home-power-counter');
    expect(w.find('[data-testid="home-power-counter-value"]').exists()).toBe(true);
  });
});
