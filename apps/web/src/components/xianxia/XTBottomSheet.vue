<script setup lang="ts">
/**
 * Cửu Thiên Mộng — `XTBottomSheet` (Phase 8 ornate bottom sheet).
 *
 * Luxury bottom sheet với ornate top handle (seal accent), accessible
 * close button, overlay đậm sương khói, tone tint, hỗ trợ sect-color
 * accent. Dùng mobile-first cho filter/sort, detail card, action sheet.
 *
 * - `v-model:open` controlled.
 * - Teleport ra `<body>` để thoát parent overflow/clip.
 * - Backdrop click + Escape close (trừ khi `persistent`).
 * - Focus trap nhẹ: focus root khi mở, restore focus trước đó khi đóng.
 * - Body scroll lock khi mở.
 * - `height` prop: `auto`, `half` (52vh), `tall` (92vh), hoặc raw vh.
 * - Reduced-motion: animation rút thành fade ngắn.
 * - `tone` prop: jade | gold | seal | violet | cyan | sect.
 *
 * Sect theming: khi `tone="sect"`, viền và glow theo CSS var
 * `--xt-accent-sect`. Caller có thể set var inline trên parent (qua
 * sect-tint helper).
 */
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue';

type Height = 'auto' | 'half' | 'tall' | string;
type Tone = 'jade' | 'gold' | 'seal' | 'violet' | 'cyan' | 'sect';

