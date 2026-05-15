<script setup lang="ts">
/**
 * UI-2.0 — Featured activities card.
 *
 * Hiển thị 2–4 hoạt động nổi bật (Boss thế giới, Bí cảnh, Đăng Tiên Tháp,
 * sự kiện mở) ở mobile dashboard. Mỗi item có:
 *   - icon (Skull/Mountain/Tower/CalendarDays)
 *   - status / cooldown
 *   - reward preview ngắn
 *   - nút Tham gia → router.push
 *
 * Empty state hiển thị khi mảng items rỗng — không phụ thuộc ảnh lớn.
 */
import { useI18n } from 'vue-i18n';
import XTIcon from './XTIcon.vue';

export interface XianxiaFeaturedItem {
  key: string;
  title: string;
  description?: string;
  icon: string;
  /** Nhãn trạng thái — “Đang mở”, “Sắp diễn ra”, ... */
  status?: string;
  /** Hồi chiêu hoặc lượt còn lại — “Còn 3 lượt”, ”Hồi 2h”, ... */
  cooldown?: string;
  /** Hiển thị tag thưởng ngắn — tối đa 3 chip. */
  rewards?: string[];
  /** Tone theo nhóm chức năng (boss/secret/tower/event). */
  tone?: 'jade' | 'combat' | 'secret' | 'gold' | 'event';
  /** Router path để bấm vào. */
  route?: string | null;
}

const props = defineProps<{
  items: XianxiaFeaturedItem[];
}>();
const emit = defineEmits<{ (e: 'navigate', route: string): void }>();

const { t } = useI18n();

function toneClass(tone?: XianxiaFeaturedItem['tone']): string {
  switch (tone) {
    case 'combat':
      return 'from-rose-50 via-white to-amber-50 border-rose-300/45';
    case 'secret':
      return 'from-violet-50 via-white to-emerald-50 border-violet-300/45';
    case 'gold':
      return 'from-amber-50 via-white to-emerald-50 border-amber-300/45';
    case 'event':
      return 'from-cyan-50 via-white to-emerald-50 border-cyan-300/45';
    default:
      return 'from-emerald-50 via-white to-amber-50 border-emerald-300/45';
  }
}

function toneIcon(tone?: XianxiaFeaturedItem['tone']): string {
  switch (tone) {
    case 'combat':
      return 'text-rose-700';
    case 'secret':
      return 'text-violet-700';
    case 'gold':
      return 'text-amber-700';
    case 'event':
      return 'text-sky-700';
    default:
      return 'text-[var(--xt-text-jade)]';
  }
}

function go(item: XianxiaFeaturedItem): void {
  if (item.route) emit('navigate', item.route);
}
</script>

<template>
  <section
    class="rounded-3xl border border-[var(--xt-border-jade)] bg-[var(--xt-bg-surface)] p-4 shadow-[0_18px_50px_rgba(74,169,143,0.1)]"
    data-testid="dashboard-featured"
  >
    <header class="mb-3 flex items-center justify-between">
      <h2 class="text-base font-semibold tracking-wide text-[var(--xt-text-primary)] md:text-lg">
        {{ t('xt.dashboard.featured.title') }}
      </h2>
    </header>

    <div
      v-if="props.items.length === 0"
      class="rounded-2xl border border-emerald-200/40 bg-[var(--xt-jade-soft)]/40 p-5 text-sm text-[var(--xt-text-primary)]/75"
      data-testid="dashboard-featured-empty"
    >
      {{ t('xt.dashboard.featured.empty') }}
    </div>

    <ul v-else class="grid gap-3 sm:grid-cols-2">
      <li
        v-for="item in props.items"
        :key="item.key"
        class="group relative overflow-hidden rounded-2xl border bg-gradient-to-br p-3 transition hover:-translate-y-0.5"
        :class="toneClass(item.tone)"
        :data-testid="`featured-${item.key}`"
      >
        <div class="flex items-start gap-3">
          <span
            class="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-[var(--xt-bg-surface)] ring-1 ring-emerald-300/40"
            :class="toneIcon(item.tone)"
          >
            <XTIcon :name="item.icon" size="lg" />
          </span>
          <div class="min-w-0 flex-1">
            <h3 class="truncate text-sm font-semibold text-[var(--xt-text-primary)] md:text-base">
              {{ item.title }}
            </h3>
            <p v-if="item.description" class="mt-0.5 line-clamp-2 text-xs text-[var(--xt-text-muted)]">
              {{ item.description }}
            </p>
            <div class="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] text-[var(--xt-text-muted)]">
              <span
                v-if="item.status"
                class="inline-flex items-center rounded-full bg-white/75 px-2 py-0.5 font-semibold text-[var(--xt-text-primary)] ring-1 ring-emerald-300/35"
              >
                {{ item.status }}
              </span>
              <span
                v-if="item.cooldown"
                class="inline-flex items-center rounded-full bg-[var(--xt-gold-soft)] px-2 py-0.5 font-semibold text-[var(--xt-text-gold)] ring-1 ring-[var(--xt-border-gold)]"
              >
                {{ t('xt.dashboard.featured.cooldownActive') }} · {{ item.cooldown }}
              </span>
            </div>
            <div
              v-if="item.rewards && item.rewards.length > 0"
              class="mt-1.5 flex flex-wrap gap-1 text-[10px]"
            >
              <span
                v-for="r in item.rewards.slice(0, 3)"
                :key="r"
                class="inline-flex items-center rounded-full bg-[var(--xt-bg-surface)] px-2 py-0.5 text-[var(--xt-text-primary)]/80 ring-1 ring-emerald-200/40"
              >
                {{ r }}
              </span>
            </div>
          </div>
        </div>
        <button
          type="button"
          class="mt-3 inline-flex w-full items-center justify-center rounded-2xl border border-emerald-300/40 bg-white/75 px-3 py-2 text-xs font-semibold text-[var(--xt-text-primary)] transition hover:bg-[var(--xt-jade-soft)]"
          :data-testid="`featured-${item.key}-go`"
          :disabled="!item.route"
          @click="go(item)"
        >
          {{ t('xt.dashboard.featured.join') }}
          <XTIcon name="chevronRight" size="xs" class="ml-1" />
        </button>
      </li>
    </ul>
  </section>
</template>
