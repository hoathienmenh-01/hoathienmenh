/**
 * Cửu Thiên Mộng — XTPullRefresh tests (Phase 10).
 *
 * Verify pull-to-refresh primitive behaviour:
 *  - Render default slot.
 *  - Imperative `trigger()` enters refreshing state until handler resolves.
 *  - testId data attributes propagate.
 *  - Refresh handler receives no args; resolve/reject both reset state.
 */
import { describe, expect, it, vi } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import XTPullRefresh from '../XTPullRefresh.vue';

describe('XTPullRefresh', () => {
  it('renders default slot content', () => {
    const onRefresh = vi.fn().mockResolvedValue(undefined);
    const wrapper = mount(XTPullRefresh, {
      props: { onRefresh },
      slots: { default: '<p data-testid="child">hello</p>' },
    });
    expect(wrapper.find('[data-testid="child"]').exists()).toBe(true);
    expect(wrapper.find('[data-testid="xt-pull-refresh"]').exists()).toBe(true);
  });

  it('propagates testId override', () => {
    const onRefresh = vi.fn().mockResolvedValue(undefined);
    const wrapper = mount(XTPullRefresh, {
      props: { onRefresh, testId: 'mail-refresh' },
    });
    expect(wrapper.find('[data-testid="mail-refresh"]').exists()).toBe(true);
  });

  it('imperative trigger() invokes handler and resets state', async () => {
    let resolve!: () => void;
    const pending = new Promise<void>((r) => {
      resolve = r;
    });
    const onRefresh = vi.fn(() => pending);
    const wrapper = mount(XTPullRefresh, { props: { onRefresh } });

    // Cast to expose `trigger`.
    const exposed = wrapper.vm as unknown as { trigger: () => Promise<void> };
    const finished = exposed.trigger();
    await wrapper.vm.$nextTick();

    expect(onRefresh).toHaveBeenCalledOnce();
    expect(wrapper.classes('xt-pull-refresh--refreshing')).toBe(true);
    expect(wrapper.find('[data-testid="xt-pull-refresh-seal"]').exists()).toBe(true);

    resolve();
    await finished;
    await flushPromises();
    expect(wrapper.classes('xt-pull-refresh--refreshing')).toBe(false);
  });

  it('resets state if handler rejects', async () => {
    const onRefresh = vi.fn().mockRejectedValue(new Error('boom'));
    const wrapper = mount(XTPullRefresh, { props: { onRefresh } });
    const exposed = wrapper.vm as unknown as { trigger: () => Promise<void> };
    await exposed.trigger();
    await flushPromises();
    expect(wrapper.classes('xt-pull-refresh--refreshing')).toBe(false);
  });

  it('ignores trigger when disabled flag stays unchanged but handler still runs imperatively', async () => {
    // Note: `disabled` only blocks the touch path; imperative trigger remains
    // available for callers that need a programmatic refresh.
    const onRefresh = vi.fn().mockResolvedValue(undefined);
    const wrapper = mount(XTPullRefresh, { props: { onRefresh, disabled: true } });
    const exposed = wrapper.vm as unknown as { trigger: () => Promise<void> };
    await exposed.trigger();
    await flushPromises();
    expect(onRefresh).toHaveBeenCalledOnce();
  });

  it('does not double-fire when trigger called twice mid-flight', async () => {
    let resolve!: () => void;
    const pending = new Promise<void>((r) => {
      resolve = r;
    });
    const onRefresh = vi.fn(() => pending);
    const wrapper = mount(XTPullRefresh, { props: { onRefresh } });
    const exposed = wrapper.vm as unknown as { trigger: () => Promise<void> };
    const first = exposed.trigger();
    const second = exposed.trigger();
    await wrapper.vm.$nextTick();
    expect(onRefresh).toHaveBeenCalledOnce();
    resolve();
    await first;
    await second;
    await flushPromises();
  });
});
