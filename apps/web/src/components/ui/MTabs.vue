<script setup lang="ts">
/**
 * Cửu Thiên Mộng — `MTabs` (Phase 5 navigation primitive).
 *
 * Tab bar dùng để chia 1 view thành nhiều section thay vì 1 cuộn dọc dài
 * (Inventory, Sect, Market, Activity, Settings, Cultivation, …).
 *
 * Tính năng:
 *   - `v-model:value` kiểm soát active tab; `default-value` fallback uncontrolled.
 *   - Keyboard: ArrowLeft/Right (RTL-aware), Home, End, Enter/Space.
 *   - Tone:
 *     - `silk`: dải lụa cuộn vàng (mặc định Bento + Cinematic) — chip lớn.
 *     - `minimal`: row underline mảnh (Admin / Settings).
 *     - `pill`: chip bo tròn, dùng cho filter chip row.
 *   - Sticky mode: prop `sticky` (mặc định false) thêm `position: sticky; top: 0`
 *     để tab bar luôn nhìn thấy khi scroll trong page bento dài.
 *   - Reduced motion: disable underline animation.
 *
 * Component KHÔNG render nội dung tab — chỉ là controller. View tự render
 * panel theo `value` (xài `<TabsPanel>` hoặc `v-show`).
 *
 * Bundle 3 sẽ wire thêm gesture (swipe-to-change-tab) — Bundle 1 chỉ ship
 * primitive baseline + a11y.
 */
import { computed, nextTick, ref, watch } from 'vue';

export type MTabsItem = {
  /** Unique value used in `v-model`. */
  value: string;
  /** Display label. */
  label: string;
  /** Optional secondary badge text (e.g. `99+` mail count). */
  badge?: string | number | null;
  /** Optional icon name (XTIcon name). */
  icon?: string | null;
  /** Disabled tab (skipped in keyboard nav). */
  disabled?: boolean;
  /** Optional test id suffix; resolved to `${testId}-tab-${value}`. */
  testId?: string;
};

type Tone = 'silk' | 'minimal' | 'pill';

const props = withDefaults(
  defineProps<{
    items: MTabsItem[];
    value?: string | null;
    defaultValue?: string | null;
    tone?: Tone;
    sticky?: boolean;
    ariaLabel?: string;
    testId?: string;
  }>(),
  {
    value: null,
    defaultValue: null,
    tone: 'silk',
    sticky: false,
    ariaLabel: undefined,
    testId: 'm-tabs',
  },
);

const emit = defineEmits<{
  (e: 'update:value', value: string): void;
  (e: 'change', value: string): void;
}>();

const internalValue = ref<string | null>(
  props.value ?? props.defaultValue ?? props.items[0]?.value ?? null,
);

watch(
  () => props.value,
  (val) => {
    if (val != null) internalValue.value = val;
  },
);

const activeValue = computed<string | null>(() =>
  props.value != null ? props.value : internalValue.value,
);

const tabRefs = ref<Record<string, HTMLButtonElement | null>>({});

function setTabRef(value: string, el: HTMLButtonElement | null): void {
  tabRefs.value[value] = el;
}

function selectTab(value: string, focus = false): void {
  const item = props.items.find((t) => t.value === value);
  if (!item || item.disabled) return;
  if (props.value == null) {
    internalValue.value = value;
  }
  emit('update:value', value);
  emit('change', value);
  if (focus) {
    void nextTick(() => {
      tabRefs.value[value]?.focus();
    });
  }
}

function nextEnabledIndex(start: number, direction: 1 | -1): number {
  const list = props.items;
  let idx = start;
  for (let step = 0; step < list.length; step += 1) {
    idx = (idx + direction + list.length) % list.length;
    if (!list[idx]?.disabled) return idx;
  }
  return start;
}

function onKey(ev: KeyboardEvent, idx: number): void {
  const isHorizontal = true;
  switch (ev.key) {
    case 'ArrowRight': {
      if (!isHorizontal) return;
      ev.preventDefault();
      const next = props.items[nextEnabledIndex(idx, 1)];
      if (next) selectTab(next.value, true);
      break;
    }
    case 'ArrowLeft': {
      if (!isHorizontal) return;
      ev.preventDefault();
      const prev = props.items[nextEnabledIndex(idx, -1)];
      if (prev) selectTab(prev.value, true);
      break;
    }
    case 'Home': {
      ev.preventDefault();
      const first = props.items.find((t) => !t.disabled);
      if (first) selectTab(first.value, true);
      break;
    }
    case 'End': {
      ev.preventDefault();
      const last = [...props.items].reverse().find((t) => !t.disabled);
      if (last) selectTab(last.value, true);
      break;
    }
    default:
      break;
  }
}
</script>

<template>
  <div
    :class="[
      'm-tabs',
      `m-tabs--${tone}`,
      sticky ? 'm-tabs--sticky' : '',
    ]"
    :data-testid="testId"
  >
    <div
      role="tablist"
      :aria-label="ariaLabel"
      class="m-tabs__list"
    >
      <button
        v-for="(item, idx) in items"
        :id="`${testId}-tab-${item.value}`"
        :key="item.value"
        :ref="(el) => setTabRef(item.value, el as HTMLButtonElement | null)"
        type="button"
        role="tab"
        :aria-controls="`${testId}-panel-${item.value}`"
        :aria-selected="activeValue === item.value ? 'true' : 'false'"
        :tabindex="activeValue === item.value ? 0 : -1"
        :disabled="item.disabled"
        :data-active="activeValue === item.value ? 'true' : 'false'"
        :data-testid="item.testId ?? `${testId}-tab-${item.value}`"
        class="m-tabs__tab"
        @click="selectTab(item.value)"
        @keydown="onKey($event, idx)"
      >
        <span class="m-tabs__label">{{ item.label }}</span>
        <span
          v-if="item.badge != null && item.badge !== ''"
          class="m-tabs__badge"
          aria-hidden="true"
        >{{ item.badge }}</span>
      </button>
    </div>
  </div>
