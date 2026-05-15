<script setup lang="ts">
/**
 * Phase 42.0 — Item aura frame.
 *
 * Bao quanh item card / inventory slot bằng aura theo tier+rarity+element.
 * KHÔNG sửa item stat. Reduced-motion: chỉ render static border.
 *
 * Cửu Thiên Mộng — khi caller cung cấp slot + tier, frame sẽ render ảnh trang
 * bị từ `apps/web/public/equipment/{sm|md}/{art}{tier}.webp` (xem
 * `@xuantoi/shared/equipment-images`). Slot ngoài 8 slot ảnh sẽ fallback về
 * slot trống (chỉ render slot content qua `<slot>`).
 */
import { computed } from 'vue';
import { mapItemToAuraProps } from '@/lib/visual-effect-adapters';
import {
  getEquipmentImage,
  type EquipmentArtName,
  type EquipmentArtSize,
} from '@xuantoi/shared';

const props = withDefaults(
  defineProps<{
    itemName?: string | null;
    tier?: number | null;
    rarity?: string | null;
    quality?: string | null;
    element?: string | null;
    itemType?: string | null;
    /** Optional slot used to resolve the equipment artwork. */
    slot?: string | null;
    /** Override art name (e.g. force ring art for an accessory item). */
    artName?: EquipmentArtName | null;
    /** Equipment artwork size; defaults to 'sm' (256x256). */
    artSize?: EquipmentArtSize;
    /** Disable embedded artwork (caller renders its own image in slot). */
    hideArt?: boolean;
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
    slot: null,
    artName: null,
    artSize: 'sm',
    hideArt: false,
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

const equipmentImage = computed(() => {
  if (props.hideArt) return null;
  return getEquipmentImage({
    slot: props.slot ?? props.itemType,
    artName: props.artName,
    tier: props.tier,
    size: props.artSize,
  });
});

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
    :data-equipment-art="equipmentImage?.artName ?? undefined"
  >
    <img
      v-if="equipmentImage"
      :src="equipmentImage.url"
      :alt="itemName ?? ''"
      loading="lazy"
      decoding="async"
      class="xt-item-art block h-full w-full rounded object-cover"
      data-testid="item-aura-frame-art"
    />
    <slot v-else />
  </span>
</template>

<style scoped>
.xt-item-art {
  background: linear-gradient(
    160deg,
    rgba(28, 22, 12, 0.72),
    rgba(8, 9, 11, 0.92)
  );
}
</style>
