/**
 * Tests cho `apps/web/src/components/ElementBadge.vue` (Phase 14.2.A).
 *
 * Lock-in:
 *   - Render badge khi `element` prop hợp lệ (ElementKey hoặc ElementType).
 *   - Permissive parsing: `'kim'`, `'METAL'`, `'metal'` đều ra "Kim" badge.
 *   - Không render gì khi `element` = null/undefined trừ khi `showNeutral=true`.
 *   - Color class khác nhau cho 5 element + neutral fallback.
 *   - i18n label đúng vi/en (kim → Kim / Metal).
 *   - data-testid format `element-badge-<key>` để FE test stable.
 */
import { describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import { createI18n } from 'vue-i18n';

import ElementBadge from '@/components/ElementBadge.vue';

function makeI18n(locale: 'vi' | 'en' = 'vi') {
  return createI18n({
    legacy: false,
    locale,
    fallbackLocale: 'vi',
    messages: {
      vi: {
        elementBadge: {
          neutral: 'Vô hệ',
          element: {
            kim: 'Kim',
            moc: 'Mộc',
            thuy: 'Thuỷ',
            hoa: 'Hoả',
            tho: 'Thổ',
          },
        },
      },
      en: {
        elementBadge: {
          neutral: 'Neutral',
          element: {
            kim: 'Metal',
            moc: 'Wood',
            thuy: 'Water',
            hoa: 'Fire',
            tho: 'Earth',
          },
        },
      },
    },
  });
}

const mountBadge = (
  props: Record<string, unknown> = {},
  locale: 'vi' | 'en' = 'vi',
) =>
  mount(ElementBadge, {
    props,
    global: { plugins: [makeI18n(locale)] },
  });

describe('ElementBadge — basic rendering', () => {
  it('element=null + showNeutral=false → không render gì', () => {
    const w = mountBadge({ element: null });
    expect(w.find('span').exists()).toBe(false);
  });

  it('element=undefined + showNeutral=false → không render gì', () => {
    const w = mountBadge({});
    expect(w.find('span').exists()).toBe(false);
  });

  it('element="" + showNeutral=false → không render gì (empty string fallback)', () => {
    const w = mountBadge({ element: '' });
    expect(w.find('span').exists()).toBe(false);
  });

  it('element=null + showNeutral=true → render "Vô hệ" badge (vi)', () => {
    const w = mountBadge({ element: null, showNeutral: true });
    expect(w.find('span').exists()).toBe(true);
    expect(w.text()).toBe('Vô hệ');
  });

  it('element=null + showNeutral=true → render "Neutral" badge (en)', () => {
    const w = mountBadge({ element: null, showNeutral: true }, 'en');
    expect(w.text()).toBe('Neutral');
  });
});

describe('ElementBadge — ElementKey input (Vietnamese)', () => {
  it('element="kim" → badge "Kim" (vi)', () => {
    const w = mountBadge({ element: 'kim' });
    expect(w.text()).toBe('Kim');
    expect(w.attributes('data-element')).toBe('kim');
  });

  it('element="moc" → badge "Mộc" (vi)', () => {
    expect(mountBadge({ element: 'moc' }).text()).toBe('Mộc');
  });

  it('element="thuy" → badge "Thuỷ" (vi)', () => {
    expect(mountBadge({ element: 'thuy' }).text()).toBe('Thuỷ');
  });

  it('element="hoa" → badge "Hoả" (vi)', () => {
    expect(mountBadge({ element: 'hoa' }).text()).toBe('Hoả');
  });

  it('element="tho" → badge "Thổ" (vi)', () => {
    expect(mountBadge({ element: 'tho' }).text()).toBe('Thổ');
  });
});

describe('ElementBadge — ElementType input (English)', () => {
  it('element="METAL" → badge "Kim" (vi locale)', () => {
    const w = mountBadge({ element: 'METAL' });
    expect(w.text()).toBe('Kim');
    expect(w.attributes('data-element')).toBe('kim');
  });

  it('element="WOOD" → badge "Wood" (en locale)', () => {
    expect(mountBadge({ element: 'WOOD' }, 'en').text()).toBe('Wood');
  });

  it('element="WATER" → badge "Water" (en locale)', () => {
    expect(mountBadge({ element: 'WATER' }, 'en').text()).toBe('Water');
  });

  it('lowercase English "fire" → badge (permissive parser)', () => {
    expect(mountBadge({ element: 'fire' }, 'en').text()).toBe('Fire');
  });

  it('Mixed case "Earth" → badge (permissive parser)', () => {
    expect(mountBadge({ element: 'Earth' }, 'en').text()).toBe('Earth');
  });
});

describe('ElementBadge — garbage input fallback', () => {
  it('element="xyz" + showNeutral=false → không render', () => {
    const w = mountBadge({ element: 'xyz' });
    expect(w.find('span').exists()).toBe(false);
  });

  it('element="xyz" + showNeutral=true → render neutral badge', () => {
    const w = mountBadge({ element: 'xyz', showNeutral: true });
    expect(w.text()).toBe('Vô hệ');
  });
});

describe('ElementBadge — color class differentiation', () => {
  it('5 element ra 5 color class khác nhau', () => {
    const colors = ['kim', 'moc', 'thuy', 'hoa', 'tho'].map((k) => {
      const w = mountBadge({ element: k });
      return w.find('span').classes().sort().join(',');
    });
    const unique = new Set(colors);
    expect(unique.size).toBe(5);
  });

  it('moc → emerald color', () => {
    const w = mountBadge({ element: 'moc' });
    expect(w.find('span').classes().some((c) => c.includes('emerald'))).toBe(true);
  });

  it('hoa → rose color', () => {
    const w = mountBadge({ element: 'hoa' });
    expect(w.find('span').classes().some((c) => c.includes('rose'))).toBe(true);
  });

  it('thuy → sky color', () => {
    const w = mountBadge({ element: 'thuy' });
    expect(w.find('span').classes().some((c) => c.includes('sky'))).toBe(true);
  });

  it('tho → amber color', () => {
    const w = mountBadge({ element: 'tho' });
    expect(w.find('span').classes().some((c) => c.includes('amber'))).toBe(true);
  });

  it('kim → ink (silver/grey) color', () => {
    const w = mountBadge({ element: 'kim' });
    expect(w.find('span').classes().some((c) => c.includes('ink'))).toBe(true);
  });
});

describe('ElementBadge — size variant', () => {
  it('default size="sm" → text-[10px]', () => {
    const w = mountBadge({ element: 'kim' });
    expect(w.find('span').classes().includes('text-[10px]')).toBe(true);
  });

  it('size="md" → text-xs', () => {
    const w = mountBadge({ element: 'kim', size: 'md' });
    expect(w.find('span').classes().includes('text-xs')).toBe(true);
  });
});

describe('ElementBadge — testid', () => {
  it('data-testid format "element-badge-<key>"', () => {
    expect(mountBadge({ element: 'kim' }).attributes('data-testid')).toBe(
      'element-badge-kim',
    );
    expect(mountBadge({ element: 'METAL' }).attributes('data-testid')).toBe(
      'element-badge-kim',
    );
    expect(
      mountBadge({ element: null, showNeutral: true }).attributes('data-testid'),
    ).toBe('element-badge-neutral');
  });
});
