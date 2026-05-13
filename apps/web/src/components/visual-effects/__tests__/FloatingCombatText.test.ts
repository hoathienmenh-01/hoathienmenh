/**
 * Phase 42.0 — FloatingCombatText smoke tests.
 */
import { describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import FloatingCombatText from '../FloatingCombatText.vue';

function mountFct(props: Record<string, unknown> = {}) {
  return mount(FloatingCombatText as unknown as Parameters<typeof mount>[0], { props });
}

describe('FloatingCombatText', () => {
  it('renders normal damage with formatted amount', () => {
    const w = mountFct({ type: 'normal', amount: 1234 });
    const el = w.get('[data-testid="floating-combat-text"]');
    expect(el.text()).toContain('-1.2K');
    expect(el.attributes('data-effect-key')).toBeTruthy();
    expect(el.classes().some((c) => c.includes('ve-anim-float-up'))).toBe(true);
  });

  it('renders crit with CRIT label and pulse animation', () => {
    const w = mountFct({ type: 'crit', amount: 999, label: 'CRIT' });
    const el = w.get('[data-testid="floating-combat-text"]');
    expect(el.text()).toContain('CRIT');
    expect(el.classes().some((c) => c.includes('ve-anim-pulse-soft'))).toBe(true);
  });

  it('reducedMotion=true → no animation classes', () => {
    const w = mountFct({
      type: 'crit',
      amount: 999,
      reducedMotion: true,
    });
    const el = w.get('[data-testid="floating-combat-text"]');
    expect(el.classes().some((c) => c.includes('ve-anim-float-up'))).toBe(false);
    expect(el.attributes('data-reduced-motion')).toBe('true');
  });

  it('visualEffectLevel=OFF → no float-up class', () => {
    const w = mountFct({
      type: 'normal',
      amount: 100,
      visualEffectLevel: 'OFF',
    });
    const el = w.get('[data-testid="floating-combat-text"]');
    expect(el.classes().some((c) => c.includes('ve-anim-float-up'))).toBe(false);
  });

  it('heal type uses + sign', () => {
    const w = mountFct({ type: 'heal', amount: 250 });
    const el = w.get('[data-testid="floating-combat-text"]');
    expect(el.text()).toContain('+250');
  });

  it('element=FIRE adds element class', () => {
    const w = mountFct({ type: 'dot', amount: 40, element: 'FIRE' });
    const el = w.get('[data-testid="floating-combat-text"]');
    expect(el.classes().some((c) => c === 've-element-fire')).toBe(true);
  });
});
