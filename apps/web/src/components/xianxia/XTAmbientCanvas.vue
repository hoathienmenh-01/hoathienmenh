<script setup lang="ts">
/**
 * Cửu Thiên Mộng — `XTAmbientCanvas` (UI-3.1 luxury polish).
 *
 * Lớp khí quyển cinematic toàn app, đặt phía sau `XTParallaxBackground` và
 * `SpiritualAmbientLayer` đã có để bổ sung depth + lux feel mà không thay
 * đổi layout. Gồm 3 layer:
 *
 *   1. Gradient mesh — 4 radial glow ở 4 góc (jade + gold + smoke + mist)
 *      + 1 vignette ink ở trung tâm dưới, tạo cảm giác "sảnh đường tiên môn".
 *   2. Filigree halo — 2 vành tròn khắc kim tuyến mờ xoay chậm khi không
 *      reduce-motion, tăng sự sang trọng cho hero block trung tâm.
 *   3. Constellation motes — chấm sáng nhỏ rải rác giả lập sao trời, dùng
 *      box-shadow tổng hợp (CSS only, không cần JS animation).
 *
 *  Reduced-motion: dừng toàn bộ animation, layer vẫn render tĩnh.
 *  Z-index: `-z-20` để luôn nằm phía sau `XTParallaxBackground` (`-z-10`).
 *
 *  Phase 10 performance heuristic:
 *  - Trước render đo `deviceMemory` + `hardwareConcurrency` để detect low-end
 *    device. Nếu low-end (memory ≤ 2GB hoặc CPU ≤ 2 luồng) thì giảm intensity.
 *  - Sau khi mount đo FPS qua rAF; nếu trung bình < 30 fps trong 60 frame
 *    đầu thì set `quality = 'reduced'` (CSS dim mesh + halo, motes off).
 *  - Không tự ý tắt hoàn toàn — vẫn giữ layer tĩnh để không vỡ layout.
 */
import { onBeforeUnmount, onMounted, ref } from 'vue';

const props = withDefaults(
  defineProps<{
    /** Tone phối màu mesh theo nhóm scene. */
    tone?: 'default' | 'cultivation' | 'boss' | 'secret' | 'sect' | 'market';
    /** Cường độ ambient (sang trọng cho hero, dim cho list). */
    intensity?: 'soft' | 'medium' | 'lux';
    /** Test/SSR hook: ép quality nếu caller đã biết FPS. */
    forceQuality?: 'auto' | 'full' | 'reduced';
  }>(),
  {
    tone: 'default',
    intensity: 'lux',
    forceQuality: 'auto',
  },
);

type Quality = 'full' | 'reduced';

function detectLowEndDevice(): boolean {
  if (typeof navigator === 'undefined') return false;
  const nav = navigator as Navigator & {
    deviceMemory?: number;
    hardwareConcurrency?: number;
  };
  if (typeof nav.deviceMemory === 'number' && nav.deviceMemory > 0 && nav.deviceMemory <= 2) {
    return true;
  }
  if (typeof nav.hardwareConcurrency === 'number' && nav.hardwareConcurrency > 0 && nav.hardwareConcurrency <= 2) {
    return true;
  }
  return false;
}

function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return false;
  }
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

const quality = ref<Quality>(
  props.forceQuality === 'reduced' || (props.forceQuality === 'auto' && detectLowEndDevice())
    ? 'reduced'
    : 'full',
);

let rafId: number | null = null;
let fpsFrames = 0;
let fpsAccumMs = 0;
let lastTs: number | null = null;
let sampleDeadline = 0;

function measureFps(ts: number): void {
  if (lastTs !== null) {
    const dt = ts - lastTs;
    if (dt > 0 && dt < 1000) {
      fpsAccumMs += dt;
      fpsFrames += 1;
    }
  }
  lastTs = ts;
  // Sample window: 60 frames or 2s, whichever first.
  if (fpsFrames < 60 && ts < sampleDeadline) {
    rafId = requestAnimationFrame(measureFps);
    return;
  }
  const avg = fpsFrames > 0 ? (fpsFrames * 1000) / fpsAccumMs : 60;
  if (avg < 30 && props.forceQuality === 'auto') {
    quality.value = 'reduced';
  }
  rafId = null;
}

onMounted(() => {
  if (props.forceQuality !== 'auto') return;
  if (typeof window === 'undefined' || typeof requestAnimationFrame !== 'function') return;
  // Skip FPS measurement when reduced-motion is on — animations are paused,
  // so the sample would always be ~60fps but give no useful signal.
  if (prefersReducedMotion()) return;
  sampleDeadline = performance.now() + 2000;
  rafId = requestAnimationFrame(measureFps);
});

onBeforeUnmount(() => {
  if (rafId !== null && typeof cancelAnimationFrame === 'function') {
    cancelAnimationFrame(rafId);
    rafId = null;
  }
});
</script>

