<script setup lang="ts">
/**
 * Phase 14.2.A — ElementBadge
 *
 * Hiển thị Ngũ Hành affinity dạng badge nhỏ. Accept `ElementKey` (Vietnamese
 * `kim/moc/thuy/hoa/tho`) hoặc `ElementType` (English `WOOD/FIRE/EARTH/METAL/
 * WATER`) — auto-convert qua `parseElementType`. Render `null` khi không có
 * data (vô hệ skill / monster legacy) trừ khi `showNeutral` = true.
 *
 * Props:
 *   - `element`: `ElementKey | ElementType | string | null | undefined` —
 *     identifier element. `null/undefined/''` = vô hệ.
 *   - `showNeutral`: bool, default `false`. Khi true + element null → render
 *     "Vô hệ" badge. Khi false (default) → không render gì cả (clean UI).
 *   - `size`: `'sm' | 'md'`, default `'sm'`. Layout density (badge tier ở
 *     skill card vs panel summary).
 *
 * Color convention (Wuxia):
 *   - Kim (METAL)  → ink-200 (xám bạc)
 *   - Mộc (WOOD)   → emerald-300
 *   - Thuỷ (WATER) → sky-300
 *   - Hoả (FIRE)   → rose-300
 *   - Thổ (EARTH)  → amber-300
 *
 * Lookups i18n key: `elementBadge.element.<key>` để tách khỏi
 * `skillBook.element.*` / `inventory.element.*` (3+ namespace duplicate).
 */
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import {
  ELEMENTS,
  parseElementType,
  elementTypeToKey,
  type ElementKey,
  type ElementType,
} from '@xuantoi/shared';

const props = withDefaults(
  defineProps<{
    element?: ElementKey | ElementType | string | null;
    showNeutral?: boolean;
    size?: 'sm' | 'md';
  }>(),
  {
    element: null,
    showNeutral: false,
    size: 'sm',
  },
);

const { t } = useI18n();

/**
 * Resolve raw `element` prop về internal `ElementKey | null`.
 *
 * Permissive input:
 *   - Vietnamese `'kim'` → 'kim'
 *   - English `'METAL'` / `'metal'` → 'kim'
 *   - Garbage / null / undefined → null
 */
const resolved = computed<ElementKey | null>(() => {
  if (!props.element) return null;
  // Direct ElementKey match (lowercase Vietnamese).
  const lower = String(props.element).toLowerCase();
  if ((ELEMENTS as readonly string[]).includes(lower)) {
    return lower as ElementKey;
  }
  // ElementType / case-insensitive parser.
  const t = parseElementType(String(props.element));
  return t ? elementTypeToKey(t) : null;
});

const visible = computed(() => resolved.value !== null || props.showNeutral);

const label = computed(() => {
  if (resolved.value === null) return t('elementBadge.neutral');
  return t(`elementBadge.element.${resolved.value}`);
});

const colorClass = computed(() => {
  switch (resolved.value) {
    case 'kim':
      return 'bg-ink-700/40 text-ink-200 border-ink-300/40';
    case 'moc':
      return 'bg-emerald-700/30 text-emerald-200 border-emerald-500/40';
    case 'thuy':
      return 'bg-sky-700/30 text-sky-200 border-sky-500/40';
    case 'hoa':
      return 'bg-rose-700/30 text-rose-200 border-rose-500/40';
    case 'tho':
      return 'bg-amber-700/30 text-amber-200 border-amber-500/40';
    default:
      // Neutral / unknown.
      return 'bg-ink-700/40 text-ink-300 border-ink-300/30';
  }
});

const sizeClass = computed(() => {
  return props.size === 'md'
    ? 'text-xs px-2 py-0.5'
    : 'text-[10px] px-1.5 py-0.5';
});

const testId = computed(() => `element-badge-${resolved.value ?? 'neutral'}`);
</script>

<template>
  <span
    v-if="visible"
    :class="['inline-block rounded border', sizeClass, colorClass]"
    :data-testid="testId"
    :data-element="resolved ?? 'neutral'"
  >
    {{ label }}
  </span>
</template>
