import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { createI18n } from 'vue-i18n';


/**
 * UI-2.0 shell smoke tests. Cover:
 *  - XTBottomNav render đủ 5 mục (home, cultivation, inventory, activity, menu).
 *  - XTMenuDrawer mở/đóng + nhóm chức năng render.
 *  - XTBackButton history.back và fallback /dashboard khi không có history.
 *  - XTPageHeader render title + back button.
 *  - XTIcon render <svg data-testid="xt-icon" data-name="..."/>.
 *
 * Pattern: stub vue-router (router.push spy), gắn i18n tối thiểu cho keys
 * shell.nav.*, shell.group.*, xt.menu.*.
 */

const pushMock = vi.fn();
const backMock = vi.fn();
const useRouteRef = { fullPath: '/home', path: '/home' };

vi.mock('vue-router', () => ({
  useRouter: () => ({ push: pushMock, back: backMock }),
  useRoute: () => useRouteRef,
  RouterLink: {
    name: 'RouterLinkStub',
    props: ['to'],
    template:
      '<a :href="typeof to === \'string\' ? to : \'\'" :data-to="typeof to === \'string\' ? to : \'\'"><slot /></a>',
  },
}));

vi.mock('@/stores/game', () => ({
  useGameStore: () => ({
    character: {
      id: 'c1',
      name: 'Tiêu Viêm',
      realmKey: 'luyenkhi',
      realmStage: 1,
      power: 999,
      role: 'PLAYER',
    },
    realmFullName: 'Luyện Khí · Tầng 1',
    unreadMail: 0,
    wsConnected: true,
    fetchState: vi.fn().mockResolvedValue(undefined),
    hydrateUnreadMail: vi.fn().mockResolvedValue(undefined),
    bindSocket: vi.fn(),
  }),
}));

vi.mock('@/stores/badges', () => ({
  useBadgesStore: () => ({
    missionClaimable: 0,
    bossActive: false,
    topupPending: false,
    breakthroughReady: false,
    start: vi.fn(),
    stop: vi.fn(),
  }),
}));

const i18n = createI18n({
  legacy: false,
  locale: 'vi',
  fallbackLocale: 'vi',
  missingWarn: false,
  fallbackWarn: false,
  messages: {
    vi: {
      common: { back: 'Quay lại', close: 'Đóng' },
      shell: {
        nav: {
          home: 'Trang Chủ',
          dashboard: 'Dashboard',
          cultivation: 'Tu Luyện',
          inventory: 'Túi Đồ',
          activity: 'Hoạt Động',
          menu: 'Menu',
          character: 'Nhân Vật',
          breakthrough: 'Đột Phá',
          bodyCultivation: 'Luyện Thể',
          cultivationMethod: 'Công Pháp',
          spiritualRoot: 'Linh Căn',
          skillBook: 'Kỹ Năng',
          alchemy: 'Luyện Đan',
          equipment: 'Trang Bị',
          farm: 'Farm Map',
          boss: 'Boss',
          secretRealms: 'Bí Cảnh',
          tower: 'Tháp',
          roguelike: 'Roguelike',
          missions: 'Nhiệm Vụ',
          events: 'Sự Kiện',
          pets: 'Linh Thú',
          artifact: 'Pháp Bảo',
          sect: 'Tông Môn',
          social: 'Bạn Bè',
          mentor: 'Sư Đồ',
          mail: 'Thư',
          notificationSettings: 'Thông Báo',
          market: 'Chợ',
          auction: 'Đấu Giá',
          shop: 'Linh Bảo Các',
          topup: 'Nạp',
          achievements: 'Thành Tựu',
          titles: 'Danh Hiệu',
          reputation: 'Uy Danh',
          seasons: 'Mùa Giải',
          leaderboard: 'BXH',
          settings: 'Cài Đặt',
          feedback: 'Hỗ Trợ',
          reportPlayer: 'Tố Cáo',
          giftcode: 'Quà',
          world: 'Thế Giới',
          admin: 'Admin',
          toggle: 'Mở menu',
        },
        group: {
          core: 'Chính',
          cultivation: 'Tu Luyện',
          activity: 'Hoạt Động',
          inventory: 'Vật Phẩm',
          social: 'Xã Hội',
          market: 'Kinh Tế',
          longTerm: 'Dài Hạn',
          system: 'Hệ Thống',
        },
      },
      xt: {
        menu: { title: 'XT', subtitle: 'Tu Tiên Lộ' },
      },
    },
  },
});

let wrapper: ReturnType<typeof mount> | null = null;

afterEach(() => {
  wrapper?.unmount();
  wrapper = null;
  document.body.innerHTML = '';
  pushMock.mockReset();
  backMock.mockReset();
});

