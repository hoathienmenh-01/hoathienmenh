import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { createI18n } from 'vue-i18n';
import { setActivePinia, createPinia } from 'pinia';

/**
 * CharacterView smoke tests (Phase 15.14 — real /character page).
 *
 * Coverage:
 *   1. Guest (`!auth.isAuthenticated`) → `router.replace('/auth')` and the
 *      empty-state CTA still renders (defense-in-depth — no crash on guest).
 *   2. Authenticated but `game.character === null` after hydrate → render
 *      "no character" empty state with onboarding CTA, do NOT show any
 *      mock VIP strings.
 *   3. Authenticated + populated character + populated sect → render hero
 *      with real name + realm, core stats grid, sect summary, lazy
 *      hydrate calls fired (`spiritualRoot.fetchState`,
 *      `cultivationMethod.fetchState`, `game.hydrateCurrentSect`), and
 *      no mock VIP strings (`Thiên Vân`, `Thanh Vân Tông`, `12.568.890`,
 *      `8.745`, `Đại Thừa Kỳ Bậc 9`) leak into the DOM.
 */

// ──────────────────────────── Mocks ────────────────────────────

const routerReplaceMock = vi.fn();
const routerPushMock = vi.fn();
vi.mock('vue-router', () => ({
  useRouter: () => ({ replace: routerReplaceMock, push: routerPushMock }),
}));

const authState: { isAuthenticated: boolean; hydrate: ReturnType<typeof vi.fn> } = {
  isAuthenticated: true,
  hydrate: vi.fn().mockResolvedValue(undefined),
};
vi.mock('@/stores/auth', () => ({
  useAuthStore: () => authState,
}));

interface FakeChar {
  id: string;
  name: string;
  realmKey: string;
  realmStage: number;
  level: number;
  exp: string;
  expNext: string;
  hp: number;
  hpMax: number;
  mp: number;
  mpMax: number;
  stamina: number;
  staminaMax: number;
  power: number;
  spirit: number;
  speed: number;
  luck: number;
  linhThach: string;
  tienNgoc: number;
  tienNgocKhoa?: number;
  cultivating: boolean;
  sectId: string | null;
  role: 'PLAYER' | 'MOD' | 'ADMIN';
  spiritualRootGrade: string | null;
  primaryElement: string | null;
  secondaryElements: string[];
  rootPurity: number;
  title: string | null;
  bodyRealmKey: string;
  bodyRealmName: string;
  bodyStage: number;
  bodyExp: string;
  bodyExpNext: string;
  bodyRate: number;
  bodyCultivating: boolean;
  bodyInjuryUntil: string | null;
  physiqueKey: string | null;
}

interface FakeSect {
  id: string;
  name: string;
  level: number;
  memberCount: number;
}

const gameState: {
  character: FakeChar | null;
  realmFullName: string;
  expProgress: number;
  currentSect: FakeSect | null;
  fetchState: ReturnType<typeof vi.fn>;
  bindSocket: ReturnType<typeof vi.fn>;
  hydrateCurrentSect: ReturnType<typeof vi.fn>;
} = {
  character: null,
  realmFullName: '',
  expProgress: 0,
  currentSect: null,
  fetchState: vi.fn().mockResolvedValue(undefined),
  bindSocket: vi.fn(),
  hydrateCurrentSect: vi.fn().mockResolvedValue(undefined),
};
vi.mock('@/stores/game', () => ({
  useGameStore: () => gameState,
}));

const spiritualRootState: {
  state: { grade: string; primaryElement: string; secondaryElements: string[]; purity: number; rerollCount: number } | null;
  loaded: boolean;
  fetchState: ReturnType<typeof vi.fn>;
} = {
  state: null,
  loaded: false,
  fetchState: vi.fn().mockResolvedValue(undefined),
};
vi.mock('@/stores/spiritualRoot', () => ({
  useSpiritualRootStore: () => spiritualRootState,
}));

