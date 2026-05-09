/**
 * Phase 14.2.D — Tests cho `apps/web/src/components/ElementIdentityPanel.vue`.
 *
 * Lock-in:
 *   - Render dominant element badge (luôn) + recommended counter badge
 *     (khi có).
 *   - Show warning text khi player primary element bị target hệ khắc.
 *   - Show recommended hint khi player khắc target.
 *   - Hide warning khi player vô hệ / neutral target.
 *   - data-testid format `${prefix}-dominant-element`,
 *     `${prefix}-recommended-counter`, `${prefix}-element-warning`.
 */
import { describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import { createI18n } from 'vue-i18n';

import ElementIdentityPanel from '@/components/ElementIdentityPanel.vue';
import viMessages from '@/i18n/vi.json';

function makeI18n() {
  return createI18n({
    legacy: false,
    locale: 'vi',
    fallbackLocale: 'vi',
    messages: { vi: viMessages },
  });
}

const mountPanel = (props: Record<string, unknown> = {}) =>
  mount(ElementIdentityPanel, {
    props,
    global: { plugins: [makeI18n()] },
  });

describe('ElementIdentityPanel — dominant element rendering', () => {
  it('dominantElement=hoa → render badge "Hoả"', () => {
    const w = mountPanel({
      dominantElement: 'hoa',
      testIdPrefix: 'd-test',
    });
    expect(w.find('[data-testid="d-test-dominant-element"]').exists()).toBe(true);
  });

  it('dominantElement=null → render neutral badge', () => {
    const w = mountPanel({ dominantElement: null, testIdPrefix: 'd-null' });
    expect(w.find('[data-testid="d-null-dominant-element"]').exists()).toBe(true);
  });

  it('recommendedCounterElement=thuy → render counter badge', () => {
    const w = mountPanel({
      dominantElement: 'hoa',
      recommendedCounterElement: 'thuy',
      testIdPrefix: 'd-rec',
    });
    expect(w.find('[data-testid="d-rec-recommended-counter"]').exists()).toBe(
      true,
    );
  });

  it('recommendedCounterElement=null → KHÔNG render counter badge', () => {
    const w = mountPanel({
      dominantElement: null,
      recommendedCounterElement: null,
      testIdPrefix: 'd-norec',
    });
    expect(w.find('[data-testid="d-norec-recommended-counter"]').exists()).toBe(
      false,
    );
  });
});

describe('ElementIdentityPanel — player warning', () => {
  it('player kim vs target moc → recommended (player khắc target)', () => {
    const w = mountPanel({
      dominantElement: 'moc',
      playerPrimaryElement: 'kim',
      testIdPrefix: 'rec',
    });
    const warn = w.find('[data-testid="rec-element-warning"]');
    expect(warn.exists()).toBe(true);
    expect(warn.attributes('data-warning')).toBe('recommended');
  });

  it('player moc vs target kim → warning (player bị target khắc)', () => {
    const w = mountPanel({
      dominantElement: 'kim',
      playerPrimaryElement: 'moc',
      testIdPrefix: 'warn',
    });
    const warn = w.find('[data-testid="warn-element-warning"]');
    expect(warn.exists()).toBe(true);
    expect(warn.attributes('data-warning')).toBe('warning');
  });

  it('player kim vs target kim → caution', () => {
    const w = mountPanel({
      dominantElement: 'kim',
      playerPrimaryElement: 'kim',
      testIdPrefix: 'caut',
    });
    const warn = w.find('[data-testid="caut-element-warning"]');
    expect(warn.exists()).toBe(true);
    expect(warn.attributes('data-warning')).toBe('caution');
  });

  it('player null + target hoa → KHÔNG render warning', () => {
    const w = mountPanel({
      dominantElement: 'hoa',
      playerPrimaryElement: null,
      testIdPrefix: 'none',
    });
    expect(w.find('[data-testid="none-element-warning"]').exists()).toBe(false);
  });

  it('player kim + target null → KHÔNG render warning', () => {
    const w = mountPanel({
      dominantElement: null,
      playerPrimaryElement: 'kim',
      testIdPrefix: 'no2',
    });
    expect(w.find('[data-testid="no2-element-warning"]').exists()).toBe(false);
  });
});
