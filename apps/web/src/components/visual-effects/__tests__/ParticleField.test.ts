/**
 * Cửu Thiên Mộng Phase 3 module C — ParticleField component tests.
 *
 * jsdom không có canvas context thực; stub `getContext` để tránh crash khi
 * mount + verify component behavior ở level OFF / LOW / variant / reduced
 * motion / unmount cleanup.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import ParticleField from '../ParticleField.vue';

interface MockCtx {
  clearRect: ReturnType<typeof vi.fn>;
  beginPath: ReturnType<typeof vi.fn>;
  arc: ReturnType<typeof vi.fn>;
  fill: ReturnType<typeof vi.fn>;
  globalCompositeOperation: string;
  fillStyle: string;
}

function installCanvasMock(): MockCtx {
  const ctx: MockCtx = {
    clearRect: vi.fn(),
    beginPath: vi.fn(),
    arc: vi.fn(),
    fill: vi.fn(),
    globalCompositeOperation: 'source-over',
    fillStyle: '',
  };
  HTMLCanvasElement.prototype.getContext = vi.fn(
    () => ctx as unknown as CanvasRenderingContext2D,
  ) as unknown as HTMLCanvasElement['getContext'];
  return ctx;
}

describe('ParticleField', () => {
  let rafSpy: ReturnType<typeof vi.fn>;
  let cafSpy: ReturnType<typeof vi.fn>;
  const originalRaf = globalThis.requestAnimationFrame;
  const originalCaf = globalThis.cancelAnimationFrame;

  beforeEach(() => {
    installCanvasMock();
    rafSpy = vi.fn(() => 1234);
    cafSpy = vi.fn();
    globalThis.requestAnimationFrame =
      rafSpy as unknown as typeof globalThis.requestAnimationFrame;
    globalThis.cancelAnimationFrame =
      cafSpy as unknown as typeof globalThis.cancelAnimationFrame;
  });

  afterEach(() => {
    globalThis.requestAnimationFrame = originalRaf;
    globalThis.cancelAnimationFrame = originalCaf;
  });

  it('visualEffectLevel="OFF" → không render canvas', () => {
    const w = mount(ParticleField, {
      props: { visualEffectLevel: 'OFF', variant: 'qi-rising' },
    });
    expect(w.find('[data-testid="particle-field"]').exists()).toBe(false);
  });

  it('visualEffectLevel="LOW" → render canvas với data attrs', () => {
    const w = mount(ParticleField, {
      props: { visualEffectLevel: 'LOW', variant: 'petal-fall' },
    });
    const canvas = w.get('[data-testid="particle-field"]');
    expect(canvas.attributes('data-level')).toBe('LOW');
    expect(canvas.attributes('data-variant')).toBe('petal-fall');
    expect(canvas.attributes('aria-hidden')).toBe('true');
  });

  it('default props → variant=qi-rising, level=MEDIUM, reducedMotion=false', () => {
    const w = mount(ParticleField);
    const canvas = w.get('[data-testid="particle-field"]');
    expect(canvas.attributes('data-variant')).toBe('qi-rising');
    expect(canvas.attributes('data-level')).toBe('MEDIUM');
    expect(canvas.attributes('data-reduced-motion')).toBe('false');
  });

  it('reducedMotion=true → không khởi RAF (static frame)', () => {
    mount(ParticleField, {
      props: { visualEffectLevel: 'MEDIUM', reducedMotion: true },
    });
    expect(rafSpy).not.toHaveBeenCalled();
  });

  it('reducedMotion=false → khởi RAF', () => {
    mount(ParticleField, {
      props: { visualEffectLevel: 'MEDIUM', reducedMotion: false },
    });
    expect(rafSpy).toHaveBeenCalled();
  });

  it('unmount → cancelAnimationFrame được gọi', () => {
    const w = mount(ParticleField, {
      props: { visualEffectLevel: 'HIGH', reducedMotion: false },
    });
    w.unmount();
    expect(cafSpy).toHaveBeenCalled();
  });

  it('OFF → không gọi RAF', () => {
    mount(ParticleField, {
      props: { visualEffectLevel: 'OFF' },
    });
    expect(rafSpy).not.toHaveBeenCalled();
  });

  it('switch variant prop → teardown + restart RAF', async () => {
    const w = mount(ParticleField, {
      props: { visualEffectLevel: 'LOW', variant: 'qi-rising' },
    });
    const initialRafCalls = rafSpy.mock.calls.length;
    await w.setProps({ variant: 'ember-spark' });
    expect(cafSpy).toHaveBeenCalled();
    expect(rafSpy.mock.calls.length).toBeGreaterThan(initialRafCalls);
    expect(
      w.get('[data-testid="particle-field"]').attributes('data-variant'),
    ).toBe('ember-spark');
  });
});
