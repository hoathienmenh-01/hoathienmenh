import type { RouteLocationNormalizedLoaded } from 'vue-router';

/**
 * Cửu Thiên Mộng Phase 3 module B — chọn transition name cho `<RouterView>`.
 *
 * - `/admin/*` → `''` (disable transition để giữ tốc độ cho staff).
 * - mọi route khác → `'xt-silk'`.
 *
 * Tách thành module riêng để App.vue mỏng + unit-testable không cần mount.
 */
export function silkTransitionName(
  route: Pick<RouteLocationNormalizedLoaded, 'path'> | null | undefined,
): string {
  if (!route || typeof route.path !== 'string') return 'xt-silk';
  if (route.path.startsWith('/admin')) return '';
  return 'xt-silk';
}
