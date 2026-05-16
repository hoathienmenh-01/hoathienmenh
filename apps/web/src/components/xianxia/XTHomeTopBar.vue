<script setup lang="ts">
/**
 * Cửu Thiên Mộng — `XTHomeTopBar` (UI-3.2 luxury top bar).
 *
 * Top bar dashboard desktop: avatar nhân vật + tên + cảnh giới + lực chiến,
 * cụm pill tài nguyên (linh thạch / tiên ngọc / tử tinh / danh vọng) với nút
 * `+`, và row icon (thư-badge / bạn bè / quà / vương miện / menu) phía phải.
 *
 * KHÔNG đụng store — props-only. Emit `claim-resource` (key) khi click `+`,
 * `open-menu` cho icon menu, `open-mail` / `open-friends` / `open-gift` cho
 * các icon top-right.
 */
import {
  playerHeader,
  resources as defaultResources,
  topbarMail,
  type HomeResource,
} from '@/data/homeDashboardMock';

withDefaults(
  defineProps<{
    player?: typeof playerHeader;
    resources?: HomeResource[];
    mailBadge?: number;
    friendBadge?: number;
    testId?: string;
  }>(),
  {
    player: () => playerHeader,
    resources: () => defaultResources,
    mailBadge: () => topbarMail.badge,
    friendBadge: 1,
    testId: 'home-topbar',
  },
);

defineEmits<{
  'claim-resource': [key: string];
  'open-menu': [];
  'open-mail': [];
  'open-friends': [];
  'open-gift': [];
  'open-vip': [];
}>();
</script>

<template>
  <header
    class="xt-home-topbar"
    :data-testid="testId"
    role="banner"
  >
    <div class="xt-home-topbar__player" :data-testid="`${testId}-player`">
      <div class="xt-home-topbar__avatar" aria-hidden="true">
        <span class="xt-home-topbar__avatar-glyph">{{ player.avatarGlyph }}</span>
        <span class="xt-home-topbar__avatar-level">{{ player.level }}</span>
      </div>
      <div class="xt-home-topbar__player-text">
        <div class="xt-home-topbar__name-row">
          <span class="xt-home-topbar__name" :data-testid="`${testId}-name`">{{ player.name }}</span>
          <span class="xt-home-topbar__realm-pill">{{ player.realm }}</span>
        </div>
        <div class="xt-home-topbar__power-row">
          <span class="xt-home-topbar__power-label">Lực chiến</span>
          <span class="xt-home-topbar__power-value" :data-testid="`${testId}-power`">{{ player.power }}</span>
        </div>
      </div>
      <div class="xt-home-topbar__stage" :data-testid="`${testId}-stage`">
        <span class="xt-home-topbar__stage-glyph" aria-hidden="true">◈</span>
        <span class="xt-home-topbar__stage-label">{{ player.realm }}</span>
        <span class="xt-home-topbar__stage-value">{{ player.stagePill }}</span>
      </div>
    </div>

    <div
      class="xt-home-topbar__resources"
      :data-testid="`${testId}-resources`"
      role="group"
      aria-label="Tài nguyên"
    >
      <button
        v-for="r in resources"
        :key="r.key"
        type="button"
        class="xt-home-topbar__chip"
        :class="`xt-home-topbar__chip--${r.tone}`"
        :data-testid="`${testId}-chip-${r.key}`"
        :aria-label="`${r.label}: ${r.value}, bấm để mở`"
        @click="$emit('claim-resource', r.key)"
      >
        <span class="xt-home-topbar__chip-glyph" aria-hidden="true">{{ r.glyph }}</span>
        <span class="xt-home-topbar__chip-value">{{ r.value }}</span>
        <span class="xt-home-topbar__chip-plus" aria-hidden="true">＋</span>
      </button>
    </div>

    <div class="xt-home-topbar__icons" role="group" aria-label="Thao tác hệ thống">
      <button
        type="button"
        class="xt-home-topbar__icon"
        :data-testid="`${testId}-icon-mail`"
        aria-label="Hộp thư"
        @click="$emit('open-mail')"
      >
        <span aria-hidden="true">✉</span>
        <span
          v-if="mailBadge > 0"
          class="xt-home-topbar__icon-badge"
        >{{ mailBadge > 9 ? '9+' : mailBadge }}</span>
      </button>
      <button
        type="button"
        class="xt-home-topbar__icon"
        :data-testid="`${testId}-icon-friends`"
        aria-label="Bạn bè"
        @click="$emit('open-friends')"
      >
        <span aria-hidden="true">☘</span>
        <span
          v-if="friendBadge > 0"
          class="xt-home-topbar__icon-badge"
        >{{ friendBadge > 9 ? '9+' : friendBadge }}</span>
      </button>
      <button
        type="button"
        class="xt-home-topbar__icon"
        :data-testid="`${testId}-icon-gift`"
        aria-label="Quà tặng"
        @click="$emit('open-gift')"
      >
        <span aria-hidden="true">🎁</span>
      </button>
      <button
        type="button"
        class="xt-home-topbar__icon"
        :data-testid="`${testId}-icon-vip`"
        aria-label="Vương miện"
        @click="$emit('open-vip')"
      >
        <span aria-hidden="true">♛</span>
      </button>
      <button
        type="button"
        class="xt-home-topbar__icon"
        :data-testid="`${testId}-icon-menu`"
        aria-label="Mở menu"
        @click="$emit('open-menu')"
      >
        <span aria-hidden="true">≡</span>
      </button>
    </div>
  </header>
