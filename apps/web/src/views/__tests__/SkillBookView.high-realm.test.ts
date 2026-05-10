import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { createI18n } from 'vue-i18n';
import { setActivePinia, createPinia } from 'pinia';

/**
 * Content Scale 2 — SkillBookView High-Realm Catalog panel test suite.
 *
 * Bao phủ:
 *  - Render high-realm catalog panel độc lập với learned panel.
 *  - Mỗi tier (Nhân Tiên / Tiên Giới / Hỗn Nguyên / Vĩnh Hằng / Đạo Quân)
 *    có ít nhất 1 card hiển thị.
 *  - Locked state khi character realm < required realm.
 *  - Unlocked state khi character realm ≥ required realm.
 *  - Learned state khi skill có trong skills.learned.
 *  - Filter realm + element hoạt động.
 *  - Không crash khi character thấp realm hoặc null character.
 *  - i18n key render (không thấy raw key).
 */

const replaceMock = vi.fn();
const equipMock = vi.fn();
const unequipMock = vi.fn();
const upgradeMock = vi.fn();
const fetchStateMock = vi.fn().mockResolvedValue(undefined);
const toastPushMock = vi.fn();

interface SkillViewStub {
  skillKey: string;
  tier: 'basic' | 'intermediate' | 'advanced' | 'master' | 'legendary';
  masteryLevel: number;
  maxMastery: number;
  isEquipped: boolean;
  source: string;
  learnedAt: string;
  effective: { atkScale: number; mpCost: number; cooldownTurns: number } | null;
  nextLevelLinhThachCost: number | null;
  nextLevelShardCost: number | null;
}

interface SkillStoreStub {
  maxEquipped: number;
  learned: SkillViewStub[];
  loaded: boolean;
  inFlight: Set<string>;
  equippedCount: number;
  fetchState: typeof fetchStateMock;
  isInFlight: (k: string) => boolean;
  equip: typeof equipMock;
  unequip: typeof unequipMock;
  upgradeMastery: typeof upgradeMock;
  reset: () => void;
}

const skillBasic: SkillViewStub = {
  skillKey: 'basic_attack',
  tier: 'basic',
  masteryLevel: 1,
  maxMastery: 5,
  isEquipped: true,
  source: 'starter',
  learnedAt: '2026-05-03T17:00:00.000Z',
  effective: { atkScale: 1, mpCost: 0, cooldownTurns: 0 },
  nextLevelLinhThachCost: 100,
  nextLevelShardCost: 0,
};

const skillStore: SkillStoreStub = {
  maxEquipped: 4,
  learned: [skillBasic],
  loaded: true,
  inFlight: new Set(),
  equippedCount: 1,
  fetchState: fetchStateMock,
  isInFlight: (k) => skillStore.inFlight.has(k),
  equip: equipMock,
  unequip: unequipMock,
  upgradeMastery: upgradeMock,
  reset: vi.fn(),
};

const gameStub: { character: { realmKey: string } | null } = {
  character: { realmKey: 'truc_co' },
};

