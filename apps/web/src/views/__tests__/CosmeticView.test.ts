import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { createI18n } from 'vue-i18n';
import { setActivePinia, createPinia } from 'pinia';
import { createRouter, createMemoryHistory } from 'vue-router';

const fetchMeMock = vi.fn();
const fetchCatalogMock = vi.fn();
const equipMock = vi.fn();
const unequipMock = vi.fn();
const fetchCosmeticProfileMock = vi.fn();

vi.mock('@/api/cosmetics', () => ({
  fetchCosmeticMe: (...a: unknown[]) => fetchMeMock(...a),
  fetchCosmeticCatalog: (...a: unknown[]) => fetchCatalogMock(...a),
  equipCosmetic: (...a: unknown[]) => equipMock(...a),
  unequipCosmetic: (...a: unknown[]) => unequipMock(...a),
  fetchCosmeticProfile: (...a: unknown[]) => fetchCosmeticProfileMock(...a),
}));

const authState = { isAuthenticated: true, hydrate: vi.fn().mockResolvedValue(undefined) };
vi.mock('@/stores/auth', () => ({
  useAuthStore: () => authState,
}));

const toastPushMock = vi.fn();
vi.mock('@/stores/toast', () => ({
  useToastStore: () => ({ push: toastPushMock }),
}));

vi.mock('@/components/shell/AppShell.vue', () => ({
  default: {
    name: 'AppShell',
    props: ['title'],
    template: '<div data-testid="shell"><slot /></div>',
  },
}));

vi.mock('@/components/ui/MButton.vue', () => ({
  default: {
    name: 'MButton',
    props: ['disabled', 'loading'],
    emits: ['click'],
    template: '<button :disabled="disabled" @click="$emit(\'click\')"><slot /></button>',
  },
}));

import CosmeticView from '@/views/CosmeticView.vue';

const i18n = createI18n({
  legacy: false,
  locale: 'vi',
  fallbackLocale: 'vi',
  missingWarn: false,
  fallbackWarn: false,
  messages: {
    vi: {
      common: { all: 'Tất cả', loading: 'Đang tải...' },
      cosmetics: {
        title: 'Y Quán',
        subtitle: 'Sub',
        owned: 'Đã có',
        locked: 'Chưa có',
        equipped: 'Đang dùng',
        equip: 'Trang bị',
        unequip: 'Tháo',
        empty: 'Trống',
        emptyFiltered: 'Không có',
        equipSuccess: 'Đã trang bị',
        equipFail: 'Không thể trang bị',
        unequipSuccess: 'Đã tháo',
        unequipFail: 'Không thể tháo',
        sourceLabel: 'Nguồn',
        elementLabel: 'Ngũ Hành',
        durationLabel: 'Hạn {days} ngày',
        types: {
          AURA: 'Hào Quang',
          TITLE: 'Danh Hiệu',
          AVATAR_FRAME: 'Khung',
          CHAT_BADGE: 'Huy Hiệu',
          PROFILE_DECORATION: 'Trang trí',
          ELEMENT_AURA: 'Aura Ngũ Hành',
        },
        rarity: {
          COMMON: 'Phổ thông',
          RARE: 'Hiếm',
          EPIC: 'Sử thi',
          LEGENDARY: 'Huyền thoại',
          MYTHIC: 'Thần thoại',
        },
        source: {
          FREE: 'Miễn phí',
          BATTLE_PASS: 'BP',
          SHOP: 'Shop',
          VIP: 'VIP',
          EVENT: 'Sự kiện',
          ADMIN: 'Admin',
        },
        element: {
          KIM: 'Kim',
          MOC: 'Mộc',
          THUY: 'Thủy',
          HOA: 'Hỏa',
          THO: 'Thổ',
          NEUTRAL: 'Vô hệ',
        },
        ownedFilter: { all: 'Tất cả', owned: 'Đang có', locked: 'Chưa có' },
        errors: { UNKNOWN: 'Lỗi' },
      },
    },
  },
});

const router = createRouter({
  history: createMemoryHistory(),
  routes: [{ path: '/', component: { template: '<div />' } }],
});

beforeEach(async () => {
  setActivePinia(createPinia());
  fetchMeMock.mockReset();
  fetchCatalogMock.mockReset();
  equipMock.mockReset();
  unequipMock.mockReset();
  fetchCosmeticProfileMock.mockReset();
  toastPushMock.mockReset();
  authState.isAuthenticated = true;
  authState.hydrate.mockClear();
  await router.push('/');
  await router.isReady();
});

function mountView() {
  return mount(CosmeticView, { global: { plugins: [i18n, router] } });
}

const SAMPLE_OWNED = {
  cosmeticId: 'title_so_hoc_de_tu',
  source: 'FREE',
  ownedAt: '2026-05-12T00:00:00Z',
  expiresAt: null,
};

