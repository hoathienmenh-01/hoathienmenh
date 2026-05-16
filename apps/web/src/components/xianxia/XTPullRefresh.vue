<script setup lang="ts">
/**
 * Cửu Thiên Mộng — `XTPullRefresh` (UI-3.1 mobile gesture primitive, Phase 10).
 *
 * Pull-to-refresh ornate wrapper:
 *   - Touch-based: chỉ trigger khi scrollTop = 0 và user kéo xuống.
 *   - Threshold mặc định 72px; tô đậm icon khi đạt threshold.
 *   - Refreshing state: hiển thị spinner ornate (seal halo xoay); khoá UI
 *     khỏi pull thêm cho tới khi caller resolve.
 *   - prefers-reduced-motion: spinner đứng yên, vẫn hiển thị label.
 *   - KHÔNG override native scroll behaviour ở mọi trục khác.
 *   - Desktop fallback: không gắn listener (`pointerType !== 'touch'`).
 *
 * Caller workflow:
 *   <XTPullRefresh :on-refresh="handler"> ... </XTPullRefresh>
 *   handler returns a Promise — sheet ở refreshing state suốt lifetime của
 *   promise; resolve hoặc reject đều reset state.
 */
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';

const props = withDefaults(
  defineProps<{
    /** Handler async; component sẽ ở refreshing state cho đến khi resolve/reject. */
    onRefresh: () => Promise<unknown> | unknown;
    /** Khoảng cách kéo (px) đủ để trigger refresh. */
    threshold?: number;
    /** Khoảng cách kéo tối đa (px) trước khi clamp. */
    maxPull?: number;
    /** Label hiển thị khi đang kéo (chưa đạt threshold). */
    pullLabel?: string;
    /** Label khi đã đạt threshold, sắp release. */
    releaseLabel?: string;
    /** Label khi đang refresh. */
    refreshingLabel?: string;
    /** Glyph trang trí cho seal halo. */
    glyph?: string;
    /** Vô hiệu hoá gesture (ví dụ khi mobile nav đang mở). */
    disabled?: boolean;
    testId?: string;
  }>(),
  {
    threshold: 72,
    maxPull: 140,
    pullLabel: 'Kéo để làm mới',
    releaseLabel: 'Thả để làm mới',
    refreshingLabel: 'Đang làm mới…',
    glyph: '❖',
    disabled: false,
    testId: 'xt-pull-refresh',
  },
);

const root = ref<HTMLElement | null>(null);
const pull = ref(0);
const refreshing = ref(false);
const startY = ref<number | null>(null);
const armed = ref(false);

const headerHeight = computed(() => Math.min(pull.value, props.maxPull));
const reachedThreshold = computed(() => pull.value >= props.threshold);

const headerLabel = computed(() => {
  if (refreshing.value) return props.refreshingLabel;
  return reachedThreshold.value ? props.releaseLabel : props.pullLabel;
});

function isAtTop(el: HTMLElement | null): boolean {
  if (!el) return false;
  // Use the closest scrollable ancestor (or document) as truth source.
  let scroller: HTMLElement | Window = el;
  while (scroller instanceof HTMLElement) {
    const overflowY = getComputedStyle(scroller).overflowY;
    if (overflowY === 'auto' || overflowY === 'scroll') {
      return scroller.scrollTop <= 0;
    }
    if (!scroller.parentElement) break;
    scroller = scroller.parentElement;
  }
  // Fallback: page scroll.
  return (window.scrollY || document.documentElement.scrollTop || 0) <= 0;
}

function onTouchStart(ev: TouchEvent): void {
  if (props.disabled || refreshing.value) return;
  if (!isAtTop(root.value)) return;
  startY.value = ev.touches[0]?.clientY ?? null;
  armed.value = startY.value !== null;
  pull.value = 0;
}

function onTouchMove(ev: TouchEvent): void {
  if (!armed.value || startY.value === null || refreshing.value) return;
  const dy = (ev.touches[0]?.clientY ?? 0) - startY.value;
  if (dy <= 0) {
    pull.value = 0;
    return;
  }
  // Apply rubber-banding for natural feel.
  pull.value = Math.min(dy * 0.55, props.maxPull);
}

async function trigger(): Promise<void> {
  if (refreshing.value) return;
  refreshing.value = true;
  pull.value = props.threshold;
  try {
    await props.onRefresh();
  } catch {
    // Caller handles its own error UX; we only reset state.
  } finally {
    refreshing.value = false;
    pull.value = 0;
    armed.value = false;
    startY.value = null;
  }
}

