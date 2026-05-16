<script setup lang="ts">
/**
 * Cửu Thiên Mộng — `XTHomeFeatureGrid` (UI-3.2 luxury feature card grid).
 *
 * Lưới card chức năng chính trên dashboard. Mỗi card:
 *   - icon/illustration trái với glow theo tone.
 *   - tên chức năng + mô tả ngắn.
 *   - badge đỏ góc phải nếu có notify.
 *   - hover lift + glow + shimmer sweep.
 * Tone variants tận dụng tokens jade / gold / seal / cyan / violet / smoke.
 *
 * Mobile mặc định 2 cột → tablet 3 → desktop 6. Có thể tuỳ biến qua prop
 * `columns` để dùng làm 2 hàng × 4 cột hoặc icon-only.
 */
import { useRouter } from 'vue-router';
import { featureCards, type HomeFeatureCard } from '@/data/homeDashboardMock';

const props = withDefaults(
  defineProps<{
    cards?: HomeFeatureCard[];
    layout?: 'auto' | 'iconGrid';
    columns?: number;
    testId?: string;
  }>(),
  {
    cards: () => featureCards,
    layout: 'auto',
    columns: 6,
    testId: 'home-feature-grid',
  },
);

const router = useRouter();
const emit = defineEmits<{
  navigate: [card: HomeFeatureCard];
}>();

function onClick(card: HomeFeatureCard): void {
  emit('navigate', card);
  if (card.to) {
    router.push(card.to).catch(() => null);
  }
}
</script>

<template>
  <section
    class="xt-home-feature-grid"
    :class="[`xt-home-feature-grid--${layout}`]"
    :style="layout === 'auto' ? { '--xt-home-feature-cols': props.columns } : undefined"
    :data-testid="testId"
    role="list"
    aria-label="Chức năng nổi bật"
  >
    <button
      v-for="card in cards"
      :key="card.key"
      type="button"
      class="xt-home-feature-card"
      :class="[`xt-home-feature-card--${card.tone}`, layout === 'iconGrid' ? 'xt-home-feature-card--icon-only' : '']"
      :data-testid="`${testId}-card-${card.key}`"
      role="listitem"
      @click="onClick(card)"
    >
      <span class="xt-home-feature-card__shimmer" aria-hidden="true" />
      <span class="xt-home-feature-card__corner xt-home-feature-card__corner--tl" aria-hidden="true" />
      <span class="xt-home-feature-card__corner xt-home-feature-card__corner--tr" aria-hidden="true" />
      <span class="xt-home-feature-card__corner xt-home-feature-card__corner--bl" aria-hidden="true" />
      <span class="xt-home-feature-card__corner xt-home-feature-card__corner--br" aria-hidden="true" />

      <span class="xt-home-feature-card__glyph" aria-hidden="true">{{ card.glyph }}</span>
      <span class="xt-home-feature-card__text">
        <span class="xt-home-feature-card__label">{{ card.label }}</span>
        <span
          v-if="card.description && layout !== 'iconGrid'"
          class="xt-home-feature-card__desc"
        >{{ card.description }}</span>
      </span>
      <span
        v-if="card.badge && card.badge > 0"
        class="xt-home-feature-card__badge"
        :aria-label="`${card.badge} thông báo`"
      >{{ card.badge > 99 ? '99+' : card.badge }}</span>
    </button>
  </section>
</template>

