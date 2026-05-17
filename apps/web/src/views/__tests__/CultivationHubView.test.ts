import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { createI18n } from 'vue-i18n';
import { setActivePinia, createPinia } from 'pinia';

/**
 * CultivationHubView smoke tests (PR #625 — real `/cultivation` hub).
 *
 * Coverage:
 *   1. Guest (`!auth.isAuthenticated`) → `router.replace('/auth')` and the
 *      view does NOT call `game.fetchState` / store hydrators.
 *   2. Authenticated but `game.character === null` after hydrate → render
 *      "no character" empty state with onboarding CTA, do NOT show any
 *      mock VIP strings.
 *   3. Authenticated + populated character → render hero with realm,
 *      cultivation/method/root/body/breakthrough sections, recommended
 *      action, lazy hydrate calls fired (`spiritualRoot.fetchState`,
 *      `cultivationMethod.fetchState`, `cultivationMethodV2.fetchState`,
 *      `bodyCultivation.fetchState`), and no mock VIP strings leak.
 *   4. Deep-link buttons exist and route to the correct paths via the
 *      mocked `router.push`.
 */

// ──────────────────────────── Mocks ────────────────────────────

const routerReplaceMock = vi.fn();
const routerPushMock = vi.fn(() => Promise.resolve());
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
  power: number;
  cultivating: boolean;
  spiritualRootGrade: string | null;
  primaryElement: string | null;
  secondaryElements: string[];
  rootPurity: number;
  bodyRealmKey: string;
  bodyRealmName: string;
  bodyStage: number;
  bodyExp: string;
  bodyExpNext: string;
  bodyInjuryUntil: string | null;
}

