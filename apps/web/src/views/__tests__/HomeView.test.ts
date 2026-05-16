import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { createI18n } from 'vue-i18n';
import { setActivePinia, createPinia } from 'pinia';

/**
 * HomeView skeleton/smoke tests (session 9i task F): cover các nhánh
 * onMounted (chưa auth → /auth, có auth nhưng chưa có character → /onboarding,
 * có character → fetchState + bindSocket + badges.refresh) và 2 action chính
 * (toggleCultivate, breakthrough disabled khi chưa đạt đỉnh).
 *
 * Pattern: mock AppShell + child slot components (NextActionPanel,
 * OnboardingChecklist, DailyLoginCard) để view có thể mount nhanh không phụ
 * thuộc vào nhiều layout/store khác.
 */

const getCharacterMock = vi.fn();
vi.mock('@/api/character', () => ({
  getCharacter: (...a: unknown[]) => getCharacterMock(...a),
}));

const routerReplaceMock = vi.fn();
const routerPushMock = vi.fn();
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

type FakeChar = {
  id: string;
  name: string;
  cultivating: boolean;
  exp: string;
  expNext: string;
  hp: number;
  hpMax: number;
  mp: number;
  mpMax: number;
  power: number;
  spirit: number;
  speed: number;
  luck: number;
  realmStage: number;
};

const gameState: {
  character: FakeChar | null;
  realmFullName: string;
  expProgress: number;
  lastTickAt: string | null;
  lastTickGain: number;
  fetchState: ReturnType<typeof vi.fn>;
  bindSocket: ReturnType<typeof vi.fn>;
  setCultivating: ReturnType<typeof vi.fn>;
  breakthrough: ReturnType<typeof vi.fn>;
  hydrateUnreadMail: ReturnType<typeof vi.fn>;
  hydrateCurrentSect: ReturnType<typeof vi.fn>;
  unreadMail: number;
  currentSect: null;
} = {
  character: null,
  realmFullName: 'Luyện Khí — Sơ Cấp 1',
  expProgress: 0.4,
  lastTickAt: null,
  lastTickGain: 0,
  fetchState: vi.fn().mockResolvedValue(undefined),
  bindSocket: vi.fn(),
  setCultivating: vi.fn().mockResolvedValue(undefined),
  breakthrough: vi.fn().mockResolvedValue(undefined),
  hydrateUnreadMail: vi.fn().mockResolvedValue(undefined),
  hydrateCurrentSect: vi.fn().mockResolvedValue(undefined),
  unreadMail: 0,
  currentSect: null,
};
vi.mock('@/stores/game', () => ({
  useGameStore: () => gameState,
}));

const badgesState = {
  refresh: vi.fn().mockResolvedValue(undefined),
};
vi.mock('@/stores/badges', () => ({
  useBadgesStore: () => badgesState,
}));

const storyDungeonState = {
  loaded: false,
  hasAnyAvailable: false,
  hasActiveRun: false,
  availableCount: 0,
  load: vi.fn().mockResolvedValue(undefined),
};
vi.mock('@/stores/storyDungeon', () => ({
  useStoryDungeonStore: () => storyDungeonState,
}));

vi.mock('@/components/shell/AppShell.vue', () => ({
  default: {
    name: 'AppShellStub',
    template: '<div data-testid="app-shell-stub"><slot /></div>',
  },
}));
vi.mock('@/components/NextActionPanel.vue', () => ({
  default: {
    name: 'NextActionPanelStub',
    template: '<div data-testid="next-action-stub" />',
  },
}));
vi.mock('@/components/OnboardingChecklist.vue', () => ({
  default: {
    name: 'OnboardingChecklistStub',
    template: '<div data-testid="onboarding-stub" />',
  },
}));
vi.mock('@/components/DailyLoginCard.vue', () => ({
  default: {
    name: 'DailyLoginCardStub',
    template: '<div data-testid="daily-login-stub" />',
  },
}));

import HomeView from '@/views/HomeView.vue';

