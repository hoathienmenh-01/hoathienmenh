<script setup lang="ts">
/**
 * Cửu Thiên Mộng — `XTHomeSidebar` (UI-3.2 luxury sidebar).
 *
 * Sidebar trái dùng cho dashboard desktop (>= lg). 240px cứng theo concept
 * art, nền đen ngọc, viền vàng, brand block ở trên + danh sách menu chia
 * theo nhóm (`HomeSidebarGroup`). Item active có nền sáng xanh ngọc +
 * viền vàng, item có `badge` hiển thị red dot góc phải.
 *
 * KHÔNG đụng router store — view ngoài tự pass `currentPath` để xác định
 * active. Default lấy từ `useRoute().path` để hỗ trợ standalone preview.
 *
 * Props:
 *   - `groups`: danh sách HomeSidebarGroup (mặc định từ mock data).
 *   - `brand`: { name, subtitle } cho block thương hiệu trên cùng.
 *   - `currentPath`: override route hiện tại (test / standalone).
 *   - `testId`.
 */
import { computed } from 'vue';
import { useRoute } from 'vue-router';
import GameIcon from '@/components/xianxia/GameIcon.vue';
import { sidebarGroups, type HomeSidebarGroup, type HomeSidebarItem } from '@/data/homeDashboardMock';

const props = withDefaults(
  defineProps<{
    groups?: HomeSidebarGroup[];
    brand?: { name: string; subtitle: string };
    currentPath?: string;
    testId?: string;
  }>(),
  {
    groups: () => sidebarGroups,
    brand: () => ({ name: 'Xuân Tôi', subtitle: 'Cửu Thiên Mộng' }),
    currentPath: undefined,
    testId: 'home-sidebar',
  },
);

const route = useRoute();
const activePath = computed(() => props.currentPath ?? route.path);

function isActive(item: HomeSidebarItem): boolean {
  if (activePath.value === item.to) return true;
  if (item.match && item.match.includes(activePath.value)) return true;
  return false;
}
</script>

<template>
  <aside
    class="xt-home-sidebar"
    :data-testid="testId"
    role="navigation"
    aria-label="Trang chủ — thanh điều hướng"
  >
    <RouterLink
      to="/home"
      class="xt-home-sidebar__brand"
      :data-testid="`${testId}-brand`"
    >
      <span class="xt-home-sidebar__seal" aria-hidden="true">❖</span>
      <span class="xt-home-sidebar__brand-text">
        <span class="xt-home-sidebar__brand-title">{{ brand.name }}</span>
        <span class="xt-home-sidebar__brand-sub">{{ brand.subtitle }}</span>
      </span>
    </RouterLink>

    <div class="xt-home-sidebar__rule" aria-hidden="true" />

    <nav class="xt-home-sidebar__nav" aria-label="Danh mục chức năng">
      <section
        v-for="group in groups"
        :key="group.key"
        class="xt-home-sidebar__group"
      >
        <p v-if="group.eyebrow" class="xt-home-sidebar__eyebrow">
          {{ group.eyebrow }}
        </p>
        <ul class="xt-home-sidebar__list">
          <li v-for="item in group.items" :key="item.key">
            <RouterLink
              :to="item.to"
              class="xt-home-sidebar__item"
              :class="{ 'xt-home-sidebar__item--active': isActive(item) }"
              :data-testid="`${testId}-item-${item.key}`"
              :aria-current="isActive(item) ? 'page' : undefined"
            >
              <span class="xt-home-sidebar__item-icon" aria-hidden="true">
                <GameIcon
                  :name="item.icon"
                  size="sm"
                  :tone="isActive(item) ? 'jade' : 'gold'"
                />
              </span>
              <span class="xt-home-sidebar__item-label">{{ item.label }}</span>
              <span
                v-if="item.badge && item.badge > 0"
                class="xt-home-sidebar__badge"
                :aria-label="`${item.badge} thông báo`"
              >{{ item.badge > 99 ? '99+' : item.badge }}</span>
            </RouterLink>
          </li>
        </ul>
      </section>
    </nav>

    <div class="xt-home-sidebar__lantern" aria-hidden="true">
      <span class="xt-home-sidebar__lantern-flame" />
    </div>
  </aside>
