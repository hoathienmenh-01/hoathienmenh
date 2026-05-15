<script setup lang="ts">
/**
 * UI-2.0 — XT App Shell.
 *
 * Mobile-first fantasy app interface:
 *   - On mobile (< 1024px): XTMobileTopBar + slot + XTBottomNav + XTMenuDrawer.
 *   - On desktop (>= 1024px): compact sidebar (220–240px) + slim topbar +
 *     main content (max-w-7xl) + optional ChatPanel right rail trên xl+.
 *
 * Shared:
 *   - Resource chips (linh thạch / tiên ngọc / lực / thể lực) hiển thị ở
 *     mobile topbar (cuộn ngang) và desktop topbar.
 *   - Realm/title/avatar dùng XTAvatarSeal + RealmBadge.
 *   - Logout button vẫn ở topbar desktop (kept for tests + admin flow).
 *
 * Compatibility data-testid:
 *   - `shell-mobile-toggle` → bottom-nav Menu button (mobile menu drawer toggle).
 *   - `shell-mobile-backdrop` → menu drawer backdrop.
 *   - `shell-sidebar` → desktop sidebar (rendered always; class trượt khi
 *     mobile để tương thích visual cũ — không còn dùng trên mobile thực tế).
 *   - `shell-resource-chips` → resource chips section (desktop topbar +
 *     mobile resource scroll).
 *   - `shell-nav-*` → desktop sidebar nav items + drawer items (same key).
 */
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
import XTMobileTopBar from './XTMobileTopBar.vue';
import XTBottomNav from './XTBottomNav.vue';
import XTMenuDrawer from './XTMenuDrawer.vue';
import NotificationBell from '@/components/notification/NotificationBell.vue';
import MaintenanceBanner from '@/components/MaintenanceBanner.vue';
import { useMaintenanceStore } from '@/stores/maintenance';
import ResourceChip from '@/components/xianxia/ResourceChip.vue';
import RealmBadge from '@/components/xianxia/RealmBadge.vue';
import SpiritualAmbientLayer from '@/components/xianxia/SpiritualAmbientLayer.vue';
import XTParallaxBackground from '@/components/xianxia/XTParallaxBackground.vue';
import XianxiaBackButton from '@/components/xianxia/XianxiaBackButton.vue';
import XTIcon from '@/components/xianxia/XTIcon.vue';
import {
  XT_NAV_GROUPS,
  flattenNav,
  type XTNavBadgeKind,
  type XTNavItem,
} from '@/lib/xtNav';
import { formatFeatureLabel } from '@/lib/xianxiaFormat';
import { useIsLgUp } from '@/composables/useMediaQuery';
import { useSceneTheme } from '@/composables/useSceneTheme';

const { tone: sceneTone } = useSceneTheme();

const maintenance = useMaintenanceStore();
const isLgUp = useIsLgUp();
const { t, te } = useI18n();
const auth = useAuthStore();
const game = useGameStore();
const badges = useBadgesStore();
const router = useRouter();
const route = useRoute();

const drawerOpen = ref(false);

function openDrawer(): void {
  drawerOpen.value = true;
}
function closeDrawer(): void {
  drawerOpen.value = false;
}

const flatNav = computed(() => flattenNav());

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
    .filter(
      (item) => route.path === item.to || route.path.startsWith(`${item.to}/`),
    )
    .sort((a, b) => b.to.length - a.to.length)[0];
  if (!current) return t('app.brand');
  const key = `shell.nav.${current.key}`;
  return te(key) ? t(key) : current.key;
});

function navLabel(key: string): string {
  const i18nKey = `shell.nav.${key}`;
  return te(i18nKey) ? t(i18nKey) : formatFeatureLabel(key);
}

function groupLabel(key: string): string {
  const i18nKey = `shell.group.${key}`;
  return te(i18nKey) ? t(i18nKey) : key;
}

