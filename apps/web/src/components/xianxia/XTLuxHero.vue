<script setup lang="ts">
/**
 * Cửu Thiên Mộng — `XTLuxHero` (UI-3.1 luxury hero).
 *
 * Hero header cao cấp dùng cho top-tier view (Dashboard / Cultivation /
 * Boss / Profile / Sect / Market / Settings). Mục tiêu: cảm giác "sảnh
 * đường tiên môn" — backdrop có chiều sâu, viền kép vàng / ngọc, watermark
 * decorative cỡ lớn ở góc, eyebrow caps + title display + tagline + action
 * slot bên phải.
 *
 * Props:
 *   - `eyebrow`: caps thuần Việt (uppercase, decorative font).
 *   - `label`: label phụ sau dấu `·`.
 *   - `title`: tiêu đề chính.
 *   - `subtitle`: dòng mô tả ngắn.
 *   - `tone`: jade / gold / seal / smoke / mist — phối màu glow + viền.
 *   - `watermarkLetter`: 1 ký tự thuần Việt làm watermark lớn (D, T, Đ…).
 *   - `breadcrumb`: text breadcrumb nhỏ ở trên cùng (optional).
 *   - `align`: `start` (default) | `center`.
 *
 * Slots:
 *   - default: action area bên phải (button row).
 *   - `meta`: chip / badge row dưới title.
 */
import { computed } from 'vue';

const props = withDefaults(
  defineProps<{
    eyebrow?: string | null;
    label?: string | null;
    title: string;
    subtitle?: string | null;
    tone?: 'jade' | 'gold' | 'seal' | 'smoke' | 'mist';
    watermarkLetter?: string | null;
    breadcrumb?: string | null;
    align?: 'start' | 'center';
    testId?: string;
  }>(),
  {
    eyebrow: null,
    label: null,
    subtitle: null,
    tone: 'gold',
    watermarkLetter: null,
    breadcrumb: null,
    align: 'start',
    testId: 'xt-lux-hero',
  },
);

const HAN_RE = /[\u4e00-\u9fff]/;

const safeWatermark = computed<string | null>(() => {
  const w = props.watermarkLetter;
  if (!w) return null;
  if (HAN_RE.test(w)) return null;
  return w.slice(0, 1);
});
</script>

<template>
  <section
    class="xt-lux-hero"
    :class="[`xt-lux-hero--${tone}`, `xt-lux-hero--align-${align}`]"
    :data-testid="testId"
  >
    <div class="xt-lux-hero__backdrop" aria-hidden="true" />
    <div class="xt-lux-hero__border" aria-hidden="true" />
    <div class="xt-lux-hero__corner xt-lux-hero__corner--tl" aria-hidden="true" />
    <div class="xt-lux-hero__corner xt-lux-hero__corner--tr" aria-hidden="true" />
    <div class="xt-lux-hero__corner xt-lux-hero__corner--bl" aria-hidden="true" />
    <div class="xt-lux-hero__corner xt-lux-hero__corner--br" aria-hidden="true" />

    <span
      v-if="safeWatermark"
      class="xt-lux-hero__watermark"
      aria-hidden="true"
      :data-testid="`${testId}-watermark`"
    >{{ safeWatermark }}</span>

    <div class="xt-lux-hero__body">
      <p
        v-if="breadcrumb"
        class="xt-lux-hero__breadcrumb"
        :data-testid="`${testId}-breadcrumb`"
      >
        {{ breadcrumb }}
      </p>
      <p
        v-if="eyebrow || label"
        class="xt-lux-hero__eyebrow"
        :data-testid="`${testId}-eyebrow`"
      >
        <span aria-hidden="true" class="xt-lux-hero__rule" />
        <span v-if="eyebrow" class="xt-lux-hero__caps">{{ eyebrow }}</span>
        <span v-if="eyebrow && label" aria-hidden="true" class="xt-lux-hero__dot">·</span>
        <span v-if="label" class="xt-lux-hero__label">{{ label }}</span>
      </p>

      <h1 class="xt-lux-hero__title" :data-testid="`${testId}-title`">
        {{ title }}
      </h1>

      <p
        v-if="subtitle"
        class="xt-lux-hero__subtitle"
        :data-testid="`${testId}-subtitle`"
      >
        {{ subtitle }}
      </p>

      <div v-if="$slots.meta" class="xt-lux-hero__meta">
        <slot name="meta" />
      </div>
    </div>

    <div v-if="$slots.default" class="xt-lux-hero__actions">
      <slot />
    </div>
  </section>
</template>

<style scoped>
.xt-lux-hero {
  position: relative;
  isolation: isolate;
  overflow: hidden;
  border-radius: var(--xt-radius-xl, 28px);
  padding: clamp(20px, 3.6vw, 32px) clamp(20px, 3vw, 36px);
  display: flex;
  flex-direction: column;
  gap: 16px;
  min-height: 148px;
  box-shadow: var(--xt-shadow-depth-hero);
}

