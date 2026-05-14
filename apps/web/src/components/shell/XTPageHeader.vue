<script setup lang="ts">
/**
 * UI-2.0 — Page header for individual function pages.
 *
 * Mobile: nút Back ở góc trái, page title ở giữa, optional action ở phải.
 * Desktop: cùng layout nhưng padding nhiều hơn, title to hơn.
 *
 * Mục đích: thay cho `<h1>` rời rạc trong từng view, đảm bảo mọi page riêng
 * (Inventory, Cultivation, Sect, …) đều có header gọn + back consistent.
 */
import XTBackButton from './XTBackButton.vue';

defineProps<{
  title: string;
  subtitle?: string;
  hideBack?: boolean;
  backLabel?: string;
  backFallback?: string;
}>();
</script>

<template>
  <header
    class="flex flex-wrap items-center gap-3 border-b border-emerald-300/20 bg-white/40 px-4 py-3 backdrop-blur md:rounded-t-3xl md:border md:border-emerald-300/30 md:bg-white/55"
    data-testid="xt-page-header"
  >
    <XTBackButton
      v-if="!hideBack"
      :label="backLabel ?? 'Quay lại'"
      :fallback="backFallback ?? '/dashboard'"
    />
    <div class="min-w-0 flex-1">
      <h1
        class="truncate text-base font-semibold tracking-wide text-emerald-950 md:text-2xl"
        data-testid="xt-page-title"
      >
        {{ title }}
      </h1>
      <p v-if="subtitle" class="truncate text-xs text-emerald-900/65 md:text-sm">
        {{ subtitle }}
      </p>
    </div>
    <div v-if="$slots.actions" class="flex flex-wrap items-center gap-2">
      <slot name="actions" />
    </div>
  </header>
</template>
