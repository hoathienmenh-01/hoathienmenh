<script setup lang="ts">
/**
 * Cửu Thiên Mộng — `XTHomeMobileHeader` (UI-3.2 mobile top section).
 *
 * Header trên mobile gom 2 phần dính nhau visually:
 *   1. Top bar: avatar + tên + cảnh giới + lực chiến (trái), brand "Xuân Tôi"
 *      (giữa), icon thư badge + icon menu (phải).
 *   2. Resource strip ngang: 4 pill (linh thạch / tiên ngọc / tử tinh /
 *      danh vọng) với nút `+`, scroll ngang nếu tràn.
 *
 * Emits:
 *   - `open-mail` / `open-menu`
 *   - `claim-resource(key)`
 */
import {
  playerHeader,
  resources as defaultResources,
  topbarMail,
  heroBanner,
  type HomeResource,
} from '@/data/homeDashboardMock';

withDefaults(
  defineProps<{
    player?: typeof playerHeader;
    resources?: HomeResource[];
    mailBadge?: number;
    brand?: typeof heroBanner;
    testId?: string;
  }>(),
  {
    player: () => playerHeader,
    resources: () => defaultResources,
    mailBadge: () => topbarMail.badge,
    brand: () => heroBanner,
    testId: 'home-mobile-header',
  },
);

defineEmits<{
  'open-mail': [];
  'open-menu': [];
  'claim-resource': [key: string];
}>();
</script>

<template>
  <header
    class="xt-home-mhead"
    :data-testid="testId"
    role="banner"
  >
    <div class="xt-home-mhead__top">
      <div class="xt-home-mhead__player">
        <div class="xt-home-mhead__avatar" aria-hidden="true">
          <span class="xt-home-mhead__avatar-glyph">{{ player.avatarGlyph }}</span>
          <span class="xt-home-mhead__avatar-level">{{ player.level }}</span>
        </div>
        <div class="xt-home-mhead__player-text">
          <div class="xt-home-mhead__name-row">
            <span class="xt-home-mhead__name">{{ player.name }}</span>
            <span class="xt-home-mhead__realm">{{ player.realm }}</span>
          </div>
          <div class="xt-home-mhead__power-row">
            <span class="xt-home-mhead__power-glyph" aria-hidden="true">⚔</span>
            <span class="xt-home-mhead__power-value">{{ player.power }}</span>
          </div>
        </div>
      </div>

      <RouterLink to="/home" class="xt-home-mhead__brand">
        <span class="xt-home-mhead__brand-title">{{ brand.brand }}</span>
        <span class="xt-home-mhead__brand-sub">{{ brand.subtitle }}</span>
      </RouterLink>

      <div class="xt-home-mhead__icons">
        <button
          type="button"
          class="xt-home-mhead__icon"
          :data-testid="`${testId}-icon-mail`"
          aria-label="Hộp thư"
          @click="$emit('open-mail')"
        >
          <span aria-hidden="true">✉</span>
          <span
            v-if="mailBadge > 0"
            class="xt-home-mhead__icon-badge"
          >{{ mailBadge > 9 ? '9+' : mailBadge }}</span>
        </button>
        <button
          type="button"
          class="xt-home-mhead__icon"
          :data-testid="`${testId}-icon-menu`"
          aria-label="Mở menu"
          @click="$emit('open-menu')"
        >
          <span aria-hidden="true">≡</span>
        </button>
      </div>
    </div>

    <div
      class="xt-home-mhead__strip"
      :data-testid="`${testId}-resources`"
      role="group"
      aria-label="Tài nguyên"
    >
      <button
        v-for="r in resources"
        :key="r.key"
        type="button"
        class="xt-home-mhead__chip"
        :class="`xt-home-mhead__chip--${r.tone}`"
        :data-testid="`${testId}-chip-${r.key}`"
        :aria-label="`${r.label}: ${r.value}, bấm để mở`"
        @click="$emit('claim-resource', r.key)"
      >
        <span class="xt-home-mhead__chip-glyph" aria-hidden="true">{{ r.glyph }}</span>
        <span class="xt-home-mhead__chip-val">{{ r.short ?? r.value }}</span>
        <span class="xt-home-mhead__chip-plus" aria-hidden="true">＋</span>
      </button>
    </div>
  </header>
</template>

