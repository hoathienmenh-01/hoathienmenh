<script setup lang="ts">
/**
 * Cửu Thiên Mộng — `XTHomeMobileHero` (UI-3.2 mobile hero card).
 *
 * Hero card nhỏ cho mobile. Hiển thị:
 *   - Cảnh giới Bậc 9 + progress 61%
 *   - Tu vi 32.456.789
 *   - Quick actions 4 ô: Phúc lợi / Sự kiện / Nạp lần đầu / Truyền công
 *
 * Emits `quick-action(key)`.
 */
import {
  heroQuickActions,
  playerHeader,
  type HomeQuickAction,
} from '@/data/homeDashboardMock';

withDefaults(
  defineProps<{
    actions?: HomeQuickAction[];
    progressPct?: number;
    tuVi?: string;
    realm?: string;
    stage?: string;
    testId?: string;
  }>(),
  {
    actions: () => heroQuickActions,
    progressPct: 61,
    tuVi: '32.456.789',
    realm: () => playerHeader.realm,
    stage: () => playerHeader.stagePill,
    testId: 'home-mobile-hero',
  },
);

defineEmits<{
  'quick-action': [key: string];
}>();
</script>

<template>
  <section
    class="xt-home-mhero"
    :data-testid="testId"
    role="region"
    aria-label="Tu vi và thao tác nhanh"
  >
    <div class="xt-home-mhero__top">
      <div class="xt-home-mhero__realm">
        <span class="xt-home-mhero__realm-glyph" aria-hidden="true">✦</span>
        <div class="xt-home-mhero__realm-text">
          <span class="xt-home-mhero__realm-label">{{ realm }}</span>
          <span class="xt-home-mhero__realm-stage">{{ stage }}</span>
        </div>
      </div>
      <div class="xt-home-mhero__tu-vi">
        <span class="xt-home-mhero__tu-vi-label">Tu vi</span>
        <span class="xt-home-mhero__tu-vi-value">{{ tuVi }}</span>
      </div>
    </div>

    <div class="xt-home-mhero__bar-wrap">
      <div class="xt-home-mhero__bar" aria-hidden="true">
        <div
          class="xt-home-mhero__bar-fill"
          :style="{ width: `${Math.min(100, Math.max(0, progressPct))}%` }"
        />
      </div>
      <span class="xt-home-mhero__bar-pct">{{ Math.min(100, Math.max(0, progressPct)) }}%</span>
    </div>

    <ul class="xt-home-mhero__actions">
      <li v-for="action in actions" :key="action.key">
        <button
          type="button"
          class="xt-home-mhero__action"
          :class="`xt-home-mhero__action--${action.tone}`"
          :data-testid="`${testId}-action-${action.key}`"
          @click="$emit('quick-action', action.key)"
        >
          <span class="xt-home-mhero__action-glyph" aria-hidden="true">{{ action.glyph }}</span>
          <span
            v-if="action.badge && action.badge > 0"
            class="xt-home-mhero__action-badge"
          >{{ action.badge }}</span>
          <span class="xt-home-mhero__action-label">{{ action.label }}</span>
        </button>
      </li>
    </ul>
  </section>
</template>

