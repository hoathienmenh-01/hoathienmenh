<script setup lang="ts">
/**
 * Error state cao cấp — ornate seal-red frame + retry button luxury.
 *
 * Props:
 *  - errorKey / retryKey: i18n keys.
 *  - testId.
 */
import { useI18n } from 'vue-i18n';
import MButton from './MButton.vue';

const props = withDefaults(
  defineProps<{
    errorKey?: string;
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
  <div class="xt-error" :data-testid="props.testId" role="alert">
    <span class="xt-error__corner xt-error__corner--tl" aria-hidden="true" />
    <span class="xt-error__corner xt-error__corner--tr" aria-hidden="true" />
    <span class="xt-error__corner xt-error__corner--bl" aria-hidden="true" />
    <span class="xt-error__corner xt-error__corner--br" aria-hidden="true" />
    <div class="xt-error__glyph" aria-hidden="true">✸</div>
    <p class="xt-error__message">{{ t(props.errorKey) }}</p>
    <div class="xt-error__action">
      <MButton @click="emit('retry')">{{ t(props.retryKey) }}</MButton>
    </div>
  </div>
</template>

<style scoped>
.xt-error {
  position: relative;
  padding: 22px 18px 18px;
  border-radius: 18px;
  border: 1px solid rgba(208, 79, 79, 0.55);
  background:
    radial-gradient(120% 80% at 50% 0%, rgba(208, 79, 79, 0.18) 0%, transparent 70%),
    linear-gradient(180deg, rgba(36, 14, 14, 0.85) 0%, rgba(20, 8, 8, 0.92) 100%);
  color: #f4cccc;
  font-size: 13px;
  line-height: 1.5;
  text-align: center;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  box-shadow:
    0 10px 32px rgba(0, 0, 0, 0.6),
    inset 0 0 0 1px rgba(208, 79, 79, 0.18);
}
.xt-error__corner {
  position: absolute;
  width: 12px;
  height: 12px;
  border: 1px solid rgba(248, 174, 174, 0.7);
  box-shadow: 0 0 8px rgba(208, 79, 79, 0.45);
  pointer-events: none;
}
.xt-error__corner--tl {
  top: 8px;
  left: 8px;
  border-right: 0;
  border-bottom: 0;
}
.xt-error__corner--tr {
  top: 8px;
  right: 8px;
  border-left: 0;
  border-bottom: 0;
}
.xt-error__corner--bl {
  bottom: 8px;
  left: 8px;
  border-right: 0;
  border-top: 0;
}
.xt-error__corner--br {
  bottom: 8px;
  right: 8px;
  border-left: 0;
  border-top: 0;
}
.xt-error__glyph {
  font-family: var(--xt-font-decorative), serif;
  font-size: 30px;
  line-height: 1;
  color: rgba(248, 174, 174, 0.85);
  text-shadow: 0 0 12px rgba(208, 79, 79, 0.55);
}
.xt-error__message {
  max-width: 52ch;
  margin: 0 auto;
  color: #f4cccc;
}
.xt-error__action {
  margin-top: 4px;
}
</style>