</template>

<style scoped>
.xt-home-topbar {
  position: relative;
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 10px 18px;
  background:
    linear-gradient(90deg, rgba(14, 19, 24, 0.88) 0%, rgba(12, 16, 20, 0.92) 60%, rgba(14, 19, 24, 0.88) 100%);
  border-bottom: 1px solid var(--xt-border-gold, rgba(242, 215, 137, 0.35));
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.35);
  flex-wrap: wrap;
}

.xt-home-topbar::after {
  content: '';
  position: absolute;
  left: 0;
  right: 0;
  bottom: -1px;
  height: 1px;
  background: linear-gradient(
    90deg,
    transparent 0%,
    rgba(242, 215, 137, 0.45) 50%,
    transparent 100%
  );
}

.xt-home-topbar__player {
  display: flex;
  align-items: center;
  gap: 12px;
  min-width: 0;
}

.xt-home-topbar__avatar {
  position: relative;
  width: 48px;
  height: 48px;
  border-radius: 14px;
  background: radial-gradient(circle at 30% 30%, rgba(95, 227, 198, 0.25), rgba(14, 19, 24, 0.92));
  border: 1px solid var(--xt-border-gold, rgba(242, 215, 137, 0.55));
  box-shadow: 0 0 20px rgba(95, 227, 198, 0.18), inset 0 0 12px rgba(255, 246, 224, 0.08);
  display: flex;
  align-items: center;
  justify-content: center;
  flex: 0 0 48px;
}

