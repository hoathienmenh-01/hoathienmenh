<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
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
import GameIcon from '@/components/xianxia/GameIcon.vue';
import ResourceChip from '@/components/xianxia/ResourceChip.vue';
import RealmBadge from '@/components/xianxia/RealmBadge.vue';
import SpiritualAmbientLayer from '@/components/xianxia/SpiritualAmbientLayer.vue';
import XianxiaBackButton from '@/components/xianxia/XianxiaBackButton.vue';

interface NavItem {
  key: string;
  icon: string;
  to: string;
  testId?: string;
  staffOnly?: boolean;
  badge?: 'breakthrough' | 'boss' | 'mission' | 'mail' | 'topup';
}

interface NavGroup {
  titleKey: string;
  items: NavItem[];
}

const maintenance = useMaintenanceStore();
const { t, te } = useI18n();
const auth = useAuthStore();
const game = useGameStore();
const badges = useBadgesStore();
const router = useRouter();
const route = useRoute();

const mobileNavOpen = ref(false);

const navGroups: NavGroup[] = [
  {
    titleKey: 'shell.group.core',
    items: [
      { key: 'home', icon: 'home', to: '/home', badge: 'breakthrough' },
      { key: 'dashboard', icon: 'dashboard', to: '/dashboard', testId: 'shell-nav-dashboard' },
      { key: 'character', icon: 'character', to: '/character' },
    ],
  },
  {
    titleKey: 'shell.group.cultivation',
    items: [
      { key: 'cultivation', icon: 'cultivation', to: '/cultivation' },
      { key: 'breakthrough', icon: 'realmBadge', to: '/breakthrough' },
      { key: 'bodyCultivation', icon: 'body', to: '/body-cultivation' },
      { key: 'cultivationMethod', icon: 'cultivation', to: '/cultivation-method' },
      { key: 'spiritualRoot', icon: 'realmBadge', to: '/spiritual-root' },
      { key: 'skillBook', icon: 'cultivation', to: '/skill-book' },
      { key: 'alchemy', icon: 'alchemy', to: '/alchemy' },
    ],
  },
  {
    titleKey: 'shell.group.activity',
    items: [
      { key: 'inventory', icon: 'inventory', to: '/inventory' },
      { key: 'equipment', icon: 'equipment', to: '/equipment', testId: 'shell-nav-equipment' },
      { key: 'pets', icon: 'pet', to: '/pets' },
      { key: 'secretRealms', icon: 'realm', to: '/secret-realms' },
      { key: 'dungeonRun', icon: 'realm', to: '/dungeon-run' },
      { key: 'roguelike', icon: 'roguelike', to: '/roguelike-realms' },
      { key: 'tower', icon: 'tower', to: '/tower' },
      { key: 'boss', icon: 'boss', to: '/boss', badge: 'boss' },
      { key: 'missions', icon: 'event', to: '/missions', badge: 'mission' },
    ],
  },
  {
    titleKey: 'shell.group.social',
    items: [
      { key: 'sect', icon: 'sect', to: '/sect' },
      { key: 'market', icon: 'market', to: '/market' },
      { key: 'auction', icon: 'auction', to: '/auction' },
      { key: 'events', icon: 'event', to: '/events' },
      { key: 'achievements', icon: 'achievement', to: '/achievements' },
      { key: 'mail', icon: 'mail', to: '/mail', badge: 'mail' },
      { key: 'social', icon: 'social', to: '/social', testId: 'shell-nav-social' },
      { key: 'leaderboard', icon: 'achievement', to: '/leaderboard' },
    ],
  },
  {
    titleKey: 'shell.group.system',
    items: [
      { key: 'settings', icon: 'settings', to: '/settings' },
      { key: 'notificationSettings', icon: 'notification', to: '/notification-settings', testId: 'shell-nav-notification-settings' },
      { key: 'activity', icon: 'stone', to: '/activity' },
      { key: 'giftcode', icon: 'event', to: '/giftcode' },
      { key: 'topup', icon: 'jade', to: '/topup', badge: 'topup' },
      { key: 'feedback', icon: 'support', to: '/support/feedback', testId: 'shell-nav-feedback' },
      { key: 'reportPlayer', icon: 'support', to: '/support/report-player', testId: 'shell-nav-report-player' },
      { key: 'admin', icon: 'admin', to: '/admin', staffOnly: true },
    ],
  },
];

