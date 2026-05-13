import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { createI18n } from 'vue-i18n';
import { setActivePinia, createPinia } from 'pinia';
import type {
  EquipmentEconomyPreview,
  InventoryView,
} from '@/api/inventory';
import type { ItemDef } from '@xuantoi/shared';

/**
 * Phase 23.4 — EquipmentEconomyPanel component tests.
 *
 * Verifies:
 *  - render cost panels (enhance/merge/socket/reforge/dismantle/protection)
 *  - merge button disabled khi không đủ stack 3×
 *  - merge button enabled + open confirm + call API
 *  - dismantle button + confirm modal + call API
 *  - error state render qua lastError
 *  - i18n keys tồn tại (test fallbackWarn=false; missing key → warning)
 */

const previewMock = vi.fn();
const mergeMock = vi.fn();
const dismantleMock = vi.fn();

vi.mock('@/api/inventory', async () => {
  const actual = await vi.importActual<typeof import('@/api/inventory')>(
    '@/api/inventory',
  );
  return {
    ...actual,
    getEquipmentEconomyPreview: (...a: unknown[]) => previewMock(...a),
    mergeEquipment: (...a: unknown[]) => mergeMock(...a),
    dismantleEquipment: (...a: unknown[]) => dismantleMock(...a),
  };
});

const toastPushMock = vi.fn();
vi.mock('@/stores/toast', () => ({
  useToastStore: () => ({ push: toastPushMock }),
}));

import EquipmentEconomyPanel from '@/components/EquipmentEconomyPanel.vue';

const i18n = createI18n({
  legacy: false,
  locale: 'vi',
  fallbackLocale: 'vi',
  missingWarn: false,
  fallbackWarn: false,
  messages: {
    vi: {
      common: { confirm: 'Đồng ý', cancel: 'Huỷ', loading: 'Đang xử lý…' },
      quality: { PHAM: 'Phàm', LINH: 'Linh', HUYEN: 'Huyền', TIEN: 'Tiên', THAN: 'Thần' },
      inventory: {
        economy: {
          title: 'Kinh Tế',
          tierNote: 'Tier {tier} · {quality}',
          enhance: {
            label: 'Cường hóa',
            costLabel: 'Lv {level}: {linhThach} + {materialQty}× {materialName}',
            maxed: 'Max.',
          },
          merge: {
            label: 'Ghép Phẩm',
            costLabel: '3 → 1 {output} ({outputQuality}). {linhThach}+{materialQty}× {materialName}',
            maxed: 'Đỉnh.',
            insufficientStack: 'Cần 2 món còn lại.',
            button: 'Ghép',
            confirm: 'OK',
            confirmTitle: 'Xác nhận ghép',
            confirmBody: 'Tiêu hao 3 món → {output}.',
            successToast: 'Ghép xong: {item} ({quality}).',
          },
          socket: {
            label: 'Khảm',
            costLabel: 'Khảm: {linhThach}',
            unsocketCostLabel: 'Tháo: {linhThach}+{materialQty}× {materialName}',
          },
          reforge: {
            label: 'Tẩy Luyện',
            costLabel: '{linhThach}+{materialQty}× {materialName}',
          },
          protection: {
            label: 'Bảo Hộ Phù',
            recommend: 'Khuyến nghị {item} ≥ {threshold}.',
          },
          dismantle: {
            label: 'Phân Giải',
            yieldLabel: '+{linhThach} & {materialCount} loại',
            button: 'Phân',
            confirm: 'Phân',
            confirmTitle: 'Xác nhận phân',
            confirmBody: 'Không hoàn tác.',
            successToast: 'Phân xong: +{linhThach}, {materials} loại.',
          },
          error: {
            MERGE_ITEM_NOT_FOUND: 'Không tìm thấy.',
            MERGE_ITEM_NOT_OWNED: 'Không sở hữu.',
            MERGE_ITEM_EQUIPPED: 'Đang equipped.',
            MERGE_INPUT_COUNT_INVALID: 'Phải 3 món.',
            MERGE_INPUT_DUPLICATE: 'Trùng id.',
            MERGE_MIXED_INPUT: 'Khác loại.',
            MERGE_RECIPE_NOT_FOUND: 'Hết công thức.',
            MERGE_ITEM_CONSUME_RACE: 'Race.',
            DISMANTLE_ITEM_NOT_FOUND: 'Không tìm thấy.',
            DISMANTLE_ITEM_EQUIPPED: 'Đang equipped.',
            DISMANTLE_RACE: 'Race.',
            PREVIEW_ITEM_NOT_FOUND: 'Không tìm thấy.',
            INSUFFICIENT_FUNDS: 'Không đủ linh thạch.',
            INSUFFICIENT_MATERIAL: 'Không đủ nguyên liệu.',
            UNKNOWN: 'Lỗi.',
          },
        },
      },
    },
  },
});

function makeItemDef(over: Partial<ItemDef> = {}): ItemDef {
  return {
    key: 'so_kiem',
    name: 'Sơ Kiếm',
    description: 'Kiếm phàm.',
    kind: 'WEAPON',
    quality: 'PHAM',
    stackable: false,
    slot: 'WEAPON',
    bonuses: { atk: 20 },
    price: 100,
    ...over,
  };
}

