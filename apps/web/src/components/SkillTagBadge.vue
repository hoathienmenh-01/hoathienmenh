<script setup lang="ts">
/**
 * Phase 14.2.C — SkillTagBadge
 *
 * Render skill identity tag (HEAL/DOT/BURST/SHIELD/CRIT/CONTROL) dạng badge
 * nhỏ kèm icon ký hiệu Wuxia. Tooltip trên hover (`title=...`) giải thích
 * gameplay effect ngắn gọn.
 *
 * Props:
 *   - `tag`: `SkillTag` — bắt buộc.
 *   - `size`: `'sm' | 'md'` — layout density. Default `sm`.
 *
 * i18n keys:
 *   - `skillTagBadge.tag.<KEY>` — text label (vd "Hồi", "Độc", "Bùng").
 *   - `skillTagBadge.tooltip.<KEY>` — tooltip mô tả gameplay effect.
 *
 * Color convention (Wuxia palette):
 *   - HEAL    → emerald (Mộc/Thuỷ tướng).
 *   - DOT     → lime (độc tố / hoả thiêu).
 *   - BURST   → rose (Hoả bộc phát).
 *   - SHIELD  → amber (Thổ phòng ngự).
 *   - CRIT    → fuchsia (Kim chí mạng — sắc kim phong nhận).
 *   - CONTROL → sky (Thuỷ phong toả).
 */
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import type { SkillTag } from '@xuantoi/shared';

const props = withDefaults(
  defineProps<{
    tag: SkillTag;
    size?: 'sm' | 'md';
  }>(),
  {
    size: 'sm',
  },
);

const { t } = useI18n();

const label = computed(() => t(`skillTagBadge.tag.${props.tag}`));
const tooltip = computed(() => t(`skillTagBadge.tooltip.${props.tag}`));

const colorClass = computed(() => {
  switch (props.tag) {
    case 'HEAL':
      return 'bg-emerald-700/30 text-emerald-200 border-emerald-500/40';
    case 'DOT':
      return 'bg-lime-700/30 text-lime-200 border-lime-500/40';
    case 'BURST':
      return 'bg-rose-700/30 text-rose-200 border-rose-500/40';
    case 'SHIELD':
      return 'bg-amber-700/30 text-amber-200 border-amber-500/40';
    case 'CRIT':
      return 'bg-fuchsia-700/30 text-fuchsia-200 border-fuchsia-500/40';
    case 'CONTROL':
      return 'bg-sky-700/30 text-sky-200 border-sky-500/40';
    default:
      return 'bg-ink-700/40 text-ink-300 border-ink-300/30';
  }
});

const sizeClass = computed(() => {
  return props.size === 'md'
    ? 'text-xs px-2 py-0.5'
    : 'text-[10px] px-1.5 py-0.5';
});

const testId = computed(() => `skill-tag-${props.tag.toLowerCase()}`);
</script>

<template>
  <span
    :class="['inline-block rounded border font-medium', sizeClass, colorClass]"
    :data-testid="testId"
    :data-tag="tag"
    :title="tooltip"
  >
    {{ label }}
  </span>
</template>