const cultivationMethodState: {
  equippedMethodKey: string | null;
  affinityPercentLabel: string | null;
  learned: { methodKey: string }[];
  loaded: boolean;
  fetchState: ReturnType<typeof vi.fn>;
} = {
  equippedMethodKey: null,
  affinityPercentLabel: null,
  learned: [],
  loaded: false,
  fetchState: vi.fn().mockResolvedValue(undefined),
};
vi.mock('@/stores/cultivationMethod', () => ({
  useCultivationMethodStore: () => cultivationMethodState,
}));

vi.mock('@xuantoi/shared', () => ({
  ELEMENT_NAME_VI: { kim: 'Kim', moc: 'Mộc', thuy: 'Thuỷ', hoa: 'Hoả', tho: 'Thổ' },
}));

// Stub heavy primitives so the test only verifies wiring, not visuals.
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
    template: `
      <div data-testid="xt-lux-hero-stub">
        <span data-testid="xt-lux-hero-title">{{ title }}</span>
        <span data-testid="xt-lux-hero-subtitle">{{ subtitle }}</span>
        <slot name="meta" />
      </div>
    `,
  },
}));
vi.mock('@/components/xianxia/XTLuxSection.vue', () => ({
  default: {
    name: 'XTLuxSectionStub',
    props: ['eyebrow', 'tone', 'padding', 'testId'],
    template: '<section :data-testid="testId"><span data-testid="xt-lux-section-eyebrow">{{ eyebrow }}</span><slot /></section>',
  },
}));
vi.mock('@/components/xianxia/XTStatTile.vue', () => ({
  default: {
    name: 'XTStatTileStub',
    props: ['label', 'value', 'tone', 'icon', 'testId'],
    template: '<div :data-testid="testId"><span class="lbl">{{ label }}</span><span class="val">{{ value }}</span></div>',
  },
}));
vi.mock('@/components/xianxia/XTPageEyebrow.vue', () => ({
  default: {
    name: 'XTPageEyebrowStub',
    props: ['label', 'caps', 'testId'],
    template: '<p :data-testid="testId || \'xt-page-eyebrow-stub\'">{{ label }}</p>',
  },
}));
vi.mock('@/components/ui/MButton.vue', () => ({
  default: {
    name: 'MButtonStub',
    template: '<button data-testid="m-button-stub"><slot /></button>',
  },
}));

import CharacterView from '@/views/CharacterView.vue';

const i18n = createI18n({
  legacy: false,
  locale: 'vi',
  fallbackLocale: 'vi',
  missingWarn: false,
  fallbackWarn: false,
  // We pass an empty bag — the view uses i18n keys that resolve to the
  // key string itself when missing. That is enough for selector-based
  // tests; we never assert on exact translated text.
  messages: { vi: {} },
});

function buildCharacter(overrides: Partial<FakeChar> = {}): FakeChar {
  return {
    id: 'char-1',
    name: 'Lý Mạc Sầu',
    realmKey: 'luyen_khi',
    realmStage: 3,
    level: 12,
    exp: '500',
    expNext: '1000',
    hp: 80,
    hpMax: 100,
    mp: 60,
    mpMax: 100,
    stamina: 50,
    staminaMax: 100,
    power: 1234,
    spirit: 567,
    speed: 89,
    luck: 12,
    linhThach: '12345',
    tienNgoc: 6,
    tienNgocKhoa: 2,
    cultivating: true,
    sectId: 'sect-7',
    role: 'PLAYER',
    spiritualRootGrade: 'linh',
    primaryElement: 'thuy',
    secondaryElements: ['kim'],
    rootPurity: 90,
    title: null,
    bodyRealmKey: 'phamthe',
    bodyRealmName: 'Phàm Thể',
    bodyStage: 1,
    bodyExp: '100',
    bodyExpNext: '500',
    bodyRate: 1,
    bodyCultivating: false,
    bodyInjuryUntil: null,
    physiqueKey: null,
    ...overrides,
  };
}

