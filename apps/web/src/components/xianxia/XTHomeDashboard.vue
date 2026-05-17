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
 * Phase 15.10 — Live player data wiring. Trước đây toàn bộ panel đọc từ
 * `@/data/homeDashboardMock` (mock VIP: "Thiên Vân — Đại Thừa Kỳ Bậc 9 /
 * 12.568.890 Linh Thạch / Thanh Vân Tông …"). Bây giờ các trường người
 * chơi thấy ngay (tên / cảnh giới / lực chiến / linh thạch / tiên ngọc /
 * tông môn / mail badge) đọc từ `useGameStore` (character, currentSect,
 * unreadMail). Khi `game.character` rỗng → empty state an toàn ("—" / 0 /
 * "Chưa gia nhập tông môn"), **không** fallback về mock VIP.
 *
 * Các section gameplay sâu (recent quests, equipment slots, sect chat
 * messages, daily reward, sidebar/bottomNav/feature cards) tạm thời vẫn
 * đọc từ mock structure vì chưa có store mapping 1:1 sẵn — sẽ wire ở PR
 * tiếp theo (xem `docs/AI_HANDOFF_REPORT.md` Phase 15.10).
 */
import { computed } from 'vue';
import { useRouter } from 'vue-router';
import { useIsLgUp } from '@/composables/useMediaQuery';
import { useGameStore } from '@/stores/game';
import { useBadgesStore } from '@/stores/badges';
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
  featureCards,
  heroBanner,
  heroQuickActions,
  mobileIconGrid,
  recentQuests,
  sidebarGroups,
  sectPanel as sectPanelMock,
  equipmentSlots,
  inventoryPanel,
  dailyReward,
  type HomeBottomNavItem,
  type HomeFeatureCard,
  type HomeResource,
  type HomeStatTile,
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
const game = useGameStore();
const badges = useBadgesStore();

const showDesktopChrome = computed(
  () => isLgUp.value,
);
const showMobileChrome = computed(
  () => !isLgUp.value,
);

const EMPTY_VALUE = '—';
const NO_SECT = 'Chưa gia nhập tông môn';

function formatVN(n: number | bigint | string | null | undefined): string {
  if (n === null || n === undefined || n === '') return '0';
  try {
    if (typeof n === 'string') return new Intl.NumberFormat('vi-VN').format(BigInt(n));
    return new Intl.NumberFormat('vi-VN').format(n);
  } catch {
    return '0';
  }
}

/**
 * Phase 15.10 — Live player header derived từ `game.character`. Khi store
 * chưa có character (chưa hydrate hoặc fail) → empty placeholders, KHÔNG
 * lộ mock VIP "Thiên Vân / Đại Thừa Kỳ Bậc 9 / 8.256.789".
 */
const livePlayerHeader = computed(() => {
  const c = game.character;
  if (!c) {
    return {
      name: EMPTY_VALUE,
      realm: EMPTY_VALUE,
      stage: EMPTY_VALUE,
      stagePill: EMPTY_VALUE,
      level: 0,
      power: '0',
      avatarGlyph: '☯',
    };
  }
  const realm = game.realmFullName || c.realmKey || EMPTY_VALUE;
  return {
    name: c.name,
    realm,
    stage: realm,
    stagePill: `Bậc ${c.realmStage}`,
    level: c.level,
    power: formatVN(c.power),
    avatarGlyph: '☯',
  };
});

/**
 * Phase 15.10 — Resources strip (topbar + mobile header). Linh thạch / tiên
 * ngọc đọc từ store; tử tinh + danh vọng chưa có trong `CharacterStatePayload`
 * nên giữ giá trị 0 (an toàn, không lộ mock VIP). Wire thật khi BE thêm field.
 */
const liveResources = computed<HomeResource[]>(() => {
  const c = game.character;
  return [
    {
      key: 'linhThach',
      label: 'Linh thạch',
      value: c ? formatVN(c.linhThach) : '0',
      glyph: '◈',
      tone: 'jade',
    },
    {
      key: 'tienNgoc',
      label: 'Tiên ngọc',
      value: c ? formatVN(c.tienNgoc) : '0',
      glyph: '◆',
      tone: 'gold',
    },
    { key: 'tuTinh', label: 'Tử tinh', value: '0', glyph: '✦', tone: 'violet' },
    { key: 'danhVong', label: 'Danh vọng', value: '0', glyph: '♛', tone: 'smoke' },
  ];
});

/**
 * Phase 15.10 — Desktop stat tiles row (6 ô). Tu vi / lực chiến / linh thạch
 * / tiên ngọc / sect đọc thật từ store. Danh vọng tạm 0 (BE chưa có).
 */
const liveStatTiles = computed<HomeStatTile[]>(() => {
  const c = game.character;
  const sect = game.currentSect;
  if (!c) {
    return [
      { key: 'tuVi', label: 'Tu vi', value: '0', meta: EMPTY_VALUE, glyph: '✦', tone: 'jade' },
      { key: 'lucChien', label: 'Lực chiến', value: '0', glyph: '⚔', tone: 'seal' },
      { key: 'linhThach', label: 'Linh thạch', value: '0', glyph: '◈', tone: 'cyan' },
      { key: 'tienNgoc', label: 'Tiên ngọc', value: '0', glyph: '◆', tone: 'gold' },
      { key: 'danhVong', label: 'Danh vọng', value: '0', glyph: '♛', tone: 'violet' },
      { key: 'sect', label: 'Tông môn', value: NO_SECT, glyph: '⛩', tone: 'jade' },
    ];
  }
  return [
    {
      key: 'tuVi',
      label: 'Tu vi',
      value: formatVN(c.exp),
      meta: game.realmFullName || c.realmKey || EMPTY_VALUE,
      glyph: '✦',
      tone: 'jade',
    },
    { key: 'lucChien', label: 'Lực chiến', value: formatVN(c.power), glyph: '⚔', tone: 'seal' },
    { key: 'linhThach', label: 'Linh thạch', value: formatVN(c.linhThach), glyph: '◈', tone: 'cyan' },
    { key: 'tienNgoc', label: 'Tiên ngọc', value: formatVN(c.tienNgoc), glyph: '◆', tone: 'gold' },
    { key: 'danhVong', label: 'Danh vọng', value: '0', glyph: '♛', tone: 'violet' },
    {
      key: 'sect',
      label: 'Tông môn',
      value: sect?.name ?? NO_SECT,
      glyph: '⛩',
      tone: 'jade',
    },
  ];
});

/**
 * Phase 15.10 — Mobile compact stat tiles (4 ô). Cùng nguồn store, chỉ rút
 * gọn còn 4 mục cho viewport hẹp.
 */
const liveStatTilesMobile = computed<HomeStatTile[]>(() => {
  const c = game.character;
  const sect = game.currentSect;
  if (!c) {
    return [
      { key: 'linhThach', label: 'Linh thạch', value: '0', glyph: '◈', tone: 'cyan' },
      { key: 'tienNgoc', label: 'Tiên ngọc', value: '0', glyph: '◆', tone: 'gold' },
      { key: 'danhVong', label: 'Danh vọng', value: '0', glyph: '♛', tone: 'violet' },
      { key: 'sect', label: 'Tông môn', value: NO_SECT, glyph: '⛩', tone: 'jade' },
    ];
  }
  return [
    { key: 'linhThach', label: 'Linh thạch', value: formatVN(c.linhThach), glyph: '◈', tone: 'cyan' },
    { key: 'tienNgoc', label: 'Tiên ngọc', value: formatVN(c.tienNgoc), glyph: '◆', tone: 'gold' },
    { key: 'danhVong', label: 'Danh vọng', value: '0', glyph: '♛', tone: 'violet' },
    {
      key: 'sect',
      label: 'Tông môn',
      value: sect?.name ?? NO_SECT,
      glyph: '⛩',
      tone: 'jade',
    },
  ];
});

/** Phase 15.10 — Mail badge số thư chưa đọc, từ `game.unreadMail`. */
const liveMailBadge = computed(() => game.unreadMail);

/**
 * Phase 15.10 — Sect & chat panel info. Tên / cấp / số thành viên lấy từ
 * `game.currentSect`; nếu chưa có (chưa hydrate hoặc player chưa vào tông)
 * → empty state "Chưa gia nhập tông môn" + cấp 0.
 */
const liveSectPanel = computed(() => {
  const sect = game.currentSect;
  if (!sect) {
    return {
      title: sectPanelMock.title,
      sectName: NO_SECT,
      sectLevel: 0,
      members: '0 / 0',
    };
  }
  return {
    title: sectPanelMock.title,
    sectName: sect.name,
    sectLevel: sect.level,
    members: `${sect.memberCount}`,
  };
});

/**
 * PR-A1 (Phase 15.14) — Live wiring cho feature grid + mobile icon grid
 * badge counters (audit deep feature 2026-05-17 §10 P0). Trước đây các
 * card có badge cứng "mail 3 / missions 1 / boss 1 / friends 1" trong
 * `homeDashboardMock` — gây hiểu nhầm cho player thật. Giờ override
 * `badge` field qua live count từ `useBadgesStore` + `useGameStore.unreadMail`.
 *
 * Trả `undefined` cho key chưa có store source → feature card hide badge
 * (panel skip render khi `badge === undefined || badge === 0`).
 */
function liveBadgeFor(cardKey: string): number | undefined {
  if (cardKey === 'mail') {
    return game.unreadMail > 0 ? game.unreadMail : undefined;
  }
  if (cardKey === 'missions') {
    return badges.missionClaimable > 0 ? badges.missionClaimable : undefined;
  }
  if (cardKey === 'boss') {
    return badges.bossActive ? 1 : undefined;
  }
  if (cardKey === 'topup') {
    return badges.topupPending ? 1 : undefined;
  }
  // friends/equipment/cultivation/... chưa có store badge → ẩn.
  return undefined;
}

const liveFeatureCards = computed<HomeFeatureCard[]>(() =>
  featureCards.map((c) => ({ ...c, badge: liveBadgeFor(c.key) })),
);

const liveMobileIconGrid = computed<HomeFeatureCard[]>(() =>
  mobileIconGrid.map((c) => ({ ...c, badge: liveBadgeFor(c.key) })),
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
      <!-- Standalone mobile header (Phase 15.10 — wired live player + resources). -->
      <XTHomeMobileHeader
        v-if="chrome === 'standalone' && showMobileChrome"
        :player="livePlayerHeader"
        :resources="liveResources"
        :mail-badge="liveMailBadge"
        :brand="heroBanner"
        @open-mail="onMail"
        @open-menu="onMenu"
        @claim-resource="onResource"
      />

      <!-- Standalone desktop topbar (Phase 15.10 — wired live). -->
      <XTHomeTopBar
        v-if="chrome === 'standalone' && showDesktopChrome"
        :player="livePlayerHeader"
        :resources="liveResources"
        :mail-badge="liveMailBadge"
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

        <!-- Stat tiles (Phase 15.10 — wired live tu vi / lực chiến / linh thạch /
             tiên ngọc / tông môn từ `useGameStore`, fallback 0 + "Chưa gia
             nhập tông môn" khi store rỗng). -->
        <XTHomeStatTiles
          :tiles="showMobileChrome ? liveStatTilesMobile : liveStatTiles"
          :columns="showMobileChrome ? 'four' : 'six'"
          test-id="home-stat-tiles"
        />

        <!-- Feature grid:
             Desktop: 12 card với mô tả + badge.
             Mobile: 21 mục icon-only (icon grid). -->
        <XTHomeFeatureGrid
          v-if="showDesktopChrome"
          :cards="liveFeatureCards"
          layout="auto"
          test-id="home-feature-grid"
        />
        <XTHomeFeatureGrid
          v-else
          :cards="liveMobileIconGrid"
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
          <!-- Phase 15.11 — sect panel + chat đều wire real data: header lấy
               từ `game.currentSect`; chat messages load `chatHistory('SECT')`
               + subscribe WS `chat:msg`, send qua `chatSendSect`. Player chưa
               vào tông → input disabled + empty state, KHÔNG dùng mock. -->
          <XTHomeSectChatPanel
            :info="liveSectPanel"
            :compact="showMobileChrome"
            test-id="home-sect-chat-panel"
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