.xt-home-topbar__avatar-glyph {
  font-size: 24px;
  color: var(--xt-jade-bright, #5fe3c6);
  text-shadow: 0 0 12px rgba(95, 227, 198, 0.5);
}

.xt-home-topbar__avatar-level {
  position: absolute;
  bottom: -6px;
  right: -6px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 24px;
  height: 18px;
  padding: 0 5px;
  border-radius: 9px;
  background: linear-gradient(180deg, #f2d789 0%, #b8893a 100%);
  border: 1px solid rgba(14, 19, 24, 0.9);
  color: #1a1208;
  font-size: 10px;
  font-weight: 800;
  letter-spacing: 0.05em;
  box-shadow: 0 0 10px rgba(242, 215, 137, 0.5);
}

.xt-home-topbar__player-text {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.xt-home-topbar__name-row {
  display: flex;
  align-items: center;
  gap: 8px;
}

.xt-home-topbar__name {
  font-family: var(--xt-font-display), serif;
  font-size: 18px;
  font-weight: 700;
  letter-spacing: 0.08em;
  color: var(--xt-scroll-paper-bright, #fff6e0);
  text-shadow: 0 0 12px rgba(242, 215, 137, 0.28);
}

.xt-home-topbar__realm-pill {
  display: inline-flex;
  align-items: center;
  padding: 2px 10px;
  border-radius: 999px;
  background: linear-gradient(180deg, rgba(27, 59, 52, 0.85), rgba(12, 30, 26, 0.9));
  border: 1px solid rgba(95, 227, 198, 0.45);
  font-family: var(--xt-font-decorative), serif;
  font-size: 11px;
  letter-spacing: 0.16em;
  color: var(--xt-jade-bright, #5fe3c6);
}

.xt-home-topbar__power-row {
  display: flex;
  align-items: baseline;
  gap: 6px;
}

.xt-home-topbar__power-label {
  font-size: 10px;
  letter-spacing: 0.24em;
  text-transform: uppercase;
  color: var(--xt-text-muted, rgba(208, 200, 180, 0.68));
}

.xt-home-topbar__power-value {
  font-family: var(--xt-font-display), serif;
  font-size: 16px;
  font-weight: 700;
  background: linear-gradient(180deg, #fff6e0 0%, var(--xt-gold-bright, #f2d789) 100%);
  -webkit-background-clip: text;
          background-clip: text;
  color: transparent;
  -webkit-text-fill-color: transparent;
}

.xt-home-topbar__stage {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 10px;
  border-radius: 12px;
  background: linear-gradient(180deg, rgba(58, 46, 24, 0.85) 0%, rgba(28, 22, 12, 0.9) 100%);
  border: 1px solid rgba(242, 215, 137, 0.5);
  margin-left: 6px;
}

.xt-home-topbar__stage-glyph {
  color: var(--xt-gold-bright, #f2d789);
  font-size: 14px;
}

.xt-home-topbar__stage-label {
  font-size: 10px;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: var(--xt-text-soft, #d8d0bf);
}

.xt-home-topbar__stage-value {
  font-family: var(--xt-font-decorative), serif;
  font-size: 12px;
  letter-spacing: 0.18em;
  color: var(--xt-gold-bright, #f2d789);
}

.xt-home-topbar__resources {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-left: auto;
  flex-wrap: wrap;
}

.xt-home-topbar__chip {
  position: relative;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 6px 8px 6px 12px;
  border-radius: 999px;
  border: 1px solid var(--chip-border, rgba(242, 215, 137, 0.45));
  background:
    linear-gradient(180deg, rgba(20, 28, 38, 0.88) 0%, rgba(8, 9, 11, 0.96) 100%);
  color: var(--xt-text-primary, #f0e6cc);
  font-family: var(--xt-font-body);
  cursor: pointer;
  transition: border-color var(--xt-motion-base, 220ms) ease,
              box-shadow var(--xt-motion-base, 220ms) ease,
              transform var(--xt-motion-fast, 140ms) ease;
}

.xt-home-topbar__chip:hover {
  border-color: var(--chip-border-hover, rgba(242, 215, 137, 0.85));
  box-shadow: 0 0 16px var(--chip-glow, rgba(242, 215, 137, 0.32));
  transform: translateY(-1px);
}

.xt-home-topbar__chip:focus-visible {
  outline: 2px solid rgba(95, 227, 198, 0.6);
  outline-offset: 2px;
}

.xt-home-topbar__chip-glyph {
  font-size: 14px;
  filter: drop-shadow(0 0 6px var(--chip-glow, rgba(242, 215, 137, 0.4)));
}

.xt-home-topbar__chip-value {
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  letter-spacing: 0.02em;
  font-size: 13px;
}

.xt-home-topbar__chip-plus {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  background: linear-gradient(180deg, var(--xt-gold-bright, #f2d789), #b8893a);
  color: #1a1208;
  font-weight: 800;
  font-size: 11px;
  line-height: 1;
}

.xt-home-topbar__chip--jade {
  --chip-border: rgba(95, 227, 198, 0.55);
  --chip-border-hover: rgba(95, 227, 198, 0.85);
  --chip-glow: rgba(95, 227, 198, 0.38);
}
.xt-home-topbar__chip--gold {
  --chip-border: rgba(242, 215, 137, 0.55);
  --chip-border-hover: rgba(242, 215, 137, 0.9);
  --chip-glow: rgba(242, 215, 137, 0.4);
}
.xt-home-topbar__chip--violet {
  --chip-border: rgba(168, 132, 222, 0.55);
  --chip-border-hover: rgba(168, 132, 222, 0.9);
  --chip-glow: rgba(168, 132, 222, 0.4);
}
.xt-home-topbar__chip--smoke {
  --chip-border: rgba(190, 196, 208, 0.45);
  --chip-border-hover: rgba(190, 196, 208, 0.8);
  --chip-glow: rgba(190, 196, 208, 0.35);
}
.xt-home-topbar__chip--seal {
  --chip-border: rgba(208, 79, 79, 0.6);
  --chip-border-hover: rgba(208, 79, 79, 0.9);
  --chip-glow: rgba(208, 79, 79, 0.42);
}
.xt-home-topbar__chip--cyan {
  --chip-border: rgba(95, 227, 198, 0.55);
  --chip-border-hover: rgba(95, 227, 198, 0.9);
  --chip-glow: rgba(95, 227, 198, 0.4);
}

.xt-home-topbar__icons {
  display: flex;
  align-items: center;
  gap: 6px;
}

.xt-home-topbar__icon {
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  border-radius: 12px;
  border: 1px solid rgba(242, 215, 137, 0.35);
  background: linear-gradient(180deg, rgba(20, 28, 38, 0.85) 0%, rgba(8, 9, 11, 0.95) 100%);
  color: var(--xt-text-primary, #f0e6cc);
  font-size: 18px;
  cursor: pointer;
  transition: border-color var(--xt-motion-base, 220ms) ease,
              box-shadow var(--xt-motion-base, 220ms) ease,
              transform var(--xt-motion-fast, 140ms) ease;
}

.xt-home-topbar__icon:hover {
  border-color: rgba(242, 215, 137, 0.75);
  box-shadow: 0 0 14px rgba(242, 215, 137, 0.32);
  transform: translateY(-1px);
}

.xt-home-topbar__icon:focus-visible {
  outline: 2px solid rgba(95, 227, 198, 0.6);
  outline-offset: 2px;
}

.xt-home-topbar__icon-badge {
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
  letter-spacing: 0.04em;
  box-shadow: 0 0 8px rgba(208, 79, 79, 0.4);
}

@media (max-width: 1280px) {
  .xt-home-topbar__stage {
    display: none;
  }
}

@media (prefers-reduced-motion: reduce) {
  .xt-home-topbar__chip,
  .xt-home-topbar__icon {
    transition: none;
  }
  .xt-home-topbar__chip:hover,
  .xt-home-topbar__icon:hover {
    transform: none;
  }
}
</style>