describe('XTBottomNav', () => {
  beforeEach(() => {
    useRouteRef.path = '/home';
    useRouteRef.fullPath = '/home';
  });

  it('render đúng 5 mục: home / cultivation / inventory / activity / menu', async () => {
    const XTBottomNav = (await import('@/components/shell/XTBottomNav.vue')).default;
    wrapper = mount(XTBottomNav, {
      attachTo: document.body,
      global: { plugins: [i18n] },
      props: { drawerOpen: false },
    });
    await flushPromises();
    const items = document.querySelectorAll('[data-testid^="xt-bottomnav-"]');
    expect(items.length).toBeGreaterThanOrEqual(5);
    expect(
      document.querySelector('[data-testid="xt-bottomnav-home"]'),
    ).not.toBeNull();
    expect(
      document.querySelector('[data-testid="xt-bottomnav-cultivation"]'),
    ).not.toBeNull();
    expect(
      document.querySelector('[data-testid="xt-bottomnav-inventory"]'),
    ).not.toBeNull();
    expect(
      document.querySelector('[data-testid="xt-bottomnav-activity"]'),
    ).not.toBeNull();
    expect(
      document.querySelector('[data-testid="xt-bottomnav-menu"]'),
    ).not.toBeNull();
  });

  it('click mục cultivation → router.push(/cultivation)', async () => {
    const XTBottomNav = (await import('@/components/shell/XTBottomNav.vue')).default;
    wrapper = mount(XTBottomNav, {
      attachTo: document.body,
      global: { plugins: [i18n] },
      props: { drawerOpen: false },
    });
    await flushPromises();
    document
      .querySelector<HTMLButtonElement>('[data-testid="xt-bottomnav-cultivation"]')!
      .click();
    await flushPromises();
    expect(pushMock).toHaveBeenCalledWith('/cultivation');
  });

  it('click menu → emit open-menu (KHÔNG push route)', async () => {
    const XTBottomNav = (await import('@/components/shell/XTBottomNav.vue')).default;
    wrapper = mount(XTBottomNav, {
      attachTo: document.body,
      global: { plugins: [i18n] },
      props: { drawerOpen: false },
    });
    await flushPromises();
    document
      .querySelector<HTMLButtonElement>('[data-testid="xt-bottomnav-menu"]')!
      .click();
    await flushPromises();
    expect(wrapper.emitted('open-menu')).toBeDefined();
    expect(pushMock).not.toHaveBeenCalled();
  });

  it('khi route là /cultivation → mục cultivation có active style (aria-current="page")', async () => {
    useRouteRef.path = '/cultivation';
    useRouteRef.fullPath = '/cultivation';
    const XTBottomNav = (await import('@/components/shell/XTBottomNav.vue')).default;
    wrapper = mount(XTBottomNav, {
      attachTo: document.body,
      global: { plugins: [i18n] },
      props: { drawerOpen: false },
    });
    await flushPromises();
    const btn = document.querySelector('[data-testid="xt-bottomnav-cultivation"]');
    expect(btn?.getAttribute('aria-current')).toBe('page');
  });
});

describe('XTMenuDrawer', () => {
  it('khi open=false → KHÔNG render aside', async () => {
    const XTMenuDrawer = (await import('@/components/shell/XTMenuDrawer.vue')).default;
    wrapper = mount(XTMenuDrawer, {
      attachTo: document.body,
      global: { plugins: [i18n] },
      props: { open: false },
    });
    await flushPromises();
    expect(document.querySelector('[data-testid="xt-menu-drawer"]')).toBeNull();
  });

  it('khi open=true → render drawer + ít nhất 1 nhóm + 1 item', async () => {
    const XTMenuDrawer = (await import('@/components/shell/XTMenuDrawer.vue')).default;
    wrapper = mount(XTMenuDrawer, {
      attachTo: document.body,
      global: { plugins: [i18n] },
      props: { open: true },
    });
    await flushPromises();
    expect(document.querySelector('[data-testid="xt-menu-drawer"]')).not.toBeNull();
    expect(
      document.querySelectorAll('[data-testid^="xt-menu-item-"]').length,
    ).toBeGreaterThan(3);
  });

  it('click close button → emit close', async () => {
    const XTMenuDrawer = (await import('@/components/shell/XTMenuDrawer.vue')).default;
    wrapper = mount(XTMenuDrawer, {
      attachTo: document.body,
      global: { plugins: [i18n] },
      props: { open: true },
    });
    await flushPromises();
    document
      .querySelector<HTMLButtonElement>('[data-testid="xt-menu-close"]')!
      .click();
    await flushPromises();
    expect(wrapper.emitted('close')).toBeDefined();
  });

  it('click một item nav → router.push đúng route + emit close', async () => {
    const XTMenuDrawer = (await import('@/components/shell/XTMenuDrawer.vue')).default;
    wrapper = mount(XTMenuDrawer, {
      attachTo: document.body,
      global: { plugins: [i18n] },
      props: { open: true },
    });
    await flushPromises();
    const item = document.querySelector<HTMLButtonElement>(
      '[data-testid="xt-menu-item-inventory"]',
    );
    expect(item).not.toBeNull();
    item!.click();
    await flushPromises();
    expect(pushMock).toHaveBeenCalledWith('/inventory');
    expect(wrapper.emitted('close')).toBeDefined();
  });
});

