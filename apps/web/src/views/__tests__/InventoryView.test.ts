import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { createI18n } from 'vue-i18n';
import { setActivePinia, createPinia } from 'pinia';
import type { InventoryView, RefineResult } from '@/api/inventory';
import type { ItemDef } from '@xuantoi/shared';

/**
 * InventoryView smoke tests (session 9j task C / K3.2): cover onMounted
 * routing, render gear + unequipped list, equip/unequip/use flow (success
 * + toast + cập nhật list từ response; error map inventory.errors.<code>
 * / fallback UNKNOWN; submitting guard chống double-click gọi duplicate
 * API — quan trọng vì equip/use đụng ItemLedger economy safety).
 */

const listInventoryMock = vi.fn();
const equipItemMock = vi.fn();
const unequipItemMock = vi.fn();
const useItemMock = vi.fn();
const refineEquipmentMock = vi.fn();
// Phase 11.4.C — gem socket / unsocket / combine API mocks.
const socketGemMock = vi.fn();
const unsocketGemMock = vi.fn();
const combineGemsApiMock = vi.fn();
// Phase 11.2.D — skill book consume API mock.
const learnSkillFromBookMock = vi.fn();

vi.mock('@/api/inventory', async () => {
  const actual = await vi.importActual<typeof import('@/api/inventory')>(
    '@/api/inventory',
  );
  return {
    ...actual,
    listInventory: (...a: unknown[]) => listInventoryMock(...a),
    equipItem: (...a: unknown[]) => equipItemMock(...a),
    unequipItem: (...a: unknown[]) => unequipItemMock(...a),
    useItem: (...a: unknown[]) => useItemMock(...a),
    refineEquipment: (...a: unknown[]) => refineEquipmentMock(...a),
    socketGem: (...a: unknown[]) => socketGemMock(...a),
    unsocketGem: (...a: unknown[]) => unsocketGemMock(...a),
    combineGemsApi: (...a: unknown[]) => combineGemsApiMock(...a),
  };
});

vi.mock('@/api/skill', async () => {
  const actual = await vi.importActual<typeof import('@/api/skill')>(
    '@/api/skill',
  );
  return {
    ...actual,
    learnSkillFromBook: (...a: unknown[]) => learnSkillFromBookMock(...a),
  };
});

const routerReplaceMock = vi.fn();
vi.mock('vue-router', () => ({
  useRouter: () => ({ replace: routerReplaceMock }),
}));

const toastPushMock = vi.fn();
vi.mock('@/stores/toast', () => ({
  useToastStore: () => ({ push: toastPushMock }),
}));

const authState = {
  isAuthenticated: true,
  hydrate: vi.fn().mockResolvedValue(undefined),
};
vi.mock('@/stores/auth', () => ({
  useAuthStore: () => authState,
}));

const gameState = {
  bindSocket: vi.fn(),
  fetchState: vi.fn().mockResolvedValue(undefined),
};
vi.mock('@/stores/game', () => ({
  useGameStore: () => gameState,
}));

vi.mock('@/components/shell/AppShell.vue', () => ({
  default: {
    name: 'AppShellStub',
    template: '<div data-testid="app-shell"><slot /></div>',
  },
}));

import InventoryViewComponent from '@/views/InventoryView.vue';

const i18n = createI18n({
  legacy: false,
  locale: 'vi',
  fallbackLocale: 'vi',
  missingWarn: false,
  fallbackWarn: false,
  messages: {
    vi: {
      inventory: {
        title: 'Túi Đồ',
        gearTitle: 'Trang Bị',
        empty: 'Trống',
        emptyAll: 'Túi đồ trống.',
        equip: 'Trang bị',
        takeOff: 'Tháo',
        use: 'Dùng',
        learn: 'Học',
        learnTarget: 'Học: {skill}',
        learnConfirm: 'Đọc {book} để học {skill}? Bí kíp sẽ tan biến.',
        learnToast: 'Đã lĩnh hội {skill}.',
        loadFailToast: 'Không tải được túi đồ.',
        equipToast: 'Đã trang bị {name}.',
        unequipToast: 'Đã tháo {slot}.',
        useToast: 'Đã dùng {name}.',
        bonus: {
          atk: 'ATK +{v}',
          def: 'DEF +{v}',
          hpMax: 'HP Max +{v}',
          mpMax: 'MP Max +{v}',
          spirit: 'Thần +{v}',
          elementResist: '-{pct}% sát thương từ hệ {element}',
        },
        refine: {
          button: 'Luyện Khí',
          buttonMaxed: 'Luyện Khí đỉnh',
          levelLabel: '+{lvl}',
          costLabel: '{linhThach} LT + {qty}× {material}',
          protection: 'Dùng bội nguyên phù',
          successToast: 'Luyện khí thành công — cấp {nextLevel}.',
          failNoLossToast: 'Luyện khí thất bại — chưa mất cấp.',
          failProtectedToast: 'Luyện khí thất bại — bội nguyên phù bảo hộ, giữ cấp {finalLevel}.',
          failLossToast: 'Luyện khí thất bại — tụt về cấp {finalLevel}.',
          brokenToast: 'Luyện khí khích phát — trang bị vỡ nát.',
        },
        errors: {
          NOT_OWNER: 'Không sở hữu vật phẩm.',
          INSUFFICIENT_FUNDS: 'Không đủ linh thạch.',
          INSUFFICIENT_MATERIAL: 'Thiếu nguyên liệu.',
          INSUFFICIENT_PROTECTION: 'Thiếu bội nguyên phù.',
          GEM_INCOMPATIBLE_SLOT: 'Linh thạch không khớp slot.',
          SOCKETS_FULL: 'Lỗ khảm đã đầy.',
          NO_NEXT_TIER: 'Không thể hợp tiếp.',
          INSUFFICIENT_QTY: 'Không đủ linh thạch.',
          ALREADY_LEARNED: 'Đã lĩnh hội rồi.',
          REALM_TOO_LOW: 'Cảnh giới chưa đủ.',
          NOT_SKILL_BOOK: 'Không phải bí kíp.',
          UNKNOWN: 'Có lỗi xảy ra.',
        },
        gem: {
          socketsLabel: 'Khảm: {filled}/{max}',
          selectPlaceholder: '— chọn —',
          socketButton: 'Khảm',
          unsocketButton: 'Gỡ',
          combineButton: 'Hợp 3→1',
          noOwnedGems: 'Chưa có linh thạch tương thích.',
          elementLabel: 'Hệ {element}',
          anyElement: 'Vô hệ',
          compatibleSlotsLabel: 'Tương thích: {slots}',
          socketSuccessToast: 'Đã khảm {gem} vào {equipment}.',
          unsocketSuccessToast: 'Đã gỡ {gem} khỏi {equipment}.',
          unsocketDriftToast: 'Đã gỡ slot {slot}.',
          combineSuccessToast: 'Hợp thành 1× {result} từ 3× {src}.',
        },
      },
      element: {
        kim: 'Kim',
        moc: 'Mộc',
        thuy: 'Thủy',
        hoa: 'Hỏa',
        tho: 'Thổ',
      },
      talents: {
        element: {
          kim: 'Kim',
          moc: 'Mộc',
          thuy: 'Thủy',
          hoa: 'Hỏa',
          tho: 'Thổ',
        },
      },
      equipSlot: {
        WEAPON: 'Vũ Khí',
        ARMOR: 'Áo Giáp',
        HELMET: 'Nón',
        BOOTS: 'Giày',
        RING: 'Nhẫn',
        AMULET: 'Bùa',
        ARTIFACT_1: 'Pháp Bảo 1',
        ARTIFACT_2: 'Pháp Bảo 2',
        ARTIFACT_3: 'Pháp Bảo 3',
      },
      quality: {
        PHAM: 'Phàm',
        LINH: 'Linh',
        HUYEN: 'Huyền',
        TIEN: 'Tiên',
        THANH: 'Thánh',
      },
    },
  },
});

