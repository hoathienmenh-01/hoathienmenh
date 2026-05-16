import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, h, nextTick, ref } from 'vue';
import { mount } from '@vue/test-utils';
import { useCountUp } from '@/composables/useCountUp';

/**
 * `useCountUp` composable — Cửu Thiên Mộng Phase 6.
 *
 * Cover:
 *   - default reduce-motion (jsdom env mặc định không có rAF + matchMedia)
 *     → set giá trị target ngay không animate.
 *   - khi mock matchMedia `prefers-reduced-motion: reduce` → bypass animation.
 *   - khi cấp rAF + matchMedia (no reduce) → animate qua các frame, kết thúc
 *     bằng exact target.
 *   - giá trị không phải number hợp lệ → fallback 0.
 *   - không leak rAF khi unmount.
 */
describe('useCountUp', () => {
  let originalRAF: typeof globalThis.requestAnimationFrame | undefined;
  let originalCAF: typeof globalThis.cancelAnimationFrame | undefined;
  let originalMatchMedia: typeof window.matchMedia | undefined;

  beforeEach(() => {
    originalRAF = globalThis.requestAnimationFrame;
    originalCAF = globalThis.cancelAnimationFrame;
    originalMatchMedia = window.matchMedia;
  });

  afterEach(() => {
    globalThis.requestAnimationFrame = originalRAF!;
    globalThis.cancelAnimationFrame = originalCAF!;
    window.matchMedia = originalMatchMedia!;
    document.documentElement.removeAttribute('data-motion');
  });

  function mountWithTarget(initial = 0): {
    target: ReturnType<typeof ref<number>>;
    animated: ReturnType<typeof ref<number>>;
    wrapper: ReturnType<typeof mount>;
  } {
    const target = ref(initial);
    let animated!: ReturnType<typeof ref<number>>;
    const Comp = defineComponent({
      setup() {
        animated = useCountUp(target, { duration: 200 }) as typeof animated;
        return () => h('span', String(animated.value));
      },
    });
    const wrapper = mount(Comp);
    return { target, animated, wrapper };
  }

  it('giá trị khởi tạo bằng target', () => {
    window.matchMedia = vi.fn().mockReturnValue({ matches: true }) as unknown as typeof window.matchMedia;
    const { animated } = mountWithTarget(42);
    expect(animated.value).toBe(42);
  });

  it('reduce motion mode → cập nhật giá trị tức thì khi target đổi', async () => {
    window.matchMedia = vi.fn().mockReturnValue({ matches: true }) as unknown as typeof window.matchMedia;
    const { target, animated } = mountWithTarget(0);
    target.value = 1000;
    await nextTick();
    expect(animated.value).toBe(1000);
  });

  it('data-motion="off" → cập nhật tức thì', async () => {
    window.matchMedia = vi.fn().mockReturnValue({ matches: false }) as unknown as typeof window.matchMedia;
    document.documentElement.setAttribute('data-motion', 'off');
    const { target, animated } = mountWithTarget(0);
    target.value = 500;
    await nextTick();
    expect(animated.value).toBe(500);
  });

  it('không có requestAnimationFrame → fallback tức thì', async () => {
    window.matchMedia = vi.fn().mockReturnValue({ matches: false }) as unknown as typeof window.matchMedia;
    // @ts-expect-error - intentionally clear rAF for fallback path
    globalThis.requestAnimationFrame = undefined;
    const { target, animated } = mountWithTarget(0);
    target.value = 200;
    await nextTick();
    expect(animated.value).toBe(200);
  });

  it('animate qua frame và kết thúc bằng target exact', async () => {
    window.matchMedia = vi.fn().mockReturnValue({ matches: false }) as unknown as typeof window.matchMedia;
    type FrameCb = (ts: number) => void;
    const queue: Array<{ id: number; cb: FrameCb }> = [];
    let nextId = 1;
    globalThis.requestAnimationFrame = ((cb: FrameCb) => {
      const id = nextId++;
      queue.push({ id, cb });
      return id;
    }) as typeof globalThis.requestAnimationFrame;
    globalThis.cancelAnimationFrame = ((id: number) => {
      const idx = queue.findIndex((q) => q.id === id);
      if (idx !== -1) queue.splice(idx, 1);
    }) as typeof globalThis.cancelAnimationFrame;

    const { target, animated } = mountWithTarget(0);
    target.value = 100;
    await nextTick();
    expect(queue.length).toBe(1);

    // Half duration → giá trị giữa 0 và 100 (exclusive)
    let frame = queue.shift()!;
    frame.cb(performance.now() + 100);
    expect(animated.value).toBeGreaterThan(0);
    expect(animated.value).toBeLessThan(100);

    // Past duration → snap về target.
    frame = queue.shift()!;
    frame.cb(performance.now() + 10_000);
    expect(animated.value).toBe(100);
    expect(queue.length).toBe(0);
  });

  it('giá trị không phải number hợp lệ → fallback 0', async () => {
    window.matchMedia = vi.fn().mockReturnValue({ matches: true }) as unknown as typeof window.matchMedia;
    const { target, animated } = mountWithTarget(50);
    // simulate NaN
    target.value = Number.NaN;
    await nextTick();
    expect(animated.value).toBe(0);
  });

  it('không leak rAF khi unmount', async () => {
    window.matchMedia = vi.fn().mockReturnValue({ matches: false }) as unknown as typeof window.matchMedia;
    const cancelSpy = vi.fn();
    type FrameCb = (ts: number) => void;
    globalThis.requestAnimationFrame = ((cb: FrameCb): number => {
      void cb;
      return 99;
    }) as typeof globalThis.requestAnimationFrame;
    globalThis.cancelAnimationFrame = ((id: number) => {
      cancelSpy(id);
    }) as typeof globalThis.cancelAnimationFrame;
    const { target, wrapper } = mountWithTarget(0);
    target.value = 50;
    await nextTick();
    wrapper.unmount();
    expect(cancelSpy).toHaveBeenCalled();
  });
});
