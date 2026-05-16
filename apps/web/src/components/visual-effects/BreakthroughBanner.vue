<script setup lang="ts">
/**
 * Phase 42.0 — Breakthrough banner.
 * Cửu Thiên Mộng — thêm overlay thiên kiếp full-screen khi success + HIGH.
 *
 * Hiển thị banner đột phá thành công/thất bại (luyện khí / luyện thể).
 * KHÔNG sửa cultivation formula. Tôn trọng reducedMotion + visualEffectLevel.
 */
import { computed, onMounted } from 'vue';
import { useI18n } from 'vue-i18n';
import { getEffectOrFallback } from '@xuantoi/shared';
import { playSfxBreakthrough, playSfxConfirm } from '@/lib/sfx';

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
  const parts: string[] = [
    'relative overflow-hidden rounded-lg p-4 max-w-md border backdrop-blur-sm',
  ];
  if (props.success) {
    parts.push(
      'border-[var(--xt-border-gold)] bg-[var(--xt-ink-deep)]/85 text-[var(--xt-text-gold)]',
    );
    if (!props.reducedMotion && props.visualEffectLevel === 'HIGH') {
      parts.push('ve-anim-breakthrough-glow');
    }
  } else {
    parts.push('border-[var(--xt-border-seal)] bg-[var(--xt-ink-deep)]/85 text-[var(--xt-text-seal)]');
  }
  return parts.join(' ');
});

const titleKey = computed(() =>
  props.success
    ? 'visualEffects.breakthrough.success'
    : 'visualEffects.breakthrough.failed',
);

/** Overlay thiên kiếp chỉ render khi success + HIGH effect level + không reduced-motion. */
const showThienKiep = computed(
  () =>
    props.success &&
    props.visualEffectLevel === 'HIGH' &&
    !props.reducedMotion,
);

onMounted(() => {
  if (props.visualEffectLevel === 'OFF') return;
  if (showThienKiep.value) {
    playSfxBreakthrough();
  } else if (props.success) {
    playSfxConfirm();
  }
});
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
    <!-- Seal corner stamps (gold) -->
    <span
      v-if="props.success"
      aria-hidden="true"
      class="pointer-events-none absolute -top-3 -right-3 h-12 w-12 rounded-full bg-[var(--xt-gold-soft)] blur-md"
    />

    <p class="text-base font-semibold uppercase tracking-[0.18em]">
      {{ t(titleKey) }}
    </p>
    <p v-if="props.characterName" class="text-sm mt-1 text-[var(--xt-text-primary)]">
      {{ props.characterName }}
    </p>
    <p v-if="props.fromRealm && props.toRealm" class="text-sm mt-0.5 text-[var(--xt-text-muted)]">
      {{ props.fromRealm }} → {{ props.toRealm }}
    </p>
    <p v-if="props.message" class="text-sm mt-2 opacity-90">{{ props.message }}</p>
    <p v-if="props.rewardSummary" class="text-xs mt-2 opacity-80">
      {{ props.rewardSummary }}
    </p>

    <!-- Thiên Kiếp overlay — chỉ render khi HIGH + success + không reduced-motion. -->
    <Teleport to="body">
      <div
        v-if="showThienKiep"
        class="fixed inset-0 z-[9999] pointer-events-none flex items-center justify-center ve-anim-thien-kiep-sky"
        data-testid="breakthrough-thien-kiep"
        aria-hidden="true"
      >
        <!-- Ink-wash sky backdrop -->
        <div
          class="absolute inset-0 ve-anim-thien-kiep-ink-fall"
          style="
            background:
              radial-gradient(circle at 50% 30%, rgba(7, 9, 14, 0.4) 0%, rgba(7, 9, 14, 0.92) 70%),
              linear-gradient(180deg, #0b1018 0%, #1a1f2e 100%);
          "
        />
        <!-- White-blue flash bursts -->
        <div
          class="absolute inset-0 ve-anim-thien-kiep-flash"
          style="background: radial-gradient(circle at 50% 40%, rgba(255, 255, 255, 0.85) 0%, rgba(170, 200, 255, 0.4) 35%, transparent 65%)"
        />
        <!-- Three lightning bolts as SVG (left / center / right) -->
        <svg
          class="absolute inset-0 h-full w-full ve-anim-thien-kiep-bolt"
          viewBox="0 0 100 100"
          preserveAspectRatio="xMidYMid slice"
          style="filter: drop-shadow(0 0 12px rgba(185, 214, 232, 0.95))"
        >
          <path
            d="M30 0 L26 38 L34 38 L20 100"
            fill="none"
            stroke="#e6f0ff"
            stroke-width="0.6"
            stroke-linecap="round"
          />
          <path
            d="M52 0 L46 30 L56 32 L40 60 L52 60 L42 100"
            fill="none"
            stroke="#ffffff"
            stroke-width="0.9"
            stroke-linecap="round"
          />
          <path
            d="M72 0 L66 42 L76 42 L60 100"
            fill="none"
            stroke="#e6f0ff"
            stroke-width="0.6"
            stroke-linecap="round"
          />
        </svg>
        <!-- Golden seal halo ring -->
        <div
          class="absolute h-40 w-40 rounded-full ve-anim-thien-kiep-ring"
          style="background: radial-gradient(circle, rgba(242, 215, 137, 0.65) 0%, rgba(242, 215, 137, 0) 70%)"
        />
        <!-- Central seal character -->
        <div
          class="relative ve-anim-thien-kiep-seal flex items-center justify-center"
          style="
            width: 200px;
            height: 200px;
            border: 2px solid var(--xt-gold-bright);
            border-radius: 24px;
            background: radial-gradient(circle, rgba(74, 59, 24, 0.7) 0%, rgba(11, 16, 24, 0.85) 70%);
            box-shadow: 0 0 80px rgba(242, 215, 137, 0.55), inset 0 0 40px rgba(242, 215, 137, 0.18);
          "
        >
          <span
            style="
              font-family: 'Cinzel', 'Cormorant Garamond', serif;
              font-size: 132px;
              line-height: 1;
              color: var(--xt-gold-bright);
              text-shadow: 0 0 24px rgba(242, 215, 137, 0.8), 0 0 8px rgba(255, 255, 255, 0.5);
            "
          >
            ✺
          </span>
        </div>
      </div>
    </Teleport>
  </div>
</template>
