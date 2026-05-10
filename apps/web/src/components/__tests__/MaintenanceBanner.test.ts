/**
 * Phase 15.5 — MaintenanceBanner rendering tests.
 *
 * Cover:
 *   - render title + endsAt cho WARNING severity.
 *   - severity badge text ph\u1ea3i hi\u1ec7n.
 *   - en locale d\u00f9ng titleEn.
 */
import { describe, it, expect } from 'vitest';
import { mount } from '@vue/test-utils';
import { createI18n } from 'vue-i18n';
import type { MaintenanceWindowPublicView } from '@xuantoi/shared';
import MaintenanceBanner from '@/components/MaintenanceBanner.vue';

function makeI18n(locale: 'vi' | 'en') {
  return createI18n({
    legacy: false,
    locale,
    fallbackLocale: 'vi',
    messages: {
      vi: {
        maintenance: {
          banner: { title: 'Đang bảo trì', endsAt: 'kết thúc {at}' },
        },
      },
      en: {
        maintenance: {
          banner: { title: 'Maintenance in progress', endsAt: 'ends {at}' },
        },
      },
    },
  });
}

const STATUS: MaintenanceWindowPublicView = {
  active: true,
  severity: 'WARNING',
  target: 'ALL_PLAYERS',
  titleVi: 'Bảo trì hệ thống',
  titleEn: 'System maintenance',
  messageVi: '',
  messageEn: null,
  startsAt: '2026-08-01T00:00:00.000Z',
  endsAt: '2026-08-01T02:00:00.000Z',
  serverTime: '2026-08-01T00:30:00.000Z',
  allowAdminBypass: true,
};

describe('MaintenanceBanner', () => {
  it('hiển thị title vi + severity tag', () => {
    const w = mount(MaintenanceBanner, {
      props: { status: STATUS },
      global: { plugins: [makeI18n('vi')] },
    });
    expect(
      w.find('[data-testid="maintenance-banner-title"]').text(),
    ).toBe('Bảo trì hệ thống');
    expect(w.text()).toContain('WARNING');
    const ends = w.find('[data-testid="maintenance-banner-endsAt"]');
    expect(ends.exists()).toBe(true);
    expect(ends.text()).toContain('2026');
  });

  it('en locale dùng titleEn', () => {
    const w = mount(MaintenanceBanner, {
      props: { status: STATUS },
      global: { plugins: [makeI18n('en')] },
    });
    expect(
      w.find('[data-testid="maintenance-banner-title"]').text(),
    ).toBe('System maintenance');
  });
});
