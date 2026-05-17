import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { createMemoryHistory, createRouter, type Router } from 'vue-router';
import { createI18n, type I18n } from 'vue-i18n';
import { flushPromises } from '@vue/test-utils';
import XTHomeDashboard from '@/components/xianxia/XTHomeDashboard.vue';
import { useGameStore } from '@/stores/game';
import { useQuestStore } from '@/stores/quest';
import { useReputationGoalsStore } from '@/stores/reputationGoals';
import type { CharacterStatePayload } from '@xuantoi/shared';
import type { SectDetailView } from '@/api/sect';

// Phase 15.11 — XTHomeSectChatPanel hiện autonomous (load `chatHistory`
// + WS), mock chat API để test panel không phanh axios và stub WS bind.
vi.mock('@/api/chat', () => ({
  chatHistory: vi.fn().mockResolvedValue([]),
  chatSendSect: vi.fn().mockResolvedValue({
    id: 'm1', channel: 'SECT', scopeKey: 's', senderId: 'u',
    senderName: 'x', text: '', createdAt: new Date().toISOString(),
  }),
  chatSendWorld: vi.fn().mockResolvedValue({
    id: 'm1', channel: 'WORLD', scopeKey: 'world', senderId: 'u',
    senderName: 'x', text: '', createdAt: new Date().toISOString(),
  }),
}));
vi.mock('@/ws/client', () => ({
  on: vi.fn(() => () => undefined),
  connect: vi.fn(),
  resolveWsOrigin: vi.fn(() => 'http://localhost'),
}));

// Phase 15.16 (PR 626) — Home Data Correctness Pack. Mock các API/store
// được hydrate fail-soft trong `XTHomeDashboard.onMounted` để test không
// phanh axios. Mỗi `it` có thể override mock thông qua mock function trả về.
const listInventoryMock = vi.fn();
vi.mock('@/api/inventory', () => ({
  listInventory: () => listInventoryMock(),
}));
const getDailyLoginStatusMock = vi.fn();
vi.mock('@/api/dailyLogin', () => ({
  getDailyLoginStatus: () => getDailyLoginStatusMock(),
}));

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
      { path: '/sect', component: { template: '<div/>' } },
      { path: '/settings', component: { template: '<div/>' } },
    ],
  });
}