const flatNav = computed(() => navGroups.flatMap((g) => g.items));
const expPct = computed(() => Math.round(game.expProgress * 100));
const realmText = computed(() => game.realmFullName || '—');
const cultivating = computed(() => game.character?.cultivating ?? false);
const isStaff = computed(() => {
  const r = game.character?.role;
  return r === 'ADMIN' || r === 'MOD';
});
const equippedTitleName = computed<string | null>(() => {
  const key = game.character?.title;
  if (!key) return null;
  const def = getTitleDef(key);
  return def?.nameVi ?? null;
});
const pageTitle = computed(() => {
  const current = flatNav.value
    .filter((item) => route.path === item.to || route.path.startsWith(`${item.to}/`))
    .sort((a, b) => b.to.length - a.to.length)[0];
  if (!current) return t('app.brand');
  const key = `shell.nav.${current.key}`;
  return te(key) ? t(key) : current.key;
});

function toggleMobileNav(): void {
  mobileNavOpen.value = !mobileNavOpen.value;
}

function closeMobileNav(): void {
  mobileNavOpen.value = false;
}

function navLabel(key: string): string {
  const i18nKey = `shell.nav.${key}`;
  return te(i18nKey) ? t(i18nKey) : key;
}

function badgeValue(kind?: NavItem['badge']): string | null {
  if (kind === 'mission' && badges.missionClaimable > 0) {
    return badges.missionClaimable > 99 ? '99+' : String(badges.missionClaimable);
  }
  if (kind === 'mail' && game.unreadMail > 0) {
    return game.unreadMail > 99 ? '99+' : String(game.unreadMail);
  }
  return null;
}

function showDot(kind?: NavItem['badge']): boolean {
  if (kind === 'breakthrough') return badges.breakthroughReady;
  if (kind === 'boss') return badges.bossActive;
  if (kind === 'topup') return badges.topupPending;
  return false;
}

function dotClass(kind?: NavItem['badge']): string {
  if (kind === 'boss') return 'bg-rose-500';
  if (kind === 'topup') return 'bg-amber-400';
  return 'bg-violet-400';
}

function dotTitle(kind?: NavItem['badge']): string {
  if (kind === 'boss') return t('shell.badge.bossActive');
  if (kind === 'topup') return t('shell.badge.topupPending');
  return t('shell.badge.breakthroughReady');
}

function onKeydown(ev: KeyboardEvent): void {
  if (ev.key === 'Escape') closeMobileNav();
}

async function logout(): Promise<void> {
  await auth.logout();
  void router.push('/auth');
}

watch(
  () => route.fullPath,
  () => {
    mobileNavOpen.value = false;
  },
);

onMounted(() => {
  badges.start();
  void game.fetchState();
  void game.hydrateUnreadMail();
  game.bindSocket();
  window.addEventListener('keydown', onKeydown);
});

onBeforeUnmount(() => {
  badges.stop();
  window.removeEventListener('keydown', onKeydown);
});
</script>