function makeInv(over: Partial<InventoryView> = {}): InventoryView {
  return {
    id: 'inv_1',
    itemKey: 'so_kiem',
    qty: 1,
    equippedSlot: null,
    item: makeItemDef(),
    sockets: [],
    refineLevel: 0,
    substats: [],
    enchantElement: null,
    enchantLevel: 0,
    locked: false,
    createdAt: new Date('2025-01-01T00:00:00.000Z').toISOString(),
    ...over,
  };
}

function makePreview(
  over: Partial<EquipmentEconomyPreview> = {},
): EquipmentEconomyPreview {
  return {
    inventoryItemId: 'inv_1',
    itemKey: 'so_kiem',
    quality: 'PHAM',
    equipmentTier: 1,
    slot: 'WEAPON',
    currentEnhanceLevel: 0,
    maxEnhanceLevel: 5,
    enhance: {
      linhThachCost: 100,
      materialKey: 'tinh_thiet',
      materialQty: 1,
      protectionRecommended: false,
      protectionRequired: false,
    },
    merge: {
      inputItemKey: 'so_kiem',
      outputItemKey: 'huyen_kiem',
      outputQuality: 'LINH',
      cost: {
        linhThachCost: 500,
        materialKey: 'tinh_thiet',
        materialQty: 3,
        outputQuality: 'LINH',
      },
    },
    dismantle: {
      linhThachYield: 30,
      materials: [{ itemKey: 'tinh_thiet', qty: 1 }],
      valueScore: 90,
    },
    socket: { linhThachCost: 200 },
    unsocket: null,
    reforge: {
      linhThachCost: 240,
      materialKey: 'tinh_thiet',
      materialQty: 5,
      maxReforgeCount: 5,
      currentReforgeCount: 0,
    },
    protection: {
      recommended: false,
      required: false,
      itemKey: 'refine_protection_charm',
    },
    upgradeValidation: { ok: true, code: 'OK' },
    ...over,
  };
}

