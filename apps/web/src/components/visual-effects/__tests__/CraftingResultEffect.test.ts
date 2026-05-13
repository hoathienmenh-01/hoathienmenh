/**
 * Phase 42.0 — CraftingResultEffect tests.
 */
import { describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import { createI18n } from 'vue-i18n';
import CraftingResultEffect from '../CraftingResultEffect.vue';
import viMessages from '@/i18n/vi.json';

function makeI18n() {
  return createI18n({
    legacy: false,
    locale: 'vi',
    fallbackLocale: 'vi',
    messages: { vi: viMessages },
  });
}

describe('CraftingResultEffect', () => {
  it('renders ALCHEMY_HIGH_QUALITY result with item name', () => {
    const w = mount(CraftingResultEffect, {
      props: {
        resultType: 'ALCHEMY_HIGH_QUALITY',
        itemName: 'Hoàng Đan',
        quality: 'TIEN',
      },
      global: { plugins: [makeI18n()] },
    });
    const el = w.get('[data-testid="crafting-result-effect"]');
    expect(el.attributes('data-result-type')).toBe('ALCHEMY_HIGH_QUALITY');
    expect(el.text()).toContain('Hoàng Đan');
    expect(el.text()).toContain('TIEN');
  });

  it('renders ALCHEMY_FAIL with red border class', () => {
    const w = mount(CraftingResultEffect, {
      props: { resultType: 'ALCHEMY_FAIL', itemName: 'X' },
      global: { plugins: [makeI18n()] },
    });
    const el = w.get('[data-testid="crafting-result-effect"]');
    expect(el.classes().some((c) => c.includes('border-red-400'))).toBe(true);
  });

  it('ARTIFACT_AWAKEN with visualEffectLevel=HIGH gets glow', () => {
    const w = mount(CraftingResultEffect, {
      props: {
        resultType: 'ARTIFACT_AWAKEN',
        itemName: 'Pháp Bảo',
        visualEffectLevel: 'HIGH',
        reducedMotion: false,
      },
      global: { plugins: [makeI18n()] },
    });
    const el = w.get('[data-testid="crafting-result-effect"]');
    expect(el.classes().some((c) => c.includes('ve-anim-glow-subtle'))).toBe(true);
  });
});
