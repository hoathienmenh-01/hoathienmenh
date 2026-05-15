<script setup lang="ts">
/**
 * UI-2.0 — Universal back button.
 *
 * Logic:
 *   1. Nếu có history.length > 1 → router.back()
 *   2. Nếu không có history → fallback về `/dashboard` (theo task spec).
 *
 * Dùng được trong cả mobile page header và desktop topbar. Cũng dùng được
 * trong modal/bottom sheet (label="Đóng") qua prop `mode`.
 */
import { useRouter } from 'vue-router';
import XTIcon from '@/components/xianxia/XTIcon.vue';

const props = withDefaults(
  defineProps<{
    label?: string;
    mode?: 'back' | 'close';
    fallback?: string;
    /** Override default click handler — used for modals/bottom sheets. */
    onCustomClick?: () => void;
  }>(),
  {
    label: 'Quay lại',
    mode: 'back',
    fallback: '/dashboard',
    onCustomClick: undefined,
  },
);

const router = useRouter();

function go(): void {
  if (props.onCustomClick) {
    props.onCustomClick();
    return;
  }
  if (typeof window !== 'undefined' && window.history.length > 1) {
    router.back();
    return;
  }
  void router.push(props.fallback);
}
</script>

<template>
  <button
    type="button"
    class="inline-flex min-h-10 items-center gap-1.5 rounded-full border border-emerald-300/35 bg-white/70 px-3 py-1.5 text-sm font-medium text-emerald-900 transition hover:bg-white"
    :aria-label="label"
    data-testid="xt-back-button"
    @click="go"
  >
    <XTIcon :name="mode === 'close' ? 'close' : 'back'" size="sm" />
    <span>{{ label }}</span>
  </button>
</template>
