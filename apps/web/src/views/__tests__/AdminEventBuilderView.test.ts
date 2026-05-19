import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { createI18n } from 'vue-i18n';
import { setActivePinia, createPinia } from 'pinia';

vi.mock('@/api/eventBuilder', () => ({
  adminEventCatalog: vi.fn().mockResolvedValue({ events: [] }),
  adminListEventTemplates: vi.fn().mockResolvedValue([]),
  adminListEvents: vi.fn().mockResolvedValue([]),
  adminGetEvent: vi.fn().mockResolvedValue(null),
  adminListBrackets: vi.fn().mockResolvedValue([]),
  adminListMissions: vi.fn().mockResolvedValue([]),
  adminListShops: vi.fn().mockResolvedValue([]),
  adminListRankings: vi.fn().mockResolvedValue([]),
  adminListBosses: vi.fn().mockResolvedValue([]),
  adminListItems: vi.fn().mockResolvedValue([]),
  adminTransitionEvent: vi.fn().mockResolvedValue({}),
  adminDeleteEvent: vi.fn().mockResolvedValue({}),
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
  useRouter: () => ({ push: vi.fn() }),
}));
vi.mock('@/components/shell/AppShell.vue', () => ({
  default: { name: 'AppShellStub', template: '<div data-testid="app-shell"><slot /></div>' },
}));
vi.mock('@/components/xianxia/XTLuxHero.vue', () => ({
  default: {
    name: 'XTLuxHeroStub',
    props: ['eyebrow', 'label', 'title', 'subtitle', 'tone', 'watermarkLetter', 'testId'],
    template: '<div :data-testid="testId"><slot /></div>',
  },
}));
vi.mock('@/components/ui/MButton.vue', () => ({
  default: { name: 'MButtonStub', template: '<button v-bind="$attrs"><slot /></button>' },
}));
vi.mock('@/components/admin/AdminEventCreateForm.vue', () => ({
  default: { name: 'AdminEventCreateFormStub', template: '<div />' },
}));

import AdminEventBuilderView from '@/views/AdminEventBuilderView.vue';

const i18n = createI18n({
  legacy: false,
  locale: 'vi',
  fallbackLocale: 'vi',
  missingWarn: false,
  fallbackWarn: false,
  messages: {
    vi: {
      adminEvents: {
        title: 'Event Builder',
        subtitle: 'sub',
        roleHint: 'Quản lý sự kiện.',
        loading: 'Đang tải',
        empty: 'Trống',
        selectFirst: 'Chọn',
        promptReason: 'Lý do',
        transitionSuccess: 'OK',
        tab: { events: 'Sự kiện', brackets: 'Bracket', missions: 'Nhiệm vụ', shops: 'Shop', bosses: 'Boss', rankings: 'Ranking', items: 'Item', templates: 'Template' },
        filter: { allStatuses: 'Tất cả', allTypes: 'Tất cả', anyEnabled: 'Tất cả', enabled: 'Bật', disabled: 'Tắt' },
        table: { key: 'Key', name: 'Tên', type: 'Loại', status: 'Trạng thái', enabled: 'Bật', actions: 'Hành động' },
        action: { create: 'Tạo', view: 'Xem', edit: 'Sửa', transition: 'Chuyển', delete: 'Xóa' },
        detail: { brackets: 'Bracket', missions: 'Nhiệm vụ', shops: 'Shop', bosses: 'Boss', rankings: 'Ranking', items: 'Item' },
        errors: { catalog: 'Lỗi', list: 'Lỗi', templates: 'Lỗi', detail: 'Lỗi', transition: 'Lỗi', delete: 'Lỗi' },
        promptDeleteReason: 'Lý do xóa',
        deleteSuccess: 'Đã xóa',
        form: { title: 'Tạo' },
        crossNav: {
          adminCC: 'Chủ Khiển',
          adminCCDesc: 'Tổng quan',
          systemStatus: 'Trạng Thái',
          systemStatusDesc: 'Hệ thống',
        },
      },
    },
  },
});

function mountView() {
  return mount(AdminEventBuilderView, { global: { plugins: [i18n] } });
}

describe('AdminEventBuilderView — UX polish', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
  });

  it('render hero', async () => {
    const w = mountView();
    await flushPromises();
    expect(w.find('[data-testid="admin-event-builder-hero"]').exists()).toBe(true);
  });

  it('render role hint', async () => {
    const w = mountView();
    await flushPromises();
    expect(w.find('[data-testid="admin-event-builder-role-hint"]').exists()).toBe(true);
    expect(w.find('[data-testid="admin-event-builder-role-hint"]').text()).toBeTruthy();
  });

  it('render cross-nav', async () => {
    const w = mountView();
    await flushPromises();
    expect(w.find('[data-testid="admin-event-builder-cross-nav"]').exists()).toBe(true);
    expect(w.find('[data-testid="cross-nav-admin-cc"]').exists()).toBe(true);
    expect(w.find('[data-testid="cross-nav-system-status"]').exists()).toBe(true);
  });
});
