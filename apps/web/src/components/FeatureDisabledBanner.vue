<script setup lang="ts">
/**
 * Phase 15.4 — Feature disabled banner.
 *
 * Render banner i18n "Tính năng đang tạm tắt để bảo trì" khi flag off.
 * Chỉ là UX hint — server vẫn gate cuối cùng (`FEATURE_DISABLED` 503).
 */
import { useI18n } from 'vue-i18n';

interface Props {
  /** I18n key cho subtitle (ví dụ "arena.disabled.message"). Fallback dùng default chung. */
  messageKey?: string;
  /** Test id cho query trong test. */
  testId?: string;
}

const props = withDefaults(defineProps<Props>(), {
  messageKey: '',
  testId: 'feature-disabled-banner',
});

const { t } = useI18n();

function resolvedMessage(): string {
  if (!props.messageKey) {
    return t('featureFlags.disabled.message');
  }
  const v = t(props.messageKey, '__missing__');
  if (v === '__missing__') return t('featureFlags.disabled.message');
  return v;
}
</script>

<template>
  <div
    class="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-100"
    :data-testid="props.testId"
    role="status"
  >
    <div class="font-semibold">
      {{ t('featureFlags.disabled.title') }}
    </div>
    <p class="mt-1 text-amber-200/90">{{ resolvedMessage() }}</p>
  </div>
</template>
