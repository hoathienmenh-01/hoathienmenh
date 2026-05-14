import { describe, expect, it } from 'vitest';
import {
  formatBodyRealmName,
  formatFeatureLabel,
  formatNumberCompact,
  formatRealmName,
} from '@/lib/xianxiaFormat';

describe('xianxiaFormat', () => {
  it('formats cultivation realm without raw keys', () => {
    expect(formatRealmName('luyenkhi', 1)).toBe('Luyện Khí · Tầng 1');
  });

  it('formats body realm without raw keys', () => {
    expect(formatBodyRealmName('pham_than', 1)).toBe('Phàm Thân');
    expect(formatBodyRealmName('luyen_bi', 1)).toBe('Luyện Bì · Tầng 1');
  });

  it('formats feature labels without raw English keys', () => {
    expect(formatFeatureLabel('pets')).toBe('Linh Thú');
    expect(formatFeatureLabel('dashboard')).toBe('Thiên Cung Tổng Quan');
  });

  it('formats compact Vietnamese numbers', () => {
    expect(formatNumberCompact(12345)).toContain('N');
  });
});
