<script setup lang="ts">
/**
 * Phase 42.0 — Rare drop popup (single instance).
 *
 * Hiển thị khi drop một item rarity ≥ RARE. Tự auto-dismiss nếu caller
 * dùng `useEffectQueue`. Reduced-motion: static card.
 */
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import {
  getEffectOrFallback,
  type VisualEffectElement,
  type VisualEffectRarity,
} from '@xuantoi/shared';

const props = withDefaults(
  defineProps<{
    itemName: string;
    itemKey?: string | null;
    rarity: VisualEffectRarity;
    tier?: number | null;
    source?: string | null;
    iconUrl?: string | null;
    element?: VisualEffectElement | null;
    effectKey?: string;
    quantity?: number;
    message?: string | null;
    visualEffectLevel?: 'OFF' | 'LOW' | 'MEDIUM' | 'HIGH';
    reducedMotion?: boolean;
    testId?: string;
  }>(),
  {
    itemKey: null,
    tier: null,
    source: null,
    iconUrl: null,
    element: null,
    effectKey: undefined,
    quantity: 1,
    message: null,
    visualEffectLevel: 'MEDIUM',
    reducedMotion: false,
    testId: 'rare-drop-popup',
  },
);

const { t } = useI18n();

const resolvedEffect = computed(() => getEffectOrFallback(props.effectKey ?? rarityKey()));

function rarityKey(): string {
  switch (props.rarity) {
    case 'RARE':
      return 'RARE_DROP_RARE';
    case 'EPIC':
      return 'RARE_DROP_EPIC';
    case 'LEGENDARY':
      return 'RARE_DROP_LEGENDARY';
    case 'MYTHIC':
    case 'IMMORTAL':
      return 'RARE_DROP_MYTHIC';
    default:
      return 'NONE';
  }
}

const rarityClass = computed(() => {
  switch (props.rarity) {
    case 'RARE':
      return 'border-blue-300/60 text-blue-200';
    case 'EPIC':
      return 'border-purple-300/60 text-purple-200';
    case 'LEGENDARY':
      return 'border-amber-300/70 text-amber-200';
    case 'MYTHIC':
    case 'IMMORTAL':
      return 'border-fuchsia-300/70 text-fuchsia-200';
    default:
      return 'border-ink-300/40 text-ink-100';
  }
});

const containerClass = computed(() => {
  const parts = [
    'border rounded-md p-3 bg-ink-700/70 backdrop-blur-sm shadow-lg max-w-sm',
    rarityClass.value,
  ];
  if (!props.reducedMotion && props.visualEffectLevel !== 'OFF') {
    parts.push('ve-anim-rare-drop-pop');
    if (props.visualEffectLevel === 'HIGH') {
      parts.push('ve-anim-glow-subtle');
    }
  }
  return parts.join(' ');
});
</script>

<template>
  <div
    :class="containerClass"
    :data-testid="props.testId"
    :data-effect-key="resolvedEffect.key"
    :data-rarity="props.rarity"
    role="status"
  >
    <p class="text-xs uppercase tracking-wide opacity-80">
      {{ t('visualEffects.rareDrop.headline') }}
    </p>
    <p class="text-base font-semibold mt-0.5">
      {{ props.itemName }}
      <span v-if="props.quantity > 1" class="opacity-70">×{{ props.quantity }}</span>
    </p>
    <p v-if="props.source" class="text-xs mt-1 opacity-70">
      {{ t('visualEffects.rareDrop.source', { source: props.source }) }}
    </p>
    <p v-if="props.message" class="text-xs mt-1 opacity-80">{{ props.message }}</p>
  </div>
</template>
