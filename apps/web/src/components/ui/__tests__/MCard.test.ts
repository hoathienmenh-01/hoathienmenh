import { describe, it, expect } from 'vitest';
import { mount } from '@vue/test-utils';
import MCard from '@/components/ui/MCard.vue';

/**
 * MCard primitive — Phase 5 bento card.
 *
 * Cover:
 *   - default props render `<section>` với class baseline + variant=jade + tone=bento.
 *   - variant + tone + padding override → reflect vào class data attr.
 *   - `as="article"` → render `<article>`; `href` → render `<a>` (override `as`).
 *   - interactive=true (or href) → role=button (non-anchor), tabindex=0,
 *     click emit `click`, Enter/Space → emit click + preventDefault.
 *   - non-interactive → click vẫn fire native nhưng KHÔNG emit `click` của component.
 *   - Slot eyebrow/title/meta/actions render đúng vị trí.
 *   - testId propagate vào data-testid root.
 */
describe('MCard', () => {
  it('default → section, m-card--jade, m-card--tone-bento, padding md', () => {
    const w = mount(MCard, { slots: { default: 'hello' } });
    const root = w.element as HTMLElement;
    expect(root.tagName).toBe('SECTION');
    expect(root.classList.contains('m-card')).toBe(true);
    expect(root.classList.contains('m-card--jade')).toBe(true);
    expect(root.classList.contains('m-card--tone-bento')).toBe(true);
    expect(root.classList.contains('m-card--pad-md')).toBe(true);
    expect(root.dataset.variant).toBe('jade');
    expect(root.dataset.tone).toBe('bento');
  });

  it('variant + tone + padding props → reflect vào class', () => {
    const w = mount(MCard, {
      props: { variant: 'seal', tone: 'cinematic', padding: 'lg' },
    });
    expect(w.classes()).toContain('m-card--seal');
    expect(w.classes()).toContain('m-card--tone-cinematic');
    expect(w.classes()).toContain('m-card--pad-lg');
  });

  it('as="article" → render <article>', () => {
    const w = mount(MCard, { props: { as: 'article' } });
    expect((w.element as HTMLElement).tagName).toBe('ARTICLE');
  });

  it('href truthy → render <a> với href (override `as`)', () => {
    const w = mount(MCard, { props: { href: '/cultivation' } });
    const el = w.element as HTMLAnchorElement;
    expect(el.tagName).toBe('A');
    expect(el.getAttribute('href')).toBe('/cultivation');
  });

  it('interactive=true (non-anchor) → role=button + tabindex=0 + class interactive', () => {
    const w = mount(MCard, { props: { interactive: true } });
    expect(w.attributes('role')).toBe('button');
    expect(w.attributes('tabindex')).toBe('0');
    expect(w.classes()).toContain('m-card--interactive');
  });

  it('interactive + click → emit "click" với MouseEvent', async () => {
    const w = mount(MCard, { props: { interactive: true } });
    await w.trigger('click');
    const evs = w.emitted('click');
    expect(evs).toHaveLength(1);
    // arg[0] = native event-like
    expect(evs?.[0]?.[0]).toBeTruthy();
  });

  it('non-interactive → click KHÔNG emit "click"', async () => {
    const w = mount(MCard);
    await w.trigger('click');
    expect(w.emitted('click')).toBeUndefined();
  });

  it('interactive + Enter keydown → emit "click"', async () => {
    const w = mount(MCard, { props: { interactive: true } });
    await w.trigger('keydown', { key: 'Enter' });
    expect(w.emitted('click')).toHaveLength(1);
  });

  it('interactive + Space keydown → emit "click"', async () => {
    const w = mount(MCard, { props: { interactive: true } });
    await w.trigger('keydown', { key: ' ' });
    expect(w.emitted('click')).toHaveLength(1);
  });

  it('interactive + Tab keydown → KHÔNG emit "click"', async () => {
    const w = mount(MCard, { props: { interactive: true } });
    await w.trigger('keydown', { key: 'Tab' });
    expect(w.emitted('click')).toBeUndefined();
  });

  it('slot eyebrow/title/meta/actions → render trong section đúng vị trí', () => {
    const w = mount(MCard, {
      slots: {
        eyebrow: '<span>tu luyện</span>',
        title: '<h3>Cảnh giới</h3>',
        meta: '<small>78%</small>',
        default: '<p>body</p>',
        actions: '<button>Tu luyện</button>',
      },
    });
    expect(w.find('.m-card__eyebrow').text()).toBe('tu luyện');
    expect(w.find('.m-card__title').text()).toBe('Cảnh giới');
    expect(w.find('.m-card__meta').text()).toBe('78%');
    expect(w.find('.m-card__body').text()).toBe('body');
    expect(w.find('.m-card__actions').text()).toBe('Tu luyện');
  });

  it('testId propagate vào data-testid root', () => {
    const w = mount(MCard, { props: { testId: 'home-tile-cultivation' } });
    expect(w.attributes('data-testid')).toBe('home-tile-cultivation');
  });

  it('ariaLabel → propagate vào aria-label root', () => {
    const w = mount(MCard, { props: { ariaLabel: 'Tu Luyện tile' } });
    expect(w.attributes('aria-label')).toBe('Tu Luyện tile');
  });
});
