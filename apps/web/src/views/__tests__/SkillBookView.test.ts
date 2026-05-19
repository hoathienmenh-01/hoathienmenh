import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { createI18n } from 'vue-i18n';
import { setActivePinia, createPinia } from 'pinia';

/**
 * Phase 11.2.C — SkillBookView test suite.
 *
 * Bao phủ:
 *  - Loading + empty states.
 *  - Render skill card với tier badge + element badge + mastery + effective.
 *  - Filters: tier / element / tag / equipped (none / equipped / unequipped).
 *    Phase 14.2.C audit (post-phase-14 hardening) — element + tag filter
 *    smoke test (F.6) đảm bảo dropdown wire vào shared catalog không crash.
 *  - Equip / Unequip / Upgrade flows: success toast + error code → error toast.
 *  - Equip button disabled khi đang in-flight.
 *  - Upgrade button disabled khi mastery=max.
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

const skillKiem: SkillViewStub = {
  skillKey: 'kiem_khi_chem',
  tier: 'intermediate',
  masteryLevel: 1,
  maxMastery: 7,
  isEquipped: false,
  source: 'sect',
  learnedAt: '2026-05-03T17:00:01.000Z',
  effective: { atkScale: 1.7, mpCost: 12, cooldownTurns: 0 },
  nextLevelLinhThachCost: 200,
  nextLevelShardCost: 0,
};

const skillThuy: SkillViewStub = {
  skillKey: 'thuy_tieu_phu',
  tier: 'intermediate',
  masteryLevel: 7,
  maxMastery: 7,
  isEquipped: true,
  source: 'sect',
  learnedAt: '2026-05-03T17:00:02.000Z',
  effective: { atkScale: 0.6, mpCost: 18, cooldownTurns: 0 },
  nextLevelLinhThachCost: null,
  nextLevelShardCost: null,
};

// Phase 14.2.C signature skill — element=kim, no tags.
const skillKim: SkillViewStub = {
  skillKey: 'kim_quang_tram',
  tier: 'intermediate',
  masteryLevel: 1,
  maxMastery: 5,
  isEquipped: false,
  source: 'sect',
  learnedAt: '2026-05-03T17:00:03.000Z',
  effective: { atkScale: 1.7, mpCost: 12, cooldownTurns: 1 },
  nextLevelLinhThachCost: 200,
  nextLevelShardCost: 0,
};

// Phase 14.2.C signature skill — element=moc, tag=HEAL.
const skillMocHeal: SkillViewStub = {
  skillKey: 'moc_xuan_phong_phuc_sinh',
  tier: 'intermediate',
  masteryLevel: 1,
  maxMastery: 5,
  isEquipped: false,
  source: 'sect',
  learnedAt: '2026-05-03T17:00:04.000Z',
  effective: { atkScale: 1.0, mpCost: 22, cooldownTurns: 3 },
  nextLevelLinhThachCost: 200,
  nextLevelShardCost: 0,
};

const skillStore: SkillStoreStub = {
  maxEquipped: 4,
  learned: [skillBasic, skillKiem, skillThuy, skillKim, skillMocHeal],
  loaded: true,
  inFlight: new Set(),
  equippedCount: 2,
  fetchState: fetchStateMock,
  isInFlight: (k) => skillStore.inFlight.has(k),
  equip: equipMock,
  unequip: unequipMock,
  upgradeMastery: upgradeMock,
  reset: vi.fn(),
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
    character: { realmKey: 'truc_co' },
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
        filter: { tier: 'Cấp', element: 'Hệ', equipped: 'Trạng thái', tag: 'Loại', all: 'Tất cả', shown: '{shown}/{total} ({catalog})' },
        elementIdentity: { neutral: 'Vô hệ' },
        tier: { basic: 'Sơ', intermediate: 'Trung', advanced: 'Cao', master: 'Đại sư', legendary: 'Huyền thoại' },
        element: { kim: 'Kim', moc: 'Mộc', thuy: 'Thuỷ', hoa: 'Hoả', tho: 'Thổ', none: 'Vô' },
        equipFilter: { equipped: 'Đang vận', unequipped: 'Chưa' },
        field: { mastery: 'Thuần thục', atkScale: 'Hệ số', mpCost: 'MP', cooldown: 'CD', source: 'Nguồn' },
        badge: { equipped: 'Đang vận' },
        button: {
          equip: 'Vận', equipping: 'Đang vận…',
          unequip: 'Gỡ', unequipping: 'Đang gỡ…',
          upgrade: 'Thăng (-{cost})', upgrading: 'Đang thăng…',
          upgradeMax: 'Max', upgradeUnknown: 'Thăng',
        },
        equip: { success: 'Đã vận {name}' },
        unequip: { success: 'Đã gỡ {name}' },
        upgrade: { success: 'Đã thăng {name}' },
        errors: {
          NOT_LEARNED: 'Chưa học',
          ALREADY_EQUIPPED: 'Đã vận',
          TOO_MANY_EQUIPPED: 'Quá nhiều',
          INSUFFICIENT_FUNDS: 'Thiếu LT',
          MASTERY_MAX: 'Max',
          UNKNOWN: 'Lỗi',
        },
        roleHint: 'Quản lý thuật pháp đã học.',
        crossNav: {
          cultivation: 'Tu Luyện',
          cultivationDesc: 'Trung tâm tu luyện',
          equipment: 'Trang Bị',
          equipmentDesc: 'Quản lý trang bị',
        },
      },
      // Phase 14.2.C — SkillTagBadge i18n keys cho tag dropdown.
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
  skillStore.learned = [
    { ...skillBasic },
    { ...skillKiem },
    { ...skillThuy },
    { ...skillKim },
    { ...skillMocHeal },
  ];
  skillStore.loaded = true;
  skillStore.inFlight = new Set();
  skillStore.equippedCount = 2;
  equipMock.mockReset();
  unequipMock.mockReset();
  upgradeMock.mockReset();
  fetchStateMock.mockReset();
  fetchStateMock.mockResolvedValue(undefined);
  toastPushMock.mockClear();
}

describe('SkillBookView — loading & empty', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
    resetStore();
  });

  it('loading state khi store.loaded=false', async () => {
    skillStore.loaded = false;
    skillStore.learned = [];
    const w = mountView();
    await flushPromises();
    expect(w.find('[data-testid="skill-book-loading"]').exists()).toBe(true);
  });

  it('empty state khi không có skill nào', async () => {
    skillStore.loaded = true;
    skillStore.learned = [];
    skillStore.equippedCount = 0;
    const w = mountView();
    await flushPromises();
    expect(w.find('[data-testid="skill-book-empty"]').exists()).toBe(true);
  });
});

describe('SkillBookView — render & filters', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
    resetStore();
  });

  it('hiển thị danh sách skill cards với tier badge + mastery', async () => {
    const w = mountView();
    await flushPromises();
    expect(w.find('[data-testid="skill-book-card-basic_attack"]').exists()).toBe(true);
    expect(w.find('[data-testid="skill-book-card-kiem_khi_chem"]').exists()).toBe(true);
    expect(w.find('[data-testid="skill-book-card-thuy_tieu_phu"]').exists()).toBe(true);
    expect(w.find('[data-testid="skill-book-tier-kiem_khi_chem"]').text()).toContain('Trung');
    expect(w.find('[data-testid="skill-book-mastery-thuy_tieu_phu"]').text()).toContain('7 / 7');
  });

  it('equipped badge chỉ hiển thị cho skill đang equip', async () => {
    const w = mountView();
    await flushPromises();
    expect(w.find('[data-testid="skill-book-equipped-badge-basic_attack"]').exists()).toBe(true);
    expect(w.find('[data-testid="skill-book-equipped-badge-thuy_tieu_phu"]').exists()).toBe(true);
    expect(w.find('[data-testid="skill-book-equipped-badge-kiem_khi_chem"]').exists()).toBe(false);
  });

  it('counts header summary hiển thị đúng equipped / max', async () => {
    const w = mountView();
    await flushPromises();
    expect(w.find('[data-testid="skill-book-equipped-count"]').text()).toContain('2/4');
  });

  it('filter tier=intermediate ẩn basic_attack', async () => {
    const w = mountView();
    await flushPromises();
    await w.find('[data-testid="skill-book-filter-tier"]').setValue('intermediate');
    await flushPromises();
    expect(w.find('[data-testid="skill-book-card-basic_attack"]').exists()).toBe(false);
    expect(w.find('[data-testid="skill-book-card-kiem_khi_chem"]').exists()).toBe(true);
    expect(w.find('[data-testid="skill-book-card-thuy_tieu_phu"]').exists()).toBe(true);
  });

  it('filter equipped=unequipped giữ kiem_khi_chem', async () => {
    const w = mountView();
    await flushPromises();
    await w.find('[data-testid="skill-book-filter-equipped"]').setValue('unequipped');
    await flushPromises();
    expect(w.find('[data-testid="skill-book-card-kiem_khi_chem"]').exists()).toBe(true);
    expect(w.find('[data-testid="skill-book-card-basic_attack"]').exists()).toBe(false);
  });

  // Phase 14.2.C audit (post-phase-14 hardening) — element + tag filter
  // smoke (F.6 trong audit checklist). Đảm bảo dropdown wire vào shared
  // catalog (`skillByKey().def.element / .tags`) không crash khi filter
  // theo element hoặc tag, và filter logic chính xác.
  it('filter element=kim chỉ giữ skill có def.element=kim', async () => {
    const w = mountView();
    await flushPromises();
    await w.find('[data-testid="skill-book-filter-element"]').setValue('kim');
    await flushPromises();
    expect(w.find('[data-testid="skill-book-card-kim_quang_tram"]').exists()).toBe(true);
    expect(w.find('[data-testid="skill-book-card-basic_attack"]').exists()).toBe(false);
    expect(w.find('[data-testid="skill-book-card-thuy_tieu_phu"]').exists()).toBe(false);
    expect(w.find('[data-testid="skill-book-card-moc_xuan_phong_phuc_sinh"]').exists()).toBe(false);
  });

  it('filter element=none chỉ giữ skill có def.element=null (vô hệ)', async () => {
    const w = mountView();
    await flushPromises();
    await w.find('[data-testid="skill-book-filter-element"]').setValue('none');
    await flushPromises();
    // basic_attack/kiem_khi_chem/thuy_tieu_phu là vô hệ trong shared catalog.
    expect(w.find('[data-testid="skill-book-card-basic_attack"]').exists()).toBe(true);
    expect(w.find('[data-testid="skill-book-card-kim_quang_tram"]').exists()).toBe(false);
    expect(w.find('[data-testid="skill-book-card-moc_xuan_phong_phuc_sinh"]').exists()).toBe(false);
  });

  it('filter tag=HEAL chỉ giữ skill có HEAL trong def.tags', async () => {
    const w = mountView();
    await flushPromises();
    await w.find('[data-testid="skill-book-filter-tag"]').setValue('HEAL');
    await flushPromises();
    expect(w.find('[data-testid="skill-book-card-moc_xuan_phong_phuc_sinh"]').exists()).toBe(true);
    expect(w.find('[data-testid="skill-book-card-kim_quang_tram"]').exists()).toBe(false);
    expect(w.find('[data-testid="skill-book-card-basic_attack"]').exists()).toBe(false);
  });

  it('filter element + tag combine không crash, kết quả empty hợp lệ', async () => {
    const w = mountView();
    await flushPromises();
    // kim element + HEAL tag → moc_xuan_phong_phuc_sinh (moc/HEAL) bị element
    // filter loại; không có kim+HEAL nào → empty kết quả nhưng view không crash.
    await w.find('[data-testid="skill-book-filter-element"]').setValue('kim');
    await w.find('[data-testid="skill-book-filter-tag"]').setValue('HEAL');
    await flushPromises();
    expect(w.find('[data-testid="skill-book-card-kim_quang_tram"]').exists()).toBe(false);
    expect(w.find('[data-testid="skill-book-card-moc_xuan_phong_phuc_sinh"]').exists()).toBe(false);
    // View vẫn render được (count UI vẫn còn).
    expect(w.find('[data-testid="skill-book-count"]').exists()).toBe(true);
  });
});

describe('SkillBookView — equip / unequip / upgrade actions', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
    resetStore();
  });

  it('click equip → store.equip → success toast', async () => {
    equipMock.mockResolvedValueOnce(null);
    const w = mountView();
    await flushPromises();
    await w.find('[data-testid="skill-book-equip-kiem_khi_chem"]').trigger('click');
    await flushPromises();
    expect(equipMock).toHaveBeenCalledWith('kiem_khi_chem');
    expect(toastPushMock).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'success' }),
    );
  });

  it('click equip → server error TOO_MANY_EQUIPPED → error toast', async () => {
    equipMock.mockResolvedValueOnce('TOO_MANY_EQUIPPED');
    const w = mountView();
    await flushPromises();
    await w.find('[data-testid="skill-book-equip-kiem_khi_chem"]').trigger('click');
    await flushPromises();
    expect(toastPushMock).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'error', text: 'Quá nhiều' }),
    );
  });

  it('click unequip on equipped skill → store.unequip → success toast', async () => {
    unequipMock.mockResolvedValueOnce(null);
    const w = mountView();
    await flushPromises();
    await w.find('[data-testid="skill-book-unequip-thuy_tieu_phu"]').trigger('click');
    await flushPromises();
    expect(unequipMock).toHaveBeenCalledWith('thuy_tieu_phu');
    expect(toastPushMock).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'success' }),
    );
  });

  it('click upgrade → store.upgradeMastery → success toast', async () => {
    upgradeMock.mockResolvedValueOnce(null);
    const w = mountView();
    await flushPromises();
    await w.find('[data-testid="skill-book-upgrade-kiem_khi_chem"]').trigger('click');
    await flushPromises();
    expect(upgradeMock).toHaveBeenCalledWith('kiem_khi_chem');
    expect(toastPushMock).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'success' }),
    );
  });

  it('upgrade INSUFFICIENT_FUNDS → error toast với i18n message', async () => {
    upgradeMock.mockResolvedValueOnce('INSUFFICIENT_FUNDS');
    const w = mountView();
    await flushPromises();
    await w.find('[data-testid="skill-book-upgrade-kiem_khi_chem"]').trigger('click');
    await flushPromises();
    expect(toastPushMock).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'error', text: 'Thiếu LT' }),
    );
  });

  it('upgrade button disabled khi mastery=max (thuy_tieu_phu 7/7)', async () => {
    const w = mountView();
    await flushPromises();
    const btn = w.find('[data-testid="skill-book-upgrade-thuy_tieu_phu"]');
    expect(btn.attributes('disabled')).toBeDefined();
  });

  it('equip button disabled khi đang in-flight', async () => {
    skillStore.inFlight = new Set(['kiem_khi_chem']);
    const w = mountView();
    await flushPromises();
    const btn = w.find('[data-testid="skill-book-equip-kiem_khi_chem"]');
    expect(btn.attributes('disabled')).toBeDefined();
  });
});

describe('SkillBookView — cross-navigation', () => {
  beforeEach(() => {
    resetStore();
  });

  it('render role hint', async () => {
    const w = mountView();
    await flushPromises();
    expect(w.find('[data-testid="skill-book-role-hint"]').exists()).toBe(true);
    expect(w.find('[data-testid="skill-book-role-hint"]').text()).toContain('Quản lý thuật pháp');
  });

  it('render cross-navigation links', async () => {
    const w = mountView();
    await flushPromises();
    expect(w.find('[data-testid="skill-book-cross-nav"]').exists()).toBe(true);
    expect(w.find('[data-testid="cross-nav-cultivation"]').exists()).toBe(true);
    expect(w.find('[data-testid="cross-nav-equipment"]').exists()).toBe(true);
  });
});
