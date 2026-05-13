/**
 * Phase 42.0 — CombatFeedbackTimeline tests.
 */
import { describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import CombatFeedbackTimeline from '../CombatFeedbackTimeline.vue';
import type { CombatFeedbackEventInput } from '../CombatFeedbackEvent.vue';

const SAMPLE: CombatFeedbackEventInput[] = [
  { id: 'e1', type: 'ATTACK', message: 'Đạo Hữu công kích Yêu Thú', amount: 234 },
  { id: 'e2', type: 'CRIT', message: 'Bạo kích!', amount: 999, severity: 'WARNING' },
  { id: 'e3', type: 'SYSTEM', message: 'Turn 2 bắt đầu', severity: 'INFO' },
  { id: 'e4', type: 'HEAL', message: 'Hồi máu', amount: 120, severity: 'INFO' },
];

describe('CombatFeedbackTimeline', () => {
  it('renders all events when showCombatLogDetail=true', () => {
    const w = mount(CombatFeedbackTimeline, {
      props: { events: SAMPLE, showCombatLogDetail: true },
    });
    expect(w.findAll('[data-event-type]').length).toBe(4);
  });

  it('hides INFO severity events when showCombatLogDetail=false', () => {
    const w = mount(CombatFeedbackTimeline, {
      props: { events: SAMPLE, showCombatLogDetail: false },
    });
    const rows = w.findAll('[data-event-type]');
    expect(rows.length).toBe(2);
    expect(rows[0].attributes('data-event-type')).toBe('ATTACK');
    expect(rows[1].attributes('data-event-type')).toBe('CRIT');
  });

  it('compactMode toggles compact attr', () => {
    const w = mount(CombatFeedbackTimeline, {
      props: { events: SAMPLE, compactMode: true },
    });
    const root = w.get('[data-testid="combat-feedback-timeline"]');
    expect(root.attributes('data-compact')).toBe('true');
  });
});