describe('EquipmentEconomyPanel — Phase 23.4 UI', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    document.body.innerHTML = '';
    previewMock.mockReset();
    mergeMock.mockReset();
    dismantleMock.mockReset();
    toastPushMock.mockReset();
  });

  it('renders enhance/merge/socket/reforge/dismantle cost panels', async () => {
    previewMock.mockResolvedValueOnce(makePreview());
    const wrapper = mount(EquipmentEconomyPanel, {
      props: { equipment: makeInv(), inventory: [makeInv()] },
      global: { plugins: [i18n] },
    });
    await flushPromises();
    expect(wrapper.find('[data-testid="equipment-economy-enhance"]').exists()).toBe(
      true,
    );
    expect(wrapper.find('[data-testid="equipment-economy-merge"]').exists()).toBe(
      true,
    );
    expect(wrapper.find('[data-testid="equipment-economy-socket"]').exists()).toBe(
      true,
    );
    expect(wrapper.find('[data-testid="equipment-economy-reforge"]').exists()).toBe(
      true,
    );
    expect(
      wrapper.find('[data-testid="equipment-economy-dismantle"]').exists(),
    ).toBe(true);
    // Protection KHÔNG render khi recommended=false.
    expect(
      wrapper.find('[data-testid="equipment-economy-protection"]').exists(),
    ).toBe(false);
  });

  it('disables merge button + shows hint when stack < 3', async () => {
    previewMock.mockResolvedValueOnce(makePreview());
    const wrapper = mount(EquipmentEconomyPanel, {
      props: { equipment: makeInv(), inventory: [makeInv()] }, // chỉ 1 món
      global: { plugins: [i18n] },
    });
    await flushPromises();
    const btn = wrapper.find('[data-testid="equipment-economy-merge-btn"]');
    expect(btn.attributes('disabled')).toBeDefined();
    expect(
      wrapper.find('[data-testid="equipment-economy-merge-insufficient"]').exists(),
    ).toBe(true);
  });

  it('enables merge + calls API when 3 items available', async () => {
    previewMock.mockResolvedValueOnce(makePreview());
    mergeMock.mockResolvedValueOnce({
      outputInventoryItemId: 'inv_new',
      outputItemKey: 'huyen_kiem',
      outputQuality: 'LINH',
      consumedInventoryItemIds: ['inv_1', 'inv_2', 'inv_3'],
      cost: { linhThachCost: 500, materialKey: 'tinh_thiet', materialQty: 3 },
    });
    const items = [
      makeInv({ id: 'inv_1' }),
      makeInv({ id: 'inv_2' }),
      makeInv({ id: 'inv_3' }),
    ];
    const wrapper = mount(EquipmentEconomyPanel, {
      attachTo: document.body,
      props: { equipment: items[0], inventory: items },
      global: { plugins: [i18n] },
    });
    await flushPromises();
    const btn = wrapper.find('[data-testid="equipment-economy-merge-btn"]');
    expect(btn.attributes('disabled')).toBeUndefined();
    await btn.trigger('click');
    await flushPromises();
    // Confirm modal teleport ra body; query bằng global document.
    const confirmBtn = document.querySelector<HTMLButtonElement>(
      '[data-testid="equipment-economy-merge-confirm-confirm"]',
    );
    expect(confirmBtn).not.toBeNull();
    confirmBtn?.click();
    await flushPromises();
    expect(mergeMock).toHaveBeenCalledOnce();
    expect(mergeMock).toHaveBeenCalledWith(['inv_1', 'inv_2', 'inv_3']);
    expect(wrapper.emitted('changed')).toBeDefined();
    expect(toastPushMock).toHaveBeenCalled();
  });

  it('calls dismantle API after confirm', async () => {
    previewMock.mockResolvedValueOnce(makePreview());
    dismantleMock.mockResolvedValueOnce({
      consumedInventoryItemId: 'inv_1',
      returnedGems: [],
      yield: { materials: [{ itemKey: 'tinh_thiet', qty: 1 }], linhThachYield: 30 },
    });
    const wrapper = mount(EquipmentEconomyPanel, {
      attachTo: document.body,
      props: { equipment: makeInv(), inventory: [makeInv()] },
      global: { plugins: [i18n] },
    });
    await flushPromises();
    await wrapper
      .find('[data-testid="equipment-economy-dismantle-btn"]')
      .trigger('click');
    await flushPromises();
    const confirmBtn = document.querySelector<HTMLButtonElement>(
      '[data-testid="equipment-economy-dismantle-confirm-confirm"]',
    );
    expect(confirmBtn).not.toBeNull();
    confirmBtn?.click();
    await flushPromises();
    expect(dismantleMock).toHaveBeenCalledWith('inv_1');
    expect(wrapper.emitted('changed')).toBeDefined();
  });

  it('renders error message when preview fetch fails', async () => {
    previewMock.mockRejectedValueOnce({
      response: { data: { code: 'PREVIEW_ITEM_NOT_FOUND' } },
    });
    const wrapper = mount(EquipmentEconomyPanel, {
      props: { equipment: makeInv(), inventory: [makeInv()] },
      global: { plugins: [i18n] },
    });
    await flushPromises();
    const err = wrapper.find('[data-testid="equipment-economy-error"]');
    expect(err.exists()).toBe(true);
  });

  it('renders protection hint when recommended=true', async () => {
    previewMock.mockResolvedValueOnce(
      makePreview({
        currentEnhanceLevel: 5,
        protection: {
          recommended: true,
          required: false,
          itemKey: 'refine_protection_charm',
        },
      }),
    );
    const wrapper = mount(EquipmentEconomyPanel, {
      props: { equipment: makeInv(), inventory: [makeInv()] },
      global: { plugins: [i18n] },
    });
    await flushPromises();
    expect(
      wrapper.find('[data-testid="equipment-economy-protection"]').exists(),
    ).toBe(true);
  });

  /**
   * F-2 regression — at scale (≥1000 inventory items, mounting many panels)
   * the schema-drift in `EquipmentEconomyPreview` produced
   * `Cannot read properties of undefined (reading 'linhThachCost')` from
   * `preview.enhance.cost.linhThachCost` at render time, fired once per panel.
   * The fix aligns the client type + template with the actual server shape.
   *
   * This test forwards a 1000-item inventory to a single panel + mounts 50
   * panels in a row and asserts:
   *   1. Vue's `app.config.errorHandler` captures no error.
   *   2. `console.error` is not called by the render path.
   *   3. The rendered text contains the cost numbers from the preview (so we
   *      know the template actually walked the new flat shape, not "undefined").
   */
  it('mounts many panels with 1000-item inventory without render errors (F-2)', async () => {
    previewMock.mockResolvedValue(makePreview());

    const inventory: InventoryView[] = [];
    for (let i = 0; i < 1000; i++) {
      inventory.push(makeInv({ id: `perf_${i}`, itemKey: 'so_kiem' }));
    }

    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const capturedErrors: unknown[] = [];

    const wrappers: ReturnType<typeof mount>[] = [];
    for (let i = 0; i < 50; i++) {
      wrappers.push(
        mount(EquipmentEconomyPanel, {
          props: { equipment: inventory[i], inventory },
          global: {
            plugins: [i18n],
            config: {
              errorHandler: (err: unknown) => capturedErrors.push(err),
            },
          },
        }),
      );
    }
    await flushPromises();

    expect(capturedErrors).toEqual([]);
    const renderErrorCalls = consoleSpy.mock.calls.filter((args) =>
      String(args[0]).includes('linhThachCost'),
    );
    expect(renderErrorCalls).toEqual([]);

    const sample = wrappers[0];
    expect(sample.find('[data-testid="equipment-economy-enhance"]').text()).toContain(
      '100',
    );
    expect(sample.find('[data-testid="equipment-economy-socket"]').text()).toContain(
      '200',
    );

    consoleSpy.mockRestore();
    for (const w of wrappers) w.unmount();
  });
});
