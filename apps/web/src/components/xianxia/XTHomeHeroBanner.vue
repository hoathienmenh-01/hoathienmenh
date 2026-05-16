<script setup lang="ts">
/**
 * Cửu Thiên Mộng — `XTHomeHeroBanner` (UI-3.2 luxury hero with quick actions).
 *
 * Hero chính cho dashboard. Trái: title "Xuân Tôi" + "Cửu Thiên Mộng" +
 * tagline. Bên trong có sơn tiên / pháp trận backdrop bằng SVG + radial
 * gradient (KHÔNG dùng ảnh raster, KHÔNG cần asset). Phải: "Thao tác nhanh"
 * card (4 ô) + "Phúc lợi hôm nay" card (progress bar + nút claim).
 *
 * Emits:
 *   - `quick-action(key)` — khi click một quick action.
 *   - `claim-reward` — khi click rương "Phúc lợi hôm nay".
 */
import {
  heroBanner,
  heroQuickActions,
  dailyReward,
  type HomeQuickAction,
} from '@/data/homeDashboardMock';

withDefaults(
  defineProps<{
    brand?: typeof heroBanner;
    quickActions?: HomeQuickAction[];
    reward?: typeof dailyReward;
    testId?: string;
  }>(),
  {
    brand: () => heroBanner,
    quickActions: () => heroQuickActions,
    reward: () => dailyReward,
    testId: 'home-hero',
  },
);

defineEmits<{
  'quick-action': [key: string];
  'claim-reward': [];
}>();
</script>

<template>
  <section
    class="xt-home-hero"
    :data-testid="testId"
    role="region"
    aria-label="Trang chủ — banner chính"
  >
    <div class="xt-home-hero__scene" aria-hidden="true">
      <div class="xt-home-hero__sky" />
      <svg
        class="xt-home-hero__mountains"
        viewBox="0 0 800 320"
        preserveAspectRatio="xMidYMid slice"
      >
        <defs>
          <linearGradient id="xt-home-hero-mtn-back" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stop-color="#1a2530" />
            <stop offset="100%" stop-color="#0c1218" />
          </linearGradient>
          <linearGradient id="xt-home-hero-mtn-front" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stop-color="#172029" />
            <stop offset="100%" stop-color="#070a0d" />
          </linearGradient>
          <radialGradient id="xt-home-hero-glow" cx="50%" cy="48%" r="48%">
            <stop offset="0%" stop-color="rgba(242, 215, 137, 0.55)" />
            <stop offset="60%" stop-color="rgba(208, 79, 79, 0.18)" />
            <stop offset="100%" stop-color="rgba(0, 0, 0, 0)" />
          </radialGradient>
        </defs>
        <path
          d="M0 240 L80 160 L140 200 L220 120 L300 200 L370 150 L460 220 L540 170 L620 230 L720 180 L800 220 L800 320 L0 320 Z"
          fill="url(#xt-home-hero-mtn-back)"
          opacity="0.85"
        />
        <path
          d="M0 280 L60 240 L130 270 L200 220 L290 260 L360 230 L440 280 L520 240 L610 280 L700 250 L800 290 L800 320 L0 320 Z"
          fill="url(#xt-home-hero-mtn-front)"
        />
        <circle cx="430" cy="140" r="160" fill="url(#xt-home-hero-glow)" />
        <circle cx="430" cy="140" r="78" fill="none" stroke="rgba(242,215,137,0.55)" stroke-width="1.2" />
        <circle cx="430" cy="140" r="60" fill="none" stroke="rgba(242,215,137,0.35)" stroke-width="0.8" stroke-dasharray="2 4" />
        <circle cx="430" cy="140" r="42" fill="none" stroke="rgba(242,215,137,0.4)" stroke-width="0.8" />
      </svg>
      <span class="xt-home-hero__particle xt-home-hero__particle--1" />
      <span class="xt-home-hero__particle xt-home-hero__particle--2" />
      <span class="xt-home-hero__particle xt-home-hero__particle--3" />
      <span class="xt-home-hero__particle xt-home-hero__particle--4" />
    </div>

    <div class="xt-home-hero__border" aria-hidden="true" />
    <div class="xt-home-hero__corner xt-home-hero__corner--tl" aria-hidden="true" />
    <div class="xt-home-hero__corner xt-home-hero__corner--tr" aria-hidden="true" />
    <div class="xt-home-hero__corner xt-home-hero__corner--bl" aria-hidden="true" />
    <div class="xt-home-hero__corner xt-home-hero__corner--br" aria-hidden="true" />

    <div class="xt-home-hero__title-block">
      <h1 class="xt-home-hero__title" :data-testid="`${testId}-title`">
        <span class="xt-home-hero__title-main">{{ brand.brand }}</span>
        <span class="xt-home-hero__title-rule" aria-hidden="true" />
        <span class="xt-home-hero__title-sub">{{ brand.subtitle }}</span>
      </h1>
      <p class="xt-home-hero__tagline">{{ brand.tagline }}</p>
    </div>

    <aside class="xt-home-hero__side" :data-testid="`${testId}-side`">
      <div class="xt-home-hero__card xt-home-hero__card--actions">
        <p class="xt-home-hero__card-title">Thao tác nhanh</p>
        <ul class="xt-home-hero__actions">
          <li v-for="action in quickActions" :key="action.key">
            <button
              type="button"
              class="xt-home-hero__action"
              :class="`xt-home-hero__action--${action.tone}`"
              :data-testid="`${testId}-action-${action.key}`"
              :aria-label="action.label"
              @click="$emit('quick-action', action.key)"
            >
              <span class="xt-home-hero__action-glyph" aria-hidden="true">{{ action.glyph }}</span>
              <span
                v-if="action.badge && action.badge > 0"
                class="xt-home-hero__action-badge"
              >{{ action.badge }}</span>
              <span class="xt-home-hero__action-label">{{ action.label }}</span>
            </button>
          </li>
        </ul>
      </div>

      <button
        type="button"
        class="xt-home-hero__card xt-home-hero__card--reward"
        :data-testid="`${testId}-reward`"
        @click="$emit('claim-reward')"
      >
        <div class="xt-home-hero__reward-text">
          <p class="xt-home-hero__card-title">{{ reward.title }}</p>
          <p class="xt-home-hero__reward-counter">
            Đã nhận
            <span class="xt-home-hero__reward-counter-val">{{ reward.claimed }}/{{ reward.total }}</span>
          </p>
          <div class="xt-home-hero__reward-bar" aria-hidden="true">
            <div
              class="xt-home-hero__reward-bar-fill"
              :style="{ width: `${Math.round((reward.claimed / Math.max(reward.total, 1)) * 100)}%` }"
            />
          </div>
        </div>
        <span class="xt-home-hero__reward-chest" aria-hidden="true">
          <span class="xt-home-hero__reward-chest-body">▣</span>
          <span class="xt-home-hero__reward-chest-glow" />
        </span>
      </button>
    </aside>
  </section>
