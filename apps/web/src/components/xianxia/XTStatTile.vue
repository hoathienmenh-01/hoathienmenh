<script setup lang="ts">
/**
 * Cửu Thiên Mộng — `XTStatTile` (UI-3.1 luxury stat).
 *
 * Stat tile cao cấp với:
 *   - glyph icon trái có nền lacquer + viền vàng,
 *   - eyebrow caps uppercase mảnh ở trên,
 *   - giá trị lớn dùng gold gradient text (hoặc tone tương ứng),
 *   - delta (tuỳ chọn) chip màu jade/seal,
 *   - dòng description nhỏ mô tả ngữ cảnh,
 *   - viền gradient + glow trên hover (interactive).
 *
 * Props:
 *   - `eyebrow` (optional)
 *   - `label` — luôn cần.
 *   - `value` — string | number.
 *   - `description` (optional).
 *   - `delta` (optional) — chuỗi như "+12 %", "−8".
 *   - `deltaTone`: `up` | `down` | `neutral` (default neutral).
 *   - `icon`: tên GameIcon (optional).
 *   - `tone`: `gold` | `jade` | `seal` | `smoke` | `mist`.
 *   - `interactive` — bật hover lift + glow.
 */
import GameIcon from './GameIcon.vue';

withDefaults(
  defineProps<{
    eyebrow?: string | null;
    label: string;
    value: string | number;
    description?: string | null;
    delta?: string | null;
    deltaTone?: 'up' | 'down' | 'neutral';
    icon?: string | null;
    tone?: 'gold' | 'jade' | 'seal' | 'smoke' | 'mist';
    interactive?: boolean;
    testId?: string;
  }>(),
  {
    eyebrow: null,
    description: null,
    delta: null,
    deltaTone: 'neutral',
    icon: null,
    tone: 'gold',
    interactive: false,
    testId: 'xt-stat-tile',
  },
);
</script>

<template>
  <article
    class="xt-stat-tile"
    :class="[
      `xt-stat-tile--${tone}`,
      interactive ? 'xt-stat-tile--interactive' : '',
    ]"
    :data-testid="testId"
  >
    <div class="xt-stat-tile__border" aria-hidden="true" />
    <div class="xt-stat-tile__glow" aria-hidden="true" />

    <header class="xt-stat-tile__head">
      <div v-if="icon" class="xt-stat-tile__icon" aria-hidden="true">
        <GameIcon :name="icon" size="sm" />
      </div>
      <div class="min-w-0 flex-1">
        <p v-if="eyebrow" class="xt-stat-tile__eyebrow">{{ eyebrow }}</p>
        <p class="xt-stat-tile__label">{{ label }}</p>
      </div>
      <span
        v-if="delta"
        class="xt-stat-tile__delta"
        :class="`xt-stat-tile__delta--${deltaTone}`"
        :data-testid="`${testId}-delta`"
      >{{ delta }}</span>
    </header>

    <p class="xt-stat-tile__value" :data-testid="`${testId}-value`">
      {{ value }}
    </p>

    <p
      v-if="description"
      class="xt-stat-tile__description"
      :data-testid="`${testId}-description`"
    >
      {{ description }}
    </p>
  </article>
</template>

<style scoped>
.xt-stat-tile {
  position: relative;
  isolation: isolate;
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
  padding: 14px 16px 16px;
  border-radius: var(--xt-radius-lg, 20px);
  background:
    linear-gradient(
      180deg,
      rgba(36, 46, 58, 0.78) 0%,
      rgba(20, 28, 38, 0.92) 100%
    );
  box-shadow: var(--xt-shadow-depth-1);
  transition:
    transform var(--xt-motion-base, 220ms) var(--xt-ease-soft, ease),
    box-shadow var(--xt-motion-base, 220ms) var(--xt-ease-soft, ease);
}

