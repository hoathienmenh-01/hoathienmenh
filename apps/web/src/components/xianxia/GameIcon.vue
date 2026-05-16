<script setup lang="ts">
import { computed } from 'vue';

const props = withDefaults(
  defineProps<{
    name: string;
    label?: string;
    size?: 'sm' | 'md' | 'lg';
  }>(),
  {
    label: '',
    size: 'md',
  },
);

/**
 * Cửu Thiên Mộng — `GameIcon` iconMap thuần Việt (PR3.5).
 *
 * Toàn bộ glyph trước đây dùng chữ Hán đã được thay bằng symbol Unicode
 * trung tính (geometric / arrows / sparkles) để giữ "thuần Việt" cho
 * apps/web/src. Fallback `•` cho key không tìm thấy.
 */
const iconMap: Record<string, string> = {
  home: '⌂',
  dashboard: '✧',
  character: '☯',
  cultivation: '✦',
  breakthrough: '✺',
  body: '🛡',
  bodyCultivation: '🛡',
  method: '✎',
  cultivationMethod: '✎',
  spiritualRoot: '❀',
  skill: '✶',
  skillBook: '✶',
  inventory: '⛃',
  equipment: '⚔',
  pet: '♞',
  realm: '◇',
  secretRealm: '⛰',
  roguelike: '⚄',
  tower: '⛩',
  sect: '⛩',
  market: '⛬',
  auction: '⚖',
  event: '✦',
  achievement: '♛',
  mail: '✉',
  notification: '✷',
  settings: '⚙',
  stone: '◈',
  linhThach: '◈',
  jade: '◆',
  tienNgoc: '◆',
  power: '⚔',
  realmBadge: '◈',
  pill: '◉',
  boss: '☠',
  alchemy: '⚗',
  farm: '✿',
  social: '☘',
  title: '✦',
  reputation: '♛',
  support: '?',
  admin: '✠',
  close: '×',
  back: '←',
};

const symbol = computed(() => iconMap[props.name] ?? '•');
const sizeClass = computed(() => {
  if (props.size === 'sm') return 'h-5 w-5 text-xs';
  if (props.size === 'lg') return 'h-9 w-9 text-xl';
  return 'h-7 w-7 text-base';
});
</script>

<template>
  <span
    class="inline-flex shrink-0 items-center justify-center rounded-xl border border-[var(--xt-border-jade)] bg-[var(--xt-bg-surface)] text-[var(--xt-text-primary)] shadow-[0_0_18px_rgba(74,169,143,0.18)]"
    :class="sizeClass"
    :role="label ? 'img' : undefined"
    :aria-label="label || undefined"
    :aria-hidden="label ? undefined : 'true'"
    data-testid="game-icon"
  >
    {{ symbol }}
  </span>
</template>
