<script setup lang="ts">
/**
 * Empty state cao cấp — title + description + glyph illustration + CTA slot.
 *
 * Props:
 *  - titleKey / descriptionKey: i18n keys (mặc định 'common.empty.*').
 *  - tone: gold (default) | jade | seal | neutral — đổi màu glyph + viền.
 *  - glyph: ký tự đại diện ('❀' default) — đèn lẻ loi, cuộn thư trống.
 */
import { useI18n } from 'vue-i18n';

const props = withDefaults(
  defineProps<{
    titleKey?: string;
    descriptionKey?: string;
    tone?: 'gold' | 'jade' | 'seal' | 'neutral';
    glyph?: string;
    testId?: string;
  }>(),
  {
    titleKey: 'common.empty.title',
    descriptionKey: 'common.empty.description',
    tone: 'gold',
    glyph: '❀',
    testId: 'empty-state',
  },
);
const { t } = useI18n();
</script>

<template>
  <div
    class="xt-empty"
    :class="`xt-empty--${props.tone}`"
    :data-testid="props.testId"
    role="status"
  >
    <div class="xt-empty__glyph" aria-hidden="true">{{ props.glyph }}</div>
    <h3 class="xt-empty__title text-amber-200 text-base">
      {{ t(props.titleKey) }}
    </h3>
    <p class="xt-empty__desc text-xs text-ink-300">
      {{ t(props.descriptionKey) }}
    </p>
    <div class="pt-2"><slot /></div>
  </div>
</template>

<style scoped>
.xt-empty {
  position: relative;
  padding: 28px 20px;
  border: 1px solid var(--xt-empty-border, rgba(242, 215, 137, 0.25));
  border-radius: 18px;
  background:
    radial-gradient(
      120% 80% at 50% 0%,
      var(--xt-empty-glow, rgba(242, 215, 137, 0.06)) 0%,
      transparent 70%
    ),
    linear-gradient(180deg, rgba(20, 28, 38, 0.55) 0%, rgba(14, 19, 24, 0.7) 100%);
  text-align: center;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
}
.xt-empty__glyph {
  font-family: var(--xt-font-decorative), serif;
  font-size: 40px;
  line-height: 1;
  color: var(--xt-empty-glyph, rgba(242, 215, 137, 0.55));
  text-shadow: 0 0 14px var(--xt-empty-glow, rgba(242, 215, 137, 0.32));
  margin-bottom: 6px;
}
.xt-empty__title {
  font-family: var(--xt-font-display), serif;
  letter-spacing: 0.04em;
}
.xt-empty__desc {
  max-width: 48ch;
  margin: 0 auto;
  line-height: 1.5;
}

.xt-empty--gold {
  --xt-empty-border: rgba(242, 215, 137, 0.28);
  --xt-empty-glow: rgba(242, 215, 137, 0.14);
  --xt-empty-glyph: rgba(242, 215, 137, 0.62);
}
.xt-empty--jade {
  --xt-empty-border: rgba(95, 227, 198, 0.28);
  --xt-empty-glow: rgba(95, 227, 198, 0.14);
  --xt-empty-glyph: rgba(95, 227, 198, 0.62);
}
.xt-empty--seal {
  --xt-empty-border: rgba(208, 79, 79, 0.3);
  --xt-empty-glow: rgba(208, 79, 79, 0.14);
  --xt-empty-glyph: rgba(208, 79, 79, 0.62);
}
.xt-empty--neutral {
  --xt-empty-border: rgba(185, 214, 232, 0.22);
  --xt-empty-glow: rgba(185, 214, 232, 0.1);
  --xt-empty-glyph: rgba(185, 214, 232, 0.52);
}
</style>
