<script setup lang="ts">
/**
 * Cửu Thiên Mộng Phase 3 module C — ParticleField (canvas).
 *
 * Lớp particle nền cho các cảnh hoành tráng:
 *   - `qi-rising` — hạt qi bay lên (Tribulation, breakthrough scene).
 *   - `petal-fall` — cánh hoa anh đào rơi (Sect home, ambient).
 *   - `ember-spark` — tia lửa nổ tỏa (Boss fight intro).
 *
 * Tôn trọng `visualEffectLevel`:
 *   - OFF  → component không render canvas (return null).
 *   - LOW  → ~20 hạt.
 *   - MEDIUM → ~60 hạt (default).
 *   - HIGH → ~120 hạt.
 *
 * Tôn trọng `reducedMotion` → không chạy RAF, particle vẽ tĩnh 1 lần.
 *
 * Pointer-events: none, aria-hidden="true" — purely decorative.
 */
import { onMounted, onUnmounted, ref, watch } from 'vue';
import { particleCountForLevel, type ParticleVariant, type ParticleLevel } from '@/lib/particleField';

const props = withDefaults(
  defineProps<{
    variant?: ParticleVariant;
    visualEffectLevel?: ParticleLevel;
    reducedMotion?: boolean;
    testId?: string;
  }>(),
  {
    variant: 'qi-rising',
    visualEffectLevel: 'MEDIUM',
    reducedMotion: false,
    testId: 'particle-field',
  },
);

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  alpha: number;
  hue: number;
  life: number;
  maxLife: number;
}

const canvasRef = ref<HTMLCanvasElement | null>(null);
let rafId = 0;
let particles: Particle[] = [];
let lastWidth = 0;
let lastHeight = 0;
let resizeObserver: ResizeObserver | null = null;

function rand(min: number, max: number): number {
  return Math.random() * (max - min) + min;
}

function spawnParticle(
  variant: ParticleVariant,
  w: number,
  h: number,
  fromBottom = true,
): Particle {
  switch (variant) {
    case 'qi-rising': {
      // Hạt qi: xuất phát đáy, bay lên, hơi lệch ngang.
      const maxLife = rand(180, 320);
      return {
        x: rand(0, w),
        y: fromBottom ? h + rand(0, 24) : rand(0, h),
        vx: rand(-0.15, 0.15),
        vy: rand(-1.4, -0.6),
        size: rand(1.4, 2.6),
        alpha: rand(0.25, 0.7),
        hue: 145 + rand(-12, 18), // jade green
        life: 0,
        maxLife,
      };
    }
    case 'petal-fall': {
      // Cánh hoa: xuất phát đỉnh, rơi xuống, dao động ngang.
      const maxLife = rand(280, 480);
      return {
        x: rand(0, w),
        y: fromBottom ? rand(-24, 0) : rand(0, h),
        vx: rand(-0.4, 0.4),
        vy: rand(0.3, 0.9),
        size: rand(2.0, 3.4),
        alpha: rand(0.35, 0.65),
        hue: 330 + rand(-8, 14), // pink petal
        life: 0,
        maxLife,
      };
    }
    case 'ember-spark': {
      // Tia lửa: phát từ tâm, tỏa mọi hướng nhanh, fade nhanh.
      const angle = rand(0, Math.PI * 2);
      const speed = rand(0.8, 2.4);
      const maxLife = rand(60, 140);
      return {
        x: w / 2 + rand(-w * 0.1, w * 0.1),
        y: h / 2 + rand(-h * 0.1, h * 0.1),
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        size: rand(1.6, 3.0),
        alpha: rand(0.5, 0.95),
        hue: 28 + rand(-6, 12), // ember orange
        life: 0,
        maxLife,
      };
    }
  }
}

function reseed(): void {
  const canvas = canvasRef.value;
  if (!canvas) return;
  const w = canvas.width;
  const h = canvas.height;
  const count = particleCountForLevel(props.visualEffectLevel);
  particles = [];
  for (let i = 0; i < count; i++) {
    particles.push(spawnParticle(props.variant, w, h, false));
  }
}

function resizeCanvasToContainer(): void {
  const canvas = canvasRef.value;
  if (!canvas) return;
  const parent = canvas.parentElement;
  if (!parent) return;
  const rect = parent.getBoundingClientRect();
  const w = Math.max(1, Math.floor(rect.width));
  const h = Math.max(1, Math.floor(rect.height));
  if (w === lastWidth && h === lastHeight) return;
  lastWidth = w;
  lastHeight = h;
  canvas.width = w;
  canvas.height = h;
}

function drawFrame(): void {
  const canvas = canvasRef.value;
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const w = canvas.width;
  const h = canvas.height;
  ctx.clearRect(0, 0, w, h);
  ctx.globalCompositeOperation = 'lighter';
  for (let i = 0; i < particles.length; i++) {
    const p = particles[i];
    const lifeRatio = p.life / p.maxLife;
    const alpha = p.alpha * (1 - lifeRatio);
    ctx.beginPath();
    ctx.fillStyle = `hsla(${p.hue}, 78%, 68%, ${alpha.toFixed(3)})`;
    ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
    ctx.fill();
  }
}

function step(): void {
  const canvas = canvasRef.value;
  if (!canvas) {
    rafId = 0;
    return;
  }
  const w = canvas.width;
  const h = canvas.height;
  for (let i = 0; i < particles.length; i++) {
    const p = particles[i];
    p.x += p.vx;
    p.y += p.vy;
    p.life += 1;
    // Recycle khi rời canvas hoặc hết life — respawn cùng variant.
    if (
      p.life >= p.maxLife ||
      p.x < -8 ||
      p.x > w + 8 ||
      p.y < -16 ||
      p.y > h + 16
    ) {
      particles[i] = spawnParticle(props.variant, w, h, true);
    }
  }
  drawFrame();
  rafId = requestAnimationFrame(step);
}

function teardown(): void {
  if (rafId) {
    cancelAnimationFrame(rafId);
    rafId = 0;
  }
  if (resizeObserver) {
    resizeObserver.disconnect();
    resizeObserver = null;
  }
}

function start(): void {
  if (props.visualEffectLevel === 'OFF') return;
  resizeCanvasToContainer();
  reseed();
  drawFrame();
  if (props.reducedMotion) return;
  rafId = requestAnimationFrame(step);
}

onMounted(() => {
  if (typeof window === 'undefined') return;
  if (typeof ResizeObserver !== 'undefined' && canvasRef.value?.parentElement) {
    resizeObserver = new ResizeObserver(() => {
      resizeCanvasToContainer();
    });
    resizeObserver.observe(canvasRef.value.parentElement);
  }
  start();
});

onUnmounted(() => {
  teardown();
});

watch(
  () => [props.variant, props.visualEffectLevel, props.reducedMotion],
  () => {
    teardown();
    start();
  },
);
</script>

<template>
  <canvas
    v-if="visualEffectLevel !== 'OFF'"
    ref="canvasRef"
    :data-testid="testId"
    :data-variant="variant"
    :data-level="visualEffectLevel"
    :data-reduced-motion="reducedMotion ? 'true' : 'false'"
    aria-hidden="true"
    class="pointer-events-none absolute inset-0 w-full h-full"
  />
</template>
