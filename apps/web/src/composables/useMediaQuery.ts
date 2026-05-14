import { onBeforeUnmount, onMounted, ref, type Ref } from 'vue';

/**
 * Reactive `window.matchMedia(query).matches`. SSR-safe (returns `false`
 * default ref khi không có `window`/`matchMedia`; cập nhật trong
 * `onMounted`).
 *
 * Sử dụng để switch giữa mobile shell / desktop shell trong `AppShell.vue`
 * — chỉ render đúng 1 cây DOM, tránh slot bị clone gây strict-mode
 * violation trên Playwright (ví dụ `leaderboard-tab-power` xuất hiện 2
 * lần do cả mobile + desktop main đều `<slot/>`).
 */
export function useMediaQuery(query: string): Ref<boolean> {
  const matches = ref(false);

  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return matches;
  }

  const mql = window.matchMedia(query);
  matches.value = mql.matches;

  const onChange = (event: MediaQueryListEvent) => {
    matches.value = event.matches;
  };

  onMounted(() => {
    // Re-sync khi mount (đề phòng giữa SSR và CSR).
    matches.value = mql.matches;
    if (typeof mql.addEventListener === 'function') {
      mql.addEventListener('change', onChange);
    } else {
      // Safari < 14 fallback.
      mql.addListener(onChange);
    }
  });

  onBeforeUnmount(() => {
    if (typeof mql.removeEventListener === 'function') {
      mql.removeEventListener('change', onChange);
    } else {
      mql.removeListener(onChange);
    }
  });

  return matches;
}

/**
 * `true` khi viewport >= 1024px (Tailwind `lg`). Default sync ngay từ
 * setup (không đợi `onMounted`) để render đúng shell từ đầu.
 */
export function useIsLgUp(): Ref<boolean> {
  return useMediaQuery('(min-width: 1024px)');
}
