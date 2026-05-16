<script setup lang="ts">
/**
 * Cửu Thiên Mộng — `XTHomeStatTiles` (UI-3.2 luxury stat tiles row).
 *
 * Hàng 6 ô stat dưới hero banner. Mỗi ô:
 *   - icon glyph lớn bên trái (gradient + glow theo tone).
 *   - label nhỏ uppercase trên cùng.
 *   - value lớn (gradient gold).
 *   - hint nhỏ (delta / rate / meta).
 * Tone variants: jade / seal / cyan / gold / violet (xanh ngọc).
 *
 * Mobile mặc định 2 cột, desktop 6 cột (responsive).
 */
import { statTiles, type HomeStatTile } from '@/data/homeDashboardMock';

withDefaults(
  defineProps<{
    tiles?: HomeStatTile[];
    columns?: 'auto' | 'four' | 'six';
    testId?: string;
  }>(),
  {
    tiles: () => statTiles,
    columns: 'auto',
    testId: 'home-stat-tiles',
  },
);
</script>

<template>
  <section
    class="xt-home-stat-tiles"
    :class="`xt-home-stat-tiles--${columns}`"
    :data-testid="testId"
    role="list"
    aria-label="Chỉ số tổng quan"
  >
    <article
      v-for="tile in tiles"
      :key="tile.key"
      class="xt-home-stat-tile"
      :class="`xt-home-stat-tile--${tile.tone}`"
      :data-testid="`${testId}-tile-${tile.key}`"
      role="listitem"
    >
      <span class="xt-home-stat-tile__glyph" aria-hidden="true">{{ tile.glyph }}</span>
      <div class="xt-home-stat-tile__body">
        <p class="xt-home-stat-tile__label">{{ tile.label }}</p>
        <p class="xt-home-stat-tile__value">{{ tile.value }}</p>
        <p v-if="tile.hint" class="xt-home-stat-tile__hint">
          {{ tile.hint }}
          <span v-if="tile.hint.startsWith('Tăng') || tile.hint.startsWith('+')" aria-hidden="true" class="xt-home-stat-tile__hint-arrow">▲</span>
        </p>
        <p v-if="tile.meta" class="xt-home-stat-tile__meta">{{ tile.meta }}</p>
      </div>
    </article>
  </section>
</template>

