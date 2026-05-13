<script setup lang="ts">
/**
 * Phase 41.0 — Empty state chuẩn dùng chung.
 *
 * Hiển thị tiêu đề + mô tả (i18n key) + optional CTA (slot).
 */
import { useI18n } from 'vue-i18n';

const props = withDefaults(
  defineProps<{
    titleKey?: string;
    descriptionKey?: string;
    testId?: string;
  }>(),
  {
    titleKey: 'common.empty.title',
    descriptionKey: 'common.empty.description',
    testId: 'empty-state',
  },
);
const { t } = useI18n();
</script>

<template>
  <div
    class="p-6 border border-ink-300/20 rounded bg-ink-700/20 text-center space-y-2"
    :data-testid="props.testId"
    role="status"
  >
    <h3 class="text-amber-200 text-base">{{ t(props.titleKey) }}</h3>
    <p class="text-xs text-ink-300">{{ t(props.descriptionKey) }}</p>
    <div class="pt-2"><slot /></div>
  </div>
</template>