vi.mock('@/stores/auth', () => ({
  useAuthStore: () => ({
    hydrate: vi.fn().mockResolvedValue(undefined),
    isAuthenticated: true,
  }),
}));
vi.mock('@/stores/game', () => ({
  useGameStore: () => ({
    fetchState: vi.fn().mockResolvedValue(undefined),
    bindSocket: vi.fn(),
    get character() {
      return gameStub.character;
    },
  }),
}));
vi.mock('@/stores/skill', () => ({
  useSkillStore: () => skillStore,
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

import SkillBookView from '@/views/SkillBookView.vue';

const i18n = createI18n({
  legacy: false,
  locale: 'vi',
  fallbackLocale: 'vi',
  missingWarn: false,
  fallbackWarn: false,
  messages: {
    vi: {
      skillBook: {
        title: 'Pháp Quyển',
        subtitle: 'sub',
        loading: 'Đang tải',
        empty: 'Trống',
        equippedSummary: 'Vận: {equipped}/{max}',
        filter: {
          tier: 'Cấp',
          element: 'Hệ',
          equipped: 'Trạng thái',
          tag: 'Loại',
          all: 'Tất cả',
          shown: '{shown}/{total} ({catalog})',
        },
        elementIdentity: { neutral: 'Vô hệ' },
        tier: {
          basic: 'Sơ',
          intermediate: 'Trung',
          advanced: 'Cao',
          master: 'Đại sư',
          legendary: 'Huyền thoại',
        },
        element: {
          kim: 'Kim',
          moc: 'Mộc',
          thuy: 'Thuỷ',
          hoa: 'Hoả',
          tho: 'Thổ',
          none: 'Vô',
        },
        equipFilter: { equipped: 'Đang vận', unequipped: 'Chưa' },
        field: {
          mastery: 'Thuần thục',
          atkScale: 'Hệ số',
          mpCost: 'MP',
          cooldown: 'CD',
          source: 'Nguồn',
        },
        badge: { equipped: 'Đang vận' },
        button: {
          equip: 'Vận',
          equipping: 'Đang vận…',
          unequip: 'Gỡ',
          unequipping: 'Đang gỡ…',
          upgrade: 'Thăng (-{cost})',
          upgrading: 'Đang thăng…',
          upgradeMax: 'Max',
          upgradeUnknown: 'Thăng',
        },
        equip: { success: 'Đã vận {name}' },
        unequip: { success: 'Đã gỡ {name}' },
        upgrade: { success: 'Đã thăng {name}' },
        errors: { UNKNOWN: 'Lỗi' },
        highRealm: {
          title: 'Pháp Quyển Cảnh Giới Cao',
          subtitle: 'Thuật pháp Nhân Tiên trở lên — xem trước.',
          empty: 'Không có thuật pháp nào.',
          summary:
            'Hiển thị {shown}/{total} • Mở {unlocked} • Đã học {learned}',
          filter: { realm: 'Cảnh giới' },
          realm: {
            nhan_tien: 'Nhân Tiên',
            huyen_tien: 'Tiên Giới (Huyền Tiên+)',
            thanh_nhan: 'Hỗn Nguyên (Thánh Nhân+)',
            vo_chung: 'Vĩnh Hằng (Vô Chung+)',
            dao_quan: 'Đạo Quân Cảnh',
          },
          badge: { locked: 'Khoá', unlocked: 'Mở', learned: 'Đã học' },
          lockTooltip: 'Cần đạt {realm} để học.',
          field: { realm: 'Yêu cầu' },
        },
      },
      skillTagBadge: {
        tag: {
          HEAL: 'Hồi',
          DOT: 'Độc',
          BURST: 'Bùng',
          SHIELD: 'Khiên',
          CRIT: 'Bạo',
          CONTROL: 'Khống',
        },
        tooltip: {
          HEAL: 'Hồi máu',
          DOT: 'DoT',
          BURST: 'Burst',
          SHIELD: 'Shield',
          CRIT: 'Crit',
          CONTROL: 'Control',
        },
      },
    },
  },
});

function mountView() {
  return mount(SkillBookView, { global: { plugins: [i18n] } });
}

function resetStore() {
  skillStore.maxEquipped = 4;
  skillStore.learned = [{ ...skillBasic }];
  skillStore.loaded = true;
  skillStore.inFlight = new Set();
  skillStore.equippedCount = 1;
  equipMock.mockReset();
  unequipMock.mockReset();
  upgradeMock.mockReset();
  fetchStateMock.mockReset();
  fetchStateMock.mockResolvedValue(undefined);
  toastPushMock.mockClear();
  gameStub.character = { realmKey: 'truc_co' };
}

describe('SkillBookView — High-Realm Catalog (Content Scale 2)', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
    resetStore();
  });

  it('render high-realm section + danh sách card', async () => {
    const w = mountView();
    await flushPromises();
    expect(
      w.find('[data-testid="skill-book-high-realm-section"]').exists(),
    ).toBe(true);
    expect(w.find('[data-testid="skill-book-high-realm-list"]').exists()).toBe(
      true,
    );
    expect(
      w.find('[data-testid="skill-book-high-realm-count"]').exists(),
    ).toBe(true);
  });

  it('mỗi tier Nhân Tiên / Tiên Giới / Hỗn Nguyên / Vĩnh Hằng có ít nhất 1 card', async () => {
    const w = mountView();
    await flushPromises();
    // Sample: 1 skill per tier (Kim element representative).
    expect(
      w.find(
        '[data-testid="skill-book-high-realm-card-kim_nhan_tien_pho_thien_kiep"]',
      ).exists(),
    ).toBe(true);
    expect(
      w.find(
        '[data-testid="skill-book-high-realm-card-kim_tien_gioi_thien_quang_xuyen_van"]',
      ).exists(),
    ).toBe(true);
    expect(
      w.find(
        '[data-testid="skill-book-high-realm-card-kim_hon_nguyen_kim_kiep_dao_thien"]',
      ).exists(),
    ).toBe(true);
    expect(
      w.find(
        '[data-testid="skill-book-high-realm-card-kim_vinh_hang_thien_kiem_quy_tong"]',
      ).exists(),
    ).toBe(true);
  });

  it('character thấp realm (truc_co) → mọi card có badge locked', async () => {
    gameStub.character = { realmKey: 'truc_co' };
    const w = mountView();
    await flushPromises();
    expect(
      w
        .find(
          '[data-testid="skill-book-high-realm-locked-kim_nhan_tien_pho_thien_kiep"]',
        )
        .exists(),
    ).toBe(true);
    expect(
      w
        .find(
          '[data-testid="skill-book-high-realm-locked-kim_vinh_hang_thien_kiem_quy_tong"]',
        )
        .exists(),
    ).toBe(true);
  });

  it('character vinh_hang → mọi card có badge unlocked (chưa learned)', async () => {
    gameStub.character = { realmKey: 'vinh_hang' };
    const w = mountView();
    await flushPromises();
    expect(
      w
        .find(
          '[data-testid="skill-book-high-realm-unlocked-kim_nhan_tien_pho_thien_kiep"]',
        )
        .exists(),
    ).toBe(true);
    expect(
      w
        .find(
          '[data-testid="skill-book-high-realm-unlocked-kim_vinh_hang_thien_kiem_quy_tong"]',
        )
        .exists(),
    ).toBe(true);
  });

  it('skill đã learned → badge learned thay vì unlocked', async () => {
    gameStub.character = { realmKey: 'vinh_hang' };
    skillStore.learned = [
      { ...skillBasic },
      {
        skillKey: 'kim_nhan_tien_pho_thien_kiep',
        tier: 'master',
        masteryLevel: 1,
        maxMastery: 7,
        isEquipped: false,
        source: 'admin_grant',
        learnedAt: '2026-05-03T17:00:00.000Z',
        effective: { atkScale: 4.2, mpCost: 78, cooldownTurns: 5 },
        nextLevelLinhThachCost: 1000,
        nextLevelShardCost: 0,
      },
    ];
    const w = mountView();
    await flushPromises();
    expect(
      w
        .find(
          '[data-testid="skill-book-high-realm-learned-kim_nhan_tien_pho_thien_kiep"]',
        )
        .exists(),
    ).toBe(true);
    expect(
      w
        .find(
          '[data-testid="skill-book-high-realm-unlocked-kim_nhan_tien_pho_thien_kiep"]',
        )
        .exists(),
    ).toBe(false);
  });

  it('filter realm=vo_chung chỉ giữ skill yêu cầu vo_chung', async () => {
    const w = mountView();
    await flushPromises();
    await w
      .find('[data-testid="skill-book-high-realm-filter-realm"]')
      .setValue('vo_chung');
    await flushPromises();
    expect(
      w
        .find(
          '[data-testid="skill-book-high-realm-card-kim_vinh_hang_thien_kiem_quy_tong"]',
        )
        .exists(),
    ).toBe(true);
    expect(
      w
        .find(
          '[data-testid="skill-book-high-realm-card-kim_nhan_tien_pho_thien_kiep"]',
        )
        .exists(),
    ).toBe(false);
  });

  it('filter element=hoa chỉ giữ skill có element=hoa', async () => {
    const w = mountView();
    await flushPromises();
    await w
      .find('[data-testid="skill-book-high-realm-filter-element"]')
      .setValue('hoa');
    await flushPromises();
    // Sample hoa skills exist in Vĩnh Hằng + Nhân Tiên tiers.
    expect(
      w
        .find(
          '[data-testid="skill-book-high-realm-card-hoa_vinh_hang_kiep_diem_thieu_thien"]',
        )
        .exists(),
    ).toBe(true);
    // Kim skill phải bị loại.
    expect(
      w
        .find(
          '[data-testid="skill-book-high-realm-card-kim_vinh_hang_thien_kiem_quy_tong"]',
        )
        .exists(),
    ).toBe(false);
  });

  it('character null (chưa load) → không crash, mọi card locked', async () => {
    gameStub.character = null;
    const w = mountView();
    await flushPromises();
    expect(
      w.find('[data-testid="skill-book-high-realm-section"]').exists(),
    ).toBe(true);
    // Một skill bất kỳ hiển thị locked.
    expect(
      w
        .find(
          '[data-testid="skill-book-high-realm-locked-kim_nhan_tien_pho_thien_kiep"]',
        )
        .exists(),
    ).toBe(true);
  });

  it('i18n key render đúng — không thấy raw key skillBook.highRealm.*', async () => {
    const w = mountView();
    await flushPromises();
    const html = w.html();
    expect(html).not.toContain('skillBook.highRealm.title');
    expect(html).not.toContain('skillBook.highRealm.badge.locked');
    expect(html).toContain('Pháp Quyển Cảnh Giới Cao');
  });
});