</template>

<style scoped>
.xt-home-sidebar {
  position: relative;
  isolation: isolate;
  display: flex;
  flex-direction: column;
  gap: 14px;
  width: var(--xt-home-sidebar-w, 240px);
  flex: 0 0 var(--xt-home-sidebar-w, 240px);
  height: 100vh;
  padding: 18px 14px 22px;
  background:
    radial-gradient(120% 80% at 0% 0%, rgba(95, 227, 198, 0.08) 0%, transparent 60%),
    radial-gradient(140% 80% at 0% 100%, rgba(242, 215, 137, 0.06) 0%, transparent 65%),
    linear-gradient(180deg, rgba(14, 19, 24, 0.96) 0%, rgba(8, 9, 11, 0.98) 100%);
  border-right: 1px solid var(--xt-border-gold, rgba(242, 215, 137, 0.4));
  box-shadow: inset -1px 0 0 rgba(242, 215, 137, 0.12), 18px 0 38px rgba(0, 0, 0, 0.4);
  overflow: hidden;
}

.xt-home-sidebar::before {
  content: '';
  position: absolute;
  inset: 6px;
  border: 1px solid rgba(242, 215, 137, 0.18);
  border-radius: 18px;
  pointer-events: none;
  z-index: 0;
}

.xt-home-sidebar__brand {
  position: relative;
  z-index: 1;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 6px 8px 10px;
  text-decoration: none;
  color: inherit;
}

.xt-home-sidebar__brand:focus-visible {
  outline: 2px solid rgba(95, 227, 198, 0.55);
  outline-offset: 2px;
  border-radius: 12px;
}

.xt-home-sidebar__seal {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 38px;
  height: 38px;
  border-radius: 12px;
  background: radial-gradient(circle at 30% 30%, rgba(208, 79, 79, 0.9), rgba(120, 30, 30, 0.9));
  border: 1px solid rgba(242, 215, 137, 0.7);
  color: #fff6e0;
  font-size: 18px;
  box-shadow: 0 0 18px rgba(208, 79, 79, 0.4), inset 0 0 6px rgba(255, 246, 224, 0.18);
}

.xt-home-sidebar__brand-text {
  display: flex;
  flex-direction: column;
  gap: 1px;
  min-width: 0;
}

