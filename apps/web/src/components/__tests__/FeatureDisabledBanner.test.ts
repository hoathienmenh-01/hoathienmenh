/**
 * Phase 15.4 — FeatureDisabledBanner tests.
 *
 * Cover:
 *   - render default title + default message khi không có messageKey.
 *   - render custom messageKey i18n.
 *   - fallback về default message khi messageKey miss.
 *   - testId prop apply lên data-testid.
 */
import { describe, it, expect } from 'vitest';
import { mount } from '@vue/test-utils';
import { createI18n } from 'vue-i18n';
import FeatureDisabledBanner from '@/components/FeatureDisabledBanner.vue';

const i18n = createI18n({
  legacy: false,
  locale: 'vi',
  fallbackLocale: 'vi',
  messages: {
    vi: {
      featureFlags: {
        disabled: {
          title: 'Tạm tắt để bảo trì',
          message: 'Tính năng đang tạm tắt để bảo trì.',
        },
      },
      arena: {
        disabled: {
          message: 'Đấu Đài đang tạm tắt.',
        },
      },
    },
  },
});

describe('FeatureDisabledBanner', () => {
  it('default render — title + default message', () => {
    const w = mount(FeatureDisabledBanner, { global: { plugins: [i18n] } });
    expect(w.text()).toContain('Tạm tắt để bảo trì');
    expect(w.text()).toContain('Tính năng đang tạm tắt để bảo trì.');
    expect(w.find('[data-testid="feature-disabled-banner"]').exists()).toBe(
      true,
    );
  });

  it('messageKey override → render i18n key tương ứng', () => {
    const w = mount(FeatureDisabledBanner, {
      props: { messageKey: 'arena.disabled.message' },
      global: { plugins: [i18n] },
    });
    expect(w.text()).toContain('Đấu Đài đang tạm tắt.');
  });

  it('messageKey không tồn tại → fallback default message', () => {
    const w = mount(FeatureDisabledBanner, {
      props: { messageKey: 'nope.does.not.exist' },
      global: { plugins: [i18n] },
    });
    expect(w.text()).toContain('Tính năng đang tạm tắt để bảo trì.');
  });

  it('testId prop apply lên data-testid', () => {
    const w = mount(FeatureDisabledBanner, {
      props: { testId: 'arena-banner' },
      global: { plugins: [i18n] },
    });
    expect(w.find('[data-testid="arena-banner"]').exists()).toBe(true);
  });
});