</template>

<style scoped>
.xt-home-hero {
  position: relative;
  isolation: isolate;
  display: grid;
  grid-template-columns: 1fr;
  gap: 16px;
  padding: 18px 22px;
  border-radius: 22px;
  border: 1px solid rgba(242, 215, 137, 0.32);
  background: linear-gradient(180deg, rgba(14, 19, 24, 0.7) 0%, rgba(8, 9, 11, 0.92) 100%);
  box-shadow: var(--xt-shadow-depth-hero, 0 24px 60px rgba(0, 0, 0, 0.55));
  overflow: hidden;
  min-height: 220px;
}

@media (min-width: 1024px) {
  .xt-home-hero {
    grid-template-columns: 1fr 280px;
    align-items: center;
    padding: 24px 28px;
    min-height: 260px;
  }
}

.xt-home-hero__scene {
  position: absolute;
  inset: 0;
  z-index: 0;
  pointer-events: none;
  overflow: hidden;
}

.xt-home-hero__sky {
  position: absolute;
  inset: 0;
  background:
    radial-gradient(80% 60% at 50% 18%, rgba(242, 215, 137, 0.22) 0%, transparent 60%),
    radial-gradient(80% 60% at 50% 90%, rgba(208, 79, 79, 0.18) 0%, transparent 70%),
    linear-gradient(180deg, #11202a 0%, #0a1219 100%);
}

.xt-home-hero__mountains {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  opacity: 0.92;
}

.xt-home-hero__particle {
  position: absolute;
  width: 4px;
  height: 4px;
  border-radius: 50%;
  background: radial-gradient(circle, rgba(242, 215, 137, 0.9) 0%, rgba(242, 215, 137, 0.1) 70%);
  box-shadow: 0 0 12px rgba(242, 215, 137, 0.55);
  animation: xt-hero-float 6s ease-in-out infinite;
}
.xt-home-hero__particle--1 { left: 28%; top: 62%; animation-delay: 0s; }
.xt-home-hero__particle--2 { left: 44%; top: 36%; animation-delay: 1.2s; }
.xt-home-hero__particle--3 { left: 58%; top: 70%; animation-delay: 2.4s; }
.xt-home-hero__particle--4 { left: 66%; top: 26%; animation-delay: 3.6s; }

@keyframes xt-hero-float {
  0%, 100% { transform: translateY(0); opacity: 0.85; }
  50% { transform: translateY(-12px); opacity: 1; }
}

.xt-home-hero__border {
  position: absolute;
  inset: 6px;
  z-index: 1;
  border-radius: 18px;
  border: 1px solid rgba(242, 215, 137, 0.18);
  pointer-events: none;
}

.xt-home-hero__corner {
  position: absolute;
  z-index: 2;
  width: 24px;
  height: 24px;
  pointer-events: none;
}
.xt-home-hero__corner--tl { top: 8px; left: 8px; border-top: 2px solid rgba(242,215,137,0.6); border-left: 2px solid rgba(242,215,137,0.6); }
.xt-home-hero__corner--tr { top: 8px; right: 8px; border-top: 2px solid rgba(242,215,137,0.6); border-right: 2px solid rgba(242,215,137,0.6); }
.xt-home-hero__corner--bl { bottom: 8px; left: 8px; border-bottom: 2px solid rgba(242,215,137,0.6); border-left: 2px solid rgba(242,215,137,0.6); }
.xt-home-hero__corner--br { bottom: 8px; right: 8px; border-bottom: 2px solid rgba(242,215,137,0.6); border-right: 2px solid rgba(242,215,137,0.6); }

.xt-home-hero__title-block {
  position: relative;
  z-index: 2;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  text-align: center;
}

.xt-home-hero__title {
  margin: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
}

.xt-home-hero__title-main {
  font-family: var(--xt-font-decorative), var(--xt-font-display), serif;
  font-size: clamp(40px, 6vw, 64px);
  font-weight: 700;
  letter-spacing: 0.04em;
  background: linear-gradient(180deg, #fff6e0 0%, #f2d789 55%, #b8893a 100%);
  -webkit-background-clip: text;
          background-clip: text;
  color: transparent;
  -webkit-text-fill-color: transparent;
  text-shadow: 0 0 28px rgba(242, 215, 137, 0.32);
  line-height: 1;
}

.xt-home-hero__title-rule {
  width: 64%;
  height: 1px;
  background: linear-gradient(
    90deg,
    transparent 0%,
    rgba(242, 215, 137, 0.7) 50%,
    transparent 100%
  );
}

.xt-home-hero__title-sub {
  font-family: var(--xt-font-decorative), serif;
  font-size: clamp(14px, 1.4vw, 18px);
  letter-spacing: 0.42em;
  text-transform: uppercase;
  color: var(--xt-gold-bright, #f2d789);
  padding: 4px 18px;
  border: 1px solid rgba(242, 215, 137, 0.4);
  border-radius: 6px;
  background: rgba(14, 19, 24, 0.55);
}

.xt-home-hero__tagline {
  margin: 0;
  font-family: var(--xt-font-decorative), serif;
  font-size: 13px;
  letter-spacing: 0.28em;
  text-transform: uppercase;
  color: var(--xt-jade-bright, #5fe3c6);
  text-shadow: 0 0 10px rgba(95, 227, 198, 0.35);
}

.xt-home-hero__side {
  position: relative;
  z-index: 2;
  display: flex;
  flex-direction: column;
  gap: 12px;
  min-width: 0;
}

.xt-home-hero__card {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 12px;
  border-radius: 16px;
  background: linear-gradient(180deg, rgba(20, 28, 38, 0.82) 0%, rgba(8, 9, 11, 0.92) 100%);
  border: 1px solid rgba(242, 215, 137, 0.32);
  box-shadow: 0 0 24px rgba(0, 0, 0, 0.45);
  color: var(--xt-text-primary, #f0e6cc);
  text-align: left;
}

.xt-home-hero__card-title {
  margin: 0;
  font-family: var(--xt-font-decorative), serif;
  font-size: 11px;
  letter-spacing: 0.3em;
  text-transform: uppercase;
  color: var(--xt-gold-bright, #f2d789);
}

.xt-home-hero__actions {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 6px;
}

.xt-home-hero__action {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  padding: 8px 4px;
  border-radius: 12px;
  border: 1px solid var(--xt-border-gold, rgba(242, 215, 137, 0.42));
  background: linear-gradient(180deg, rgba(28, 36, 46, 0.85) 0%, rgba(8, 9, 11, 0.95) 100%);
  color: inherit;
  cursor: pointer;
  font-family: var(--xt-font-body);
  font-size: 10.5px;
  letter-spacing: 0.06em;
  text-align: center;
  transition:
    border-color var(--xt-motion-base, 220ms) ease,
    box-shadow var(--xt-motion-base, 220ms) ease,
    transform var(--xt-motion-fast, 140ms) ease;
  width: 100%;
}

.xt-home-hero__action:hover {
  transform: translateY(-1px);
  box-shadow: 0 0 18px var(--xt-glow, rgba(242, 215, 137, 0.34));
  border-color: rgba(242, 215, 137, 0.75);
}

.xt-home-hero__action:focus-visible {
  outline: 2px solid rgba(95, 227, 198, 0.55);
  outline-offset: 2px;
}

.xt-home-hero__action--jade { --xt-glow: rgba(95, 227, 198, 0.4); }
.xt-home-hero__action--gold { --xt-glow: rgba(242, 215, 137, 0.42); }
.xt-home-hero__action--seal { --xt-glow: rgba(208, 79, 79, 0.45); }
.xt-home-hero__action--cyan { --xt-glow: rgba(95, 227, 198, 0.4); }
.xt-home-hero__action--violet { --xt-glow: rgba(168, 132, 222, 0.42); }
.xt-home-hero__action--smoke { --xt-glow: rgba(190, 196, 208, 0.32); }

.xt-home-hero__action-glyph {
  font-size: 22px;
  filter: drop-shadow(0 0 6px var(--xt-glow, rgba(242, 215, 137, 0.4)));
  line-height: 1;
}

.xt-home-hero__action-label {
  font-size: 11px;
  color: var(--xt-text-soft, #d8d0bf);
}

.xt-home-hero__action-badge {
  position: absolute;
  top: 4px;
  right: 4px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 14px;
  height: 14px;
  padding: 0 4px;
  border-radius: 999px;
  background: linear-gradient(180deg, #e75858 0%, #a02828 100%);
  border: 1px solid rgba(14, 19, 24, 0.9);
  color: #fff6e0;
  font-size: 9px;
  font-weight: 700;
}

.xt-home-hero__card--reward {
  display: grid;
  grid-template-columns: 1fr 56px;
  align-items: center;
  gap: 12px;
  cursor: pointer;
  text-align: left;
}

.xt-home-hero__card--reward:hover {
  border-color: rgba(242, 215, 137, 0.75);
  box-shadow: 0 0 18px rgba(242, 215, 137, 0.32);
}

.xt-home-hero__card--reward:focus-visible {
  outline: 2px solid rgba(95, 227, 198, 0.55);
  outline-offset: 2px;
}

.xt-home-hero__reward-text {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}

.xt-home-hero__reward-counter {
  margin: 0;
  font-size: 12px;
  color: var(--xt-text-soft, #d8d0bf);
}

.xt-home-hero__reward-counter-val {
  font-family: var(--xt-font-decorative), serif;
  font-size: 14px;
  letter-spacing: 0.08em;
  color: var(--xt-gold-bright, #f2d789);
  margin-left: 4px;
}

.xt-home-hero__reward-bar {
  position: relative;
  height: 6px;
  border-radius: 999px;
  background: rgba(14, 19, 24, 0.85);
  border: 1px solid rgba(242, 215, 137, 0.28);
  overflow: hidden;
}

.xt-home-hero__reward-bar-fill {
  height: 100%;
  background: linear-gradient(90deg, var(--xt-jade-bright, #5fe3c6) 0%, var(--xt-gold-bright, #f2d789) 100%);
  box-shadow: 0 0 12px rgba(242, 215, 137, 0.45);
  transition: width var(--xt-motion-slow, 360ms) ease;
}

.xt-home-hero__reward-chest {
  position: relative;
  width: 56px;
  height: 56px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 14px;
  background: radial-gradient(circle at 50% 30%, rgba(242, 215, 137, 0.4) 0%, rgba(14, 19, 24, 0.92) 70%);
  border: 1px solid rgba(242, 215, 137, 0.6);
  color: var(--xt-gold-bright, #f2d789);
  font-size: 28px;
  box-shadow: inset 0 0 12px rgba(255, 246, 224, 0.18), 0 0 18px rgba(242, 215, 137, 0.32);
}

.xt-home-hero__reward-chest-body {
  position: relative;
  z-index: 1;
}

.xt-home-hero__reward-chest-glow {
  position: absolute;
  inset: -6px;
  border-radius: 50%;
  background: radial-gradient(circle, rgba(242, 215, 137, 0.45) 0%, transparent 70%);
  animation: xt-hero-chest-pulse 3s ease-in-out infinite;
}

@keyframes xt-hero-chest-pulse {
  0%, 100% { opacity: 0.4; transform: scale(0.92); }
  50% { opacity: 0.8; transform: scale(1.05); }
}

@media (prefers-reduced-motion: reduce) {
  .xt-home-hero__particle,
  .xt-home-hero__reward-chest-glow {
    animation: none;
  }
  .xt-home-hero__action,
  .xt-home-hero__card--reward {
    transition: none;
  }
}
</style>