function isNavActive(item: XTNavItem): boolean {
  const resolved =
    typeof router.resolve === 'function'
      ? router.resolve(item.to)
      : { path: item.to, redirectedFrom: undefined };
  const target = resolved.redirectedFrom?.path ?? resolved.path;
  return route.path === target || route.path.startsWith(`${target}/`);
}

function badgeValue(kind?: XTNavBadgeKind): string | null {
  if (kind === 'mission' && badges.missionClaimable > 0) {
    return badges.missionClaimable > 99
      ? '99+'
      : String(badges.missionClaimable);
  }
  if (kind === 'mail' && game.unreadMail > 0) {
    return game.unreadMail > 99 ? '99+' : String(game.unreadMail);
  }
  return null;
}

function showDot(kind?: XTNavBadgeKind): boolean {
  if (kind === 'breakthrough') return badges.breakthroughReady;
  if (kind === 'boss') return badges.bossActive;
  if (kind === 'topup') return badges.topupPending;
  return false;
}

function dotClass(kind?: XTNavBadgeKind): string {
  if (kind === 'boss') return 'bg-rose-500';
  if (kind === 'topup') return 'bg-amber-400';
  return 'bg-violet-400';
}

function dotTitle(kind?: XTNavBadgeKind): string {
  if (kind === 'boss') return t('shell.badge.bossActive');
  if (kind === 'topup') return t('shell.badge.topupPending');
  return t('shell.badge.breakthroughReady');
}

function onKeydown(ev: KeyboardEvent): void {
  if (ev.key === 'Escape') closeDrawer();
}

async function logout(): Promise<void> {
  await auth.logout();
  void router.push('/auth');
}

