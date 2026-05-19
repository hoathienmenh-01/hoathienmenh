import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { createI18n } from 'vue-i18n';
import { setActivePinia, createPinia } from 'pinia';

vi.mock('@/stores/auth', () => ({
  useAuthStore: () => ({
    user: { id: 'u1' },
  }),
}));
vi.mock('@/stores/toast', () => ({
  useToastStore: () => ({ push: vi.fn() }),
}));
vi.mock('@/api/inventory', () => ({
  fetchInventoryQol: vi.fn().mockResolvedValue({ items: [], filtered: 0, total: 0 }),
  lockInventoryItem: vi.fn().mockResolvedValue(undefined),
  unlockInventoryItem: vi.fn().mockResolvedValue(undefined),
  lockInventoryBatch: vi.fn().mockResolvedValue({ changed: 0 }),
}));
vi.mock('@/components/shell/AppShell.vue', () => ({
  default: { name: 'AppShellStub', template: '<div data-testid="app-shell"><slot /></div>' },
}));
vi.mock('@/components/xianxia/XTLuxHero.vue', () => ({
  default: { name: 'XTLuxHeroStub', props: ['testId'], template: '<div :data-testid="testId || \'hero\'"><slot /></div>' },
}));

import InventoryAutoSortView from '@/views/InventoryAutoSortView.vue';

const i18n = createI18n({
  legacy: false,
  locale: 'vi',
  fallbackLocale: 'vi',
  missingWarn: false,
  fallbackWarn: false,
  messages: {
    vi: {
      inventoryAutoSort: {
        title: 'Túi Đồ',
        subtitle: 'sub',
        loading: 'Đang tải',
        empty: 'Trống',
        roleHint: 'Quản lý túi đồ.',
        crossNav: {
          equipment: 'Trang Bị',
          equipmentDesc: 'desc',
          market: 'Chợ',
          marketDesc: 'desc',
        },
        sort: { default: 'Mặc định', quality_desc: 'Chất lượng ↓', quality_asc: 'Chất lượng ↑', kind: 'Loại', equipped_first: 'Trang bị trước', locked_first: 'Khóa trước', newest: 'Mới nhất', oldest: 'Cũ nhất' },
        bucket: { all: 'Tất cả', equipment: 'Trang bị', artifact: 'Pháp bảo', consumable: 'Tiêu hao', material: 'Nguyên liệu', skill_book: 'Sách', quest: 'Nhiệm vụ', locked: 'Khóa' },
        searchPlaceholder: 'Tìm...',
        applyFilters: 'Lọc',
        selected: '{n} mục',
        bulkLock: 'Khóa',
        bulkUnlock: 'Mở khóa',
        clearSelection: 'Bỏ chọn',
        counts: '{filtered}/{total}',
        bulkLockedToast: 'Khóa {n}',
        bulkUnlockedToast: 'Mở {n}',
        error: { UNKNOWN_ERROR: 'Lỗi' },
        slot: { weapon: 'Vũ khí' },
      },
    },
  },
});

function mountView() {
  return mount(InventoryAutoSortView, { global: { plugins: [i18n] } });
}

describe('InventoryAutoSortView — UX polish', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
  });

  it('render hero', async () => {
    const w = mountView();
    await flushPromises();
    expect(w.find('[data-testid="inventory-auto-sort-hero"]').exists()).toBe(true);
  });

  it('render role hint', async () => {
    const w = mountView();
    await flushPromises();
    expect(w.find('[data-testid="inventory-auto-sort-role-hint"]').exists()).toBe(true);
    expect(w.find('[data-testid="inventory-auto-sort-role-hint"]').text()).toBeTruthy();
  });

  it('render cross-nav', async () => {
    const w = mountView();
    await flushPromises();
    expect(w.find('[data-testid="inventory-auto-sort-cross-nav"]').exists()).toBe(true);
  });
});