<style scoped>
.xt-home-feature-grid {
  display: grid;
  gap: 10px;
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

@media (min-width: 640px) {
  .xt-home-feature-grid--auto {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }
}
@media (min-width: 1024px) {
  .xt-home-feature-grid--auto {
    grid-template-columns: repeat(4, minmax(0, 1fr));
  }
}
@media (min-width: 1440px) {
  .xt-home-feature-grid--auto {
    grid-template-columns: repeat(var(--xt-home-feature-cols, 6), minmax(0, 1fr));
  }
}

.xt-home-feature-grid--iconGrid {
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 10px;
}
@media (min-width: 420px) {
  .xt-home-feature-grid--iconGrid {
    grid-template-columns: repeat(5, minmax(0, 1fr));
  }
}
@media (min-width: 560px) {
  .xt-home-feature-grid--iconGrid {
    grid-template-columns: repeat(6, minmax(0, 1fr));
  }
}

.xt-home-feature-card {
  position: relative;
  isolation: isolate;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px 14px;
  border-radius: 16px;
  border: 1px solid var(--card-border, rgba(242, 215, 137, 0.32));
  background: linear-gradient(180deg, rgba(20, 28, 38, 0.88) 0%, rgba(8, 9, 11, 0.96) 100%);
  color: var(--xt-text-primary, #f0e6cc);
  text-align: left;
  cursor: pointer;
  overflow: hidden;
  font-family: var(--xt-font-body);
  transition: border-color var(--xt-motion-base, 220ms) ease,
              box-shadow var(--xt-motion-base, 220ms) ease,
              transform var(--xt-motion-fast, 140ms) ease;
}

.xt-home-feature-card:hover {
  transform: translateY(-2px);
  border-color: var(--card-border-hover, rgba(242, 215, 137, 0.85));
  box-shadow:
    inset 0 0 0 1px rgba(255, 246, 224, 0.06),
    0 14px 28px rgba(0, 0, 0, 0.45),
    0 0 22px var(--card-glow, rgba(242, 215, 137, 0.35));
}

.xt-home-feature-card:focus-visible {
  outline: 2px solid rgba(95, 227, 198, 0.55);
  outline-offset: 2px;
}

.xt-home-feature-card__shimmer {
  position: absolute;
  inset: 0;
  z-index: 0;
  pointer-events: none;
  background: linear-gradient(
    115deg,
    transparent 0%,
    transparent 35%,
    rgba(255, 246, 224, 0.18) 50%,
    transparent 65%,
    transparent 100%
  );
  transform: translateX(-120%);
  transition: transform 1.1s var(--xt-ease-out, ease);
}
.xt-home-feature-card:hover .xt-home-feature-card__shimmer {
  transform: translateX(120%);
}

.xt-home-feature-card__corner {
  position: absolute;
  width: 8px;
  height: 8px;
  pointer-events: none;
}
.xt-home-feature-card__corner--tl { top: 4px; left: 4px; border-top: 1px solid var(--card-border, rgba(242,215,137,0.5)); border-left: 1px solid var(--card-border, rgba(242,215,137,0.5)); }
.xt-home-feature-card__corner--tr { top: 4px; right: 4px; border-top: 1px solid var(--card-border, rgba(242,215,137,0.5)); border-right: 1px solid var(--card-border, rgba(242,215,137,0.5)); }
.xt-home-feature-card__corner--bl { bottom: 4px; left: 4px; border-bottom: 1px solid var(--card-border, rgba(242,215,137,0.5)); border-left: 1px solid var(--card-border, rgba(242,215,137,0.5)); }
.xt-home-feature-card__corner--br { bottom: 4px; right: 4px; border-bottom: 1px solid var(--card-border, rgba(242,215,137,0.5)); border-right: 1px solid var(--card-border, rgba(242,215,137,0.5)); }

.xt-home-feature-card__glyph {
  position: relative;
  z-index: 1;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 44px;
  height: 44px;
  flex: 0 0 44px;
  border-radius: 14px;
  background:
    radial-gradient(circle at 50% 30%, var(--card-glow, rgba(242, 215, 137, 0.32)) 0%, rgba(14, 19, 24, 0.92) 75%);
  border: 1px solid var(--card-border, rgba(242, 215, 137, 0.42));
  color: var(--card-icon, #fff6e0);
  font-size: 22px;
  filter: drop-shadow(0 0 8px var(--card-glow, rgba(242, 215, 137, 0.35)));
}

.xt-home-feature-card__text {
  position: relative;
  z-index: 1;
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
  flex: 1 1 auto;
}

.xt-home-feature-card__label {
  font-family: var(--xt-font-display), serif;
  font-size: 13px;
  font-weight: 700;
  letter-spacing: 0.04em;
  color: var(--xt-scroll-paper-bright, #fff6e0);
}

.xt-home-feature-card__desc {
  font-size: 11px;
  color: var(--xt-text-muted, rgba(208, 200, 180, 0.7));
  letter-spacing: 0.02em;
  line-height: 1.3;
}

.xt-home-feature-card__badge {
  position: absolute;
  top: 8px;
  right: 8px;
  z-index: 2;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 18px;
  height: 18px;
  padding: 0 5px;
  border-radius: 999px;
  background: linear-gradient(180deg, #e75858 0%, #a02828 100%);
  border: 1px solid rgba(14, 19, 24, 0.9);
  color: #fff6e0;
  font-size: 10px;
  font-weight: 700;
  box-shadow: 0 0 10px rgba(208, 79, 79, 0.4);
}

/* tone palettes */
.xt-home-feature-card--jade {
  --card-border: rgba(95, 227, 198, 0.42);
  --card-border-hover: rgba(95, 227, 198, 0.85);
  --card-glow: rgba(95, 227, 198, 0.34);
  --card-icon: var(--xt-jade-bright, #5fe3c6);
}
.xt-home-feature-card--seal {
  --card-border: rgba(208, 79, 79, 0.55);
  --card-border-hover: rgba(208, 79, 79, 0.95);
  --card-glow: rgba(208, 79, 79, 0.38);
  --card-icon: #ff8b88;
}
.xt-home-feature-card--cyan {
  --card-border: rgba(95, 227, 198, 0.42);
  --card-border-hover: rgba(95, 227, 198, 0.88);
  --card-glow: rgba(98, 200, 220, 0.34);
  --card-icon: #9ee3ee;
}
.xt-home-feature-card--gold {
  --card-border: rgba(242, 215, 137, 0.55);
  --card-border-hover: rgba(242, 215, 137, 0.95);
  --card-glow: rgba(242, 215, 137, 0.42);
  --card-icon: var(--xt-gold-bright, #f2d789);
}
.xt-home-feature-card--violet {
  --card-border: rgba(168, 132, 222, 0.5);
  --card-border-hover: rgba(168, 132, 222, 0.95);
  --card-glow: rgba(168, 132, 222, 0.38);
  --card-icon: #c8b6f0;
}
.xt-home-feature-card--smoke {
  --card-border: rgba(190, 196, 208, 0.45);
  --card-border-hover: rgba(190, 196, 208, 0.85);
  --card-glow: rgba(190, 196, 208, 0.32);
  --card-icon: #d6dae3;
}

/* icon-only variant: vertical stack with circular icon frame */
.xt-home-feature-card--icon-only {
  flex-direction: column;
  text-align: center;
  padding: 10px 6px;
  min-height: 88px;
  gap: 4px;
}

.xt-home-feature-card--icon-only .xt-home-feature-card__glyph {
  width: 50px;
  height: 50px;
  flex: 0 0 50px;
  border-radius: 16px;
  font-size: 24px;
  border-width: 1.5px;
}

.xt-home-feature-card--icon-only .xt-home-feature-card__label {
  font-size: 11px;
  letter-spacing: 0.04em;
}

@media (prefers-reduced-motion: reduce) {
  .xt-home-feature-card,
  .xt-home-feature-card__shimmer {
    transition: none;
  }
  .xt-home-feature-card:hover {
    transform: none;
  }
  .xt-home-feature-card:hover .xt-home-feature-card__shimmer {
    transform: translateX(-120%);
  }
}
</style>