function makeItemDef(over: Partial<ItemDef> = {}): ItemDef {
  return {
    key: 'so_kiem',
    name: 'Sơ Kiếm',
    description: 'Một thanh kiếm thô sơ.',
    kind: 'WEAPON',
    quality: 'PHAM',
    stackable: false,
    slot: 'WEAPON',
    bonuses: { atk: 5 },
    price: 10,
    ...over,
  };
}

function makeInv(over: Partial<InventoryView> = {}): InventoryView {
  return {
    id: 'i_1',
    itemKey: 'so_kiem',
    qty: 1,
    equippedSlot: null,
    item: makeItemDef(),
    sockets: [],
    refineLevel: 0,
    ...over,
  };
}

function makeRefineResult(over: Partial<RefineResult> = {}): RefineResult {
  return {
    equipmentInventoryItemId: 'i_w',
    attemptLevel: 1,
    result: { success: true, nextLevel: 1, broken: false, protectionConsumed: false },
    finalLevel: 1,
    broken: false,
    linhThachCost: 100,
    materialKey: 'tinh_thiet',
    materialQty: 1,
    protectionConsumed: false,
    ...over,
  };
}

function mountView() {
  return mount(InventoryViewComponent, { global: { plugins: [i18n] } });
}

beforeEach(() => {
  setActivePinia(createPinia());
  listInventoryMock.mockReset();
  equipItemMock.mockReset();
  unequipItemMock.mockReset();
  useItemMock.mockReset();
  refineEquipmentMock.mockReset();
  socketGemMock.mockReset();
  unsocketGemMock.mockReset();
  combineGemsApiMock.mockReset();
  learnSkillFromBookMock.mockReset();
  routerReplaceMock.mockReset();
  toastPushMock.mockReset();
  authState.isAuthenticated = true;
  authState.hydrate.mockReset();
  authState.hydrate.mockResolvedValue(undefined);
  gameState.bindSocket.mockReset();
  gameState.fetchState.mockReset();
  gameState.fetchState.mockResolvedValue(undefined);
});

describe('InventoryView — onMounted routing', () => {
  it('chưa auth → router.replace(/auth) + không gọi listInventory', async () => {
    authState.isAuthenticated = false;
    mountView();
    await flushPromises();
    expect(routerReplaceMock).toHaveBeenCalledWith('/auth');
    expect(listInventoryMock).not.toHaveBeenCalled();
  });

  it('có auth → fetchState + bindSocket + listInventory', async () => {
    listInventoryMock.mockResolvedValue([]);
    mountView();
    await flushPromises();
    expect(gameState.fetchState).toHaveBeenCalled();
    expect(gameState.bindSocket).toHaveBeenCalled();
    expect(listInventoryMock).toHaveBeenCalledTimes(1);
  });

  it('listInventory fail → toast inventory.loadFailToast', async () => {
    listInventoryMock.mockRejectedValue(new Error('net'));
    const w = mountView();
    await flushPromises();
    expect(toastPushMock).toHaveBeenCalledWith({
      type: 'error',
      text: 'Không tải được túi đồ.',
    });
    expect(w.text()).toContain('Túi Đồ');
  });
});

