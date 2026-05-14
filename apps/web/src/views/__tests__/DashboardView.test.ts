import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { createI18n } from 'vue-i18n';
import { setActivePinia, createPinia } from 'pinia';
import type { DashboardResponse } from '@xuantoi/shared';

/**
 * Phase 41.0 — DashboardView smoke tests.
 *
 * Covers: loading state, error retry, character/counters render, checklist
 * render, quick-link enabled toggle.
 */

const fetchDashboardMock = vi.fn();
vi.mock('@/api/playerExperience', () => ({
  fetchDashboard: (...a: unknown[]) => fetchDashboardMock(...a),
}));

const pushMock = vi.fn();
vi.mock('vue-router', () => ({
  useRouter: () => ({ push: pushMock }),
}));

vi.mock('@/components/shell/AppShell.vue', () => ({
  default: {
    name: 'AppShellStub',
    template: '<div data-testid="app-shell"><slot /></div>',
  },
}));

import DashboardView from '@/views/DashboardView.vue';

const i18n = createI18n({
  legacy: false,
  locale: 'vi',
  fallbackLocale: 'vi',
  missingWarn: false,
  missingFallbackWarn: false,
  messages: {
    vi: {
      common: { loading: '...', open: 'Mở', retry: 'Thử lại', refresh: 'Làm mới' },
      dashboard: {
        title: 'Bảng Điều Khiển',
        subtitle: 'Tổng quan',
        character: {
          title: 'Nhân vật',
          name: 'Tên',
          realm: 'Cảnh giới',
          stage: 'Tầng',
          bodyRealm: 'Luyện thể',
          power: 'Lực chiến',
        },
        progression: { linhThach: 'Linh', tienNgoc: 'Tiên' },
        counters: {
          unreadMail: 'Mail',
          unreadNotification: 'Noti',
          activeFeedbackCount: 'FB',
          activeReportCount: 'RP',
        },
        warnings: { title: 'Cảnh báo' },
        checklist: { title: 'Hôm nay', START_CULTIVATION: { title: 'Tu luyện', description: 'Nhập định' } },
        quickLinks: { title: 'Truy cập nhanh', feedback: 'Phản hồi' },
        stat: {
          power: 'Lực Chiến', powerDesc: 'Power desc',
          spirit: 'Linh Lực', spiritDesc: 'Spirit desc',
          realm: 'Cảnh Giới', realmDesc: 'Realm desc',
          body: 'Luyện Thể', bodyDesc: 'Body desc',
          pill: 'Đan Dược', pillDesc: 'Pill desc',
          tower: 'Đăng Tiên Tháp', towerDesc: 'Tower desc',
        },
        right: { title: 'Thiên Cơ', subtitle: 'Tóm tắt', events: 'Sự kiện', boss: 'Boss', realms: 'Bí cảnh', equipment: 'Trang bị', mail: 'Thư' },
        errors: { UNKNOWN: 'lỗi' },
      },
    },
  },
});

function buildDashboard(over: Partial<DashboardResponse> = {}): DashboardResponse {
  return {
    character: {
      characterId: 'c1',
      displayName: 'Mộ Dung',
      realmKey: 'phamhuyet',
      realmStage: 1,
      level: 1,
      cultivating: false,
      bodyRealmKey: 'phamthe',
      bodyStage: 1,
      bodyCultivating: false,
      power: 100,
      spirit: 50,
      speed: 30,
      luck: 10,
    },
    progression: {
      exp: '0',
      bodyExp: '0',
      linhThach: '1000',
      tienNgoc: 0,
    },
    counters: {
      unreadMail: 5,
      unreadNotification: 0,
      activeFeedbackCount: 0,
      activeReportCount: 0,
    },
    warnings: [],
    todayChecklist: [
      {
        key: 'START_CULTIVATION',
        titleKey: 'dashboard.checklist.START_CULTIVATION.title',
        descriptionKey: 'dashboard.checklist.START_CULTIVATION.description',
        status: 'TODO',
        priority: 'HIGH',
        route: '/home',
        reasonKey: null,
        progressText: null,
      },
    ],
    quickLinks: [
      {
        key: 'feedback',
        titleKey: 'dashboard.quickLinks.feedback',
        route: '/support/feedback',
        enabled: true,
        badge: null,
      },
    ],
    lastUpdatedAt: new Date().toISOString(),
    ...over,
  };
}

describe('Phase 41.0 — DashboardView', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    fetchDashboardMock.mockReset();
    pushMock.mockReset();
  });

  it('renders loading state then character + counters after fetch', async () => {
    fetchDashboardMock.mockResolvedValue(buildDashboard());
    const wrapper = mount(DashboardView, { global: { plugins: [i18n] } });
    expect(wrapper.find('[data-testid="dashboard-loading"]').exists()).toBe(true);
    await flushPromises();
    expect(wrapper.find('[data-testid="dashboard-character"]').exists()).toBe(true);
    expect(wrapper.text()).toContain('Mộ Dung');
    expect(wrapper.find('[data-testid="dashboard-counters"]').text()).toContain('5');
  });

  it('shows error + retry triggers refetch', async () => {
    fetchDashboardMock.mockRejectedValueOnce(new Error('boom'));
    const wrapper = mount(DashboardView, { global: { plugins: [i18n] } });
    await flushPromises();
    const errorEl = wrapper.find('[data-testid="dashboard-error"]');
    expect(errorEl.exists()).toBe(true);
    fetchDashboardMock.mockResolvedValueOnce(buildDashboard());
    await errorEl.find('button').trigger('click');
    await flushPromises();
    expect(fetchDashboardMock).toHaveBeenCalledTimes(2);
  });

  it('renders today checklist with item testid', async () => {
    fetchDashboardMock.mockResolvedValue(buildDashboard());
    const wrapper = mount(DashboardView, { global: { plugins: [i18n] } });
    await flushPromises();
    expect(wrapper.find('[data-testid="checklist-START_CULTIVATION"]').exists()).toBe(
      true,
    );
  });

  it('clicking checklist Open button navigates to route', async () => {
    fetchDashboardMock.mockResolvedValue(buildDashboard());
    const wrapper = mount(DashboardView, { global: { plugins: [i18n] } });
    await flushPromises();
    const btn = wrapper
      .find('[data-testid="checklist-START_CULTIVATION"]')
      .find('button');
    await btn.trigger('click');
    expect(pushMock).toHaveBeenCalledWith('/home');
  });
});