const i18n = createI18n({
  legacy: false,
  locale: 'vi',
  fallbackLocale: 'vi',
  missingWarn: false,
  fallbackWarn: false,
  messages: {
    vi: {
      home: {
        expLabel: 'Tu vi',
        loadingChar: 'Đang dò linh khí...',
        wip: 'Coming soon',
        cultivate: {
          start: 'Bắt đầu tu luyện',
          stop: 'Dừng tu luyện',
          startedToast: 'Đã khởi đan lô.',
          stoppedToast: 'Đã ngưng tu luyện.',
        },
        breakthrough: {
          submit: 'Đột phá',
          successToast: 'Phá vỡ cảnh giới!',
          notAtPeakToast: 'Chưa đủ duyên đột phá.',
        },
        stats: {
          title: 'Thuộc tính',
          power: 'Lực',
          spirit: 'Linh',
          speed: 'Tốc',
          luck: 'May',
        },
        lastTick: 'Tu vi +{gain} lúc {time}.',
        storyDungeon: {
          title: 'Bí Cảnh Cốt Truyện',
          descActive: 'Bạn đang trong 1 bí cảnh cốt truyện.',
          descAvailable: 'Có {n} bí cảnh đang chờ khám phá.',
          openBtn: 'Vào bí cảnh',
        },
      },
      homeLiveOps: {
        sectMissionTitle: 'Sect Mission',
        sectMissionDesc: 'desc',
        openBtn: 'Mở',
      },
      auth: {
        errors: {
          UNKNOWN: 'Có lỗi xảy ra.',
        },
      },
    },
  },
});

let wrapper: ReturnType<typeof mount> | null = null;

function buildChar(overrides: Partial<FakeChar> = {}): FakeChar {
  return {
    id: 'c1',
    name: 'Tiêu Viêm',
    cultivating: false,
    exp: '50',
    expNext: '100',
    hp: 80,
    hpMax: 100,
    mp: 40,
    mpMax: 60,
    power: 10,
    spirit: 8,
    speed: 6,
    luck: 4,
    realmStage: 1,
    ...overrides,
  };
}

function mountView() {
  wrapper = mount(HomeView, {
    attachTo: document.body,
    global: { plugins: [i18n] },
  });
  return wrapper;
}

describe('HomeView — onMounted routing branches', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
    authState.isAuthenticated = true;
    authState.hydrate = vi.fn().mockResolvedValue(undefined);
    gameState.character = null;
    gameState.fetchState = vi.fn().mockResolvedValue(undefined);
    gameState.bindSocket = vi.fn();
    gameState.setCultivating = vi.fn().mockResolvedValue(undefined);
    gameState.breakthrough = vi.fn().mockResolvedValue(undefined);
    badgesState.refresh = vi.fn().mockResolvedValue(undefined);
    storyDungeonState.loaded = false;
    storyDungeonState.hasAnyAvailable = false;
    storyDungeonState.hasActiveRun = false;
    storyDungeonState.availableCount = 0;
    storyDungeonState.load = vi.fn().mockResolvedValue(undefined);
  });

  afterEach(() => {
    wrapper?.unmount();
    wrapper = null;
    document.body.innerHTML = '';
  });

  it('chưa auth → router.replace(/auth) và KHÔNG gọi getCharacter', async () => {
    authState.isAuthenticated = false;
    mountView();
    await flushPromises();
    expect(routerReplaceMock).toHaveBeenCalledWith('/auth');
    expect(getCharacterMock).not.toHaveBeenCalled();
    expect(gameState.fetchState).not.toHaveBeenCalled();
  });

  it('đã auth nhưng chưa có character → router.replace(/onboarding) và KHÔNG fetchState', async () => {
    authState.isAuthenticated = true;
    getCharacterMock.mockResolvedValueOnce(null);
    mountView();
    await flushPromises();
    expect(routerReplaceMock).toHaveBeenCalledWith('/onboarding');
    expect(getCharacterMock).toHaveBeenCalledOnce();
    expect(gameState.fetchState).not.toHaveBeenCalled();
  });

  it('đã auth + có character → fetchState + bindSocket + badges.refresh đều được gọi, KHÔNG redirect', async () => {
    authState.isAuthenticated = true;
    getCharacterMock.mockResolvedValueOnce({ id: 'c1' });
    gameState.character = buildChar();
    mountView();
    await flushPromises();
    expect(routerReplaceMock).not.toHaveBeenCalled();
    expect(gameState.fetchState).toHaveBeenCalledOnce();
    expect(gameState.bindSocket).toHaveBeenCalledOnce();
    expect(badgesState.refresh).toHaveBeenCalledOnce();
  });

  it('character API throw → coi như không có character, redirect /onboarding', async () => {
    getCharacterMock.mockRejectedValueOnce(new Error('boom'));
    mountView();
    await flushPromises();
    expect(routerReplaceMock).toHaveBeenCalledWith('/onboarding');
    expect(gameState.fetchState).not.toHaveBeenCalled();
  });
});

