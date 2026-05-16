<script setup lang="ts">
/**
 * XianxiaCard — luxury "thẻ ngọc" card primitive.
 *
 * Props:
 *  - `accent`: tone variant (jade | cyan | violet | gold | danger | seal).
 *    `seal` is an alias for `danger` (added for parity with XTLuxHero / XTStatTile tones).
 *  - `elevated`: hover lift + glow on pointer (default true).
 *  - `corners`: render 4 ornate corner accents (default true). Set to false
 *    on dense list rows to avoid noise.
 *  - `tight`: smaller padding for inventory rows / dense lists.
 */
withDefaults(
  defineProps<{
    accent?: 'jade' | 'cyan' | 'violet' | 'gold' | 'danger' | 'seal';
    elevated?: boolean;
    corners?: boolean;
    tight?: boolean;
  }>(),
  {
    accent: 'cyan',
    elevated: true,
    corners: true,
    tight: false,
  },
);
</script>

<template>
  <section
    class="xt-card border"
    :class="[
      tight ? 'xt-card--tight' : 'rounded-3xl p-4',
      `xt-card--${accent === 'seal' ? 'danger' : accent}`,
      elevated ? 'xt-card--elevated' : '',
      corners ? 'xt-card--corners' : '',
    ]"
  >
    <template v-if="corners">
      <span class="xt-card__corner xt-card__corner--tl" aria-hidden="true" />
      <span class="xt-card__corner xt-card__corner--tr" aria-hidden="true" />
      <span class="xt-card__corner xt-card__corner--bl" aria-hidden="true" />
      <span class="xt-card__corner xt-card__corner--br" aria-hidden="true" />
    </template>
    <slot />
  </section>
</template>

<style scoped>
.xt-card--tight {
  border-radius: 14px;
  padding: 10px 12px;
}

.xt-card__corner {
  position: absolute;
  width: 12px;
  height: 12px;
  z-index: 3;
  pointer-events: none;
  border: 1px solid var(--xt-card-corner, rgba(242, 215, 137, 0.55));
  border-radius: 2px;
  box-shadow: 0 0 6px var(--xt-card-corner-glow, rgba(242, 215, 137, 0.32));
  opacity: 0.85;
}
.xt-card__corner--tl {
  top: 8px;
  left: 8px;
  border-right: 0;
  border-bottom: 0;
}
.xt-card__corner--tr {
  top: 8px;
  right: 8px;
  border-left: 0;
  border-bottom: 0;
}
.xt-card__corner--bl {
  bottom: 8px;
  left: 8px;
  border-right: 0;
  border-top: 0;
}
.xt-card__corner--br {
  bottom: 8px;
  right: 8px;
  border-left: 0;
  border-top: 0;
}

/* Tone overrides for corner color/glow. */
.xt-card--jade .xt-card__corner {
  --xt-card-corner: rgba(95, 227, 198, 0.55);
  --xt-card-corner-glow: rgba(95, 227, 198, 0.32);
}
.xt-card--cyan .xt-card__corner {
  --xt-card-corner: rgba(185, 214, 232, 0.55);
  --xt-card-corner-glow: rgba(185, 214, 232, 0.28);
}
.xt-card--violet .xt-card__corner {
  --xt-card-corner: rgba(169, 159, 212, 0.55);
  --xt-card-corner-glow: rgba(169, 159, 212, 0.3);
}
.xt-card--gold .xt-card__corner {
  --xt-card-corner: rgba(242, 215, 137, 0.6);
  --xt-card-corner-glow: rgba(242, 215, 137, 0.35);
}
.xt-card--danger .xt-card__corner {
  --xt-card-corner: rgba(208, 79, 79, 0.6);
  --xt-card-corner-glow: rgba(208, 79, 79, 0.35);
}

@media (prefers-reduced-motion: reduce) {
  .xt-card__corner {
    box-shadow: none;
  }
}
</style>
