<script setup lang="ts">
/**
 * Cửu Thiên Mộng — `XTHomeDashboard` (UI-3.2 main composer).
 *
 * Responsive luxury home/dashboard. Compose tất cả sub-component:
 *
 *   • Desktop (>= lg, 1024px):
 *       [Sidebar*] [Topbar*] [Hero banner] [Stat tiles 6 ô]
 *       [Feature grid 12 card] [Quest | Inventory | Sect chat]
 *
 *   • Mobile (< lg):
 *       [Mobile header*] [Hero mobile card] [Stat mini 4 ô]
 *       [Icon grid 21 ô] [Compact panels] [Bottom nav*]
 *
 * Các phần đánh dấu (*) chỉ render khi `chrome === 'standalone'`. Khi nhúng
 * vào `AppShell` (`chrome === 'embedded'`, mặc định) thì AppShell đã có
 * sidebar / topbar / bottom-nav riêng nên dashboard chỉ render phần
 * **nội dung**, tránh trùng lặp navigation.
 *
 * Tất cả data lấy từ `@/data/homeDashboardMock` — UI-only, không gọi API.
 */
import { computed } from 'vue';
import { useRouter } from 'vue-router';
import { useIsLgUp } from '@/composables/useMediaQuery';
import XTHomeSidebar from './XTHomeSidebar.vue';
import XTHomeTopBar from './XTHomeTopBar.vue';
import XTHomeHeroBanner from './XTHomeHeroBanner.vue';
import XTHomeStatTiles from './XTHomeStatTiles.vue';
import XTHomeFeatureGrid from './XTHomeFeatureGrid.vue';
import XTHomeQuestPanel from './XTHomeQuestPanel.vue';
import XTHomeInventoryPanel from './XTHomeInventoryPanel.vue';
import XTHomeSectChatPanel from './XTHomeSectChatPanel.vue';
import XTHomeMobileHeader from './XTHomeMobileHeader.vue';
import XTHomeMobileHero from './XTHomeMobileHero.vue';
import XTHomeBottomNav from './XTHomeBottomNav.vue';
import {
  bottomNavItems,
  chatMessages,
  featureCards,
  heroBanner,
  heroQuickActions,
  mobileIconGrid,
  playerHeader,
  recentQuests,
  resources,
  sidebarGroups,
  statTiles,
  statTilesMobile,
  topbarMail,
  sectPanel,
  equipmentSlots,
  inventoryPanel,
  dailyReward,
  type HomeBottomNavItem,
} from '@/data/homeDashboardMock';

withDefaults(
  defineProps<{
    /**
     * `standalone`: render full chrome (sidebar / topbar / mobile header /
     * bottom nav). Dùng khi cần preview riêng dashboard ngoài shell.
     * `embedded` (default): chỉ render content (hero / tiles / grid /
     * panels). Dùng khi nhúng trong `AppShell` để tránh duplicate chrome.
     */
    chrome?: 'embedded' | 'standalone';
    /** Override bottom nav items (e.g. để test highlight active tab). */
    navItems?: HomeBottomNavItem[];
    testId?: string;
  }>(),
  {
    chrome: 'embedded',
    navItems: () => bottomNavItems,
    testId: 'home-dashboard',
  },
);

const isLgUp = useIsLgUp();
const router = useRouter();

const showDesktopChrome = computed(
  () => isLgUp.value,
);
const showMobileChrome = computed(
  () => !isLgUp.value,
);

function onQuickAction(key: string): void {
  switch (key) {
    case 'fast-cultivate':
      router.push('/cultivation').catch(() => null);
      break;
    case 'claim-reward':
      router.push('/missions').catch(() => null);
      break;
    case 'restore':
      router.push('/inventory').catch(() => null);
      break;
    case 'teleport':
      router.push('/world').catch(() => null);
      break;
    default:
      break;
  }
}

function onClaimReward(): void {
  router.push('/missions').catch(() => null);
}

function onResource(): void {
  router.push('/wallet').catch(() => null);
}

function onMail(): void {
  router.push('/mail').catch(() => null);
}

function onMenu(): void {
  router.push('/settings').catch(() => null);
}

function onChatSend(_msg: string): void {
  // UI-only stub; future wiring sẽ gửi qua game socket khi back-end ready.
}
</script>

