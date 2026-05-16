<script setup lang="ts">
import { computed } from 'vue';

const props = withDefaults(
  defineProps<{
    name: string;
    label?: string;
    size?: 'sm' | 'md' | 'lg';
    /** Tone tint cho viền + glow. Mặc định jade. */
    tone?: 'jade' | 'gold' | 'seal' | 'violet' | 'cyan' | 'smoke';
  }>(),
  {
    label: '',
    size: 'md',
    tone: 'jade',
  },
);

/**
 * Cửu Thiên Mộng — `GameIcon` (Phase 7 expansion).
 *
 * Bản đồ glyph Unicode thuần Việt — tuyệt đối KHÔNG chứa chữ Hán. Mỗi
 * key trỏ về một ký tự symbol (geometric / arrows / sparkles / emoji)
 * có thể render ổn định trên mọi font hệ thống. Fallback `•` cho key
 * không tìm thấy.
 *
 * Các nhóm:
 *   - core: home, dashboard, character, settings, ...
 *   - cultivation domain: cultivation, breakthrough, method, spiritualRoot
 *   - inventory / equipment / pet / equip slot
 *   - combat domain: combat, pvp, boss, dungeon, encounter
 *   - economy: market, shop, auction, wallet, gift, linhThach, tienNgoc
 *   - quest / achievement / codex / mentor
 *   - social / sect / mail / notification / feedback
 *   - meta: admin, support, refresh, close, back, search, filter, sort,
 *     plus, minus, info, warning, danger, success, lock, unlock, time,
 *     calendar, star, fire, water, wind, earth, metal, wood, light, dark.
 */
const iconMap: Record<string, string> = {
  // --- core ---
  home: '⌂',
  dashboard: '✧',
  character: '☯',
  settings: '⚙',
  refresh: '↻',
  close: '×',
  back: '←',
  forward: '→',
  search: '⌕',
  filter: '⚲',
  sort: '⇅',
  plus: '＋',
  minus: '−',
  info: 'ⓘ',
  warning: '⚠',
  danger: '⚠',
  success: '✓',
  lock: '🔒',
  unlock: '🔓',
  time: '⌛',
  calendar: '🗓',
  star: '★',
  // --- cultivation domain ---
  cultivation: '✦',
  breakthrough: '✺',
  body: '🛡',
  bodyCultivation: '🛡',
  method: '✎',
  cultivationMethod: '✎',
  spiritualRoot: '❀',
  realm: '◇',
  realmBadge: '◈',
  pill: '◉',
  alchemy: '⚗',
  // --- inventory / equipment ---
  inventory: '⛃',
  equipment: '⚔',
  weapon: '⚔',
  armor: '🛡',
  accessory: '◍',
  pet: '♞',
  skill: '✶',
  skillBook: '✶',
  // --- combat domain ---
  combat: '⚔',
  pvp: '⚔',
  arena: '⚔',
  boss: '☠',
  dungeon: '⛰',
  secretRealm: '⛰',
  roguelike: '⚄',
  tower: '⛩',
  encounter: '✺',
  treasure: '◈',
  // --- economy ---
  market: '⛬',
  shop: '🏪',
  auction: '⚖',
  wallet: '💰',
  gift: '🎁',
  linhThach: '◈',
  jade: '◆',
  tienNgoc: '◆',
  stone: '◈',
  contribution: '✦',
  // --- progression ---
  quest: '✎',
  questMain: '◈',
  questSide: '◇',
  questBranch: '✦',
  questHidden: '✷',
  achievement: '♛',
  codex: '📖',
  mentor: '☘',
  title: '✦',
  reputation: '♛',
  // --- social / sect ---
  sect: '⛩',
  social: '☘',
  mail: '✉',
  friend: '☘',
  npc: '☻',
  // --- system ---
  notification: '✷',
  event: '✦',
  feedback: '✎',
  admin: '✠',
  support: '?',
  // --- power / stats ---
  power: '⚔',
  // --- elements (ngũ hành) ---
  fire: '🔥',
  water: '💧',
  wind: '🌬',
  earth: '⛰',
  metal: '⚙',
  wood: '🌿',
  light: '☀',
  dark: '☾',
  // --- other ---
  farm: '✿',
};

const symbol = computed(() => iconMap[props.name] ?? '•');
const sizeClass = computed(() => {
  if (props.size === 'sm') return 'h-5 w-5 text-xs';
  if (props.size === 'lg') return 'h-9 w-9 text-xl';
  return 'h-7 w-7 text-base';
});
const toneClass = computed(() => `xt-game-icon--${props.tone}`);
</script>

<template>
  <span
    class="xt-game-icon inline-flex shrink-0 items-center justify-center rounded-xl border bg-[var(--xt-bg-surface)] text-[var(--xt-text-primary)]"
    :class="[sizeClass, toneClass]"
    :role="label ? 'img' : undefined"
    :aria-label="label || undefined"
    :aria-hidden="label ? undefined : 'true'"
    :data-icon="name"
    data-testid="game-icon"
  >
    {{ symbol }}
  </span>
</template>

<style scoped>
.xt-game-icon {
  border-color: var(--xt-border-jade);
  box-shadow: 0 0 18px rgba(74, 169, 143, 0.18);
}
.xt-game-icon--gold {
  border-color: var(--xt-border-gold);
  box-shadow: 0 0 18px rgba(196, 156, 75, 0.22);
}
.xt-game-icon--seal {
  border-color: var(--xt-seal-bright, #b8484a);
  box-shadow: 0 0 18px rgba(184, 72, 74, 0.22);
}
.xt-game-icon--violet {
  border-color: rgba(168, 132, 222, 0.55);
  box-shadow: 0 0 18px rgba(168, 132, 222, 0.22);
}
.xt-game-icon--cyan {
  border-color: rgba(98, 200, 220, 0.55);
  box-shadow: 0 0 18px rgba(98, 200, 220, 0.22);
}
.xt-game-icon--smoke {
  border-color: rgba(190, 196, 208, 0.4);
  box-shadow: 0 0 14px rgba(190, 196, 208, 0.18);
}
</style>
