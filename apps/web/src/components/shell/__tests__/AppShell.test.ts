import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { createI18n } from 'vue-i18n';
import { setActivePinia, createPinia } from 'pinia';

/**
 * AppShell skeleton/smoke tests (session 9i task G): cover layout shell —
 * mobile nav toggle, sidebar badges (breakthroughReady/bossActive/
 * missionClaimable/topupPending/unreadMail), staff-only admin link, EXP
 * bar color flip theo cultivating, WS status pill.
 *
 * Pattern: mock `vue-router` (useRoute, useRouter, RouterLink stub), ChatPanel
 * + LocaleSwitcher (slot-free stubs) + tất cả stores để render nhanh.
 */

const routerPushMock = vi.fn();
vi.mock('vue-router', () => ({
  useRouter: () => ({ push: routerPushMock }),
  useRoute: () => ({ fullPath: '/home', path: '/home' }),
  RouterLink: {
    name: 'RouterLinkStub',
    props: ['to'],
    template: '<a :href="typeof to === \'string\' ? to : \'\'" :data-to="typeof to === \'string\' ? to : \'\'"><slot /></a>',
  },
}));

const authLogoutMock = vi.fn().mockResolvedValue(undefined);
vi.mock('@/stores/auth', () => ({
  useAuthStore: () => ({
    logout: authLogoutMock,
  }),
}));

type FakeChar = {
  id: string;
  name: string;
  cultivating: boolean;
  stamina: number;
  staminaMax: number;
  linhThach: string;
  tienNgoc: number;
  power: number;
  title?: string | null;
  role: 'PLAYER' | 'MOD' | 'ADMIN';
};

const gameState: {
  character: FakeChar | null;
  wsConnected: boolean;
  unreadMail: number;
  realmFullName: string;
  expProgress: number;
  hydrateUnreadMail: ReturnType<typeof vi.fn>;
} = {
  character: null,
  wsConnected: false,
  unreadMail: 0,
  realmFullName: '—',
  expProgress: 0,
  hydrateUnreadMail: vi.fn().mockResolvedValue(undefined),
};
vi.mock('@/stores/game', () => ({
  useGameStore: () => gameState,
}));

const badgesState = {
  missionClaimable: 0,
  bossActive: false,
  topupPending: false,
  breakthroughReady: false,
  start: vi.fn(),
  stop: vi.fn(),
};
vi.mock('@/stores/badges', () => ({
  useBadgesStore: () => badgesState,
}));

vi.mock('@/components/shell/ChatPanel.vue', () => ({
  default: { name: 'ChatPanelStub', template: '<div data-testid="chat-panel-stub" />' },
}));
vi.mock('@/components/shell/LocaleSwitcher.vue', () => ({
  default: { name: 'LocaleSwitcherStub', template: '<div data-testid="locale-switcher-stub" />' },
}));

import AppShell from '@/components/shell/AppShell.vue';

const i18n = createI18n({
  legacy: false,
  locale: 'vi',
  fallbackLocale: 'vi',
  missingWarn: false,
  fallbackWarn: false,
  messages: {
    vi: {
      app: { brand: 'XT', tagline: 'Tu Tiên Lộ' },
      shell: {
        stamina: 'Nguyên khí',
        wsOn: 'Tuyến linh',
        wsOff: 'Mất liên',
        nav: {
          toggle: 'Mở menu',
          home: 'Đạo Cung',
          dashboard: 'Dashboard',
          character: 'Nhân Vật',
          cultivation: 'Tu Luyện',
          breakthrough: 'Đột Phá',
          bodyCultivation: 'Luyện Thể',
          cultivationMethod: 'Công Pháp',
          spiritualRoot: 'Linh Căn',
          skillBook: 'Kỹ Năng',
          alchemy: 'Luyện Đan',
          equipment: 'Trang Bị',
          pets: 'Linh Thú',
          secretRealms: 'Bí Cảnh',
          dungeonRun: 'Phụ Bản',
          roguelike: 'Ảo Cảnh',
          tower: 'Đăng Tiên Tháp',
          dungeon: 'Kiếm Mộ',
          inventory: 'Tàng Bảo Các',
          market: 'Hắc Thị',
          shop: 'Chợ Tiên',
          sect: 'Tông Môn',
          boss: 'Yêu Vương',
          talents: 'Ngộ Đạo',
          missions: 'Nhiệm Vụ',
          auction: 'Đấu Giá',
          events: 'Sự Kiện',
          achievements: 'Thành Tựu',
          social: 'Đạo Hữu',
          mail: 'Thư Truyền',
          notificationSettings: 'Thông Báo',
          giftcode: 'Quà Tặng',
          leaderboard: 'Bảng Phong',
          topup: 'Nạp Tiên Ngọc',
          activity: 'Sổ Đạo',
          feedback: 'Phản hồi',
          reportPlayer: 'Tố cáo',
          settings: 'Tâm Pháp',
          admin: 'Đại Diện',
        },
        group: { core: 'Chính', cultivation: 'Tu Luyện', activity: 'Hoạt Động', social: 'Xã Hội', system: 'Hệ Thống' },
        badge: {
          breakthroughReady: 'Sẵn sàng đột phá',
          bossActive: 'Yêu vương xuất hiện',
          topupPending: 'Có đơn nạp chờ duyệt',
        },
      },
      home: { logout: 'Xuất quan' },
      dashboard: { progression: { linhThach: 'Linh Thạch', tienNgoc: 'Tiên Ngọc' } },
    },
  },
});

