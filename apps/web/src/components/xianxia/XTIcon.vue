<script setup lang="ts">
/**
 * UI-2.0 — XT icon system.
 *
 * Inline-SVG icon set in lucide-style (nét mảnh, 24×24 grid, stroke 1.6).
 * Cố tình KHÔNG thêm dependency lucide-vue-next để giữ bundle nhẹ và tránh
 * conflict với SSR/Vitest stubs đang test trong repo. Khi cần icon mới,
 * thêm path vào ICON_PATHS — không cần đổi component.
 *
 * Mapping được join với mapping cũ của GameIcon để các view cũ vẫn render
 * bằng XTIcon mà không phải đổi name (ví dụ icon `power` → swords path).
 */
import { computed } from 'vue';

const props = withDefaults(
  defineProps<{
    name: string;
    label?: string;
    size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl';
    tone?:
      | 'jade'
      | 'gold'
      | 'cyan'
      | 'violet'
      | 'danger'
      | 'muted'
      | 'inherit';
  }>(),
  {
    label: '',
    size: 'md',
    tone: 'inherit',
  },
);

/** All icons share the same 24×24 viewBox. Each entry is a partial SVG body
 *  (paths/lines/circles) — root <svg> is set in the template. */
const ICON_PATHS: Record<string, string> = {
  // Core navigation
  home:
    '<path d="M3 11.5 12 4l9 7.5"/><path d="M5 10v9a1 1 0 0 0 1 1h4v-6h4v6h4a1 1 0 0 0 1-1v-9"/>',
  dashboard:
    '<rect x="3" y="3" width="7" height="9" rx="1.5"/><rect x="14" y="3" width="7" height="5" rx="1.5"/><rect x="14" y="12" width="7" height="9" rx="1.5"/><rect x="3" y="16" width="7" height="5" rx="1.5"/>',
  menu:
    '<path d="M3 6h18"/><path d="M3 12h18"/><path d="M3 18h18"/>',
  back:
    '<path d="M19 12H5"/><path d="m12 19-7-7 7-7"/>',
  close: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
  search:
    '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
  more:
    '<circle cx="5" cy="12" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="19" cy="12" r="1.5"/>',
  chevronRight: '<path d="m9 6 6 6-6 6"/>',
  chevronDown: '<path d="m6 9 6 6 6-6"/>',
  refresh:
    '<path d="M21 12a9 9 0 1 1-3.5-7.1"/><path d="M21 4v5h-5"/>',

  // Character & cultivation
  character:
    '<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 4-6 8-6s8 2 8 6"/>',
  cultivation:
    '<path d="M12 3v3"/><path d="M12 18v3"/><path d="M5 12H2"/><path d="M22 12h-3"/><path d="m6.3 6.3 2.1 2.1"/><path d="m15.6 15.6 2.1 2.1"/><path d="m6.3 17.7 2.1-2.1"/><path d="m15.6 8.4 2.1-2.1"/><circle cx="12" cy="12" r="3"/>',
  breakthrough:
    '<path d="M12 3 5 12h4l-1 9 8-11h-4l3-7Z"/>',
  bodyCultivation:
    '<path d="M12 3 4 6v6c0 5 3.5 8 8 9 4.5-1 8-4 8-9V6Z"/>',
  method:
    '<path d="M4 4h12a3 3 0 0 1 3 3v13a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2Z"/><path d="M8 8h7"/><path d="M8 12h7"/><path d="M8 16h5"/>',
  cultivationMethod:
    '<path d="M4 4h12a3 3 0 0 1 3 3v13a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2Z"/><path d="M8 8h7"/><path d="M8 12h7"/><path d="M8 16h5"/>',
  spiritualRoot:
    '<path d="M12 22V8"/><path d="M12 8c-3-2-6-1-7 2 1 0 4 0 7-2Z"/><path d="M12 8c3-2 6-1 7 2-1 0-4 0-7-2Z"/><path d="M9 2c2 1 3 3 3 6"/>',
  skill:
    '<path d="M4 4h12l4 4v12a0 0 0 0 1 0 0H4Z"/><path d="M16 4v4h4"/><path d="M8 12h8"/><path d="M8 16h6"/>',
  skillBook:
    '<path d="M4 4h12l4 4v12H4Z"/><path d="M16 4v4h4"/><path d="M8 12h8"/><path d="M8 16h6"/>',
  alchemy:
    '<path d="M10 3h4"/><path d="M10 3v6L4 19a2 2 0 0 0 2 3h12a2 2 0 0 0 2-3l-6-10V3"/><path d="M8 14h8"/>',

  // Activities
  farm:
    '<path d="M3 7h18"/><path d="M3 12h18"/><path d="M3 17h18"/><path d="M7 3v18"/><path d="M17 3v18"/>',
  boss:
    '<path d="M12 2C7 2 4 6 4 10v4c0 2 2 3 4 3v3l4-2 4 2v-3c2 0 4-1 4-3v-4c0-4-3-8-8-8Z"/><circle cx="9" cy="11" r="1.2"/><circle cx="15" cy="11" r="1.2"/>',
  secretRealm:
    '<path d="m3 19 6-10 4 6 3-4 5 8H3Z"/><circle cx="17" cy="6" r="2"/>',
  roguelike:
    '<rect x="4" y="4" width="16" height="16" rx="3"/><circle cx="9" cy="9" r="1.3"/><circle cx="15" cy="9" r="1.3"/><circle cx="9" cy="15" r="1.3"/><circle cx="15" cy="15" r="1.3"/><circle cx="12" cy="12" r="1.3"/>',
  tower:
    '<path d="M9 2v3l-3 4v12h12V9l-3-4V2Z"/><path d="M9 5h6"/><path d="M9 13h6"/><path d="M9 17h6"/>',
  activity:
    '<path d="m3 12 4 4 4-9 4 14 4-9h2"/>',

  // Inventory
  inventory:
    '<path d="M5 8 7 4h10l2 4"/><path d="M5 8h14v12H5Z"/><path d="M9 12h6"/>',
  equipment:
    '<path d="m14 4 6 6-9 9-3 1 1-3 9-9-4-4Z"/><path d="m6 17-3 3"/>',
  artifact:
    '<path d="m12 3 8 7-8 11-8-11Z"/><path d="m4 10 16 0"/>',
  pet:
    '<path d="M4 13c0 4 3 7 8 7s8-3 8-7c0-2-2-4-3-4-2 0-2 2-5 2s-3-2-5-2c-1 0-3 2-3 4Z"/><circle cx="7" cy="6.5" r="1.6"/><circle cx="11" cy="4.5" r="1.6"/><circle cx="13" cy="4.5" r="1.6"/><circle cx="17" cy="6.5" r="1.6"/>',

  // Social
  sect:
    '<path d="M4 21V9l8-6 8 6v12"/><path d="M9 21v-7h6v7"/>',
  social:
    '<circle cx="9" cy="9" r="3"/><circle cx="17" cy="11" r="2.5"/><path d="M3 20c0-3 3-5 6-5s6 2 6 5"/><path d="M14.5 20c.3-2 2-3.5 4-3.5"/>',
  mail:
    '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/>',
  notification:
    '<path d="M6 8a6 6 0 0 1 12 0c0 6 2 7 2 7H4s2-1 2-7Z"/><path d="M10 19a2 2 0 0 0 4 0"/>',

  // Market
  market:
    '<path d="M3 9h18l-2 11H5Z"/><path d="M8 9V6a4 4 0 0 1 8 0v3"/>',
  auction:
    '<path d="m12 3 7 7-3 3-7-7Z"/><path d="m9 6 9 9"/><path d="M3 21h12"/>',
  jade:
    '<path d="m12 3 8 6-3 11H7L4 9Z"/><path d="M8 9h8"/>',
  stone: '<path d="m12 3 8 6-3 11H7L4 9Z"/>',
  topup:
    '<rect x="3" y="6" width="18" height="12" rx="2"/><path d="M3 10h18"/><path d="M7 15h4"/>',

  // Long-term
  event:
    '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 9h18"/><path d="M8 3v4"/><path d="M16 3v4"/>',
  achievement:
    '<path d="M8 4h8v3a4 4 0 0 1-8 0Z"/><path d="M4 5h4v2a3 3 0 0 1-3 3Z"/><path d="M20 5h-4v2a3 3 0 0 0 3 3Z"/><path d="M9 13h6v3l1 4H8l1-4Z"/>',
  title:
    '<path d="m12 3 2.5 5 5.5.5-4 4 1 5.5L12 15l-5 3 1-5.5-4-4 5.5-.5Z"/>',
  reputation:
    '<path d="m4 8 4-4h8l4 4-8 12Z"/><path d="M4 8h16"/><path d="m8 4 4 4 4-4"/>',
  leaderboard:
    '<rect x="3" y="13" width="4" height="8"/><rect x="10" y="8" width="4" height="13"/><rect x="17" y="4" width="4" height="17"/>',

  // System
  settings:
    '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3h.1a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8v.1a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z"/>',
  support:
    '<circle cx="12" cy="12" r="9"/><path d="M9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3"/><path d="M12 17h.01"/>',
  admin:
    '<path d="M12 3 4 6v6c0 5 3.5 8 8 9 4.5-1 8-4 8-9V6Z"/><path d="m9 12 2 2 4-4"/>',
  power:
    '<path d="m14 4 6 6-3 3-6-6Z"/><path d="m4 20 8-8"/><path d="m10 4-6 6 3 3 6-6"/><path d="m20 14-6 6"/>',
  realmBadge:
    '<path d="m12 2 3 4h4v4l3 3-3 3v4h-4l-3 4-3-4H5v-4l-3-3 3-3V6h4Z"/>',
  pill:
    '<rect x="3" y="8" width="18" height="8" rx="4"/><path d="M12 8v8"/>',
};

