<script setup lang="ts">
/**
 * Cửu Thiên Mộng — `XTSealDivider` (Phase 5 decorative primitive).
 *
 * Dải phân cách section cổ phong. Đường gold mỏng kéo từ 2 bên, một con
 * "triện chu" (seal) hình vuông nhỏ ở giữa đè lên đường — gợi tới ấn son
 * triện trên giấy tranh thủy mặc.
 *
 * Có 3 mode:
 *   - `default`: seal hình vuông in chữ Hán (prop `glyph`, default 「天」).
 *   - `dot`: seal là 1 chấm tròn jade — dùng trong minimal admin.
 *   - `bare`: chỉ dải gold không có seal — dùng giữa các tile bento dày.
 *
 * Props:
 *   - `glyph`: 1 ký tự Hán hiển thị trong seal (auto giới hạn 1-2 char).
 *   - `align`: `center` | `left` | `right` — vị trí seal trên dải.
 *   - `tone`: `gold` (default) | `jade` | `seal` cho màu dải/khung.
 *   - `width`: prop dạng CSS length cho dài tối đa, hoặc `full`.
 */
import { computed } from 'vue';

const props = withDefaults(
  defineProps<{
    mode?: 'default' | 'dot' | 'bare';
    glyph?: string;
    align?: 'center' | 'left' | 'right';
    tone?: 'gold' | 'jade' | 'seal';
    width?: string;
    testId?: string;
    ariaLabel?: string;
  }>(),
  {
    mode: 'default',
    glyph: '天',
    align: 'center',
    tone: 'gold',
    width: 'full',
    testId: 'xt-seal-divider',
    ariaLabel: undefined,
  },
);

const widthStyle = computed(() => {
  if (props.width === 'full') return { width: '100%' };
  return { width: props.width, maxWidth: '100%' };
});

const truncatedGlyph = computed(() => (props.glyph ?? '').slice(0, 2));
</script>

<template>
  <div
    :class="[
      'xt-seal-divider',
      `xt-seal-divider--${tone}`,
      `xt-seal-divider--align-${align}`,
      `xt-seal-divider--mode-${mode}`,
    ]"
    :style="widthStyle"
    role="separator"
    :aria-label="ariaLabel ?? 'Section divider'"
    :data-testid="testId"
  >
    <span class="xt-seal-divider__line" aria-hidden="true" />
    <span
      v-if="mode === 'default'"
      class="xt-seal-divider__seal"
      aria-hidden="true"
    >{{ truncatedGlyph }}</span>
    <span
      v-else-if="mode === 'dot'"
      class="xt-seal-divider__dot"
      aria-hidden="true"
    />
    <span v-if="mode !== 'bare'" class="xt-seal-divider__line" aria-hidden="true" />
    <span v-else class="xt-seal-divider__line" aria-hidden="true" />
  </div>
</template>

<style scoped>
.xt-seal-divider {
  display: flex;
  align-items: center;
  gap: 12px;
  margin: 14px auto;
  pointer-events: none;
}

.xt-seal-divider__line {
  flex: 1 1 0;
  height: 1px;
  background: linear-gradient(
    90deg,
    transparent 0%,
    var(--line-tone, rgba(242, 215, 137, 0.4)) 35%,
    var(--line-tone, rgba(242, 215, 137, 0.6)) 50%,
    var(--line-tone, rgba(242, 215, 137, 0.4)) 65%,
    transparent 100%
  );
}

.xt-seal-divider--gold {
  --line-tone: rgba(242, 215, 137, 0.5);
  --seal-bg: linear-gradient(135deg, #8a2a2a, #b23b3b);
  --seal-border: rgba(242, 215, 137, 0.55);
  --seal-text: #fff6e0;
  --dot-color: var(--xt-gold-bright);
}
.xt-seal-divider--jade {
  --line-tone: rgba(95, 227, 198, 0.5);
  --seal-bg: linear-gradient(135deg, #1b3b34, #2a6a5a);
  --seal-border: rgba(95, 227, 198, 0.55);
  --seal-text: #d8fff3;
  --dot-color: var(--xt-jade-bright);
}
.xt-seal-divider--seal {
  --line-tone: rgba(208, 79, 79, 0.5);
  --seal-bg: linear-gradient(135deg, #882a2a, #b23b3b);
  --seal-border: rgba(208, 79, 79, 0.7);
  --seal-text: #fff6e0;
  --dot-color: var(--xt-seal-bright);
}

.xt-seal-divider__seal {
  flex: 0 0 auto;
  width: 26px;
  height: 26px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 4px;
  background: var(--seal-bg);
  border: 1px solid var(--seal-border);
  color: var(--seal-text);
  font-family: var(--xt-font-decorative), var(--xt-font-display);
  font-size: 14px;
  letter-spacing: 0;
  font-weight: 600;
  box-shadow:
    inset 0 1px 0 rgba(255, 246, 224, 0.18),
    0 0 12px rgba(0, 0, 0, 0.4);
  transform: rotate(-2deg);
}

.xt-seal-divider__dot {
  flex: 0 0 auto;
  width: 6px;
  height: 6px;
  border-radius: 999px;
  background: var(--dot-color);
  box-shadow: 0 0 8px var(--dot-color);
  opacity: 0.85;
}

.xt-seal-divider--align-left .xt-seal-divider__line:first-child {
  flex: 0 0 24px;
}
.xt-seal-divider--align-right .xt-seal-divider__line:last-child {
  flex: 0 0 24px;
}

.xt-seal-divider--mode-bare {
  gap: 0;
}
</style>
