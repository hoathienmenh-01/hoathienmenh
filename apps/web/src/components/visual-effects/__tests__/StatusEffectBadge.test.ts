/**
 * Phase 42.0 — StatusEffectBadge/StatusEffectBar smoke tests.
 */
import { describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import StatusEffectBadge from '../StatusEffectBadge.vue';
import StatusEffectBar from '../StatusEffectBar.vue';

describe('StatusEffectBadge', () => {
  it('renders BURN badge with label and stack', () => {
    const w = mount(StatusEffectBadge, {
      props: { statusKey: 'BURN', stack: 3, durationRemaining: 4 },
    });
    const el = w.get('[data-testid="status-effect-badge"]');
    expect(el.attributes('data-status-key')).toBe('BURN');
    expect(el.text()).toMatch(/Bỏng/);
    expect(el.text()).toContain('×3');
    expect(el.text()).toContain('4');
  });

  it('does not render stack=1', () => {
    const w = mount(StatusEffectBadge, {
      props: { statusKey: 'STUN', stack: 1, durationRemaining: 1 },
    });
    const el = w.get('[data-testid="status-effect-badge"]');
    expect(el.text()).not.toContain('×1');
  });

  it('positive=true buff has glow when level=HIGH and not reduced', () => {
    const w = mount(StatusEffectBadge, {
      props: {
        statusKey: 'ATTACK_UP',
        stack: 1,
        visualEffectLevel: 'HIGH',
        reducedMotion: false,
      },
    });
    const el = w.get('[data-testid="status-effect-badge"]');
    expect(el.attributes('data-positive')).toBe('true');
    expect(el.classes().some((c) => c.includes('ve-anim-glow-subtle'))).toBe(true);
  });

  it('reducedMotion=true → no glow class', () => {
    const w = mount(StatusEffectBadge, {
      props: {
        statusKey: 'ATTACK_UP',
        visualEffectLevel: 'HIGH',
        reducedMotion: true,
      },
    });
    const el = w.get('[data-testid="status-effect-badge"]');
    expect(el.classes().some((c) => c.includes('ve-anim-glow-subtle'))).toBe(false);
  });
});

describe('StatusEffectBar', () => {
  it('renders multiple statuses', () => {
    const w = mount(StatusEffectBar, {
      props: {
        statuses: [
          { key: 'BURN', stack: 2, durationRemaining: 3 },
          { key: 'POISON', stack: 1, durationRemaining: 2 },
          { key: 'ATTACK_UP', stack: 1, durationRemaining: 5 },
        ],
      },
    });
    const badges = w.findAll('[data-testid="status-effect-badge"]');
    expect(badges.length).toBe(3);
  });

  it('renders empty bar when statuses=[]', () => {
    const w = mount(StatusEffectBar, { props: { statuses: [] } });
    expect(w.findAll('[data-testid="status-effect-badge"]').length).toBe(0);
  });
});
