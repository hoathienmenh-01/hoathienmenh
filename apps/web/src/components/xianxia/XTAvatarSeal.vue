<script setup lang="ts">
/**
 * Cửu Thiên Mộng — fallback avatar "ấn ký rune" (jade seal style).
 *
 * Khi `src` được truyền và load thành công, hiển thị ảnh. Ngược lại,
 * fallback về initials trên nền ngọc tối với rune mờ phía sau.
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
    class="xt-avatar-seal relative inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full"
    :class="sizeClass"
    data-testid="xt-avatar-seal"
  >
    <svg
      v-if="!showImage"
      class="pointer-events-none absolute inset-0 h-full w-full text-[var(--xt-jade-bright)]/30"
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
    <span v-else class="relative tracking-wider font-bold">{{ initials }}</span>
  </div>
</template>

<style scoped>
.xt-avatar-seal {
  border: 1px solid var(--xt-border-gold);
  background:
    radial-gradient(circle at 30% 30%, rgba(95, 227, 198, 0.32) 0%, transparent 55%),
    linear-gradient(135deg, rgba(28, 22, 12, 0.95) 0%, rgba(14, 19, 24, 0.95) 100%);
  color: var(--xt-gold-bright);
  font-family: var(--xt-font-display);
  box-shadow:
    inset 0 1px 0 rgba(255, 246, 224, 0.12),
    0 6px 18px rgba(0, 0, 0, 0.45),
    var(--xt-shadow-jade-glow);
}
</style>
