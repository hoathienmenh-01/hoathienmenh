import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import MBottomSheet from '@/components/ui/MBottomSheet.vue';

/**
 * MBottomSheet primitive — Phase 5 mobile-first overlay.
 *
 * Cover:
 *   - open=false → backdrop & sheet không render (Teleport ra body).
 *   - open=true → backdrop + sheet trong body với role=dialog + aria-modal.
 *   - title prop → render trong header; subtitle render khi truthy.
 *   - Backdrop click (click.self) → emit update:open(false) + close.
 *   - persistent=true → click backdrop KHÔNG emit close.
 *   - Escape key (open) → emit close; persistent → không emit.
 *   - Body scroll lock khi open=true; bỏ khi đóng.
 *   - hideHandle=true → không render `.m-sheet__handle`.
 *   - height prop: half → maxHeight 52vh; tall → 92vh; raw → original.
 *   - testId propagate vào backdrop + sheet ("testId-sheet").
 */
function mountSheet(props: Record<string, unknown> = {}) {
  return mount(MBottomSheet, {
    props: { open: true, ...props },
    slots: {
      default: '<p data-test="sheet-body">Nội dung sheet</p>',
    },
    attachTo: document.body,
  });
}

describe('MBottomSheet', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    document.body.style.overflow = '';
  });
  afterEach(() => {
    document.body.innerHTML = '';
    document.body.style.overflow = '';
  });

  it('open=false → backdrop + sheet không render', async () => {
    mount(MBottomSheet, { props: { open: false }, attachTo: document.body });
    await flushPromises();
    expect(document.querySelector('[data-testid="m-bottom-sheet"]')).toBeNull();
    expect(document.querySelector('[data-testid="m-bottom-sheet-sheet"]')).toBeNull();
  });

  it('open=true → render backdrop + sheet với role=dialog', async () => {
    mountSheet({ title: 'Tu Luyện' });
    await flushPromises();
    expect(document.querySelector('[data-testid="m-bottom-sheet"]')).not.toBeNull();
    const sheet = document.querySelector('[data-testid="m-bottom-sheet-sheet"]') as HTMLElement;
    expect(sheet).not.toBeNull();
    expect(sheet.getAttribute('role')).toBe('dialog');
    expect(sheet.getAttribute('aria-modal')).toBe('true');
    expect(sheet.getAttribute('aria-label')).toBe('Tu Luyện');
  });

  it('title + subtitle render trong header', async () => {
    mountSheet({ title: 'Tu Luyện', subtitle: 'Tu luyện tăng tu vi' });
    await flushPromises();
    expect(document.body.textContent).toContain('Tu Luyện');
    expect(document.body.textContent).toContain('Tu luyện tăng tu vi');
  });

  it('default slot render trong body', async () => {
    mountSheet();
    await flushPromises();
    expect(document.querySelector('[data-test="sheet-body"]')?.textContent).toBe(
      'Nội dung sheet',
    );
  });

  it('hideHandle=true → không render handle', async () => {
    mountSheet({ hideHandle: true });
    await flushPromises();
    expect(document.querySelector('[data-testid="m-bottom-sheet-handle"]')).toBeNull();
  });

  it('hideHandle=false (default) → render handle', async () => {
    mountSheet();
    await flushPromises();
    expect(document.querySelector('[data-testid="m-bottom-sheet-handle"]')).not.toBeNull();
  });

  it('click backdrop → emit update:open(false) + close', async () => {
    const w = mountSheet();
    await flushPromises();
    const backdrop = document.querySelector('[data-testid="m-bottom-sheet"]') as HTMLElement;
    backdrop.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await flushPromises();
    expect(w.emitted('update:open')?.[0]).toEqual([false]);
    expect(w.emitted('close')).toHaveLength(1);
  });

  it('persistent=true → click backdrop KHÔNG emit', async () => {
    const w = mountSheet({ persistent: true });
    await flushPromises();
    const backdrop = document.querySelector('[data-testid="m-bottom-sheet"]') as HTMLElement;
    backdrop.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await flushPromises();
    expect(w.emitted('update:open')).toBeUndefined();
    expect(w.emitted('close')).toBeUndefined();
  });

  it('Escape key (open=true) → emit close', async () => {
    const w = mountSheet();
    await flushPromises();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    await flushPromises();
    expect(w.emitted('close')).toHaveLength(1);
  });

  it('Escape persistent=true → KHÔNG emit close', async () => {
    const w = mountSheet({ persistent: true });
    await flushPromises();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    await flushPromises();
    expect(w.emitted('close')).toBeUndefined();
  });

  it('body scroll lock: overflow=hidden khi open; clear khi close', async () => {
    const w = mountSheet();
    await flushPromises();
    expect(document.body.style.overflow).toBe('hidden');
    await w.setProps({ open: false });
    await flushPromises();
    expect(document.body.style.overflow).toBe('');
  });

  it('height=half → maxHeight 52vh trong style', async () => {
    mountSheet({ height: 'half' });
    await flushPromises();
    const sheet = document.querySelector('[data-testid="m-bottom-sheet-sheet"]') as HTMLElement;
    expect(sheet.style.maxHeight).toBe('52vh');
  });

  it('height=tall → maxHeight 92vh', async () => {
    mountSheet({ height: 'tall' });
    await flushPromises();
    const sheet = document.querySelector('[data-testid="m-bottom-sheet-sheet"]') as HTMLElement;
    expect(sheet.style.maxHeight).toBe('92vh');
  });

  it('height raw string → propagate', async () => {
    mountSheet({ height: '70vh' });
    await flushPromises();
    const sheet = document.querySelector('[data-testid="m-bottom-sheet-sheet"]') as HTMLElement;
    expect(sheet.style.maxHeight).toBe('70vh');
  });

  it('testId propagate vào backdrop + sheet', async () => {
    mountSheet({ testId: 'home-tu-luyen-sheet' });
    await flushPromises();
    expect(document.querySelector('[data-testid="home-tu-luyen-sheet"]')).not.toBeNull();
    expect(
      document.querySelector('[data-testid="home-tu-luyen-sheet-sheet"]'),
    ).not.toBeNull();
  });
});