function onTouchEnd(): void {
  if (!armed.value || refreshing.value) {
    pull.value = 0;
    armed.value = false;
    startY.value = null;
    return;
  }
  if (reachedThreshold.value) {
    void trigger();
    return;
  }
  pull.value = 0;
  armed.value = false;
  startY.value = null;
}

onMounted(() => {
  const el = root.value;
  if (!el) return;
  el.addEventListener('touchstart', onTouchStart, { passive: true });
  el.addEventListener('touchmove', onTouchMove, { passive: true });
  el.addEventListener('touchend', onTouchEnd, { passive: true });
  el.addEventListener('touchcancel', onTouchEnd, { passive: true });
});

onBeforeUnmount(() => {
  const el = root.value;
  if (!el) return;
  el.removeEventListener('touchstart', onTouchStart);
  el.removeEventListener('touchmove', onTouchMove);
  el.removeEventListener('touchend', onTouchEnd);
  el.removeEventListener('touchcancel', onTouchEnd);
});

defineExpose({ trigger });
</script>

<template>
  <div
    ref="root"
    class="xt-pull-refresh"
    :class="{
      'xt-pull-refresh--armed': armed,
      'xt-pull-refresh--refreshing': refreshing,
      'xt-pull-refresh--ready': reachedThreshold,
    }"
    :data-testid="testId"
  >
    <div
      class="xt-pull-refresh__header"
      :style="{ height: `${headerHeight}px` }"
      aria-hidden="true"
    >
      <div
        v-if="pull > 0 || refreshing"
        class="xt-pull-refresh__seal"
        :data-testid="`${testId}-seal`"
      >
        <span class="xt-pull-refresh__glyph">{{ glyph }}</span>
        <span class="xt-pull-refresh__label">{{ headerLabel }}</span>
      </div>
    </div>
    <div class="xt-pull-refresh__body">
      <slot />
    </div>
  </div>
</template>

<style scoped>
.xt-pull-refresh {
  position: relative;
  width: 100%;
  /* Prevent the browser's native overscroll glow from competing with our handle. */
  overscroll-behavior-y: contain;
}

.xt-pull-refresh__header {
  position: relative;
  width: 100%;
  height: 0;
  overflow: hidden;
  transition: height 220ms var(--xt-ease-out, cubic-bezier(0.22, 1, 0.36, 1));
  pointer-events: none;
  display: flex;
  align-items: flex-end;
  justify-content: center;
}

.xt-pull-refresh--armed .xt-pull-refresh__header,
.xt-pull-refresh--refreshing .xt-pull-refresh__header {
  /* While the user is actively dragging or we're refreshing, follow their
     finger 1:1 (no easing); easing kicks in on release/reset. */
  transition: none;
}

.xt-pull-refresh__seal {
  display: inline-flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  padding-bottom: 8px;
  color: var(--xt-text-gold, #f5e3a1);
  text-shadow: 0 0 8px color-mix(in srgb, var(--xt-text-gold, #f5e3a1) 35%, transparent);
  font-family: var(--xt-font-decorative, var(--xt-font-display, serif));
  letter-spacing: 0.18em;
  text-transform: uppercase;
  font-size: 10px;
}

.xt-pull-refresh__glyph {
  display: inline-block;
  font-size: 18px;
  line-height: 1;
  transition: transform 180ms var(--xt-ease-out, cubic-bezier(0.22, 1, 0.36, 1));
}

.xt-pull-refresh--ready:not(.xt-pull-refresh--refreshing)
  .xt-pull-refresh__glyph {
  transform: rotate(180deg);
}

.xt-pull-refresh--refreshing .xt-pull-refresh__glyph {
  animation: xt-pull-spin 1.1s linear infinite;
}

.xt-pull-refresh__label {
  white-space: nowrap;
}

@keyframes xt-pull-spin {
  to {
    transform: rotate(360deg);
  }
}

@media (prefers-reduced-motion: reduce) {
  .xt-pull-refresh__header {
    transition: none;
  }
  .xt-pull-refresh__glyph {
    animation: none !important;
    transition: none;
  }
}

:global(html[data-motion='off']) .xt-pull-refresh__header,
:global(html[data-motion='off']) .xt-pull-refresh__glyph {
  transition: none !important;
  animation: none !important;
}
</style>
