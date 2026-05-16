import { onUnmounted, ref, watch, type Ref } from 'vue';

/**
 * Cửu Thiên Mộng — Phase 6 micro animation.
 *
 * Animate giá trị số khi `target` thay đổi (EXP gain, currency change,
 * power delta). Trả về `Ref<number>` interpolate từ giá trị cũ → target
 * qua khoảng `duration` ms (default 600). Dùng `requestAnimationFrame`,
 * easing `easeOutCubic`. Khi `prefers-reduced-motion: reduce` hoặc
 * `<html data-motion="off">` thì set ngay giá trị (không animate).
 *
 * Mục đích: chỉ animate khi số tăng/giảm nhỏ (delta < 9 chữ số). Với số
 * rất lớn (BigInt linh thạch) caller có thể bypass bằng cách truyền
 * string thẳng vào view.
 */
export interface UseCountUpOptions {
  /** Duration ms cho mỗi delta. Default 600. */
  duration?: number;
  /** Easing function. Default easeOutCubic. */
  easing?: (t: number) => number;
}

function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

function shouldReduceMotion(): boolean {
  if (typeof window === 'undefined') return true;
  if (typeof document !== 'undefined') {
    const motion = document.documentElement?.dataset?.motion;
    if (motion === 'off') return true;
  }
  if (typeof window.matchMedia !== 'function') return false;
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

export function useCountUp(
  target: Ref<number>,
  opts: UseCountUpOptions = {},
): Ref<number> {
  const duration = Math.max(60, opts.duration ?? 600);
  const ease = opts.easing ?? easeOutCubic;

  const current = ref<number>(Number(target.value) || 0);
  let raf: number | null = null;
  let startTs = 0;
  let from = current.value;
  let to = current.value;

  function cancel(): void {
    if (raf != null && typeof cancelAnimationFrame === 'function') {
      cancelAnimationFrame(raf);
    }
    raf = null;
  }

  function step(now: number): void {
    const t = Math.min(1, (now - startTs) / duration);
    const eased = ease(t);
    current.value = from + (to - from) * eased;
    if (t < 1) {
      raf = requestAnimationFrame(step);
    } else {
      current.value = to;
      raf = null;
    }
  }

  watch(
    target,
    (nextRaw) => {
      const next = Number(nextRaw);
      if (!Number.isFinite(next)) {
        current.value = 0;
        return;
      }
      if (shouldReduceMotion() || typeof requestAnimationFrame !== 'function') {
        cancel();
        current.value = next;
        return;
      }
      cancel();
      from = current.value;
      to = next;
      if (from === to) return;
      startTs = typeof performance !== 'undefined' && performance.now
        ? performance.now()
        : Date.now();
      raf = requestAnimationFrame(step);
    },
    { immediate: false },
  );

  onUnmounted(() => {
    cancel();
  });

  return current;
}