describe('InventoryView — render gear + unequipped', () => {
  it('render slot empty label khi chưa trang bị', async () => {
    listInventoryMock.mockResolvedValue([]);
    const w = mountView();
    await flushPromises();
    // Tất cả slot đều empty.
    const emptyCount = w.text().match(/Trống/g)?.length ?? 0;
    expect(emptyCount).toBeGreaterThanOrEqual(9); // 9 slot
    expect(w.text()).toContain('Túi đồ trống.');
  });

  it('render trang bị đã equipped + nút Tháo', async () => {
    listInventoryMock.mockResolvedValue([
      makeInv({ id: 'i_weapon', equippedSlot: 'WEAPON' }),
    ]);
    const w = mountView();
    await flushPromises();
    // Tên vũ khí hiển thị.
    expect(w.text()).toContain('Sơ Kiếm');
    // Nút Tháo có.
    const takeOffBtn = w.findAll('button').find((b) => b.text().includes('Tháo'));
    expect(takeOffBtn).toBeDefined();
  });

  it('render item chưa đeo với nút Trang bị (vì có slot) + bonus text', async () => {
    listInventoryMock.mockResolvedValue([
      makeInv({
        id: 'i_bag',
        equippedSlot: null,
        item: makeItemDef({ bonuses: { atk: 10, def: 3 } }),
      }),
    ]);
    const w = mountView();
    await flushPromises();
    expect(w.text()).toContain('ATK +10');
    expect(w.text()).toContain('DEF +3');
    const equipBtn = w.findAll('button').find((b) => b.text().includes('Trang bị'));
    expect(equipBtn).toBeDefined();
  });

  it('render item effect (đan dược) với nút Dùng', async () => {
    listInventoryMock.mockResolvedValue([
      makeInv({
        id: 'i_pill',
        itemKey: 'pill_hp',
        equippedSlot: null,
        item: makeItemDef({
          key: 'pill_hp',
          name: 'Hồi HP Đan',
          kind: 'PILL_HP',
          slot: undefined,
          bonuses: undefined,
          effect: { hp: 50 },
        }),
      }),
    ]);
    const w = mountView();
    await flushPromises();
    expect(w.text()).toContain('Hồi HP Đan');
    expect(w.text()).toContain('+50 HP');
    const useBtn = w.findAll('button').find((b) => b.text().includes('Dùng'));
    expect(useBtn).toBeDefined();
    // Không có nút Trang bị vì không có slot.
    const equipBtn = w.findAll('button').find((b) => b.text().includes('Trang bị'));
    expect(equipBtn).toBeUndefined();
  });

  // Phase 11.6.E — render `bonuses.elementResist` tooltip line.
  it('render armor có elementResist (huyen_giap_phong_hoa) → "-5% sát thương từ hệ Hỏa"', async () => {
    listInventoryMock.mockResolvedValue([
      makeInv({
        id: 'i_armor',
        equippedSlot: null,
        item: makeItemDef({
          key: 'huyen_giap_phong_hoa',
          name: 'Huyền Giáp Phong Hỏa',
          slot: 'ARMOR',
          bonuses: {
            def: 22,
            hpMax: 80,
            elementResist: { hoa: 0.95 },
          },
        }),
      }),
    ]);
    const w = mountView();
    await flushPromises();
    expect(w.text()).toContain('DEF +22');
    expect(w.text()).toContain('HP Max +80');
    expect(w.text()).toContain('-5% sát thương từ hệ Hỏa');
  });

  it('render armor multi-element resist → 2 line tooltip riêng cho mỗi element', async () => {
    listInventoryMock.mockResolvedValue([
      makeInv({
        id: 'i_armor_multi',
        equippedSlot: null,
        item: makeItemDef({
          key: 'multi_resist_armor',
          name: 'Giáp Đa Hệ',
          slot: 'ARMOR',
          bonuses: {
            elementResist: { kim: 0.9, hoa: 0.95 },
          },
        }),
      }),
    ]);
    const w = mountView();
    await flushPromises();
    expect(w.text()).toContain('-10% sát thương từ hệ Kim');
    expect(w.text()).toContain('-5% sát thương từ hệ Hỏa');
  });

  it('render item KHÔNG có elementResist → KHÔNG render tooltip line', async () => {
    listInventoryMock.mockResolvedValue([
      makeInv({
        id: 'i_plain',
        equippedSlot: null,
        item: makeItemDef({ bonuses: { atk: 10 } }),
      }),
    ]);
    const w = mountView();
    await flushPromises();
    expect(w.text()).toContain('ATK +10');
    expect(w.text()).not.toContain('sát thương từ hệ');
  });
});

describe('InventoryView — equip flow', () => {
  it('click Trang bị → equipItem + toast success + list cập nhật', async () => {
    const before = makeInv({ id: 'i_w', equippedSlot: null });
    const after = { ...before, equippedSlot: 'WEAPON' as const };
    listInventoryMock.mockResolvedValue([before]);
    equipItemMock.mockResolvedValue([after]);

    const w = mountView();
    await flushPromises();

    const equipBtn = w.findAll('button').find((b) => b.text().includes('Trang bị'));
    await equipBtn!.trigger('click');
    await flushPromises();

    expect(equipItemMock).toHaveBeenCalledWith('i_w');
    expect(toastPushMock).toHaveBeenCalledWith({
      type: 'success',
      text: 'Đã trang bị Sơ Kiếm.',
    });
    // Sau equip: item chuyển sang gear slot, nút Tháo xuất hiện.
    const takeOffBtn = w.findAll('button').find((b) => b.text().includes('Tháo'));
    expect(takeOffBtn).toBeDefined();
  });

  it('equip error NOT_OWNER → map inventory.errors.NOT_OWNER', async () => {
    listInventoryMock.mockResolvedValue([makeInv({ id: 'i_w' })]);
    equipItemMock.mockRejectedValue(
      Object.assign(new Error('no'), { code: 'NOT_OWNER' }),
    );

    const w = mountView();
    await flushPromises();
    const equipBtn = w.findAll('button').find((b) => b.text().includes('Trang bị'));
    await equipBtn!.trigger('click');
    await flushPromises();

    expect(toastPushMock).toHaveBeenCalledWith({
      type: 'error',
      text: 'Không sở hữu vật phẩm.',
    });
  });

  it('equip error code lạ → fallback inventory.errors.UNKNOWN', async () => {
    listInventoryMock.mockResolvedValue([makeInv({ id: 'i_w' })]);
    equipItemMock.mockRejectedValue(
      Object.assign(new Error('boom'), { code: 'WEIRD' }),
    );

    const w = mountView();
    await flushPromises();
    const equipBtn = w.findAll('button').find((b) => b.text().includes('Trang bị'));
    await equipBtn!.trigger('click');
    await flushPromises();

    expect(toastPushMock).toHaveBeenCalledWith({
      type: 'error',
      text: 'Có lỗi xảy ra.',
    });
  });

  it('submitting guard: click lần 2 trong khi equip pending → chỉ gọi 1 lần', async () => {
    listInventoryMock.mockResolvedValue([makeInv({ id: 'i_w' })]);
    const resolveHolder: {
      current: ((v: InventoryView[]) => void) | null;
    } = { current: null };
    equipItemMock.mockImplementation(
      () =>
        new Promise<InventoryView[]>((resolve) => {
          resolveHolder.current = resolve;
        }),
    );

    const w = mountView();
    await flushPromises();
    const equipBtn = w.findAll('button').find((b) => b.text().includes('Trang bị'));
    await equipBtn!.trigger('click');
    await flushPromises();
    await equipBtn!.trigger('click');
    await flushPromises();

    expect(equipItemMock).toHaveBeenCalledTimes(1);

    resolveHolder.current?.([
      { ...makeInv({ id: 'i_w' }), equippedSlot: 'WEAPON' },
    ]);
    await flushPromises();
  });
});

