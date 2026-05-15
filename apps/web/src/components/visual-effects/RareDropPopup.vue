<script setup lang="ts">
/**
 * Phase 42.0 — Rare drop popup (single instance).
 *
 * Hiển thị khi drop một item rarity ≥ RARE. Tự auto-dismiss nếu caller
 * dùng `useEffectQueue`. Reduced-motion: static card.
 */
import { computed, onMounted } from 'vue';
import { useI18n } from 'vue-i18n';
import {
  getEffectOrFallback,
  type VisualEffectElement,
  type VisualEffectRarity,
} from '@xuantoi/shared';
import { playSfxRareDrop } from '@/lib/sfx';

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
      return 'border-[var(--xt-border-mist)] text-[var(--xt-text-mist)]';
    case 'EPIC':
      return 'border-[var(--xt-border-smoke)] text-[var(--xt-smoke-bright)]';
    case 'LEGENDARY':
      return 'border-[var(--xt-border-gold)] text-[var(--xt-text-gold)]';
    case 'MYTHIC':
    case 'IMMORTAL':
      return 'border-[var(--xt-seal-bright)] text-[var(--xt-seal-bright)]';
    default:
      return 'border-ink-300/40 text-ink-100';
  }
});

const rarityRune = computed(() => {
  switch (props.rarity) {
    case 'RARE':
      return '珍';
    case 'EPIC':
      return '奇';
    case 'LEGENDARY':
      return '宝';
    case 'MYTHIC':
    case 'IMMORTAL':
      return '神';
    default:
      return '物';
  }
});

onMounted(() => {
  if (props.visualEffectLevel === 'OFF') return;
  playSfxRareDrop();
});

const containerClass = computed(() => {
  const parts = [
    'relative border-2 rounded-2xl p-4 backdrop-blur-sm shadow-2xl max-w-sm overflow-hidden',
    rarityClass.value,
  ];
  parts.push('bg-[var(--xt-ink-deep)]/85');
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
    style="
      background-image:
        radial-gradient(circle at 50% -10%, rgba(242, 215, 137, 0.16) 0%, transparent 55%),
        linear-gradient(180deg, rgba(28, 36, 46, 0.85) 0%, rgba(8, 9, 11, 0.92) 100%);
    "
  >
    <!-- Top silk ribbon -->
    <div
      aria-hidden="true"
      class="pointer-events-none absolute inset-x-3 -top-1 h-1.5 rounded-b-md"
      style="background: linear-gradient(90deg, transparent 0%, var(--xt-gold-bright) 50%, transparent 100%)"
    />
    <div class="flex items-start gap-3">
      <!-- Rune seal portrait -->
      <div
        class="shrink-0 flex items-center justify-center rounded-md border"
        :class="rarityClass"
        style="
          width: 52px;
          height: 52px;
          background: radial-gradient(circle, rgba(74, 59, 24, 0.42) 0%, rgba(11, 16, 24, 0.85) 80%);
          box-shadow: inset 0 0 8px rgba(242, 215, 137, 0.22);
          font-family: 'Ma Shan Zheng', 'Noto Serif SC', serif;
          font-size: 28px;
          line-height: 1;
        "
      >
        {{ rarityRune }}
      </div>
      <div class="min-w-0 flex-1">
        <p class="text-[10px] uppercase tracking-[0.32em] opacity-80">
          {{ t('visualEffects.rareDrop.headline') }}
        </p>
        <p class="text-base font-bold mt-0.5 truncate">
          {{ props.itemName }}
          <span v-if="props.quantity > 1" class="opacity-70">×{{ props.quantity }}</span>
        </p>
        <p v-if="props.source" class="text-xs mt-1 opacity-70">
          {{ t('visualEffects.rareDrop.source', { source: props.source }) }}
        </p>
        <p v-if="props.message" class="text-xs mt-1 opacity-80">{{ props.message }}</p>
      </div>
    </div>
  </div>
</template>
