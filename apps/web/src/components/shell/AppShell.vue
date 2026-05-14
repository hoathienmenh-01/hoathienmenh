<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { getTitleDef } from '@xuantoi/shared';
import { useAuthStore } from '@/stores/auth';
import { useGameStore } from '@/stores/game';
import { useBadgesStore } from '@/stores/badges';
import { useRoute, useRouter } from 'vue-router';
import BuffBar from './BuffBar.vue';
import ChatPanel from './ChatPanel.vue';
import LocaleSwitcher from './LocaleSwitcher.vue';
import NotificationBell from '@/components/notification/NotificationBell.vue';
import MaintenanceBanner from '@/components/MaintenanceBanner.vue';
import { useMaintenanceStore } from '@/stores/maintenance';

const maintenance = useMaintenanceStore();

const { t } = useI18n();
const auth = useAuthStore();
const game = useGameStore();
const badges = useBadgesStore();
const router = useRouter();
const route = useRoute();

const mobileNavOpen = ref(false);
function toggleMobileNav(): void {
  mobileNavOpen.value = !mobileNavOpen.value;
}
function closeMobileNav(): void {
  mobileNavOpen.value = false;
}
watch(
  () => route.fullPath,
  () => {
    mobileNavOpen.value = false;
  },
);

onMounted(() => {
  badges.start();
  void game.hydrateUnreadMail();
});

onUnmounted(() => {
  badges.stop();
});

const expPct = computed(() => Math.round(game.expProgress * 100));
const realmText = computed(() => game.realmFullName || '—');
const cultivating = computed(() => game.character?.cultivating ?? false);
/**
 * Phase 11.9.C — equipped title hiển thị trong header. Server source là
 * `Character.title` (CharacterStatePayload.title). Render `nameVi` từ
 * catalog `TITLES` để text không phải mã key.
 */
const equippedTitleName = computed<string | null>(() => {
  const key = game.character?.title;
  if (!key) return null;
  const def = getTitleDef(key);
  if (!def) return null;
  return def.nameVi;
});
const isStaff = computed(() => {
  const r = game.character?.role;
  return r === 'ADMIN' || r === 'MOD';
});

async function logout(): Promise<void> {
  await auth.logout();
  router.push('/auth');
}
</script>

