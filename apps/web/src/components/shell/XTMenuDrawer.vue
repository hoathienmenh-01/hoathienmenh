<script setup lang="ts">
/**
 * UI-2.0 — Mobile menu drawer (bottom sheet).
 *
 * Mở khi user bấm “Menu” trong bottom nav. Hiển thị toàn bộ chức năng theo
 * nhóm (Nhân Vật / Hoạt Động / Vật Phẩm / Xã Hội / Kinh Tế / Dài Hạn /
 * Hệ Thống). Mỗi item là một button → router.push.
 *
 * Đóng:
 *   - Bấm backdrop
 *   - Bấm nút Đóng
 *   - ESC
 *   - Sau khi click item (auto-close → route change)
 */
import { computed, watch, onMounted, onBeforeUnmount } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRouter } from 'vue-router';
import { XT_NAV_GROUPS } from '@/lib/xtNav';
import { useGameStore } from '@/stores/game';
import { useBadgesStore } from '@/stores/badges';
import XTIcon from '@/components/xianxia/XTIcon.vue';

const props = defineProps<{ open: boolean }>();
const emit = defineEmits<{ (e: 'close'): void }>();

const { t, te } = useI18n();
const router = useRouter();
const game = useGameStore();
const badges = useBadgesStore();

function tSafe(key: string): string {
  return te(key) ? t(key) : key;
}

const isStaff = computed(() => {
  const r = game.character?.role;
  return r === 'ADMIN' || r === 'MOD';
});

const groups = computed(() =>
  XT_NAV_GROUPS.map((group) => ({
    key: group.key,
    label: tSafe(`shell.group.${group.key}`),
    accent: group.accent,
    items: group.items
      .filter((it) => !it.staffOnly || isStaff.value)
      .map((it) => ({
        ...it,
        label: tSafe(`shell.nav.${it.key}`),
      })),
  })).filter((g) => g.items.length > 0),
);

function badgeCount(kind: string | undefined): number {
  if (!kind) return 0;
  if (kind === 'boss') return badges.bossActive ? 1 : 0;
  if (kind === 'mission') return badges.missionClaimable;
  if (kind === 'mail') return game.unreadMail ?? 0;
  if (kind === 'topup') return badges.topupPending ? 1 : 0;
  if (kind === 'breakthrough') return badges.breakthroughReady ? 1 : 0;
  return 0;
}

function navigate(to: string): void {
  emit('close');
  void router.push(to);
}

function onKey(e: KeyboardEvent): void {
  if (e.key === 'Escape' && props.open) emit('close');
}

onMounted(() => {
  window.addEventListener('keydown', onKey);
});

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKey);
});

watch(
  () => props.open,
  (open) => {
    if (typeof document === 'undefined') return;
    document.body.style.overflow = open ? 'hidden' : '';
  },
);
</script>

