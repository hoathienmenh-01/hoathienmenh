<script setup lang="ts">
/**
 * Cửu Thiên Mộng — `XTListStagger` (Phase 6 list micro animation).
 *
 * Wrap `<TransitionGroup>` để hiển thị list item với hiệu ứng:
 *   - fade in + slight translate-Y (xt-list-item enter)
 *   - stagger delay tính theo --xt-list-index (CSS var, set bằng inline
 *     style trên từng item) hoặc auto qua :nth-child khi `auto` = true.
 *
 * Tôn trọng `prefers-reduced-motion` (CSS @media trong style.css) +
 * `<html data-motion="off">` (CSS override).
 *
 * Usage:
 *   <XTListStagger tag="ul" class="space-y-2">
 *     <li v-for="(it, i) in list" :key="it.id" :style="{ '--xt-list-index': i }">
 *       ...
 *     </li>
 *   </XTListStagger>
 *
 * Props:
 *   - `tag` — phần tử bao ngoài (default 'div').
 *   - `name` — transition group name (default 'xt-list-item').
 *   - `appear` — animate cả khi render lần đầu (default true).
 */
withDefaults(
  defineProps<{
    tag?: string;
    name?: string;
    appear?: boolean;
  }>(),
  {
    tag: 'div',
    name: 'xt-list-item',
    appear: true,
  },
);
</script>

<template>
  <TransitionGroup :tag="tag" :name="name" :appear="appear">
    <slot />
  </TransitionGroup>
</template>
