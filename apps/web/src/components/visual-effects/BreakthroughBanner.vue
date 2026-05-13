<script setup lang="ts">
/**
 * Phase 42.0 — Breakthrough banner.
 *
 * Hiển thị banner đột phá thành công/thất bại (luyện khí / luyện thể).
 * KHÔNG sửa cultivation formula.
 */
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { getEffectOrFallback } from '@xuantoi/shared';

const props = withDefaults(
  defineProps<{
    success: boolean;
    breakthroughType?: 'CULTIVATION' | 'BODY_CULTIVATION';
    characterName?: string | null;
    fromRealm?: string | null;
    toRealm?: string | null;
    message?: string | null;
    rewardSummary?: string | null;
    visualEffectLevel?: 'OFF' | 'LOW' | 'MEDIUM' | 'HIGH';
    reducedMotion?: boolean;
    testId?: string;
  }>(),
  {
    breakthroughType: 'CULTIVATION',
    characterName: null,
    fromRealm: null,
    toRealm: null,
    message: null,
    rewardSummary: null,
    visualEffectLevel: 'MEDIUM',
    reducedMotion: false,
    testId: 'breakthrough-banner',
  },
);

const { t } = useI18n();

const effectKey = computed(() => {
  if (props.breakthroughType === 'BODY_CULTIVATION') return 'BODY_BREAKTHROUGH';
  return props.success ? 'REALM_BREAKTHROUGH' : 'REALM_BREAKTHROUGH_FAILED';
});

const effect = computed(() => getEffectOrFallback(effectKey.value));

const containerClass = computed(() => {
  const parts: string[] = ['border rounded-lg p-4 max-w-md'];
  if (props.success) {
    parts.push('border-amber-300/70 bg-amber-900/30 text-amber-50');
    if (!props.reducedMotion && props.visualEffectLevel === 'HIGH') {
      parts.push('ve-anim-breakthrough-glow');
    }
  } else {
    parts.push('border-red-400/70 bg-red-900/30 text-red-50');
  }
  return parts.join(' ');
});

const titleKey = computed(() =>
  props.success
    ? 'visualEffects.breakthrough.success'
    : 'visualEffects.breakthrough.failed',
);
</script>

<template>
  <div
    :class="containerClass"
    :data-testid="props.testId"
    :data-effect-key="effect.key"
    :data-success="props.success ? 'true' : 'false'"
    :data-type="props.breakthroughType"
    role="alert"
  >
    <p class="text-base font-semibold uppercase tracking-wide">{{ t(titleKey) }}</p>
    <p v-if="props.characterName" class="text-sm mt-1">{{ props.characterName }}</p>
    <p v-if="props.fromRealm && props.toRealm" class="text-sm mt-0.5">
      {{ props.fromRealm }} → {{ props.toRealm }}
    </p>
    <p v-if="props.message" class="text-sm mt-2 opacity-90">{{ props.message }}</p>
    <p v-if="props.rewardSummary" class="text-xs mt-2 opacity-80">
      {{ props.rewardSummary }}
    </p>
  </div>
</template>