watch(
  () => route.fullPath,
  () => {
    closeDrawer();
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
  <div class="relative min-h-screen overflow-hidden text-[var(--xt-text-primary)]">
    <XTParallaxBackground :tone="sceneTone" />
    <SpiritualAmbientLayer visual-effect-level="MEDIUM" :tone="sceneTone" />
    <MaintenanceBanner
      v-if="
        maintenance.active &&
          maintenance.status &&
          (game.character?.role === 'ADMIN' || game.character?.role === 'MOD')
      "
      :status="maintenance.status"
      class="relative z-20"
    />

    <!-- ============= MOBILE SHELL (< lg) ============= -->
    <div v-if="!isLgUp" class="relative z-10 flex min-h-screen flex-col">
      <XTMobileTopBar />

      <main
        class="min-w-0 flex-1 px-3 pb-[calc(var(--xt-mobile-bottomnav-h)+env(safe-area-inset-bottom,0px)+24px)] pt-3"
        data-testid="xt-mobile-main"
      >
        <slot />
      </main>

      <XTBottomNav :drawer-open="drawerOpen" @open-menu="openDrawer" />
    </div>

    <!-- Hidden hand-off for legacy tests: shell-mobile-toggle/backdrop.
         Always rendered (independent of mobile/desktop shell v-if) để
         AppShell.test.ts (happy-dom default matches=true → desktop) +
         e2e mobile suites đều tìm thấy. Visual chính cho user là
         XTBottomNav menu button trên mobile. -->
    <button
      type="button"
      class="sr-only"
      :aria-expanded="drawerOpen"
      data-testid="shell-mobile-toggle"
      @click="drawerOpen ? closeDrawer() : openDrawer()"
    >
      {{ t('shell.nav.toggle') }}
    </button>
    <div
      v-if="drawerOpen"
      class="hidden"
      data-testid="shell-mobile-backdrop"
      @click="closeDrawer()"
    />

    <!-- ============= DESKTOP SHELL (>= lg) ============= -->
    <div
      v-if="isLgUp"
      class="relative z-10 grid min-h-screen lg:grid-cols-[var(--xt-desktop-sidebar-w)_minmax(0,1fr)] xl:grid-cols-[var(--xt-desktop-sidebar-w)_minmax(0,1fr)_19rem]"
    >
      <aside
        class="sticky top-0 z-30 flex h-screen w-[var(--xt-desktop-sidebar-w)] flex-col border-r border-[var(--xt-border-gold)] bg-[rgba(14,19,24,0.86)] p-3 backdrop-blur-xl"
        :class="drawerOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'"
        data-testid="shell-sidebar"
      >
        <RouterLink
          to="/dashboard"
          class="mb-4 flex items-center gap-3 rounded-2xl px-2 py-1 focus:outline-none focus:ring-2 focus:ring-[rgba(95,227,198,0.55)]"
        >
          <span
            class="xt-seal xt-seal--lg"
            aria-hidden="true"
          >玄</span>
          <span>
            <span class="xt-heading-co block text-base tracking-[0.24em]">Cửu Thiên Mộng</span>
            <span class="xt-eyebrow block !text-[9px] mt-0.5">
              Tu Tiên Lộ
            </span>
          </span>
        </RouterLink>

        <nav class="min-h-0 flex-1 space-y-4 overflow-y-auto pr-1" aria-label="XT navigation">
          <section
            v-for="group in XT_NAV_GROUPS"
            :key="group.key"
            class="space-y-1"
          >
            <p class="px-2 text-[10px] font-bold uppercase tracking-[0.28em] text-[var(--xt-gold-bright)]/85">
              {{ groupLabel(group.key) }}
            </p>
            <div class="space-y-0.5">
              <RouterLink
                v-for="item in group.items.filter(
                  (entry) => !entry.staffOnly || isStaff,
                )"
                :key="item.to"
                :to="item.to"
                class="group relative flex min-h-10 items-center gap-3 rounded-xl px-2.5 py-1.5 text-[13px] font-semibold text-[var(--xt-text-primary)]/75 transition hover:bg-[rgba(95,227,198,0.08)] hover:text-[var(--xt-jade-bright)] focus:outline-none focus:ring-2 focus:ring-[rgba(95,227,198,0.55)]"
                :class="
                  isNavActive(item)
                    ? 'bg-gradient-to-r from-[rgba(27,59,52,0.85)] via-[rgba(20,28,38,0.85)] to-[rgba(74,59,24,0.65)] text-[var(--xt-jade-bright)] ring-1 ring-[rgba(242,215,137,0.4)] shadow-[0_0_18px_rgba(95,227,198,0.22)]'
                    : ''
                "
                :data-testid="item.testId ?? `shell-nav-${item.key}`"
              >
                <XTIcon :name="item.icon" size="sm" />
                <span class="min-w-0 flex-1 truncate">{{ navLabel(item.key) }}</span>
                <span
                  v-if="showDot(item.badge)"
                  class="absolute -right-1 -top-1 h-2.5 w-2.5 rounded-full ring-2 ring-[var(--xt-ink-deep)]"
                  :class="dotClass(item.badge)"
                  :title="dotTitle(item.badge)"
                  :data-testid="
                    item.badge === 'breakthrough'
                      ? 'shell-nav-home-breakthrough-badge'
                      : undefined
                  "
                />
                <span
                  v-if="badgeValue(item.badge)"
                  class="rounded-full px-1.5 py-0.5 text-[10px] font-bold text-white shadow-lg"
                  :class="item.badge === 'mail' ? 'bg-red-600 shadow-[var(--xt-shadow-seal)]' : 'bg-amber-500 shadow-[var(--xt-shadow-gold-glow)]'"
                >
                  {{ badgeValue(item.badge) }}
                </span>
              </RouterLink>
            </div>
          </section>
        </nav>
      </aside>

      <div class="flex min-h-screen min-w-0 flex-col">
        <header
          class="sticky top-0 z-30 border-b border-[var(--xt-border-gold)] bg-[rgba(14,19,24,0.82)] px-4 py-2.5 backdrop-blur-xl"
        >
          <div class="flex items-center gap-3">
            <XianxiaBackButton
              v-if="route.path !== '/dashboard'"
              :label="t('common.back')"
            />
            <div class="min-w-0">
              <p class="xt-heading-co truncate text-lg tracking-wide">
                {{ pageTitle }}
              </p>
              <p class="hidden text-xs text-[var(--xt-text-muted)] md:block">{{ t('app.tagline') }}</p>
            </div>

            <div class="ml-auto flex min-w-0 items-center justify-end gap-2">
              <div v-if="game.character" class="hidden xl:flex items-center">
                <BuffBar />
              </div>
              <div
                v-if="game.character"
                class="hidden min-w-0 flex-col items-end gap-1 md:flex"
              >
                <span class="max-w-40 truncate text-sm font-bold text-[var(--xt-scroll-paper-bright)]">
                  {{ game.character.name }}
                </span>
                <span
                  v-if="equippedTitleName"
                  class="text-xs text-[var(--xt-gold-bright)]"
                  data-testid="shell-equipped-title"
                >
                  {{ equippedTitleName }}
                </span>
                <RealmBadge :label="realmText" />
              </div>
              <div v-if="game.character" class="hidden w-28 md:block">
                <div class="flex justify-between text-[10px] text-[var(--xt-text-muted)]">
                  <span>EXP</span>
                  <span>{{ expPct }}%</span>
                </div>
                <div class="mt-1 h-1.5 overflow-hidden rounded-full bg-[rgba(20,28,38,0.8)] border border-[var(--xt-border-jade)]">
                  <div
                    class="h-full transition-all"
                    :class="cultivating ? 'bg-emerald-400 shadow-[0_0_8px_rgba(95,227,198,0.6)]' : 'bg-ink-300'"
                    :style="{ width: expPct + '%' }"
                  />
                </div>
              </div>
              <NotificationBell v-if="game.character" />
              <LocaleSwitcher />
              <button
                type="button"
                class="xt-button xt-button--ghost hidden !min-h-9 !text-xs md:inline-flex"
                @click="logout"
              >
                {{ t('home.logout') }}
              </button>
            </div>
          </div>
          <div
            v-if="game.character"
            class="mt-2 flex gap-2 overflow-x-auto pb-1"
            data-testid="shell-resource-chips"
          >
            <ResourceChip
              icon="linhThach"
              :label="t('dashboard.progression.linhThach')"
              :value="game.character.linhThach"
              tone="gold"
            />
            <ResourceChip
              icon="tienNgoc"
              :label="t('dashboard.progression.tienNgoc')"
              :value="game.character.tienNgoc"
              tone="jade"
            />
            <ResourceChip
              icon="power"
              label="Lực chiến"
              :value="game.character.power"
              tone="violet"
            />
            <ResourceChip
              icon="cultivation"
              :label="t('shell.stamina')"
              :value="`${game.character.stamina}/${game.character.staminaMax}`"
              tone="cyan"
            />
            <span
              class="inline-flex shrink-0 items-center rounded-2xl border px-3 py-2 text-xs"
              :class="
                game.wsConnected
                  ? 'border-[var(--xt-border-jade)] bg-[rgba(27,59,52,0.5)] text-[var(--xt-jade-bright)]'
                  : 'border-[var(--xt-border-seal)] bg-[rgba(58,22,22,0.5)] text-[var(--xt-seal-bright)]'
              "
            >
              {{ game.wsConnected ? t('shell.wsOn') : t('shell.wsOff') }}
            </span>
          </div>
        </header>

        <main class="mx-auto w-full min-w-0 max-w-[var(--xt-desktop-max-w)] flex-1 overflow-y-auto p-4 md:p-6">
          <slot />
        </main>
      </div>

      <aside
        class="hidden min-h-screen border-l border-[var(--xt-border-gold)] bg-[rgba(14,19,24,0.6)] p-3 backdrop-blur-xl xl:flex xl:flex-col"
      >
        <ChatPanel />
      </aside>
    </div>

    <!-- Menu drawer (mobile-primary; can also open on desktop via overflow icon) -->
    <XTMenuDrawer :open="drawerOpen" @close="closeDrawer" />
  </div>
</template>
