import { describe, it, expect } from 'vitest';
import { defineComponent, h } from 'vue';
import { mount } from '@vue/test-utils';
import XTListStagger from '@/components/xianxia/XTListStagger.vue';

/**
 * XTListStagger — Cửu Thiên Mộng Phase 6.
 *
 * TransitionGroup wrapper test (force render TransitionGroup, không stub):
 *   - render default tag = div và truyền slot children.
 *   - custom tag (ul) → outer element là ul.
 *   - children kế thừa style `--xt-list-index` không bị strip.
 */
const renderGlobal = {
  // Force vue-test-utils render TransitionGroup thật (mặc định bị stub).
  stubs: { transition: false, 'transition-group': false },
} as const;

describe('XTListStagger', () => {
  it('default tag là div và render children slot', () => {
    const w = mount(XTListStagger, {
      slots: {
        default: () => [h('span', { key: 'a' }, 'A'), h('span', { key: 'b' }, 'B')],
      },
      global: renderGlobal,
    });
    expect(w.element.tagName).toBe('DIV');
    expect(w.text()).toContain('A');
    expect(w.text()).toContain('B');
  });

  it('custom tag = ul → root là ul', () => {
    const w = mount(XTListStagger, {
      props: { tag: 'ul' },
      slots: {
        default: () => [h('li', { key: 'x' }, 'X'), h('li', { key: 'y' }, 'Y')],
      },
      global: renderGlobal,
    });
    expect(w.element.tagName).toBe('UL');
    expect(w.findAll('li')).toHaveLength(2);
  });

  it('inline --xt-list-index style trên child propagate', () => {
    const Parent = defineComponent({
      components: { XTListStagger },
      data: () => ({ items: ['a', 'b', 'c'] }),
      template: `
        <XTListStagger tag="ul">
          <li
            v-for="(it, i) in items"
            :key="it"
            :style="{ '--xt-list-index': i }"
            class="xt-row"
          >{{ it }}</li>
        </XTListStagger>
      `,
    });
    const w = mount(Parent, { global: renderGlobal });
    const rows = w.findAll('li.xt-row');
    expect(rows).toHaveLength(3);
    expect((rows[0].element as HTMLElement).style.getPropertyValue('--xt-list-index')).toBe('0');
    expect((rows[2].element as HTMLElement).style.getPropertyValue('--xt-list-index')).toBe('2');
  });
});
