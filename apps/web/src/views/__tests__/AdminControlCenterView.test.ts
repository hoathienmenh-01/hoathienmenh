import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { createI18n } from 'vue-i18n';
import { setActivePinia, createPinia } from 'pinia';

/**
 * AdminControlCenterView — regression test cho QA-004 + UX polish.
 *
 * QA-004: hydrate() được await trước role check (anti-race regression).
 * UX polish: hero, role hint, cross-navigation, data-testid, overview grid.
 */

const overviewMock = vi.fn();
const meMock = vi.fn();
const matrixMock = vi.fn();
const auditMock = vi.fn();
const rewardListMock = vi.fn();
const dropListMock = vi.fn();
const contentListMock = vi.fn();

vi.mock('@/api/adminControlCenter', () => ({
  adminControlCenterOverview: (...a: unknown[]) => overviewMock(...a),
  adminControlCenterMe: (...a: unknown[]) => meMock(...a),
  adminControlCenterPermissionMatrix: (...a: unknown[]) => matrixMock(...a),
  adminControlCenterAuditActionTypes: (...a: unknown[]) => auditMock(...a),
  listRewardProfiles: (...a: unknown[]) => rewardListMock(...a),
  listDropProfiles: (...a: unknown[]) => dropListMock(...a),
  listContentStatuses: (...a: unknown[]) => contentListMock(...a),
}));

const routerPushMock = vi.fn();
vi.mock('vue-router', () => ({
  useRouter: () => ({ push: routerPushMock }),
}));

const toastPushMock = vi.fn();
vi.mock('@/stores/toast', () => ({
  useToastStore: () => ({ push: toastPushMock }),
}));

interface AuthState {
  user: { id: string; role: 'ADMIN' | 'MOD' | 'PLAYER' } | null;
  isAuthenticated: boolean;
  isAdmin: boolean;
  hydrate: ReturnType<typeof vi.fn>;
}

const authState: AuthState = {
  user: null,
  isAuthenticated: false,
  isAdmin: false,
  hydrate: vi.fn().mockResolvedValue(undefined),
};
vi.mock('@/stores/auth', () => ({
  useAuthStore: () => authState,
}));

vi.mock('@/components/shell/AppShell.vue', () => ({
  default: {
    name: 'AppShellStub',
    template: '<div data-testid="app-shell"><slot /></div>',
  },
}));

vi.mock('@/components/ui/MButton.vue', () => ({
  default: {
    name: 'MButtonStub',
    template: '<button v-bind="$attrs"><slot /></button>',
  },
}));

vi.mock('@/components/xianxia/XTLuxHero.vue', () => ({
  default: {
    name: 'XTLuxHeroStub',
    props: ['eyebrow', 'label', 'title', 'subtitle', 'tone', 'watermarkLetter', 'breadcrumb', 'testId'],
    template: '<div :data-testid="testId"><slot /></div>',
  },
}));

vi.mock('@/components/xianxia/XTPullRefresh.vue', () => ({
  default: {
    name: 'XTPullRefreshStub',
    template: '<div><slot /></div>',
  },
}));

vi.mock('@/components/xianxia/XTPageEyebrow.vue', () => ({
  default: { name: 'XTPageEyebrowStub', template: '<div />' },
}));

vi.mock('@/components/xianxia/XTGlyphBadge.vue', () => ({
  default: { name: 'XTGlyphBadgeStub', template: '<span><slot /></span>' },
}));

import AdminControlCenterView from '@/views/AdminControlCenterView.vue';