<style scoped>
.xt-home-mhero {
  position: relative;
  isolation: isolate;
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 14px;
  border-radius: 18px;
  background:
    radial-gradient(120% 80% at 50% 0%, rgba(242, 215, 137, 0.16) 0%, transparent 60%),
    linear-gradient(180deg, rgba(20, 28, 38, 0.88) 0%, rgba(8, 9, 11, 0.96) 100%);
  border: 1px solid rgba(242, 215, 137, 0.35);
  box-shadow: 0 14px 26px rgba(0, 0, 0, 0.42);
  color: var(--xt-text-primary, #f0e6cc);
}

.xt-home-mhero::before {
  content: '';
  position: absolute;
  inset: 6px;
  border-radius: 14px;
  border: 1px solid rgba(242, 215, 137, 0.12);
  pointer-events: none;
}

.xt-home-mhero__top {
  display: grid;
  grid-template-columns: 1fr auto;
  gap: 10px;
  align-items: center;
}

.xt-home-mhero__realm {
  display: flex;
  align-items: center;
  gap: 10px;
}

.xt-home-mhero__realm-glyph {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 40px;
  height: 40px;
  border-radius: 12px;
  background: radial-gradient(circle at 50% 30%, rgba(95, 227, 198, 0.4) 0%, rgba(8, 9, 11, 0.95) 75%);
  border: 1px solid rgba(95, 227, 198, 0.6);
  color: var(--xt-jade-bright, #5fe3c6);
  font-size: 22px;
  filter: drop-shadow(0 0 8px rgba(95, 227, 198, 0.45));
}

.xt-home-mhero__realm-text {
  display: flex;
  flex-direction: column;
  gap: 0;
}

.xt-home-mhero__realm-label {
  font-family: var(--xt-font-decorative), serif;
  font-size: 11px;
  letter-spacing: 0.24em;
  text-transform: uppercase;
  color: var(--xt-text-soft, #d8d0bf);
}

.xt-home-mhero__realm-stage {
  font-family: var(--xt-font-display), serif;
  font-size: 16px;
  font-weight: 700;
  letter-spacing: 0.04em;
  background: linear-gradient(180deg, #fff6e0 0%, var(--xt-gold-bright, #f2d789) 100%);
  -webkit-background-clip: text;
          background-clip: text;
  color: transparent;
  -webkit-text-fill-color: transparent;
}

.xt-home-mhero__tu-vi {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 0;
}

.xt-home-mhero__tu-vi-label {
  font-size: 10px;
  letter-spacing: 0.24em;
  text-transform: uppercase;
  color: var(--xt-text-muted, rgba(208, 200, 180, 0.7));
}

.xt-home-mhero__tu-vi-value {
  font-family: var(--xt-font-display), serif;
  font-size: 14px;
  letter-spacing: 0.04em;
  color: var(--xt-jade-bright, #5fe3c6);
  font-variant-numeric: tabular-nums;
}

.xt-home-mhero__bar-wrap {
  display: grid;
  grid-template-columns: 1fr auto;
  gap: 8px;
  align-items: center;
}

.xt-home-mhero__bar {
  position: relative;
  height: 8px;
  border-radius: 999px;
  background: rgba(14, 19, 24, 0.85);
  border: 1px solid rgba(242, 215, 137, 0.28);
  overflow: hidden;
}

.xt-home-mhero__bar-fill {
  height: 100%;
  background: linear-gradient(90deg, var(--xt-jade-bright, #5fe3c6) 0%, var(--xt-gold-bright, #f2d789) 100%);
  box-shadow: 0 0 14px rgba(242, 215, 137, 0.45);
  transition: width var(--xt-motion-slow, 360ms) ease;
}

.xt-home-mhero__bar-pct {
  font-family: var(--xt-font-decorative), serif;
  font-size: 12px;
  letter-spacing: 0.06em;
  color: var(--xt-gold-bright, #f2d789);
  font-variant-numeric: tabular-nums;
}

.xt-home-mhero__actions {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 6px;
}

.xt-home-mhero__action {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  padding: 8px 4px;
  border-radius: 12px;
  border: 1px solid var(--xt-border, rgba(242, 215, 137, 0.4));
  background: linear-gradient(180deg, rgba(28, 36, 46, 0.85) 0%, rgba(8, 9, 11, 0.95) 100%);
  color: inherit;
  cursor: pointer;
  font-family: var(--xt-font-body);
  font-size: 10.5px;
  letter-spacing: 0.04em;
  width: 100%;
}

.xt-home-mhero__action--jade { --xt-border: rgba(95, 227, 198, 0.55); --xt-glow: rgba(95, 227, 198, 0.4); }
.xt-home-mhero__action--gold { --xt-border: rgba(242, 215, 137, 0.55); --xt-glow: rgba(242, 215, 137, 0.42); }
.xt-home-mhero__action--seal { --xt-border: rgba(208, 79, 79, 0.6); --xt-glow: rgba(208, 79, 79, 0.45); }
.xt-home-mhero__action--cyan { --xt-border: rgba(95, 227, 198, 0.55); --xt-glow: rgba(95, 227, 198, 0.42); }
.xt-home-mhero__action--violet { --xt-border: rgba(168, 132, 222, 0.55); --xt-glow: rgba(168, 132, 222, 0.42); }
.xt-home-mhero__action--smoke { --xt-border: rgba(190, 196, 208, 0.45); --xt-glow: rgba(190, 196, 208, 0.32); }

.xt-home-mhero__action:hover {
  box-shadow: 0 0 12px var(--xt-glow, rgba(242, 215, 137, 0.32));
  border-color: var(--xt-border, rgba(242, 215, 137, 0.85));
}

.xt-home-mhero__action:focus-visible {
  outline: 2px solid rgba(95, 227, 198, 0.55);
  outline-offset: 2px;
}

.xt-home-mhero__action-glyph {
  font-size: 20px;
  filter: drop-shadow(0 0 6px var(--xt-glow, rgba(242, 215, 137, 0.4)));
}

.xt-home-mhero__action-label {
  font-size: 10px;
  letter-spacing: 0.04em;
  color: var(--xt-text-soft, #d8d0bf);
  text-align: center;
  line-height: 1.2;
}

.xt-home-mhero__action-badge {
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
</style>