const sizeClass = computed(() => {
  switch (props.size) {
    case 'xs':
      return 'h-3.5 w-3.5';
    case 'sm':
      return 'h-4 w-4';
    case 'lg':
      return 'h-6 w-6';
    case 'xl':
      return 'h-8 w-8';
    default:
      return 'h-5 w-5';
  }
});

const toneClass = computed(() => {
  switch (props.tone) {
    case 'jade':
      return 'text-[var(--xt-text-jade)]';
    case 'gold':
      return 'text-amber-600';
    case 'cyan':
      return 'text-sky-700';
    case 'violet':
      return 'text-violet-600';
    case 'danger':
      return 'text-rose-600';
    case 'muted':
      return 'text-[var(--xt-text-subtle)]';
    default:
      return '';
  }
});

const inner = computed(() => ICON_PATHS[props.name] ?? ICON_PATHS.menu);
const ariaProps = computed<Record<string, string>>(() => {
  const out: Record<string, string> = {};
  if (props.label) {
    out.role = 'img';
    out['aria-label'] = props.label;
  } else {
    out['aria-hidden'] = 'true';
  }
  return out;
});
</script>

<template>
  <!-- eslint-disable vue/no-v-html -->
  <!-- `inner` is sourced exclusively from the static ICON_PATHS map in this
       file (never from user input), so v-html is safe here. -->
  <svg
    v-bind="ariaProps"
    class="inline-block shrink-0 align-middle"
    :class="[sizeClass, toneClass]"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="1.6"
    stroke-linecap="round"
    stroke-linejoin="round"
    data-testid="xt-icon"
    :data-name="name"
    v-html="inner"
  />
</template>
