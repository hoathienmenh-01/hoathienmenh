import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import { createI18n } from 'vue-i18n';
import { setActivePinia, createPinia } from 'pinia';

vi.mock('vue-router', () => ({
  useRoute: () => ({
    meta: { title: 'Test Title', description: 'Test Description', icon: 'cultivation' },
  }),
  useRouter: () => ({ push: vi.fn() }),
  RouterLink: { name: 'RouterLinkStub', template: '<a><slot /></a>' },
}));

vi.mock('@/components/shell/AppShell.vue', () => ({
  default: { name: 'AppShellStub', template: '<div data-testid="app-shell"><slot /></div>' },
}));
vi.mock('@/components/xianxia/GameIcon.vue', () => ({
  default: { name: 'GameIconStub', props: ['name', 'size'], template: '<span />' },
}));
vi.mock('@/components/xianxia/XianxiaBackButton.vue', () => ({
  default: { name: 'XianxiaBackButtonStub', props: ['label'], template: '<button />' },
}));
vi.mock('@/components/xianxia/XianxiaCard.vue', () => ({
  default: { name: 'XianxiaCardStub', template: '<div><slot /></div>' },
}));

import XianxiaPlaceholderView from '@/views/XianxiaPlaceholderView.vue';

const i18n = createI18n({
  legacy: false,
  locale: 'vi',
  fallbackLocale: 'vi',
  missingWarn: false,
  fallbackWarn: false,
  messages: {
    vi: {
      common: { back: 'Quay lại' },
      xianxiaPlaceholder: { title: 'Placeholder', description: 'Desc' },
    },
  },
});

function mountView() {
  return mount(XianxiaPlaceholderView, { global: { plugins: [i18n] } });
}

describe('XianxiaPlaceholderView — render', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
  });

  it('render placeholder card', () => {
    const w = mountView();
    expect(w.find('[data-testid="xianxia-placeholder"]').exists()).toBe(true);
    w.unmount();
  });

  it('render title from route meta', () => {
    const w = mountView();
    expect(w.text()).toContain('Test Title');
    w.unmount();
  });

  it('render description from route meta', () => {
    const w = mountView();
    expect(w.text()).toContain('Test Description');
    w.unmount();
  });
});
