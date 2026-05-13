import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { createI18n } from 'vue-i18n';
import { setActivePinia, createPinia } from 'pinia';
import type {
  EquipmentReforgeResult,
  EquipmentEnchantResult,
  EquipmentUpgradePreview,
  InventoryView,
} from '@/api/inventory';
import type { ItemDef } from '@xuantoi/shared';

/**
 * Phase 15.0.A — EquipmentUpgradePanel component tests.
 *
 * Verifies UI render of:
 *  - empty state khi chưa có substats / chưa enchant
 *  - cost preview reforge + enchant
 *  - confirm modal mở khi click Reforge / Enchant
 *  - success state: emit 'changed' + toast push
 *  - error state: render lastError + toast push
 *  - element button locked khi enchantLevel >= 1
 *  - i18n keys tồn tại đầy đủ (vi locale)
 */

const previewMock = vi.fn();
const reforgeMock = vi.fn();
const enchantMock = vi.fn();

vi.mock('@/api/inventory', async () => {
  const actual = await vi.importActual<typeof import('@/api/inventory')>(
    '@/api/inventory',
  );
  return {
    ...actual,
    getEquipmentUpgradePreview: (...a: unknown[]) => previewMock(...a),
    reforgeEquipment: (...a: unknown[]) => reforgeMock(...a),
    enchantEquipment: (...a: unknown[]) => enchantMock(...a),
  };
});

const toastPushMock = vi.fn();
vi.mock('@/stores/toast', () => ({
  useToastStore: () => ({ push: toastPushMock }),
}));

import EquipmentUpgradePanel from '@/components/EquipmentUpgradePanel.vue';

const i18n = createI18n({
  legacy: false,
  locale: 'vi',
  fallbackLocale: 'vi',
  missingWarn: false,
  fallbackWarn: false,
  messages: {
    vi: {
      common: { confirm: 'Đồng ý', cancel: 'Huỷ', loading: 'Đang xử lý…' },
      elementBadge: {
        element: { kim: 'Kim', moc: 'Mộc', thuy: 'Thuỷ', hoa: 'Hoả', tho: 'Thổ' },
      },
      inventory: {
        upgrade: {
          title: 'Tẩy Luyện · Phụ Ma',
          none: 'Không',
          substatKind: {
            atk: 'công',
            def: 'thủ',
            hpMax: 'sinh lực',
            mpMax: 'linh lực',
            spirit: 'thần thức',
          },
          substatRow: '+{value} {kind}',
          reforge: {
            currentSubstats: 'Chỉ số phụ hiện tại',
            empty: 'Chưa có chỉ số phụ.',
            costLabel: 'Phí: {linhThach} LT + {materialQty}× {materialName}',
            button: 'Tẩy Luyện',
            badgeLabel: '+{count} phụ',
            confirmTitle: 'Xác nhận tẩy luyện',
            confirmMessage:
              'Tiêu hao {linhThach} LT + {materialQty}× {materialName}. Gieo lại.',
            successToast: 'Tẩy luyện thành công — {count} chỉ số.',
          },
          enchant: {
            currentLabel: 'Phụ ma Ngũ Hành',
            currentText: '{element} cấp {level}/{max}',
            empty: 'Chưa phụ ma.',
            badgeLabel: '{element}+{level}',
            maxLabel: 'Phụ ma đỉnh ({max}).',
            costLabel: 'Lên cấp {level}: {linhThach} LT + {materialQty}× {materialName}',
            button: 'Phụ Ma',
            confirmTitle: 'Xác nhận phụ ma',
            confirmMessage:
              'Phụ ma {element} cấp {level}? {linhThach} LT + {materialQty}× {materialName}.',
            successToast: 'Phụ ma {element} thành công — cấp {level}.',
          },
          error: {
            EQUIPMENT_NOT_FOUND: 'Không tìm thấy.',
            INVALID_EQUIPMENT: 'Item không hợp lệ.',
            INSUFFICIENT_FUNDS: 'Không đủ linh thạch.',
            INSUFFICIENT_MATERIAL: 'Không đủ nguyên liệu.',
            MAX_ENCHANT_REACHED: 'Phụ ma đã max.',
            INVALID_ELEMENT: 'Hệ không hợp lệ.',
            ELEMENT_LOCKED: 'Hệ đã khoá.',
            NO_ELEMENT_SELECTED: 'Hãy chọn 1 hệ.',
            UNKNOWN: 'Lỗi không xác định.',
          },
        },
      },
    },
  },
});

