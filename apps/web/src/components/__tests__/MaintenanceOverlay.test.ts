/**
 * Phase 15.5 — MaintenanceOverlay rendering tests.
 *
 * Cover:
 *   - render title/message theo locale (vi / en).
 *   - hi\u1ec3n th\u1ecb endsAt + error code MAINTENANCE_ACTIVE.
 *   - severity CRITICAL ki\u1ebfn ra extra hint text.
 *   - locale en fallback ti\u1ebfng vi\u1ec7t khi titleEn null.
 */
import { describe, it, expect } from 'vitest';
import { mount } from '@vue/test-utils';
import { createI18n } from 'vue-i18n';
import type { MaintenanceWindowPublicView } from '@xuantoi/shared';
import MaintenanceOverlay from '@/components/MaintenanceOverlay.vue';

function makeI18n(locale: 'vi' | 'en') {
  return createI18n({
    legacy: false,
    locale,
    fallbackLocale: 'vi',
    messages: {
      vi: {
        maintenance: {
          overlay: {
            title: 'Hệ thống đang bảo trì',
            endsAt: 'Dự kiến kết thúc: {at}',
            errorCode: 'Mã lỗi',
            criticalHint: 'Mức cao',
          },
        },
      },
      en: {
        maintenance: {
          overlay: {
            title: 'System under maintenance',
            endsAt: 'Expected to end: {at}',
            errorCode: 'Error code',
            criticalHint: 'Critical',
          },
        },
      },
    },
  });
}

function makeStatus(
  over: Partial<MaintenanceWindowPublicView> = {},
): MaintenanceWindowPublicView {
  return {
    active: true,
    severity: 'WARNING',
    target: 'ALL_PLAYERS',
    titleVi: 'Bảo trì hệ thống',
    titleEn: 'System maintenance',
    messageVi: 'Vui lòng quay lại sau.',
    messageEn: 'Please come back later.',
    startsAt: '2026-08-01T00:00:00.000Z',
    endsAt: '2026-08-01T02:00:00.000Z',
    serverTime: '2026-08-01T00:30:00.000Z',
    allowAdminBypass: true,
    ...over,
  };
}

describe('MaintenanceOverlay', () => {
  it('renders với locale vi: hiển thị titleVi/messageVi', () => {
    const w = mount(MaintenanceOverlay, {
      props: { status: makeStatus() },
      global: { plugins: [makeI18n('vi')] },
    });
    const title = w.find('[data-testid="maintenance-overlay-title"]');
    expect(title.exists()).toBe(true);
    expect(title.text()).toBe('Bảo trì hệ thống');
    expect(
      w.find('[data-testid="maintenance-overlay-message"]').text(),
    ).toBe('Vui lòng quay lại sau.');
    // error code visible
    expect(w.text()).toContain('MAINTENANCE_ACTIVE');
  });

  it('renders với locale en: dùng titleEn/messageEn', () => {
    const w = mount(MaintenanceOverlay, {
      props: { status: makeStatus() },
      global: { plugins: [makeI18n('en')] },
    });
    expect(
      w.find('[data-testid="maintenance-overlay-title"]').text(),
    ).toBe('System maintenance');
    expect(
      w.find('[data-testid="maintenance-overlay-message"]').text(),
    ).toBe('Please come back later.');
  });

  it('locale en + titleEn null → fallback titleVi', () => {
    const w = mount(MaintenanceOverlay, {
      props: { status: makeStatus({ titleEn: null, messageEn: null }) },
      global: { plugins: [makeI18n('en')] },
    });
    expect(
      w.find('[data-testid="maintenance-overlay-title"]').text(),
    ).toBe('Bảo trì hệ thống');
  });

  it('CRITICAL severity hiển thị thêm hint', () => {
    const w = mount(MaintenanceOverlay, {
      props: { status: makeStatus({ severity: 'CRITICAL' }) },
      global: { plugins: [makeI18n('vi')] },
    });
    expect(w.text()).toContain('Mức cao');
  });

  it('endsAt formatted (chứa năm 2026)', () => {
    const w = mount(MaintenanceOverlay, {
      props: { status: makeStatus() },
      global: { plugins: [makeI18n('vi')] },
    });
    const endsAt = w.find('[data-testid="maintenance-overlay-endsAt"]');
    expect(endsAt.exists()).toBe(true);
    expect(endsAt.text()).toContain('2026');
  });
});
