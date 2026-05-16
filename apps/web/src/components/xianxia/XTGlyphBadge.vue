<script setup lang="ts">
/**
 * Cửu Thiên Mộng — `XTGlyphBadge` (UI-3.1 quality badge).
 *
 * Badge nhỏ dạng "phong ấn vàng" — phẩm chất / phái / tag — render
 * `[ ❖ Phẩm Tiên ]` với:
 *   - Glyph trang trí ở cạnh trái.
 *   - Tone palette: gold (default) / jade / seal / smoke / mist / mute.
 *   - Variant: solid (background đậm) | line (chỉ viền).
 *   - Size: xs | sm (default) | md.
 *
 * Slot: text content nằm trong default slot, hoặc dùng prop `label`.
 */
withDefaults(
  defineProps<{
    label?: string;
    glyph?: string | null;
    tone?: 'gold' | 'jade' | 'seal' | 'smoke' | 'mist' | 'mute';
    variant?: 'solid' | 'line';
    size?: 'xs' | 'sm' | 'md';
    testId?: string;
  }>(),
  {
    label: '',
    glyph: '❖',
    tone: 'gold',
    variant: 'solid',
    size: 'sm',
    testId: 'xt-glyph-badge',
  },
);
</script>

<template>
  <span
    class="xt-glyph-badge"
    :class="[
      `xt-glyph-badge--${tone}`,
      `xt-glyph-badge--${variant}`,
      `xt-glyph-badge--size-${size}`,
    ]"
    :data-testid="testId"
  >
    <span
      v-if="glyph"
      class="xt-glyph-badge__glyph"
      aria-hidden="true"
    >{{ glyph }}</span>
    <span class="xt-glyph-badge__text">
      <slot>{{ label }}</slot>
    </span>
  </span>
</template>

<style scoped>
.xt-glyph-badge {
  position: relative;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  border-radius: 999px;
  font-family: var(--xt-font-decorative), var(--xt-font-display), serif;
  font-weight: 600;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  line-height: 1;
  white-space: nowrap;
  background: var(--badge-bg, rgba(242, 215, 137, 0.12));
  color: var(--badge-text, var(--xt-gold-bright, #f2d789));
  border: 1px solid var(--badge-border, rgba(242, 215, 137, 0.4));
  box-shadow:
    inset 0 1px 0 rgba(255, 246, 224, 0.08),
    0 0 0 1px rgba(0, 0, 0, 0.25);
  transition: filter 200ms ease;
}

.xt-glyph-badge--size-xs {
  padding: 2px 8px;
  font-size: 9px;
}
.xt-glyph-badge--size-sm {
  padding: 3px 10px;
  font-size: 10px;
}
.xt-glyph-badge--size-md {
  padding: 4px 12px;
  font-size: 11px;
}

.xt-glyph-badge__glyph {
  display: inline-block;
  font-size: 0.95em;
  line-height: 1;
  color: var(--badge-glyph, var(--xt-gold-bright, #f2d789));
  text-shadow: 0 0 4px var(--badge-glow, rgba(242, 215, 137, 0.5));
}

.xt-glyph-badge__text {
  display: inline-block;
}

.xt-glyph-badge--line {
  background: transparent;
  box-shadow: inset 0 0 0 1px rgba(0, 0, 0, 0.25);
}

/* Tone palettes */
.xt-glyph-badge--gold {
  --badge-bg: linear-gradient(
    180deg,
    rgba(74, 59, 24, 0.55) 0%,
    rgba(28, 22, 10, 0.7) 100%
  );
  --badge-border: rgba(242, 215, 137, 0.55);
  --badge-text: var(--xt-gold-bright, #f2d789);
  --badge-glyph: var(--xt-gold-bright, #f2d789);
  --badge-glow: rgba(242, 215, 137, 0.55);
}
.xt-glyph-badge--jade {
  --badge-bg: linear-gradient(
    180deg,
    rgba(27, 59, 52, 0.55) 0%,
    rgba(10, 22, 19, 0.7) 100%
  );
  --badge-border: rgba(95, 227, 198, 0.55);
  --badge-text: var(--xt-jade-bright, #5fe3c6);
  --badge-glyph: var(--xt-jade-bright, #5fe3c6);
  --badge-glow: rgba(95, 227, 198, 0.55);
}
.xt-glyph-badge--seal {
  --badge-bg: linear-gradient(
    180deg,
    rgba(58, 22, 22, 0.6) 0%,
    rgba(22, 10, 10, 0.78) 100%
  );
  --badge-border: rgba(208, 79, 79, 0.55);
  --badge-text: var(--xt-seal-bright, #f47272);
  --badge-glyph: var(--xt-seal-bright, #f47272);
  --badge-glow: rgba(208, 79, 79, 0.5);
}
.xt-glyph-badge--smoke {
  --badge-bg: linear-gradient(
    180deg,
    rgba(35, 30, 64, 0.55) 0%,
    rgba(14, 12, 28, 0.78) 100%
  );
  --badge-border: rgba(169, 159, 212, 0.55);
  --badge-text: var(--xt-smoke-bright, #c8c0e6);
  --badge-glyph: var(--xt-smoke-bright, #c8c0e6);
  --badge-glow: rgba(169, 159, 212, 0.5);
}
.xt-glyph-badge--mist {
  --badge-bg: linear-gradient(
    180deg,
    rgba(28, 44, 56, 0.55) 0%,
    rgba(10, 18, 24, 0.78) 100%
  );
  --badge-border: rgba(185, 214, 232, 0.55);
  --badge-text: var(--xt-mist-bright, #cee3ee);
  --badge-glyph: var(--xt-mist-bright, #cee3ee);
  --badge-glow: rgba(185, 214, 232, 0.5);
}
.xt-glyph-badge--mute {
  --badge-bg: linear-gradient(
    180deg,
    rgba(35, 41, 50, 0.55) 0%,
    rgba(14, 19, 24, 0.78) 100%
  );
  --badge-border: rgba(185, 175, 161, 0.4);
  --badge-text: var(--xt-text-muted, #b9b1a2);
  --badge-glyph: var(--xt-text-muted, #b9b1a2);
  --badge-glow: rgba(185, 175, 161, 0.3);
}
</style>
