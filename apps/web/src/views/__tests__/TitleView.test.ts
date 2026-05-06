/**
 * Phase 11.9.C — TitleView smoke + interaction tests.
 *
 * Lock-in:
 *   - Loading state khi chưa hydrate.
 *   - Render full catalog → 1 card / def.
 *   - Owned/locked/equipped status badge đúng.
 *   - Equipped banner hiện khi có equipped, ẩn khi không.
 *   - Click equip button trên card owned → store.equip(key) called +
 *     toast success.
 *   - Click action button trên card equipped → store.unequip() called.
 *   - Locked card → button disabled.
 *   - Filter status=locked ẩn owned card.
 *   - Auth gate: chưa login → router.replace('/auth').
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { createI18n } from 'vue-i18n';
import { setActivePinia, createPinia } from 'pinia';
import type { TitleDef } from '@xuantoi/shared';

const replaceMock = vi.fn();
const equipMock = vi.fn();
const unequipMock = vi.fn();
const fetchStateMock = vi.fn().mockResolvedValue(undefined);
const toastPushMock = vi.fn();

const DEF_OWNED: TitleDef = {
  key: 'realm_kim_dan_adept',
  nameVi: 'Kim Đan Chân Tu',
  nameEn: 'Golden Core Adept',
  description: 'Đắc thành Kim Đan, đạo cơ vững chắc.',
  rarity: 'rare',
  source: 'realm_milestone',
  element: null,
  unlockRealmKey: 'kim_dan',
  unlockAchievementKey: null,
  unlockSectRole: null,
  flavorStatBonus: null,
};

const DEF_LOCKED: TitleDef = {
  key: 'element_kim_blade_master',
  nameVi: 'Kim Đao Tông Chủ',
  nameEn: 'Metal Blade Master',
  description: 'Tinh thông Kim đạo.',
  rarity: 'epic',
  source: 'element_mastery',
  element: 'kim',
  unlockRealmKey: null,
  unlockAchievementKey: null,
  unlockSectRole: null,
  flavorStatBonus: { statTarget: 'atk', value: 1.05 },
};

interface TitlesStoreStub {
  owned: Array<{
    titleKey: string;
    source: string;
    unlockedAt: string;
    def: TitleDef;
  }>;
  catalog: TitleDef[];
  equipped: { titleKey: string; def: TitleDef } | null;
  loaded: boolean;
  inFlight: boolean;
  readonly ownedCount: number;
  readonly totalCount: number;
  readonly unlockedRatio: number;
  readonly ownedKeys: Set<string>;
  isOwned: (k: string) => boolean;
  isEquipped: (k: string) => boolean;
  fetchState: typeof fetchStateMock;
  equip: typeof equipMock;
  unequip: typeof unequipMock;
  reset: () => void;
}

const titlesState: TitlesStoreStub = {
  owned: [
    {
      titleKey: 'realm_kim_dan_adept',
      source: 'realm_milestone',
      unlockedAt: '2026-01-01T00:00:00.000Z',
      def: DEF_OWNED,
    },
  ],
  catalog: [DEF_OWNED, DEF_LOCKED],
  equipped: null,
  loaded: true,
  inFlight: false,
  get ownedCount(): number {
    return this.owned.length;
  },
  get totalCount(): number {
    return this.catalog.length;
  },
  get unlockedRatio(): number {
    return this.owned.length / Math.max(1, this.catalog.length);
  },
  get ownedKeys(): Set<string> {
    return new Set(this.owned.map((r) => r.titleKey));
  },
  isOwned(k: string) {
    return this.ownedKeys.has(k);
  },
  isEquipped(k: string) {
    return this.equipped !== null && this.equipped.titleKey === k;
  },
  fetchState: fetchStateMock,
  equip: equipMock,
  unequip: unequipMock,
  reset: vi.fn(),
};

const authState = {
  hydrate: vi.fn().mockResolvedValue(undefined),
  isAuthenticated: true,
};

vi.mock('@/stores/auth', () => ({
  useAuthStore: () => authState,
}));
vi.mock('@/stores/game', () => ({
  useGameStore: () => ({
    fetchState: vi.fn().mockResolvedValue(undefined),
    bindSocket: vi.fn(),
  }),
}));
vi.mock('@/stores/titles', () => ({
  useTitlesStore: () => titlesState,
}));
vi.mock('@/stores/toast', () => ({
  useToastStore: () => ({ push: toastPushMock }),
}));
vi.mock('vue-router', () => ({
  useRouter: () => ({ replace: replaceMock }),
}));
vi.mock('@/components/shell/AppShell.vue', () => ({
  default: {
    name: 'AppShellStub',
    template: '<div data-testid="app-shell"><slot /></div>',
  },
}));

import TitleView from '@/views/TitleView.vue';

const i18n = createI18n({
  legacy: false,
  locale: 'vi',
  fallbackLocale: 'vi',
  missingWarn: false,
  fallbackWarn: false,
  messages: {
    vi: {
      titles: {
        title: 'Danh Hiệu',
        subtitle: 'sub',
        summary: '{owned}/{total}',
        equippedLabel: 'Đang trang bị',
        loading: 'Đang tải',
        empty: 'Trống',
        filter: {
          source: 'Nguồn',
          rarity: 'Phẩm',
          status: 'Trạng thái',
          all: 'Tất cả',
          shown: '{shown}/{total}',
        },
        rarity: {
          common: 'Phàm',
          rare: 'Linh',
          epic: 'Bảo',
          legendary: 'Tiên',
          mythic: 'Thần',
        },
        source: {
          realm_milestone: 'Cảnh',
          element_mastery: 'Ngũ Hành',
          achievement: 'Thành Tựu',
          sect_rank: 'Tông',
          event: 'Sự Kiện',
          donation: 'Cúng',
        },
        element: {
          kim: 'Kim',
          moc: 'Mộc',
          thuy: 'Thuỷ',
          hoa: 'Hoả',
          tho: 'Thổ',
        },
        status: {
          owned: 'Đã mở',
          locked: 'Chưa mở',
          equipped: 'Đang trang bị',
        },
        stat: {
          atk: 'Công',
          def: 'Phòng',
          hpMax: 'HP',
          mpMax: 'MP',
          spirit: 'Linh',
        },
        flavor: {
          bonus: '{stat} +{pct}%',
          none: 'Không có',
        },
        button: {
          equip: 'Trang bị',
          unequip: 'Gỡ bỏ',
          locked: 'Chưa mở',
          working: 'Đang xử lý…',
        },
        toast: {
          equipped: 'Đã trang bị: {name}',
          unequipped: 'Đã gỡ: {name}',
        },
        errors: {
          TITLE_NOT_FOUND: 'TNF',
          TITLE_NOT_OWNED: 'TNO',
          ALREADY_EQUIPPED: 'AE',
          NOT_EQUIPPED: 'NE',
          IN_FLIGHT: 'IF',
          UNKNOWN: 'UNK',
        },
      },
    },
  },
});

function mountView() {
  return mount(TitleView, { global: { plugins: [i18n] } });
}

describe('TitleView — Phase 11.9.C', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    replaceMock.mockReset();
    equipMock.mockReset();
    unequipMock.mockReset();
    fetchStateMock.mockClear();
    toastPushMock.mockReset();
    authState.isAuthenticated = true;
    authState.hydrate.mockResolvedValue(undefined);
    titlesState.owned = [
      {
        titleKey: 'realm_kim_dan_adept',
        source: 'realm_milestone',
        unlockedAt: '2026-01-01T00:00:00.000Z',
        def: DEF_OWNED,
      },
    ];
    titlesState.catalog = [DEF_OWNED, DEF_LOCKED];
    titlesState.equipped = null;
    titlesState.loaded = true;
    titlesState.inFlight = false;
  });

  it('auth chưa login → router.replace("/auth")', async () => {
    authState.isAuthenticated = false;
    mountView();
    await flushPromises();
    expect(replaceMock).toHaveBeenCalledWith('/auth');
  });

  it('loaded=false → render loading state', async () => {
    titlesState.loaded = false;
    const w = mountView();
    await flushPromises();
    expect(w.find('[data-testid="titles-loading"]').exists()).toBe(true);
  });

  it('render 1 card cho mỗi catalog def', async () => {
    const w = mountView();
    await flushPromises();
    expect(
      w.find('[data-testid="titles-card-realm_kim_dan_adept"]').exists(),
    ).toBe(true);
    expect(
      w.find('[data-testid="titles-card-element_kim_blade_master"]').exists(),
    ).toBe(true);
  });

  it('owned card có status owned + button equip', async () => {
    const w = mountView();
    await flushPromises();
    const status = w.find(
      '[data-testid="titles-status-realm_kim_dan_adept"]',
    );
    expect(status.text()).toContain('Đã mở');
    const btn = w.find('[data-testid="titles-action-realm_kim_dan_adept"]');
    expect(btn.text()).toBe('Trang bị');
    expect(btn.attributes('disabled')).toBeUndefined();
  });

  it('locked card có status locked + button disabled', async () => {
    const w = mountView();
    await flushPromises();
    const status = w.find(
      '[data-testid="titles-status-element_kim_blade_master"]',
    );
    expect(status.text()).toContain('Chưa mở');
    const btn = w.find(
      '[data-testid="titles-action-element_kim_blade_master"]',
    );
    expect(btn.attributes('disabled')).toBeDefined();
  });

  it('equipped banner hiện khi có equipped', async () => {
    titlesState.equipped = {
      titleKey: 'realm_kim_dan_adept',
      def: DEF_OWNED,
    };
    const w = mountView();
    await flushPromises();
    expect(w.find('[data-testid="titles-equipped-banner"]').exists()).toBe(
      true,
    );
    expect(
      w.find('[data-testid="titles-equipped-name"]').text(),
    ).toBe('Kim Đan Chân Tu');
  });

  it('equipped banner ẩn khi equipped=null', async () => {
    const w = mountView();
    await flushPromises();
    expect(w.find('[data-testid="titles-equipped-banner"]').exists()).toBe(
      false,
    );
  });

  it('click equip trên card owned → store.equip(key) called + toast success', async () => {
    equipMock.mockResolvedValueOnce(null);
    const w = mountView();
    await flushPromises();
    await w
      .find('[data-testid="titles-action-realm_kim_dan_adept"]')
      .trigger('click');
    await flushPromises();
    expect(equipMock).toHaveBeenCalledWith('realm_kim_dan_adept');
    expect(toastPushMock).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'success' }),
    );
  });

  it('click action trên card equipped → store.unequip() called', async () => {
    titlesState.equipped = {
      titleKey: 'realm_kim_dan_adept',
      def: DEF_OWNED,
    };
    unequipMock.mockResolvedValueOnce(null);
    const w = mountView();
    await flushPromises();
    await w
      .find('[data-testid="titles-action-realm_kim_dan_adept"]')
      .trigger('click');
    await flushPromises();
    expect(unequipMock).toHaveBeenCalled();
    expect(equipMock).not.toHaveBeenCalled();
    expect(toastPushMock).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'success' }),
    );
  });

  it('store.equip trả error code → toast error i18n', async () => {
    equipMock.mockResolvedValueOnce('TITLE_NOT_OWNED');
    const w = mountView();
    await flushPromises();
    await w
      .find('[data-testid="titles-action-realm_kim_dan_adept"]')
      .trigger('click');
    await flushPromises();
    expect(toastPushMock).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'error', text: 'TNO' }),
    );
  });

  it('summary count: owned/total đúng', async () => {
    const w = mountView();
    await flushPromises();
    expect(w.find('[data-testid="titles-summary"]').text()).toBe('1/2');
  });

  it('quick unequip button trong equipped banner gọi store.unequip()', async () => {
    titlesState.equipped = {
      titleKey: 'realm_kim_dan_adept',
      def: DEF_OWNED,
    };
    unequipMock.mockResolvedValueOnce(null);
    const w = mountView();
    await flushPromises();
    await w
      .find('[data-testid="titles-quick-unequip"]')
      .trigger('click');
    await flushPromises();
    expect(unequipMock).toHaveBeenCalled();
  });
});