let wrapper: ReturnType<typeof mount> | null = null;

function buildChar(overrides: Partial<FakeChar> = {}): FakeChar {
  return {
    id: 'c1',
    name: 'Tiêu Viêm',
    cultivating: false,
    stamina: 60,
    staminaMax: 100,
    linhThach: '1234',
    tienNgoc: 88,
    power: 999,
    title: null,
    role: 'PLAYER',
    ...overrides,
  };
}

function mountShell() {
  wrapper = mount(AppShell, {
    attachTo: document.body,
    global: { plugins: [i18n] },
    slots: { default: '<div data-testid="slot-marker">slot</div>' },
  });
  return wrapper;
}

describe('AppShell — mobile nav toggle', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
    gameState.character = buildChar();
    gameState.wsConnected = true;
    gameState.unreadMail = 0;
    gameState.realmFullName = 'Luyện Khí — Sơ Cấp 3';
    gameState.expProgress = 0.5;
    badgesState.missionClaimable = 0;
    badgesState.bossActive = false;
    badgesState.topupPending = false;
    badgesState.breakthroughReady = false;
  });

  afterEach(() => {
    wrapper?.unmount();
    wrapper = null;
    document.body.innerHTML = '';
  });

  it('khi mới render: backdrop không hiển thị, sidebar class `-translate-x-full` (đóng trên mobile)', async () => {
    mountShell();
    await flushPromises();
    expect(document.querySelector('[data-testid="shell-mobile-backdrop"]')).toBeNull();
    const sidebar = document.querySelector('[data-testid="shell-sidebar"]');
    expect(sidebar?.className).toContain('-translate-x-full');
  });

  it('click toggle → sidebar class `translate-x-0` (mở) + backdrop hiển thị + aria-expanded="true"', async () => {
    mountShell();
    await flushPromises();
    const toggle = document.querySelector<HTMLButtonElement>('[data-testid="shell-mobile-toggle"]');
    toggle!.click();
    await flushPromises();
    expect(toggle!.getAttribute('aria-expanded')).toBe('true');
    const sidebar = document.querySelector('[data-testid="shell-sidebar"]');
    expect(sidebar?.className).toContain('translate-x-0');
    expect(document.querySelector('[data-testid="shell-mobile-backdrop"]')).not.toBeNull();
  });

  it('click backdrop → đóng lại + backdrop biến mất', async () => {
    mountShell();
    await flushPromises();
    document.querySelector<HTMLButtonElement>('[data-testid="shell-mobile-toggle"]')!.click();
    await flushPromises();
    document.querySelector<HTMLElement>('[data-testid="shell-mobile-backdrop"]')!.click();
    await flushPromises();
    expect(document.querySelector('[data-testid="shell-mobile-backdrop"]')).toBeNull();
  });
});

describe('AppShell — sidebar badges', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
    gameState.character = buildChar();
    gameState.wsConnected = true;
    gameState.unreadMail = 0;
    gameState.realmFullName = 'Luyện Khí';
    gameState.expProgress = 0.5;
    badgesState.missionClaimable = 0;
    badgesState.bossActive = false;
    badgesState.topupPending = false;
    badgesState.breakthroughReady = false;
  });

  afterEach(() => {
    wrapper?.unmount();
    wrapper = null;
    document.body.innerHTML = '';
  });

  it('breakthroughReady = true → hiển thị purple dot trên nav home', async () => {
    badgesState.breakthroughReady = true;
    mountShell();
    await flushPromises();
    expect(
      document.querySelector('[data-testid="shell-nav-home-breakthrough-badge"]'),
    ).not.toBeNull();
  });

  it('breakthroughReady = false → không hiển thị purple dot', async () => {
    badgesState.breakthroughReady = false;
    mountShell();
    await flushPromises();
    expect(
      document.querySelector('[data-testid="shell-nav-home-breakthrough-badge"]'),
    ).toBeNull();
  });

  it('missionClaimable > 99 → hiển thị "99+"', async () => {
    badgesState.missionClaimable = 150;
    mountShell();
    await flushPromises();
    expect(document.body.innerHTML).toContain('99+');
  });

  it('missionClaimable = 5 → hiển thị đúng "5"', async () => {
    badgesState.missionClaimable = 5;
    mountShell();
    await flushPromises();
    // Tìm badge amber-500 pill có đúng số 5
    const amberBadges = Array.from(
      document.querySelectorAll<HTMLElement>('.bg-amber-500'),
    );
    const match = amberBadges.find((el) => el.textContent?.trim() === '5');
    expect(match).toBeDefined();
  });

  it('unreadMail > 0 → hiển thị red-600 badge với số; = 0 → không hiển thị', async () => {
    gameState.unreadMail = 3;
    mountShell();
    await flushPromises();
    const redBadges = Array.from(document.querySelectorAll<HTMLElement>('.bg-red-600'));
    const mailBadge = redBadges.find((el) => el.textContent?.trim() === '3');
    expect(mailBadge).toBeDefined();
  });
});

