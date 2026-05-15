<script setup lang="ts">
/**
 * Cửu Thiên Mộng — `MAccordion` (Phase 5 primitive).
 *
 * Disclosure widget gồm 1 header có thể click + 1 body collapsible. Dùng
 * thay vì block luôn-mở khi nội dung phụ (filter details, advanced stat,
 * FAQ, admin tool options) chiếm chỗ scroll không đáng.
 *
 * Tính năng:
 *   - `v-model:open` hoặc uncontrolled.
 *   - Title + summary slot, native `<details>`-style ARIA (button[aria-expanded]).
 *   - Animation max-height (CSS variable `--xt-accordion-max`). Tôn trọng
 *     reduce-motion bằng cách bỏ transition.
 *   - `variant`: jade (default), gold, paper (admin minimal).
 *   - Press feedback `:active` scale 0.99.
 */
import { computed, nextTick, ref, watch } from 'vue';

const props = withDefaults(
  defineProps<{
    /** Controlled open state. */
    open?: boolean | null;
    /** Default uncontrolled open. */
    defaultOpen?: boolean;
    /** Header title (also fallback when no `title` slot). */
    title?: string;
    /** Optional small caption right of title. */
    summary?: string;
    /** Visual variant. */
    variant?: 'jade' | 'gold' | 'paper';
    /** Disabled accordion (cannot toggle). */
    disabled?: boolean;
    /** Optional test id base; element gets `{testId}-trigger` + `{testId}-panel`. */
    testId?: string;
  }>(),
  {
    open: null,
    defaultOpen: false,
    title: '',
    summary: '',
    variant: 'jade',
    disabled: false,
    testId: 'm-accordion',
  },
);

const emit = defineEmits<{
  (e: 'update:open', value: boolean): void;
}>();

const internalOpen = ref<boolean>(
  props.open != null ? props.open : props.defaultOpen,
);

watch(
  () => props.open,
  (val) => {
    if (val != null) internalOpen.value = val;
  },
);

const isOpen = computed<boolean>(() =>
  props.open != null ? props.open : internalOpen.value,
);

const panelRef = ref<HTMLDivElement | null>(null);
const panelMax = ref<string>('0px');

async function syncPanelHeight(): Promise<void> {
  await nextTick();
  const el = panelRef.value;
  if (!el) return;
  panelMax.value = `${el.scrollHeight}px`;
}

watch(isOpen, async (val) => {
  if (val) {
    await syncPanelHeight();
  } else {
    panelMax.value = '0px';
  }
});

function toggle(): void {
  if (props.disabled) return;
  const next = !isOpen.value;
  if (props.open == null) internalOpen.value = next;
  emit('update:open', next);
}
</script>

<template>
  <div
    :class="['m-accordion', `m-accordion--${variant}`, isOpen ? 'is-open' : '']"
    :data-testid="testId"
    :data-open="isOpen ? 'true' : 'false'"
  >
    <button
      type="button"
      class="m-accordion__trigger"
      :aria-expanded="isOpen ? 'true' : 'false'"
      :aria-controls="`${testId}-panel`"
      :disabled="disabled"
      :data-testid="`${testId}-trigger`"
      @click="toggle"
    >
      <span class="m-accordion__title">
        <slot name="title">{{ title }}</slot>
      </span>
      <span v-if="summary || $slots.summary" class="m-accordion__summary">
        <slot name="summary">{{ summary }}</slot>
      </span>
      <span
        class="m-accordion__chevron"
        :data-open="isOpen ? 'true' : 'false'"
        aria-hidden="true"
      >▾</span>
    </button>
    <div
      :id="`${testId}-panel`"
      ref="panelRef"
      role="region"
      class="m-accordion__panel"
      :style="{ maxHeight: isOpen ? panelMax : '0px' }"
      :data-testid="`${testId}-panel`"
      :aria-hidden="isOpen ? 'false' : 'true'"
    >
      <div class="m-accordion__body">
        <slot />
      </div>
    </div>
  </div>
</template>

<style scoped>
.m-accordion {
  border: 1px solid var(--xt-border-jade);
  border-radius: var(--xt-radius-md);
  background: rgba(20, 28, 38, 0.55);
  overflow: hidden;
}
.m-accordion--gold {
  border-color: var(--xt-border-gold);
}
.m-accordion--paper {
  border-color: rgba(255, 255, 255, 0.06);
  background: rgba(255, 255, 255, 0.02);
}

.m-accordion__trigger {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 12px 14px;
  background: transparent;
  border: none;
  color: var(--xt-text-primary);
  font-family: var(--xt-font-display);
  font-weight: 600;
  font-size: 14px;
  letter-spacing: 0.04em;
  cursor: pointer;
  text-align: left;
  transition: background var(--xt-motion-base, 220ms) ease, transform 100ms ease;
}
.m-accordion__trigger:hover {
  background: rgba(95, 227, 198, 0.06);
}
.m-accordion__trigger:active {
  transform: scale(0.99);
}
.m-accordion__trigger:focus-visible {
  outline: 2px solid var(--xt-jade-bright);
  outline-offset: -2px;
}
.m-accordion__trigger:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.m-accordion__title {
  flex: 1 1 auto;
  min-width: 0;
}
.m-accordion__summary {
  flex: 0 0 auto;
  font-family: var(--xt-font-body);
  font-weight: 400;
  font-size: var(--xt-text-small);
  color: var(--xt-text-muted);
}
.m-accordion__chevron {
  flex: 0 0 auto;
  font-size: 14px;
  color: var(--xt-text-muted);
  transition: transform var(--xt-motion-base, 220ms) var(--xt-ease-soft, ease);
}
.m-accordion__chevron[data-open='true'] {
  transform: rotate(180deg);
  color: var(--xt-jade-bright);
}

.m-accordion__panel {
  overflow: hidden;
  max-height: 0;
  transition: max-height var(--xt-motion-slow, 360ms) var(--xt-ease-soft, ease);
}
.m-accordion__body {
  padding: 0 14px 14px 14px;
  border-top: 1px solid rgba(95, 227, 198, 0.08);
  margin-top: 0;
  font-size: var(--xt-text-body);
  color: var(--xt-text-muted);
}

@media (prefers-reduced-motion: reduce) {
  .m-accordion__panel,
  .m-accordion__chevron {
    transition: none;
  }
}
</style>
