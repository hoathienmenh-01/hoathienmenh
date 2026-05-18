import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { createI18n } from 'vue-i18n';
import { setActivePinia, createPinia } from 'pinia';

/**
 * EquipmentView smoke tests (PR #629).
 *
 * Coverage:
 *   1. Guest → redirect to /auth.
 *   2. Authenticated, no equipped gear → render empty state.
 *   3. Authenticated with equipped gear → render slots grid, stats, power.
 *   4. Deep-link buttons navigate to /inventory and /loadouts.
 */

const listInventoryMock = vi.fn();
vi.mock('@/api/inventory', () => ({
  listInventory: (...a: unknown[]) => listInventoryMock(...a),
}));

const routerReplaceMock = vi.fn();
const routerPushMock = vi.fn(() => Promise.resolve());
vi.mock('vue-router', () => ({
  useRouter: () => ({ replace: routerReplaceMock, push: routerPushMock }),
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
  character: null,
  bindSocket: vi.fn(),
  fetchState: vi.fn().mockResolvedValue(undefined),
};
vi.mock('@/stores/game', () => ({
  useGameStore: () => gameState,
}));

vi.mock('@/components/shell/AppShell.vue', () => ({
  default: {
    name: 'AppShellStub',
    template: '<div data-testid="app-shell-stub"><slot /></div>',
  },
}));
vi.mock('@/components/xianxia/XTLuxHero.vue', () => ({
  default: {
    name: 'XTLuxHeroStub',
    props: ['title', 'subtitle', 'eyebrow', 'label', 'breadcrumb', 'tone', 'watermarkLetter', 'testId'],
    template: '<div :data-testid="testId"><slot name="meta" /><slot /></div>',
  },
}));
vi.mock('@/components/xianxia/XTPageEyebrow.vue', () => ({
  default: {
    name: 'XTPageEyebrowStub',
    props: ['label', 'caps'],
    template: '<p>{{ label }}</p>',
  },
}));
vi.mock('@/components/xianxia/XTGlyphBadge.vue', () => ({
  default: {
    name: 'XTGlyphBadgeStub',
    props: ['tone', 'size', 'glyph'],
    template: '<span><slot /></span>',
  },
}));
vi.mock('@/components/xianxia/EquipmentArtCell.vue', () => ({
  default: {
    name: 'EquipmentArtCellStub',
    props: ['equipSlot', 'tier', 'equipped', 'alt', 'size', 'showTier'],
    template: '<div data-testid="equipment-art-cell-stub"></div>',
  },
}));
vi.mock('@/components/ui/MButton.vue', () => ({
  default: {
    name: 'MButtonStub',
    inheritAttrs: false,
    template: '<button v-bind="$attrs" @click="$emit(\'click\')"><slot /></button>',
  },
}));

vi.mock('@xuantoi/shared', () => ({
  EQUIP_SLOTS: ['WEAPON', 'ARMOR', 'BELT', 'BOOTS', 'HAT', 'TRAM', 'ARTIFACT_1', 'ARTIFACT_2', 'ARTIFACT_3'],
}));

import EquipmentView from '@/views/EquipmentView.vue';

const i18n = createI18n({
  legacy: false,
  locale: 'vi',
  fallbackLocale: 'vi',
  missingWarn: false,
  fallbackWarn: false,
  messages: { vi: {} },
});

function makeItem(slot: string, name: string, bonuses?: Record<string, number>) {
  return {
    id: `inv-${slot}`,
    itemKey: `item_${slot.toLowerCase()}`,
    qty: 1,
    equippedSlot: slot,
    item: {
      key: `item_${slot.toLowerCase()}`,
      name,
      kind: 'EQUIPMENT',
      quality: 'RARE',
      slot,
      bonuses: bonuses ?? null,
      equipmentTier: 3,
      computedPowerScore: 100,
      powerBudget: 100,
    },
    sockets: [],
    refineLevel: 0,
    substats: [],
    enchantElement: null,
    enchantLevel: 0,
    locked: false,
    createdAt: '2026-01-01T00:00:00Z',
  };
}

let wrapper: ReturnType<typeof mount> | null = null;

function mountView() {
  wrapper = mount(EquipmentView, {
    global: { plugins: [i18n] },
  });
  return wrapper;
}

beforeEach(() => {
  setActivePinia(createPinia());
  routerReplaceMock.mockReset();
  routerPushMock.mockReset().mockResolvedValue(undefined);
  toastPushMock.mockReset();
  authState.isAuthenticated = true;
  authState.hydrate.mockReset().mockResolvedValue(undefined);
  gameState.fetchState.mockReset().mockResolvedValue(undefined);
  gameState.bindSocket.mockReset();
  listInventoryMock.mockReset().mockResolvedValue([]);
});

afterEach(() => {
  wrapper?.unmount();
  wrapper = null;
});

describe('EquipmentView — auth gating', () => {
  it('guest → router.replace("/auth")', async () => {
    authState.isAuthenticated = false;
    mountView();
    await flushPromises();
    expect(routerReplaceMock).toHaveBeenCalledWith('/auth');
    expect(listInventoryMock).not.toHaveBeenCalled();
  });
});

describe('EquipmentView — empty state', () => {
  it('no equipped gear → shows empty state', async () => {
    listInventoryMock.mockResolvedValue([]);
    mountView();
    await flushPromises();
    expect(wrapper?.find('[data-testid="equipment-empty-state"]').exists()).toBe(true);
    expect(wrapper?.find('[data-testid="equipment-slots-grid"]').exists()).toBe(true);
  });
});

describe('EquipmentView — populated state', () => {
  it('equipped gear → shows slots, stats, and power', async () => {
    listInventoryMock.mockResolvedValue([
      makeItem('WEAPON', 'Thanh Long Kiếm', { atk: 50 }),
      makeItem('ARMOR', 'Huyền Thiên Giáp', { def: 30, hpMax: 200 }),
    ]);
    mountView();
    await flushPromises();

    // No empty state
    expect(wrapper?.find('[data-testid="equipment-empty-state"]').exists()).toBe(false);

    // Slots grid
    expect(wrapper?.find('[data-testid="equipment-slots-grid"]').exists()).toBe(true);
    expect(wrapper?.find('[data-testid="equipment-slot-WEAPON"]').exists()).toBe(true);
    expect(wrapper?.find('[data-testid="equipment-slot-ARMOR"]').exists()).toBe(true);

    // Weapon name rendered
    const weaponSlot = wrapper?.find('[data-testid="equipment-slot-WEAPON"]');
    expect(weaponSlot?.text()).toContain('Thanh Long Kiếm');

    // Stats summary
    expect(wrapper?.find('[data-testid="equipment-stats-summary"]').exists()).toBe(true);
    expect(wrapper?.find('[data-testid="equipment-total-power"]').text()).toBe('200');

    // Total stats
    const statsText = wrapper?.find('[data-testid="equipment-total-stats"]').text();
    expect(statsText).toContain('ATK +50');
    expect(statsText).toContain('DEF +30');
    expect(statsText).toContain('HP +200');
  });

  it('empty slots show "Trống" placeholder', async () => {
    listInventoryMock.mockResolvedValue([
      makeItem('WEAPON', 'Kiếm', { atk: 10 }),
    ]);
    mountView();
    await flushPromises();

    // ARMOR slot should show empty
    const armorSlot = wrapper?.find('[data-testid="equipment-slot-ARMOR"]');
    expect(armorSlot?.find('[data-testid="equipment-empty-slot"]').exists()).toBe(true);
  });
});

describe('EquipmentView — navigation links', () => {
  it('inventory and loadout buttons navigate correctly', async () => {
    listInventoryMock.mockResolvedValue([]);
    mountView();
    await flushPromises();

    await wrapper?.find('[data-testid="equipment-link-inventory"]').trigger('click');
    expect(routerPushMock).toHaveBeenCalledWith('/inventory');

    routerPushMock.mockClear();
    await wrapper?.find('[data-testid="equipment-link-loadouts"]').trigger('click');
    expect(routerPushMock).toHaveBeenCalledWith('/loadouts');
  });
});

describe('EquipmentView — badges', () => {
  it('shows refine badge when refineLevel > 0', async () => {
    const items = [makeItem('WEAPON', 'Kiếm', { atk: 10 })];
    (items[0] as any).refineLevel = 5;
    listInventoryMock.mockResolvedValue(items);
    mountView();
    await flushPromises();

    const badge = wrapper?.find('[data-testid="equipment-refine-badge"]');
    expect(badge?.exists()).toBe(true);
    expect(badge?.text()).toContain('+5');
  });

  it('shows enchant badge when enchantElement is set', async () => {
    const items = [makeItem('WEAPON', 'Kiếm', { atk: 10 })];
    (items[0] as any).enchantElement = 'hoa';
    (items[0] as any).enchantLevel = 3;
    listInventoryMock.mockResolvedValue(items);
    mountView();
    await flushPromises();

    const badge = wrapper?.find('[data-testid="equipment-enchant-badge"]');
    expect(badge?.exists()).toBe(true);
    expect(badge?.text()).toContain('+3');
  });

  it('shows substats badge when substats exist', async () => {
    const items = [makeItem('WEAPON', 'Kiếm', { atk: 10 })];
    (items[0] as any).substats = [{ kind: 'atk', value: 5 }];
    listInventoryMock.mockResolvedValue(items);
    mountView();
    await flushPromises();

    const badge = wrapper?.find('[data-testid="equipment-substats-badge"]');
    expect(badge?.exists()).toBe(true);
  });
});

describe('EquipmentView — upgrade button', () => {
  it('upgrade button navigates to /inventory', async () => {
    listInventoryMock.mockResolvedValue([
      makeItem('WEAPON', 'Kiếm', { atk: 10 }),
    ]);
    mountView();
    await flushPromises();

    const btn = wrapper?.find('[data-testid="equipment-upgrade-WEAPON"]');
    expect(btn?.exists()).toBe(true);
    await btn?.trigger('click');
    expect(routerPushMock).toHaveBeenCalledWith('/inventory');
  });
});