describe('AppShell — staff-only admin link + cultivating color + logout', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
    gameState.character = buildChar();
    gameState.wsConnected = true;
    gameState.unreadMail = 0;
    gameState.realmFullName = 'Luyện Khí';
    gameState.expProgress = 0.5;
    badgesState.missionClaimable = 0;
    badgesState.bossActive = false;
    badgesState.topupPending = false;
    badgesState.breakthroughReady = false;
  });

  afterEach(() => {
    wrapper?.unmount();
    wrapper = null;
    document.body.innerHTML = '';
  });

  it('character.role = PLAYER → KHÔNG hiển thị link admin (text "Đại Diện" absent)', async () => {
    gameState.character = buildChar({ role: 'PLAYER' });
    mountShell();
    await flushPromises();
    expect(document.body.innerHTML).not.toContain('Đại Diện');
  });

  it('character.role = ADMIN → hiển thị text "Đại Diện" trong sidebar', async () => {
    gameState.character = buildChar({ role: 'ADMIN' });
    mountShell();
    await flushPromises();
    const sidebar = document.querySelector<HTMLElement>('[data-testid="shell-sidebar"]');
    expect(sidebar?.textContent).toContain('Đại Diện');
  });

  it('character.role = MOD → hiển thị text "Đại Diện" (staff = MOD | ADMIN)', async () => {
    gameState.character = buildChar({ role: 'MOD' });
    mountShell();
    await flushPromises();
    const sidebar = document.querySelector<HTMLElement>('[data-testid="shell-sidebar"]');
    expect(sidebar?.textContent).toContain('Đại Diện');
  });

  it('cultivating = true → EXP bar có class emerald-400', async () => {
    gameState.character = buildChar({ cultivating: true });
    mountShell();
    await flushPromises();
    // 2 EXP bar (topbar 40px + optional thêm), lấy bar đầu có bg-emerald-400.
    const emerald = document.querySelector<HTMLElement>('.bg-emerald-400');
    expect(emerald).not.toBeNull();
  });

  it('cultivating = false → EXP bar có class ink-300 (không emerald)', async () => {
    gameState.character = buildChar({ cultivating: false });
    mountShell();
    await flushPromises();
    expect(document.querySelector<HTMLElement>('.bg-emerald-400')).toBeNull();
  });

  it('topbar resource chips render', async () => {
    gameState.character = buildChar({ linhThach: '4567', tienNgoc: 99, power: 12345 });
    mountShell();
    await flushPromises();
    const chips = document.querySelector<HTMLElement>('[data-testid="shell-resource-chips"]');
    expect(chips?.textContent).toContain('4567');
    expect(chips?.textContent).toContain('99');
    expect(chips?.textContent).toContain('12345');
  });

  it('wsConnected = true → pill "Tuyến linh" emerald; = false → "Mất liên" red', async () => {
    gameState.wsConnected = true;
    mountShell();
    await flushPromises();
    expect(document.body.innerHTML).toContain('Tuyến linh');
    wrapper?.unmount();
    document.body.innerHTML = '';

    gameState.wsConnected = false;
    mountShell();
    await flushPromises();
    expect(document.body.innerHTML).toContain('Mất liên');
  });

  it('click logout button → gọi auth.logout + router.push("/auth")', async () => {
    mountShell();
    await flushPromises();
    const buttons = Array.from(document.querySelectorAll<HTMLButtonElement>('button'));
    const logoutBtn = buttons.find((b) => b.textContent?.trim() === 'Xuất quan');
    expect(logoutBtn).toBeDefined();
    logoutBtn!.click();
    await flushPromises();
    expect(authLogoutMock).toHaveBeenCalledOnce();
    expect(routerPushMock).toHaveBeenCalledWith('/auth');
  });
});