describe('HomeView — render với character', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
    authState.isAuthenticated = true;
    getCharacterMock.mockResolvedValue({ id: 'c1' });
    gameState.character = buildChar();
    gameState.fetchState = vi.fn().mockResolvedValue(undefined);
    gameState.bindSocket = vi.fn();
    gameState.setCultivating = vi.fn().mockResolvedValue(undefined);
    gameState.breakthrough = vi.fn().mockResolvedValue(undefined);
    badgesState.refresh = vi.fn().mockResolvedValue(undefined);
    storyDungeonState.loaded = false;
    storyDungeonState.hasAnyAvailable = false;
    storyDungeonState.hasActiveRun = false;
    storyDungeonState.availableCount = 0;
    storyDungeonState.load = vi.fn().mockResolvedValue(undefined);
  });

  afterEach(() => {
    wrapper?.unmount();
    wrapper = null;
    document.body.innerHTML = '';
  });

  it('hiển thị tên nhân vật, realm, exp text, HP/MP, stats', async () => {
    mountView();
    await flushPromises();
    const html = document.body.innerHTML;
    expect(html).toContain('Tiêu Viêm');
    expect(html).toContain('Luyện Khí');
    expect(html).toContain('50 / 100');
    expect(html).toContain('80 / 100'); // HP
    expect(html).toContain('40 / 60'); // MP
  });

  it('toggleCultivate: gọi setCultivating(true) khi character đang nghỉ → toast started', async () => {
    gameState.character = buildChar({ cultivating: false });
    mountView();
    await flushPromises();
    const buttons = Array.from(document.querySelectorAll<HTMLButtonElement>('button'));
    const startBtn = buttons.find((b) => b.textContent?.includes('Bắt đầu tu luyện'));
    expect(startBtn).toBeDefined();
    // Sau khi click, view sẽ gọi store.setCultivating(true) — flip trạng thái local
    // sau khi await, sau đó push toast start.
    gameState.setCultivating = vi.fn(async () => {
      gameState.character!.cultivating = true;
    });
    startBtn!.click();
    await flushPromises();
    expect(gameState.setCultivating).toHaveBeenCalledWith(true);
    expect(toastPushMock).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'success', text: 'Đã khởi đan lô.' }),
    );
  });

  it('breakthrough button disabled khi character chưa ở đỉnh (realmStage 1, exp < expNext)', async () => {
    gameState.character = buildChar({ realmStage: 1, exp: '50', expNext: '100' });
    mountView();
    await flushPromises();
    const buttons = Array.from(document.querySelectorAll<HTMLButtonElement>('button'));
    const btBtn = buttons.find((b) => b.textContent?.includes('Đột phá'));
    expect(btBtn).toBeDefined();
    expect(btBtn!.disabled).toBe(true);
  });

  it('breakthrough button enabled khi character ở đỉnh (realmStage 9, exp >= expNext)', async () => {
    gameState.character = buildChar({ realmStage: 9, exp: '500', expNext: '500' });
    mountView();
    await flushPromises();
    const buttons = Array.from(document.querySelectorAll<HTMLButtonElement>('button'));
    const btBtn = buttons.find((b) => b.textContent?.includes('Đột phá'));
    expect(btBtn).toBeDefined();
    expect(btBtn!.disabled).toBe(false);
  });

  it('breakthrough error code NOT_AT_PEAK → toast warning notAtPeak (không phải UNKNOWN)', async () => {
    gameState.character = buildChar({ realmStage: 9, exp: '500', expNext: '500' });
    gameState.breakthrough = vi.fn().mockRejectedValue({ code: 'NOT_AT_PEAK' });
    mountView();
    await flushPromises();
    const buttons = Array.from(document.querySelectorAll<HTMLButtonElement>('button'));
    const btBtn = buttons.find((b) => b.textContent?.includes('Đột phá'));
    btBtn!.click();
    await flushPromises();
    expect(toastPushMock).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'warning', text: 'Chưa đủ duyên đột phá.' }),
    );
  });
});