<template>
  <div class="relative min-h-screen overflow-hidden bg-[#06111f] text-slate-100">
    <SpiritualAmbientLayer visual-effect-level="MEDIUM" />
    <MaintenanceBanner
      v-if="maintenance.active && maintenance.status && (game.character?.role === 'ADMIN' || game.character?.role === 'MOD')"
      :status="maintenance.status"
      class="relative z-20"
    />

    <div class="relative z-10 min-h-screen lg:grid lg:grid-cols-[18rem_minmax(0,1fr)_19rem]">
      <div
        v-if="mobileNavOpen"
        class="fixed inset-0 z-40 bg-slate-950/75 backdrop-blur-sm lg:hidden"
        data-testid="shell-mobile-backdrop"
        @click="closeMobileNav()"
      />

      <aside
        class="fixed inset-y-0 left-0 z-50 flex w-72 max-w-[86vw] flex-col border-r border-cyan-200/15 bg-slate-950/95 p-4 shadow-2xl shadow-cyan-950/40 transition-transform duration-200 lg:static lg:z-auto lg:w-auto lg:max-w-none lg:translate-x-0 lg:bg-slate-950/55 lg:backdrop-blur-xl"
        :class="mobileNavOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'"
        data-testid="shell-sidebar"
      >
        <div class="mb-5 flex items-center justify-between gap-3">
          <RouterLink to="/home" class="flex items-center gap-3 rounded-3xl focus:outline-none focus:ring-2 focus:ring-cyan-300/60">
            <div class="flex h-12 w-12 items-center justify-center rounded-3xl border border-cyan-200/30 bg-gradient-to-br from-emerald-300/20 via-cyan-300/15 to-violet-300/20 text-xl font-black text-cyan-50 shadow-[0_0_26px_rgba(34,211,238,0.25)]">
              XT
            </div>
            <div>
              <p class="text-lg font-black tracking-[0.24em] text-slate-50">XT</p>
              <p class="text-xs uppercase tracking-[0.28em] text-cyan-200/70">Tu Tiên Lộ</p>
            </div>
          </RouterLink>
          <button
            type="button"
            class="rounded-2xl border border-cyan-200/15 p-2 text-slate-300 lg:hidden"
            aria-label="Thoát menu"
            @click="closeMobileNav()"
          >
            <GameIcon name="close" size="sm" />
          </button>
        </div>

        <nav class="min-h-0 flex-1 space-y-5 overflow-y-auto pr-1" aria-label="XT navigation">
          <section v-for="group in navGroups" :key="group.titleKey" class="space-y-2">
            <p class="px-2 text-[10px] font-bold uppercase tracking-[0.28em] text-slate-500">
              {{ t(group.titleKey) }}
            </p>
            <div class="space-y-1">
              <RouterLink
                v-for="item in group.items.filter((entry) => !entry.staffOnly || isStaff)"
                :key="item.to"
                :to="item.to"
                class="group relative flex min-h-11 items-center gap-3 rounded-2xl px-3 py-2 text-sm text-slate-300 transition hover:-translate-y-0.5 hover:bg-cyan-300/10 hover:text-cyan-50 focus:outline-none focus:ring-2 focus:ring-cyan-300/60"
                active-class="bg-gradient-to-r from-emerald-300/20 via-cyan-300/15 to-violet-300/20 text-cyan-50 ring-1 ring-cyan-200/25 shadow-[0_0_24px_rgba(34,211,238,0.16)]"
                :data-testid="item.testId ?? `shell-nav-${item.key}`"
              >
                <GameIcon :name="item.icon" size="sm" />
                <span class="min-w-0 flex-1 truncate">{{ navLabel(item.key) }}</span>
                <span
                  v-if="showDot(item.badge)"
                  class="absolute -right-1 -top-1 h-2.5 w-2.5 rounded-full ring-2 ring-slate-950"
                  :class="dotClass(item.badge)"
                  :title="dotTitle(item.badge)"
                  :data-testid="item.badge === 'breakthrough' ? 'shell-nav-home-breakthrough-badge' : undefined"
                />
                <span
                  v-if="badgeValue(item.badge)"
                  class="rounded-full px-1.5 py-0.5 text-[10px] font-bold text-white shadow-lg"
                  :class="item.badge === 'mail' ? 'bg-red-600' : 'bg-amber-500'"
                >
                  {{ badgeValue(item.badge) }}
                </span>
              </RouterLink>
            </div>
          </section>
        </nav>
      </aside>

      <div class="flex min-h-screen min-w-0 flex-col">
        <header class="sticky top-0 z-30 border-b border-cyan-200/10 bg-slate-950/70 px-3 py-3 backdrop-blur-xl md:px-5">
          <div class="flex items-center gap-3">
            <button
              type="button"
              class="rounded-2xl border border-cyan-200/15 p-2 text-slate-200 lg:hidden"
              :aria-label="t('shell.nav.toggle')"
              :aria-expanded="mobileNavOpen"
              data-testid="shell-mobile-toggle"
              @click="toggleMobileNav()"
            >
              <span aria-hidden="true" class="text-xl leading-none">{{ mobileNavOpen ? '✕' : '☰' }}</span>
            </button>
            <XianxiaBackButton
              v-if="route.path !== '/home'"
              class="hidden md:inline-flex"
              :label="t('common.back')"
            />
            <div class="min-w-0">
              <p class="truncate text-lg font-black tracking-wide text-slate-50">{{ pageTitle }}</p>
              <p class="hidden text-xs text-cyan-200/65 md:block">{{ t('app.tagline') }}</p>
            </div>

            <div class="ml-auto flex min-w-0 items-center justify-end gap-2">
              <div v-if="game.character" class="hidden xl:flex items-center">
                <BuffBar />
              </div>
              <div v-if="game.character" class="hidden min-w-0 flex-col items-end gap-1 md:flex">
                <span class="max-w-40 truncate text-sm font-bold text-slate-50">{{ game.character.name }}</span>
                <span v-if="equippedTitleName" class="text-xs text-amber-200" data-testid="shell-equipped-title">
                  {{ equippedTitleName }}
                </span>
                <RealmBadge :label="realmText" />
              </div>
              <div v-if="game.character" class="hidden w-28 md:block">
                <div class="flex justify-between text-[10px] text-slate-400">
                  <span>EXP</span>
                  <span>{{ expPct }}%</span>
                </div>
                <div class="mt-1 h-1.5 overflow-hidden rounded-full bg-slate-900">
                  <div
                    class="h-full transition-all"
                    :class="cultivating ? 'bg-emerald-400' : 'bg-slate-400'"
                    :style="{ width: expPct + '%' }"
                  />
                </div>
              </div>
              <NotificationBell v-if="game.character" />
              <LocaleSwitcher />
              <button
                type="button"
                class="hidden rounded-2xl border border-rose-200/20 px-3 py-2 text-xs text-rose-100 transition hover:bg-rose-400/10 md:inline-flex"
                @click="logout"
              >
                {{ t('home.logout') }}
              </button>
            </div>
          </div>
          <div
            v-if="game.character"
            class="mt-3 flex gap-2 overflow-x-auto pb-1"
            data-testid="shell-resource-chips"
          >
            <ResourceChip icon="stone" :label="t('dashboard.progression.linhThach')" :value="game.character.linhThach" tone="gold" />
            <ResourceChip icon="jade" :label="t('dashboard.progression.tienNgoc')" :value="game.character.tienNgoc" tone="jade" />
            <ResourceChip icon="power" label="Lực chiến" :value="game.character.power" tone="violet" />
            <ResourceChip icon="cultivation" :label="t('shell.stamina')" :value="`${game.character.stamina}/${game.character.staminaMax}`" tone="cyan" />
            <span
              class="inline-flex shrink-0 items-center rounded-2xl border px-3 py-2 text-xs"
              :class="game.wsConnected ? 'border-emerald-200/20 bg-emerald-300/10 text-emerald-100' : 'border-rose-200/20 bg-rose-300/10 text-rose-100'"
            >
              {{ game.wsConnected ? t('shell.wsOn') : t('shell.wsOff') }}
            </span>
          </div>
        </header>

        <main class="min-w-0 flex-1 overflow-y-auto p-4 md:p-6">
          <slot />
        </main>
      </div>

      <aside class="hidden min-h-screen border-l border-cyan-200/10 bg-slate-950/45 p-3 backdrop-blur-xl lg:flex lg:flex-col">
        <ChatPanel />
      </aside>
    </div>
  </div>
</template>
