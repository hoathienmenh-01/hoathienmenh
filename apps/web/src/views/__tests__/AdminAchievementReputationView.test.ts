import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { createI18n } from 'vue-i18n';
import { setActivePinia, createPinia } from 'pinia';

const catalogMock = vi.fn().mockResolvedValue({
  achievements: [
    { key: 'first_kill', nameVi: 'First Kill', category: 'combat', tier: 'bronze', description: 'desc' },
  ],
  titles: [],
  reputationGroups: [],
  longTermGoals: [],
});
const progressMock = vi.fn().mockResolvedValue({
  userId: 'u1',
  characterName: 'Test',
  achievements: [],
  titles: [],
  reputation: [],
});

vi.mock('@/api/admin', () => ({
  adminAchievementCatalog: (...a: unknown[]) => catalogMock(...a),
  adminAchievementProgress: (...a: unknown[]) => progressMock(...a),
}));

vi.mock('@/lib/apiError', () => ({
  extractApiErrorCodeOrDefault: () => 'UNKNOWN',
}));

vi.mock('@/stores/auth', () => ({
  useAuthStore: () => ({
    hydrate: vi.fn().mockResolvedValue(undefined),
    isAuthenticated: true,
    isAdmin: true,
    user: { id: '1', role: 'ADMIN' },
  }),
}));
vi.mock('@/stores/toast', () => ({
  useToastStore: () => ({ push: vi.fn() }),
}));
vi.mock('vue-router', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));
vi.mock('@/components/shell/AppShell.vue', () => ({
  default: { name: 'AppShellStub', template: '<div data-testid="app-shell"><slot /></div>' },
}));
vi.mock('@/components/xianxia/XTPageEyebrow.vue', () => ({
  default: { name: 'XTPageEyebrowStub', template: '<div />' },
}));

import AdminAchievementReputationView from '@/views/AdminAchievementReputationView.vue';

const i18n = createI18n({
  legacy: false,
  locale: 'vi',
  fallbackLocale: 'vi',
  missingWarn: false,
  fallbackWarn: false,
  messages: {
    vi: {
      common: { loading: 'Đang tải', error: 'Lỗi' },
      adminAchievement: {
        title: 'Công Trạng Thẩm Định',
        subtitle: 'sub',
        summary: '{achievements} / {titles} / {groups} / {goals}',
        loading: 'Đang tải',
        catalogTitle: 'Catalog',
        progressTitle: 'Progress',
        loadProgress: 'Tải',
        userIdPlaceholder: 'User ID',
        stat: { achievements: 'A', titles: 'T', groups: 'G', goals: 'L' },
        errors: { load: 'Lỗi', progress: 'Lỗi' },
      },
    },
  },
});

function mountView(props?: { embedded?: boolean }) {
  return mount(AdminAchievementReputationView, {
    global: { plugins: [i18n] },
    props: props ?? {},
  });
}

describe('AdminAchievementReputationView — render', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
    catalogMock.mockResolvedValue({
      achievements: [
        { key: 'first_kill', nameVi: 'First Kill', category: 'combat', tier: 'bronze', description: 'desc' },
      ],
      titles: [],
      reputationGroups: [],
      longTermGoals: [],
    });
  });

  it('render title', async () => {
    const w = mountView();
    await flushPromises();
    expect(w.text()).toContain('Công Trạng Thẩm Định');
    w.unmount();
  });

  it('render summary after catalog loads', async () => {
    const w = mountView();
    await flushPromises();
    expect(w.find('[data-testid="admin-achievement-summary"]').exists()).toBe(true);
    w.unmount();
  });

  it('render stat cards', async () => {
    const w = mountView();
    await flushPromises();
    expect(w.find('[data-testid="admin-achievement-stat-achievements"]').exists()).toBe(true);
    expect(w.find('[data-testid="admin-achievement-stat-titles"]').exists()).toBe(true);
    expect(w.find('[data-testid="admin-achievement-stat-groups"]').exists()).toBe(true);
    expect(w.find('[data-testid="admin-achievement-stat-goals"]').exists()).toBe(true);
    w.unmount();
  });

  it('render catalog items', async () => {
    const w = mountView();
    await flushPromises();
    expect(w.find('[data-testid="admin-achievement-catalog-first_kill"]').exists()).toBe(true);
    w.unmount();
  });

  it('render user id input', async () => {
    const w = mountView();
    await flushPromises();
    expect(w.find('[data-testid="admin-achievement-user-id"]').exists()).toBe(true);
    expect(w.find('[data-testid="admin-achievement-load-progress"]').exists()).toBe(true);
    w.unmount();
  });
});
