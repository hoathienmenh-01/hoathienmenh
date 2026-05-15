<script setup lang="ts">
/**
 * Cửu Thiên Mộng — `MBottomSheet` (Phase 5 mobile-first overlay).
 *
 * Bottom sheet panel slide-up dùng cho:
 *   - Modal mobile (thay `<dialog>` toàn màn hình cho touch UX).
 *   - Cinematic home: tap function → sheet slide up phủ ~92% (hướng C).
 *   - Detail drawer trong các view bento (xem chi tiết tile).
 *
 * Tính năng baseline (Bundle 1):
 *   - `v-model:open` controlled.
 *   - Teleport ra `<body>` (escape parent overflow/clip).
 *   - Backdrop click-to-dismiss + Escape key.
 *   - Focus trap đơn giản: focus root khi mở, restore focus trước đó khi đóng.
 *   - Body scroll lock khi mở.
 *   - `height` prop: `auto`, `half` (52%), `tall` (92%), hoặc raw `vh` string.
 *   - Reduced-motion: animation đổi sang fade ngắn.
 *
 * Drag-to-dismiss (Bundle 3) + spring physics + safe-area sẽ đến sau —
 * Bundle 1 chỉ ship primitive đủ dùng cho modal mobile cơ bản.
 */
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue';

type Height = 'auto' | 'half' | 'tall' | string;

const props = withDefaults(
  defineProps<{
    open: boolean;
    /** Sheet title rendered in header. Optional — slot `header` override. */
    title?: string;
    /** Optional sheet subtitle. */
    subtitle?: string;
    /** Sheet height. */
    height?: Height;
    /** Hide drag handle (decorative). */
    hideHandle?: boolean;
    /** Disable backdrop click-to-dismiss. */
    persistent?: boolean;
    /** Test id base; backdrop = testId, sheet = `${testId}-sheet`. */
    testId?: string;
    /** Optional aria-label fallback when no `title`. */
    ariaLabel?: string;
  }>(),
  {
    title: '',
    subtitle: '',
    height: 'auto',
    hideHandle: false,
    persistent: false,
    testId: 'm-bottom-sheet',
    ariaLabel: undefined,
  },
);

const emit = defineEmits<{
  (e: 'update:open', value: boolean): void;
  (e: 'close'): void;
}>();

const sheetRef = ref<HTMLDivElement | null>(null);
const restoreEl = ref<HTMLElement | null>(null);

const sheetMaxHeight = computed<string>(() => {
  if (props.height === 'auto') return 'auto';
  if (props.height === 'half') return '52vh';
  if (props.height === 'tall') return '92vh';
  return props.height;
});

function dismiss(): void {
  emit('update:open', false);
  emit('close');
}

function onBackdrop(): void {
  if (props.persistent) return;
  dismiss();
}

function onKeydown(ev: KeyboardEvent): void {
  if (!props.open) return;
  if (ev.key === 'Escape' && !props.persistent) {
    ev.preventDefault();
    dismiss();
  }
}

function lockScroll(lock: boolean): void {
  if (typeof document === 'undefined') return;
  document.body.style.overflow = lock ? 'hidden' : '';
}

watch(
  () => props.open,
  async (val) => {
    if (typeof window === 'undefined') return;
    if (val) {
      restoreEl.value = document.activeElement as HTMLElement | null;
      window.addEventListener('keydown', onKeydown);
      lockScroll(true);
      await nextTick();
      sheetRef.value?.focus();
    } else {
      window.removeEventListener('keydown', onKeydown);
      lockScroll(false);
      restoreEl.value?.focus?.();
      restoreEl.value = null;
    }
  },
  { immediate: true },
);

onBeforeUnmount(() => {
  if (typeof window !== 'undefined') {
    window.removeEventListener('keydown', onKeydown);
  }
  lockScroll(false);
});
</script>

