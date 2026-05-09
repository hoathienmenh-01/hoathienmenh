/**
 * Phase 14.2.C — SkillTagBadge component tests.
 *
 * Lock-in:
 *   - Render badge cho mỗi tag (HEAL/DOT/BURST/SHIELD/CRIT/CONTROL).
 *   - i18n label đúng (vd HEAL → "Hồi" vi / "Heal" en).
 *   - title attribute (tooltip) populate từ skillTagBadge.tooltip.<TAG>.
 *   - data-testid format `skill-tag-<tag-lowercase>`.
 *   - data-tag attribute = tag uppercase enum.
 *   - color class theo tag (Wuxia palette: emerald/lime/rose/amber/fuchsia/sky).
 */
import { describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import { createI18n } from 'vue-i18n';

import SkillTagBadge from '@/components/SkillTagBadge.vue';
import type { SkillTag } from '@xuantoi/shared';

function makeI18n(locale: 'vi' | 'en' = 'vi') {
  return createI18n({
    legacy: false,
    locale,
    fallbackLocale: 'vi',
    messages: {
      vi: {
        skillTagBadge: {
          tag: {
            HEAL: 'Hồi',
            DOT: 'Độc',
            BURST: 'Bùng',
            SHIELD: 'Khiên',
            CRIT: 'Chí',
            CONTROL: 'Khống',
          },
          tooltip: {
            HEAL: 'Hồi phục',
            DOT: 'Độc/Bỏng',
            BURST: 'Bùng nổ',
            SHIELD: 'Khiên hộ thân',
            CRIT: 'Chí mạng',
            CONTROL: 'Khống chế',
          },
        },
      },
      en: {
        skillTagBadge: {
          tag: {
            HEAL: 'Heal',
            DOT: 'DoT',
            BURST: 'Burst',
            SHIELD: 'Shield',
            CRIT: 'Crit',
            CONTROL: 'Control',
          },
          tooltip: {
            HEAL: 'Heal',
            DOT: 'Damage-over-time',
            BURST: 'Burst',
            SHIELD: 'Shield',
            CRIT: 'Critical',
            CONTROL: 'Control',
          },
        },
      },
    },
  });
}

const mountBadge = (tag: SkillTag, locale: 'vi' | 'en' = 'vi') =>
  mount(SkillTagBadge, {
    props: { tag },
    global: { plugins: [makeI18n(locale)] },
  });

describe('SkillTagBadge', () => {
  it.each<SkillTag>(['HEAL', 'DOT', 'BURST', 'SHIELD', 'CRIT', 'CONTROL'])(
    'render đúng label vi cho tag %s',
    (tag) => {
      const wrapper = mountBadge(tag, 'vi');
      const expectedLabel = {
        HEAL: 'Hồi',
        DOT: 'Độc',
        BURST: 'Bùng',
        SHIELD: 'Khiên',
        CRIT: 'Chí',
        CONTROL: 'Khống',
      }[tag];
      expect(wrapper.text()).toBe(expectedLabel);
    },
  );

  it.each<SkillTag>(['HEAL', 'DOT', 'BURST', 'SHIELD', 'CRIT', 'CONTROL'])(
    'render đúng label en cho tag %s',
    (tag) => {
      const wrapper = mountBadge(tag, 'en');
      const expectedLabel = {
        HEAL: 'Heal',
        DOT: 'DoT',
        BURST: 'Burst',
        SHIELD: 'Shield',
        CRIT: 'Crit',
        CONTROL: 'Control',
      }[tag];
      expect(wrapper.text()).toBe(expectedLabel);
    },
  );

  it('có title attribute (tooltip) populate từ i18n', () => {
    const wrapper = mountBadge('HEAL', 'vi');
    expect(wrapper.attributes('title')).toBe('Hồi phục');
  });

  it('data-testid format `skill-tag-<tag-lowercase>`', () => {
    const wrapper = mountBadge('HEAL', 'vi');
    expect(wrapper.attributes('data-testid')).toBe('skill-tag-heal');
  });

  it('data-tag attribute = tag uppercase enum', () => {
    const wrapper = mountBadge('SHIELD', 'vi');
    expect(wrapper.attributes('data-tag')).toBe('SHIELD');
  });

  it('apply color class theo tag (HEAL → emerald, DOT → lime, ...)', () => {
    const cases: Array<[SkillTag, string]> = [
      ['HEAL', 'emerald'],
      ['DOT', 'lime'],
      ['BURST', 'rose'],
      ['SHIELD', 'amber'],
      ['CRIT', 'fuchsia'],
      ['CONTROL', 'sky'],
    ];
    for (const [tag, palette] of cases) {
      const wrapper = mountBadge(tag, 'vi');
      const cls = wrapper.attributes('class') ?? '';
      expect(cls).toContain(palette);
    }
  });

  it('size=md → text-xs px-2 py-0.5 (default sm: text-[10px])', () => {
    const wrapper = mount(SkillTagBadge, {
      props: { tag: 'HEAL', size: 'md' },
      global: { plugins: [makeI18n('vi')] },
    });
    const cls = wrapper.attributes('class') ?? '';
    expect(cls).toContain('text-xs');
    expect(cls).toContain('px-2');
  });
});
