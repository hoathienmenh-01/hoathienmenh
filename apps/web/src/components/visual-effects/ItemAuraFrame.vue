<script setup lang="ts">
/**
 * Phase 42.0 — Item aura frame.
 *
 * Bao quanh item card / inventory slot bằng aura theo tier+rarity+element.
 * KHÔNG sửa item stat. Reduced-motion: chỉ render static border.
 */
import { computed } from 'vue';
import { mapItemToAuraProps } from '@/lib/visual-effect-adapters';

const props = withDefaults(
  defineProps<{
    itemName?: string | null;
    tier?: number | null;
    rarity?: string | null;
    quality?: string | null;
    element?: string | null;
    itemType?: string | null;
    equipped?: boolean;
    visualEffectLevel?: 'OFF' | 'LOW' | 'MEDIUM' | 'HIGH';
    reducedMotion?: boolean;
    testId?: string;
  }>(),
  {
    itemName: null,
    tier: null,
    rarity: null,
    quality: null,
    element: null,
    itemType: null,
    equipped: false,
    visualEffectLevel: 'MEDIUM',
    reducedMotion: false,
    testId: 'item-aura-frame',
  },
);

const aura = computed(() =>
  mapItemToAuraProps({
    tier: props.tier ?? undefined,
    rarity: props.rarity ?? undefined,
    quality: props.quality ?? undefined,
    element: props.element ?? undefined,
    itemType: props.itemType ?? undefined,
    equipped: props.equipped,
  }),
);

const containerClass = computed(() => {
  const parts: string[] = ['relative rounded inline-block'];
  parts.push(aura.value.cssClass);
  if (aura.value.elementClass) parts.push(aura.value.elementClass);
  if (
    !props.reducedMotion &&
    props.visualEffectLevel === 'HIGH' &&
    (aura.value.intensity === 'HIGH' ||
      aura.value.intensity === 'LEGENDARY' ||
      aura.value.intensity === 'IMMORTAL')
  ) {
    parts.push('ve-anim-aura-ring');
  } else if (
    !props.reducedMotion &&
    props.visualEffectLevel !== 'OFF' &&
    aura.value.intensity === 'MEDIUM'
  ) {
    parts.push('ve-anim-glow-subtle');
  }
  return parts.join(' ');
});

const showAnimated = computed(
  () =>
    !props.reducedMotion &&
    props.visualEffectLevel !== 'OFF' &&
    aura.value.intensity !== 'NONE',
);
</script>

<template>
  <span
    :class="containerClass"
    :data-testid="props.testId"
    :data-aura-key="aura.effectKey"
    :data-aura-intensity="aura.intensity"
    :data-aura-animated="showAnimated ? 'true' : 'false'"
  >
    <slot />
  </span>
</template>