.xt-home-sidebar__brand-title {
  font-family: var(--xt-font-display), serif;
  font-size: 18px;
  font-weight: 700;
  letter-spacing: 0.16em;
  background: linear-gradient(180deg, #fff6e0 0%, var(--xt-gold-bright, #f2d789) 100%);
  -webkit-background-clip: text;
          background-clip: text;
  color: transparent;
  -webkit-text-fill-color: transparent;
}

.xt-home-sidebar__brand-sub {
  font-family: var(--xt-font-decorative), serif;
  font-size: 10px;
  letter-spacing: 0.36em;
  text-transform: uppercase;
  color: var(--xt-jade-bright, #5fe3c6);
}

.xt-home-sidebar__rule {
  position: relative;
  z-index: 1;
  height: 1px;
  margin: 0 4px;
  background: linear-gradient(
    90deg,
    transparent 0%,
    rgba(242, 215, 137, 0.55) 50%,
    transparent 100%
  );
}

.xt-home-sidebar__nav {
  position: relative;
  z-index: 1;
  flex: 1 1 auto;
  overflow-y: auto;
  padding-right: 2px;
  scrollbar-width: thin;
  scrollbar-color: rgba(242, 215, 137, 0.28) transparent;
}

.xt-home-sidebar__nav::-webkit-scrollbar {
  width: 6px;
}

.xt-home-sidebar__nav::-webkit-scrollbar-thumb {
  background: rgba(242, 215, 137, 0.28);
  border-radius: 4px;
}

.xt-home-sidebar__group + .xt-home-sidebar__group {
  margin-top: 10px;
}

.xt-home-sidebar__eyebrow {
  font-family: var(--xt-font-decorative), serif;
  font-size: 9px;
  letter-spacing: 0.32em;
  text-transform: uppercase;
  color: var(--xt-text-muted, rgba(208, 200, 180, 0.62));
  margin: 8px 6px 4px;
}

.xt-home-sidebar__list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.xt-home-sidebar__item {
  position: relative;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 10px;
  border-radius: 12px;
  text-decoration: none;
  color: var(--xt-text-soft, #d8d0bf);
  font-family: var(--xt-font-body);
  font-size: 13px;
  letter-spacing: 0.04em;
  transition:
    background var(--xt-motion-base, 220ms) ease,
    color var(--xt-motion-base, 220ms) ease,
    box-shadow var(--xt-motion-base, 220ms) ease,
    transform var(--xt-motion-fast, 140ms) ease;
}

.xt-home-sidebar__item:hover {
  background: linear-gradient(
    90deg,
    rgba(95, 227, 198, 0.08) 0%,
    rgba(242, 215, 137, 0.06) 100%
  );
  color: var(--xt-scroll-paper-bright, #fff6e0);
  transform: translateX(2px);
}

.xt-home-sidebar__item:focus-visible {
  outline: 2px solid rgba(95, 227, 198, 0.55);
  outline-offset: 2px;
}

.xt-home-sidebar__item--active {
  background: linear-gradient(
    90deg,
    rgba(27, 59, 52, 0.85) 0%,
    rgba(74, 59, 24, 0.65) 100%
  );
  color: var(--xt-jade-bright, #5fe3c6);
  box-shadow:
    inset 0 0 0 1px rgba(242, 215, 137, 0.45),
    0 0 18px rgba(95, 227, 198, 0.18);
}

.xt-home-sidebar__item--active::before {
  content: '';
  position: absolute;
  left: 0;
  top: 22%;
  bottom: 22%;
  width: 3px;
  border-radius: 2px;
  background: linear-gradient(180deg, var(--xt-gold-bright, #f2d789), var(--xt-jade-bright, #5fe3c6));
  box-shadow: 0 0 8px rgba(242, 215, 137, 0.6);
}

.xt-home-sidebar__item-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

.xt-home-sidebar__item-label {
  flex: 1 1 auto;
  min-width: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.xt-home-sidebar__badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 18px;
  height: 18px;
  padding: 0 5px;
  border-radius: 999px;
  background: linear-gradient(180deg, #e75858 0%, #a02828 100%);
  border: 1px solid rgba(255, 246, 224, 0.5);
  color: #fff6e0;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.04em;
  box-shadow: 0 0 10px rgba(208, 79, 79, 0.45);
}

.xt-home-sidebar__lantern {
  position: absolute;
  bottom: 18px;
  right: 6px;
  width: 14px;
  height: 30px;
  pointer-events: none;
  opacity: 0.55;
  z-index: 0;
}

.xt-home-sidebar__lantern::before,
.xt-home-sidebar__lantern::after {
  content: '';
  position: absolute;
  left: 50%;
  transform: translateX(-50%);
  width: 1px;
  background: linear-gradient(180deg, transparent 0%, rgba(242, 215, 137, 0.45) 60%, transparent 100%);
}

.xt-home-sidebar__lantern::before {
  top: 0;
  height: 14px;
}

.xt-home-sidebar__lantern-flame {
  position: absolute;
  bottom: 0;
  left: 50%;
  transform: translateX(-50%);
  width: 8px;
  height: 12px;
  border-radius: 50% 50% 60% 60% / 70% 70% 60% 60%;
  background: radial-gradient(circle at 50% 70%, rgba(242, 215, 137, 0.9), rgba(208, 79, 79, 0.55));
  box-shadow: 0 0 12px rgba(242, 215, 137, 0.6);
  animation: xt-lantern-flicker 2.6s ease-in-out infinite;
}

@keyframes xt-lantern-flicker {
  0%, 100% { transform: translateX(-50%) scale(1, 1); opacity: 0.9; }
  50% { transform: translateX(-50%) scale(0.92, 1.08); opacity: 1; }
}

@media (prefers-reduced-motion: reduce) {
  .xt-home-sidebar__lantern-flame {
    animation: none;
  }
  .xt-home-sidebar__item {
    transition: none;
  }
  .xt-home-sidebar__item:hover {
    transform: none;
  }
}
</style>
