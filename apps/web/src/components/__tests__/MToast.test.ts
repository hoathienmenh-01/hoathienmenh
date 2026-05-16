/**
 * Tests cho UI atom `apps/web/src/components/ui/MToast.vue`.
 *
 * Renders fixed top-right stack từ Pinia `useToastStore`. Mỗi toast:
 *  - color theo type (error/warning/success/info)
 *  - title + text
 *  - click → store.remove(id)
 *
 * Lock-in: rendering từ store reactive, color class mapping per type, click
 * removal, empty state (no toast → no toast div), order preservation.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import { createI18n } from 'vue-i18n';
import { createPinia, setActivePinia } from 'pinia';

import MToast from '@/components/ui/MToast.vue';
import { useToastStore } from '@/stores/toast';

const i18n = createI18n({
  legacy: false,
  locale: 'vi',
  fallbackLocale: 'vi',
  messages: {
    vi: {
      toast: {
        title: {
          info: 'Tin tức',
          warning: 'Cảnh báo',
          error: 'Lỗi',
          success: 'Thành công',
          system: 'Thiên Đạo Sứ Giả',
        },
      },
    },
  },
});

describe('MToast', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });
  afterEach(() => {
    setActivePinia(undefined as unknown as ReturnType<typeof createPinia>);
  });

  it('empty store → 0 toast div rendered', () => {
    const w = mount(MToast, { global: { plugins: [i18n] } });
    expect(w.findAll('.xt-toast')).toHaveLength(0);
  });

  it('1 toast info → render title + text', async () => {
    const store = useToastStore();
    store.push({ type: 'info', text: 'Hello' });
    const w = mount(MToast, { global: { plugins: [i18n] } });
    expect(w.text()).toContain('Hello');
  });

  it('error toast → seal tone class xt-toast--error', () => {
    const store = useToastStore();
    store.push({ type: 'error', text: 'Boom' });
    const w = mount(MToast, { global: { plugins: [i18n] } });
    expect(w.html()).toContain('xt-toast--error');
  });

  it('warning toast → warning tone class xt-toast--warning', () => {
    const store = useToastStore();
    store.push({ type: 'warning', text: 'Careful' });
    const w = mount(MToast, { global: { plugins: [i18n] } });
    expect(w.html()).toContain('xt-toast--warning');
  });

  it('success toast → jade tone class xt-toast--success', () => {
    const store = useToastStore();
    store.push({ type: 'success', text: 'Done' });
    const w = mount(MToast, { global: { plugins: [i18n] } });
    expect(w.html()).toContain('xt-toast--success');
  });

  it('multiple toasts → preserved order', () => {
    const store = useToastStore();
    store.push({ type: 'info', text: 'First' });
    store.push({ type: 'success', text: 'Second' });
    store.push({ type: 'error', text: 'Third' });
    const w = mount(MToast, { global: { plugins: [i18n] } });
    const html = w.html();
    expect(html.indexOf('First')).toBeLessThan(html.indexOf('Second'));
    expect(html.indexOf('Second')).toBeLessThan(html.indexOf('Third'));
  });

  it('click toast → store.remove() removes it (async DOM update)', async () => {
    const store = useToastStore();
    store.push({ type: 'info', text: 'Click me' });
    const w = mount(MToast, { global: { plugins: [i18n] } });
    expect(store.toasts).toHaveLength(1);
    await w.find('.xt-toast').trigger('click');
    expect(store.toasts).toHaveLength(0);
  });

  it('container có fixed top-right z-50 (positioning lock-in)', () => {
    const w = mount(MToast, { global: { plugins: [i18n] } });
    const root = w.find('div').attributes('class') ?? '';
    expect(root).toContain('fixed');
    expect(root).toContain('top-4');
    expect(root).toContain('right-4');
    expect(root).toContain('z-50');
  });
});