describe('InventoryView — unequip flow', () => {
  it('click Tháo → unequipItem(slot) + toast unequip + list cập nhật', async () => {
    listInventoryMock.mockResolvedValue([
      makeInv({ id: 'i_w', equippedSlot: 'WEAPON' }),
    ]);
    unequipItemMock.mockResolvedValue([makeInv({ id: 'i_w', equippedSlot: null })]);

    const w = mountView();
    await flushPromises();
    const takeOffBtn = w.findAll('button').find((b) => b.text().includes('Tháo'));
    await takeOffBtn!.trigger('click');
    await flushPromises();

    expect(unequipItemMock).toHaveBeenCalledWith('WEAPON');
    expect(toastPushMock).toHaveBeenCalledWith({
      type: 'system',
      text: 'Đã tháo Vũ Khí.',
    });
    // Sau unequip: nút Trang bị xuất hiện.
    const equipBtn = w.findAll('button').find((b) => b.text().includes('Trang bị'));
    expect(equipBtn).toBeDefined();
  });

  it('unequip error → toast fallback UNKNOWN', async () => {
    listInventoryMock.mockResolvedValue([
      makeInv({ id: 'i_w', equippedSlot: 'WEAPON' }),
    ]);
    unequipItemMock.mockRejectedValue(
      Object.assign(new Error('fail'), { code: 'X' }),
    );

    const w = mountView();
    await flushPromises();
    const takeOffBtn = w.findAll('button').find((b) => b.text().includes('Tháo'));
    await takeOffBtn!.trigger('click');
    await flushPromises();

    expect(toastPushMock).toHaveBeenCalledWith({
      type: 'error',
      text: 'Có lỗi xảy ra.',
    });
  });
});

describe('InventoryView — use flow', () => {
  it('click Dùng → useItem + toast success + list cập nhật (qty giảm)', async () => {
    const pill = makeInv({
      id: 'i_pill',
      itemKey: 'pill_hp',
      qty: 3,
      item: makeItemDef({
        key: 'pill_hp',
        name: 'Hồi HP Đan',
        kind: 'PILL_HP',
        slot: undefined,
        bonuses: undefined,
        effect: { hp: 50 },
      }),
    });
    const afterUse = { ...pill, qty: 2 };
    listInventoryMock.mockResolvedValue([pill]);
    useItemMock.mockResolvedValue([afterUse]);

    const w = mountView();
    await flushPromises();
    const useBtn = w.findAll('button').find((b) => b.text().includes('Dùng'));
    await useBtn!.trigger('click');
    await flushPromises();

    expect(useItemMock).toHaveBeenCalledWith('i_pill');
    expect(toastPushMock).toHaveBeenCalledWith({
      type: 'success',
      text: 'Đã dùng Hồi HP Đan.',
    });
    expect(w.text()).toContain('×2');
  });

  it('use error → toast map inventory.errors.NOT_OWNER', async () => {
    const pill = makeInv({
      id: 'i_pill',
      itemKey: 'pill_hp',
      item: makeItemDef({
        key: 'pill_hp',
        name: 'Hồi HP Đan',
        kind: 'PILL_HP',
        slot: undefined,
        bonuses: undefined,
        effect: { hp: 50 },
      }),
    });
    listInventoryMock.mockResolvedValue([pill]);
    useItemMock.mockRejectedValue(
      Object.assign(new Error('no'), { code: 'NOT_OWNER' }),
    );

    const w = mountView();
    await flushPromises();
    const useBtn = w.findAll('button').find((b) => b.text().includes('Dùng'));
    await useBtn!.trigger('click');
    await flushPromises();

    expect(toastPushMock).toHaveBeenCalledWith({
      type: 'error',
      text: 'Không sở hữu vật phẩm.',
    });
  });
});

/**
 * Phase 11.2.D — Skill book consume tests. Wire `learnSkillFromBook(it.id)`
 * via `POST /character/skill/learn-from-book`. Flow: button "Học" gated bởi
 * `kind==='SKILL_BOOK'` + `item.skillBook.skillKey` + skill catalog tồn tại,
 * confirm dialog, success refresh inventory, error map qua inventory.errors.<code>.
 */
