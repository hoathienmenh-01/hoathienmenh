<script setup lang="ts">
/**
 * Cửu Thiên Mộng — `XTPageEyebrow` (PR3.5 thuần Việt eyebrow).
 *
 * Dòng "eyebrow" cổ phong thuần Việt phía trên `<h1>` của các view chính.
 * Thay thế `XTHeroEyebrow` cũ (vốn render chữ Hán). API mới:
 *
 *   - `caps` (tuỳ chọn): chuỗi caps decorative ngắn, hiển thị bằng font
 *     display + tracking rộng, đứng ở vị trí mà chữ Hán từng giữ.
 *   - `label` (bắt buộc): nhãn tiếng Việt, hiển thị nhỏ hơn sau dấu `·`.
 *   - `testId`: data-testid (mặc định `xt-page-eyebrow`).
 *
 * Không còn render bất kỳ chữ Hán nào — toàn bộ visual cổ phong dựa vào
 * dải vàng + spacing + font display.
 */
withDefaults(
  defineProps<{
    caps?: string | null;
    label: string;
    testId?: string;
  }>(),
  {
    caps: null,
    testId: 'xt-page-eyebrow',
  },
);
</script>

<template>
  <p
    class="xt-page-eyebrow flex items-center gap-2 text-[10px] uppercase tracking-[0.32em] text-[var(--xt-text-jade)] md:text-xs"
    :data-testid="testId"
  >
    <span aria-hidden="true" class="inline-block h-px w-6 bg-[var(--xt-border-jade)]" />
    <span
      v-if="caps"
      class="xt-page-eyebrow__caps"
    >
      {{ caps }}
    </span>
    <span v-if="caps && label" aria-hidden="true" class="text-[var(--xt-gold-bright)]/70">·</span>
    <span v-if="label" class="xt-page-eyebrow__label">{{ label }}</span>
  </p>
</template>

<style scoped>
.xt-page-eyebrow__caps {
  font-family: var(--xt-font-decorative), var(--xt-font-display), serif;
  font-size: 12px;
  letter-spacing: 0.18em;
  color: var(--xt-gold-bright, #f2d789);
  text-shadow: 0 0 6px rgba(242, 215, 137, 0.2);
}

.xt-page-eyebrow__label {
  letter-spacing: 0.28em;
}
</style>
