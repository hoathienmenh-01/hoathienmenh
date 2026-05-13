import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { createI18n } from 'vue-i18n';
import { setActivePinia, createPinia } from 'pinia';

/**
 * AdminControlCenterView — regression test cho QA-004.
 *
 * Trước fix: `onMounted` check `isAdmin.value` ngay lập tức, race với
 * `auth.hydrate()`. Khi user reload trực tiếp `/admin/control-center`,
 * store chưa có `user` → admin hợp lệ bị toast + redirect `/home`.
 *
 * Sau fix: `onMounted` `await auth.hydrate()` trước, sau đó check
 * `isAuthenticated` + `isAdmin`. Test xác nhận:
 *   1. Admin hợp lệ → KHÔNG redirect, load overview + matrix.
 *   2. Non-admin → toast + redirect `/home`.
 *   3. Chưa login → redirect `/auth` (không show "Chỉ admin" toast).
 *   4. `hydrate()` được await trước role check (anti-race regression).
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

// Trạng thái auth có thể mutate trong từng test. `hydrate()` mô phỏng
// `api.session()` resolve sau khi component mount (đây chính là race
// condition mà QA-004 phát hiện).
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

import AdminControlCenterView from '@/views/AdminControlCenterView.vue';

const i18n = createI18n({
  legacy: false,
  locale: 'vi',
  fallbackLocale: 'vi',
  missingWarn: false,
  missingFallbackWarn: false,
  messages: {
    vi: {
      common: { refresh: 'Tải lại', loading: 'Đang xử lý…' },
      adminControlCenter: {
        title: 'Trung Tâm Vận Hành',
        roleLabel: 'Vai trò: {role}',
        notAdminError: 'Chỉ admin được vào trang này.',
        errorLoad: 'Tải dữ liệu thất bại ({code}).',
        tab: {
          overview: 'Tổng quan',
          permissions: 'Phân quyền',
          rewardProfiles: 'Thưởng',
          dropProfiles: 'Rơi đồ',
          contentStatuses: 'Trạng thái',
          auditActions: 'Audit',
        },
        overview: { title: 'Tổng quan' },
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
    // Mô phỏng race: tại thời điểm mount, store user = null. Sau khi
    // `hydrate()` resolve, user trở thành ADMIN. Đây là kịch bản direct
    // page reload `/admin/control-center` khi đã login.
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
      authState.isAdmin = false; // store getter chỉ true cho ADMIN
    });

    const w = mountView();
    await flushPromises();

    // View dùng computed `isAdmin` riêng cho phép cả MOD.
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
    // Không leak "Chỉ admin" toast cho guest user.
    expect(toastPushMock).not.toHaveBeenCalledWith(
      expect.objectContaining({
        text: 'Chỉ admin được vào trang này.',
      }),
    );
    expect(overviewMock).not.toHaveBeenCalled();
    w.unmount();
  });

  it('hydrate() được await TRƯỚC role check (anti-race regression)', async () => {
    // Test trực diện thứ tự: nếu role check chạy trước hydrate, callOrder
    // sẽ ghi 'role-check' trước 'hydrate'. Sau fix, hydrate phải xong
    // trước khi role check đọc `isAdmin`.
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