.xt-lux-hero--align-start {
  align-items: flex-start;
}
.xt-lux-hero--align-center {
  align-items: center;
  text-align: center;
}

@media (min-width: 720px) {
  .xt-lux-hero {
    flex-direction: row;
    align-items: flex-end;
    justify-content: space-between;
    gap: 24px;
  }
}

.xt-lux-hero__body {
  position: relative;
  z-index: 2;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
  flex: 1 1 auto;
}

.xt-lux-hero__actions {
  position: relative;
  z-index: 2;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px;
}

.xt-lux-hero__backdrop {
  position: absolute;
  inset: 0;
  z-index: 0;
  background:
    radial-gradient(
      120% 100% at 0% 0%,
      var(--hero-glow-a, rgba(242, 215, 137, 0.18)) 0%,
      transparent 55%
    ),
    radial-gradient(
      100% 90% at 100% 100%,
      var(--hero-glow-b, rgba(95, 227, 198, 0.16)) 0%,
      transparent 60%
    ),
    linear-gradient(
      135deg,
      rgba(20, 28, 38, 0.88) 0%,
      rgba(14, 19, 24, 0.92) 60%,
      rgba(8, 9, 11, 0.94) 100%
    );
}

.xt-lux-hero__border {
  position: absolute;
  inset: 4px;
  z-index: 1;
  border-radius: calc(var(--xt-radius-xl, 28px) - 4px);
  pointer-events: none;
  border: 1px solid var(--hero-border, rgba(242, 215, 137, 0.4));
  box-shadow:
    inset 0 0 0 1px rgba(242, 215, 137, 0.1),
    inset 0 0 36px var(--hero-glow-inner, rgba(242, 215, 137, 0.08));
}

.xt-lux-hero__corner {
  position: absolute;
  z-index: 1;
  width: 22px;
  height: 22px;
  pointer-events: none;
  background:
    linear-gradient(
      135deg,
      var(--hero-border, rgba(242, 215, 137, 0.7)) 0%,
      transparent 70%
    );
  -webkit-mask: linear-gradient(
    135deg,
    rgba(0, 0, 0, 1) 0 2px,
    transparent 2px 100%
  ),
  linear-gradient(45deg, rgba(0, 0, 0, 1) 0 2px, transparent 2px 100%);
          mask: linear-gradient(
    135deg,
    rgba(0, 0, 0, 1) 0 2px,
    transparent 2px 100%
  ),
  linear-gradient(45deg, rgba(0, 0, 0, 1) 0 2px, transparent 2px 100%);
  -webkit-mask-composite: source-over;
}
.xt-lux-hero__corner--tl {
  top: 8px;
  left: 8px;
  border-top: 2px solid var(--hero-border, rgba(242, 215, 137, 0.7));
  border-left: 2px solid var(--hero-border, rgba(242, 215, 137, 0.7));
  background: transparent;
  -webkit-mask: none;
          mask: none;
}
.xt-lux-hero__corner--tr {
  top: 8px;
  right: 8px;
  border-top: 2px solid var(--hero-border, rgba(242, 215, 137, 0.7));
  border-right: 2px solid var(--hero-border, rgba(242, 215, 137, 0.7));
  background: transparent;
  -webkit-mask: none;
          mask: none;
}
.xt-lux-hero__corner--bl {
  bottom: 8px;
  left: 8px;
  border-bottom: 2px solid var(--hero-border, rgba(242, 215, 137, 0.7));
  border-left: 2px solid var(--hero-border, rgba(242, 215, 137, 0.7));
  background: transparent;
  -webkit-mask: none;
          mask: none;
}
.xt-lux-hero__corner--br {
  bottom: 8px;
  right: 8px;
  border-bottom: 2px solid var(--hero-border, rgba(242, 215, 137, 0.7));
  border-right: 2px solid var(--hero-border, rgba(242, 215, 137, 0.7));
  background: transparent;
  -webkit-mask: none;
          mask: none;
}

.xt-lux-hero__watermark {
  position: absolute;
  top: 50%;
  right: -8px;
  z-index: 0;
  transform: translateY(-50%);
  font-family: var(--xt-font-decorative), var(--xt-font-display), serif;
  font-size: clamp(120px, 18vw, 220px);
  line-height: 0.85;
  color: var(--hero-watermark, rgba(242, 215, 137, 0.13));
  letter-spacing: 0;
  pointer-events: none;
  user-select: none;
  filter: blur(0.3px);
}

