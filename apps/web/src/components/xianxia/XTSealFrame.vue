<script setup lang="ts">
/**
 * Cửu Thiên Mộng — `XTSealFrame` (PR3.5 thuần Việt polish primitive).
 *
 * Wrap card "đạo thân" / hero với khung lacquer cổ phong: 4 viền vàng mỏng,
 * 4 triện chu (seal stamp) ở 4 góc in ký tự trang trí thuần Việt (mặc định
 * "❖✦❖✦"), optional vertical watermark letter dọc cạnh phải.
 *
 * Props (API mới — PR3.5):
 *   - `tone`: `gold` (default) | `jade` | `seal` — đổi màu viền + seal.
 *   - `cornerOrnaments`: chuỗi 4 ký tự ornament cho 4 góc
 *     (mặc định "❖✦❖✦"). Pad bằng glyph cuối nếu <4; truncate 4 đầu nếu >4.
 *     Truyền chuỗi rỗng để ẩn 4 góc.
 *   - `watermarkLetter`: 1 ký tự thuần Việt (vd "Đ", "T", "M") hiển thị
 *     mờ dọc cạnh phải. Tự cắt còn 1 ký tự.
 *   - `rounded`: `lg` (default) | `xl` | `2xl` để đồng bộ radius card.
 *   - `inset`: `tight` | `relaxed`.
 *   - `interactive`: hover lift / glow nhẹ.
 *   - `testId` / `ariaLabel`.
 *
 * Backward-compat: `cornerGlyphs` / `watermark` được giữ làm alias cho
 * `cornerOrnaments` / `watermarkLetter`. Nếu cả hai prop cùng truyền, prop
 * mới (`cornerOrnaments` / `watermarkLetter`) thắng. Các giá trị legacy
 * chứa ký tự Hán sẽ bị thay bằng default ornaments để giữ "thuần Việt".
 *
 * Reduced motion: shimmer trên seal tự dừng qua media-query.
 */
import { computed } from 'vue';

const DEFAULT_ORNAMENTS = '❖✦❖✦';
const HAN_RE = /[\u4e00-\u9fff]/;

const props = withDefaults(
  defineProps<{
    tone?: 'gold' | 'jade' | 'seal';
    cornerOrnaments?: string;
    /** @deprecated use `cornerOrnaments`. */
    cornerGlyphs?: string;
    watermarkLetter?: string | null;
    /** @deprecated use `watermarkLetter`. */
    watermark?: string | null;
    rounded?: 'lg' | 'xl' | '2xl';
    inset?: 'tight' | 'relaxed';
    interactive?: boolean;
    testId?: string;
    ariaLabel?: string;
  }>(),
  {
    tone: 'gold',
    cornerOrnaments: DEFAULT_ORNAMENTS,
    cornerGlyphs: undefined,
    watermarkLetter: null,
    watermark: undefined,
    rounded: 'xl',
    inset: 'relaxed',
    interactive: false,
    testId: 'xt-seal-frame',
    ariaLabel: undefined,
  },
);

/** Resolve ornament string ưu tiên prop mới, fallback prop legacy.
 *  Nếu chuỗi chứa ký tự Hán → ép về default ornaments thuần Việt. */
const resolvedOrnaments = computed<string>(() => {
  const newProp = props.cornerOrnaments;
  if (typeof newProp === 'string' && newProp !== DEFAULT_ORNAMENTS) {
    return HAN_RE.test(newProp) ? DEFAULT_ORNAMENTS : newProp;
  }
  if (typeof props.cornerGlyphs === 'string') {
    return HAN_RE.test(props.cornerGlyphs) ? DEFAULT_ORNAMENTS : props.cornerGlyphs;
  }
  return DEFAULT_ORNAMENTS;
});

/** Resolve watermark letter ưu tiên prop mới, fallback prop legacy. */
const resolvedWatermark = computed<string | null>(() => {
  const newProp = props.watermarkLetter;
  if (newProp != null && newProp.length > 0) {
    return HAN_RE.test(newProp) ? null : newProp.slice(0, 1);
  }
  if (props.watermark != null && props.watermark.length > 0) {
    return HAN_RE.test(props.watermark) ? null : props.watermark.slice(0, 1);
  }
  return null;
});

/** Pad / truncate ornaments thành đúng 4 ký tự (TL TR BL BR). */
const corners = computed<readonly [string, string, string, string]>(() => {
  const raw = resolvedOrnaments.value.slice(0, 4);
  if (raw.length === 0) return ['', '', '', ''] as const;
  const arr = [...raw];
  const last = arr[arr.length - 1] ?? '';
  while (arr.length < 4) arr.push(last);
  return [arr[0]!, arr[1]!, arr[2]!, arr[3]!] as const;
});

const showCorners = computed(() => resolvedOrnaments.value.length > 0);
</script>

<template>
  <div
    :class="[
      'xt-seal-frame',
      `xt-seal-frame--${tone}`,
      `xt-seal-frame--rounded-${rounded}`,
      `xt-seal-frame--inset-${inset}`,
      interactive ? 'xt-seal-frame--interactive' : '',
    ]"
    :data-testid="testId"
    :aria-label="ariaLabel"
  >
    <!-- Lacquered gold inner border (purely decorative). -->
    <span class="xt-seal-frame__border" aria-hidden="true" />

    <!-- 4 góc triện chu — lacquered red square stamp với ornament thuần Việt. -->
    <template v-if="showCorners">
      <span
        class="xt-seal-frame__corner xt-seal-frame__corner--tl"
        aria-hidden="true"
        :data-testid="`${testId}-corner-tl`"
      >{{ corners[0] }}</span>
      <span
        class="xt-seal-frame__corner xt-seal-frame__corner--tr"
        aria-hidden="true"
        :data-testid="`${testId}-corner-tr`"
      >{{ corners[1] }}</span>
      <span
        class="xt-seal-frame__corner xt-seal-frame__corner--bl"
        aria-hidden="true"
        :data-testid="`${testId}-corner-bl`"
      >{{ corners[2] }}</span>
      <span
        class="xt-seal-frame__corner xt-seal-frame__corner--br"
        aria-hidden="true"
        :data-testid="`${testId}-corner-br`"
      >{{ corners[3] }}</span>
    </template>

    <!-- Vertical watermark letter (decorative only). -->
    <span
      v-if="resolvedWatermark"
      class="xt-seal-frame__watermark"
      aria-hidden="true"
      :data-testid="`${testId}-watermark`"
    >{{ resolvedWatermark }}</span>

    <div class="xt-seal-frame__content">
      <slot />
    </div>
  </div>
