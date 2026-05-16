<script setup lang="ts">
/**
 * Cửu Thiên Mộng — `XTHomeInventoryPanel` (UI-3.2 inventory & equipment panel).
 *
 * Panel "Trang bị & Túi đồ". Bố cục 2 cột:
 *   - cột trái: nhân vật silhouette ở giữa, các slot trang bị bao quanh
 *     (top-left, mid-left, bottom-left, top-right, mid-right, bottom-right).
 *   - cột phải: grid mini items 4×3 (placeholder slot) + thông tin
 *     capacity (86/120) + gear power (2.156.780).
 *
 * Silhouette là SVG thuần (không cần asset PNG) — gradient jade/gold + halo.
 */
import { useRouter } from 'vue-router';
import {
  equipmentSlots,
  inventoryPanel,
  type HomeEquipmentSlot,
} from '@/data/homeDashboardMock';

withDefaults(
  defineProps<{
    slots?: HomeEquipmentSlot[];
    info?: typeof inventoryPanel;
    compact?: boolean;
    testId?: string;
  }>(),
  {
    slots: () => equipmentSlots,
    info: () => inventoryPanel,
    compact: false,
    testId: 'home-inventory-panel',
  },
);

const router = useRouter();

function slotAt(position: HomeEquipmentSlot['position']): HomeEquipmentSlot | undefined {
  return equipmentSlots.find((s) => s.position === position);
}

function openInventory(): void {
  router.push('/inventory').catch(() => null);
}
</script>

