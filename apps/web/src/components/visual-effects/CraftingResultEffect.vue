<script setup lang="ts">
/**
 * Phase 42.0 — Crafting / alchemy / artifact awaken result banner.
 */
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { getEffectOrFallback } from '@xuantoi/shared';
import type { CraftResultType } from '@/lib/visual-effect-adapters';

const props = withDefaults(
  defineProps<{
    resultType: CraftResultType;
    itemName?: string | null;
    quality?: string | null;
    tier?: number | null;
    rarity?: string | null;
    element?: string | null;
    message?: string | null;
    visualEffectLevel?: 'OFF' | 'LOW' | 'MEDIUM' | 'HIGH';
    reducedMotion?: boolean;
    testId?: string;
  }>(),
  {
    itemName: null,
    quality: null,
    tier: null,
    rarity: null,
    element: null,
    message: null,
    visualEffectLevel: 'MEDIUM',
    reducedMotion: false,
    testId: 'crafting-result-effect',
  },
);

const { t } = useI18n();

const effect = computed(() => getEffectOrFallback(props.resultType));

const isFail = computed(
  () => props.resultType === 'ALCHEMY_FAIL' || props.resultType === 'CRAFT_FAIL',
);

const isHigh = computed(
  () =>
    props.resultType === 'ALCHEMY_HIGH_QUALITY' ||
    props.resultType === 'DAN_VAN_APPEAR' ||
    props.resultType === 'ARTIFACT_AWAKEN',
);

const containerClass = computed(() => {
  const parts: string[] = ['border rounded-md p-3 max-w-sm'];
  if (isFail.value) {
    parts.push('border-red-400/60 bg-red-900/25 text-red-100');
  } else if (isHigh.value) {
    parts.push('border-amber-300/70 bg-amber-900/25 text-amber-100');
    if (!props.reducedMotion && props.visualEffectLevel === 'HIGH') {
      parts.push('ve-anim-glow-subtle');
    }
  } else {
    parts.push('border-[var(--xt-border-jade)] bg-emerald-900/25 text-emerald-100');
  }
  return parts.join(' ');
});

const titleKey = computed(() => `visualEffects.crafting.${props.resultType}`);
</script>

<template>
  <div
    :class="containerClass"
    :data-testid="props.testId"
    :data-effect-key="effect.key"
    :data-result-type="props.resultType"
    role="status"
  >
    <p class="text-sm font-semibold uppercase tracking-wide">{{ t(titleKey) }}</p>
    <p v-if="props.itemName" class="text-base mt-0.5">{{ props.itemName }}</p>
    <p v-if="props.quality || props.rarity" class="text-xs opacity-80 mt-0.5">
      {{ props.quality ?? props.rarity }}
    </p>
    <p v-if="props.message" class="text-xs mt-2 opacity-80">{{ props.message }}</p>
  </div>
</template>
