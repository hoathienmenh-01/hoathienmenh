<script setup lang="ts">
/**
 * Cửu Thiên Mộng — Mobile bottom navigation (silk ribbon scroll).
 *
 * Spec:
 *   - 5 mục: Trang Chủ / Tu Luyện / Túi Đồ / Hoạt Động / Menu.
 *   - Background: dải lụa cuộn — dark ink với viền vàng triều và sóng ngang.
 *   - Active state: ngọc bài (jade tag) + dấu son (red dot) bên trên.
 *   - Vùng bấm ≥ 40px, fixed bottom, an toàn vùng safe-area.
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
    class="xt-bottomnav fixed bottom-0 left-0 right-0 z-[var(--xt-z-bottom-nav)]"
    style="padding-bottom: env(safe-area-inset-bottom, 0px)"
    aria-label="XT mobile navigation"
    data-testid="xt-bottom-nav"
  >
    <div class="xt-bottomnav__ribbon" aria-hidden="true" />
    <ul class="relative grid grid-cols-5">
      <li v-for="(item, idx) in items" :key="item.key">
        <button
          type="button"
          class="xt-bottomnav__btn group flex h-[66px] w-full flex-col items-center justify-center gap-1 px-1 text-[11px] font-medium tracking-wide transition"
          :class="item.active ? 'is-active' : ''"
          :data-testid="item.testId ?? `xt-bottomnav-${item.key}`"
          :data-active="item.active ? 'true' : 'false'"
          :aria-current="item.active ? 'page' : undefined"
          @click="handleClick(idx)"
        >
          <span class="xt-bottomnav__chip">
            <XTIcon :name="item.icon" size="md" />
            <span v-if="item.active" class="xt-bottomnav__dot" aria-hidden="true" />
          </span>
          <span class="xt-bottomnav__label truncate">{{ item.label }}</span>
        </button>
      </li>
    </ul>
  </nav>
</template>

<style scoped>
.xt-bottomnav {
  isolation: isolate;
  background: linear-gradient(180deg, rgba(14, 19, 24, 0.96) 0%, rgba(8, 9, 11, 0.98) 100%);
  border-top: 1px solid var(--xt-border-gold);
  box-shadow: 0 -18px 38px rgba(0, 0, 0, 0.62);
}

.xt-bottomnav__ribbon {
  position: absolute;
  inset: 0 0 auto 0;
  height: 6px;
  background:
    linear-gradient(180deg, transparent 0%, rgba(208, 79, 79, 0.85) 35%, rgba(136, 42, 42, 0.95) 100%),
    linear-gradient(180deg, transparent 0%, rgba(242, 215, 137, 0.45) 65%, rgba(242, 215, 137, 0.25) 100%);
  background-blend-mode: overlay;
  border-bottom: 1px solid rgba(242, 215, 137, 0.45);
  box-shadow:
    inset 0 -1px 0 rgba(0, 0, 0, 0.35),
    0 0 18px rgba(208, 79, 79, 0.18);
}

.xt-bottomnav__btn {
  color: rgba(240, 230, 204, 0.7);
}

.xt-bottomnav__btn:hover {
  color: var(--xt-jade-bright);
}

.xt-bottomnav__btn.is-active {
  color: var(--xt-gold-bright);
}

.xt-bottomnav__chip {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 2.5rem;
  height: 2.5rem;
  border-radius: 14px;
  transition: all var(--xt-motion-base, 220ms) ease;
}

.xt-bottomnav__btn.is-active .xt-bottomnav__chip {
  background: linear-gradient(180deg, rgba(58, 46, 24, 0.88), rgba(28, 22, 12, 0.96));
  border: 1px solid rgba(242, 215, 137, 0.55);
  box-shadow:
    inset 0 1px 0 rgba(255, 246, 224, 0.18),
    0 6px 16px rgba(0, 0, 0, 0.5),
    var(--xt-shadow-gold-glow);
}

.xt-bottomnav__dot {
  position: absolute;
  top: -6px;
  left: 50%;
  transform: translateX(-50%);
  width: 8px;
  height: 8px;
  border-radius: 999px;
  background: linear-gradient(135deg, #f0d56a, #b23b3b);
  box-shadow:
    0 0 8px rgba(208, 79, 79, 0.85),
    inset 0 0 4px rgba(255, 246, 224, 0.5);
}

.xt-bottomnav__label {
  font-family: var(--xt-font-display);
  letter-spacing: 0.05em;
}

@media (prefers-reduced-motion: reduce) {
  .xt-bottomnav__chip {
    transition: none;
  }
}
</style>