const props = withDefaults(
  defineProps<{
    open: boolean;
    /** Sheet title rendered in header. Optional — slot `header` override. */
    title?: string;
    /** Optional sheet subtitle. */
    subtitle?: string;
    /** Sheet height. */
    height?: Height;
    /** Hide ornate top handle. */
    hideHandle?: boolean;
    /** Disable backdrop click + Escape dismiss. */
    persistent?: boolean;
    /** Hide close button (default visible). */
    hideClose?: boolean;
    /** Color tone. */
    tone?: Tone;
    /** Test id base. */
    testId?: string;
    /** Optional aria-label fallback when no `title`. */
    ariaLabel?: string;
    /** Optional aria-label for close button. */
    closeLabel?: string;
  }>(),
  {
    title: '',
    subtitle: '',
    height: 'auto',
    hideHandle: false,
    persistent: false,
    hideClose: false,
    tone: 'gold',
    testId: 'xt-bottom-sheet',
    ariaLabel: undefined,
    closeLabel: 'Đóng',
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

const toneClass = computed(() => `xt-bottom-sheet--${props.tone}`);

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
    <Transition name="xt-bsheet">
      <div
        v-if="open"
        class="xt-bottom-sheet__backdrop"
        :data-testid="testId"
        @click.self="onBackdrop"
      >
        <div
          ref="sheetRef"
          class="xt-bottom-sheet"
          :class="toneClass"
          role="dialog"
          aria-modal="true"
          :aria-label="title || ariaLabel"
          :data-testid="`${testId}-sheet`"
          :style="{ maxHeight: sheetMaxHeight }"
          tabindex="-1"
        >
          <div
            v-if="!hideHandle"
            class="xt-bottom-sheet__handle"
            :data-testid="`${testId}-handle`"
            aria-hidden="true"
          >
            <span class="xt-bottom-sheet__handle-bar" />
            <span class="xt-bottom-sheet__handle-seal">❖</span>
            <span class="xt-bottom-sheet__handle-bar" />
          </div>

          <header
            v-if="title || subtitle || $slots.header || !hideClose"
            class="xt-bottom-sheet__header"
            :class="{ 'xt-bottom-sheet__header--bare': !(title || subtitle || $slots.header) }"
          >
            <div class="xt-bottom-sheet__header-text">
              <slot name="header">
                <div v-if="title" class="xt-bottom-sheet__title">{{ title }}</div>
                <div v-if="subtitle" class="xt-bottom-sheet__subtitle">
                  {{ subtitle }}
                </div>
              </slot>
            </div>
            <button
              v-if="!hideClose"
              type="button"
              class="xt-bottom-sheet__close"
              :aria-label="closeLabel"
              :data-testid="`${testId}-close`"
              @click="dismiss"
            >
              ×
            </button>
          </header>

          <div class="xt-bottom-sheet__body">
            <slot />
          </div>

          <footer
            v-if="$slots.footer"
            class="xt-bottom-sheet__footer"
          >
            <slot name="footer" />
          </footer>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.xt-bottom-sheet__backdrop {
  position: fixed;
  inset: 0;
  z-index: var(--xt-z-modal, 1000);
  display: flex;
  align-items: flex-end;
  justify-content: center;
  background: rgba(8, 9, 11, 0.72);
  backdrop-filter: blur(3px);
  -webkit-backdrop-filter: blur(3px);
}

.xt-bottom-sheet {
  position: relative;
  display: flex;
  flex-direction: column;
  width: 100%;
  max-width: 720px;
  background:
    linear-gradient(180deg, rgba(20, 28, 38, 0.96), rgba(14, 19, 24, 0.98)),
    radial-gradient(circle at 50% 0%, rgba(238, 220, 160, 0.12), transparent 60%);
  border-top: 1px solid var(--xt-border-gold, rgba(238, 220, 160, 0.6));
  border-radius: var(--xt-radius-xl, 18px) var(--xt-radius-xl, 18px) 0 0;
  box-shadow:
    var(--xt-shadow-floating, 0 -12px 32px rgba(0, 0, 0, 0.5)),
    0 -1px 0 rgba(238, 220, 160, 0.18) inset;
  padding: 0 16px env(safe-area-inset-bottom, 16px);
  outline: none;
  overflow: hidden;
}

/* Tone variants */
.xt-bottom-sheet--gold {
  border-top-color: var(--xt-border-gold, rgba(238, 220, 160, 0.65));
}
.xt-bottom-sheet--jade {
  border-top-color: var(--xt-border-jade, rgba(74, 169, 143, 0.55));
  background:
    linear-gradient(180deg, rgba(15, 26, 28, 0.96), rgba(10, 18, 20, 0.98)),
    radial-gradient(circle at 50% 0%, rgba(74, 169, 143, 0.18), transparent 60%);
}
.xt-bottom-sheet--seal {
  border-top-color: rgba(184, 72, 74, 0.6);
  background:
    linear-gradient(180deg, rgba(28, 16, 18, 0.96), rgba(18, 10, 12, 0.98)),
    radial-gradient(circle at 50% 0%, rgba(184, 72, 74, 0.16), transparent 60%);
}
.xt-bottom-sheet--violet {
  border-top-color: rgba(168, 132, 222, 0.55);
}
.xt-bottom-sheet--cyan {
  border-top-color: rgba(98, 200, 220, 0.55);
}
.xt-bottom-sheet--sect {
  border-top-color: var(--xt-accent-sect, var(--xt-border-gold, rgba(238, 220, 160, 0.6)));
  box-shadow:
    var(--xt-shadow-floating, 0 -12px 32px rgba(0, 0, 0, 0.5)),
    0 -1px 0 var(--xt-accent-sect, rgba(238, 220, 160, 0.22)) inset,
    0 0 24px color-mix(in srgb, var(--xt-accent-sect, rgba(238, 220, 160, 1)) 22%, transparent);
}

.xt-bottom-sheet__handle {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  padding: 8px 0 6px 0;
  user-select: none;
}
.xt-bottom-sheet__handle-bar {
  display: inline-block;
  width: 36px;
  height: 2px;
  background: linear-gradient(
    90deg,
    transparent 0%,
    rgba(238, 220, 160, 0.55) 50%,
    transparent 100%
  );
  border-radius: 999px;
}
.xt-bottom-sheet__handle-seal {
  font-family: var(--xt-font-decorative, serif);
  font-size: 12px;
  line-height: 1;
  color: var(--xt-gold-bright, #f5e3a1);
  opacity: 0.9;
  text-shadow: 0 0 6px rgba(238, 220, 160, 0.45);
}

.xt-bottom-sheet--jade .xt-bottom-sheet__handle-bar {
  background: linear-gradient(
    90deg,
    transparent 0%,
    rgba(74, 169, 143, 0.6) 50%,
    transparent 100%
  );
}
.xt-bottom-sheet--jade .xt-bottom-sheet__handle-seal {
  color: rgba(160, 230, 200, 0.95);
  text-shadow: 0 0 6px rgba(74, 169, 143, 0.5);
}
.xt-bottom-sheet--seal .xt-bottom-sheet__handle-seal {
  color: rgba(255, 196, 196, 0.95);
  text-shadow: 0 0 6px rgba(184, 72, 74, 0.5);
}
.xt-bottom-sheet--sect .xt-bottom-sheet__handle-bar {
  background: linear-gradient(
    90deg,
    transparent 0%,
    var(--xt-accent-sect, rgba(238, 220, 160, 0.55)) 50%,
    transparent 100%
  );
}
.xt-bottom-sheet--sect .xt-bottom-sheet__handle-seal {
  color: var(--xt-accent-sect, var(--xt-gold-bright, #f5e3a1));
  text-shadow: 0 0 8px color-mix(in srgb, var(--xt-accent-sect, rgba(238, 220, 160, 1)) 60%, transparent);
}

.xt-bottom-sheet__header {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  padding: 6px 4px 12px 4px;
  border-bottom: 1px solid rgba(238, 220, 160, 0.1);
}
.xt-bottom-sheet__header-text {
  flex: 1 1 auto;
  min-width: 0;
}
.xt-bottom-sheet__title {
  font-family: var(--xt-font-display, serif);
  font-size: var(--xt-text-h2, 18px);
  line-height: var(--xt-text-h2-leading, 1.3);
  letter-spacing: 0.04em;
  color: var(--xt-text-primary, #f6efe2);
  font-weight: 600;
}
.xt-bottom-sheet__subtitle {
  font-size: var(--xt-text-small, 12px);
  color: var(--xt-text-muted, #b9b0a4);
  margin-top: 2px;
}
.xt-bottom-sheet__close {
  flex: 0 0 auto;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border-radius: 999px;
  border: 1px solid rgba(238, 220, 160, 0.3);
  background: rgba(20, 16, 10, 0.6);
  color: var(--xt-text-primary, #f6efe2);
  font-size: 20px;
  line-height: 1;
  cursor: pointer;
  transition:
    background var(--xt-motion-fast, 140ms) var(--xt-ease-out, ease),
    border-color var(--xt-motion-fast, 140ms) var(--xt-ease-out, ease),
    transform var(--xt-motion-fast, 140ms) var(--xt-ease-out, ease);
}
.xt-bottom-sheet__close:hover {
  background: rgba(30, 24, 16, 0.7);
  border-color: rgba(238, 220, 160, 0.55);
}
.xt-bottom-sheet__close:focus-visible {
  outline: 2px solid var(--xt-gold-bright, #f5e3a1);
  outline-offset: 2px;
}
.xt-bottom-sheet--sect .xt-bottom-sheet__close {
  border-color: var(--xt-accent-sect, rgba(238, 220, 160, 0.4));
}

.xt-bottom-sheet__body {
  flex: 1 1 auto;
  overflow-y: auto;
  padding: 12px 4px;
  color: var(--xt-text-primary, #f6efe2);
}
.xt-bottom-sheet__footer {
  padding: 8px 4px env(safe-area-inset-bottom, 4px) 4px;
  border-top: 1px solid rgba(238, 220, 160, 0.1);
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}

.xt-bsheet-enter-active,
.xt-bsheet-leave-active {
  transition: opacity var(--xt-motion-base, 220ms) ease;
}
.xt-bsheet-enter-active .xt-bottom-sheet,
.xt-bsheet-leave-active .xt-bottom-sheet {
  transition: transform var(--xt-motion-slow, 360ms) var(--xt-ease-soft, cubic-bezier(0.32, 0.72, 0.24, 1));
}
.xt-bsheet-enter-from {
  opacity: 0;
}
.xt-bsheet-enter-from .xt-bottom-sheet {
  transform: translateY(100%);
}
.xt-bsheet-leave-to {
  opacity: 0;
}
.xt-bsheet-leave-to .xt-bottom-sheet {
  transform: translateY(100%);
}

@media (prefers-reduced-motion: reduce) {
  .xt-bsheet-enter-active,
  .xt-bsheet-leave-active,
  .xt-bsheet-enter-active .xt-bottom-sheet,
  .xt-bsheet-leave-active .xt-bottom-sheet {
    transition: opacity 120ms ease;
  }
  .xt-bsheet-enter-from .xt-bottom-sheet,
  .xt-bsheet-leave-to .xt-bottom-sheet {
    transform: none;
  }
}

html[data-motion='off'] .xt-bsheet-enter-active,
html[data-motion='off'] .xt-bsheet-leave-active,
html[data-motion='off'] .xt-bsheet-enter-active .xt-bottom-sheet,
html[data-motion='off'] .xt-bsheet-leave-active .xt-bottom-sheet {
  transition: opacity 100ms ease;
}
html[data-motion='off'] .xt-bsheet-enter-from .xt-bottom-sheet,
html[data-motion='off'] .xt-bsheet-leave-to .xt-bottom-sheet {
  transform: none;
}
</style>