let wrapper: ReturnType<typeof mount> | null = null;

function mountView() {
  wrapper = mount(CharacterView, {
    global: {
      plugins: [i18n],
    },
  });
  return wrapper;
}

beforeEach(() => {
  setActivePinia(createPinia());
  routerReplaceMock.mockReset();
  routerPushMock.mockReset();
  authState.isAuthenticated = true;
  authState.hydrate.mockReset().mockResolvedValue(undefined);
  gameState.character = null;
  gameState.realmFullName = '';
  gameState.expProgress = 0;
  gameState.currentSect = null;
  gameState.fetchState.mockReset().mockResolvedValue(undefined);
  gameState.bindSocket.mockReset();
  gameState.hydrateCurrentSect.mockReset().mockResolvedValue(undefined);
  spiritualRootState.state = null;
  spiritualRootState.loaded = false;
  spiritualRootState.fetchState.mockReset().mockResolvedValue(undefined);
  cultivationMethodState.equippedMethodKey = null;
  cultivationMethodState.affinityPercentLabel = null;
  cultivationMethodState.learned = [];
  cultivationMethodState.loaded = false;
  cultivationMethodState.fetchState.mockReset().mockResolvedValue(undefined);
});

afterEach(() => {
  wrapper?.unmount();
  wrapper = null;
});

describe('CharacterView — onMounted gating', () => {
  it('guest → router.replace("/auth") và không gọi fetchState', async () => {
    authState.isAuthenticated = false;
    mountView();
    await flushPromises();
    expect(routerReplaceMock).toHaveBeenCalledWith('/auth');
    expect(gameState.fetchState).not.toHaveBeenCalled();
    expect(spiritualRootState.fetchState).not.toHaveBeenCalled();
    expect(cultivationMethodState.fetchState).not.toHaveBeenCalled();
  });

  it('authenticated → fetchState + bindSocket + lazy hydrates được gọi (fail-soft)', async () => {
    gameState.character = buildCharacter();
    gameState.realmFullName = 'Luyện Khí — Trung Cấp 3';
    gameState.expProgress = 0.5;
    mountView();
    await flushPromises();
    expect(gameState.fetchState).toHaveBeenCalledTimes(1);
    expect(gameState.bindSocket).toHaveBeenCalledTimes(1);
    expect(gameState.hydrateCurrentSect).toHaveBeenCalledTimes(1);
    expect(spiritualRootState.fetchState).toHaveBeenCalledTimes(1);
    expect(cultivationMethodState.fetchState).toHaveBeenCalledTimes(1);
    expect(routerReplaceMock).not.toHaveBeenCalled();
  });

  it('authenticated nhưng character vẫn null sau hydrate → render empty state, KHÔNG redirect', async () => {
    gameState.character = null;
    mountView();
    await flushPromises();
    expect(wrapper?.find('[data-testid="character-view-empty"]').exists()).toBe(true);
    expect(wrapper?.find('[data-testid="character-view-stats-section"]').exists()).toBe(false);
    // Empty state hint visible; no mock VIP data leaked.
    expect(wrapper?.text()).not.toContain('Thiên Vân');
    expect(wrapper?.text()).not.toContain('Thanh Vân Tông');
    expect(wrapper?.text()).not.toContain('12.568.890');
    expect(wrapper?.text()).not.toContain('8.745');
  });
});