describe('InventoryView — Phase 11.2.D skill book consume flow', () => {
  function makeSkillBook(over: Partial<InventoryView> = {}): InventoryView {
    return makeInv({
      id: 'i_sb',
      itemKey: 'skill_book_kim_quang_tram',
      qty: 1,
      item: makeItemDef({
        key: 'skill_book_kim_quang_tram',
        name: 'Bí Kíp: Kim Quang Trảm',
        kind: 'SKILL_BOOK',
        slot: undefined,
        bonuses: undefined,
        stackable: true,
        skillBook: { skillKey: 'kim_quang_tram' },
      }),
      ...over,
    });
  }

  it('render button "Học" + target label cho SKILL_BOOK valid catalog', async () => {
    listInventoryMock.mockResolvedValue([makeSkillBook()]);
    const w = mountView();
    await flushPromises();

    const learnBtn = w.find('[data-testid="skill-book-learn-button"]');
    expect(learnBtn.exists()).toBe(true);
    expect(learnBtn.text()).toBe('Học');

    const target = w.find('[data-testid="skill-book-target"]');
    expect(target.exists()).toBe(true);
    expect(target.text()).toContain('Kim Quang Trảm');
  });

  it('KHÔNG render button "Học" cho item kind khác (PILL/WEAPON/MISC)', async () => {
    listInventoryMock.mockResolvedValue([
      makeInv({
        item: makeItemDef({
          key: 'pill_hp',
          name: 'Hồi HP Đan',
          kind: 'PILL_HP',
          slot: undefined,
          bonuses: undefined,
          effect: { hp: 50 },
        }),
      }),
    ]);
    const w = mountView();
    await flushPromises();
    expect(w.find('[data-testid="skill-book-learn-button"]').exists()).toBe(false);
  });

  it('confirm cancel → KHÔNG gọi API, KHÔNG toast', async () => {
    listInventoryMock.mockResolvedValue([makeSkillBook()]);
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);

    const w = mountView();
    await flushPromises();
    await w.find('[data-testid="skill-book-learn-button"]').trigger('click');
    await flushPromises();

    expect(confirmSpy).toHaveBeenCalled();
    expect(learnSkillFromBookMock).not.toHaveBeenCalled();
    expect(toastPushMock).not.toHaveBeenCalled();
    confirmSpy.mockRestore();
  });

  it('confirm OK → learnSkillFromBook(it.id) + toast success + refresh list', async () => {
    const sb = makeSkillBook();
    listInventoryMock.mockResolvedValueOnce([sb]).mockResolvedValueOnce([]);
    learnSkillFromBookMock.mockResolvedValue({
      skillKey: 'kim_quang_tram',
      consumedItemKey: 'skill_book_kim_quang_tram',
      state: { maxEquipped: 4, learned: [] },
    });
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);

    const w = mountView();
    await flushPromises();
    await w.find('[data-testid="skill-book-learn-button"]').trigger('click');
    await flushPromises();

    expect(learnSkillFromBookMock).toHaveBeenCalledWith('i_sb');
    expect(toastPushMock).toHaveBeenCalledWith({
      type: 'success',
      text: 'Đã lĩnh hội Kim Quang Trảm.',
    });
    expect(listInventoryMock).toHaveBeenCalledTimes(2);
    confirmSpy.mockRestore();
  });

  it('error ALREADY_LEARNED → toast error map từ inventory.errors.ALREADY_LEARNED (item KHÔNG bị consume)', async () => {
    listInventoryMock.mockResolvedValue([makeSkillBook()]);
    learnSkillFromBookMock.mockRejectedValue(
      Object.assign(new Error('already'), { code: 'ALREADY_LEARNED' }),
    );
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);

    const w = mountView();
    await flushPromises();
    await w.find('[data-testid="skill-book-learn-button"]').trigger('click');
    await flushPromises();

    expect(toastPushMock).toHaveBeenCalledWith({
      type: 'error',
      text: 'Đã lĩnh hội rồi.',
    });
    confirmSpy.mockRestore();
  });

  it('error REALM_TOO_LOW → toast error map', async () => {
    listInventoryMock.mockResolvedValue([makeSkillBook()]);
    learnSkillFromBookMock.mockRejectedValue(
      Object.assign(new Error('too low'), { code: 'REALM_TOO_LOW' }),
    );
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);

    const w = mountView();
    await flushPromises();
    await w.find('[data-testid="skill-book-learn-button"]').trigger('click');
    await flushPromises();

    expect(toastPushMock).toHaveBeenCalledWith({
      type: 'error',
      text: 'Cảnh giới chưa đủ.',
    });
    confirmSpy.mockRestore();
  });

  it('error NOT_SKILL_BOOK → toast error map (defensive — server-side guard)', async () => {
    listInventoryMock.mockResolvedValue([makeSkillBook()]);
    learnSkillFromBookMock.mockRejectedValue(
      Object.assign(new Error('not book'), { code: 'NOT_SKILL_BOOK' }),
    );
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);

    const w = mountView();
    await flushPromises();
    await w.find('[data-testid="skill-book-learn-button"]').trigger('click');
    await flushPromises();

    expect(toastPushMock).toHaveBeenCalledWith({
      type: 'error',
      text: 'Không phải bí kíp.',
    });
    confirmSpy.mockRestore();
  });

  it('error UNKNOWN code → toast fallback inventory.errors.UNKNOWN', async () => {
    listInventoryMock.mockResolvedValue([makeSkillBook()]);
    learnSkillFromBookMock.mockRejectedValue(
      Object.assign(new Error('weird'), { code: 'WEIRD_BACKEND_CODE' }),
    );
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);

    const w = mountView();
    await flushPromises();
    await w.find('[data-testid="skill-book-learn-button"]').trigger('click');
    await flushPromises();

    expect(toastPushMock).toHaveBeenCalledWith({
      type: 'error',
      text: 'Có lỗi xảy ra.',
    });
    confirmSpy.mockRestore();
  });
});

/**
 * Phase 11.5.C — Refine button tests. Wire `refineEquipment(it.id, useProtection)`
 * + per-row protection toggle + result toast (success/failNoLoss/failProtected/
 * failLoss/broken). Server-authoritative — frontend re-fetch listInventory()
 * sau success để lấy refineLevel mới.
 */
