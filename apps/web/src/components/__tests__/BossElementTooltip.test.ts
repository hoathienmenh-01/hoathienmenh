/**
 * Phase 14.2.D — Tests cho `apps/web/src/components/BossElementTooltip.vue`.
 *
 * Lock-in:
 *   - Render boss element + weakness badge khi có.
 *   - Render resist elements list khi non-empty.
 *   - Render reward hint badge khi có.
 *   - Warning visibility theo player primary element vs boss element.
 *   - data-testid prefix consistent (boss-${bossKey}).
 */
import { describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import { createI18n } from 'vue-i18n';

import BossElementTooltip from '@/components/BossElementTooltip.vue';
import viMessages from '@/i18n/vi.json';

function makeI18n() {
  return createI18n({
    legacy: false,
    locale: 'vi',
    fallbackLocale: 'vi',
    messages: { vi: viMessages },
  });
}

const mountTooltip = (props: Record<string, unknown> = {}) =>
  mount(BossElementTooltip, {
    props,
    global: { plugins: [makeI18n()] },
  });

describe('BossElementTooltip — element + weakness', () => {
  it('element=hoa + weaknessElement=thuy → render cả 2 badge', () => {
    const w = mountTooltip({
      element: 'hoa',
      weaknessElement: 'thuy',
      testIdPrefix: 'boss-fb',
    });
    expect(w.find('[data-testid="boss-fb-element"]').exists()).toBe(true);
    expect(w.find('[data-testid="boss-fb-weakness"]').exists()).toBe(true);
  });

  it('weaknessElement=null → KHÔNG render weakness badge', () => {
    const w = mountTooltip({
      element: 'hoa',
      weaknessElement: null,
      testIdPrefix: 'boss-now',
    });
    expect(w.find('[data-testid="boss-now-weakness"]').exists()).toBe(false);
  });
});

describe('BossElementTooltip — resist elements', () => {
  it('resistElements non-empty → render section + child badges', () => {
    const w = mountTooltip({
      element: 'hoa',
      resistElements: ['hoa', 'kim'],
      testIdPrefix: 'boss-rs',
    });
    expect(w.find('[data-testid="boss-rs-resists"]').exists()).toBe(true);
    expect(w.find('[data-testid="boss-rs-resist-hoa"]').exists()).toBe(true);
    expect(w.find('[data-testid="boss-rs-resist-kim"]').exists()).toBe(true);
  });

  it('resistElements rỗng → KHÔNG render section', () => {
    const w = mountTooltip({
      element: 'hoa',
      resistElements: [],
      testIdPrefix: 'boss-nrs',
    });
    expect(w.find('[data-testid="boss-nrs-resists"]').exists()).toBe(false);
  });
});

describe('BossElementTooltip — reward hint + warning', () => {
  it('rewardElementHint=kim → render reward badge', () => {
    const w = mountTooltip({
      element: 'kim',
      rewardElementHint: 'kim',
      testIdPrefix: 'boss-rh',
    });
    expect(w.find('[data-testid="boss-rh-reward-hint"]').exists()).toBe(true);
  });

  it('player thuy vs boss hoa → recommended warning', () => {
    const w = mountTooltip({
      element: 'hoa',
      playerPrimaryElement: 'thuy',
      testIdPrefix: 'boss-w1',
    });
    const warn = w.find('[data-testid="boss-w1-element-warning"]');
    expect(warn.exists()).toBe(true);
    expect(warn.attributes('data-warning')).toBe('recommended');
  });

  it('player hoa vs boss thuy → warning (player bị khắc)', () => {
    const w = mountTooltip({
      element: 'thuy',
      playerPrimaryElement: 'hoa',
      testIdPrefix: 'boss-w2',
    });
    const warn = w.find('[data-testid="boss-w2-element-warning"]');
    expect(warn.exists()).toBe(true);
    expect(warn.attributes('data-warning')).toBe('warning');
  });

  it('boss vô hệ → KHÔNG render warning', () => {
    const w = mountTooltip({
      element: null,
      playerPrimaryElement: 'kim',
      testIdPrefix: 'boss-w3',
    });
    expect(w.find('[data-testid="boss-w3-element-warning"]').exists()).toBe(
      false,
    );
  });
});
