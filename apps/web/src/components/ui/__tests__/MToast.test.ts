import { describe, it, expect, beforeEach } from 'vitest';
import { mount } from '@vue/test-utils';
import { setActivePinia, createPinia } from 'pinia';
import { useToastStore } from '@/stores/toast';
import MToast from '@/components/ui/MToast.vue';

/**
 * MToast smoke tests (session 9j task M): toast container rendered globally.
 * Regression can silently swallow all user-facing error/success feedback.
 * Covers: empty state, render from store, type-based styling, click-to-remove.
 */

function mountToast() {
  return mount(MToast);
}

beforeEach(() => {
  setActivePinia(createPinia());
});

describe('MToast', () => {
  it('store rỗng → không render toast div nào', () => {
    const w = mountToast();
    expect(w.findAll('.xt-toast')).toHaveLength(0);
  });

  it('push 1 toast → render title + text', () => {
    const store = useToastStore();
    store.push({ type: 'success', title: 'Thành công', text: 'Đã lưu' });
    const w = mountToast();
    expect(w.text()).toContain('Thành công');
    expect(w.text()).toContain('Đã lưu');
  });

  it('type=error → có tone class xt-toast--error', () => {
    const store = useToastStore();
    store.push({ type: 'error', title: 'Lỗi', text: 'Hỏng rồi' });
    const w = mountToast();
    expect(w.html()).toContain('xt-toast--error');
  });

  it('type=success → có tone class xt-toast--success', () => {
    const store = useToastStore();
    store.push({ type: 'success', title: 'OK', text: 'Lưu xong' });
    const w = mountToast();
    expect(w.html()).toContain('xt-toast--success');
  });

  it('type=warning → có tone class xt-toast--warning', () => {
    const store = useToastStore();
    store.push({ type: 'warning', title: 'Cảnh báo', text: 'Sắp hết' });
    const w = mountToast();
    expect(w.html()).toContain('xt-toast--warning');
  });

  it('push nhiều toast → render nhiều div', () => {
    const store = useToastStore();
    store.push({ type: 'info', title: 'A', text: 'a' });
    store.push({ type: 'info', title: 'B', text: 'b' });
    store.push({ type: 'info', title: 'C', text: 'c' });
    const w = mountToast();
    expect(w.text()).toContain('A');
    expect(w.text()).toContain('B');
    expect(w.text()).toContain('C');
  });

  it('click vào toast → gọi store.remove', async () => {
    const store = useToastStore();
    store.push({ type: 'info', title: 'X', text: 'click me' });
    const w = mountToast();
    expect(w.text()).toContain('click me');
    const toastDiv = w.find('.xt-toast');
    expect(toastDiv.exists()).toBe(true);
    await toastDiv.trigger('click');
    expect(store.toasts.length).toBe(0);
  });
});
