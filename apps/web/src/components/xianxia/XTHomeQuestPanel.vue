<script setup lang="ts">
/**
 * Cửu Thiên Mộng — `XTHomeQuestPanel` (UI-3.2 recent quest panel).
 *
 * Panel "Nhiệm vụ gần đây" cho dashboard. Mỗi entry:
 *   - tag pill (Chính / Phụ / Tuần / Ngày)
 *   - title + subtitle
 *   - thanh progress + counter
 *   - cụm reward (glyph + amount)
 * Nút "Xem tất cả" ở header → route /missions.
 *
 * Có biến thể `compact` cho mobile (giảm padding, ẩn subtitle).
 */
import { useRouter } from 'vue-router';
import { type HomeQuest, type QuestTag } from '@/data/homeDashboardMock';

withDefaults(
  defineProps<{
    quests?: HomeQuest[];
    compact?: boolean;
    testId?: string;
  }>(),
  {
    quests: () => [],
    compact: false,
    testId: 'home-quest-panel',
  },
);

const router = useRouter();

const tagLabels: Record<QuestTag, string> = {
  main: 'Chính',
  side: 'Phụ',
  weekly: 'Tuần',
  daily: 'Ngày',
};

function openAll(): void {
  router.push('/missions').catch(() => null);
}
</script>

<template>
  <section
    class="xt-home-quest"
    :class="{ 'xt-home-quest--compact': compact }"
    :data-testid="testId"
    role="region"
    aria-label="Nhiệm vụ gần đây"
  >
    <header class="xt-home-quest__header">
      <p class="xt-home-quest__eyebrow">Bảng nhiệm vụ</p>
      <h2 class="xt-home-quest__title">Nhiệm vụ gần đây</h2>
      <button
        type="button"
        class="xt-home-quest__see-all"
        :data-testid="`${testId}-see-all`"
        @click="openAll"
      >
        Xem tất cả
        <span aria-hidden="true" class="xt-home-quest__see-all-arrow">→</span>
      </button>
    </header>

    <ul v-if="quests.length > 0" class="xt-home-quest__list">
      <li
        v-for="quest in quests"
        :key="quest.key"
        class="xt-home-quest__item"
        :class="`xt-home-quest__item--${quest.tag}`"
        :data-testid="`${testId}-item-${quest.key}`"
      >
        <span class="xt-home-quest__tag">{{ tagLabels[quest.tag] }}</span>
        <div class="xt-home-quest__body">
          <p class="xt-home-quest__quest-title">{{ quest.title }}</p>
          <p v-if="!compact" class="xt-home-quest__quest-sub">{{ quest.subtitle }}</p>
          <div class="xt-home-quest__progress">
            <div class="xt-home-quest__progress-bar" aria-hidden="true">
              <div
                class="xt-home-quest__progress-fill"
                :style="{ width: `${Math.min(100, Math.round((quest.progress.current / Math.max(quest.progress.total, 1)) * 100))}%` }"
              />
            </div>
            <span class="xt-home-quest__progress-counter">
              {{ quest.progress.current }}/{{ quest.progress.total }}
            </span>
          </div>
        </div>
        <span class="xt-home-quest__reward" :aria-label="`Thưởng ${quest.reward.amount}`">
          <span class="xt-home-quest__reward-glyph" aria-hidden="true">{{ quest.reward.glyph }}</span>
          <span class="xt-home-quest__reward-amount">{{ quest.reward.amount }}</span>
        </span>
      </li>
    </ul>
    <p
      v-else
      class="xt-home-quest__empty"
      :data-testid="`${testId}-empty`"
    >
      Chưa có nhiệm vụ đang theo đuổi.
    </p>
  </section>
</template>