<style scoped>
.xt-home-stat-tiles {
  display: grid;
  gap: 10px;
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

@media (min-width: 768px) {
  .xt-home-stat-tiles--auto,
  .xt-home-stat-tiles--four {
    grid-template-columns: repeat(4, minmax(0, 1fr));
  }
}

@media (min-width: 1280px) {
  .xt-home-stat-tiles--auto,
  .xt-home-stat-tiles--six {
    grid-template-columns: repeat(6, minmax(0, 1fr));
  }
}

.xt-home-stat-tile {
  position: relative;
  isolation: isolate;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px 14px;
  border-radius: 16px;
  background: linear-gradient(180deg, rgba(20, 28, 38, 0.86) 0%, rgba(8, 9, 11, 0.96) 100%);
  border: 1px solid var(--tile-border, rgba(242, 215, 137, 0.32));
  box-shadow:
    inset 0 0 0 1px rgba(255, 246, 224, 0.05),
    0 0 18px var(--tile-glow, rgba(242, 215, 137, 0.12));
  transition: border-color var(--xt-motion-base, 220ms) ease,
              box-shadow var(--xt-motion-base, 220ms) ease,
              transform var(--xt-motion-fast, 140ms) ease;
  overflow: hidden;
}

.xt-home-stat-tile:hover {
  transform: translateY(-1px);
  border-color: var(--tile-border-hover, rgba(242, 215, 137, 0.7));
  box-shadow:
    inset 0 0 0 1px rgba(255, 246, 224, 0.05),
    0 0 24px var(--tile-glow, rgba(242, 215, 137, 0.24));
}

.xt-home-stat-tile::before {
  content: '';
  position: absolute;
  inset: 4px;
  border-radius: 12px;
  border: 1px solid rgba(242, 215, 137, 0.08);
  pointer-events: none;
}

.xt-home-stat-tile__glyph {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 40px;
  height: 40px;
  flex: 0 0 40px;
  border-radius: 12px;
  background: linear-gradient(180deg, rgba(28, 36, 46, 0.9) 0%, rgba(8, 9, 11, 0.95) 100%);
  border: 1px solid var(--tile-border, rgba(242, 215, 137, 0.42));
  color: var(--tile-icon, #fff6e0);
  font-size: 22px;
  filter: drop-shadow(0 0 8px var(--tile-glow, rgba(242, 215, 137, 0.4)));
}

.xt-home-stat-tile__body {
  display: flex;
  flex-direction: column;
  gap: 0;
  min-width: 0;
  flex: 1 1 auto;
}

.xt-home-stat-tile__label {
  margin: 0;
  font-family: var(--xt-font-decorative), serif;
  font-size: 10px;
  letter-spacing: 0.28em;
  text-transform: uppercase;
  color: var(--xt-text-muted, rgba(208, 200, 180, 0.72));
}

.xt-home-stat-tile__value {
  margin: 2px 0 0;
  font-family: var(--xt-font-display), serif;
  font-size: clamp(15px, 1.6vw, 18px);
  font-weight: 700;
  letter-spacing: 0.02em;
  background: linear-gradient(180deg, #fff6e0 0%, var(--xt-gold-bright, #f2d789) 100%);
  -webkit-background-clip: text;
          background-clip: text;
  color: transparent;
  -webkit-text-fill-color: transparent;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.xt-home-stat-tile__hint {
  margin: 2px 0 0;
  font-size: 11px;
  color: var(--xt-jade-bright, #5fe3c6);
  letter-spacing: 0.04em;
}

.xt-home-stat-tile__hint-arrow {
  font-size: 9px;
  margin-left: 3px;
  color: var(--xt-jade-bright, #5fe3c6);
}

.xt-home-stat-tile__meta {
  margin: 2px 0 0;
  font-size: 11px;
  color: var(--xt-text-muted, rgba(208, 200, 180, 0.72));
  letter-spacing: 0.04em;
}

/* tone palettes */
.xt-home-stat-tile--jade {
  --tile-border: rgba(95, 227, 198, 0.4);
  --tile-border-hover: rgba(95, 227, 198, 0.85);
  --tile-glow: rgba(95, 227, 198, 0.32);
  --tile-icon: var(--xt-jade-bright, #5fe3c6);
}
.xt-home-stat-tile--seal {
  --tile-border: rgba(208, 79, 79, 0.5);
  --tile-border-hover: rgba(208, 79, 79, 0.9);
  --tile-glow: rgba(208, 79, 79, 0.34);
  --tile-icon: #ff8b88;
}
.xt-home-stat-tile--cyan {
  --tile-border: rgba(95, 227, 198, 0.42);
  --tile-border-hover: rgba(95, 227, 198, 0.88);
  --tile-glow: rgba(98, 200, 220, 0.32);
  --tile-icon: #9ee3ee;
}
.xt-home-stat-tile--gold {
  --tile-border: rgba(242, 215, 137, 0.55);
  --tile-border-hover: rgba(242, 215, 137, 0.92);
  --tile-glow: rgba(242, 215, 137, 0.4);
  --tile-icon: var(--xt-gold-bright, #f2d789);
}
.xt-home-stat-tile--violet {
  --tile-border: rgba(168, 132, 222, 0.5);
  --tile-border-hover: rgba(168, 132, 222, 0.92);
  --tile-glow: rgba(168, 132, 222, 0.36);
  --tile-icon: #c8b6f0;
}
.xt-home-stat-tile--smoke {
  --tile-border: rgba(190, 196, 208, 0.45);
  --tile-border-hover: rgba(190, 196, 208, 0.85);
  --tile-glow: rgba(190, 196, 208, 0.3);
  --tile-icon: #d6dae3;
}

@media (prefers-reduced-motion: reduce) {
  .xt-home-stat-tile {
    transition: none;
  }
  .xt-home-stat-tile:hover {
    transform: none;
  }
}
</style>
