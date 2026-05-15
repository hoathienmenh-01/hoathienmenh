<script setup lang="ts">
/**
 * Cửu Thiên Mộng — `EquipmentArtCell`.
 *
 * Khung thumbnail vuông dùng để hiển thị ảnh trang bị (từ public/equipment/)
 * trong inventory grid, loadout slot và tooltip item. Nếu không có ảnh (slot
 * không thuộc 8 slot có ảnh, hoặc item chưa có equipmentTier), render
 * placeholder rune.
 *
 * Khung tuân theo phong cách "khung son" (gold rim + ink background +
 * subtle inner shadow). Khi `equipped=true`, thêm vành đai jade glow.
 */
import { computed } from 'vue';
import { getEquipmentImage, type EquipmentArtName } from '@xuantoi/shared';

const props = withDefaults(
  defineProps<{
    /** Equipment slot key (WEAPON / ARMOR / HAT / ...). Avoid name `slot`
     *  (conflicts with the deprecated Vue 2 `slot=` attribute). */
    equipSlot?: string | null;
    artName?: EquipmentArtName | null;
    tier?: number | null;
    /** 'sm' (40-72px) hoặc 'lg' (96-128px). Mặc định 'sm'. */
    size?: 'sm' | 'md' | 'lg';
    /** Path tuyệt đối khác (override mọi mapping). */
    src?: string | null;
    /** Tooltip / aria text. */
    alt?: string | null;
    /** Hiện vành jade glow khi item đang equip. */
    equipped?: boolean;
    /** Hiện text tier nhỏ ở góc phải dưới. */
    showTier?: boolean;
    /** Glyph fallback (ký tự rune) khi không có ảnh. Mặc định "宝". */
    fallbackGlyph?: string;
  }>(),
  {
    equipSlot: null,
    artName: null,
    tier: null,
    size: 'sm',
    src: null,
    alt: null,
    equipped: false,
    showTier: false,
    fallbackGlyph: '宝',
  },
);

const resolved = computed(() => {
  if (props.src) {
    return {
      url: props.src,
      tier: props.tier ?? null,
    };
  }
  const artSize = props.size === 'lg' ? 'md' : 'sm';
  const img = getEquipmentImage({
    slot: props.equipSlot,
    artName: props.artName,
    tier: props.tier,
    size: artSize,
  });
  return img ? { url: img.url, tier: img.tier } : null;
});

const sizeClass = computed(() => {
  if (props.size === 'lg') return 'h-24 w-24 sm:h-28 sm:w-28';
  if (props.size === 'md') return 'h-16 w-16';
  return 'h-12 w-12';
});
</script>

<template>
  <div
    class="xt-equip-art relative shrink-0 overflow-hidden rounded-md border"
    :class="[
      sizeClass,
      equipped ? 'xt-equip-art--equipped' : '',
    ]"
    data-testid="equipment-art-cell"
  >
    <img
      v-if="resolved"
      :src="resolved.url"
      :alt="alt ?? ''"
      loading="lazy"
      decoding="async"
      class="h-full w-full object-cover"
      data-testid="equipment-art-image"
    />
    <span v-else class="xt-equip-art__glyph" aria-hidden="true">
      {{ fallbackGlyph }}
    </span>
    <span
      v-if="showTier && resolved && resolved.tier"
      class="xt-equip-art__tier"
      data-testid="equipment-art-tier"
    >
      T{{ resolved.tier }}
    </span>
  </div>
</template>

<style scoped>
.xt-equip-art {
  background:
    radial-gradient(
      circle at 30% 25%,
      rgba(95, 227, 198, 0.18) 0%,
      rgba(8, 9, 11, 0.95) 70%
    ),
    linear-gradient(155deg, rgba(28, 22, 12, 0.95), rgba(8, 9, 11, 0.92));
  border-color: var(--xt-border-gold, rgba(201, 164, 90, 0.6));
  box-shadow:
    inset 0 0 0 1px rgba(255, 246, 224, 0.06),
    0 2px 6px rgba(0, 0, 0, 0.6),
    0 0 14px rgba(201, 164, 90, 0.18);
}

.xt-equip-art--equipped {
  border-color: var(--xt-jade-bright, #5fe3c6);
  box-shadow:
    inset 0 0 0 1px rgba(95, 227, 198, 0.25),
    0 0 18px rgba(95, 227, 198, 0.45),
    0 2px 6px rgba(0, 0, 0, 0.55);
}

.xt-equip-art__glyph {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  font-family: var(--xt-font-decorative, 'Ma Shan Zheng', serif);
  font-size: 1.5rem;
  color: var(--xt-gold-bright, #f2d789);
  opacity: 0.75;
  text-shadow: 0 0 6px rgba(201, 164, 90, 0.55);
}

.xt-equip-art__tier {
  position: absolute;
  right: 2px;
  bottom: 2px;
  padding: 1px 6px;
  border-radius: 4px;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.06em;
  color: var(--xt-gold-bright, #f2d789);
  background: rgba(8, 9, 11, 0.78);
  border: 1px solid rgba(201, 164, 90, 0.45);
  text-shadow: 0 0 4px rgba(201, 164, 90, 0.55);
}
</style>