<style scoped>
.xt-home-quest {
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

.xt-home-quest::before {
  content: '';
  position: absolute;
  inset: 6px;
  border-radius: 14px;
  border: 1px solid rgba(242, 215, 137, 0.1);
  pointer-events: none;
}

.xt-home-quest__header {
  display: grid;
  grid-template-columns: 1fr auto;
  align-items: end;
  gap: 4px 12px;
  position: relative;
}

.xt-home-quest__eyebrow {
  grid-column: 1 / 2;
  margin: 0;
  font-family: var(--xt-font-decorative), serif;
  font-size: 10px;
  letter-spacing: 0.32em;
  text-transform: uppercase;
  color: var(--xt-jade-bright, #5fe3c6);
}

.xt-home-quest__title {
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

.xt-home-quest__see-all {
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
  transition: border-color var(--xt-motion-base, 220ms) ease,
              box-shadow var(--xt-motion-base, 220ms) ease;
}

.xt-home-quest__see-all:hover {
  border-color: rgba(242, 215, 137, 0.85);
  box-shadow: 0 0 14px rgba(242, 215, 137, 0.32);
}

.xt-home-quest__see-all:focus-visible {
  outline: 2px solid rgba(95, 227, 198, 0.55);
  outline-offset: 2px;
}

.xt-home-quest__list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.xt-home-quest__empty {
  margin: 0;
  padding: 16px 12px;
  text-align: center;
  font-size: 12px;
  color: var(--xt-text-muted, rgba(208, 200, 180, 0.7));
  border-radius: 12px;
  border: 1px dashed rgba(242, 215, 137, 0.25);
  background: rgba(8, 9, 11, 0.5);
}

.xt-home-quest__item {
  display: grid;
  grid-template-columns: auto 1fr auto;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  border-radius: 14px;
  background: linear-gradient(180deg, rgba(28, 36, 46, 0.82) 0%, rgba(12, 16, 20, 0.92) 100%);
  border: 1px solid var(--quest-border, rgba(242, 215, 137, 0.25));
  transition: border-color var(--xt-motion-base, 220ms) ease,
              transform var(--xt-motion-fast, 140ms) ease;
}

.xt-home-quest__item:hover {
  transform: translateY(-1px);
  border-color: var(--quest-border-hover, rgba(242, 215, 137, 0.6));
}

.xt-home-quest__item--main {
  --quest-border: rgba(242, 215, 137, 0.45);
  --quest-border-hover: rgba(242, 215, 137, 0.85);
  --quest-tag-bg: linear-gradient(180deg, #f2d789 0%, #b8893a 100%);
  --quest-tag-fg: #1a1208;
}
.xt-home-quest__item--side {
  --quest-border: rgba(95, 227, 198, 0.42);
  --quest-border-hover: rgba(95, 227, 198, 0.85);
  --quest-tag-bg: linear-gradient(180deg, rgba(95, 227, 198, 0.85) 0%, rgba(38, 132, 110, 0.95) 100%);
  --quest-tag-fg: #0a1a15;
}
.xt-home-quest__item--weekly {
  --quest-border: rgba(168, 132, 222, 0.45);
  --quest-border-hover: rgba(168, 132, 222, 0.88);
  --quest-tag-bg: linear-gradient(180deg, rgba(168, 132, 222, 0.85) 0%, rgba(72, 44, 122, 0.95) 100%);
  --quest-tag-fg: #14091e;
}
.xt-home-quest__item--daily {
  --quest-border: rgba(208, 79, 79, 0.5);
  --quest-border-hover: rgba(208, 79, 79, 0.9);
  --quest-tag-bg: linear-gradient(180deg, rgba(231, 88, 88, 0.92) 0%, rgba(140, 32, 32, 0.95) 100%);
  --quest-tag-fg: #ffe6e0;
}

.xt-home-quest__tag {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 42px;
  padding: 4px 8px;
  border-radius: 8px;
  background: var(--quest-tag-bg, rgba(242, 215, 137, 0.8));
  color: var(--quest-tag-fg, #1a1208);
  font-family: var(--xt-font-decorative), serif;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  box-shadow: inset 0 0 0 1px rgba(255, 246, 224, 0.18);
}

.xt-home-quest__body {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}

.xt-home-quest__quest-title {
  margin: 0;
  font-family: var(--xt-font-display), serif;
  font-size: 13px;
  letter-spacing: 0.04em;
  color: var(--xt-scroll-paper-bright, #fff6e0);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.xt-home-quest__quest-sub {
  margin: 0;
  font-size: 11px;
  color: var(--xt-text-muted, rgba(208, 200, 180, 0.7));
  letter-spacing: 0.02em;
  line-height: 1.3;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.xt-home-quest__progress {
  display: grid;
  grid-template-columns: 1fr auto;
  align-items: center;
  gap: 8px;
}

.xt-home-quest__progress-bar {
  height: 5px;
  border-radius: 999px;
  background: rgba(14, 19, 24, 0.85);
  border: 1px solid rgba(242, 215, 137, 0.22);
  overflow: hidden;
}

.xt-home-quest__progress-fill {
  height: 100%;
  background: linear-gradient(90deg, var(--xt-jade-bright, #5fe3c6) 0%, var(--xt-gold-bright, #f2d789) 100%);
  box-shadow: 0 0 10px rgba(242, 215, 137, 0.4);
  transition: width var(--xt-motion-slow, 360ms) ease;
}

.xt-home-quest__progress-counter {
  font-family: var(--xt-font-decorative), serif;
  font-size: 11px;
  letter-spacing: 0.08em;
  color: var(--xt-jade-bright, #5fe3c6);
  font-variant-numeric: tabular-nums;
}

.xt-home-quest__reward {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 6px 10px;
  border-radius: 12px;
  background: linear-gradient(180deg, rgba(58, 46, 24, 0.85) 0%, rgba(28, 22, 12, 0.95) 100%);
  border: 1px solid rgba(242, 215, 137, 0.45);
  color: var(--xt-gold-bright, #f2d789);
  font-size: 12px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
}

.xt-home-quest__reward-glyph {
  font-size: 14px;
}

.xt-home-quest--compact {
  padding: 12px;
}

.xt-home-quest--compact .xt-home-quest__title {
  font-size: 15px;
}

@media (prefers-reduced-motion: reduce) {
  .xt-home-quest__item {
    transition: none;
  }
  .xt-home-quest__item:hover {
    transform: none;
  }
}
</style>