const i18n = createI18n({
  legacy: false,
  locale: 'vi',
  fallbackLocale: 'vi',
  missingWarn: false,
  missingFallbackWarn: false,
  messages: {
    vi: {
      common: { refresh: 'Tải lại', loading: 'Đang xử lý…', pullToRefresh: 'pull', releaseToRefresh: 'release', refreshing: 'refreshing' },
      adminControlCenter: {
        title: 'Trung Tâm Vận Hành',
        roleLabel: 'Vai trò: {role}',
        notAdminError: 'Chỉ admin được vào trang này.',
        errorLoad: 'Tải dữ liệu thất bại ({code}).',
        roleHint: 'Bảng điều khiển quản trị.',
        breadcrumb: 'Trang chủ · Quản trị · Trung tâm vận hành',
        crossNav: {
          admin: 'Quản trị',
          adminDesc: 'Tổng quan',
          eventBuilder: 'LiveOps',
          eventBuilderDesc: 'Sự kiện',
          systemStatus: 'Hệ thống',
          systemStatusDesc: 'Trạng thái',
        },
        tab: {
          overview: 'Tổng quan',
          permissions: 'Phân quyền',
          rewardProfiles: 'Thưởng',
          dropProfiles: 'Rơi đồ',
          contentStatuses: 'Trạng thái',
          auditActions: 'Audit',
        },
        overview: {
          title: 'Tổng quan',
          generatedAt: 'Snapshot lúc {ts}',
          stat: {
            totalUsers: 'Tài khoản',
            activeUsersToday: 'User hoạt động',
            activeCharacters: 'Nhân vật',
            newUsersToday: 'User mới',
            mintedToday: 'Linh thạch phát ra',
            spentToday: 'Linh thạch tiêu thụ',
            rareDropsToday: 'Vật phẩm hiếm',
            farmSessionsToday: 'Phiên farm',
            dungeonRunsToday: 'Lượt phụ bản',
            bossKillsToday: 'Boss bị hạ',
            towerAttemptsToday: 'Lượt tháp',
            battlePassActiveSeason: 'Battle Pass',
            monthlyCardActiveCount: 'Thẻ tháng',
            suspiciousEventsCount: 'Bất thường',
            pendingTopupsCount: 'Topup chờ',
            activeFeatureFlags: 'Feature flag',
            activeEvents: 'Sự kiện',
            maintenanceStatus: 'Bảo trì',
          },
        },
        permissions: { title: 'Ma trận' },
        rewardProfiles: { title: 'Reward' },
        dropProfiles: { title: 'Drop' },
        contentStatuses: { title: 'Status' },
        auditActions: { title: 'Audit' },
      },
    },
  },
});

function mountView() {
  return mount(AdminControlCenterView, { global: { plugins: [i18n] } });
}

beforeEach(() => {
  setActivePinia(createPinia());
  vi.clearAllMocks();
  authState.user = null;
  authState.isAuthenticated = false;
  authState.isAdmin = false;
  authState.hydrate = vi.fn().mockResolvedValue(undefined);

  overviewMock.mockResolvedValue({
    totalUsers: 0,
    activeUsersToday: 0,
    activeCharacters: 0,
    newUsersToday: 0,
    mintedToday: 0,
    spentToday: 0,
    rareDropsToday: 0,
    farmSessionsToday: 0,
    dungeonRunsToday: 0,
    bossKillsToday: 0,
    towerAttemptsToday: 0,
    suspiciousEventsCount: 0,
    pendingTopupsCount: 0,
    activeFeatureFlags: [],
    activeEvents: [],
    maintenanceStatus: 'OFF',
    generatedAt: new Date().toISOString(),
  });
  meMock.mockResolvedValue({ role: 'SUPER_ADMIN', permissions: [] });
  matrixMock.mockResolvedValue({
    roles: [],
    permissions: [],
    rolePermissions: {},
  });
});