<template>
  <div
    class="xt-ambient pointer-events-none fixed inset-0 -z-20 overflow-hidden"
    :data-tone="tone"
    :data-intensity="intensity"
    :data-quality="quality"
    aria-hidden="true"
    data-testid="xt-ambient-canvas"
  >
    <div class="xt-ambient__mesh" />
    <div class="xt-ambient__halo xt-ambient__halo--outer" />
    <div class="xt-ambient__halo xt-ambient__halo--inner" />
    <div class="xt-ambient__motes" />
    <div class="xt-ambient__vignette" />
  </div>
</template>

<style scoped>
.xt-ambient {
  background:
    radial-gradient(
      130% 90% at 50% 110%,
      var(--xt-mesh-ink, rgba(8, 9, 11, 0.95)) 30%,
      transparent 70%
    ),
    linear-gradient(
      180deg,
      var(--xt-ink-deep, #0e1318) 0%,
      var(--xt-ink-base, #131922) 40%,
      var(--xt-ink-deep, #0e1318) 100%
    );
}

/* Mesh layer: 4 radial glow corners + soft top center for hero presence. */
.xt-ambient__mesh {
  position: absolute;
  inset: -8%;
  background:
    radial-gradient(
      circle at 12% 14%,
      var(--xt-mesh-gold, rgba(242, 215, 137, 0.16)) 0%,
      transparent 38%
    ),
    radial-gradient(
      circle at 90% 18%,
      var(--xt-mesh-jade, rgba(95, 227, 198, 0.16)) 0%,
      transparent 42%
    ),
    radial-gradient(
      circle at 10% 88%,
      var(--xt-mesh-smoke, rgba(169, 159, 212, 0.14)) 0%,
      transparent 44%
    ),
    radial-gradient(
      circle at 88% 86%,
      var(--xt-mesh-seal, rgba(208, 79, 79, 0.12)) 0%,
      transparent 42%
    ),
    radial-gradient(
      ellipse at 50% -10%,
      var(--xt-mesh-gold, rgba(242, 215, 137, 0.14)) 0%,
      transparent 55%
    );
  filter: saturate(1.05);
  animation: xt-mesh-shift 38s ease-in-out infinite alternate;
}

.xt-ambient[data-intensity='soft'] .xt-ambient__mesh {
  opacity: 0.6;
}

.xt-ambient[data-intensity='medium'] .xt-ambient__mesh {
  opacity: 0.8;
}

/* Tone overrides — keep base mesh and just shift accent corner. */
.xt-ambient[data-tone='cultivation'] .xt-ambient__mesh {
  background-blend-mode: screen;
}
.xt-ambient[data-tone='boss'] .xt-ambient__mesh {
  filter: saturate(1.1) hue-rotate(-6deg);
}
.xt-ambient[data-tone='secret'] .xt-ambient__mesh {
  filter: saturate(0.95) hue-rotate(8deg);
}
.xt-ambient[data-tone='sect'] .xt-ambient__mesh,
.xt-ambient[data-tone='market'] .xt-ambient__mesh {
  filter: saturate(1.05) brightness(1.04);
}

/* Filigree halo: two concentric rings drawn via conic gradient, masked to
   thin rims. Adds cinematic "spotlight" feel behind the hero region. */
.xt-ambient__halo {
  position: absolute;
  left: 50%;
  top: -10%;
  width: clamp(540px, 90vmin, 1100px);
  aspect-ratio: 1 / 1;
  transform: translateX(-50%);
  border-radius: 50%;
  background:
    conic-gradient(
      from 210deg,
      rgba(242, 215, 137, 0.0) 0deg,
      rgba(242, 215, 137, 0.22) 60deg,
      rgba(242, 215, 137, 0.0) 130deg,
      rgba(95, 227, 198, 0.18) 220deg,
      rgba(242, 215, 137, 0.0) 320deg
    );
  -webkit-mask: radial-gradient(
    closest-side,
    transparent 58%,
    rgba(0, 0, 0, 0.9) 60%,
    rgba(0, 0, 0, 0.9) 61%,
    transparent 63%
  );
          mask: radial-gradient(
    closest-side,
    transparent 58%,
    rgba(0, 0, 0, 0.9) 60%,
    rgba(0, 0, 0, 0.9) 61%,
    transparent 63%
  );
  opacity: 0.55;
  animation: xt-halo-spin 90s linear infinite;
}

.xt-ambient__halo--inner {
  width: clamp(380px, 60vmin, 760px);
  top: -2%;
  opacity: 0.4;
  animation-duration: 130s;
  animation-direction: reverse;
}

.xt-ambient[data-intensity='soft'] .xt-ambient__halo {
  opacity: 0.28;
}
.xt-ambient[data-intensity='medium'] .xt-ambient__halo {
  opacity: 0.42;
}

/* Reduced quality (low-end device hoặc FPS đo được < 30):
   - Dim mesh + halo ~40% strength
   - Tắt motes layer (chiếm nhiều paint nhất do nhiều radial-gradient)
   - Dừng halo spin để tiết kiệm GPU */
.xt-ambient[data-quality='reduced'] .xt-ambient__mesh {
  opacity: 0.4;
  animation: none;
}
.xt-ambient[data-quality='reduced'] .xt-ambient__halo {
  opacity: 0.18;
  animation: none;
}
.xt-ambient[data-quality='reduced'] .xt-ambient__motes {
  display: none;
}

/* Constellation motes via stacked box-shadow on a 1px point.
   Mỗi điểm là 1 mote nhỏ; chia 2 mật độ + 2 độ sáng để giả lập sao trời. */
.xt-ambient__motes {
  position: absolute;
  inset: 0;
  background:
    radial-gradient(
      1.2px 1.2px at 4% 12%,
      rgba(242, 215, 137, 0.55) 50%,
      transparent 100%
    ),
    radial-gradient(
      1px 1px at 18% 32%,
      rgba(255, 246, 224, 0.55) 50%,
      transparent 100%
    ),
    radial-gradient(
      1.2px 1.2px at 28% 8%,
      rgba(185, 214, 232, 0.5) 50%,
      transparent 100%
    ),
    radial-gradient(
      1px 1px at 38% 22%,
      rgba(242, 215, 137, 0.45) 50%,
      transparent 100%
    ),
    radial-gradient(
      1.4px 1.4px at 52% 6%,
      rgba(95, 227, 198, 0.55) 50%,
      transparent 100%
    ),
    radial-gradient(
      1px 1px at 64% 18%,
      rgba(255, 246, 224, 0.5) 50%,
      transparent 100%
    ),
    radial-gradient(
      1.2px 1.2px at 76% 10%,
      rgba(242, 215, 137, 0.55) 50%,
      transparent 100%
    ),
    radial-gradient(
      1px 1px at 86% 28%,
      rgba(169, 159, 212, 0.55) 50%,
      transparent 100%
    ),
    radial-gradient(
      1.2px 1.2px at 96% 14%,
      rgba(255, 246, 224, 0.55) 50%,
      transparent 100%
    ),
    radial-gradient(
      1px 1px at 8% 58%,
      rgba(242, 215, 137, 0.45) 50%,
      transparent 100%
    ),
    radial-gradient(
      1.2px 1.2px at 22% 74%,
      rgba(95, 227, 198, 0.45) 50%,
      transparent 100%
    ),
    radial-gradient(
      1px 1px at 44% 92%,
      rgba(255, 246, 224, 0.4) 50%,
      transparent 100%
    ),
    radial-gradient(
      1.2px 1.2px at 68% 82%,
      rgba(242, 215, 137, 0.45) 50%,
      transparent 100%
    ),
    radial-gradient(
      1px 1px at 84% 64%,
      rgba(185, 214, 232, 0.45) 50%,
      transparent 100%
    ),
    radial-gradient(
      1.4px 1.4px at 94% 86%,
      rgba(242, 215, 137, 0.5) 50%,
      transparent 100%
    );
  background-repeat: no-repeat;
  opacity: 0.85;
  animation: xt-mote-twinkle 7s ease-in-out infinite alternate;
}

/* Soft bottom vignette to anchor the page in deep ink. */
.xt-ambient__vignette {
  position: absolute;
  inset: 0;
  background:
    radial-gradient(
      120% 65% at 50% 105%,
      rgba(0, 0, 0, 0.6) 0%,
      transparent 65%
    ),
    linear-gradient(
      0deg,
      rgba(0, 0, 0, 0.35) 0%,
      transparent 28%
    );
}

@keyframes xt-mesh-shift {
  0% {
    transform: translate3d(-1.5%, -1%, 0) scale(1.02);
  }
  100% {
    transform: translate3d(2%, 1.5%, 0) scale(1.04);
  }
}

@keyframes xt-halo-spin {
  to {
    transform: translateX(-50%) rotate(360deg);
  }
}

@keyframes xt-mote-twinkle {
  0% {
    opacity: 0.7;
    filter: brightness(0.95);
  }
  100% {
    opacity: 1;
    filter: brightness(1.15);
  }
}

/* Day theme — soften mesh + raise vignette so the same canvas reads bright. */
:global(:root[data-theme='day']) .xt-ambient {
  background:
    radial-gradient(
      130% 90% at 50% 110%,
      rgba(247, 251, 248, 0.96) 30%,
      transparent 70%
    ),
    linear-gradient(
      180deg,
      #f7fbf8 0%,
      #eef6f0 60%,
      #f7fbf8 100%
    );
}
:global(:root[data-theme='day']) .xt-ambient__motes {
  opacity: 0.45;
}
:global(:root[data-theme='day']) .xt-ambient__vignette {
  background:
    radial-gradient(
      120% 65% at 50% 105%,
      rgba(50, 60, 60, 0.18) 0%,
      transparent 65%
    );
}

@media (prefers-reduced-motion: reduce) {
  .xt-ambient__mesh,
  .xt-ambient__halo,
  .xt-ambient__motes {
    animation: none;
  }
}
</style>
