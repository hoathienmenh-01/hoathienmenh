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
        class="fixed inset-0 z-[var(--xt-z-drawer)] bg-emerald-950/35 backdrop-blur-sm"
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
        class="fixed left-0 right-0 bottom-0 z-[calc(var(--xt-z-drawer)+1)] max-h-[88vh] overflow-y-auto rounded-t-3xl border-t border-emerald-300/40 bg-gradient-to-b from-white via-emerald-50/60 to-amber-50/30 shadow-[0_-20px_60px_rgba(60,100,88,0.22)] md:left-auto md:bottom-auto md:top-16 md:right-6 md:h-auto md:w-[420px] md:max-h-[80vh] md:rounded-3xl md:border md:border-emerald-300/40"
        style="padding-bottom: calc(env(safe-area-inset-bottom, 0px) + 16px)"
        data-testid="xt-menu-drawer"
      >
        <div class="sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-emerald-300/30 bg-white/85 px-5 py-3 backdrop-blur">
          <div>
            <p class="text-[10px] font-semibold uppercase tracking-[0.3em] text-emerald-700/70">
              XT · Tu Tiên Lộ
            </p>
            <h2 class="text-base font-semibold text-emerald-950">
              {{ t('xt.menu.title') }}
            </h2>
          </div>
          <button
            type="button"
            class="inline-flex h-10 w-10 items-center justify-center rounded-full border border-emerald-300/40 bg-white/80 text-emerald-900 transition hover:bg-emerald-50"
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
            class="rounded-2xl border border-emerald-300/30 bg-white/65 p-3 shadow-[0_8px_24px_rgba(74,169,143,0.08)]"
            :data-testid="`xt-menu-group-${group.key}`"
          >
            <h3 class="mb-2 px-1 text-xs font-semibold uppercase tracking-[0.28em] text-emerald-700/75">
              {{ group.label }}
            </h3>
            <ul class="grid grid-cols-2 gap-2 sm:grid-cols-3">
              <li v-for="item in group.items" :key="item.key">
                <button
                  type="button"
                  class="group flex w-full items-center gap-2 rounded-xl border border-transparent bg-white/65 px-2.5 py-2 text-left text-sm text-emerald-950 transition hover:border-emerald-300/40 hover:bg-emerald-50"
                  :data-testid="`xt-menu-item-${item.key}`"
                  @click="navigate(item.to)"
                >
                  <span
                    class="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-emerald-50/80 text-emerald-700 ring-1 ring-emerald-300/40"
                  >
                    <XTIcon :name="item.icon" size="md" />
                  </span>
                  <span class="min-w-0 flex-1">
                    <span class="block truncate font-medium leading-tight">{{
                      item.label
                    }}</span>
                  </span>
                  <span
                    v-if="badgeCount(item.badge) > 0"
                    class="rounded-full bg-rose-500 px-1.5 py-0.5 text-[10px] font-semibold text-white"
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
