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
    class="xt-mobile-topbar sticky top-0 z-[var(--xt-z-topbar)] border-b border-[var(--xt-border-gold)]"
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
        <span class="xt-seal" aria-hidden="true">玄</span>
        <span class="truncate text-left">
          <span class="xt-eyebrow block !text-[9px]">
            {{ t('app.tagline') }}
          </span>
          <span class="xt-heading-co block truncate text-sm leading-tight">
            {{ game.character?.name ?? t('xt.character.unknown') }}
          </span>
        </span>
      </button>

      <span class="ml-auto flex items-center gap-2">
        <button
          type="button"
          class="xt-topbar-icon-btn relative flex h-10 w-10 items-center justify-center rounded-full"
          :aria-label="t('shell.nav.mail')"
          data-testid="xt-mobile-mail"
          @click="go('/mail')"
        >
          <XTIcon name="mail" size="md" />
          <span
            v-if="mailCount > 0"
            class="absolute -right-1 -top-1 min-w-[18px] rounded-full bg-[var(--xt-seal)] px-1 text-[10px] font-semibold text-[var(--xt-scroll-paper-bright)] shadow-[var(--xt-shadow-seal)]"
          >
            {{ mailCount > 99 ? '99+' : mailCount }}
          </span>
        </button>
        <button
          type="button"
          class="xt-topbar-icon-btn relative flex h-10 w-10 items-center justify-center rounded-full"
          :aria-label="t('shell.nav.notifications')"
          data-testid="xt-mobile-notifications"
          @click="go('/notifications')"
        >
          <XTIcon name="notification" size="md" />
          <span
            v-if="bossActive"
            class="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full bg-[var(--xt-gold-bright)] shadow-[0_0_6px_rgba(242,215,137,0.85)]"
          />
        </button>
        <button
          type="button"
          class="xt-topbar-icon-btn flex h-10 w-10 items-center justify-center rounded-full"
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
        class="xt-topbar-realm-chip flex shrink-0 items-center gap-2 rounded-full border px-2 py-1.5 text-xs"
        @click="go('/character')"
      >
        <XTAvatarSeal :name="game.character?.name" size="sm" />
        <span class="truncate">{{ realmText }}</span>
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
  background:
    linear-gradient(180deg, rgba(14, 19, 24, 0.92) 0%, rgba(20, 28, 38, 0.86) 100%);
  backdrop-filter: blur(18px);
  box-shadow: 0 14px 32px rgba(0, 0, 0, 0.45);
  position: relative;
}
.xt-mobile-topbar::after {
  content: '';
  position: absolute;
  inset: auto 0 -1px 0;
  height: 1px;
  background: linear-gradient(
    90deg,
    transparent 0%,
    rgba(242, 215, 137, 0.45) 18%,
    rgba(242, 215, 137, 0.6) 50%,
    rgba(242, 215, 137, 0.45) 82%,
    transparent 100%
  );
}

.xt-topbar-icon-btn {
  border: 1px solid var(--xt-border-jade);
  background: rgba(20, 28, 38, 0.68);
  color: var(--xt-text-primary);
  transition: all var(--xt-motion-fast, 140ms) ease;
}
.xt-topbar-icon-btn:hover {
  border-color: rgba(95, 227, 198, 0.6);
  background: rgba(27, 59, 52, 0.7);
  color: var(--xt-jade-bright);
}

.xt-topbar-realm-chip {
  border-color: var(--xt-border-gold);
  background: rgba(28, 22, 12, 0.7);
  color: var(--xt-text-primary);
}
</style>
