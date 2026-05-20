import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { createI18n } from 'vue-i18n';
import { setActivePinia, createPinia } from 'pinia';

const fetchStatusMock = vi.fn().mockResolvedValue({
  status: 'ok',
  serviceName: 'xuantoi-api',
  environment: 'development',
  version: '1.0.0',
  buildCommit: 'abc123',
  node: 'v20.0.0',
  uptimeSeconds: 3600,
  timestamp: new Date().toISOString(),
  checks: {
    api: { status: 'ok', latencyMs: 5 },
    db: { status: 'ok', latencyMs: 10 },
    redis: { status: 'ok', latencyMs: 3 },
  },
  recentErrors: { last24h: 0, bySeverity: { FATAL: 0, ERROR: 0, WARN: 0 } },
  adminActivity: { last24h: 5 },
  integrity: null,
});
const listErrorsMock = vi.fn().mockResolvedValue({ rows: [], total: 0 });

vi.mock('@/api/systemStatus', () => ({
  fetchSystemStatus: (...a: unknown[]) => fetchStatusMock(...a),
  listSystemErrors: (...a: unknown[]) => listErrorsMock(...a),
}));

vi.mock('@/lib/apiError', () => ({
  extractApiErrorCodeOrDefault: () => 'UNKNOWN',
}));

const authState: {
  user: { id: string; role: 'ADMIN' | 'MOD' | 'PLAYER' };
  isAuthenticated: boolean;
  isAdmin: boolean;
  hydrate: ReturnType<typeof vi.fn>;
} = {
  user: { id: '1', role: 'ADMIN' },
  isAuthenticated: true,
  isAdmin: true,
  hydrate: vi.fn().mockResolvedValue(undefined),
};
vi.mock('@/stores/auth', () => ({
  useAuthStore: () => authState,
}));
vi.mock('vue-router', () => ({
  useRouter: () => ({ push: vi.fn() }),
}));
vi.mock('@/components/shell/AppShell.vue', () => ({
  default: { name: 'AppShellStub', template: '<div data-testid="app-shell"><slot /></div>' },
}));
vi.mock('@/components/xianxia/XTPageEyebrow.vue', () => ({
  default: { name: 'XTPageEyebrowStub', template: '<div />' },
}));
vi.mock('@/components/ui/LoadingState.vue', () => ({
  default: { name: 'LoadingStateStub', template: '<div data-testid="loading-state">Loading...</div>' },
}));
vi.mock('@/components/ui/EmptyState.vue', () => ({
  default: { name: 'EmptyStateStub', template: '<div data-testid="empty-state"><slot /></div>' },
}));
vi.mock('@/components/ui/ErrorState.vue', () => ({
  default: { name: 'ErrorStateStub', template: '<div data-testid="error-state"><slot /></div>' },
}));

import AdminSystemStatusView from '@/views/AdminSystemStatusView.vue';

const i18n = createI18n({
  legacy: false,
  locale: 'vi',
  fallbackLocale: 'vi',
  missingWarn: false,
  fallbackWarn: false,
  messages: {
    vi: {
      adminSystemStatus: {
        title: 'Xã Tắc Trần Ủy',
        subtitle: 'sub',
        notAdminTitle: 'Forbidden',
        notAdminDescription: 'No access',
        emptyTitle: 'Empty',
        emptyDescription: 'No data',
        status: { ok: 'OK', degraded: 'Degraded', down: 'Down' },
        serviceName: 'Service',
        environment: 'Env',
        version: 'Version',
        buildCommit: 'Commit',
        nodeVersion: 'Node',
        uptime: 'Uptime',
        timestamp: 'Time',
        dependencyChecks: 'Checks',
        activity24h: 'Activity',
        recentErrorsTotal: 'Errors',
        adminActions: 'Admin',
        integrityTitle: 'Integrity',
        integrityNeverRun: 'Never',
        integrityRunAt: 'Run',
        integrityScopes: 'Scopes',
        integrityIssueCount: 'Issues',
        integrityStatus: { CLEAN: 'Clean', ISSUES: 'Issues' },
        recentErrorsTitle: 'Recent',
        recentErrorsEmpty: 'None',
        errors: { UNKNOWN: 'Lỗi' },
      },
    },
  },
});

function mountView() {
  return mount(AdminSystemStatusView, { global: { plugins: [i18n] } });
}

describe('AdminSystemStatusView — render', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
    authState.user = { id: '1', role: 'ADMIN' };
    authState.isAdmin = true;
    fetchStatusMock.mockResolvedValue({
      status: 'ok',
      serviceName: 'xuantoi-api',
      environment: 'development',
      version: '1.0.0',
      buildCommit: 'abc123',
      node: 'v20.0.0',
      uptimeSeconds: 3600,
      timestamp: new Date().toISOString(),
      checks: {
        api: { status: 'ok', latencyMs: 5 },
        db: { status: 'ok', latencyMs: 10 },
        redis: { status: 'ok', latencyMs: 3 },
      },
      recentErrors: { last24h: 0, bySeverity: { FATAL: 0, ERROR: 0, WARN: 0 } },
      adminActivity: { last24h: 5 },
      integrity: null,
    });
  });

  it('render title', async () => {
    const w = mountView();
    await flushPromises();
    expect(w.text()).toContain('Xã Tắc Trần');
    w.unmount();
  });

  it('render status badge after load', async () => {
    const w = mountView();
    await flushPromises();
    expect(w.find('[data-testid="admin-system-status-badge"]').exists()).toBe(true);
    expect(w.find('[data-testid="admin-system-status-badge"]').text()).toBe('OK');
    w.unmount();
  });

  it('render overview section', async () => {
    const w = mountView();
    await flushPromises();
    expect(w.find('[data-testid="admin-system-status-overview"]').exists()).toBe(true);
    expect(w.text()).toContain('xuantoi-api');
    expect(w.text()).toContain('development');
    w.unmount();
  });

  it('render dependency checks', async () => {
    const w = mountView();
    await flushPromises();
    expect(w.find('[data-testid="admin-system-status-checks"]').exists()).toBe(true);
    expect(w.find('[data-testid="admin-system-check-api"]').exists()).toBe(true);
    expect(w.find('[data-testid="admin-system-check-db"]').exists()).toBe(true);
    expect(w.find('[data-testid="admin-system-check-redis"]').exists()).toBe(true);
    w.unmount();
  });

  it('render counters section', async () => {
    const w = mountView();
    await flushPromises();
    expect(w.find('[data-testid="admin-system-status-counters"]').exists()).toBe(true);
    w.unmount();
  });

  it('render forbidden for non-admin', async () => {
    authState.user = { id: '2', role: 'PLAYER' };
    authState.isAdmin = false;
    const w = mountView();
    await flushPromises();
    expect(w.find('[data-testid="admin-system-status-forbidden"]').exists()).toBe(true);
    w.unmount();
  });
});
