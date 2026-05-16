import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { createMemoryHistory, createRouter, type Router } from 'vue-router';
import XTHomeDashboard from '@/components/xianxia/XTHomeDashboard.vue';
import { useGameStore } from '@/stores/game';
import type { CharacterStatePayload } from '@xuantoi/shared';
import type { SectDetailView } from '@/api/sect';

/**
 * Cửu Thiên Mộng UI-3.2 — `XTHomeDashboard` composer.
 *
 * Cover:
 *   - render được khi nhúng vào AppShell (`chrome="embedded"`).
 *   - render đủ 4 vùng test-id chính (hero / stat / feature / panels).
 *   - desktop (>= 1024px): hiện feature card "Tu luyện", "Boss & Phụ bản",
 *     "PvP & Đấu trường", "Tông môn", "Nhiệm vụ", "Cửa hàng".
 *   - mobile (< 768px) khi `chrome="standalone"`: hiện bottom-nav + mobile
 *     header và icon grid.
 *   - không có ký tự Hán nào trong DOM output.
 *   - Phase 15.10 (real data wire): khi `useGameStore` rỗng → KHÔNG lộ
 *     mock VIP "Thiên Vân" / "Thanh Vân Tông" / "12.568.890" / "8.745" /
 *     "Đại Thừa Kỳ Bậc 9". Khi store có character + sect → render đúng tên
 *     thật + linh thạch / tiên ngọc / tông môn thật.
 */
function buildCharacter(overrides: Partial<CharacterStatePayload> = {}): CharacterStatePayload {
  return {
    id: 'char-test-1',
    name: 'Trần Test',
    realmKey: 'luyen_khi',
    realmStage: 3,
    level: 12,
    exp: '4200',
    expNext: '8000',
    hp: 100,
    hpMax: 120,
    mp: 80,
    mpMax: 100,
    stamina: 50,
    staminaMax: 60,
    power: 4242,
    spirit: 200,
    speed: 80,
    luck: 25,
    linhThach: '999',
    tienNgoc: 7,
    tienNgocKhoa: 0,
    cultivating: false,
    sectId: null,
    sectKey: null,
    role: 'PLAYER',
    banned: false,
    tribulationCooldownAt: null,
    taoMaUntil: null,
    spiritualRootGrade: null,
    primaryElement: null,
    secondaryElements: [],
    rootPurity: 100,
    title: null,
    bodyRealmKey: 'phai_pham',
    bodyRealmName: 'Phàm Thân',
    bodyStage: 1,
    bodyExp: '0',
    bodyExpNext: '100',
    bodyRate: 0,
    bodyCultivating: false,
    bodyInjuryUntil: null,
    physiqueKey: null,
    bodyStatBonus: { hpMax: 0, power: 0, def: 0, staminaMax: 0, bossDamageReduction: 0 },
    ...overrides,
  };
}

function buildSect(overrides: Partial<SectDetailView> = {}): SectDetailView {
  return {
    id: 'sect-test-1',
    name: 'Hoa Sen Tông Test',
    description: 'unit test sect',
    level: 4,
    treasuryLinhThach: '0',
    memberCount: 18,
    leaderName: 'Sư phụ Test',
    createdAt: new Date().toISOString(),
    members: [],
    isMyMember: true,
    isMyLeader: false,
    ...overrides,
  };
}

function buildRouter(): Router {
  return createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', component: { template: '<div/>' } },
      { path: '/cultivation', component: { template: '<div/>' } },
      { path: '/missions', component: { template: '<div/>' } },
      { path: '/inventory', component: { template: '<div/>' } },
      { path: '/world', component: { template: '<div/>' } },
      { path: '/wallet', component: { template: '<div/>' } },
      { path: '/mail', component: { template: '<div/>' } },
      { path: '/settings', component: { template: '<div/>' } },
    ],
  });
}

function setViewport(width: number): void {
  Object.defineProperty(window, 'innerWidth', { value: width, configurable: true });
  Object.defineProperty(window, 'innerHeight', { value: 900, configurable: true });
  // jsdom matchMedia stub — only `(min-width: 1024px)` query is used.
  window.matchMedia = vi.fn().mockImplementation((query: string) => {
    const minMatch = query.match(/min-width:\s*(\d+)px/);
    const matches = minMatch ? width >= Number(minMatch[1]) : false;
    return {
      matches,
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    } as unknown as MediaQueryList;
  });
}

