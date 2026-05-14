<script setup lang="ts">
/**
 * UI-2.0 — Fallback avatar seal.
 *
 * XT chưa có ảnh nhân vật cho tất cả người chơi. Khi thiếu ảnh, hiển thị
 * một “ấn ký rune” bằng CSS/SVG: vòng tròn ngọc + 2 chữ initial + rune
 * mờ phía sau. Không phụ thuộc ảnh lớn.
 *
 * Khi `src` được truyền, hiển thị ảnh; fallback về initials nếu lỗi.
 */
import { computed, ref } from 'vue';

const props = withDefaults(
  defineProps<{
    name?: string | null;
    src?: string | null;
    size?: 'sm' | 'md' | 'lg' | 'xl';
  }>(),
  { name: '', src: null, size: 'md' },
);

const failed = ref(false);

const initials = computed(() => {
  const s = (props.name ?? '').trim();
  if (!s) return 'XT';
  const tokens = s.split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return 'XT';
  if (tokens.length === 1) return tokens[0]!.slice(0, 2).toUpperCase();
  return (tokens[0]![0]! + tokens[tokens.length - 1]![0]!).toUpperCase();
});

const sizeClass = computed(() => {
  switch (props.size) {
    case 'sm':
      return 'h-9 w-9 text-[11px]';
    case 'lg':
      return 'h-16 w-16 text-lg';
    case 'xl':
      return 'h-20 w-20 text-xl';
    default:
      return 'h-12 w-12 text-sm';
  }
});

const showImage = computed(() => Boolean(props.src) && !failed.value);
</script>

<template>
  <div
    class="relative inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full border border-emerald-300/40 bg-gradient-to-br from-white via-emerald-50 to-amber-50 font-semibold text-emerald-900 shadow-[0_8px_28px_rgba(74,169,143,0.16)]"
    :class="sizeClass"
    data-testid="xt-avatar-seal"
  >
    <svg
      v-if="!showImage"
      class="pointer-events-none absolute inset-0 h-full w-full text-emerald-700/12"
      viewBox="0 0 64 64"
      aria-hidden="true"
    >
      <circle cx="32" cy="32" r="30" fill="none" stroke="currentColor" stroke-width="1" />
      <circle cx="32" cy="32" r="24" fill="none" stroke="currentColor" stroke-width="0.8" />
      <path d="M32 8v8M32 48v8M8 32h8M48 32h8" stroke="currentColor" stroke-width="0.8" />
      <path
        d="M22 22 32 8l10 14M22 42 32 56l10-14"
        fill="none"
        stroke="currentColor"
        stroke-width="0.6"
        opacity="0.7"
      />
    </svg>
    <img
      v-if="showImage"
      :src="src ?? ''"
      :alt="name ?? ''"
      class="relative h-full w-full object-cover"
      @error="failed = true"
    />
    <span v-else class="relative tracking-wider">{{ initials }}</span>
  </div>
</template>