</template>

<style scoped>
.m-tabs {
  position: relative;
  width: 100%;
}
.m-tabs--sticky {
  position: sticky;
  top: 0;
  z-index: 5;
  background: linear-gradient(
    180deg,
    rgba(14, 19, 24, 0.95) 0%,
    rgba(14, 19, 24, 0.78) 100%
  );
  backdrop-filter: blur(6px);
  -webkit-backdrop-filter: blur(6px);
}

.m-tabs__list {
  display: flex;
  flex-wrap: nowrap;
  gap: 6px;
  overflow-x: auto;
  overflow-y: hidden;
  scrollbar-width: none;
  padding: 4px 4px 6px 4px;
  scroll-snap-type: x proximity;
}
.m-tabs__list::-webkit-scrollbar {
  display: none;
}

.m-tabs__tab {
  position: relative;
  flex: 0 0 auto;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  white-space: nowrap;
  padding: 8px 14px;
  border-radius: var(--xt-radius-md);
  border: 1px solid transparent;
  color: var(--xt-text-muted);
  background: transparent;
  font-family: var(--xt-font-display);
  font-size: 13px;
  letter-spacing: 0.04em;
  cursor: pointer;
  scroll-snap-align: start;
  transition:
    color var(--xt-motion-base, 220ms) ease,
    background var(--xt-motion-base, 220ms) ease,
    border-color var(--xt-motion-base, 220ms) ease,
    box-shadow var(--xt-motion-base, 220ms) ease;
}
.m-tabs__tab:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
.m-tabs__tab:hover:not(:disabled) {
  color: var(--xt-text-primary);
}
.m-tabs__tab:focus-visible {
  outline: 2px solid var(--xt-jade-bright);
  outline-offset: 2px;
}

.m-tabs__badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 18px;
  height: 18px;
  padding: 0 5px;
  border-radius: 999px;
  font-family: var(--xt-font-body);
  font-size: 11px;
  font-weight: 600;
  background: var(--xt-seal-bright);
  color: var(--xt-scroll-paper-bright);
  line-height: 1;
}

/* ---- Tone: silk (default — Bento + Cinematic) ---- */
.m-tabs--silk .m-tabs__list {
  border: 1px solid var(--xt-border-gold);
  border-radius: var(--xt-radius-lg);
  background: linear-gradient(180deg, rgba(28, 22, 12, 0.6), rgba(14, 19, 24, 0.78));
  padding: 4px;
  gap: 0;
}
.m-tabs--silk .m-tabs__tab {
  border-radius: calc(var(--xt-radius-lg) - 6px);
  padding: 8px 16px;
}
.m-tabs--silk .m-tabs__tab[data-active='true'] {
  color: var(--xt-gold-bright);
  background: linear-gradient(180deg, rgba(58, 46, 24, 0.88), rgba(28, 22, 12, 0.96));
  border-color: rgba(242, 215, 137, 0.55);
  box-shadow:
    inset 0 1px 0 rgba(255, 246, 224, 0.18),
    0 6px 16px rgba(0, 0, 0, 0.5),
    var(--xt-shadow-gold-glow);
}

/* ---- Tone: minimal (Admin) ---- */
.m-tabs--minimal .m-tabs__list {
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
  gap: 4px;
  padding: 0;
}
.m-tabs--minimal .m-tabs__tab {
  border-radius: 0;
  padding: 10px 14px;
  font-family: var(--xt-font-body);
  font-size: var(--xt-text-small);
  letter-spacing: 0;
  color: var(--xt-text-muted);
  position: relative;
}
.m-tabs--minimal .m-tabs__tab[data-active='true'] {
  color: var(--xt-text-primary);
}
.m-tabs--minimal .m-tabs__tab[data-active='true']::after {
  content: '';
  position: absolute;
  left: 12px;
  right: 12px;
  bottom: -1px;
  height: 2px;
  background: var(--xt-jade-bright);
  border-radius: 2px;
  transition: transform var(--xt-motion-base, 220ms) var(--xt-ease-soft, ease);
}

/* ---- Tone: pill (filter chip row) ---- */
.m-tabs--pill .m-tabs__tab {
  border: 1px solid var(--xt-border-jade);
  background: rgba(20, 28, 38, 0.55);
  border-radius: 999px;
  padding: 6px 14px;
  font-size: var(--xt-text-caption);
  letter-spacing: 0.04em;
}
.m-tabs--pill .m-tabs__tab[data-active='true'] {
  color: var(--xt-scroll-paper-bright);
  background: linear-gradient(135deg, var(--xt-jade-base), var(--xt-jade));
  border-color: var(--xt-jade-bright);
  box-shadow: var(--xt-shadow-jade-glow);
}

@media (prefers-reduced-motion: reduce) {
  .m-tabs__tab,
  .m-tabs--minimal .m-tabs__tab[data-active='true']::after {
    transition: none;
  }
}
</style>