function buildI18n(): I18n {
  return createI18n({
    legacy: false,
    locale: 'vi',
    fallbackLocale: 'vi',
    missingWarn: false,
    fallbackWarn: false,
    messages: {
      vi: {
        chat: {
          title: 'Tâm Cảnh Đường',
          tab: { world: 'Thế Giới', sect: 'Tông Môn' },
          noSect: 'Chưa thuộc tông môn nào',
          noSectShort: 'Chưa thuộc tông môn nào.',
          empty: 'Chưa có lời nào…',
          placeholder: { world: 'Gửi thế giới…', sect: 'Gửi tông môn…' },
          send: 'Gửi',
          errors: {
            EMPTY_TEXT: 'Nội dung trống.',
            TEXT_TOO_LONG: 'Tối đa 200 ký tự.',
            RATE_LIMITED: 'Nói chậm thôi đạo hữu.',
            NO_SECT: 'Bạn chưa thuộc tông môn nào.',
            NO_CHARACTER: 'Chưa có nhân vật.',
            UNKNOWN: 'Không gửi được, thử lại.',
          },
        },
      },
    },
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
  let i18n: I18n;

  beforeEach(() => {
    setActivePinia(createPinia());
    router = buildRouter();
    i18n = buildI18n();
    // Phase 15.16 — default fail-soft (rỗng) cho mock async hydrate.
    listInventoryMock.mockReset();
    listInventoryMock.mockResolvedValue([]);
    getDailyLoginStatusMock.mockReset();
    getDailyLoginStatusMock.mockResolvedValue(null);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('embedded + desktop: render hero / stat tiles / feature grid / panels', async () => {
    setViewport(1280);
    const w = mount(XTHomeDashboard, {
      props: { chrome: 'embedded' },
      global: { plugins: [router, i18n] },
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
      global: { plugins: [router, i18n] },
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
      global: { plugins: [router, i18n] },
    });
    await router.isReady();
    const html = w.html();
    expect(html).not.toMatch(/[\u4e00-\u9fff]/);
  });

  it('standalone + mobile: render mobile header + bottom nav + icon grid', async () => {
    setViewport(420);
    const w = mount(XTHomeDashboard, {
      props: { chrome: 'standalone' },
      global: { plugins: [router, i18n] },
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
      global: { plugins: [router, i18n] },
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
      global: { plugins: [router, i18n] },
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
      global: { plugins: [router, i18n] },
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
      global: { plugins: [router, i18n] },
    });
    await router.isReady();
    const text = w.text();
    expect(text).toContain('9.001');
    expect(text).toContain('777');
    expect(text).toContain('88');
    expect(text).not.toContain('Thiên Vân');
    expect(text).not.toContain('12.568.890');
  });

  // ─── Phase 15.16 (PR 626) — Home Data Correctness Pack ─────────────
  //
  // Verify rằng `XTHomeDashboard` không bao giờ lộ các giá trị mock
  // gameplay cũ (recentQuests / equipmentSlots / inventoryPanel /
  // dailyReward) ra player-facing /home và xử lý đúng Tử tinh / Danh
  // vọng (ẩn khi chưa có nguồn data thật, không giả 0 gây hiểu nhầm).

  it('embedded + desktop: KHÔNG lộ mock gameplay cũ (Đột Phá Đại Thừa / 86/120 / 2.156.780 / 6/10 / +10 / +11 / +12)', async () => {
    setViewport(1280);
    const game = useGameStore();
    game.character = buildCharacter({ name: 'Verifier' });
    const w = mount(XTHomeDashboard, {
      props: { chrome: 'embedded' },
      global: { plugins: [router, i18n] },
    });
    await router.isReady();
    await flushPromises();
    const text = w.text();
    // Recent quest mock entries.
    expect(text).not.toContain('Đột Phá Đại Thừa');
    expect(text).not.toContain('Linh Thú Xuất Thế');
    expect(text).not.toContain('Nhiệm Vụ Tông Môn');
    expect(text).not.toContain('Tu Luyện Hằng Ngày');
    // Inventory panel mock numbers.
    expect(text).not.toContain('86/120');
    expect(text).not.toContain('2.156.780');
    // Equipment slot plus mock values.
    expect(text).not.toContain('+10');
    expect(text).not.toContain('+11');
    expect(text).not.toContain('+12');
    // Daily reward mock counter.
    expect(text).not.toContain('6/10');
  });

  it('embedded + desktop: empty quest store → quest panel render empty state', async () => {
    setViewport(1280);
    const game = useGameStore();
    game.character = buildCharacter();
    const quest = useQuestStore();
    quest.quests = [];
    quest.loaded = true;
    const w = mount(XTHomeDashboard, {
      props: { chrome: 'embedded' },
      global: { plugins: [router, i18n] },
    });
    await router.isReady();
    await flushPromises();
    expect(w.find('[data-testid="home-quest-panel-empty"]').exists()).toBe(true);
    expect(w.text()).toContain('Chưa có nhiệm vụ');
  });

  it('embedded + desktop: empty inventory → KHÔNG hiện gear power "2.156.780" hoặc capacity "86/120"', async () => {
    setViewport(1280);
    listInventoryMock.mockResolvedValueOnce([]);
    const game = useGameStore();
    game.character = buildCharacter();
    const w = mount(XTHomeDashboard, {
      props: { chrome: 'embedded' },
      global: { plugins: [router, i18n] },
    });
    await router.isReady();
    await flushPromises();
    const text = w.text();
    expect(text).not.toContain('2.156.780');
    expect(text).not.toContain('86/120');
    // Inventory panel exists.
    expect(w.find('[data-testid="home-inventory-panel"]').exists()).toBe(true);
    // Capacity bar / gear-power test-ids should be absent (component ẩn
    // khi info.gearPower rỗng + capacity.total === 0).
    expect(w.find('[data-testid="home-inventory-panel-gear-power"]').exists()).toBe(false);
    expect(w.find('[data-testid="home-inventory-panel-capacity"]').exists()).toBe(false);
  });

  it('embedded + desktop: chưa có daily login status → KHÔNG render reward card "Phúc lợi hôm nay" với "6/10"', async () => {
    setViewport(1280);
    getDailyLoginStatusMock.mockResolvedValueOnce(null);
    const game = useGameStore();
    game.character = buildCharacter();
    const w = mount(XTHomeDashboard, {
      props: { chrome: 'embedded' },
      global: { plugins: [router, i18n] },
    });
    await router.isReady();
    await flushPromises();
    const text = w.text();
    expect(text).not.toContain('6/10');
    // Hero reward card test-id absent khi reward = null.
    expect(w.find('[data-testid="home-hero-reward"]').exists()).toBe(false);
  });

  it('standalone + desktop: KHÔNG có Tử tinh ở topbar/strip + KHÔNG render Danh vọng "0" mặc định', async () => {
    setViewport(1440);
    const game = useGameStore();
    game.character = buildCharacter({ name: 'Verifier' });
    const w = mount(XTHomeDashboard, {
      props: { chrome: 'standalone' },
      global: { plugins: [router, i18n] },
    });
    await router.isReady();
    await flushPromises();
    const text = w.text();
    // Tử tinh đã hide hẳn (BE chưa có field).
    expect(text).not.toContain('Tử tinh');
    // Danh vọng chỉ render khi reputation store đã loaded — chưa load
    // (test này không bật) → ẩn, KHÔNG hiển thị "0" giả.
    expect(text).not.toContain('Danh vọng');
  });

  it('standalone + desktop: reputation store loaded → Danh vọng hiện đúng totalReputation thật', async () => {
    setViewport(1440);
    const game = useGameStore();
    game.character = buildCharacter({ name: 'Verifier' });
    const rep = useReputationGoalsStore();
    rep.reputation = [
      // 2 row reputation, sum = 1234.
      // Cast `as any` để bỏ qua đầy đủ ReputationGroupDef (ko cần cho test).
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      { group: 'TONG_MON', score: 1000, dailyGain: 0, dailyCap: 1000, lastGainedAt: null, def: {} as any },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      { group: 'XA_HOI', score: 234, dailyGain: 0, dailyCap: 1000, lastGainedAt: null, def: {} as any },
    ];
    rep.loaded = true;
    const w = mount(XTHomeDashboard, {
      props: { chrome: 'standalone' },
      global: { plugins: [router, i18n] },
    });
    await router.isReady();
    await flushPromises();
    const text = w.text();
    expect(text).toContain('Danh vọng');
    // Sandbox Node ICU không bundle `vi-VN` → fallback locale có thể trả
    // separator `.` hoặc `,` tùy ICU version. Cả hai đều chấp nhận.
    expect(text).toMatch(/1[.,]234/);
    expect(text).not.toContain('Tử tinh');
    // Đảm bảo KHÔNG còn fake "26.540".
    expect(text).not.toContain('26.540');
    expect(text).not.toContain('26,540');
  });

  it('standalone + mobile: empty inventory + chưa daily login → KHÔNG lộ "+10/+11/+12" / "6/10"', async () => {
    setViewport(420);
    listInventoryMock.mockResolvedValueOnce([]);
    getDailyLoginStatusMock.mockResolvedValueOnce(null);
    const game = useGameStore();
    game.character = buildCharacter();
    const w = mount(XTHomeDashboard, {
      props: { chrome: 'standalone' },
      global: { plugins: [router, i18n] },
    });
    await router.isReady();
    await flushPromises();
    const text = w.text();
    expect(text).not.toContain('+10');
    expect(text).not.toContain('+11');
    expect(text).not.toContain('+12');
    expect(text).not.toContain('6/10');
    expect(text).not.toContain('86/120');
    expect(text).not.toContain('2.156.780');
  });

  it('embedded + desktop: inventory store có 2 trang bị + 1 free → equipment slots render plus thật theo refineLevel', async () => {
    setViewport(1280);
    listInventoryMock.mockResolvedValueOnce([
      {
        id: 'inv-1',
        itemKey: 'so_kiem',
        qty: 1,
        equippedSlot: 'WEAPON',
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        item: { key: 'so_kiem', name: 'Sơ Kiếm', kind: 'WEAPON' } as any,
        sockets: [],
        refineLevel: 4,
        substats: [],
        enchantElement: null,
        enchantLevel: 0,
        locked: false,
        createdAt: new Date().toISOString(),
      },
      {
        id: 'inv-2',
        itemKey: 'kim_giap',
        qty: 1,
        equippedSlot: 'ARMOR',
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        item: { key: 'kim_giap', name: 'Kim Giáp', kind: 'ARMOR' } as any,
        sockets: [],
        refineLevel: 2,
        substats: [],
        enchantElement: null,
        enchantLevel: 0,
        locked: false,
        createdAt: new Date().toISOString(),
      },
      {
        id: 'inv-3',
        itemKey: 'huyet_chi_dan',
        qty: 5,
        equippedSlot: null,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        item: { key: 'huyet_chi_dan', name: 'Huyết Chỉ Đan', kind: 'PILL' } as any,
        sockets: [],
        refineLevel: 0,
        substats: [],
        enchantElement: null,
        enchantLevel: 0,
        locked: false,
        createdAt: new Date().toISOString(),
      },
    ]);
    const game = useGameStore();
    game.character = buildCharacter();
    const w = mount(XTHomeDashboard, {
      props: { chrome: 'embedded' },
      global: { plugins: [router, i18n] },
    });
    await router.isReady();
    await flushPromises();
    const text = w.text();
    // Plus values từ refineLevel thật (không phải 10/11/12 mock).
    expect(text).toContain('+4');
    expect(text).toContain('+2');
    expect(text).not.toContain('+10');
    expect(text).not.toContain('+11');
    expect(text).not.toContain('+12');
  });
});
