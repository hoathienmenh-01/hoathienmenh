import { describe, it, expect } from 'vitest';
import { mount } from '@vue/test-utils';
import MAccordion from '@/components/ui/MAccordion.vue';

/**
 * MAccordion primitive — Phase 5 disclosure primitive.
 *
 * Cover:
 *   - default uncontrolled: defaultOpen=false → aria-expanded=false; click → toggle.
 *   - controlled: prop `open` source; click → emit nhưng không tự đổi.
 *   - title slot override prop `title`.
 *   - summary slot/prop render bên cạnh title.
 *   - disabled → click không emit; trigger có disabled attr.
 *   - variant + testId propagate (data-testid root + trigger + panel).
 */
describe('MAccordion', () => {
  it('default uncontrolled: closed, aria-expanded=false, panel aria-hidden=true', () => {
    const w = mount(MAccordion, { props: { title: 'Bộ lọc nâng cao' } });
    const trigger = w.find('[data-testid="m-accordion-trigger"]');
    const panel = w.find('[data-testid="m-accordion-panel"]');
    expect(trigger.attributes('aria-expanded')).toBe('false');
    expect(panel.attributes('aria-hidden')).toBe('true');
    expect(w.attributes('data-open')).toBe('false');
  });

  it('defaultOpen=true → mở ngay từ render', () => {
    const w = mount(MAccordion, { props: { title: 'Filter', defaultOpen: true } });
    expect(w.find('[data-testid="m-accordion-trigger"]').attributes('aria-expanded')).toBe('true');
    expect(w.attributes('data-open')).toBe('true');
  });

  it('click trigger → toggle uncontrolled + emit update:open', async () => {
    const w = mount(MAccordion, { props: { title: 'Filter' } });
    await w.find('[data-testid="m-accordion-trigger"]').trigger('click');
    expect(w.emitted('update:open')?.[0]).toEqual([true]);
    expect(w.find('[data-testid="m-accordion-trigger"]').attributes('aria-expanded')).toBe('true');
    await w.find('[data-testid="m-accordion-trigger"]').trigger('click');
    expect(w.emitted('update:open')?.at(-1)).toEqual([false]);
  });

  it('controlled: open prop là source of truth; click chỉ emit', async () => {
    const w = mount(MAccordion, { props: { title: 'Filter', open: false } });
    await w.find('[data-testid="m-accordion-trigger"]').trigger('click');
    expect(w.emitted('update:open')?.[0]).toEqual([true]);
    // aria-expanded vẫn false vì parent chưa update prop
    expect(w.find('[data-testid="m-accordion-trigger"]').attributes('aria-expanded')).toBe('false');
    await w.setProps({ open: true });
    expect(w.find('[data-testid="m-accordion-trigger"]').attributes('aria-expanded')).toBe('true');
  });

  it('title slot override prop title', () => {
    const w = mount(MAccordion, {
      props: { title: 'fallback' },
      slots: { title: '<strong>Slot title</strong>' },
    });
    expect(w.find('.m-accordion__title').text()).toBe('Slot title');
  });

  it('summary prop + summary slot render', () => {
    const w = mount(MAccordion, { props: { title: 'Hi', summary: 'tóm tắt' } });
    expect(w.find('.m-accordion__summary').text()).toBe('tóm tắt');
  });

  it('disabled → click không emit, trigger có disabled attr', async () => {
    const w = mount(MAccordion, { props: { title: 'X', disabled: true } });
    const trigger = w.find('[data-testid="m-accordion-trigger"]');
    expect(trigger.attributes('disabled')).toBeDefined();
    await trigger.trigger('click');
    expect(w.emitted('update:open')).toBeUndefined();
  });

  it('variant=gold/paper → reflect vào class root', () => {
    const gold = mount(MAccordion, { props: { title: 'X', variant: 'gold' } });
    expect(gold.classes()).toContain('m-accordion--gold');
    const paper = mount(MAccordion, { props: { title: 'X', variant: 'paper' } });
    expect(paper.classes()).toContain('m-accordion--paper');
  });

  it('testId propagate root + trigger + panel', () => {
    const w = mount(MAccordion, { props: { title: 'X', testId: 'sect-filters' } });
    expect(w.attributes('data-testid')).toBe('sect-filters');
    expect(w.find('[data-testid="sect-filters-trigger"]').exists()).toBe(true);
    expect(w.find('[data-testid="sect-filters-panel"]').exists()).toBe(true);
    // aria-controls trùng panel id
    expect(w.find('[data-testid="sect-filters-trigger"]').attributes('aria-controls')).toBe(
      'sect-filters-panel',
    );
  });

  it('panel chứa slot default body', () => {
    const w = mount(MAccordion, {
      props: { title: 'X', defaultOpen: true },
      slots: { default: '<p data-test="body">Nội dung</p>' },
    });
    expect(w.find('[data-test="body"]').exists()).toBe(true);
  });
});
