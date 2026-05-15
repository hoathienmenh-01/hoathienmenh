import { describe, it, expect } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import MTabs from '@/components/ui/MTabs.vue';
import type { MTabsItem } from '@/components/ui/MTabs.vue';

const ITEMS: MTabsItem[] = [
  { value: 'overview', label: 'Tổng quan' },
  { value: 'detail', label: 'Chi tiết' },
  { value: 'history', label: 'Lịch sử', badge: '99+' },
  { value: 'blocked', label: 'Khoá', disabled: true },
];

/**
 * MTabs primitive — Phase 5 navigation primitive.
 *
 * Cover:
 *   - render đủ tab + ARIA tablist + aria-selected/tabindex.
 *   - uncontrolled: defaultValue → active tab; click → swap active; emit update:value + change.
 *   - controlled: prop `value` source of truth; click → emit nhưng không tự đổi.
 *   - keyboard: ArrowLeft / ArrowRight / Home / End skip disabled.
 *   - badge render khi item.badge truthy; ẩn khi undefined.
 *   - tone class: m-tabs--silk default; minimal / pill.
 *   - sticky class.
 *   - testId propagate root + tab[id] + tab[aria-controls].
 */
describe('MTabs', () => {
  it('render đủ tab với role="tab" + aria-selected', () => {
    const w = mount(MTabs, { props: { items: ITEMS, defaultValue: 'overview' } });
    const tabs = w.findAll('[role="tab"]');
    expect(tabs).toHaveLength(4);
    expect(tabs[0]!.attributes('aria-selected')).toBe('true');
    expect(tabs[1]!.attributes('aria-selected')).toBe('false');
  });

  it('uncontrolled: defaultValue đặt active + click swap active', async () => {
    const w = mount(MTabs, { props: { items: ITEMS, defaultValue: 'overview' } });
    await w.find('[data-testid="m-tabs-tab-detail"]').trigger('click');
    expect(w.emitted('update:value')?.[0]).toEqual(['detail']);
    expect(w.emitted('change')?.[0]).toEqual(['detail']);
    // active swapped (uncontrolled)
    await flushPromises();
    expect(w.find('[data-testid="m-tabs-tab-detail"]').attributes('aria-selected')).toBe('true');
    expect(w.find('[data-testid="m-tabs-tab-overview"]').attributes('aria-selected')).toBe('false');
  });

  it('uncontrolled: không có defaultValue → tab đầu là active', () => {
    const w = mount(MTabs, { props: { items: ITEMS } });
    expect(w.find('[data-testid="m-tabs-tab-overview"]').attributes('aria-selected')).toBe('true');
  });

  it('controlled: prop value là source of truth; click chỉ emit', async () => {
    const w = mount(MTabs, { props: { items: ITEMS, value: 'overview' } });
    await w.find('[data-testid="m-tabs-tab-detail"]').trigger('click');
    expect(w.emitted('update:value')?.[0]).toEqual(['detail']);
    // active không đổi vì parent chưa update prop
    expect(w.find('[data-testid="m-tabs-tab-overview"]').attributes('aria-selected')).toBe('true');
  });

  it('controlled: prop value đổi → active đổi', async () => {
    const w = mount(MTabs, { props: { items: ITEMS, value: 'overview' } });
    await w.setProps({ value: 'history' });
    expect(w.find('[data-testid="m-tabs-tab-history"]').attributes('aria-selected')).toBe('true');
  });

  it('disabled tab → không thể chọn qua click', async () => {
    const w = mount(MTabs, { props: { items: ITEMS, defaultValue: 'overview' } });
    await w.find('[data-testid="m-tabs-tab-blocked"]').trigger('click');
    expect(w.emitted('update:value')).toBeUndefined();
  });

  it('keyboard ArrowRight skip disabled tab', async () => {
    const w = mount(MTabs, { props: { items: ITEMS, defaultValue: 'history' } });
    // history → next enabled = overview (wrap-around, skip blocked)
    await w.find('[data-testid="m-tabs-tab-history"]').trigger('keydown', { key: 'ArrowRight' });
    expect(w.emitted('update:value')?.at(-1)).toEqual(['overview']);
  });

  it('keyboard ArrowLeft đi lùi enabled tab', async () => {
    const w = mount(MTabs, { props: { items: ITEMS, defaultValue: 'detail' } });
    await w.find('[data-testid="m-tabs-tab-detail"]').trigger('keydown', { key: 'ArrowLeft' });
    expect(w.emitted('update:value')?.at(-1)).toEqual(['overview']);
  });

  it('keyboard Home → tab đầu enabled', async () => {
    const w = mount(MTabs, { props: { items: ITEMS, defaultValue: 'history' } });
    await w.find('[data-testid="m-tabs-tab-history"]').trigger('keydown', { key: 'Home' });
    expect(w.emitted('update:value')?.at(-1)).toEqual(['overview']);
  });

  it('keyboard End → tab cuối enabled (skip disabled)', async () => {
    const w = mount(MTabs, { props: { items: ITEMS, defaultValue: 'overview' } });
    await w.find('[data-testid="m-tabs-tab-overview"]').trigger('keydown', { key: 'End' });
    // last enabled = history (blocked disabled bị skip)
    expect(w.emitted('update:value')?.at(-1)).toEqual(['history']);
  });

  it('badge render khi item.badge truthy', () => {
    const w = mount(MTabs, { props: { items: ITEMS } });
    const historyTab = w.find('[data-testid="m-tabs-tab-history"]');
    expect(historyTab.find('.m-tabs__badge').exists()).toBe(true);
    expect(historyTab.find('.m-tabs__badge').text()).toBe('99+');
    // overview không có badge
    expect(w.find('[data-testid="m-tabs-tab-overview"]').find('.m-tabs__badge').exists()).toBe(false);
  });

  it('tone class default = m-tabs--silk', () => {
    const w = mount(MTabs, { props: { items: ITEMS } });
    expect(w.classes()).toContain('m-tabs--silk');
  });

  it('tone=minimal + tone=pill class apply', () => {
    const minimal = mount(MTabs, { props: { items: ITEMS, tone: 'minimal' } });
    expect(minimal.classes()).toContain('m-tabs--minimal');
    const pill = mount(MTabs, { props: { items: ITEMS, tone: 'pill' } });
    expect(pill.classes()).toContain('m-tabs--pill');
  });

  it('sticky=true → class m-tabs--sticky', () => {
    const w = mount(MTabs, { props: { items: ITEMS, sticky: true } });
    expect(w.classes()).toContain('m-tabs--sticky');
  });

  it('testId propagate root + tab[id] + tab[aria-controls]', () => {
    const w = mount(MTabs, { props: { items: ITEMS, testId: 'sect-tabs' } });
    expect(w.attributes('data-testid')).toBe('sect-tabs');
    const detail = w.find('[data-testid="sect-tabs-tab-detail"]');
    expect(detail.attributes('id')).toBe('sect-tabs-tab-detail');
    expect(detail.attributes('aria-controls')).toBe('sect-tabs-panel-detail');
  });
});
