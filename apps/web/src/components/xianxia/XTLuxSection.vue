<script setup lang="ts">
/**
 * Cửu Thiên Mộng — `XTLuxSection` (UI-3.1 luxury section).
 *
 * Wrapper section cao cấp với:
 *   - title eyebrow caps + label,
 *   - ornate divider (3 đoạn: line — diamond — line) trên đầu mỗi section,
 *   - tone glow nền nhẹ ở 2 góc,
 *   - actions slot bên phải header,
 *   - viền + radius có thể tắt qua `surface="none"` khi muốn dùng cho list dày đặc.
 *
 * Props:
 *   - `eyebrow` (optional caps).
 *   - `title` (optional bold display title).
 *   - `subtitle` (optional small description).
 *   - `tone`: jade / gold / seal / smoke / mist (default gold).
 *   - `surface`: 'card' (default) | 'bare' | 'panel'.
 *   - `padding`: 'tight' | 'normal' (default) | 'loose'.
 *
 * Slots:
 *   - default: nội dung section.
 *   - `actions`: action row bên phải header.
 */
withDefaults(
  defineProps<{
    eyebrow?: string | null;
    title?: string | null;
    subtitle?: string | null;
    tone?: 'jade' | 'gold' | 'seal' | 'smoke' | 'mist';
    surface?: 'card' | 'bare' | 'panel';
    padding?: 'tight' | 'normal' | 'loose';
    testId?: string;
  }>(),
  {
    eyebrow: null,
    title: null,
    subtitle: null,
    tone: 'gold',
    surface: 'card',
    padding: 'normal',
    testId: 'xt-lux-section',
  },
);
</script>

<template>
  <section
    class="xt-lux-section"
    :class="[
      `xt-lux-section--${tone}`,
      `xt-lux-section--surface-${surface}`,
      `xt-lux-section--pad-${padding}`,
    ]"
    :data-testid="testId"
  >
    <header
      v-if="eyebrow || title || subtitle || $slots.actions"
      class="xt-lux-section__header"
    >
      <div class="xt-lux-section__head">
        <p
          v-if="eyebrow"
          class="xt-lux-section__eyebrow"
          :data-testid="`${testId}-eyebrow`"
        >
          <span aria-hidden="true" class="xt-lux-section__divider">
            <span class="xt-lux-section__divider-line" />
            <span class="xt-lux-section__divider-diamond" />
            <span class="xt-lux-section__divider-line" />
          </span>
          <span class="xt-lux-section__caps">{{ eyebrow }}</span>
        </p>
        <h2
          v-if="title"
          class="xt-lux-section__title"
          :data-testid="`${testId}-title`"
        >
          {{ title }}
        </h2>
        <p
          v-if="subtitle"
          class="xt-lux-section__subtitle"
          :data-testid="`${testId}-subtitle`"
        >
          {{ subtitle }}
        </p>
      </div>
      <div
        v-if="$slots.actions"
        class="xt-lux-section__actions"
        :data-testid="`${testId}-actions`"
      >
        <slot name="actions" />
      </div>
    </header>

    <div class="xt-lux-section__body">
      <slot />
    </div>
  </section>
</template>

<style scoped>
.xt-lux-section {
  position: relative;
  isolation: isolate;
  display: flex;
  flex-direction: column;
  gap: 14px;
  border-radius: var(--xt-radius-xl, 28px);
}

.xt-lux-section--surface-card {
  background:
    radial-gradient(
      120% 80% at 0% 0%,
      var(--section-glow-a, rgba(242, 215, 137, 0.08)) 0%,
      transparent 55%
    ),
    radial-gradient(
      100% 80% at 100% 100%,
      var(--section-glow-b, rgba(95, 227, 198, 0.08)) 0%,
      transparent 55%
    ),
    linear-gradient(
      180deg,
      rgba(28, 36, 46, 0.72) 0%,
      rgba(14, 19, 24, 0.86) 100%
    );
  border: 1px solid var(--section-border, rgba(242, 215, 137, 0.22));
  box-shadow: var(--xt-shadow-depth-1);
}

.xt-lux-section--surface-panel {
  background: linear-gradient(
    180deg,
    rgba(20, 28, 38, 0.55) 0%,
    rgba(14, 19, 24, 0.7) 100%
  );
  border: 1px solid var(--section-border-soft, rgba(242, 215, 137, 0.14));
}

.xt-lux-section--surface-bare {
  background: transparent;
  border: none;
}