<template>
  <Teleport to="body">
    <transition name="xt-fade">
      <div
        v-if="open"
        class="fixed inset-0 z-[var(--xt-z-drawer)] bg-black/65 backdrop-blur-sm"
        data-testid="xt-menu-backdrop"
        @click="emit('close')"
      />
    </transition>
    <transition name="xt-sheet">
      <aside
        v-if="open"
        role="dialog"
        aria-modal="true"
        aria-label="XT menu"
        class="xt-menu-drawer fixed left-0 right-0 bottom-0 z-[calc(var(--xt-z-drawer)+1)] max-h-[88vh] overflow-y-auto rounded-t-3xl md:left-auto md:bottom-auto md:top-16 md:right-6 md:h-auto md:w-[420px] md:max-h-[80vh] md:rounded-3xl"
        style="padding-bottom: calc(env(safe-area-inset-bottom, 0px) + 16px)"
        data-testid="xt-menu-drawer"
      >
        <div class="xt-menu-drawer__header sticky top-0 z-10 flex items-center justify-between gap-3 px-5 py-3 backdrop-blur">
          <div>
            <p class="xt-eyebrow !text-[10px]">
              Tu Tiên Lộ · Cửu Thiên Mộng
            </p>
            <h2 class="xt-heading-co text-base mt-1">
              {{ t('xt.menu.title') }}
            </h2>
          </div>
          <button
            type="button"
            class="xt-topbar-icon-btn inline-flex h-10 w-10 items-center justify-center rounded-full"
            :aria-label="t('common.close')"
            data-testid="xt-menu-close"
            @click="emit('close')"
          >
            <XTIcon name="close" size="md" />
          </button>
        </div>

        <div class="space-y-4 px-4 py-4">
          <section
            v-for="group in groups"
            :key="group.key"
            class="xt-card xt-card--elevated p-3"
            :data-testid="`xt-menu-group-${group.key}`"
          >
            <h3 class="xt-eyebrow !text-[10px] mb-2 px-1">
              {{ group.label }}
            </h3>
            <ul class="grid grid-cols-2 gap-2 sm:grid-cols-3">
              <li v-for="item in group.items" :key="item.key">
                <button
                  type="button"
                  class="xt-menu-drawer__item group flex w-full items-center gap-2 rounded-xl px-2.5 py-2 text-left text-sm transition"
                  :data-testid="`xt-menu-item-${item.key}`"
                  @click="navigate(item.to)"
                >
                  <span class="xt-menu-drawer__icon inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl">
                    <XTIcon :name="item.icon" size="md" />
                  </span>
                  <span class="min-w-0 flex-1">
                    <span class="block truncate font-medium leading-tight text-[var(--xt-text-primary)]">{{
                      item.label
                    }}</span>
                  </span>
                  <span
                    v-if="badgeCount(item.badge) > 0"
                    class="rounded-full bg-[var(--xt-seal)] px-1.5 py-0.5 text-[10px] font-semibold text-[var(--xt-scroll-paper-bright)] shadow-[var(--xt-shadow-seal)]"
                  >
                    {{ badgeCount(item.badge) > 99 ? '99+' : badgeCount(item.badge) }}
                  </span>
                </button>
              </li>
            </ul>
          </section>
        </div>
      </aside>
    </transition>
  </Teleport>
</template>

<style scoped>
.xt-menu-drawer {
  background: linear-gradient(180deg, rgba(14, 19, 24, 0.96) 0%, rgba(8, 9, 11, 0.98) 100%);
  border-top: 1px solid var(--xt-border-gold);
  box-shadow:
    0 -22px 50px rgba(0, 0, 0, 0.7),
    inset 0 1px 0 rgba(242, 215, 137, 0.16);
}
@media (min-width: 768px) {
  .xt-menu-drawer {
    border: 1px solid var(--xt-border-gold);
  }
}

.xt-menu-drawer__header {
  background: linear-gradient(180deg, rgba(28, 22, 12, 0.92) 0%, rgba(14, 19, 24, 0.86) 100%);
  border-bottom: 1px solid var(--xt-border-gold);
}

.xt-menu-drawer__item {
  border: 1px solid transparent;
  background: rgba(20, 28, 38, 0.55);
}
.xt-menu-drawer__item:hover {
  border-color: var(--xt-border-jade);
  background: rgba(27, 59, 52, 0.6);
}

.xt-menu-drawer__icon {
  background: linear-gradient(180deg, rgba(27, 59, 52, 0.7) 0%, rgba(20, 28, 38, 0.85) 100%);
  color: var(--xt-jade-bright);
  border: 1px solid var(--xt-border-jade);
  box-shadow: inset 0 0 6px rgba(95, 227, 198, 0.18);
}

.xt-fade-enter-active,
.xt-fade-leave-active {
  transition: opacity var(--xt-motion-base) ease;
}
.xt-fade-enter-from,
.xt-fade-leave-to {
  opacity: 0;
}

.xt-sheet-enter-active,
.xt-sheet-leave-active {
  transition:
    transform var(--xt-motion-base) cubic-bezier(0.2, 0.7, 0.2, 1),
    opacity var(--xt-motion-base) ease;
}
.xt-sheet-enter-from,
.xt-sheet-leave-to {
  transform: translateY(20px);
  opacity: 0;
}
</style>