describe('AdminControlCenterView — QA-004 admin guard hydration', () => {
  it('admin hợp lệ (user resolve sau hydrate): KHÔNG redirect, load overview + matrix', async () => {
    authState.hydrate = vi.fn().mockImplementation(async () => {
      authState.user = { id: 'u1', role: 'ADMIN' };
      authState.isAuthenticated = true;
      authState.isAdmin = true;
    });

    const w = mountView();
    await flushPromises();

    expect(authState.hydrate).toHaveBeenCalledTimes(1);
    expect(routerPushMock).not.toHaveBeenCalled();
    expect(toastPushMock).not.toHaveBeenCalledWith(
      expect.objectContaining({
        text: 'Chỉ admin được vào trang này.',
      }),
    );
    expect(overviewMock).toHaveBeenCalled();
    expect(meMock).toHaveBeenCalled();
    expect(matrixMock).toHaveBeenCalled();
    w.unmount();
  });

  it('MOD cũng được vào (admin guard pass cho ADMIN/MOD)', async () => {
    authState.hydrate = vi.fn().mockImplementation(async () => {
      authState.user = { id: 'u2', role: 'MOD' };
      authState.isAuthenticated = true;
      authState.isAdmin = false;
    });

    const w = mountView();
    await flushPromises();

    expect(routerPushMock).not.toHaveBeenCalled();
    expect(overviewMock).toHaveBeenCalled();
    w.unmount();
  });

  it('non-admin (PLAYER): toast + redirect `/home`, không load overview', async () => {
    authState.hydrate = vi.fn().mockImplementation(async () => {
      authState.user = { id: 'u3', role: 'PLAYER' };
      authState.isAuthenticated = true;
      authState.isAdmin = false;
    });

    const w = mountView();
    await flushPromises();

    expect(toastPushMock).toHaveBeenCalledWith(
      expect.objectContaining({
        text: 'Chỉ admin được vào trang này.',
        type: 'error',
      }),
    );
    expect(routerPushMock).toHaveBeenCalledWith({ name: 'home' });
    expect(overviewMock).not.toHaveBeenCalled();
    expect(meMock).not.toHaveBeenCalled();
    w.unmount();
  });

  it('chưa login (hydrate vẫn null): redirect `/auth`, KHÔNG show "Chỉ admin"', async () => {
    authState.hydrate = vi.fn().mockImplementation(async () => {
      authState.user = null;
      authState.isAuthenticated = false;
      authState.isAdmin = false;
    });

    const w = mountView();
    await flushPromises();

    expect(routerPushMock).toHaveBeenCalledWith({ name: 'auth' });
    expect(toastPushMock).not.toHaveBeenCalledWith(
      expect.objectContaining({
        text: 'Chỉ admin được vào trang này.',
      }),
    );
    expect(overviewMock).not.toHaveBeenCalled();
    w.unmount();
  });

  it('hydrate() được await TRƯỚC role check (anti-race regression)', async () => {
    const callOrder: string[] = [];

    authState.hydrate = vi.fn().mockImplementation(async () => {
      callOrder.push('hydrate-resolve');
      authState.user = { id: 'u4', role: 'ADMIN' };
      authState.isAuthenticated = true;
      authState.isAdmin = true;
    });

    overviewMock.mockImplementation(async () => {
      callOrder.push('overview');
      return {
        totalUsers: 0,
        activeUsersToday: 0,
        activeCharacters: 0,
        newUsersToday: 0,
        mintedToday: 0,
        spentToday: 0,
        rareDropsToday: 0,
        farmSessionsToday: 0,
        dungeonRunsToday: 0,
        bossKillsToday: 0,
        towerAttemptsToday: 0,
        suspiciousEventsCount: 0,
        pendingTopupsCount: 0,
        activeFeatureFlags: [],
        activeEvents: [],
        maintenanceStatus: 'OFF',
        generatedAt: new Date().toISOString(),
      };
    });

    const w = mountView();
    await flushPromises();

    expect(callOrder[0]).toBe('hydrate-resolve');
    expect(callOrder).toContain('overview');
    expect(callOrder.indexOf('hydrate-resolve')).toBeLessThan(
      callOrder.indexOf('overview'),
    );
    w.unmount();
  });
});

describe('AdminControlCenterView — UX polish', () => {
  beforeEach(() => {
    authState.hydrate = vi.fn().mockImplementation(async () => {
      authState.user = { id: 'u1', role: 'ADMIN' };
      authState.isAuthenticated = true;
      authState.isAdmin = true;
    });
  });

  it('renders hero with title', async () => {
    const w = mountView();
    await flushPromises();
    expect(w.find('[data-testid="admin-cc-hero"]').exists()).toBe(true);
    w.unmount();
  });

  it('renders role hint', async () => {
    const w = mountView();
    await flushPromises();
    expect(w.find('[data-testid="admin-cc-role-hint"]').exists()).toBe(true);
    expect(w.text()).toContain('Bảng điều khiển quản trị.');
    w.unmount();
  });

  it('renders cross-navigation and navigates on click', async () => {
    const w = mountView();
    await flushPromises();
    expect(w.find('[data-testid="admin-cc-cross-nav"]').exists()).toBe(true);

    await w.find('[data-testid="cross-nav-admin"]').trigger('click');
    expect(routerPushMock).toHaveBeenCalledWith('/admin');

    await w.find('[data-testid="cross-nav-event-builder"]').trigger('click');
    expect(routerPushMock).toHaveBeenCalledWith('/admin/event-builder');

    await w.find('[data-testid="cross-nav-system-status"]').trigger('click');
    expect(routerPushMock).toHaveBeenCalledWith('/admin/system-status');
    w.unmount();
  });

  it('renders overview grid with data-testid after loading', async () => {
    const w = mountView();
    await flushPromises();
    expect(w.find('[data-testid="overview-grid"]').exists()).toBe(true);
    expect(w.find('[data-testid="tab-overview"]').exists()).toBe(true);
    w.unmount();
  });

  it('tabs have data-testid attributes', async () => {
    const w = mountView();
    await flushPromises();
    const tabNames = ['overview', 'permissions', 'rewardProfiles', 'dropProfiles', 'contentStatuses', 'auditActions'];
    for (const name of tabNames) {
      expect(w.find(`[data-testid="tab-${name}"]`).exists()).toBe(true);
    }
    w.unmount();
  });
});
