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

const fetchInventoryQolMock = vi.fn();
const lockInventoryItemMock = vi.fn();
const unlockInventoryItemMock = vi.fn();
const lockInventoryBatchMock = vi.fn();

vi.mock('@/api/inventory', () => ({
  fetchInventoryQol: (...a: unknown[]) => fetchInventoryQolMock(...a),
  lockInventoryItem: (...a: unknown[]) => lockInventoryItemMock(...a),
  unlockInventoryItem: (...a: unknown[]) => unlockInventoryItemMock(...a),
  lockInventoryBatch: (...a: unknown[]) => lockInventoryBatchMock(...a),
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

describe('InventoryAutoSortView — functional', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    fetchInventoryQolMock.mockReset();
    lockInventoryItemMock.mockReset();
    unlockInventoryItemMock.mockReset();
    lockInventoryBatchMock.mockReset();
    fetchInventoryQolMock.mockResolvedValue({ items: [], filtered: 0, total: 0 });
  });

  it('empty state khi items rỗng', async () => {
    fetchInventoryQolMock.mockResolvedValue({ items: [], filtered: 0, total: 0 });
    const w = mountView();
    await flushPromises();
    expect(w.find('[data-testid="inventory-auto-sort-empty"]').exists()).toBe(true);
  });

  it('render item grid khi có data', async () => {
    fetchInventoryQolMock.mockResolvedValue({
      items: [
        { id: 'i1', item: { name: 'Kiếm Sắt', quality: 'COMMON' }, qty: 1, locked: false, equippedSlot: null },
        { id: 'i2', item: { name: 'Áo Giáp', quality: 'RARE' }, qty: 3, locked: true, equippedSlot: 'weapon' },
      ],
      filtered: 2,
      total: 10,
    });
    const w = mountView();
    await flushPromises();
    expect(w.find('[data-testid="inventory-auto-sort-grid"]').exists()).toBe(true);
    expect(w.find('[data-testid="inventory-auto-sort-item-i1"]').exists()).toBe(true);
    expect(w.find('[data-testid="inventory-auto-sort-item-i2"]').exists()).toBe(true);
    expect(w.text()).toContain('Kiếm Sắt');
    expect(w.text()).toContain('Áo Giáp');
  });

  it('hiển thị counts header', async () => {
    fetchInventoryQolMock.mockResolvedValue({
      items: [{ id: 'i1', item: { name: 'Test', quality: 'COMMON' }, qty: 1, locked: false, equippedSlot: null }],
      filtered: 1,
      total: 5,
    });
    const w = mountView();
    await flushPromises();
    const counts = w.find('[data-testid="inventory-auto-sort-counts"]');
    expect(counts.exists()).toBe(true);
    expect(counts.text()).toContain('1');
    expect(counts.text()).toContain('5');
  });

  it('lock one item → gọi lockInventoryItem', async () => {
    lockInventoryItemMock.mockResolvedValue(undefined);
    fetchInventoryQolMock.mockResolvedValue({
      items: [
        { id: 'i1', item: { name: 'Kiếm Sắt', quality: 'COMMON' }, qty: 1, locked: false, equippedSlot: null },
      ],
      filtered: 1,
      total: 1,
    });
    const w = mountView();
    await flushPromises();
    await w.find('[data-testid="inventory-auto-sort-lock-i1"]').trigger('click');
    await flushPromises();
    expect(lockInventoryItemMock).toHaveBeenCalledWith('i1');
  });

  it('unlock one item → gọi unlockInventoryItem', async () => {
    unlockInventoryItemMock.mockResolvedValue(undefined);
    fetchInventoryQolMock.mockResolvedValue({
      items: [
        { id: 'i1', item: { name: 'Kiếm Sắt', quality: 'COMMON' }, qty: 1, locked: true, equippedSlot: null },
      ],
      filtered: 1,
      total: 1,
    });
    const w = mountView();
    await flushPromises();
    await w.find('[data-testid="inventory-auto-sort-lock-i1"]').trigger('click');
    await flushPromises();
    expect(unlockInventoryItemMock).toHaveBeenCalledWith('i1');
  });

  it('change sort select → trigger refresh', async () => {
    fetchInventoryQolMock.mockResolvedValue({ items: [], filtered: 0, total: 0 });
    const w = mountView();
    await flushPromises();
    fetchInventoryQolMock.mockClear();
    await w.find('[data-testid="inventory-auto-sort-sort-select"]').setValue('quality_desc');
    await flushPromises();
    expect(fetchInventoryQolMock).toHaveBeenCalled();
  });

  it('change bucket select → trigger refresh', async () => {
    fetchInventoryQolMock.mockResolvedValue({ items: [], filtered: 0, total: 0 });
    const w = mountView();
    await flushPromises();
    fetchInventoryQolMock.mockClear();
    await w.find('[data-testid="inventory-auto-sort-bucket-select"]').setValue('equipment');
    await flushPromises();
    expect(fetchInventoryQolMock).toHaveBeenCalled();
  });
});
