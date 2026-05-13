<script setup lang="ts">
/**
 * Phase 41.0 — Loading state chuẩn dùng chung cho list/form/page.
 *
 * Hiển thị 1 skeleton block + label i18n key (mặc định `common.loading`).
 * `inline=true` để dùng trong row (height/width compact); default full-width.
 */
import { useI18n } from 'vue-i18n';
import SkeletonBlock from './SkeletonBlock.vue';

const props = withDefaults(
  defineProps<{
    labelKey?: string;
    inline?: boolean;
    testId?: string;
  }>(),
  {
    labelKey: 'common.loading',
    inline: false,
    testId: 'loading-state',
  },
);
const { t } = useI18n();
</script>

<template>
  <div
    :class="[
      'flex items-center gap-3 text-ink-300 text-sm',
      props.inline ? '' : 'p-4',
    ]"
    :data-testid="props.testId"
    role="status"
    aria-live="polite"
  >
    <SkeletonBlock height="h-3" width="w-3" rounded="rounded-full" />
    <span>{{ t(props.labelKey) }}</span>
  </div>
</template>