describe('HomeView — Phase 12.8 Story Dungeon CTA', () => {
  // Cover §F mục 7: Home CTA visible khi store.loaded && (hasAnyAvailable || hasActiveRun).
  // Click → router.push('/story-dungeons'). Fail-soft: store.load throw → vẫn render Home.

  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
    authState.isAuthenticated = true;
    getCharacterMock.mockResolvedValue({ id: 'c1' });
    gameState.character = buildChar();
    gameState.fetchState = vi.fn().mockResolvedValue(undefined);
    gameState.bindSocket = vi.fn();
    gameState.setCultivating = vi.fn().mockResolvedValue(undefined);
    gameState.breakthrough = vi.fn().mockResolvedValue(undefined);
    badgesState.refresh = vi.fn().mockResolvedValue(undefined);
    storyDungeonState.loaded = false;
    storyDungeonState.hasAnyAvailable = false;
    storyDungeonState.hasActiveRun = false;
    storyDungeonState.availableCount = 0;
    storyDungeonState.load = vi.fn().mockResolvedValue(undefined);
  });

  afterEach(() => {
    wrapper?.unmount();
    wrapper = null;
    document.body.innerHTML = '';
  });

  it('store.loaded=true + hasAnyAvailable=true → render CTA + label desc available với count', async () => {
    storyDungeonState.loaded = true;
    storyDungeonState.hasAnyAvailable = true;
    storyDungeonState.availableCount = 3;
    mountView();
    await flushPromises();
    const cta = document.querySelector('[data-testid="home-story-dungeon-cta"]');
    expect(cta).not.toBeNull();
    expect(cta?.textContent).toContain('Bí Cảnh Cốt Truyện');
    expect(cta?.textContent).toContain('3');
  });

  it('store.loaded=true + hasActiveRun=true (no available) → render CTA + label desc active', async () => {
    storyDungeonState.loaded = true;
    storyDungeonState.hasAnyAvailable = false;
    storyDungeonState.hasActiveRun = true;
    storyDungeonState.availableCount = 0;
    mountView();
    await flushPromises();
    const cta = document.querySelector('[data-testid="home-story-dungeon-cta"]');
    expect(cta).not.toBeNull();
    expect(cta?.textContent).toContain('Bạn đang trong 1 bí cảnh cốt truyện.');
  });

  it('store.loaded=false → KHÔNG render CTA (chưa fetch xong)', async () => {
    storyDungeonState.loaded = false;
    storyDungeonState.hasAnyAvailable = true;
    storyDungeonState.hasActiveRun = true;
    storyDungeonState.availableCount = 5;
    mountView();
    await flushPromises();
    expect(document.querySelector('[data-testid="home-story-dungeon-cta"]')).toBeNull();
  });

  it('store.loaded=true + cả hasAnyAvailable + hasActiveRun = false → KHÔNG render CTA', async () => {
    storyDungeonState.loaded = true;
    storyDungeonState.hasAnyAvailable = false;
    storyDungeonState.hasActiveRun = false;
    storyDungeonState.availableCount = 0;
    mountView();
    await flushPromises();
    expect(document.querySelector('[data-testid="home-story-dungeon-cta"]')).toBeNull();
  });

  it('chưa có character → KHÔNG render CTA dù store.loaded=true', async () => {
    gameState.character = null;
    getCharacterMock.mockResolvedValue(null);
    storyDungeonState.loaded = true;
    storyDungeonState.hasAnyAvailable = true;
    storyDungeonState.availableCount = 1;
    mountView();
    await flushPromises();
    expect(document.querySelector('[data-testid="home-story-dungeon-cta"]')).toBeNull();
  });

  it('click CTA "Vào bí cảnh" → router.push("/story-dungeons")', async () => {
    storyDungeonState.loaded = true;
    storyDungeonState.hasAnyAvailable = true;
    storyDungeonState.availableCount = 1;
    mountView();
    await flushPromises();
    const cta = document.querySelector(
      '[data-testid="home-story-dungeon-cta"]',
    ) as HTMLElement;
    expect(cta).not.toBeNull();
    const btn = Array.from(cta.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('Vào bí cảnh'),
    ) as HTMLButtonElement | undefined;
    expect(btn).toBeDefined();
    btn!.click();
    await flushPromises();
    expect(routerPushMock).toHaveBeenCalledWith('/story-dungeons');
  });

  it('storyDungeonStore.load throw → home vẫn render bình thường (fail-soft)', async () => {
    storyDungeonState.load = vi.fn().mockRejectedValue(new Error('boom'));
    storyDungeonState.loaded = false;
    mountView();
    await flushPromises();
    // Character section vẫn render (verify HomeView không crash khi load throw)
    expect(document.body.innerHTML).toContain('Tiêu Viêm');
    expect(document.querySelector('[data-testid="home-story-dungeon-cta"]')).toBeNull();
  });

  it('onMounted gọi storyDungeonStore.load() sau khi character loaded', async () => {
    mountView();
    await flushPromises();
    expect(storyDungeonState.load).toHaveBeenCalledOnce();
  });
});