</template>

<style scoped>
.xt-seal-frame {
  position: relative;
  display: block;
  isolation: isolate;
}

/* Rounded variants — match XianxiaCard / dashboard surface options. */
.xt-seal-frame--rounded-lg {
  border-radius: var(--xt-radius-lg);
}
.xt-seal-frame--rounded-xl {
  border-radius: var(--xt-radius-xl);
}
.xt-seal-frame--rounded-2xl {
  border-radius: calc(var(--xt-radius-xl) + 4px);
}

/* Inset content area — padding around slot so corners do not overlap text. */
.xt-seal-frame--inset-tight > .xt-seal-frame__content {
  padding: 0;
}
.xt-seal-frame--inset-relaxed > .xt-seal-frame__content {
  padding: 6px 6px 8px;
}

/* Inner lacquered border drawn via pseudo so it does not affect layout. */
.xt-seal-frame__border {
  position: absolute;
  inset: 2px;
  border-radius: inherit;
  pointer-events: none;
  border: 1px solid var(--frame-border, rgba(242, 215, 137, 0.42));
  box-shadow:
    inset 0 0 0 1px var(--frame-border-inner, rgba(242, 215, 137, 0.18)),
    inset 0 0 22px var(--frame-glow, rgba(242, 215, 137, 0.08));
  z-index: 1;
}

/* Tone palettes. */
.xt-seal-frame--gold {
  --frame-border: rgba(242, 215, 137, 0.48);
  --frame-border-inner: rgba(242, 215, 137, 0.2);
  --frame-glow: rgba(242, 215, 137, 0.12);
  --seal-bg: linear-gradient(135deg, #8a2a2a, #b23b3b);
  --seal-border: rgba(242, 215, 137, 0.62);
  --seal-text: #fff6e0;
  --watermark-color: rgba(242, 215, 137, 0.18);
}
.xt-seal-frame--jade {
  --frame-border: rgba(95, 227, 198, 0.46);
  --frame-border-inner: rgba(95, 227, 198, 0.18);
  --frame-glow: rgba(95, 227, 198, 0.1);
  --seal-bg: linear-gradient(135deg, #1b3b34, #2a6a5a);
  --seal-border: rgba(95, 227, 198, 0.6);
  --seal-text: #d8fff3;
  --watermark-color: rgba(95, 227, 198, 0.18);
}
.xt-seal-frame--seal {
  --frame-border: rgba(208, 79, 79, 0.52);
  --frame-border-inner: rgba(208, 79, 79, 0.22);
  --frame-glow: rgba(208, 79, 79, 0.16);
  --seal-bg: linear-gradient(135deg, #5a1c1c, #b23b3b);
  --seal-border: rgba(242, 215, 137, 0.55);
  --seal-text: #fff6e0;
  --watermark-color: rgba(208, 79, 79, 0.22);
}

/* 4 góc triện chu — lacquered red square với ornament thuần Việt. */
.xt-seal-frame__corner {
  position: absolute;
  z-index: 3;
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
  font-weight: 600;
  letter-spacing: 0;
  pointer-events: none;
  box-shadow:
    inset 0 1px 0 rgba(255, 246, 224, 0.2),
    0 0 12px rgba(0, 0, 0, 0.4);
}
.xt-seal-frame__corner--tl {
  top: -10px;
  left: -10px;
  transform: rotate(-3deg);
}
.xt-seal-frame__corner--tr {
  top: -10px;
  right: -10px;
  transform: rotate(3deg);
}
.xt-seal-frame__corner--bl {
  bottom: -10px;
  left: -10px;
  transform: rotate(3deg);
}
.xt-seal-frame__corner--br {
  bottom: -10px;
  right: -10px;
  transform: rotate(-3deg);
}

/* Vertical watermark letter — large pale glyph along the right edge. */
.xt-seal-frame__watermark {
  position: absolute;
  top: 50%;
  right: -2px;
  transform: translateY(-50%) rotate(0deg);
  font-family: var(--xt-font-decorative), var(--xt-font-display);
  font-size: clamp(64px, 8vw, 120px);
  line-height: 1;
  color: var(--watermark-color);
  letter-spacing: 0;
  pointer-events: none;
  user-select: none;
  z-index: 0;
  filter: blur(0.5px);
}

.xt-seal-frame__content {
  position: relative;
  z-index: 2;
  border-radius: inherit;
}

/* Interactive variant: very subtle hover lift mirroring `.xt-card--elevated`. */
.xt-seal-frame--interactive {
  transition:
    transform var(--xt-motion-base, 220ms) ease,
    box-shadow var(--xt-motion-base, 220ms) ease;
}
.xt-seal-frame--interactive:hover {
  transform: translateY(-2px);
}

@media (prefers-reduced-motion: reduce) {
  .xt-seal-frame--interactive {
    transition: none;
  }
  .xt-seal-frame--interactive:hover {
    transform: none;
  }
}
</style>