describe('InventoryView — Phase 11.5.C refine flow', () => {
  it('render refine badge "+N" cho equipment có refineLevel > 0', async () => {
    listInventoryMock.mockResolvedValue([
      makeInv({ id: 'i_w', equippedSlot: 'WEAPON', refineLevel: 5 }),
    ]);
    const w = mountView();
    await flushPromises();
    const badges = w.findAll('[data-testid="refine-badge"]');
    expect(badges.length).toBeGreaterThanOrEqual(1);
    expect(badges[0]!.text()).toBe('+5');
  });

  it('không render refine badge cho refineLevel = 0', async () => {
    listInventoryMock.mockResolvedValue([
      makeInv({ id: 'i_w', equippedSlot: 'WEAPON', refineLevel: 0 }),
    ]);
    const w = mountView();
    await flushPromises();
    expect(w.findAll('[data-testid="refine-badge"]').length).toBe(0);
  });

  it('render Luyện Khí button + cost label cho equipment chưa max trong unequipped list', async () => {
    listInventoryMock.mockResolvedValue([
      makeInv({ id: 'i_w', equippedSlot: null, refineLevel: 0 }),
    ]);
    const w = mountView();
    await flushPromises();
    const btn = w.find('[data-testid="refine-button"]');
    expect(btn.exists()).toBe(true);
    expect(btn.text()).toContain('Luyện Khí');
    const costEl = w.find('[data-testid="refine-cost"]');
    expect(costEl.exists()).toBe(true);
    expect(costEl.text()).toContain('LT'); // costLabel `{linhThach} LT + ...`
  });

  it('không render Luyện Khí cho consumable (slot=undefined)', async () => {
    const pill = makeInv({
      id: 'i_pill',
      itemKey: 'pill_hp',
      item: makeItemDef({
        key: 'pill_hp',
        name: 'Hồi HP Đan',
        kind: 'PILL_HP',
        slot: undefined,
        bonuses: undefined,
        effect: { hp: 50 },
      }),
    });
    listInventoryMock.mockResolvedValue([pill]);
    const w = mountView();
    await flushPromises();
    expect(w.find('[data-testid="refine-button"]').exists()).toBe(false);
  });

  it('refineLevel >= MAX → button disabled + label "Luyện Khí đỉnh"', async () => {
    listInventoryMock.mockResolvedValue([
      makeInv({ id: 'i_w', equippedSlot: null, refineLevel: 15 }),
    ]);
    const w = mountView();
    await flushPromises();
    const btn = w.find('[data-testid="refine-button"]');
    expect(btn.exists()).toBe(true);
    expect(btn.text()).toContain('đỉnh');
    expect(w.find('[data-testid="refine-cost"]').exists()).toBe(false);
    expect(w.find('[data-testid="refine-protection"]').exists()).toBe(false);
  });

  it('click Luyện Khí success → refineEquipment(id, false) + toast success + re-fetch list', async () => {
    listInventoryMock.mockResolvedValueOnce([
      makeInv({ id: 'i_w', equippedSlot: null, refineLevel: 0 }),
    ]);
    refineEquipmentMock.mockResolvedValue(
      makeRefineResult({
        attemptLevel: 1,
        result: { success: true, nextLevel: 1, broken: false, protectionConsumed: false },
        finalLevel: 1,
      }),
    );
    listInventoryMock.mockResolvedValueOnce([
      makeInv({ id: 'i_w', equippedSlot: null, refineLevel: 1 }),
    ]);

    const w = mountView();
    await flushPromises();
    await w.find('[data-testid="refine-button"]').trigger('click');
    await flushPromises();

    expect(refineEquipmentMock).toHaveBeenCalledWith('i_w', false);
    expect(toastPushMock).toHaveBeenCalledWith({
      type: 'success',
      text: 'Luyện khí thành công — cấp 1.',
    });
    expect(listInventoryMock).toHaveBeenCalledTimes(2);
    // Sau re-fetch: badge mới hiển thị "+1".
    expect(w.find('[data-testid="refine-badge"]').text()).toBe('+1');
  });

  it('check protection → refineEquipment(id, true)', async () => {
    listInventoryMock.mockResolvedValueOnce([
      makeInv({ id: 'i_w', equippedSlot: null, refineLevel: 5 }),
    ]);
    refineEquipmentMock.mockResolvedValue(
      makeRefineResult({
        attemptLevel: 6,
        result: { success: false, nextLevel: 5, broken: false, protectionConsumed: true },
        finalLevel: 5,
        protectionConsumed: true,
      }),
    );
    listInventoryMock.mockResolvedValueOnce([
      makeInv({ id: 'i_w', equippedSlot: null, refineLevel: 5 }),
    ]);

    const w = mountView();
    await flushPromises();
    const checkbox = w.find('[data-testid="refine-protection"]');
    await checkbox.setValue(true);
    await w.find('[data-testid="refine-button"]').trigger('click');
    await flushPromises();

    expect(refineEquipmentMock).toHaveBeenCalledWith('i_w', true);
    expect(toastPushMock).toHaveBeenCalledWith({
      type: 'system',
      text: 'Luyện khí thất bại — bội nguyên phù bảo hộ, giữ cấp 5.',
    });
  });

  it('failNoLoss (safe stage) → toast failNoLossToast', async () => {
    listInventoryMock.mockResolvedValueOnce([
      makeInv({ id: 'i_w', equippedSlot: null, refineLevel: 0 }),
    ]);
    refineEquipmentMock.mockResolvedValue(
      makeRefineResult({
        attemptLevel: 1,
        result: { success: false, nextLevel: 0, broken: false, protectionConsumed: false },
        finalLevel: 0,
      }),
    );
    listInventoryMock.mockResolvedValueOnce([
      makeInv({ id: 'i_w', equippedSlot: null, refineLevel: 0 }),
    ]);

    const w = mountView();
    await flushPromises();
    await w.find('[data-testid="refine-button"]').trigger('click');
    await flushPromises();

    expect(toastPushMock).toHaveBeenCalledWith({
      type: 'system',
      text: 'Luyện khí thất bại — chưa mất cấp.',
    });
  });

  it('failLoss (risky no protection) → toast failLossToast', async () => {
    listInventoryMock.mockResolvedValueOnce([
      makeInv({ id: 'i_w', equippedSlot: null, refineLevel: 6 }),
    ]);
    refineEquipmentMock.mockResolvedValue(
      makeRefineResult({
        attemptLevel: 7,
        result: { success: false, nextLevel: 5, broken: false, protectionConsumed: false },
        finalLevel: 5,
      }),
    );
    listInventoryMock.mockResolvedValueOnce([
      makeInv({ id: 'i_w', equippedSlot: null, refineLevel: 5 }),
    ]);

    const w = mountView();
    await flushPromises();
    await w.find('[data-testid="refine-button"]').trigger('click');
    await flushPromises();

    expect(toastPushMock).toHaveBeenCalledWith({
      type: 'system',
      text: 'Luyện khí thất bại — tụt về cấp 5.',
    });
  });

  it('broken (extreme stage break) → toast brokenToast (error)', async () => {
    listInventoryMock.mockResolvedValueOnce([
      makeInv({ id: 'i_w', equippedSlot: null, refineLevel: 11 }),
    ]);
    refineEquipmentMock.mockResolvedValue(
      makeRefineResult({
        attemptLevel: 12,
        result: { success: false, nextLevel: 0, broken: true, protectionConsumed: false },
        finalLevel: null,
        broken: true,
      }),
    );
    listInventoryMock.mockResolvedValueOnce([]);

    const w = mountView();
    await flushPromises();
    await w.find('[data-testid="refine-button"]').trigger('click');
    await flushPromises();

    expect(toastPushMock).toHaveBeenCalledWith({
      type: 'error',
      text: 'Luyện khí khích phát — trang bị vỡ nát.',
    });
  });

  it('refine error INSUFFICIENT_FUNDS → toast inventory.errors.INSUFFICIENT_FUNDS', async () => {
    listInventoryMock.mockResolvedValue([
      makeInv({ id: 'i_w', equippedSlot: null, refineLevel: 0 }),
    ]);
    refineEquipmentMock.mockRejectedValue(
      Object.assign(new Error('no money'), { code: 'INSUFFICIENT_FUNDS' }),
    );

    const w = mountView();
    await flushPromises();
    await w.find('[data-testid="refine-button"]').trigger('click');
    await flushPromises();

    expect(toastPushMock).toHaveBeenCalledWith({
      type: 'error',
      text: 'Không đủ linh thạch.',
    });
  });

  it('submitting guard: click Luyện Khí 2 lần liền → chỉ gọi refineEquipment 1 lần', async () => {
    listInventoryMock.mockResolvedValue([
      makeInv({ id: 'i_w', equippedSlot: null, refineLevel: 0 }),
    ]);
    const resolveHolder: { current: ((v: RefineResult) => void) | null } = { current: null };
    refineEquipmentMock.mockImplementation(
      () =>
        new Promise<RefineResult>((resolve) => {
          resolveHolder.current = resolve;
        }),
    );

    const w = mountView();
    await flushPromises();
    const btn = w.find('[data-testid="refine-button"]');
    await btn.trigger('click');
    await flushPromises();
    await btn.trigger('click');
    await flushPromises();

    expect(refineEquipmentMock).toHaveBeenCalledTimes(1);

    resolveHolder.current?.(makeRefineResult());
    await flushPromises();
  });
});

