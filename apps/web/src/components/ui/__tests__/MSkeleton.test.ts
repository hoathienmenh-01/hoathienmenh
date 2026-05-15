import { describe, it, expect } from 'vitest';
import { mount } from '@vue/test-utils';
import MSkeleton from '@/components/ui/MSkeleton.vue';

/**
 * MSkeleton primitive — Phase 5 loading primitive.
 *
 * Cover:
 *   - variant=block (default) → 1 div block với class height/width/rounded.
 *   - variant=text + lines=3 → 3 children div, last line w-3/5; lines=1 → w-full.
 *   - variant=circle → rounded-full + inline style width/height.
 *   - variant=tile → m-skeleton__tile + custom border styles.
 *   - variant=card → 4 placeholder children (title + 2 body + actions).
 *   - animation prop: shimmer (default) → m-skeleton--shimmer; pulse → m-skeleton--pulse;
 *     none → không có class animation.
 *   - aria-hidden=true ở root mỗi variant.
 *   - testId propagate vào data-testid root.
 */
describe('MSkeleton', () => {
  it('default → variant=block, h-4 w-full rounded, shimmer + aria-hidden', () => {
    const w = mount(MSkeleton);
    const root = w.element as HTMLElement;
    expect(root.classList.contains('m-skeleton')).toBe(true);
    expect(root.classList.contains('m-skeleton--shimmer')).toBe(true);
    expect(root.classList.contains('h-4')).toBe(true);
    expect(root.classList.contains('w-full')).toBe(true);
    expect(root.classList.contains('rounded')).toBe(true);
    expect(root.getAttribute('aria-hidden')).toBe('true');
  });

  it('block: custom height/width/rounded prop reflect', () => {
    const w = mount(MSkeleton, {
      props: { variant: 'block', height: 'h-12', width: 'w-1/3', rounded: 'rounded-2xl' },
    });
    expect(w.classes()).toContain('h-12');
    expect(w.classes()).toContain('w-1/3');
    expect(w.classes()).toContain('rounded-2xl');
  });

  it('variant=text + lines=3 → 3 children, last w-3/5', () => {
    const w = mount(MSkeleton, { props: { variant: 'text', lines: 3 } });
    const children = w.findAll('.m-skeleton__text > div');
    expect(children).toHaveLength(3);
    expect(children[0]!.classes()).toContain('w-full');
    expect(children[1]!.classes()).toContain('w-full');
    expect(children[2]!.classes()).toContain('w-3/5');
  });

  it('variant=text + lines=1 → 1 child w-full', () => {
    const w = mount(MSkeleton, { props: { variant: 'text', lines: 1 } });
    const children = w.findAll('.m-skeleton__text > div');
    expect(children).toHaveLength(1);
    expect(children[0]!.classes()).toContain('w-full');
  });

  it('variant=circle → rounded-full + width/height từ size prop', () => {
    const w = mount(MSkeleton, { props: { variant: 'circle', size: 48 } });
    const root = w.element as HTMLElement;
    expect(root.classList.contains('rounded-full')).toBe(true);
    expect(root.style.width).toBe('48px');
    expect(root.style.height).toBe('48px');
  });

  it('variant=tile → m-skeleton__tile class + rounded prop applied', () => {
    const w = mount(MSkeleton, { props: { variant: 'tile', rounded: 'rounded-3xl' } });
    expect(w.classes()).toContain('m-skeleton__tile');
    expect(w.classes()).toContain('rounded-3xl');
  });

  it('variant=card → 4 placeholder children với m-skeleton__card root', () => {
    const w = mount(MSkeleton, { props: { variant: 'card' } });
    expect(w.classes()).toContain('m-skeleton__card');
    const root = w.element as HTMLElement;
    const children = Array.from(root.children) as HTMLElement[];
    const skeletonChildren = children.filter((c) =>
      c.classList.contains('m-skeleton'),
    );
    expect(skeletonChildren).toHaveLength(4);
  });

  it('animation=pulse → m-skeleton--pulse class', () => {
    const w = mount(MSkeleton, { props: { animation: 'pulse' } });
    expect(w.classes()).toContain('m-skeleton--pulse');
    expect(w.classes()).not.toContain('m-skeleton--shimmer');
  });

  it('animation=none → không có m-skeleton--shimmer hoặc --pulse', () => {
    const w = mount(MSkeleton, { props: { animation: 'none' } });
    expect(w.classes()).not.toContain('m-skeleton--shimmer');
    expect(w.classes()).not.toContain('m-skeleton--pulse');
  });

  it('testId propagate vào data-testid root', () => {
    const w = mount(MSkeleton, { props: { testId: 'inventory-skeleton-card' } });
    expect(w.attributes('data-testid')).toBe('inventory-skeleton-card');
  });

  it('default testId fallback theo variant', () => {
    const w = mount(MSkeleton, { props: { variant: 'card' } });
    expect(w.attributes('data-testid')).toBe('m-skeleton-card');
  });
});
