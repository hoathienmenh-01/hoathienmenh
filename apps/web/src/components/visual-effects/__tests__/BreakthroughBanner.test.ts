/**
 * Phase 42.0 — BreakthroughBanner tests.
 */
import { describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import { createI18n } from 'vue-i18n';
import BreakthroughBanner from '../BreakthroughBanner.vue';
import viMessages from '@/i18n/vi.json';

function makeI18n() {
  return createI18n({
    legacy: false,
    locale: 'vi',
    fallbackLocale: 'vi',
    messages: { vi: viMessages },
  });
}

describe('BreakthroughBanner', () => {
  it('renders success — REALM_BREAKTHROUGH effect', () => {
    const w = mount(BreakthroughBanner, {
      props: {
        success: true,
        characterName: 'Đạo Hữu',
        fromRealm: 'Luyện Khí 9',
        toRealm: 'Trúc Cơ 1',
      },
      global: { plugins: [makeI18n()] },
    });
    const el = w.get('[data-testid="breakthrough-banner"]');
    expect(el.attributes('data-success')).toBe('true');
    expect(el.attributes('data-effect-key')).toBe('REALM_BREAKTHROUGH');
    expect(el.text()).toContain('Đạo Hữu');
    expect(el.text()).toContain('Trúc Cơ 1');
  });

  it('renders failed — REALM_BREAKTHROUGH_FAILED effect', () => {
    const w = mount(BreakthroughBanner, {
      props: { success: false },
      global: { plugins: [makeI18n()] },
    });
    const el = w.get('[data-testid="breakthrough-banner"]');
    expect(el.attributes('data-success')).toBe('false');
    expect(el.attributes('data-effect-key')).toBe('REALM_BREAKTHROUGH_FAILED');
  });

  it('body cultivation uses BODY_BREAKTHROUGH effect', () => {
    const w = mount(BreakthroughBanner, {
      props: { success: true, breakthroughType: 'BODY_CULTIVATION' },
      global: { plugins: [makeI18n()] },
    });
    const el = w.get('[data-testid="breakthrough-banner"]');
    expect(el.attributes('data-effect-key')).toBe('BODY_BREAKTHROUGH');
  });

  it('reducedMotion → no glow animation', () => {
    const w = mount(BreakthroughBanner, {
      props: {
        success: true,
        visualEffectLevel: 'HIGH',
        reducedMotion: true,
      },
      global: { plugins: [makeI18n()] },
    });
    const el = w.get('[data-testid="breakthrough-banner"]');
    expect(el.classes().some((c) => c.includes('ve-anim-breakthrough-glow'))).toBe(false);
  });
});