<template>
  <section
    class="xt-home-inv"
    :class="{ 'xt-home-inv--compact': compact }"
    :data-testid="testId"
    role="region"
    aria-label="Trang bị và túi đồ"
  >
    <header class="xt-home-inv__header">
      <p class="xt-home-inv__eyebrow">Sổ trang bị</p>
      <h2 class="xt-home-inv__title">{{ info.title }}</h2>
      <button
        type="button"
        class="xt-home-inv__see-all"
        :data-testid="`${testId}-see-all`"
        @click="openInventory"
      >
        Mở túi đồ <span aria-hidden="true">→</span>
      </button>
    </header>

    <div class="xt-home-inv__body">
      <div class="xt-home-inv__avatar-area" aria-hidden="true">
        <div class="xt-home-inv__avatar">
          <svg viewBox="0 0 120 180" class="xt-home-inv__avatar-svg">
            <defs>
              <linearGradient id="xt-inv-avatar-fill" x1="0" x2="0" y1="0" y2="1">
                <stop offset="0%" stop-color="#1c3b34" />
                <stop offset="100%" stop-color="#0a1219" />
              </linearGradient>
              <radialGradient id="xt-inv-avatar-halo" cx="50%" cy="40%" r="50%">
                <stop offset="0%" stop-color="rgba(95, 227, 198, 0.55)" />
                <stop offset="60%" stop-color="rgba(242, 215, 137, 0.18)" />
                <stop offset="100%" stop-color="rgba(0, 0, 0, 0)" />
              </radialGradient>
            </defs>
            <ellipse cx="60" cy="80" rx="58" ry="78" fill="url(#xt-inv-avatar-halo)" />
            <path
              d="M60 30 c14 0 22 12 22 24 c0 10 -6 18 -14 22 c14 6 24 22 26 38 l4 50 l-76 0 l4 -50 c2 -16 12 -32 26 -38 c-8 -4 -14 -12 -14 -22 c0 -12 8 -24 22 -24 z"
              fill="url(#xt-inv-avatar-fill)"
              stroke="rgba(242, 215, 137, 0.45)"
              stroke-width="1.2"
            />
            <circle cx="60" cy="54" r="4" fill="rgba(242, 215, 137, 0.85)" opacity="0.9" />
            <path
              d="M30 130 Q60 110 90 130"
              stroke="rgba(95, 227, 198, 0.45)"
              stroke-width="1"
              fill="none"
              stroke-dasharray="2 3"
            />
          </svg>
        </div>

        <span
          v-for="slot in ['topLeft','midLeft','bottomLeft','topRight','midRight','bottomRight']"
          :key="slot"
          class="xt-home-inv__slot"
          :class="`xt-home-inv__slot--${slot}`"
        >
          <template v-if="slotAt(slot as HomeEquipmentSlot['position'])">
            <span
              class="xt-home-inv__slot-glyph"
              :class="`xt-home-inv__slot-glyph--${slotAt(slot as HomeEquipmentSlot['position'])!.tone}`"
            >{{ slotAt(slot as HomeEquipmentSlot['position'])!.glyph }}</span>
            <span class="xt-home-inv__slot-plus">+{{ slotAt(slot as HomeEquipmentSlot['position'])!.plus }}</span>
          </template>
        </span>
      </div>

      <div class="xt-home-inv__sidebar">
        <p class="xt-home-inv__meta-label">Lực chiến trang bị</p>
        <p class="xt-home-inv__meta-value">{{ info.gearPower }}</p>
        <p class="xt-home-inv__meta-label">Túi đồ</p>
        <div class="xt-home-inv__capacity">
          <div class="xt-home-inv__capacity-bar">
            <div
              class="xt-home-inv__capacity-fill"
              :style="{ width: `${Math.round((info.capacity.current / Math.max(info.capacity.total, 1)) * 100)}%` }"
            />
          </div>
          <span class="xt-home-inv__capacity-text">
            {{ info.capacity.current }}/{{ info.capacity.total }}
          </span>
        </div>

        <div class="xt-home-inv__grid">
          <span
            v-for="i in 12"
            :key="i"
            class="xt-home-inv__grid-cell"
            :class="{ 'xt-home-inv__grid-cell--filled': i <= 7 }"
            aria-hidden="true"
          >
            <span v-if="i <= 7" class="xt-home-inv__grid-glyph">◇</span>
          </span>
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped>
.xt-home-inv {
  position: relative;
  isolation: isolate;
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 16px;
  border-radius: 18px;
  background: linear-gradient(180deg, rgba(20, 28, 38, 0.86) 0%, rgba(8, 9, 11, 0.96) 100%);
  border: 1px solid rgba(242, 215, 137, 0.32);
  box-shadow: 0 18px 32px rgba(0, 0, 0, 0.42);
  color: var(--xt-text-primary, #f0e6cc);
  min-width: 0;
}

.xt-home-inv::before {
  content: '';
  position: absolute;
  inset: 6px;
  border-radius: 14px;
  border: 1px solid rgba(242, 215, 137, 0.1);
  pointer-events: none;
}

.xt-home-inv__header {
  display: grid;
  grid-template-columns: 1fr auto;
  align-items: end;
  gap: 4px 12px;
}

.xt-home-inv__eyebrow {
  grid-column: 1 / 2;
  margin: 0;
  font-family: var(--xt-font-decorative), serif;
  font-size: 10px;
  letter-spacing: 0.32em;
  text-transform: uppercase;
  color: var(--xt-jade-bright, #5fe3c6);
}

.xt-home-inv__title {
  grid-column: 1 / 2;
  margin: 0;
  font-family: var(--xt-font-display), serif;
  font-size: 18px;
  letter-spacing: 0.06em;
  background: linear-gradient(180deg, #fff6e0 0%, var(--xt-gold-bright, #f2d789) 100%);
  -webkit-background-clip: text;
          background-clip: text;
  color: transparent;
  -webkit-text-fill-color: transparent;
}

.xt-home-inv__see-all {
  grid-column: 2 / 3;
  grid-row: 1 / 3;
  align-self: end;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 6px 12px;
  border-radius: 999px;
  border: 1px solid rgba(242, 215, 137, 0.45);
  background: linear-gradient(180deg, rgba(28, 36, 46, 0.85) 0%, rgba(8, 9, 11, 0.95) 100%);
  color: var(--xt-gold-bright, #f2d789);
  font-family: var(--xt-font-body);
  font-size: 11px;
  letter-spacing: 0.12em;
  cursor: pointer;
}

.xt-home-inv__see-all:hover {
  border-color: rgba(242, 215, 137, 0.85);
  box-shadow: 0 0 12px rgba(242, 215, 137, 0.3);
}

.xt-home-inv__see-all:focus-visible {
  outline: 2px solid rgba(95, 227, 198, 0.55);
  outline-offset: 2px;
}

.xt-home-inv__body {
  display: grid;
  grid-template-columns: 180px 1fr;
  gap: 14px;
  align-items: stretch;
}

@media (max-width: 768px) {
  .xt-home-inv__body {
    grid-template-columns: 140px 1fr;
  }
}

.xt-home-inv__avatar-area {
  position: relative;
  border-radius: 14px;
  background:
    radial-gradient(80% 80% at 50% 30%, rgba(95, 227, 198, 0.12) 0%, transparent 70%),
    linear-gradient(180deg, rgba(12, 18, 24, 0.95) 0%, rgba(6, 8, 11, 0.98) 100%);
  border: 1px solid rgba(242, 215, 137, 0.22);
  min-height: 220px;
  padding: 14px 8px;
  overflow: hidden;
}

.xt-home-inv__avatar {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
}

.xt-home-inv__avatar-svg {
  width: 60%;
  height: 80%;
  filter: drop-shadow(0 0 18px rgba(95, 227, 198, 0.28));
}

.xt-home-inv__slot {
  position: absolute;
  width: 40px;
  height: 40px;
  border-radius: 12px;
  background: linear-gradient(180deg, rgba(20, 28, 38, 0.92) 0%, rgba(8, 9, 11, 0.96) 100%);
  border: 1px solid rgba(242, 215, 137, 0.4);
  box-shadow: inset 0 0 8px rgba(255, 246, 224, 0.08), 0 0 12px rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
}

.xt-home-inv__slot--topLeft { top: 16px; left: 10px; }
.xt-home-inv__slot--midLeft { top: 50%; left: 10px; transform: translateY(-50%); }
.xt-home-inv__slot--bottomLeft { bottom: 16px; left: 10px; }
.xt-home-inv__slot--topRight { top: 16px; right: 10px; }
.xt-home-inv__slot--midRight { top: 50%; right: 10px; transform: translateY(-50%); }
.xt-home-inv__slot--bottomRight { bottom: 16px; right: 10px; }

.xt-home-inv__slot-glyph {
  position: relative;
  font-size: 18px;
  color: var(--xt-gold-bright, #f2d789);
  filter: drop-shadow(0 0 6px rgba(242, 215, 137, 0.4));
}
.xt-home-inv__slot-glyph--jade { color: var(--xt-jade-bright, #5fe3c6); filter: drop-shadow(0 0 6px rgba(95, 227, 198, 0.4)); }
.xt-home-inv__slot-glyph--cyan { color: #9ee3ee; filter: drop-shadow(0 0 6px rgba(98, 200, 220, 0.4)); }
.xt-home-inv__slot-glyph--seal { color: #ff8b88; filter: drop-shadow(0 0 6px rgba(208, 79, 79, 0.4)); }
.xt-home-inv__slot-glyph--violet { color: #c8b6f0; filter: drop-shadow(0 0 6px rgba(168, 132, 222, 0.4)); }

.xt-home-inv__slot-plus {
  position: absolute;
  bottom: -8px;
  right: -4px;
  padding: 1px 4px;
  border-radius: 6px;
  background: linear-gradient(180deg, var(--xt-gold-bright, #f2d789) 0%, #b8893a 100%);
  color: #1a1208;
  font-family: var(--xt-font-decorative), serif;
  font-size: 9px;
  font-weight: 800;
}

.xt-home-inv__sidebar {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
}

.xt-home-inv__meta-label {
  margin: 0;
  font-size: 10px;
  letter-spacing: 0.26em;
  text-transform: uppercase;
  color: var(--xt-text-muted, rgba(208, 200, 180, 0.7));
}

.xt-home-inv__meta-value {
  margin: 0 0 6px;
  font-family: var(--xt-font-display), serif;
  font-size: 18px;
  font-weight: 700;
  letter-spacing: 0.04em;
  background: linear-gradient(180deg, #fff6e0 0%, var(--xt-gold-bright, #f2d789) 100%);
  -webkit-background-clip: text;
          background-clip: text;
  color: transparent;
  -webkit-text-fill-color: transparent;
}

.xt-home-inv__capacity {
  display: grid;
  grid-template-columns: 1fr auto;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
}

.xt-home-inv__capacity-bar {
  height: 6px;
  border-radius: 999px;
  background: rgba(14, 19, 24, 0.85);
  border: 1px solid rgba(242, 215, 137, 0.28);
  overflow: hidden;
}

.xt-home-inv__capacity-fill {
  height: 100%;
  background: linear-gradient(90deg, var(--xt-jade-bright, #5fe3c6) 0%, var(--xt-gold-bright, #f2d789) 100%);
  box-shadow: 0 0 10px rgba(242, 215, 137, 0.45);
}

.xt-home-inv__capacity-text {
  font-family: var(--xt-font-decorative), serif;
  font-size: 11px;
  letter-spacing: 0.06em;
  color: var(--xt-jade-bright, #5fe3c6);
  font-variant-numeric: tabular-nums;
}

.xt-home-inv__grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 6px;
}

.xt-home-inv__grid-cell {
  position: relative;
  aspect-ratio: 1 / 1;
  border-radius: 8px;
  background: linear-gradient(180deg, rgba(20, 28, 38, 0.85) 0%, rgba(8, 9, 11, 0.95) 100%);
  border: 1px solid rgba(242, 215, 137, 0.25);
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--xt-text-muted, rgba(208, 200, 180, 0.7));
}

.xt-home-inv__grid-cell--filled {
  border-color: rgba(95, 227, 198, 0.5);
  box-shadow: inset 0 0 8px rgba(95, 227, 198, 0.18);
  color: var(--xt-jade-bright, #5fe3c6);
}

.xt-home-inv__grid-glyph {
  font-size: 16px;
  filter: drop-shadow(0 0 6px rgba(95, 227, 198, 0.5));
}

.xt-home-inv--compact .xt-home-inv__body {
  grid-template-columns: 1fr;
}
.xt-home-inv--compact .xt-home-inv__avatar-area {
  min-height: 180px;
}
</style>
