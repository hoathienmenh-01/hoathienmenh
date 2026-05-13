/**
 * Phase 42.0 — ItemAuraFrame tests.
 */
import { describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import ItemAuraFrame from '../ItemAuraFrame.vue';

describe('ItemAuraFrame', () => {
  it('tier 10 + MYTHIC renders IMMORTAL aura class', () => {
    const w = mount(ItemAuraFrame, {
      props: { tier: 10, rarity: 'MYTHIC' },
      slots: { default: 'X' },
    });
    const el = w.get('[data-testid="item-aura-frame"]');
    expect(el.attributes('data-aura-key')).toBe('ITEM_AURA_IMMORTAL');
    expect(el.classes().some((c) => c === 've-aura-immortal')).toBe(true);
  });

  it('tier 1 + COMMON renders NONE aura — no animation', () => {
    const w = mount(ItemAuraFrame, {
      props: { tier: 1, rarity: 'COMMON' },
    });
    const el = w.get('[data-testid="item-aura-frame"]');
    expect(el.attributes('data-aura-key')).toBe('ITEM_AURA_NONE');
    expect(el.attributes('data-aura-animated')).toBe('false');
  });

  it('reducedMotion=true → no aura-ring class even if LEGENDARY', () => {
    const w = mount(ItemAuraFrame, {
      props: {
        tier: 9,
        rarity: 'LEGENDARY',
        visualEffectLevel: 'HIGH',
        reducedMotion: true,
      },
    });
    const el = w.get('[data-testid="item-aura-frame"]');
    expect(el.classes().some((c) => c.includes('ve-anim-aura-ring'))).toBe(false);
    expect(el.attributes('data-aura-animated')).toBe('false');
  });

  it('element=FIRE adds element class', () => {
    const w = mount(ItemAuraFrame, {
      props: { tier: 5, rarity: 'EPIC', element: 'FIRE' },
    });
    const el = w.get('[data-testid="item-aura-frame"]');
    expect(el.classes().some((c) => c === 've-element-fire')).toBe(true);
  });
});