const gameState: {
  character: FakeChar | null;
  realmFullName: string;
  expProgress: number;
  fetchState: ReturnType<typeof vi.fn>;
  bindSocket: ReturnType<typeof vi.fn>;
} = {
  character: null,
  realmFullName: '',
  expProgress: 0,
  fetchState: vi.fn().mockResolvedValue(undefined),
  bindSocket: vi.fn(),
};
vi.mock('@/stores/game', () => ({
  useGameStore: () => gameState,
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

const cultivationMethodV2State: {
  equippedSlots: { slot: string; methodKey: string }[];
  cultivationRateMul: number;
  bodyRateMul: number;
  loaded: boolean;
  fetchState: ReturnType<typeof vi.fn>;
} = {
  equippedSlots: [],
  cultivationRateMul: 1,
  bodyRateMul: 1,
  loaded: false,
  fetchState: vi.fn().mockResolvedValue(null),
};
vi.mock('@/stores/cultivationMethodV2', () => ({
  useCultivationMethodV2Store: () => cultivationMethodV2State,
}));

const spiritualRootState: {
  state: {
    grade: string;
    primaryElement: string;
    secondaryElements: string[];
    purity: number;
    rerollCount: number;
  } | null;
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

const bodyCultivationState: {
  status:
    | {
        bodyRealmKey: string;
        bodyRealmName: string;
        bodyStage: number;
        bodyExp: string;
        bodyExpNext: string;
        bodyCultivating: boolean;
        bodyInjuryUntil: string | null;
        canBreakthrough: boolean;
      }
    | null;
  loaded: boolean;
  progress: number;
  fetchState: ReturnType<typeof vi.fn>;
} = {
  status: null,
  loaded: false,
  progress: 0,
  fetchState: vi.fn().mockResolvedValue(undefined),
};
vi.mock('@/stores/bodyCultivation', () => ({
  useBodyCultivationStore: () => bodyCultivationState,
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
    props: [
      'title',
      'subtitle',
      'eyebrow',
      'label',
      'breadcrumb',
      'tone',
      'watermarkLetter',
      'testId',
    ],
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
    template:
      '<section :data-testid="testId"><span data-testid="xt-lux-section-eyebrow">{{ eyebrow }}</span><slot /></section>',
  },
}));
vi.mock('@/components/xianxia/XTStatTile.vue', () => ({
  default: {
    name: 'XTStatTileStub',
    props: ['label', 'value', 'tone', 'icon', 'testId'],
    template:
      '<div :data-testid="testId"><span class="lbl">{{ label }}</span><span class="val">{{ value }}</span></div>',
  },
}));
vi.mock('@/components/xianxia/XTPageEyebrow.vue', () => ({
  default: {
    name: 'XTPageEyebrowStub',
    props: ['label', 'caps', 'testId'],
    template: "<p :data-testid=\"testId || 'xt-page-eyebrow-stub'\">{{ label }}</p>",
  },
}));
vi.mock('@/components/ui/MButton.vue', () => ({
  default: {
    name: 'MButtonStub',
    inheritAttrs: false,
    template:
      '<button v-bind="$attrs" data-testid-default="m-button-stub" @click="$emit(\'click\')"><slot /></button>',
  },
}));

import CultivationHubView from '@/views/CultivationHubView.vue';

const i18n = createI18n({
  legacy: false,
  locale: 'vi',
  fallbackLocale: 'vi',
  missingWarn: false,
  fallbackWarn: false,
  // Empty bag — vue-i18n falls back to the key string itself when missing,
  // which is enough for selector-based tests; we never assert on exact
  // translated text.
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
    power: 1234,
    cultivating: true,
    spiritualRootGrade: 'linh',
    primaryElement: 'thuy',
    secondaryElements: ['kim'],
    rootPurity: 90,
    bodyRealmKey: 'pham_than',
    bodyRealmName: 'Phàm Thân',
    bodyStage: 1,
    bodyExp: '100',
    bodyExpNext: '500',
    bodyInjuryUntil: null,
    ...overrides,
  };
}

let wrapper: ReturnType<typeof mount> | null = null;

function mountView() {
  wrapper = mount(CultivationHubView, {
    global: {
      plugins: [i18n],
    },
  });
  return wrapper;
}

beforeEach(() => {
  setActivePinia(createPinia());
  routerReplaceMock.mockReset();
  routerPushMock.mockReset().mockResolvedValue(undefined);
  authState.isAuthenticated = true;
  authState.hydrate.mockReset().mockResolvedValue(undefined);
  gameState.character = null;
  gameState.realmFullName = '';
  gameState.expProgress = 0;
  gameState.fetchState.mockReset().mockResolvedValue(undefined);
  gameState.bindSocket.mockReset();
  cultivationMethodState.equippedMethodKey = null;
  cultivationMethodState.affinityPercentLabel = null;
  cultivationMethodState.learned = [];
  cultivationMethodState.loaded = false;
  cultivationMethodState.fetchState.mockReset().mockResolvedValue(undefined);
  cultivationMethodV2State.equippedSlots = [];
  cultivationMethodV2State.cultivationRateMul = 1;
  cultivationMethodV2State.bodyRateMul = 1;
  cultivationMethodV2State.loaded = false;
  cultivationMethodV2State.fetchState.mockReset().mockResolvedValue(null);
  spiritualRootState.state = null;
  spiritualRootState.loaded = false;
  spiritualRootState.fetchState.mockReset().mockResolvedValue(undefined);
  bodyCultivationState.status = null;
  bodyCultivationState.loaded = false;
  bodyCultivationState.progress = 0;
  bodyCultivationState.fetchState.mockReset().mockResolvedValue(undefined);
});

afterEach(() => {
  wrapper?.unmount();
  wrapper = null;
});

describe('CultivationHubView — onMounted gating', () => {
  it('guest → router.replace("/auth") và không gọi fetchState / hydrators', async () => {
    authState.isAuthenticated = false;
    mountView();
    await flushPromises();
    expect(routerReplaceMock).toHaveBeenCalledWith('/auth');
    expect(gameState.fetchState).not.toHaveBeenCalled();
    expect(spiritualRootState.fetchState).not.toHaveBeenCalled();
    expect(cultivationMethodState.fetchState).not.toHaveBeenCalled();
    expect(cultivationMethodV2State.fetchState).not.toHaveBeenCalled();
    expect(bodyCultivationState.fetchState).not.toHaveBeenCalled();
  });

  it('authenticated → fetchState + bindSocket + lazy hydrates được gọi (fail-soft)', async () => {
    gameState.character = buildCharacter();
    gameState.realmFullName = 'Luyện Khí — Trung Cấp 3';
    gameState.expProgress = 0.5;
    mountView();
    await flushPromises();
    expect(gameState.fetchState).toHaveBeenCalledTimes(1);
    expect(gameState.bindSocket).toHaveBeenCalledTimes(1);
    expect(spiritualRootState.fetchState).toHaveBeenCalledTimes(1);
    expect(cultivationMethodState.fetchState).toHaveBeenCalledTimes(1);
    expect(cultivationMethodV2State.fetchState).toHaveBeenCalledTimes(1);
    expect(bodyCultivationState.fetchState).toHaveBeenCalledTimes(1);
    expect(routerReplaceMock).not.toHaveBeenCalled();
  });

  it('authenticated nhưng character vẫn null sau hydrate → render empty state, KHÔNG redirect', async () => {
    gameState.character = null;
    mountView();
    await flushPromises();
    expect(wrapper?.find('[data-testid="cultivation-hub-empty"]').exists()).toBe(true);
    expect(
      wrapper?.find('[data-testid="cultivation-hub-cultivation-section"]').exists(),
    ).toBe(false);
    // No mock VIP strings leak in empty state.
    const text = wrapper?.text() ?? '';
    expect(text).not.toContain('Thiên Vân');
    expect(text).not.toContain('Thanh Vân Tông');
    expect(text).not.toContain('12.568.890');
    expect(text).not.toContain('8.745');
    expect(text).not.toContain('Đại Thừa Kỳ');
  });
});

describe('CultivationHubView — populated render', () => {
  it('render hero, sections chính, recommend panel, KHÔNG có mock VIP', async () => {
    gameState.character = buildCharacter({
      name: 'Mộ Dung Thanh',
      realmStage: 9,
      exp: '1000',
      expNext: '1000',
      cultivating: true,
    });
    gameState.realmFullName = 'Trúc Cơ — Đỉnh Phong 9';
    gameState.expProgress = 1;

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
    cultivationMethodState.learned = [
      { methodKey: 'thanh_van_quyet' },
      { methodKey: 'huyen_thien' },
    ];
    cultivationMethodState.loaded = true;

    cultivationMethodV2State.cultivationRateMul = 1.25;
    cultivationMethodV2State.bodyRateMul = 1.1;
    cultivationMethodV2State.loaded = true;
    cultivationMethodV2State.equippedSlots = [
      { slot: 'QI_MAIN', methodKey: 'thanh_van_quyet' },
    ];

    bodyCultivationState.status = {
      bodyRealmKey: 'pham_than',
      bodyRealmName: 'Phàm Thân',
      bodyStage: 2,
      bodyExp: '120',
      bodyExpNext: '120',
      bodyCultivating: true,
      bodyInjuryUntil: null,
      canBreakthrough: true,
    };
    bodyCultivationState.loaded = true;
    bodyCultivationState.progress = 1;

    mountView();
    await flushPromises();

    // Hero shows real realm.
    const title = wrapper?.find('[data-testid="xt-lux-hero-title"]');
    expect(title?.text()).toContain('Trúc Cơ');

    // Sections render.
    expect(
      wrapper?.find('[data-testid="cultivation-hub-cultivation-section"]').exists(),
    ).toBe(true);
    expect(
      wrapper?.find('[data-testid="cultivation-hub-method-section"]').exists(),
    ).toBe(true);
    expect(
      wrapper?.find('[data-testid="cultivation-hub-root-section"]').exists(),
    ).toBe(true);
    expect(
      wrapper?.find('[data-testid="cultivation-hub-body-section"]').exists(),
    ).toBe(true);
    expect(
      wrapper?.find('[data-testid="cultivation-hub-breakthrough-section"]').exists(),
    ).toBe(true);
    expect(
      wrapper?.find('[data-testid="cultivation-hub-deep-links-section"]').exists(),
    ).toBe(true);

    // EXP text + at-peak hint. Match either "1.000" (vi-VN) or "1,000"
    // (en-US fallback) — Node ICU may not include vi-VN.
    expect(wrapper?.find('[data-testid="cultivation-hub-exp-text"]').text()).toMatch(
      /1[.,]000\s*\/\s*1[.,]000/,
    );
    expect(wrapper?.find('[data-testid="cultivation-hub-at-peak"]').exists()).toBe(true);
    expect(
      wrapper?.find('[data-testid="cultivation-hub-breakthrough-ready"]').exists(),
    ).toBe(true);

    // Method panel surfaces equipped key from store.
    expect(
      wrapper?.find('[data-testid="cultivation-hub-method-equipped"]').text(),
    ).toContain('thanh_van_quyet');
    expect(
      wrapper?.find('[data-testid="cultivation-hub-method-learned-count"]').text(),
    ).toContain('2');

    // Spiritual root grade renders from store, not mock.
    expect(wrapper?.find('[data-testid="cultivation-hub-root-grade"]').exists()).toBe(true);

    // Body section reads from body cultivation status.
    expect(wrapper?.find('[data-testid="cultivation-hub-body-realm"]').text()).toContain(
      'Phàm Thân',
    );
    expect(wrapper?.find('[data-testid="cultivation-hub-body-ready"]').exists()).toBe(true);

    // Empty state must NOT render alongside populated profile.
    expect(wrapper?.find('[data-testid="cultivation-hub-empty"]').exists()).toBe(false);

    // Recommend panel shows up at peak with route /breakthrough.
    expect(wrapper?.find('[data-testid="cultivation-hub-recommend"]').exists()).toBe(true);

    // No mock VIP strings leak.
    const fullText = wrapper?.text() ?? '';
    expect(fullText).not.toContain('Thiên Vân');
    expect(fullText).not.toContain('Thanh Vân Tông');
    expect(fullText).not.toContain('12.568.890');
    expect(fullText).not.toContain('8.745');
    expect(fullText).not.toContain('Đại Thừa Kỳ');
  });

  it('character chưa có linh căn → root section hiển thị empty hint, KHÔNG ném lỗi', async () => {
    gameState.character = buildCharacter({
      spiritualRootGrade: null,
      primaryElement: null,
      secondaryElements: [],
      cultivating: false,
    });
    gameState.realmFullName = 'Luyện Khí';
    spiritualRootState.state = null;
    spiritualRootState.loaded = false;
    mountView();
    await flushPromises();
    expect(wrapper?.find('[data-testid="cultivation-hub-root-section"]').exists()).toBe(true);
    expect(wrapper?.find('[data-testid="cultivation-hub-root-grade"]').exists()).toBe(false);
  });
});

describe('CultivationHubView — deep links', () => {
  const linkCases: Array<{ testId: string; path: string }> = [
    { testId: 'cultivation-hub-link-method', path: '/cultivation-method-v2' },
    { testId: 'cultivation-hub-link-breakthrough', path: '/breakthrough' },
    { testId: 'cultivation-hub-link-body', path: '/body-cultivation' },
    { testId: 'cultivation-hub-link-root', path: '/spiritual-root' },
    { testId: 'cultivation-hub-link-skill', path: '/skill-book' },
    { testId: 'cultivation-hub-link-tribulation', path: '/tribulation' },
  ];

  it('render đủ 6 deep-link button và mỗi button push đúng path', async () => {
    gameState.character = buildCharacter();
    gameState.realmFullName = 'Luyện Khí — Trung Cấp 3';
    gameState.expProgress = 0.5;
    mountView();
    await flushPromises();

    for (const { testId } of linkCases) {
      expect(
        wrapper?.find(`[data-testid="${testId}"]`).exists(),
        `deep link ${testId} should render`,
      ).toBe(true);
    }

    for (const { testId, path } of linkCases) {
      routerPushMock.mockClear();
      await wrapper?.find(`[data-testid="${testId}"]`).trigger('click');
      expect(routerPushMock).toHaveBeenCalledWith(path);
    }
  });

  it('section deep-links cũng chứa các nút go riêng cho method/root/body/breakthrough/tribulation', async () => {
    gameState.character = buildCharacter();
    gameState.realmFullName = 'Luyện Khí';
    gameState.expProgress = 0.4;
    mountView();
    await flushPromises();

    const sectionLinks: Array<{ testId: string; path: string }> = [
      { testId: 'cultivation-hub-method-go', path: '/cultivation-method-v2' },
      { testId: 'cultivation-hub-root-go', path: '/spiritual-root' },
      { testId: 'cultivation-hub-body-go', path: '/body-cultivation' },
      { testId: 'cultivation-hub-breakthrough-go', path: '/breakthrough' },
      { testId: 'cultivation-hub-tribulation-go', path: '/tribulation' },
    ];

    for (const { testId, path } of sectionLinks) {
      routerPushMock.mockClear();
      const btn = wrapper?.find(`[data-testid="${testId}"]`);
      expect(btn?.exists(), `${testId} should render`).toBe(true);
      await btn?.trigger('click');
      expect(routerPushMock).toHaveBeenCalledWith(path);
    }
  });
});
