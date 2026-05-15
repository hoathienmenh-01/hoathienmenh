<script setup lang="ts">
/**
 * UI-2.0 — Mobile bottom navigation (5 items).
 *
 * Spec (PHẦN 1 — MOBILE-FIRST LAYOUT):
 *   - 5 mục: Trang Chủ / Tu Luyện / Túi Đồ / Hoạt Động / Menu.
 *   - Icon + label, active state rõ, vùng bấm ≥ 40px, fixed bottom.
 *   - Bấm “Menu” mở drawer/bottom sheet (component cha quản lý).
 *
 * Khi route hiện tại match `to` của 1 item → active.
 */
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRouter, useRoute } from 'vue-router';
import { XT_BOTTOM_NAV } from '@/lib/xtNav';
import XTIcon from '@/components/xianxia/XTIcon.vue';

const props = defineProps<{
  drawerOpen?: boolean;
}>();
const emit = defineEmits<{ (e: 'open-menu'): void }>();

const { t, te } = useI18n();
const router = useRouter();
const route = useRoute();

function tSafe(key: string): string {
  return te(key) ? t(key) : key;
}

const items = computed(() =>
  XT_BOTTOM_NAV.map((item) => ({
    ...item,
    label: tSafe(`shell.nav.${item.key}`),
    active:
      item.action === 'menu'
        ? Boolean(props.drawerOpen)
        : item.to
          ? route.path === item.to || route.path.startsWith(item.to + '/')
          : false,
  })),
);

function handleClick(idx: number): void {
  const item = items.value[idx];
  if (!item) return;
  if (item.action === 'menu') {
    emit('open-menu');
    return;
  }
  if (item.to) {
    void router.push(item.to);
  }
}
</script>

<template>
  <nav
    class="xt-bottomnav fixed bottom-0 left-0 right-0 z-[var(--xt-z-bottom-nav)] border-t border-emerald-300/35 bg-white/85 backdrop-blur-xl"
    style="padding-bottom: env(safe-area-inset-bottom, 0px)"
    aria-label="XT mobile navigation"
    data-testid="xt-bottom-nav"
  >
    <ul class="grid grid-cols-5">
      <li v-for="(item, idx) in items" :key="item.key">
        <button
          type="button"
          class="group flex h-[66px] w-full flex-col items-center justify-center gap-1 px-1 text-[11px] font-medium tracking-wide transition"
          :class="
            item.active
              ? 'text-emerald-700'
              : 'text-emerald-900/60 hover:text-emerald-800'
          "
          :data-testid="item.testId ?? `xt-bottomnav-${item.key}`"
          :data-active="item.active ? 'true' : 'false'"
          :aria-current="item.active ? 'page' : undefined"
          @click="handleClick(idx)"
        >
          <span
            class="relative flex h-9 w-9 items-center justify-center rounded-2xl transition"
            :class="
              item.active
                ? 'bg-emerald-100/80 ring-1 ring-emerald-300/60 shadow-[0_8px_22px_rgba(74,169,143,0.22)]'
                : 'bg-transparent'
            "
          >
            <XTIcon :name="item.icon" size="md" />
            <span
              v-if="item.active"
              class="pointer-events-none absolute -top-1 h-1.5 w-1.5 rounded-full bg-amber-400"
            />
          </span>
          <span class="truncate">{{ item.label }}</span>
        </button>
      </li>
    </ul>
  </nav>
</template>

<style scoped>
.xt-bottomnav {
  box-shadow: 0 -10px 32px rgba(60, 100, 88, 0.14);
}
</style>
