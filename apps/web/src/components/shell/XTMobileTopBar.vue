<script setup lang="ts">
/**
 * UI-2.0 — Mobile top app bar (56–64px).
 *
 * Hiển thị:
 *   - Logo XT + tagline “Tu Tiên Lộ”
 *   - Avatar/initials nhân vật + cảnh giới (chip)
 *   - Icon mail / notification / settings menu
 *   - Resource chips (Linh Thạch / Tiên Ngọc / Lực) cuộn ngang ngay dưới
 *     khi cần.
 *
 * Không lặp lại sidebar — sidebar không tồn tại trên mobile.
 */
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRouter } from 'vue-router';
import { useGameStore } from '@/stores/game';
import { useBadgesStore } from '@/stores/badges';
import XTIcon from '@/components/xianxia/XTIcon.vue';
import XTAvatarSeal from '@/components/xianxia/XTAvatarSeal.vue';
import ResourceChip from '@/components/xianxia/ResourceChip.vue';

const { t } = useI18n();
const router = useRouter();
const game = useGameStore();
const badges = useBadgesStore();

const realmText = computed(() => game.realmFullName || '—');

const mailCount = computed(() => game.unreadMail ?? 0);
const bossActive = computed(() => badges.bossActive);

function go(path: string): void {
  void router.push(path);
}
</script>

<template>
  <header
    class="xt-mobile-topbar sticky top-0 z-[var(--xt-z-topbar)] border-b border-emerald-300/30 bg-white/85 backdrop-blur-xl"
    style="padding-top: env(safe-area-inset-top, 0px)"
    data-testid="xt-mobile-topbar"
  >
    <div class="flex items-center gap-3 px-3 py-2.5">
      <button
        type="button"
        class="flex items-center gap-2 truncate"
        :aria-label="t('xt.brand.home')"
        @click="go('/dashboard')"
      >
        <span
          class="flex h-9 w-9 items-center justify-center rounded-2xl bg-gradient-to-br from-emerald-500 to-emerald-700 text-base font-black text-white shadow-[0_8px_22px_rgba(74,169,143,0.32)]"
          aria-hidden="true"
        >XT</span>
        <span class="truncate text-left">
          <span class="block text-[10px] font-semibold uppercase tracking-[0.28em] text-emerald-700/75">
            {{ t('app.tagline') }}
          </span>
          <span class="block truncate text-sm font-semibold leading-tight text-emerald-950">
            {{ game.character?.name ?? t('xt.character.unknown') }}
          </span>
        </span>
      </button>

      <span class="ml-auto flex items-center gap-2">
        <button
          type="button"
          class="relative flex h-10 w-10 items-center justify-center rounded-full border border-emerald-300/40 bg-white/70 text-emerald-900 transition hover:bg-emerald-50"
          :aria-label="t('shell.nav.mail')"
          data-testid="xt-mobile-mail"
          @click="go('/mail')"
        >
          <XTIcon name="mail" size="md" />
          <span
            v-if="mailCount > 0"
            class="absolute -right-1 -top-1 min-w-[18px] rounded-full bg-rose-500 px-1 text-[10px] font-semibold text-white"
          >
            {{ mailCount > 99 ? '99+' : mailCount }}
          </span>
        </button>
        <button
          type="button"
          class="relative flex h-10 w-10 items-center justify-center rounded-full border border-emerald-300/40 bg-white/70 text-emerald-900 transition hover:bg-emerald-50"
          :aria-label="t('shell.nav.notifications')"
          data-testid="xt-mobile-notifications"
          @click="go('/notifications')"
        >
          <XTIcon name="notification" size="md" />
          <span
            v-if="bossActive"
            class="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full bg-amber-400"
          />
        </button>
        <button
          type="button"
          class="flex h-10 w-10 items-center justify-center rounded-full border border-emerald-300/40 bg-white/70 text-emerald-900 transition hover:bg-emerald-50"
          :aria-label="t('shell.nav.settings')"
          @click="go('/settings')"
        >
          <XTIcon name="settings" size="md" />
        </button>
      </span>
    </div>

    <div class="flex items-center gap-2 overflow-x-auto px-3 pb-2 pt-0 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden" data-testid="xt-mobile-resources">
      <button
        type="button"
        class="flex shrink-0 items-center gap-2 rounded-full border border-emerald-300/35 bg-white/70 px-2 py-1.5 text-xs"
        @click="go('/character')"
      >
        <XTAvatarSeal :name="game.character?.name" size="sm" />
        <span class="truncate text-emerald-900">{{ realmText }}</span>
      </button>
      <ResourceChip icon="linhThach" :value="game.character?.linhThach ?? '0'" :label="t('dashboard.progression.linhThach')" />
      <ResourceChip icon="jade" :value="game.character?.tienNgoc ?? 0" :label="t('dashboard.progression.tienNgoc')" tone="gold" />
      <ResourceChip icon="power" :value="game.character?.power ?? 0" :label="t('dashboard.stat.power')" tone="cyan" />
    </div>
  </header>
</template>

<style scoped>
.xt-mobile-topbar {
  min-height: var(--xt-mobile-topbar-h);
  box-shadow: 0 6px 22px rgba(60, 100, 88, 0.08);
}
</style>
