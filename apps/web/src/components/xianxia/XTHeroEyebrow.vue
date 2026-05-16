<script setup lang="ts">
/**
 * Cửu Thiên Mộng — `XTHeroEyebrow` (PR3.5 backward-compatible alias).
 *
 * Thuần Việt từ PR3.5: alias mỏng cho `XTPageEyebrow`. Giữ API cũ (`han`
 * / `label`) cho các call site chưa migrate; prop `han` map sang `caps`,
 * NHƯNG nếu `han` chứa ký tự Hán thì bị bỏ qua (không render Hán) để giữ
 * cam kết "thuần Việt apps/web/src". Khuyên dùng `XTPageEyebrow` trực
 * tiếp với `caps?: string | null` + `label: string`.
 */
import { computed } from 'vue';
import XTPageEyebrow from './XTPageEyebrow.vue';

const HAN_RE = /[\u4e00-\u9fff]/;

const props = withDefaults(
  defineProps<{
    han?: string | null;
    caps?: string | null;
    label: string;
    testId?: string;
  }>(),
  {
    han: null,
    caps: null,
    testId: 'xt-hero-eyebrow',
  },
);

const resolvedCaps = computed<string | null>(() => {
  if (props.caps && props.caps.length > 0) return props.caps;
  if (props.han && props.han.length > 0 && !HAN_RE.test(props.han)) {
    return props.han;
  }
  return null;
});
</script>

<template>
  <XTPageEyebrow :caps="resolvedCaps" :label="label" :test-id="testId" />
</template>