describe('XTBackButton', () => {
  it('khi history.length > 1 → router.back()', async () => {
    Object.defineProperty(window.history, 'length', {
      configurable: true,
      value: 5,
    });
    const XTBackButton = (await import('@/components/shell/XTBackButton.vue')).default;
    wrapper = mount(XTBackButton, {
      attachTo: document.body,
      global: { plugins: [i18n] },
    });
    await flushPromises();
    document
      .querySelector<HTMLButtonElement>('[data-testid="xt-back-button"]')!
      .click();
    await flushPromises();
    expect(backMock).toHaveBeenCalled();
    expect(pushMock).not.toHaveBeenCalled();
  });

  it('khi history.length <= 1 → fallback push(/dashboard)', async () => {
    Object.defineProperty(window.history, 'length', {
      configurable: true,
      value: 1,
    });
    const XTBackButton = (await import('@/components/shell/XTBackButton.vue')).default;
    wrapper = mount(XTBackButton, {
      attachTo: document.body,
      global: { plugins: [i18n] },
    });
    await flushPromises();
    document
      .querySelector<HTMLButtonElement>('[data-testid="xt-back-button"]')!
      .click();
    await flushPromises();
    expect(pushMock).toHaveBeenCalledWith('/dashboard');
  });
});

describe('XTPageHeader', () => {
  it('render title, subtitle, back button', async () => {
    const XTPageHeader = (await import('@/components/shell/XTPageHeader.vue')).default;
    wrapper = mount(XTPageHeader, {
      attachTo: document.body,
      global: { plugins: [i18n] },
      props: { title: 'Túi Đồ', subtitle: 'Quản lý vật phẩm' },
    });
    await flushPromises();
    expect(
      document.querySelector('[data-testid="xt-page-header"]'),
    ).not.toBeNull();
    expect(
      document.querySelector('[data-testid="xt-back-button"]'),
    ).not.toBeNull();
    expect(document.body.textContent).toContain('Túi Đồ');
    expect(document.body.textContent).toContain('Quản lý vật phẩm');
  });

  it('hideBack=true → KHÔNG render back button', async () => {
    const XTPageHeader = (await import('@/components/shell/XTPageHeader.vue')).default;
    wrapper = mount(XTPageHeader, {
      attachTo: document.body,
      global: { plugins: [i18n] },
      props: { title: 'X', hideBack: true },
    });
    await flushPromises();
    expect(document.querySelector('[data-testid="xt-back-button"]')).toBeNull();
  });
});

describe('XTIcon', () => {
  it('render <svg data-testid="xt-icon" data-name="home"/>', async () => {
    const XTIcon = (await import('@/components/xianxia/XTIcon.vue')).default;
    wrapper = mount(XTIcon, {
      attachTo: document.body,
      global: { plugins: [i18n] },
      props: { name: 'home' },
    });
    await flushPromises();
    const svg = document.querySelector('[data-testid="xt-icon"]');
    expect(svg).not.toBeNull();
    expect(svg?.getAttribute('data-name')).toBe('home');
  });

  it('icon không có trong map → fallback icon menu (không crash)', async () => {
    const XTIcon = (await import('@/components/xianxia/XTIcon.vue')).default;
    wrapper = mount(XTIcon, {
      attachTo: document.body,
      global: { plugins: [i18n] },
      props: { name: 'absolutely-unknown-icon' },
    });
    await flushPromises();
    expect(document.querySelector('[data-testid="xt-icon"]')).not.toBeNull();
  });
});

describe('xtNav config', () => {
  it('XT_BOTTOM_NAV có đúng 5 items + mục cuối là menu', async () => {
    const { XT_BOTTOM_NAV } = await import('@/lib/xtNav');
    expect(XT_BOTTOM_NAV.length).toBe(5);
    expect(XT_BOTTOM_NAV[4].action).toBe('menu');
    expect(XT_BOTTOM_NAV[4].to).toBeNull();
  });

  it('XT_NAV_GROUPS chứa group inventory + items có route', async () => {
    const { XT_NAV_GROUPS } = await import('@/lib/xtNav');
    const inv = XT_NAV_GROUPS.find((g) => g.key === 'inventory');
    expect(inv).toBeDefined();
    const item = inv!.items.find((i) => i.key === 'inventory');
    expect(item?.to).toBe('/inventory');
  });

  it('flattenNav() trả về list không rỗng và mọi item đều có route string', async () => {
    const { flattenNav } = await import('@/lib/xtNav');
    const all = flattenNav();
    expect(all.length).toBeGreaterThan(10);
    for (const item of all) {
      expect(typeof item.to).toBe('string');
      expect(item.to.length).toBeGreaterThan(0);
    }
  });
});