<style scoped>
.xt-home-mhead {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: calc(env(safe-area-inset-top, 0px) + 10px) 12px 12px;
  background:
    radial-gradient(120% 80% at 50% 0%, rgba(95, 227, 198, 0.16) 0%, transparent 70%),
    linear-gradient(180deg, rgba(14, 19, 24, 0.96) 0%, rgba(8, 9, 11, 0.98) 100%);
  border-bottom: 1px solid rgba(242, 215, 137, 0.32);
  box-shadow: 0 8px 22px rgba(0, 0, 0, 0.36);
}

.xt-home-mhead::after {
  content: '';
  position: absolute;
  left: 12px;
  right: 12px;
  bottom: -1px;
  height: 1px;
  background: linear-gradient(
    90deg,
    transparent 0%,
    rgba(242, 215, 137, 0.55) 50%,
    transparent 100%
  );
  pointer-events: none;
}

.xt-home-mhead__top {
  display: grid;
  grid-template-columns: 1fr auto 1fr;
  align-items: center;
  gap: 10px;
}

.xt-home-mhead__player {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.xt-home-mhead__avatar {
  position: relative;
  width: 40px;
  height: 40px;
  border-radius: 12px;
  background: radial-gradient(circle at 30% 30%, rgba(95, 227, 198, 0.3), rgba(14, 19, 24, 0.92));
  border: 1px solid rgba(242, 215, 137, 0.55);
  display: flex;
  align-items: center;
  justify-content: center;
  flex: 0 0 40px;
  box-shadow: 0 0 16px rgba(95, 227, 198, 0.18);
}

.xt-home-mhead__avatar-glyph {
  font-size: 20px;
  color: var(--xt-jade-bright, #5fe3c6);
  text-shadow: 0 0 10px rgba(95, 227, 198, 0.45);
}

.xt-home-mhead__avatar-level {
  position: absolute;
  bottom: -6px;
  right: -6px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 22px;
  height: 16px;
  padding: 0 4px;
  border-radius: 8px;
  background: linear-gradient(180deg, #f2d789 0%, #b8893a 100%);
  border: 1px solid rgba(14, 19, 24, 0.9);
  color: #1a1208;
  font-size: 9px;
  font-weight: 800;
}

.xt-home-mhead__player-text {
  display: flex;
  flex-direction: column;
  gap: 0;
  min-width: 0;
}

.xt-home-mhead__name-row {
  display: flex;
  align-items: center;
  gap: 6px;
}

.xt-home-mhead__name {
  font-family: var(--xt-font-display), serif;
  font-size: 14px;
  font-weight: 700;
  letter-spacing: 0.04em;
  color: var(--xt-scroll-paper-bright, #fff6e0);
}

.xt-home-mhead__realm {
  font-family: var(--xt-font-decorative), serif;
  font-size: 10px;
  letter-spacing: 0.14em;
  color: var(--xt-jade-bright, #5fe3c6);
  padding: 1px 6px;
  border-radius: 6px;
  border: 1px solid rgba(95, 227, 198, 0.45);
  background: rgba(27, 59, 52, 0.5);
  white-space: nowrap;
}

.xt-home-mhead__power-row {
  display: flex;
  align-items: center;
  gap: 4px;
  margin-top: 1px;
}

.xt-home-mhead__power-glyph {
  color: var(--xt-gold-bright, #f2d789);
  font-size: 11px;
}

.xt-home-mhead__power-value {
  font-family: var(--xt-font-decorative), serif;
  font-size: 12px;
  letter-spacing: 0.04em;
  font-variant-numeric: tabular-nums;
  color: var(--xt-gold-bright, #f2d789);
}

.xt-home-mhead__brand {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0;
  text-decoration: none;
  color: inherit;
  padding: 2px 8px;
}

.xt-home-mhead__brand-title {
  font-family: var(--xt-font-decorative), serif;
  font-size: 16px;
  font-weight: 700;
  letter-spacing: 0.1em;
  background: linear-gradient(180deg, #fff6e0 0%, var(--xt-gold-bright, #f2d789) 100%);
  -webkit-background-clip: text;
          background-clip: text;
  color: transparent;
  -webkit-text-fill-color: transparent;
  text-shadow: 0 0 12px rgba(242, 215, 137, 0.32);
  line-height: 1;
}

.xt-home-mhead__brand-sub {
  font-family: var(--xt-font-decorative), serif;
  font-size: 8px;
  letter-spacing: 0.32em;
  text-transform: uppercase;
  color: var(--xt-jade-bright, #5fe3c6);
  margin-top: 2px;
}

.xt-home-mhead__icons {
  display: flex;
  align-items: center;
  gap: 6px;
  justify-content: flex-end;
}

.xt-home-mhead__icon {
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  border-radius: 12px;
  border: 1px solid rgba(242, 215, 137, 0.4);
  background: linear-gradient(180deg, rgba(20, 28, 38, 0.85) 0%, rgba(8, 9, 11, 0.95) 100%);
  color: var(--xt-text-primary, #f0e6cc);
  font-size: 18px;
  cursor: pointer;
}

.xt-home-mhead__icon:hover {
  border-color: rgba(242, 215, 137, 0.8);
  box-shadow: 0 0 12px rgba(242, 215, 137, 0.32);
}

.xt-home-mhead__icon:focus-visible {
  outline: 2px solid rgba(95, 227, 198, 0.6);
  outline-offset: 2px;
}

.xt-home-mhead__icon-badge {
  position: absolute;
  top: -4px;
  right: -4px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 16px;
  height: 16px;
  padding: 0 4px;
  border-radius: 999px;
  background: linear-gradient(180deg, #e75858 0%, #a02828 100%);
  border: 1px solid rgba(14, 19, 24, 0.9);
  color: #fff6e0;
  font-size: 9px;
  font-weight: 700;
}

.xt-home-mhead__strip {
  display: flex;
  gap: 6px;
  overflow-x: auto;
  scrollbar-width: none;
  padding-bottom: 2px;
  margin: 0 -4px;
  padding-left: 4px;
  padding-right: 4px;
}

.xt-home-mhead__strip::-webkit-scrollbar {
  display: none;
}

.xt-home-mhead__chip {
  flex: 1 1 auto;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 8px 6px 10px;
  border-radius: 999px;
  border: 1px solid var(--chip-border, rgba(242, 215, 137, 0.45));
  background: linear-gradient(180deg, rgba(20, 28, 38, 0.92) 0%, rgba(8, 9, 11, 0.98) 100%);
  color: var(--xt-text-primary, #f0e6cc);
  font-family: var(--xt-font-body);
  cursor: pointer;
  min-width: 0;
  white-space: nowrap;
  font-size: 11px;
}

.xt-home-mhead__chip:hover {
  border-color: var(--chip-border-hover, rgba(242, 215, 137, 0.85));
  box-shadow: 0 0 12px var(--chip-glow, rgba(242, 215, 137, 0.32));
}

.xt-home-mhead__chip:focus-visible {
  outline: 2px solid rgba(95, 227, 198, 0.6);
  outline-offset: 2px;
}

.xt-home-mhead__chip-glyph {
  font-size: 12px;
  filter: drop-shadow(0 0 4px var(--chip-glow, rgba(242, 215, 137, 0.4)));
}

.xt-home-mhead__chip-val {
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  letter-spacing: 0.02em;
  flex: 1 1 auto;
  min-width: 0;
}

.xt-home-mhead__chip-plus {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: linear-gradient(180deg, var(--xt-gold-bright, #f2d789), #b8893a);
  color: #1a1208;
  font-weight: 800;
  font-size: 10px;
  line-height: 1;
}

.xt-home-mhead__chip--jade { --chip-border: rgba(95, 227, 198, 0.55); --chip-border-hover: rgba(95, 227, 198, 0.85); --chip-glow: rgba(95, 227, 198, 0.38); }
.xt-home-mhead__chip--gold { --chip-border: rgba(242, 215, 137, 0.55); --chip-border-hover: rgba(242, 215, 137, 0.9); --chip-glow: rgba(242, 215, 137, 0.4); }
.xt-home-mhead__chip--violet { --chip-border: rgba(168, 132, 222, 0.55); --chip-border-hover: rgba(168, 132, 222, 0.9); --chip-glow: rgba(168, 132, 222, 0.4); }
.xt-home-mhead__chip--smoke { --chip-border: rgba(190, 196, 208, 0.45); --chip-border-hover: rgba(190, 196, 208, 0.8); --chip-glow: rgba(190, 196, 208, 0.35); }
.xt-home-mhead__chip--cyan { --chip-border: rgba(95, 227, 198, 0.55); --chip-border-hover: rgba(95, 227, 198, 0.9); --chip-glow: rgba(95, 227, 198, 0.4); }
.xt-home-mhead__chip--seal { --chip-border: rgba(208, 79, 79, 0.6); --chip-border-hover: rgba(208, 79, 79, 0.9); --chip-glow: rgba(208, 79, 79, 0.42); }
</style>
