/**
 * Phase 42.0 — BossWarningBanner + BossPhaseBadge tests.
 */
import { describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import BossWarningBanner from '../BossWarningBanner.vue';
import BossPhaseBadge from '../BossPhaseBadge.vue';

describe('BossWarningBanner', () => {
  it('renders BOSS_CHARGING with warning severity + turnsRemaining', () => {
    const w = mount(BossWarningBanner, {
      props: {
        bossName: 'Yêu Tướng',
        warningType: 'BOSS_CHARGING',
        severity: 'WARNING',
        turnsRemaining: 2,
      },
    });
    const el = w.get('[data-testid="boss-warning-banner"]');
    expect(el.attributes('data-warning-type')).toBe('BOSS_CHARGING');
    expect(el.attributes('data-severity')).toBe('WARNING');
    expect(el.text()).toContain('Yêu Tướng');
    expect(el.text()).toContain('2 turn');
  });

  it('renders BOSS_ENRAGE with DANGER severity + pulse animation', () => {
    const w = mount(BossWarningBanner, {
      props: {
        bossName: 'X',
        warningType: 'BOSS_ENRAGE',
        severity: 'DANGER',
      },
    });
    const el = w.get('[data-testid="boss-warning-banner"]');
    expect(el.attributes('data-severity')).toBe('DANGER');
    expect(el.classes().some((c) => c.includes('ve-anim-boss-warning-pulse'))).toBe(true);
  });

  it('reducedMotion=true → no pulse animation even DANGER', () => {
    const w = mount(BossWarningBanner, {
      props: {
        bossName: 'X',
        warningType: 'BOSS_ENRAGE',
        severity: 'DANGER',
        reducedMotion: true,
      },
    });
    const el = w.get('[data-testid="boss-warning-banner"]');
    expect(el.classes().some((c) => c.includes('ve-anim-boss-warning-pulse'))).toBe(false);
  });

  it('hpPercent renders rounded HP %', () => {
    const w = mount(BossWarningBanner, {
      props: {
        bossName: 'X',
        warningType: 'BOSS_LOW_HP',
        severity: 'WARNING',
        hpPercent: 0.187,
      },
    });
    const hp = w.get('[data-testid="boss-warning-hp"]');
    expect(hp.text()).toContain('19%');
  });
});

describe('BossPhaseBadge', () => {
  it('renders phase label', () => {
    const w = mount(BossPhaseBadge, { props: { phase: 'BOSS_ENRAGE' } });
    const el = w.get('[data-testid="boss-phase-badge"]');
    expect(el.attributes('data-phase')).toBe('BOSS_ENRAGE');
    expect(el.text().toUpperCase()).toContain('ENRAGE');
  });
});