.xt-lux-hero__breadcrumb {
  font-family: var(--xt-font-body);
  font-size: 11px;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: var(--xt-text-muted, #b9b1a2);
  margin-bottom: 2px;
}

.xt-lux-hero__eyebrow {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 11px;
  letter-spacing: 0.32em;
  text-transform: uppercase;
  color: var(--hero-eyebrow, var(--xt-jade-bright, #5fe3c6));
  margin: 0;
}

.xt-lux-hero__rule {
  display: inline-block;
  width: 36px;
  height: 1px;
  background: linear-gradient(
    90deg,
    transparent 0%,
    var(--hero-border, rgba(242, 215, 137, 0.7)) 50%,
    transparent 100%
  );
}

.xt-lux-hero__caps {
  font-family: var(--xt-font-decorative), var(--xt-font-display), serif;
  font-weight: 600;
  letter-spacing: 0.22em;
  color: var(--hero-caps, var(--xt-gold-bright, #f2d789));
  text-shadow: 0 0 12px rgba(242, 215, 137, 0.28);
}

.xt-lux-hero__dot {
  color: var(--hero-caps, var(--xt-gold-bright, #f2d789));
  opacity: 0.7;
}

.xt-lux-hero__label {
  font-family: var(--xt-font-body);
  letter-spacing: 0.28em;
}

.xt-lux-hero__title {
  font-family: var(--xt-font-display), serif;
  font-weight: 600;
  font-size: clamp(28px, 4.4vw, 44px);
  line-height: 1.08;
  letter-spacing: 0.02em;
  color: var(--xt-scroll-paper-bright, #fff6e0);
  margin: 8px 0 0;
  text-shadow:
    0 1px 0 rgba(0, 0, 0, 0.4),
    0 0 24px rgba(242, 215, 137, 0.18);
  background: linear-gradient(
    180deg,
    var(--xt-scroll-paper-bright, #fff6e0) 0%,
    var(--xt-gold-bright, #f2d789) 100%
  );
  -webkit-background-clip: text;
          background-clip: text;
  color: transparent;
  -webkit-text-fill-color: transparent;
}

.xt-lux-hero__subtitle {
  font-family: var(--xt-font-body);
  font-size: 13px;
  line-height: 1.5;
  color: var(--xt-text-muted, #b9b1a2);
  margin: 0;
  max-width: 64ch;
}

.xt-lux-hero__meta {
  margin-top: 12px;
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

/* Tone palettes — control border, glow corners, watermark + eyebrow colour. */
.xt-lux-hero--gold {
  --hero-border: rgba(242, 215, 137, 0.55);
  --hero-glow-a: rgba(242, 215, 137, 0.22);
  --hero-glow-b: rgba(208, 79, 79, 0.14);
  --hero-glow-inner: rgba(242, 215, 137, 0.12);
  --hero-watermark: rgba(242, 215, 137, 0.13);
  --hero-eyebrow: var(--xt-gold-bright, #f2d789);
  --hero-caps: var(--xt-gold-bright, #f2d789);
}

.xt-lux-hero--jade {
  --hero-border: rgba(95, 227, 198, 0.5);
  --hero-glow-a: rgba(95, 227, 198, 0.2);
  --hero-glow-b: rgba(242, 215, 137, 0.12);
  --hero-glow-inner: rgba(95, 227, 198, 0.12);
  --hero-watermark: rgba(95, 227, 198, 0.14);
  --hero-eyebrow: var(--xt-jade-bright, #5fe3c6);
  --hero-caps: var(--xt-gold-bright, #f2d789);
}

.xt-lux-hero--seal {
  --hero-border: rgba(208, 79, 79, 0.55);
  --hero-glow-a: rgba(208, 79, 79, 0.22);
  --hero-glow-b: rgba(242, 215, 137, 0.14);
  --hero-glow-inner: rgba(208, 79, 79, 0.14);
  --hero-watermark: rgba(208, 79, 79, 0.16);
  --hero-eyebrow: rgba(255, 246, 224, 0.9);
  --hero-caps: var(--xt-seal-bright, #d04f4f);
}

.xt-lux-hero--smoke {
  --hero-border: rgba(169, 159, 212, 0.5);
  --hero-glow-a: rgba(169, 159, 212, 0.2);
  --hero-glow-b: rgba(95, 227, 198, 0.12);
  --hero-glow-inner: rgba(169, 159, 212, 0.14);
  --hero-watermark: rgba(169, 159, 212, 0.16);
  --hero-eyebrow: var(--xt-smoke-bright, #a99fd4);
  --hero-caps: var(--xt-gold-bright, #f2d789);
}

.xt-lux-hero--mist {
  --hero-border: rgba(185, 214, 232, 0.5);
  --hero-glow-a: rgba(185, 214, 232, 0.2);
  --hero-glow-b: rgba(242, 215, 137, 0.14);
  --hero-glow-inner: rgba(185, 214, 232, 0.12);
  --hero-watermark: rgba(185, 214, 232, 0.16);
  --hero-eyebrow: var(--xt-mist-bright, #b9d6e8);
  --hero-caps: var(--xt-gold-bright, #f2d789);
}

@media (prefers-reduced-motion: reduce) {
  .xt-lux-hero {
    transition: none;
  }
}
</style>