<template>
  <div class="min-h-screen flex flex-col bg-ink-900 text-ink-100">
    <!-- Phase 15.5 — banner bảo trì cho ADMIN/MOD (player thấy overlay
         full-screen mount tại App.vue). Hiển thị khi:
         - maintenance.active === true (admin vẫn dùng được, cần biết
           game đang bảo trì). -->
    <MaintenanceBanner
      v-if="maintenance.active && maintenance.status && (game.character?.role === 'ADMIN' || game.character?.role === 'MOD')"
      :status="maintenance.status"
    />
    <!-- Topbar -->
    <header
      class="h-14 flex items-center gap-4 px-4 border-b border-ink-300/40 bg-ink-700/60 backdrop-blur"
    >
      <button
        type="button"
        class="md:hidden text-ink-100 hover:text-amber-200 px-2 py-1 -ml-2"
        :aria-label="t('shell.nav.toggle')"
        :aria-expanded="mobileNavOpen"
        data-testid="shell-mobile-toggle"
        @click="toggleMobileNav()"
      >
        <span aria-hidden="true" class="text-xl leading-none">{{ mobileNavOpen ? '✕' : '☰' }}</span>
      </button>
      <div class="text-lg tracking-widest font-bold">{{ t('app.brand') }}</div>
      <div class="text-sm text-ink-300 hidden md:block">{{ t('app.tagline') }}</div>

      <div class="ml-auto flex items-center gap-4 text-xs">
        <div
          v-if="game.character"
          class="hidden lg:flex items-center"
          data-testid="shell-buffbar"
        >
          <BuffBar />
        </div>
        <div v-if="game.character" class="hidden md:flex flex-col items-end">
          <span class="text-ink-50 font-bold">{{ game.character.name }}</span>
          <span
            v-if="equippedTitleName"
            class="text-amber-200"
            data-testid="shell-equipped-title"
          >
            {{ equippedTitleName }}
          </span>
          <span class="text-ink-300">{{ realmText }}</span>
        </div>
        <div v-if="game.character" class="w-40 hidden md:block">
          <div class="flex justify-between text-[10px] text-ink-300">
            <span>EXP</span>
            <span>{{ expPct }}%</span>
          </div>
          <div class="h-1.5 mt-0.5 rounded bg-ink-900/60 overflow-hidden">
            <div
              class="h-full transition-all"
              :class="cultivating ? 'bg-emerald-400' : 'bg-ink-300'"
              :style="{ width: expPct + '%' }"
            />
          </div>
        </div>
        <div v-if="game.character" class="w-32 hidden md:block">
          <div class="flex justify-between text-[10px] text-ink-300">
            <span>{{ t('shell.stamina') }}</span>
            <span>{{ game.character.stamina }} / {{ game.character.staminaMax }}</span>
          </div>
          <div class="h-1.5 mt-0.5 rounded bg-ink-900/60 overflow-hidden">
            <div
              class="h-full bg-amber-400 transition-all"
              :style="{ width: (game.character.stamina / game.character.staminaMax) * 100 + '%' }"
            />
          </div>
        </div>
        <div v-if="game.character" class="hidden md:flex items-center gap-1 text-[11px]">
          <span class="text-amber-300">⛀</span>
          <span>{{ game.character.linhThach }}</span>
        </div>
        <span
          class="px-2 py-0.5 rounded text-[10px]"
          :class="game.wsConnected ? 'bg-emerald-700/40 text-emerald-200' : 'bg-red-700/40 text-red-200'"
        >
          {{ game.wsConnected ? t('shell.wsOn') : t('shell.wsOff') }}
        </span>
        <!-- Phase 19.3 — Notification bell + dropdown. Renders unread
             badge + recent notifications, with click routing to the
             related Social tab (friend requests / private / group /
             reports). -->
        <NotificationBell v-if="game.character" />
        <LocaleSwitcher />
        <button class="text-ink-300 hover:text-ink-50" @click="logout">
          {{ t('home.logout') }}
        </button>
      </div>
    </header>

    <!-- Mobile nav backdrop -->
    <div
      v-if="mobileNavOpen"
      class="md:hidden fixed inset-0 z-40 bg-black/60"
      data-testid="shell-mobile-backdrop"
      @click="closeMobileNav()"
    />

    <div class="flex-1 grid grid-cols-1 md:grid-cols-[14rem_minmax(0,1fr)_18rem]">
      <!-- Sidebar trái -->
      <aside
        class="flex flex-col border-r border-ink-300/30 bg-ink-700/95 md:bg-ink-700/30 p-3 gap-1 text-sm fixed md:static inset-y-0 left-0 w-60 md:w-auto z-50 transform md:transform-none transition-transform duration-200 overflow-y-auto md:overflow-visible"
        :class="mobileNavOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0'"
        data-testid="shell-sidebar"
      >
        <RouterLink
          to="/home"
          class="px-3 py-2 rounded hover:bg-ink-700/60 relative"
          active-class="bg-ink-700/60 text-ink-50"
        >
          道 {{ t('shell.nav.home') }}
          <span
            v-if="badges.breakthroughReady"
            class="absolute -top-1 -right-1 w-2.5 h-2.5 rounded-full bg-violet-400 ring-2 ring-ink-700"
            :title="t('shell.badge.breakthroughReady')"
            data-testid="shell-nav-home-breakthrough-badge"
          />
        </RouterLink>
        <RouterLink
          to="/dashboard"
          class="px-3 py-2 rounded hover:bg-ink-700/60"
          active-class="bg-ink-700/60 text-ink-50"
          data-testid="shell-nav-dashboard"
        >
          鑑 {{ t('shell.nav.dashboard') }}
        </RouterLink>
        <RouterLink
          to="/dungeon"
          class="px-3 py-2 rounded hover:bg-ink-700/60"
          active-class="bg-ink-700/60 text-ink-50"
        >
          劍 {{ t('shell.nav.dungeon') }}
        </RouterLink>
        <RouterLink
          to="/dungeon-run"
          class="px-3 py-2 rounded hover:bg-ink-700/60"
          active-class="bg-ink-700/60 text-ink-50"
        >
          闖 {{ t('shell.nav.dungeonRun') }}
        </RouterLink>
        <RouterLink
          to="/story-dungeons"
          class="px-3 py-2 rounded hover:bg-ink-700/60"
          active-class="bg-ink-700/60 text-ink-50"
          data-testid="shell-nav-story-dungeons"
        >
          境 {{ t('shell.nav.storyDungeons') }}
        </RouterLink>
        <RouterLink
          to="/inventory"
          class="px-3 py-2 rounded hover:bg-ink-700/60"
          active-class="bg-ink-700/60 text-ink-50"
        >
          寶 {{ t('shell.nav.inventory') }}
        </RouterLink>
        <RouterLink
          to="/loadouts"
          class="px-3 py-2 rounded hover:bg-ink-700/60"
          active-class="bg-ink-700/60 text-ink-50"
          data-testid="shell-nav-loadouts"
        >
          套 {{ t('shell.nav.loadouts') }}
        </RouterLink>
        <RouterLink
          to="/notification-settings"
          class="px-3 py-2 rounded hover:bg-ink-700/60"
          active-class="bg-ink-700/60 text-ink-50"
          data-testid="shell-nav-notification-settings"
        >
          鈴 {{ t('shell.nav.notificationSettings') }}
        </RouterLink>
        <RouterLink
          to="/market"
          class="px-3 py-2 rounded hover:bg-ink-700/60"
          active-class="bg-ink-700/60 text-ink-50"
        >
          坊 {{ t('shell.nav.market') }}
        </RouterLink>
        <RouterLink
          to="/shop"
          class="px-3 py-2 rounded hover:bg-ink-700/60"
          active-class="bg-ink-700/60 text-ink-50"
        >
          肆 {{ t('shell.nav.shop') }}
        </RouterLink>
        <RouterLink
          to="/sect"
          class="px-3 py-2 rounded hover:bg-ink-700/60"
          active-class="bg-ink-700/60 text-ink-50"
        >
          門 {{ t('shell.nav.sect') }}
        </RouterLink>
        <RouterLink
          to="/boss"
          class="px-3 py-2 rounded hover:bg-ink-700/60 relative"
          active-class="bg-ink-700/60 text-ink-50"
        >
          鬼 {{ t('shell.nav.boss') }}
          <span
            v-if="badges.bossActive"
            class="absolute -top-1 -right-1 w-2.5 h-2.5 rounded-full bg-rose-500 ring-2 ring-ink-700"
            :title="t('shell.badge.bossActive')"
          />
        </RouterLink>
        <RouterLink
          to="/talents"
          class="px-3 py-2 rounded hover:bg-ink-700/60"
          active-class="bg-ink-700/60 text-ink-50"
        >
          技 {{ t('shell.nav.talents') }}
        </RouterLink>
        <RouterLink
          to="/alchemy"
          class="px-3 py-2 rounded hover:bg-ink-700/60"
          active-class="bg-ink-700/60 text-ink-50"
        >
          丹 {{ t('shell.nav.alchemy') }}
        </RouterLink>
        <RouterLink
          to="/cultivation-method"
          class="px-3 py-2 rounded hover:bg-ink-700/60"
          active-class="bg-ink-700/60 text-ink-50"
        >
          法 {{ t('shell.nav.cultivationMethod') }}
        </RouterLink>
        <RouterLink
          to="/cultivation-method-v2"
          class="px-3 py-2 rounded hover:bg-ink-700/60"
          active-class="bg-ink-700/60 text-ink-50"
        >
          訣 {{ t('shell.nav.cultivationMethodV2') }}
        </RouterLink>
        <RouterLink
          to="/body-cultivation"
          class="px-3 py-2 rounded hover:bg-ink-700/60"
          active-class="bg-ink-700/60 text-ink-50"
        >
          體 {{ t('shell.nav.bodyCultivation') }}
        </RouterLink>
        <RouterLink
          to="/spiritual-root"
          class="px-3 py-2 rounded hover:bg-ink-700/60"
          active-class="bg-ink-700/60 text-ink-50"
        >
          根 {{ t('shell.nav.spiritualRoot') }}
        </RouterLink>
        <RouterLink
          to="/skill-book"
          class="px-3 py-2 rounded hover:bg-ink-700/60"
          active-class="bg-ink-700/60 text-ink-50"
        >
          術 {{ t('shell.nav.skillBook') }}
        </RouterLink>
        <RouterLink
          to="/tribulation"
          class="px-3 py-2 rounded hover:bg-ink-700/60"
          active-class="bg-ink-700/60 text-ink-50"
        >
          劫 {{ t('shell.nav.tribulation') }}
        </RouterLink>
        <RouterLink
          to="/breakthrough"
          class="px-3 py-2 rounded hover:bg-ink-700/60"
          active-class="bg-ink-700/60 text-ink-50"
        >
          破 {{ t('shell.nav.breakthrough') }}
        </RouterLink>
        <RouterLink
          to="/achievements"
          class="px-3 py-2 rounded hover:bg-ink-700/60"
          active-class="bg-ink-700/60 text-ink-50"
        >
          成 {{ t('shell.nav.achievements') }}
        </RouterLink>
        <RouterLink
          to="/titles"
          class="px-3 py-2 rounded hover:bg-ink-700/60"
          active-class="bg-ink-700/60 text-ink-50"
          data-testid="shell-nav-titles"
        >
          號 {{ t('shell.nav.titles') }}
        </RouterLink>
        <RouterLink
          to="/reputation"
          class="px-3 py-2 rounded hover:bg-ink-700/60"
          active-class="bg-ink-700/60 text-ink-50"
          data-testid="shell-nav-reputation"
        >
          名 {{ t('shell.nav.reputation') }}
        </RouterLink>
        <RouterLink
          to="/npcs"
          class="px-3 py-2 rounded hover:bg-ink-700/60"
          active-class="bg-ink-700/60 text-ink-50"
        >
          人 {{ t('shell.nav.npcs') }}
        </RouterLink>
        <RouterLink
          to="/quests"
          class="px-3 py-2 rounded hover:bg-ink-700/60"
          active-class="bg-ink-700/60 text-ink-50"
        >
          冊 {{ t('shell.nav.quests') }}
        </RouterLink>
        <RouterLink
          to="/social"
          class="px-3 py-2 rounded hover:bg-ink-700/60"
          active-class="bg-ink-700/60 text-ink-50"
          data-testid="shell-nav-social"
        >
          友 {{ t('shell.nav.social') }}
        </RouterLink>
        <RouterLink
          to="/missions"
          class="px-3 py-2 rounded hover:bg-ink-700/60 relative"
          active-class="bg-ink-700/60 text-ink-50"
        >
          任 {{ t('shell.nav.missions') }}
          <span
            v-if="badges.missionClaimable > 0"
            class="absolute -top-1 -right-1 px-1.5 py-0.5 rounded-full bg-amber-500 text-[10px] text-white"
          >
            {{ badges.missionClaimable > 99 ? '99+' : badges.missionClaimable }}
          </span>
        </RouterLink>
        <RouterLink
          to="/mail"
          class="px-3 py-2 rounded hover:bg-ink-700/60 relative"
          active-class="bg-ink-700/60 text-ink-50"
        >
          書 {{ t('shell.nav.mail') }}
          <span
            v-if="game.unreadMail > 0"
            class="absolute -top-1 -right-1 px-1.5 py-0.5 rounded-full bg-red-600 text-[10px] text-white"
          >
            {{ game.unreadMail > 99 ? '99+' : game.unreadMail }}
          </span>
        </RouterLink>
        <RouterLink
          to="/giftcode"
          class="px-3 py-2 rounded hover:bg-ink-700/60"
          active-class="bg-ink-700/60 text-ink-50"
        >
          禮 {{ t('shell.nav.giftcode') }}
        </RouterLink>
        <RouterLink
          to="/support/feedback"
          class="px-3 py-2 rounded hover:bg-ink-700/60"
          active-class="bg-ink-700/60 text-ink-50"
          data-testid="shell-nav-feedback"
        >
          諫 {{ t('shell.nav.feedback') }}
        </RouterLink>
        <RouterLink
          to="/support/report-player"
          class="px-3 py-2 rounded hover:bg-ink-700/60"
          active-class="bg-ink-700/60 text-ink-50"
          data-testid="shell-nav-report-player"
        >
          訟 {{ t('shell.nav.reportPlayer') }}
        </RouterLink>
        <RouterLink
          to="/leaderboard"
          class="px-3 py-2 rounded hover:bg-ink-700/60"
          active-class="bg-ink-700/60 text-ink-50"
        >
          榜 {{ t('shell.nav.leaderboard') }}
        </RouterLink>
        <RouterLink
          to="/topup"
          class="px-3 py-2 rounded hover:bg-ink-700/60 relative"
          active-class="bg-ink-700/60 text-ink-50"
        >
          ⛧ {{ t('shell.nav.topup') }}
          <span
            v-if="badges.topupPending"
            class="absolute -top-1 -right-1 w-2.5 h-2.5 rounded-full bg-amber-400 ring-2 ring-ink-700"
            :title="t('shell.badge.topupPending')"
          />
        </RouterLink>
        <RouterLink
          to="/monetization"
          class="px-3 py-2 rounded hover:bg-ink-700/60"
          active-class="bg-ink-700/60 text-ink-50"
          data-testid="shell-nav-monetization"
        >
          令 {{ t('shell.nav.monetization') }}
        </RouterLink>
        <RouterLink
          to="/shop-packs"
          class="px-3 py-2 rounded hover:bg-ink-700/60"
          active-class="bg-ink-700/60 text-ink-50"
          data-testid="shell-nav-shop-packs"
        >
          包 {{ t('shell.nav.shopPacks') }}
        </RouterLink>
        <RouterLink
          to="/cosmetics"
          class="px-3 py-2 rounded hover:bg-ink-700/60"
          active-class="bg-ink-700/60 text-ink-50"
          data-testid="shell-nav-cosmetics"
        >
          飾 {{ t('shell.nav.cosmetics') }}
        </RouterLink>
        <RouterLink
          to="/activity"
          class="px-3 py-2 rounded hover:bg-ink-700/60"
          active-class="bg-ink-700/60 text-ink-50"
        >
          帳 {{ t('shell.nav.activity') }}
        </RouterLink>
        <RouterLink
          to="/settings"
          class="px-3 py-2 rounded hover:bg-ink-700/60"
          active-class="bg-ink-700/60 text-ink-50"
        >
          設 {{ t('shell.nav.settings') }}
        </RouterLink>
        <RouterLink
          v-if="isStaff"
          to="/admin"
          class="px-3 py-2 rounded hover:bg-ink-700/60 text-amber-200"
          active-class="bg-ink-700/60 text-ink-50"
        >
          官 {{ t('shell.nav.admin') }}
        </RouterLink>
      </aside>

      <!-- Main content -->
      <main class="p-4 md:p-6 overflow-y-auto">
        <slot />
      </main>

      <!-- ChatDock -->
      <aside
        class="hidden md:flex flex-col border-l border-ink-300/30 bg-ink-700/30 p-3 text-sm"
      >
        <ChatPanel />
      </aside>
    </div>
  </div>
</template>