.xt-lux-section--pad-tight {
  padding: 12px 14px 14px;
}
.xt-lux-section--pad-normal {
  padding: 18px 20px 20px;
}
.xt-lux-section--pad-loose {
  padding: 24px 28px 28px;
}

@media (max-width: 640px) {
  .xt-lux-section--pad-normal {
    padding: 14px 14px 16px;
  }
  .xt-lux-section--pad-loose {
    padding: 18px 16px 20px;
  }
}

.xt-lux-section__header {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

@media (min-width: 720px) {
  .xt-lux-section__header {
    flex-direction: row;
    align-items: flex-end;
    justify-content: space-between;
    gap: 16px;
  }
}

.xt-lux-section__head {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.xt-lux-section__eyebrow {
  display: flex;
  align-items: center;
  gap: 10px;
  margin: 0;
  font-size: 11px;
  letter-spacing: 0.32em;
  text-transform: uppercase;
  color: var(--section-eyebrow, var(--xt-gold-bright, #f2d789));
}

.xt-lux-section__divider {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}
.xt-lux-section__divider-line {
  display: inline-block;
  width: 18px;
  height: 1px;
  background: linear-gradient(
    90deg,
    transparent 0%,
    var(--section-border, rgba(242, 215, 137, 0.6)) 100%
  );
}
.xt-lux-section__divider-line:last-child {
  background: linear-gradient(
    90deg,
    var(--section-border, rgba(242, 215, 137, 0.6)) 0%,
    transparent 100%
  );
}
.xt-lux-section__divider-diamond {
  width: 5px;
  height: 5px;
  transform: rotate(45deg);
  background: var(--section-border, rgba(242, 215, 137, 0.65));
  box-shadow: 0 0 6px var(--section-glow-a, rgba(242, 215, 137, 0.4));
}

.xt-lux-section__caps {
  font-family: var(--xt-font-decorative), var(--xt-font-display), serif;
  font-weight: 600;
  letter-spacing: 0.22em;
}

.xt-lux-section__title {
  font-family: var(--xt-font-display), serif;
  font-weight: 600;
  font-size: clamp(18px, 2.4vw, 22px);
  line-height: 1.18;
  letter-spacing: 0.02em;
  color: var(--xt-scroll-paper-bright, #fff6e0);
  margin: 2px 0 0;
}

.xt-lux-section__subtitle {
  font-family: var(--xt-font-body);
  font-size: 13px;
  line-height: 1.45;
  color: var(--xt-text-muted, #b9b1a2);
  margin: 0;
  max-width: 56ch;
}

.xt-lux-section__actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}

.xt-lux-section__body {
  display: flex;
  flex-direction: column;
  gap: 12px;
  min-width: 0;
}

/* Tone palettes */
.xt-lux-section--gold {
  --section-border: rgba(242, 215, 137, 0.32);
  --section-border-soft: rgba(242, 215, 137, 0.16);
  --section-glow-a: rgba(242, 215, 137, 0.14);
  --section-glow-b: rgba(208, 79, 79, 0.08);
  --section-eyebrow: var(--xt-gold-bright, #f2d789);
}
.xt-lux-section--jade {
  --section-border: rgba(95, 227, 198, 0.32);
  --section-border-soft: rgba(95, 227, 198, 0.16);
  --section-glow-a: rgba(95, 227, 198, 0.14);
  --section-glow-b: rgba(242, 215, 137, 0.1);
  --section-eyebrow: var(--xt-jade-bright, #5fe3c6);
}
.xt-lux-section--seal {
  --section-border: rgba(208, 79, 79, 0.34);
  --section-border-soft: rgba(208, 79, 79, 0.16);
  --section-glow-a: rgba(208, 79, 79, 0.14);
  --section-glow-b: rgba(242, 215, 137, 0.1);
  --section-eyebrow: var(--xt-seal-bright, #d04f4f);
}
.xt-lux-section--smoke {
  --section-border: rgba(169, 159, 212, 0.32);
  --section-border-soft: rgba(169, 159, 212, 0.16);
  --section-glow-a: rgba(169, 159, 212, 0.14);
  --section-glow-b: rgba(95, 227, 198, 0.1);
  --section-eyebrow: var(--xt-smoke-bright, #a99fd4);
}
.xt-lux-section--mist {
  --section-border: rgba(185, 214, 232, 0.32);
  --section-border-soft: rgba(185, 214, 232, 0.16);
  --section-glow-a: rgba(185, 214, 232, 0.14);
  --section-glow-b: rgba(242, 215, 137, 0.1);
  --section-eyebrow: var(--xt-mist-bright, #b9d6e8);
}
</style>
