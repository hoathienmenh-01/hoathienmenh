<script setup lang="ts">
/**
 * Cửu Thiên Mộng — `XTHomeBottomNav` (UI-3.2 mobile bottom nav).
 *
 * Bottom nav 5 tab cho mobile, tab thứ 3 ("Chiến đấu") nổi bật bằng nút
 * tròn lớn ở giữa với glow vàng. Sticky bottom + safe-area padding.
 *
 * KHÔNG conflict với <ref_file file="/home/ubuntu/repos/xuantoi/apps/web/src/components/shell/AppShellBottomBar.vue" />
 * vì component này chỉ render khi `XTHomeDashboard` dùng layout mobile
 * standalone (không bao trong AppShell).
 */
import { computed } from 'vue';
import { useRoute } from 'vue-router';
import { bottomNavItems, type HomeBottomNavItem } from '@/data/homeDashboardMock';

const props = withDefaults(
  defineProps<{
    items?: HomeBottomNavItem[];
    currentPath?: string;
    testId?: string;
  }>(),
  {
    items: () => bottomNavItems,
    currentPath: undefined,
    testId: 'home-bottom-nav',
  },
);

const route = useRoute();
const activePath = computed(() => props.currentPath ?? route.path);
</script>

<template>
  <nav
    class="xt-home-bnav"
    :data-testid="testId"
    role="navigation"
    aria-label="Điều hướng dưới"
  >
    <RouterLink
      v-for="item in items"
      :key="item.key"
      :to="item.to"
      class="xt-home-bnav__item"
      :class="{
        'xt-home-bnav__item--active': activePath === item.to,
        'xt-home-bnav__item--highlight': item.highlight,
      }"
      :data-testid="`${testId}-item-${item.key}`"
      :aria-current="activePath === item.to ? 'page' : undefined"
    >
      <span class="xt-home-bnav__glyph-wrap" aria-hidden="true">
        <span class="xt-home-bnav__glyph">{{ item.glyph }}</span>
        <span
          v-if="item.badge && item.badge > 0"
          class="xt-home-bnav__badge"
        >{{ item.badge > 9 ? '9+' : item.badge }}</span>
      </span>
      <span class="xt-home-bnav__label">{{ item.label }}</span>
    </RouterLink>
  </nav>
</template>

<style scoped>
.xt-home-bnav {
  position: sticky;
  bottom: 0;
  z-index: 60;
  display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  align-items: center;
  padding: 8px 6px calc(env(safe-area-inset-bottom, 0px) + 8px);
  background:
    linear-gradient(180deg, rgba(14, 19, 24, 0.92) 0%, rgba(6, 8, 11, 0.98) 100%);
  border-top: 1px solid rgba(242, 215, 137, 0.4);
  box-shadow: 0 -10px 28px rgba(0, 0, 0, 0.5);
}

.xt-home-bnav::before {
  content: '';
  position: absolute;
  left: 0;
  right: 0;
  top: -1px;
  height: 1px;
  background: linear-gradient(
    90deg,
    transparent 0%,
    rgba(242, 215, 137, 0.6) 50%,
    transparent 100%
  );
}

.xt-home-bnav__item {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  padding: 4px 2px;
  border-radius: 12px;
  text-decoration: none;
  color: var(--xt-text-muted, rgba(208, 200, 180, 0.7));
  font-family: var(--xt-font-body);
  font-size: 10px;
  letter-spacing: 0.04em;
}

.xt-home-bnav__item:focus-visible {
  outline: 2px solid rgba(95, 227, 198, 0.55);
  outline-offset: 2px;
}

.xt-home-bnav__glyph-wrap {
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border-radius: 10px;
  background: rgba(20, 28, 38, 0.5);
  border: 1px solid rgba(242, 215, 137, 0.18);
  color: inherit;
  font-size: 18px;
}

.xt-home-bnav__item--active .xt-home-bnav__glyph-wrap {
  background: linear-gradient(180deg, rgba(27, 59, 52, 0.85), rgba(12, 30, 26, 0.95));
  border-color: rgba(95, 227, 198, 0.6);
  color: var(--xt-jade-bright, #5fe3c6);
  box-shadow: 0 0 14px rgba(95, 227, 198, 0.4);
}

.xt-home-bnav__item--active {
  color: var(--xt-jade-bright, #5fe3c6);
}

.xt-home-bnav__item--highlight {
  margin-top: -22px;
}

.xt-home-bnav__item--highlight .xt-home-bnav__glyph-wrap {
  width: 58px;
  height: 58px;
  border-radius: 50%;
  border-width: 2px;
  border-color: rgba(242, 215, 137, 0.75);
  background: radial-gradient(circle at 50% 30%, rgba(242, 215, 137, 0.5) 0%, rgba(120, 30, 30, 0.85) 60%, rgba(40, 12, 12, 0.95) 100%);
  color: #fff6e0;
  font-size: 26px;
  box-shadow:
    0 0 18px rgba(242, 215, 137, 0.55),
    inset 0 0 14px rgba(255, 246, 224, 0.18);
  animation: xt-bnav-pulse 3.4s ease-in-out infinite;
}

.xt-home-bnav__item--highlight.xt-home-bnav__item--active .xt-home-bnav__glyph-wrap {
  border-color: rgba(242, 215, 137, 0.95);
}

.xt-home-bnav__item--highlight .xt-home-bnav__label {
  color: var(--xt-gold-bright, #f2d789);
  font-family: var(--xt-font-decorative), serif;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  font-size: 10px;
  margin-top: 2px;
}

.xt-home-bnav__label {
  font-size: 10px;
  letter-spacing: 0.04em;
  white-space: nowrap;
}

.xt-home-bnav__badge {
  position: absolute;
  top: -3px;
  right: -3px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 14px;
  height: 14px;
  padding: 0 4px;
  border-radius: 999px;
  background: linear-gradient(180deg, #e75858 0%, #a02828 100%);
  border: 1px solid rgba(14, 19, 24, 0.9);
  color: #fff6e0;
  font-size: 9px;
  font-weight: 700;
}

@keyframes xt-bnav-pulse {
  0%, 100% { box-shadow: 0 0 18px rgba(242, 215, 137, 0.55), inset 0 0 14px rgba(255, 246, 224, 0.18); }
  50% { box-shadow: 0 0 26px rgba(242, 215, 137, 0.8), inset 0 0 18px rgba(255, 246, 224, 0.25); }
}

@media (prefers-reduced-motion: reduce) {
  .xt-home-bnav__item--highlight .xt-home-bnav__glyph-wrap {
    animation: none;
  }
}
</style>