const SAMPLE_TITLE_VIEW = {
  cosmeticId: 'title_so_hoc_de_tu',
  type: 'TITLE',
  nameVi: 'Sơ Học Đệ Tử',
  nameEn: 'Beginner Disciple',
  descriptionVi: 'Danh hiệu khởi đầu',
  descriptionEn: 'Starter title',
  rarity: 'COMMON',
  elementAffinity: 'NEUTRAL',
  source: 'FREE',
  cssClass: 'title-common',
  previewClass: 'title-common',
  active: true,
  owned: true,
  equipped: false,
  locked: false,
};

const SAMPLE_LOCKED_VIEW = {
  cosmeticId: 'title_dai_la_kim_tien',
  type: 'TITLE',
  nameVi: 'Đại La Kim Tiên',
  nameEn: 'Da Luo Jin Xian',
  descriptionVi: 'Top-tier',
  descriptionEn: 'Top-tier',
  rarity: 'MYTHIC',
  elementAffinity: 'NEUTRAL',
  source: 'EVENT',
  cssClass: 'title-mythic',
  previewClass: 'title-mythic',
  active: true,
  owned: false,
  equipped: false,
  locked: true,
};

describe('CosmeticView — wardrobe rendering', () => {
  it('renders owned + locked cosmetics with badges', async () => {
    fetchMeMock.mockResolvedValue({
      catalog: [SAMPLE_TITLE_VIEW, SAMPLE_LOCKED_VIEW],
      loadout: {
        activeAuraId: null,
        activeTitleId: null,
        activeAvatarFrameId: null,
        activeChatBadgeId: null,
        activeProfileDecorationId: null,
        activeElementAuraId: null,
      },
      owned: [SAMPLE_OWNED],
    });
    const w = mountView();
    await flushPromises();
    expect(w.text()).toContain('Sơ Học Đệ Tử');
    expect(w.text()).toContain('Đại La Kim Tiên');
    const cards = w.findAll('[data-cosmetic-id]');
    const owned = cards.find((c) => c.attributes('data-owned') === 'true');
    const locked = cards.find((c) => c.attributes('data-owned') === 'false');
    expect(owned).toBeTruthy();
    expect(locked).toBeTruthy();
    expect(owned!.text()).toContain('Đã có');
    expect(locked!.text()).toContain('Chưa có');
  });

  it('equip button calls API + refreshes loadout', async () => {
    fetchMeMock
      .mockResolvedValueOnce({
        catalog: [SAMPLE_TITLE_VIEW],
        loadout: {
          activeAuraId: null,
          activeTitleId: null,
          activeAvatarFrameId: null,
          activeChatBadgeId: null,
          activeProfileDecorationId: null,
          activeElementAuraId: null,
        },
        owned: [SAMPLE_OWNED],
      })
      .mockResolvedValueOnce({
        catalog: [{ ...SAMPLE_TITLE_VIEW, equipped: true }],
        loadout: {
          activeAuraId: null,
          activeTitleId: 'title_so_hoc_de_tu',
          activeAvatarFrameId: null,
          activeChatBadgeId: null,
          activeProfileDecorationId: null,
          activeElementAuraId: null,
        },
        owned: [SAMPLE_OWNED],
      });
    equipMock.mockResolvedValue({
      activeAuraId: null,
      activeTitleId: 'title_so_hoc_de_tu',
      activeAvatarFrameId: null,
      activeChatBadgeId: null,
      activeProfileDecorationId: null,
      activeElementAuraId: null,
    });
    const w = mountView();
    await flushPromises();
    const equipBtn = w
      .findAll('button')
      .find((b) => b.text() === 'Trang bị' && !b.attributes('disabled'));
    expect(equipBtn).toBeTruthy();
    await equipBtn!.trigger('click');
    await flushPromises();
    expect(equipMock).toHaveBeenCalledWith('title_so_hoc_de_tu');
    expect(toastPushMock).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'success' }),
    );
  });

  it('owned filter hides locked cosmetics', async () => {
    fetchMeMock.mockResolvedValue({
      catalog: [SAMPLE_TITLE_VIEW, SAMPLE_LOCKED_VIEW],
      loadout: {
        activeAuraId: null,
        activeTitleId: null,
        activeAvatarFrameId: null,
        activeChatBadgeId: null,
        activeProfileDecorationId: null,
        activeElementAuraId: null,
      },
      owned: [SAMPLE_OWNED],
    });
    const w = mountView();
    await flushPromises();
    const ownedFilterBtn = w
      .findAll('button')
      .find((b) => b.text() === 'Đang có');
    expect(ownedFilterBtn).toBeTruthy();
    await ownedFilterBtn!.trigger('click');
    await flushPromises();
    const cards = w.findAll('[data-cosmetic-id]');
    expect(cards).toHaveLength(1);
    expect(cards[0]!.attributes('data-cosmetic-id')).toBe('title_so_hoc_de_tu');
  });
});
