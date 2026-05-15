<script setup lang="ts">
/**
 * Cửu Thiên Mộng — Hán eyebrow line.
 *
 * Hiển thị một dòng "eyebrow" cổ phong với chữ Hán + dải phân cách + nhãn.
 * Dùng phía trên `<h1>` của các view chính.
 */
withDefaults(
  defineProps<{
    han: string;
    label?: string | null;
    testId?: string;
  }>(),
  {
    label: null,
    testId: 'xt-hero-eyebrow',
  },
);
</script>

<template>
  <p
    class="flex items-center gap-2 text-[10px] uppercase tracking-[0.32em] text-[var(--xt-text-jade)] md:text-xs"
    :data-testid="testId"
  >
    <span aria-hidden="true" class="inline-block h-px w-6 bg-[var(--xt-border-jade)]" />
    <span
      aria-hidden="true"
      style="
        font-family: 'Ma Shan Zheng', 'Noto Serif SC', serif;
        font-size: 14px;
        letter-spacing: 0.16em;
      "
    >
      {{ han }}
    </span>
    <span v-if="label">· {{ label }}</span>
  </p>
</template>
