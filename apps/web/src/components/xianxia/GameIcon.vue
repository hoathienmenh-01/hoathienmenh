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

const iconMap: Record<string, string> = {
  home: '⌂',
  character: '人',
  cultivation: '✦',
  body: '盾',
  inventory: '包',
  equipment: '⚔',
  pet: '♞',
  realm: '◇',
  roguelike: '骰',
  tower: '塔',
  sect: '門',
  market: '市',
  auction: '槌',
  event: '曆',
  achievement: '冠',
  mail: '書',
  notification: '鈴',
  settings: '設',
  stone: '◈',
  jade: '◆',
  power: '劍',
  realmBadge: '境',
  pill: '丹',
  boss: '☠',
  dashboard: '星',
  alchemy: '鼎',
  farm: '田',
  social: '友',
  support: '問',
  admin: '官',
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
    class="inline-flex shrink-0 items-center justify-center rounded-xl border border-cyan-200/15 bg-cyan-200/5 text-cyan-100 shadow-[0_0_18px_rgba(34,211,238,0.14)]"
    :class="sizeClass"
    :role="label ? 'img' : undefined"
    :aria-label="label || undefined"
    :aria-hidden="label ? undefined : 'true'"
    data-testid="game-icon"
  >
    {{ symbol }}
  </span>
</template>