describe('XTHomeDashboard', () => {
  let router: Router;

  beforeEach(() => {
    setActivePinia(createPinia());
    router = buildRouter();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('embedded + desktop: render hero / stat tiles / feature grid / panels', async () => {
    setViewport(1280);
    const w = mount(XTHomeDashboard, {
      props: { chrome: 'embedded' },
      global: { plugins: [router] },
    });
    await router.isReady();
    expect(w.find('[data-testid="home-dashboard"]').exists()).toBe(true);
    expect(w.find('[data-testid="home-hero"]').exists()).toBe(true);
    expect(w.find('[data-testid="home-stat-tiles"]').exists()).toBe(true);
    expect(w.find('[data-testid="home-feature-grid"]').exists()).toBe(true);
    expect(w.find('[data-testid="home-quest-panel"]').exists()).toBe(true);
    expect(w.find('[data-testid="home-inventory-panel"]').exists()).toBe(true);
    expect(w.find('[data-testid="home-sect-chat-panel"]').exists()).toBe(true);
  });

  it('embedded + desktop: hiển thị các chức năng game chính', async () => {
    setViewport(1280);
    const w = mount(XTHomeDashboard, {
      props: { chrome: 'embedded' },
      global: { plugins: [router] },
    });
    await router.isReady();
    const text = w.text();
    expect(text).toContain('Xuân Tôi');
    expect(text).toContain('Cửu Thiên Mộng');
    expect(text).toContain('Tu luyện');
    expect(text).toContain('Boss & Phụ bản');
    expect(text).toContain('PvP & Đấu trường');
    expect(text).toContain('Tông môn');
    expect(text).toContain('Nhiệm vụ');
    expect(text).toContain('Cửa hàng');
  });

  it('embedded + desktop: không có ký tự Hán nào trong DOM', async () => {
    setViewport(1280);
    const w = mount(XTHomeDashboard, {
      props: { chrome: 'embedded' },
      global: { plugins: [router] },
    });
    await router.isReady();
    const html = w.html();
    expect(html).not.toMatch(/[\u4e00-\u9fff]/);
  });

  it('standalone + mobile: render mobile header + bottom nav + icon grid', async () => {
    setViewport(420);
    const w = mount(XTHomeDashboard, {
      props: { chrome: 'standalone' },
      global: { plugins: [router] },
    });
    await router.isReady();
    expect(w.find('[data-testid="home-dashboard"]').exists()).toBe(true);
    expect(w.find('[data-testid="home-bottom-nav"]').exists()).toBe(true);
    expect(w.find('[data-testid="home-hero-mobile"]').exists()).toBe(true);
    expect(w.find('[data-testid="home-feature-grid"]').exists()).toBe(true);
  });

  it('standalone + desktop: render sidebar chrome', async () => {
    setViewport(1440);
    const w = mount(XTHomeDashboard, {
      props: { chrome: 'standalone' },
      global: { plugins: [router] },
    });
    await router.isReady();
    expect(w.find('[data-testid="home-sidebar"]').exists()).toBe(true);
    expect(w.find('[data-testid="home-bottom-nav"]').exists()).toBe(false);
  });

  // ─── Phase 15.10 — Real player data wiring ─────────────────────────
  //
  // Đảm bảo dashboard không bao giờ lộ mock VIP "Thiên Vân / Thanh Vân
  // Tông / 12.568.890" cho user thật, và khi store có character/sect
  // thật thì hiện đúng tên người chơi + linh thạch / tiên ngọc / tông.

  it('standalone + desktop: store rỗng → empty state, không lộ mock VIP', async () => {
    setViewport(1440);
    const w = mount(XTHomeDashboard, {
      props: { chrome: 'standalone' },
      global: { plugins: [router] },
    });
    await router.isReady();
    const text = w.text();
    expect(text).not.toContain('Thiên Vân');
    expect(text).not.toContain('Thanh Vân Tông');
    expect(text).not.toContain('12.568.890');
    expect(text).not.toContain('8.745');
    expect(text).not.toContain('Đại Thừa Kỳ Bậc 9');
    // Empty sect state
    expect(text).toContain('Chưa gia nhập tông môn');
  });

  it('standalone + desktop: store có character/sect → render dữ liệu thật', async () => {
    setViewport(1440);
    const game = useGameStore();
    game.character = buildCharacter({
      name: 'Lý Mộng Test',
      linhThach: '321',
      tienNgoc: 12,
    });
    game.currentSect = buildSect({ name: 'Bích Vân Tông Test', level: 7, memberCount: 42 });
    game.unreadMail = 5;
    const w = mount(XTHomeDashboard, {
      props: { chrome: 'standalone' },
      global: { plugins: [router] },
    });
    await router.isReady();
    const text = w.text();
    expect(text).toContain('Lý Mộng Test');
    expect(text).toContain('Bích Vân Tông Test');
    expect(text).toContain('321');
    // Còn lại tuyệt đối KHÔNG lộ mock VIP nào
    expect(text).not.toContain('Thiên Vân');
    expect(text).not.toContain('Thanh Vân Tông');
    expect(text).not.toContain('12.568.890');
  });

  it('embedded + desktop: store có character → stat tiles đọc store (power/linh thạch/tiên ngọc)', async () => {
    // Lưu ý: `chrome="embedded"` được dùng khi `AppShell` đã render
    // topbar/mobile header riêng — `XTHomeDashboard` chỉ render hero +
    // stat tiles + feature grid + panels (KHÔNG render topbar/header).
    // Vì vậy ở mode này tên người chơi không xuất hiện qua dashboard,
    // còn linh thạch / tiên ngọc / lực chiến phải hiện đúng store.
    setViewport(1280);
    const game = useGameStore();
    game.character = buildCharacter({
      name: 'Hà Thiên Test',
      power: 9001,
      linhThach: '777',
      tienNgoc: 88,
    });
    const w = mount(XTHomeDashboard, {
      props: { chrome: 'embedded' },
      global: { plugins: [router] },
    });
    await router.isReady();
    const text = w.text();
    expect(text).toContain('9.001');
    expect(text).toContain('777');
    expect(text).toContain('88');
    expect(text).not.toContain('Thiên Vân');
    expect(text).not.toContain('12.568.890');
  });
});
