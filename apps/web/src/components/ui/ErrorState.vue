<script setup lang="ts">
/**
 * Phase 41.0 — Error state chuẩn.
 *
 * Hiển thị error code i18n + nút retry.
 */
import { useI18n } from 'vue-i18n';
import MButton from './MButton.vue';

const props = withDefaults(
  defineProps<{
    errorKey?: string;
    /** Optional i18n key cho retry button. */
    retryKey?: string;
    testId?: string;
  }>(),
  {
    errorKey: 'common.error.UNKNOWN',
    retryKey: 'common.retry',
    testId: 'error-state',
  },
);
const emit = defineEmits<{ (e: 'retry'): void }>();
const { t } = useI18n();
</script>

<template>
  <div
    class="p-4 border border-red-400/40 rounded bg-red-900/20 text-red-200 space-y-3 text-sm"
    :data-testid="props.testId"
    role="alert"
  >
    <p>{{ t(props.errorKey) }}</p>
    <MButton @click="emit('retry')">{{ t(props.retryKey) }}</MButton>
  </div>
</template>