<template>
  <div
    class="xt-home-dash"
    :class="[
      `xt-home-dash--${chrome}`,
      isLgUp ? 'xt-home-dash--lg' : 'xt-home-dash--sm',
    ]"
    :data-testid="testId"
  >
    <!-- ============== Standalone DESKTOP shell (sidebar + topbar) ============== -->
    <template v-if="chrome === 'standalone' && showDesktopChrome">
      <XTHomeSidebar
        :groups="sidebarGroups"
        data-testid="home-sidebar"
      />
    </template>

    <div class="xt-home-dash__main" :class="{ 'xt-home-dash__main--with-sidebar': chrome === 'standalone' && showDesktopChrome }">
      <!-- Standalone mobile header -->
      <XTHomeMobileHeader
        v-if="chrome === 'standalone' && showMobileChrome"
        :player="playerHeader"
        :resources="resources"
        :mail-badge="topbarMail.badge"
        :brand="heroBanner"
        @open-mail="onMail"
        @open-menu="onMenu"
        @claim-resource="onResource"
      />

      <!-- Standalone desktop topbar -->
      <XTHomeTopBar
        v-if="chrome === 'standalone' && showDesktopChrome"
        :player="playerHeader"
        :resources="resources"
        :mail-badge="topbarMail.badge"
        @claim-resource="onResource"
        @open-mail="onMail"
        @open-menu="onMenu"
      />

      <!-- ====== CONTENT ====== -->
      <div class="xt-home-dash__content">
        <!-- Mobile hero (compact) -->
        <XTHomeMobileHero
          v-if="showMobileChrome"
          :actions="heroQuickActions"
          data-testid="home-hero-mobile"
          @quick-action="onQuickAction"
        />

        <!-- Desktop hero banner -->
        <XTHomeHeroBanner
          v-else
          :brand="heroBanner"
          :quick-actions="heroQuickActions"
          :reward="dailyReward"
          test-id="home-hero"
          @quick-action="onQuickAction"
          @claim-reward="onClaimReward"
        />

        <!-- Stat tiles -->
        <XTHomeStatTiles
          :tiles="showMobileChrome ? statTilesMobile : statTiles"
          :columns="showMobileChrome ? 'four' : 'six'"
          test-id="home-stat-tiles"
        />

        <!-- Feature grid:
             Desktop: 12 card với mô tả + badge.
             Mobile: 21 mục icon-only (icon grid). -->
        <XTHomeFeatureGrid
          v-if="showDesktopChrome"
          :cards="featureCards"
          layout="auto"
          test-id="home-feature-grid"
        />
        <XTHomeFeatureGrid
          v-else
          :cards="mobileIconGrid"
          layout="iconGrid"
          test-id="home-feature-grid"
        />

        <!-- Bottom panels:
             Desktop: 3 cột Quest | Inventory | Sect.
             Mobile: stacked, compact variants. -->
        <div
          class="xt-home-dash__panels"
          :class="{ 'xt-home-dash__panels--mobile': showMobileChrome }"
        >
          <XTHomeQuestPanel
            :quests="recentQuests"
            :compact="showMobileChrome"
            test-id="home-quest-panel"
          />
          <XTHomeInventoryPanel
            :slots="equipmentSlots"
            :info="inventoryPanel"
            :compact="showMobileChrome"
            test-id="home-inventory-panel"
          />
          <XTHomeSectChatPanel
            :info="sectPanel"
            :messages="chatMessages"
            :compact="showMobileChrome"
            test-id="home-sect-chat-panel"
            @send="onChatSend"
          />
        </div>
      </div>

      <!-- Standalone bottom nav -->
      <XTHomeBottomNav
        v-if="chrome === 'standalone' && showMobileChrome"
        :items="navItems"
        data-testid="home-bottom-nav"
      />
    </div>
  </div>
</template>

<style scoped>
.xt-home-dash {
  position: relative;
  width: 100%;
  min-width: 0;
  color: var(--xt-text-primary, #f0e6cc);
  font-family: var(--xt-font-body);
}

.xt-home-dash--standalone.xt-home-dash--lg {
  display: grid;
  grid-template-columns: 240px minmax(0, 1fr);
  align-items: start;
  min-height: 100vh;
}

.xt-home-dash--standalone.xt-home-dash--sm {
  display: flex;
  flex-direction: column;
  min-height: 100vh;
  background:
    radial-gradient(120% 80% at 50% 0%, rgba(95, 227, 198, 0.08) 0%, transparent 60%),
    linear-gradient(180deg, rgba(8, 9, 11, 0.98) 0%, rgba(4, 5, 7, 1) 100%);
}

.xt-home-dash__main {
  position: relative;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 0;
}

.xt-home-dash__main--with-sidebar {
  padding: 0;
}

.xt-home-dash__content {
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding: 14px;
  min-width: 0;
}

@media (min-width: 768px) {
  .xt-home-dash__content {
    gap: 16px;
    padding: 16px;
  }
}

@media (min-width: 1024px) {
  .xt-home-dash__content {
    gap: 18px;
    padding: 18px 22px;
  }
}

.xt-home-dash__panels {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: 14px;
}

@media (min-width: 1024px) {
  .xt-home-dash__panels {
    grid-template-columns: 1.05fr 1.15fr 1.05fr;
    gap: 16px;
  }
}

.xt-home-dash__panels--mobile {
  grid-template-columns: minmax(0, 1fr);
  gap: 12px;
}

/* When embedded inside AppShell — let AppShell handle background + scroll. */
.xt-home-dash--embedded .xt-home-dash__content {
  padding: 0;
}

.xt-home-dash--embedded .xt-home-dash__main {
  background: transparent;
}
</style>