describe('CharacterView — populated render', () => {
  it('render hero với name + realm thật, các section chính, KHÔNG có mock VIP', async () => {
    gameState.character = buildCharacter({ name: 'Mộ Dung Thanh', sectId: 'sect-7' });
    gameState.realmFullName = 'Trúc Cơ — Sơ Cấp 1';
    gameState.expProgress = 0.42;
    gameState.currentSect = {
      id: 'sect-7',
      name: 'Vạn Kiếm Tông',
      level: 4,
      memberCount: 23,
    };
    spiritualRootState.state = {
      grade: 'huyen',
      primaryElement: 'thuy',
      secondaryElements: ['kim'],
      purity: 95,
      rerollCount: 1,
    };
    spiritualRootState.loaded = true;
    cultivationMethodState.equippedMethodKey = 'thanh_van_quyet';
    cultivationMethodState.affinityPercentLabel = '+10%';
    cultivationMethodState.learned = [{ methodKey: 'thanh_van_quyet' }, { methodKey: 'huyen_thien' }];
    cultivationMethodState.loaded = true;

    mountView();
    await flushPromises();

    // Hero shows real name + realm.
    const title = wrapper?.find('[data-testid="xt-lux-hero-title"]');
    expect(title?.text()).toBe('Mộ Dung Thanh');
    const subtitle = wrapper?.find('[data-testid="xt-lux-hero-subtitle"]');
    expect(subtitle?.text()).toContain('Trúc Cơ');

    // Stats section + each tile.
    expect(wrapper?.find('[data-testid="character-view-stats-section"]').exists()).toBe(true);
    expect(wrapper?.find('[data-testid="character-view-stat-power"]').text()).toContain('1.234');
    expect(wrapper?.find('[data-testid="character-view-stat-spirit"]').text()).toContain('567');

    // Resources tile renders linh thạch from store, NOT mock VIP value.
    const linhThach = wrapper?.find('[data-testid="character-view-res-linh-thach"]');
    expect(linhThach?.text()).toContain('12.345');

    // Sect section renders real sect name.
    expect(wrapper?.find('[data-testid="character-view-sect-name"]').text()).toBe('Vạn Kiếm Tông');

    // Spiritual root + method panels populated from stores.
    expect(wrapper?.find('[data-testid="character-view-root-grade"]').exists()).toBe(true);
    expect(wrapper?.find('[data-testid="character-view-method-equipped"]').text()).toContain('thanh_van_quyet');

    // Empty state must NOT render alongside populated profile.
    expect(wrapper?.find('[data-testid="character-view-empty"]').exists()).toBe(false);

    // No mock VIP strings leak.
    const fullText = wrapper?.text() ?? '';
    expect(fullText).not.toContain('Thiên Vân');
    expect(fullText).not.toContain('Thanh Vân Tông');
    expect(fullText).not.toContain('12.568.890');
    expect(fullText).not.toContain('8.745');
    expect(fullText).not.toContain('Đại Thừa Kỳ');
  });

  it('character không có sect → sect section hiển thị "không tông môn", KHÔNG ném lỗi', async () => {
    gameState.character = buildCharacter({ sectId: null });
    gameState.realmFullName = 'Luyện Khí';
    gameState.currentSect = null;
    mountView();
    await flushPromises();
    expect(wrapper?.find('[data-testid="character-view-sect-section"]').exists()).toBe(true);
    expect(wrapper?.find('[data-testid="character-view-sect-name"]').exists()).toBe(false);
  });
});

describe('CharacterView — role hint + cross-nav', () => {
  it('render role hint', async () => {
    gameState.character = buildCharacter();
    gameState.realmFullName = 'Luyện Khí';
    mountView();
    await flushPromises();
    expect(wrapper?.find('[data-testid="character-view-role-section"]').exists()).toBe(true);
    expect(wrapper?.find('[data-testid="character-view-role-hint"]').text()).toBeTruthy();
  });

  it('render cross-nav với link đúng', async () => {
    gameState.character = buildCharacter();
    gameState.realmFullName = 'Luyện Khí';
    mountView();
    await flushPromises();
    expect(wrapper?.find('[data-testid="character-view-cross-nav"]').exists()).toBe(true);
    expect(wrapper?.find('[data-testid="character-view-cross-nav-cultivation"]').exists()).toBe(true);
    expect(wrapper?.find('[data-testid="character-view-cross-nav-equipment"]').exists()).toBe(true);
  });
});
