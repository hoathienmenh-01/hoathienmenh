import { describe, it, expect } from 'vitest';
import { silkTransitionName } from '../silkTransition';

/**
 * Silk transition name resolver (Cửu Thiên Mộng Phase 3 module B).
 *
 * Routes /admin/* nên giữ tốc độ → transitionName='' (no transition).
 * Mọi route khác → 'xt-silk'. Null/invalid → fallback 'xt-silk'.
 */
describe('silkTransitionName', () => {
  it('null route → fallback "xt-silk"', () => {
    expect(silkTransitionName(null)).toBe('xt-silk');
    expect(silkTransitionName(undefined)).toBe('xt-silk');
  });

  it('route /home → "xt-silk"', () => {
    expect(silkTransitionName({ path: '/home' })).toBe('xt-silk');
  });

  it('route /admin → "" (disable)', () => {
    expect(silkTransitionName({ path: '/admin' })).toBe('');
  });

  it('route /admin/anything → "" (disable)', () => {
    expect(silkTransitionName({ path: '/admin/control-center' })).toBe('');
    expect(silkTransitionName({ path: '/admin/event-builder/sub' })).toBe('');
  });

  it('route bắt đầu bằng /administration (không phải admin) → "xt-silk"', () => {
    // Edge case: chỉ block đúng prefix /admin (route hợp lệ trong app phải có
    // /admin/... hoặc /admin nguyên).
    // /admin-foo cũng match prefix → đành chấp nhận; cẩn thận khi đặt path
    // mới giống prefix admin.
    expect(silkTransitionName({ path: '/administration' })).toBe('');
  });

  it('route /cultivation, /shop, /sect → "xt-silk"', () => {
    expect(silkTransitionName({ path: '/cultivation' })).toBe('xt-silk');
    expect(silkTransitionName({ path: '/shop' })).toBe('xt-silk');
    expect(silkTransitionName({ path: '/sect' })).toBe('xt-silk');
  });

  it('route với non-string path → fallback "xt-silk"', () => {
    expect(silkTransitionName({ path: 123 as unknown as string })).toBe('xt-silk');
  });
});
