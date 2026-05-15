import { describe, it, expect } from 'vitest';
import {
  particleCountForLevel,
  defaultVariantForScene,
} from '../particleField';

/**
 * Particle field lib helpers (Cửu Thiên Mộng Phase 3 module C).
 */
describe('particleCountForLevel', () => {
  it('OFF → 0', () => {
    expect(particleCountForLevel('OFF')).toBe(0);
  });
  it('LOW → 20', () => {
    expect(particleCountForLevel('LOW')).toBe(20);
  });
  it('MEDIUM → 60', () => {
    expect(particleCountForLevel('MEDIUM')).toBe(60);
  });
  it('HIGH → 120', () => {
    expect(particleCountForLevel('HIGH')).toBe(120);
  });
});

describe('defaultVariantForScene', () => {
  it('null/undefined → qi-rising fallback', () => {
    expect(defaultVariantForScene(null)).toBe('qi-rising');
    expect(defaultVariantForScene(undefined)).toBe('qi-rising');
  });
  it('non-string → qi-rising fallback', () => {
    expect(defaultVariantForScene(123 as unknown as string)).toBe('qi-rising');
  });
  it('scene "tribulation" → qi-rising', () => {
    expect(defaultVariantForScene('tribulation')).toBe('qi-rising');
  });
  it('scene "cultivation" → qi-rising', () => {
    expect(defaultVariantForScene('cultivation')).toBe('qi-rising');
  });
  it('scene "sect" → petal-fall', () => {
    expect(defaultVariantForScene('sect')).toBe('petal-fall');
  });
  it('scene "home" → petal-fall', () => {
    expect(defaultVariantForScene('home')).toBe('petal-fall');
  });
  it('scene "boss" → ember-spark', () => {
    expect(defaultVariantForScene('boss')).toBe('ember-spark');
  });
  it('scene "combat" → ember-spark', () => {
    expect(defaultVariantForScene('combat')).toBe('ember-spark');
  });
  it('scene unknown → qi-rising fallback', () => {
    expect(defaultVariantForScene('whatever')).toBe('qi-rising');
  });
});
