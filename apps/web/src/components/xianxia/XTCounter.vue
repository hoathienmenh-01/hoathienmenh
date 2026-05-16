<script setup lang="ts">
/**
 * Cửu Thiên Mộng — `XTCounter` (Phase 6 micro animation).
 *
 * Hiển thị giá trị số có hiệu ứng đếm khi prop `value` thay đổi.
 *
 * - Dùng `useCountUp` composable (requestAnimationFrame, easeOutCubic).
 * - Tự bỏ animate khi `prefers-reduced-motion` hoặc `<html data-motion="off">`.
 * - Hỗ trợ `decimals`, `prefix`, `suffix`, `format` callback.
 *
 * Props:
 *  - `value` — số đích (number).
 *  - `duration` (ms, default 600).
 *  - `decimals` (default 0).
 *  - `prefix` / `suffix` (string).
 *  - `format` — fn (n) => string (override formatter, override decimals).
 *  - `useGrouping` (default true) — Intl.NumberFormat dùng grouping comma.
 *  - `testId`.
 */
import { computed, toRef } from 'vue';
import { useCountUp } from '@/composables/useCountUp';

const props = withDefaults(
  defineProps<{
    value: number;
    duration?: number;
    decimals?: number;
    prefix?: string;
    suffix?: string;
    format?: ((n: number) => string) | null;
    useGrouping?: boolean;
    testId?: string;
  }>(),
  {
    duration: 600,
    decimals: 0,
    prefix: '',
    suffix: '',
    format: null,
    useGrouping: true,
    testId: 'xt-counter',
  },
);

const target = toRef(props, 'value');
const animated = useCountUp(target, { duration: props.duration });

const display = computed<string>(() => {
  const n = animated.value;
  if (!Number.isFinite(n)) return '0';
  if (props.format) {
    return props.format(n);
  }
  const fixed = props.decimals > 0
    ? n.toFixed(props.decimals)
    : Math.round(n).toString();
  if (!props.useGrouping) return fixed;
  // Group integer part with comma.
  const [intPart, decPart] = fixed.split('.');
  const grouped = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return decPart ? `${grouped}.${decPart}` : grouped;
});
</script>

<template>
  <span
    class="xt-counter tabular-nums"
    :data-testid="testId"
    aria-live="polite"
  >
    <span v-if="prefix">{{ prefix }}</span>
    <span :data-testid="`${testId}-value`">{{ display }}</span>
    <span v-if="suffix">{{ suffix }}</span>
  </span>
</template>

<style scoped>
.xt-counter {
  font-variant-numeric: tabular-nums;
  display: inline-flex;
  align-items: baseline;
  gap: 2px;
}
</style>