function makeItemDef(over: Partial<ItemDef> = {}): ItemDef {
  return {
    key: 'huyen_kiem',
    name: 'Huyền Kiếm',
    description: 'Kiếm linh phẩm.',
    kind: 'WEAPON',
    quality: 'LINH',
    stackable: false,
    slot: 'WEAPON',
    bonuses: { atk: 80 },
    price: 1000,
    ...over,
  };
}

function makeInv(over: Partial<InventoryView> = {}): InventoryView {
  return {
    id: 'inv_1',
    itemKey: 'huyen_kiem',
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

function makePreview(over: Partial<EquipmentUpgradePreview> = {}): EquipmentUpgradePreview {
  return {
    inventoryItemId: 'inv_1',
    itemKey: 'huyen_kiem',
    quality: 'LINH',
    reforge: {
      slots: 2,
      currentSubstats: [],
      currentBonus: { atk: 0, def: 0, hpMax: 0, mpMax: 0, spirit: 0 },
      nextCost: { linhThachCost: 240, materialKey: 'tinh_thiet', materialQty: 5 },
    },
    enchant: {
      currentElement: null,
      currentLevel: 0,
      maxLevel: 5,
      currentBonus: { atk: 0, def: 0, hpMax: 0, mpMax: 0, spirit: 0 },
      nextCost: { linhThachCost: 320, materialKey: 'yeu_dan', materialQty: 1 },
      baseLinhThachCost: 320,
      materialKey: 'yeu_dan',
      materialQty: 1,
      elements: [
        {
          element: 'kim',
          effect: { element: 'kim', statKind: 'atk', bonusPerLevel: 6, labelVi: 'Kim · Sát', labelEn: 'Kim' },
        },
        {
          element: 'moc',
          effect: { element: 'moc', statKind: 'hpMax', bonusPerLevel: 24, labelVi: 'Mộc · Sinh', labelEn: 'Moc' },
        },
        {
          element: 'thuy',
          effect: { element: 'thuy', statKind: 'mpMax', bonusPerLevel: 18, labelVi: 'Thuỷ · Hoá', labelEn: 'Thuy' },
        },
        {
          element: 'hoa',
          effect: { element: 'hoa', statKind: 'atk', bonusPerLevel: 8, labelVi: 'Hoả · Phát', labelEn: 'Hoa' },
        },
        {
          element: 'tho',
          effect: { element: 'tho', statKind: 'def', bonusPerLevel: 10, labelVi: 'Thổ · Thủ', labelEn: 'Tho' },
        },
      ],
    },
    ...over,
  };
}

function mountPanel(equipment: InventoryView) {
  return mount(EquipmentUpgradePanel, {
    attachTo: document.body,
    props: { equipment },
    global: { plugins: [createPinia(), i18n] },
  });
}

describe('EquipmentUpgradePanel — Phase 15.0.A render & flow', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    document.body.innerHTML = '';
    previewMock.mockReset();
    reforgeMock.mockReset();
    enchantMock.mockReset();
    toastPushMock.mockReset();
  });

  it('hiển trang bị (slot truthy) → render section title + load preview', async () => {
    previewMock.mockResolvedValue(makePreview());
    const w = mountPanel(makeInv());
    await flushPromises();
    expect(w.find('[data-testid="equipment-upgrade-panel"]').exists()).toBe(true);
    expect(w.text()).toContain('Tẩy Luyện · Phụ Ma');
    expect(previewMock).toHaveBeenCalledWith('inv_1');
  });

  it('item không phải equipment slot → KHÔNG render panel', async () => {
    const inv = makeInv({
      item: makeItemDef({ slot: undefined, kind: 'PILL_HP' }),
    });
    const w = mountPanel(inv);
    await flushPromises();
    expect(w.find('[data-testid="equipment-upgrade-panel"]').exists()).toBe(false);
    expect(previewMock).not.toHaveBeenCalled();
  });

  it('preview empty (chưa reforge / chưa enchant) → render empty placeholders', async () => {
    previewMock.mockResolvedValue(makePreview());
    const w = mountPanel(makeInv());
    await flushPromises();
    expect(w.text()).toContain('Chưa có chỉ số phụ.');
    expect(w.text()).toContain('Chưa phụ ma.');
  });

  it('preview có substats → render từng row', async () => {
    previewMock.mockResolvedValue(
      makePreview({
        reforge: {
          slots: 2,
          currentSubstats: [
            { kind: 'atk', value: 12 },
            { kind: 'def', value: 7 },
          ],
          currentBonus: { atk: 12, def: 7, hpMax: 0, mpMax: 0, spirit: 0 },
          nextCost: { linhThachCost: 240, materialKey: 'tinh_thiet', materialQty: 5 },
        },
      }),
    );
    const w = mountPanel(makeInv({ substats: [{ kind: 'atk', value: 12 }] }));
    await flushPromises();
    const rows = w.findAll('[data-testid="equipment-upgrade-substat-row"]');
    expect(rows).toHaveLength(2);
    expect(rows[0].text()).toContain('+12');
    expect(rows[0].text()).toContain('công');
  });

  it('cost preview reforge + enchant render đầy đủ giá tiền + tên material', async () => {
    previewMock.mockResolvedValue(makePreview());
    const w = mountPanel(makeInv());
    await flushPromises();
    expect(
      w.find('[data-testid="equipment-upgrade-reforge-cost"]').text(),
    ).toContain('240');
    expect(
      w.find('[data-testid="equipment-upgrade-enchant-cost"]').text(),
    ).toContain('320');
  });

  it('click Reforge button → mở confirm modal, gọi API khi confirm, emit changed + toast success', async () => {
    previewMock
      .mockResolvedValueOnce(makePreview())
      .mockResolvedValueOnce(makePreview());
    const reforgeResult: EquipmentReforgeResult = {
      inventoryItemId: 'inv_1',
      before: [],
      after: [
        { kind: 'atk', value: 10 },
        { kind: 'def', value: 6 },
      ],
      cost: { linhThachCost: 240, materialKey: 'tinh_thiet', materialQty: 5 },
    };
    reforgeMock.mockResolvedValue(reforgeResult);

    const w = mountPanel(makeInv());
    await flushPromises();

    await w.find('[data-testid="equipment-upgrade-reforge-button"]').trigger('click');
    await flushPromises();
    // Confirm modal mở.
    const confirmBtn = document.querySelector(
      '[data-testid="equipment-upgrade-reforge-confirm-confirm"]',
    ) as HTMLButtonElement | null;
    expect(confirmBtn).not.toBeNull();

    confirmBtn!.click();
    await flushPromises();

    expect(reforgeMock).toHaveBeenCalledWith('inv_1');
    expect(toastPushMock).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'success' }),
    );
    expect(w.emitted('changed')).toBeTruthy();
  });

  it('Reforge API reject INSUFFICIENT_FUNDS → toast error + KHÔNG emit changed', async () => {
    previewMock.mockResolvedValue(makePreview());
    reforgeMock.mockRejectedValue(
      Object.assign(new Error('INSUFFICIENT_FUNDS'), { code: 'INSUFFICIENT_FUNDS' }),
    );

    const w = mountPanel(makeInv());
    await flushPromises();

    await w.find('[data-testid="equipment-upgrade-reforge-button"]').trigger('click');
    await flushPromises();
    const confirmBtn = document.querySelector(
      '[data-testid="equipment-upgrade-reforge-confirm-confirm"]',
    ) as HTMLButtonElement;
    confirmBtn.click();
    await flushPromises();

    expect(toastPushMock).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'error' }),
    );
    expect(w.emitted('changed')).toBeFalsy();
  });

  it('chọn element + click Enchant → confirm modal + gọi enchantEquipment(id, element)', async () => {
    previewMock
      .mockResolvedValueOnce(makePreview())
      .mockResolvedValueOnce(makePreview());
    const enchantResult: EquipmentEnchantResult = {
      inventoryItemId: 'inv_1',
      beforeElement: null,
      beforeLevel: 0,
      afterElement: 'kim',
      afterLevel: 1,
      cost: { linhThachCost: 320, materialKey: 'yeu_dan', materialQty: 1 },
    };
    enchantMock.mockResolvedValue(enchantResult);

    const w = mountPanel(makeInv());
    await flushPromises();

    await w
      .find('[data-testid="equipment-upgrade-element-kim"]')
      .trigger('click');
    await w.find('[data-testid="equipment-upgrade-enchant-button"]').trigger('click');
    await flushPromises();
    const confirmBtn = document.querySelector(
      '[data-testid="equipment-upgrade-enchant-confirm-confirm"]',
    ) as HTMLButtonElement;
    confirmBtn.click();
    await flushPromises();

    expect(enchantMock).toHaveBeenCalledWith('inv_1', 'kim');
    expect(toastPushMock).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'success' }),
    );
    expect(w.emitted('changed')).toBeTruthy();
  });

  it('Enchant button disabled khi chưa chọn element (UI guard) — không gọi API', async () => {
    previewMock.mockResolvedValue(makePreview());
    const w = mountPanel(makeInv());
    await flushPromises();

    const btn = w.find('[data-testid="equipment-upgrade-enchant-button"]')
      .element as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    await w.find('[data-testid="equipment-upgrade-enchant-button"]').trigger('click');
    await flushPromises();
    expect(enchantMock).not.toHaveBeenCalled();
  });

  it('preview đã enchant element=kim level=2 → các button element khác disabled (lock)', async () => {
    previewMock.mockResolvedValue(
      makePreview({
        enchant: {
          currentElement: 'kim',
          currentLevel: 2,
          maxLevel: 5,
          currentBonus: { atk: 12, def: 0, hpMax: 0, mpMax: 0, spirit: 0 },
          nextCost: { linhThachCost: 960, materialKey: 'yeu_dan', materialQty: 1 },
          baseLinhThachCost: 320,
          materialKey: 'yeu_dan',
          materialQty: 1,
          elements: makePreview().enchant.elements,
        },
      }),
    );
    const w = mountPanel(
      makeInv({ enchantElement: 'kim', enchantLevel: 2 }),
    );
    await flushPromises();

    const kimBtn = w.find('[data-testid="equipment-upgrade-element-kim"]')
      .element as HTMLButtonElement;
    const mocBtn = w.find('[data-testid="equipment-upgrade-element-moc"]')
      .element as HTMLButtonElement;
    expect(kimBtn.disabled).toBe(false);
    expect(mocBtn.disabled).toBe(true);
  });

  it('preview enchant ở MAX → label maxLabel + nút Enchant disabled', async () => {
    previewMock.mockResolvedValue(
      makePreview({
        enchant: {
          currentElement: 'kim',
          currentLevel: 5,
          maxLevel: 5,
          currentBonus: { atk: 30, def: 0, hpMax: 0, mpMax: 0, spirit: 0 },
          nextCost: null,
          baseLinhThachCost: 320,
          materialKey: 'yeu_dan',
          materialQty: 1,
          elements: makePreview().enchant.elements,
        },
      }),
    );
    const w = mountPanel(makeInv({ enchantElement: 'kim', enchantLevel: 5 }));
    await flushPromises();

    expect(w.text()).toContain('Phụ ma đỉnh');
    const enchBtn = w.find('[data-testid="equipment-upgrade-enchant-button"]')
      .element as HTMLButtonElement;
    expect(enchBtn.disabled).toBe(true);
  });

  it('preview API reject → render error state + KHÔNG render reforge cost', async () => {
    previewMock.mockRejectedValue(
      Object.assign(new Error('EQUIPMENT_NOT_FOUND'), {
        code: 'EQUIPMENT_NOT_FOUND',
      }),
    );
    const w = mountPanel(makeInv());
    await flushPromises();

    expect(w.find('[data-testid="equipment-upgrade-error"]').exists()).toBe(true);
    expect(
      w.find('[data-testid="equipment-upgrade-reforge-cost"]').exists(),
    ).toBe(false);
  });

  it('cancel confirm modal → KHÔNG gọi API + KHÔNG emit changed', async () => {
    previewMock.mockResolvedValue(makePreview());
    const w = mountPanel(makeInv());
    await flushPromises();

    await w.find('[data-testid="equipment-upgrade-reforge-button"]').trigger('click');
    await flushPromises();
    const cancelBtn = document.querySelector(
      '[data-testid="equipment-upgrade-reforge-confirm-cancel"]',
    ) as HTMLButtonElement;
    cancelBtn.click();
    await flushPromises();

    expect(reforgeMock).not.toHaveBeenCalled();
    expect(w.emitted('changed')).toBeFalsy();
  });
});