// ====================================================================
// Phase 11.4.C — Gem socket / unsocket / combine tests
// ====================================================================

/**
 * Gem inventory row fixture — backend `inventory.list()` synth ItemDef từ
 * GemDef qua `gemDefAsItemDef` (kind='MISC', stackable, slot=undefined,
 * bonuses copy từ gem.bonus).
 */
function makeGemInv(over: Partial<InventoryView> = {}): InventoryView {
  const itemKey = (over.itemKey as string) ?? 'gem_kim_pham';
  const item: ItemDef = makeItemDef({
    key: itemKey,
    name: itemKey === 'gem_kim_pham' ? 'Kim Phàm Linh Thạch' : itemKey,
    description: 'Linh thạch',
    kind: 'MISC',
    quality: 'PHAM',
    stackable: true,
    slot: undefined,
    bonuses: { atk: 1 },
    price: 100,
  });
  return {
    id: `gem_${itemKey}`,
    itemKey,
    qty: 1,
    equippedSlot: null,
    item,
    sockets: [],
    refineLevel: 0,
    ...over,
  };
}

describe('InventoryView — Phase 11.4.C gem rows render', () => {
  it('gem row hiển element + compatible slots + bonus', async () => {
    listInventoryMock.mockResolvedValue([makeGemInv({ qty: 2 })]);
    const w = mountView();
    await flushPromises();

    const meta = w.find('[data-testid="gem-meta"]');
    expect(meta.exists()).toBe(true);
    expect(meta.text()).toContain('Hệ Kim');
    expect(meta.text()).toContain('Tương thích');

    const bonus = w.find('[data-testid="gem-bonus"]');
    expect(bonus.exists()).toBe(true);
    expect(bonus.text()).toContain('ATK');
  });

  it('non-gem row KHÔNG render gem-meta', async () => {
    listInventoryMock.mockResolvedValue([makeInv()]);
    const w = mountView();
    await flushPromises();
    expect(w.find('[data-testid="gem-meta"]').exists()).toBe(false);
    expect(w.find('[data-testid="gem-bonus"]').exists()).toBe(false);
  });

  it('equipment có capacity > 0 (LINH+) → render socket label', async () => {
    listInventoryMock.mockResolvedValue([
      makeInv({ id: 'i_w_linh', item: makeItemDef({ quality: 'LINH' }) }),
    ]);
    const w = mountView();
    await flushPromises();
    const sockets = w.find('[data-testid="equip-sockets"]');
    expect(sockets.exists()).toBe(true);
    expect(sockets.text()).toContain('Khảm: 0/1');
  });

  it('equipment quality PHAM → capacity = 0, không render socket label', async () => {
    listInventoryMock.mockResolvedValue([makeInv()]); // PHAM
    const w = mountView();
    await flushPromises();
    expect(w.find('[data-testid="equip-sockets"]').exists()).toBe(false);
    expect(w.find('[data-testid="gem-select"]').exists()).toBe(false);
  });

  it('equipment đã đầy socket → ẩn select + button khảm', async () => {
    listInventoryMock.mockResolvedValue([
      makeInv({
        id: 'i_w_linh_full',
        item: makeItemDef({ quality: 'LINH' }), // capacity 1
        sockets: ['gem_kim_pham'],
      }),
    ]);
    const w = mountView();
    await flushPromises();
    expect(w.find('[data-testid="gem-select"]').exists()).toBe(false);
    expect(w.find('[data-testid="gem-socket-button"]').exists()).toBe(false);
    // Nhưng vẫn render unsocket button cho gem đã khảm.
    expect(w.find('[data-testid="gem-unsocket-button"]').exists()).toBe(true);
  });
});

