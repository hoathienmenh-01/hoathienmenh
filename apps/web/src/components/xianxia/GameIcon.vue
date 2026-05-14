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
  dashboard: '星',
  character: '人',
  cultivation: '✦',
  breakthrough: '焰',
  body: '盾',
  bodyCultivation: '盾',
  method: '卷',
  cultivationMethod: '卷',
  spiritualRoot: '芽',
  skill: '符',
  skillBook: '符',
  inventory: '包',
  equipment: '⚔',
  pet: '♞',
  realm: '◇',
  secretRealm: '山',
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
  linhThach: '◈',
  jade: '◆',
  tienNgoc: '◆',
  power: '劍',
  realmBadge: '境',
  pill: '丹',
  boss: '☠',
  alchemy: '鼎',
  farm: '田',
  social: '友',
  title: '印',
  reputation: '冠',
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
    class="inline-flex shrink-0 items-center justify-center rounded-xl border border-emerald-300/25 bg-white/55 text-emerald-800 shadow-[0_0_18px_rgba(74,169,143,0.18)]"
    :class="sizeClass"
    :role="label ? 'img' : undefined"
    :aria-label="label || undefined"
    :aria-hidden="label ? undefined : 'true'"
    data-testid="game-icon"
  >
    {{ symbol }}
  </span>
</template>