.xt-stat-tile__border {
  position: absolute;
  inset: 0;
  border-radius: inherit;
  padding: 1px;
  background: linear-gradient(
    180deg,
    var(--tile-border, rgba(242, 215, 137, 0.5)) 0%,
    var(--tile-border-fade, rgba(242, 215, 137, 0.08)) 100%
  );
  -webkit-mask:
    linear-gradient(#000 0 0) content-box,
    linear-gradient(#000 0 0);
  -webkit-mask-composite: xor;
          mask-composite: exclude;
  pointer-events: none;
  z-index: 1;
}

.xt-stat-tile__glow {
  position: absolute;
  inset: -1px;
  border-radius: inherit;
  background: radial-gradient(
    120% 80% at 50% 0%,
    var(--tile-glow, rgba(242, 215, 137, 0.16)) 0%,
    transparent 70%
  );
  pointer-events: none;
  z-index: 0;
  opacity: 0.95;
}

.xt-stat-tile__head {
  position: relative;
  z-index: 2;
  display: flex;
  align-items: center;
  gap: 10px;
}

.xt-stat-tile__icon {
  width: 36px;
  height: 36px;
  border-radius: 10px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: linear-gradient(
    135deg,
    rgba(58, 46, 24, 0.85) 0%,
    rgba(20, 28, 38, 0.92) 100%
  );
  border: 1px solid var(--tile-border, rgba(242, 215, 137, 0.45));
  box-shadow:
    inset 0 1px 0 rgba(255, 246, 224, 0.12),
    0 4px 10px rgba(0, 0, 0, 0.4);
  flex: 0 0 auto;
}

.xt-stat-tile__eyebrow {
  font-size: 10px;
  letter-spacing: 0.28em;
  text-transform: uppercase;
  color: var(--tile-eyebrow, var(--xt-jade-bright, #5fe3c6));
  margin: 0 0 2px;
}

.xt-stat-tile__label {
  font-size: 12px;
  letter-spacing: 0.06em;
  color: var(--xt-text-muted, #b9b1a2);
  margin: 0;
}

.xt-stat-tile__delta {
  flex: 0 0 auto;
  font-family: var(--xt-font-mono);
  font-size: 11px;
  font-weight: 600;
  padding: 3px 8px;
  border-radius: 999px;
  background: rgba(20, 28, 38, 0.7);
  border: 1px solid rgba(242, 215, 137, 0.15);
}
.xt-stat-tile__delta--up {
  color: var(--xt-jade-bright, #5fe3c6);
  border-color: rgba(95, 227, 198, 0.4);
}
.xt-stat-tile__delta--down {
  color: var(--xt-seal-bright, #d04f4f);
  border-color: rgba(208, 79, 79, 0.4);
}

.xt-stat-tile__value {
  position: relative;
  z-index: 2;
  font-family: var(--xt-font-display), serif;
  font-weight: 600;
  font-size: clamp(26px, 3.4vw, 34px);
  letter-spacing: -0.01em;
  line-height: 1.05;
  margin: 6px 0 0;
  background: linear-gradient(
    180deg,
    var(--tile-value-top, #fff6e0) 0%,
    var(--tile-value-bottom, #f2d789) 100%
  );
  -webkit-background-clip: text;
          background-clip: text;
  color: transparent;
  -webkit-text-fill-color: transparent;
  text-shadow: 0 0 18px var(--tile-value-glow, rgba(242, 215, 137, 0.16));
}

.xt-stat-tile__description {
  position: relative;
  z-index: 2;
  font-size: 12px;
  line-height: 1.4;
  color: var(--xt-text-subtle, #8b8473);
  margin: 4px 0 0;
}

/* Tone palettes — change border, glow, and value gradient. */
.xt-stat-tile--gold {
  --tile-border: rgba(242, 215, 137, 0.55);
  --tile-border-fade: rgba(242, 215, 137, 0.06);
  --tile-glow: rgba(242, 215, 137, 0.16);
  --tile-eyebrow: var(--xt-gold-bright, #f2d789);
  --tile-value-top: #fff6e0;
  --tile-value-bottom: #f2d789;
  --tile-value-glow: rgba(242, 215, 137, 0.22);
}
.xt-stat-tile--jade {
  --tile-border: rgba(95, 227, 198, 0.5);
  --tile-border-fade: rgba(95, 227, 198, 0.06);
  --tile-glow: rgba(95, 227, 198, 0.16);
  --tile-eyebrow: var(--xt-jade-bright, #5fe3c6);
  --tile-value-top: #d8fff3;
  --tile-value-bottom: #5fe3c6;
  --tile-value-glow: rgba(95, 227, 198, 0.22);
}
.xt-stat-tile--seal {
  --tile-border: rgba(208, 79, 79, 0.55);
  --tile-border-fade: rgba(208, 79, 79, 0.06);
  --tile-glow: rgba(208, 79, 79, 0.16);
  --tile-eyebrow: var(--xt-seal-bright, #d04f4f);
  --tile-value-top: #ffe2d8;
  --tile-value-bottom: #d04f4f;
  --tile-value-glow: rgba(208, 79, 79, 0.22);
}
.xt-stat-tile--smoke {
  --tile-border: rgba(169, 159, 212, 0.55);
  --tile-border-fade: rgba(169, 159, 212, 0.06);
  --tile-glow: rgba(169, 159, 212, 0.16);
  --tile-eyebrow: var(--xt-smoke-bright, #a99fd4);
  --tile-value-top: #ece6ff;
  --tile-value-bottom: #a99fd4;
  --tile-value-glow: rgba(169, 159, 212, 0.22);
}
.xt-stat-tile--mist {
  --tile-border: rgba(185, 214, 232, 0.55);
  --tile-border-fade: rgba(185, 214, 232, 0.06);
  --tile-glow: rgba(185, 214, 232, 0.16);
  --tile-eyebrow: var(--xt-mist-bright, #b9d6e8);
  --tile-value-top: #e8f3fb;
  --tile-value-bottom: #b9d6e8;
  --tile-value-glow: rgba(185, 214, 232, 0.22);
}

.xt-stat-tile--interactive {
  cursor: pointer;
}
.xt-stat-tile--interactive:hover,
.xt-stat-tile--interactive:focus-visible {
  transform: translateY(-2px);
  box-shadow: var(--xt-shadow-depth-2), 0 0 24px var(--tile-glow, rgba(242, 215, 137, 0.18));
}

@media (prefers-reduced-motion: reduce) {
  .xt-stat-tile {
    transition: none;
  }
  .xt-stat-tile--interactive:hover {
    transform: none;
  }
}
</style>