<template>
  <Teleport to="body">
    <Transition name="m-sheet">
      <div
        v-if="open"
        class="m-sheet-backdrop"
        :data-testid="testId"
        @click.self="onBackdrop"
      >
        <div
          ref="sheetRef"
          class="m-sheet"
          role="dialog"
          aria-modal="true"
          :aria-label="title || ariaLabel"
          :data-testid="`${testId}-sheet`"
          :style="{ maxHeight: sheetMaxHeight }"
          tabindex="-1"
        >
          <div
            v-if="!hideHandle"
            class="m-sheet__handle"
            :data-testid="`${testId}-handle`"
            aria-hidden="true"
          />
          <header v-if="title || subtitle || $slots.header" class="m-sheet__header">
            <slot name="header">
              <div class="m-sheet__title">{{ title }}</div>
              <div v-if="subtitle" class="m-sheet__subtitle">{{ subtitle }}</div>
            </slot>
          </header>
          <div class="m-sheet__body">
            <slot />
          </div>
          <footer v-if="$slots.footer" class="m-sheet__footer">
            <slot name="footer" />
          </footer>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.m-sheet-backdrop {
  position: fixed;
  inset: 0;
  z-index: var(--xt-z-modal);
  display: flex;
  align-items: flex-end;
  justify-content: center;
  background: rgba(8, 9, 11, 0.65);
  backdrop-filter: blur(2px);
  -webkit-backdrop-filter: blur(2px);
}

.m-sheet {
  position: relative;
  display: flex;
  flex-direction: column;
  width: 100%;
  max-width: 720px;
  background:
    linear-gradient(180deg, rgba(20, 28, 38, 0.96), rgba(14, 19, 24, 0.98)),
    radial-gradient(circle at 50% 0%, rgba(95, 227, 198, 0.1), transparent 60%);
  border-top: 1px solid var(--xt-border-gold);
  border-radius: var(--xt-radius-xl) var(--xt-radius-xl) 0 0;
  box-shadow: var(--xt-shadow-floating);
  padding: 8px 16px env(safe-area-inset-bottom, 16px);
  outline: none;
  overflow: hidden;
}
.m-sheet__handle {
  align-self: center;
  width: 44px;
  height: 4px;
  margin: 6px 0 10px 0;
  border-radius: 999px;
  background: rgba(242, 215, 137, 0.35);
}
.m-sheet__header {
  padding: 0 4px 12px 4px;
  border-bottom: 1px solid rgba(242, 215, 137, 0.08);
}
.m-sheet__title {
  font-family: var(--xt-font-display);
  font-size: var(--xt-text-h2);
  line-height: var(--xt-text-h2-leading);
  letter-spacing: 0.04em;
  color: var(--xt-text-primary);
  font-weight: 600;
}
.m-sheet__subtitle {
  font-size: var(--xt-text-small);
  color: var(--xt-text-muted);
  margin-top: 2px;
}
.m-sheet__body {
  flex: 1 1 auto;
  overflow-y: auto;
  padding: 12px 4px;
  color: var(--xt-text-primary);
}
.m-sheet__footer {
  padding: 8px 4px 4px 4px;
  border-top: 1px solid rgba(242, 215, 137, 0.08);
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}

.m-sheet-enter-active,
.m-sheet-leave-active {
  transition: opacity var(--xt-motion-base, 220ms) ease;
}
.m-sheet-enter-active .m-sheet,
.m-sheet-leave-active .m-sheet {
  transition: transform var(--xt-motion-slow, 360ms) var(--xt-ease-soft, ease);
}
.m-sheet-enter-from {
  opacity: 0;
}
.m-sheet-enter-from .m-sheet {
  transform: translateY(100%);
}
.m-sheet-leave-to {
  opacity: 0;
}
.m-sheet-leave-to .m-sheet {
  transform: translateY(100%);
}

@media (prefers-reduced-motion: reduce) {
  .m-sheet-enter-active,
  .m-sheet-leave-active,
  .m-sheet-enter-active .m-sheet,
  .m-sheet-leave-active .m-sheet {
    transition: opacity 120ms ease;
  }
  .m-sheet-enter-from .m-sheet,
  .m-sheet-leave-to .m-sheet {
    transform: none;
  }
}
</style>
