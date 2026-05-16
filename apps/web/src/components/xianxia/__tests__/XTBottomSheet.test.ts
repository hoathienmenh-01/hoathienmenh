import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import XTBottomSheet from '@/components/xianxia/XTBottomSheet.vue';

/**
 * XTBottomSheet — Cửu Thiên Mộng Phase 8 ornate bottom sheet.
 *
 * Cover:
 *   - render khi `open=true`, không render khi `open=false`.
 *   - title + subtitle render trong header.
 *   - close button có aria-label và emit `update:open` + `close`.
 *   - backdrop click dismiss khi không `persistent`.
 *   - persistent → backdrop click không dismiss.
 *   - Escape key dismiss khi không persistent.
 *   - tone class áp dụng đúng.
 *   - testId propagate cho backdrop / sheet / handle / close.
 *   - aria-modal + role=dialog.
 */
describe('XTBottomSheet', () => {
  beforeEach(() => {
    // Reset body style giữa các test.
    document.body.style.overflow = '';
    document.body.innerHTML = '';
  });
  afterEach(() => {
    document.body.style.overflow = '';
  });

  function getBackdrop(): HTMLElement | null {
    return document.body.querySelector(
      '[data-testid="xt-bottom-sheet"]',
    ) as HTMLElement | null;
  }

  function getSheet(testId = 'xt-bottom-sheet'): HTMLElement | null {
    return document.body.querySelector(
      `[data-testid="${testId}-sheet"]`,
    ) as HTMLElement | null;
  }

  it('không render khi open=false', () => {
    mount(XTBottomSheet, {
      props: { open: false },
      attachTo: document.body,
    });
    expect(getBackdrop()).toBeNull();
  });

  it('render khi open=true với role=dialog + aria-modal', async () => {
    mount(XTBottomSheet, {
      props: { open: true, title: 'Bộ lọc' },
      attachTo: document.body,
    });
    const sheet = getSheet();
    expect(sheet).not.toBeNull();
    expect(sheet?.getAttribute('role')).toBe('dialog');
    expect(sheet?.getAttribute('aria-modal')).toBe('true');
    expect(sheet?.getAttribute('aria-label')).toBe('Bộ lọc');
  });

  it('render title + subtitle trong header', () => {
    mount(XTBottomSheet, {
      props: { open: true, title: 'Tiêu đề', subtitle: 'Mô tả phụ' },
      attachTo: document.body,
    });
    const sheet = getSheet();
    expect(sheet?.textContent).toContain('Tiêu đề');
    expect(sheet?.textContent).toContain('Mô tả phụ');
  });

  it('close button có aria-label và emit update:open=false', async () => {
    const w = mount(XTBottomSheet, {
      props: { open: true, closeLabel: 'Đóng bộ lọc' },
      attachTo: document.body,
    });
    const btn = document.body.querySelector(
      '[data-testid="xt-bottom-sheet-close"]',
    ) as HTMLButtonElement | null;
    expect(btn).not.toBeNull();
    expect(btn?.getAttribute('aria-label')).toBe('Đóng bộ lọc');
    btn?.click();
    await w.vm.$nextTick();
    expect(w.emitted('update:open')?.[0]).toEqual([false]);
    expect(w.emitted('close')).toBeTruthy();
  });

  it('backdrop click dismiss khi không persistent', async () => {
    const w = mount(XTBottomSheet, {
      props: { open: true },
      attachTo: document.body,
    });
    const backdrop = getBackdrop();
    backdrop?.dispatchEvent(
      new MouseEvent('click', { bubbles: true, cancelable: true }),
    );
    await w.vm.$nextTick();
    expect(w.emitted('update:open')?.[0]).toEqual([false]);
  });

  it('persistent=true → backdrop click KHÔNG dismiss', async () => {
    const w = mount(XTBottomSheet, {
      props: { open: true, persistent: true },
      attachTo: document.body,
    });
    const backdrop = getBackdrop();
    backdrop?.dispatchEvent(
      new MouseEvent('click', { bubbles: true, cancelable: true }),
    );
    await w.vm.$nextTick();
    expect(w.emitted('update:open')).toBeFalsy();
  });

  it('Escape key dismiss khi không persistent', async () => {
    const w = mount(XTBottomSheet, {
      props: { open: true },
      attachTo: document.body,
    });
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    await w.vm.$nextTick();
    expect(w.emitted('update:open')?.[0]).toEqual([false]);
  });

  it('persistent=true → Escape KHÔNG dismiss', async () => {
    const w = mount(XTBottomSheet, {
      props: { open: true, persistent: true },
      attachTo: document.body,
    });
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    await w.vm.$nextTick();
    expect(w.emitted('update:open')).toBeFalsy();
  });

  it('tone="jade" áp class xt-bottom-sheet--jade', () => {
    mount(XTBottomSheet, {
      props: { open: true, tone: 'jade' },
      attachTo: document.body,
    });
    const sheet = getSheet();
    expect(sheet?.classList.contains('xt-bottom-sheet--jade')).toBe(true);
  });

  it('tone="sect" áp class xt-bottom-sheet--sect', () => {
    mount(XTBottomSheet, {
      props: { open: true, tone: 'sect' },
      attachTo: document.body,
    });
    const sheet = getSheet();
    expect(sheet?.classList.contains('xt-bottom-sheet--sect')).toBe(true);
  });

  it('testId custom propagate cho backdrop + sheet + handle + close', () => {
    mount(XTBottomSheet, {
      props: { open: true, testId: 'inv-sort-sheet' },
      attachTo: document.body,
    });
    expect(document.body.querySelector('[data-testid="inv-sort-sheet"]')).not.toBeNull();
    expect(document.body.querySelector('[data-testid="inv-sort-sheet-sheet"]')).not.toBeNull();
    expect(document.body.querySelector('[data-testid="inv-sort-sheet-handle"]')).not.toBeNull();
    expect(document.body.querySelector('[data-testid="inv-sort-sheet-close"]')).not.toBeNull();
  });

  it('hideHandle=true ẩn handle', () => {
    mount(XTBottomSheet, {
      props: { open: true, hideHandle: true },
      attachTo: document.body,
    });
    expect(
      document.body.querySelector('[data-testid="xt-bottom-sheet-handle"]'),
    ).toBeNull();
  });

  it('hideClose=true ẩn close button', () => {
    mount(XTBottomSheet, {
      props: { open: true, hideClose: true },
      attachTo: document.body,
    });
    expect(
      document.body.querySelector('[data-testid="xt-bottom-sheet-close"]'),
    ).toBeNull();
  });

  it('body.style.overflow = hidden khi mở, reset khi đóng', async () => {
    const w = mount(XTBottomSheet, {
      props: { open: true },
      attachTo: document.body,
    });
    expect(document.body.style.overflow).toBe('hidden');
    await w.setProps({ open: false });
    expect(document.body.style.overflow).toBe('');
  });
});