describe('InventoryView — Phase 11.4.C socket / unsocket flow', () => {
  it('socketGem success → call API, toast + re-fetch list', async () => {
    listInventoryMock.mockResolvedValueOnce([
      makeInv({ id: 'i_eq', item: makeItemDef({ quality: 'LINH' }) }),
      makeGemInv({ qty: 3 }),
    ]);
    socketGemMock.mockResolvedValue({
      equipmentInventoryItemId: 'i_eq',
      gemKey: 'gem_kim_pham',
      slotIndex: 0,
      sockets: ['gem_kim_pham'],
    });
    listInventoryMock.mockResolvedValueOnce([
      makeInv({
        id: 'i_eq',
        item: makeItemDef({ quality: 'LINH' }),
        sockets: ['gem_kim_pham'],
      }),
      makeGemInv({ qty: 2 }),
    ]);

    const w = mountView();
    await flushPromises();

    const select = w.find('[data-testid="gem-select"]');
    expect(select.exists()).toBe(true);
    await select.setValue('gem_kim_pham');

    const btn = w.find('[data-testid="gem-socket-button"]');
    expect(btn.exists()).toBe(true);
    await btn.trigger('click');
    await flushPromises();

    expect(socketGemMock).toHaveBeenCalledWith('i_eq', 'gem_kim_pham');
    expect(listInventoryMock).toHaveBeenCalledTimes(2);
    expect(toastPushMock).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'success',
        text: expect.stringContaining('Đã khảm'),
      }),
    );
  });

  it('socketGem trước khi chọn gem → button disabled, không gọi API', async () => {
    listInventoryMock.mockResolvedValue([
      makeInv({ id: 'i_eq', item: makeItemDef({ quality: 'LINH' }) }),
      makeGemInv({ qty: 1 }),
    ]);
    const w = mountView();
    await flushPromises();
    const btn = w.find('[data-testid="gem-socket-button"]');
    expect(btn.exists()).toBe(true);
    expect((btn.element as HTMLButtonElement).disabled).toBe(true);
    await btn.trigger('click');
    await flushPromises();
    expect(socketGemMock).not.toHaveBeenCalled();
  });

  it('socketGem error → handleErr toast với code mapping', async () => {
    listInventoryMock.mockResolvedValue([
      makeInv({ id: 'i_eq', item: makeItemDef({ quality: 'LINH' }) }),
      makeGemInv({ qty: 1 }),
    ]);
    const apiErr = Object.assign(new Error('SOCKETS_FULL'), { code: 'SOCKETS_FULL' });
    socketGemMock.mockRejectedValue(apiErr);

    const w = mountView();
    await flushPromises();
    const select = w.find('[data-testid="gem-select"]');
    await select.setValue('gem_kim_pham');
    const btn = w.find('[data-testid="gem-socket-button"]');
    await btn.trigger('click');
    await flushPromises();

    expect(toastPushMock).toHaveBeenCalledWith({
      type: 'error',
      text: 'Lỗ khảm đã đầy.',
    });
  });

  it('compatibleGems lọc gem theo slot equipment (gem WEAPON-only KHÔNG hiển cho equipment ARMOR)', async () => {
    listInventoryMock.mockResolvedValue([
      // ARMOR LINH equipment.
      makeInv({
        id: 'i_armor',
        itemKey: 'so_giap',
        item: makeItemDef({
          key: 'so_giap',
          name: 'Sơ Giáp',
          kind: 'ARMOR',
          slot: 'ARMOR',
          quality: 'LINH',
        }),
      }),
      // gem_kim_pham bonus atk → compatibleSlots WEAPON-only theo catalog.
      makeGemInv({ itemKey: 'gem_kim_pham', qty: 1 }),
    ]);
    const w = mountView();
    await flushPromises();
    // Select tồn tại nhưng chỉ có placeholder option (gem WEAPON-only filter ra).
    const select = w.find('[data-testid="gem-select"]');
    expect(select.exists()).toBe(true);
    const options = select.findAll('option');
    // Chỉ còn placeholder option.
    expect(options.length).toBe(1);
    expect(options[0].text()).toContain('chọn');
    // Render fallback "Chưa có linh thạch tương thích".
    expect(w.find('[data-testid="gem-no-compat"]').exists()).toBe(true);
  });

  it('unsocketGem success → call API, toast system + re-fetch', async () => {
    listInventoryMock.mockResolvedValueOnce([
      makeInv({
        id: 'i_eq',
        item: makeItemDef({ quality: 'LINH' }),
        sockets: ['gem_kim_pham'],
      }),
    ]);
    unsocketGemMock.mockResolvedValue({
      equipmentInventoryItemId: 'i_eq',
      gemKey: 'gem_kim_pham',
      sockets: [],
      gemReturned: true,
    });
    listInventoryMock.mockResolvedValueOnce([
      makeInv({ id: 'i_eq', item: makeItemDef({ quality: 'LINH' }), sockets: [] }),
      makeGemInv({ qty: 1 }),
    ]);

    const w = mountView();
    await flushPromises();
    const btn = w.find('[data-testid="gem-unsocket-button"]');
    expect(btn.exists()).toBe(true);
    await btn.trigger('click');
    await flushPromises();

    expect(unsocketGemMock).toHaveBeenCalledWith('i_eq', 0);
    expect(listInventoryMock).toHaveBeenCalledTimes(2);
    expect(toastPushMock).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'system',
        text: expect.stringContaining('Đã gỡ'),
      }),
    );
  });

  it('unsocketGem catalog drift (gemReturned=false) → toast unsocketDriftToast', async () => {
    listInventoryMock.mockResolvedValue([
      makeInv({
        id: 'i_eq',
        item: makeItemDef({ quality: 'LINH' }),
        sockets: ['gem_drift_unknown'],
      }),
    ]);
    unsocketGemMock.mockResolvedValue({
      equipmentInventoryItemId: 'i_eq',
      gemKey: 'gem_drift_unknown',
      sockets: [],
      gemReturned: false,
    });

    const w = mountView();
    await flushPromises();
    const btn = w.find('[data-testid="gem-unsocket-button"]');
    await btn.trigger('click');
    await flushPromises();

    expect(toastPushMock).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'system',
        text: expect.stringContaining('Đã gỡ slot 0'),
      }),
    );
  });
});

describe('InventoryView — Phase 11.4.C combine flow', () => {
  it('gem qty >= 3 + có nextTier → render combine button', async () => {
    listInventoryMock.mockResolvedValue([makeGemInv({ qty: 3 })]);
    const w = mountView();
    await flushPromises();
    expect(w.find('[data-testid="gem-combine-button"]').exists()).toBe(true);
  });

  it('gem qty < 3 → ẩn combine button', async () => {
    listInventoryMock.mockResolvedValue([makeGemInv({ qty: 2 })]);
    const w = mountView();
    await flushPromises();
    expect(w.find('[data-testid="gem-combine-button"]').exists()).toBe(false);
  });

  it('gem THAN tier (no next tier) → ẩn combine button', async () => {
    // gem_kim_than is highest tier — combineGems(catalog) returns null.
    listInventoryMock.mockResolvedValue([
      makeGemInv({ itemKey: 'gem_kim_than', qty: 5 }),
    ]);
    const w = mountView();
    await flushPromises();
    expect(w.find('[data-testid="gem-combine-button"]').exists()).toBe(false);
  });

  it('combineGems success → call API, toast success + re-fetch list', async () => {
    listInventoryMock.mockResolvedValueOnce([makeGemInv({ qty: 3 })]);
    combineGemsApiMock.mockResolvedValue({
      srcGemKey: 'gem_kim_pham',
      srcQtyConsumed: 3,
      resultGemKey: 'gem_kim_linh',
      resultQtyGained: 1,
    });
    listInventoryMock.mockResolvedValueOnce([
      makeGemInv({ itemKey: 'gem_kim_linh', qty: 1 }),
    ]);

    const w = mountView();
    await flushPromises();
    const btn = w.find('[data-testid="gem-combine-button"]');
    await btn.trigger('click');
    await flushPromises();

    expect(combineGemsApiMock).toHaveBeenCalledWith('gem_kim_pham');
    expect(listInventoryMock).toHaveBeenCalledTimes(2);
    expect(toastPushMock).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'success',
        text: expect.stringContaining('Hợp thành'),
      }),
    );
  });

  it('combineGems error INSUFFICIENT_QTY → handleErr toast', async () => {
    listInventoryMock.mockResolvedValue([makeGemInv({ qty: 3 })]);
    const apiErr = Object.assign(new Error('INSUFFICIENT_QTY'), { code: 'INSUFFICIENT_QTY' });
    combineGemsApiMock.mockRejectedValue(apiErr);

    const w = mountView();
    await flushPromises();
    const btn = w.find('[data-testid="gem-combine-button"]');
    await btn.trigger('click');
    await flushPromises();

    expect(toastPushMock).toHaveBeenCalledWith({
      type: 'error',
      text: 'Không đủ linh thạch.',
    });
  });
});
