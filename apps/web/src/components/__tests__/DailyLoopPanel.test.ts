import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { createMemoryHistory, createRouter } from 'vue-router';
import { createI18n } from 'vue-i18n';
import DailyLoopPanel from '@/components/DailyLoopPanel.vue';
import { useGameStore } from '@/stores/game';
import { useBadgesStore } from '@/stores/badges';
import { useQuestStore } from '@/stores/quest';
import type { CharacterStatePayload } from '@xuantoi/shared';

// Mock dailyLogin API
const getDailyLoginStatusMock = vi.fn();
vi.mock('@/api/dailyLogin', () => ({
  getDailyLoginStatus: () => getDailyLoginStatusMock(),
}));

function buildCharacter(overrides: Partial<CharacterStatePayload> = {}): CharacterStatePayload {
  return {
    id: 'c1',
    name: 'Test',
    realmKey: 'luyen_khi',
    realmStage: 3,
    level: 10,
    exp: '100',
    expNext: '500',
    hp: 80,
    hpMax: 100,
    mp: 40,
    mpMax: 60,
    stamina: 50,
    staminaMax: 60,
    power: 1000,
    spirit: 100,
    speed: 50,
    luck: 20,
    linhThach: '500',
    tienNgoc: 5,
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

function buildRouter() {
  return createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', component: { template: '<div/>' } },
      { path: '/home', component: { template: '<div/>' } },
      { path: '/cultivation', component: { template: '<div/>' } },
      { path: '/missions', component: { template: '<div/>' } },
      { path: '/boss', component: { template: '<div/>' } },
      { path: '/mail', component: { template: '<div/>' } },
      { path: '/breakthrough', component: { template: '<div/>' } },
      { path: '/sect-war', component: { template: '<div/>' } },
    ],
  });
}

function buildI18n() {
  return createI18n({
    legacy: false,
    locale: 'vi',
    fallbackLocale: 'vi',
    missingWarn: false,
    fallbackWarn: false,
    messages: { vi: {} },
  });
}

describe('DailyLoopPanel', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    getDailyLoginStatusMock.mockReset();
    getDailyLoginStatusMock.mockResolvedValue(null);
  });

  it('renders nothing when character is null', async () => {
    const router = buildRouter();
    const i18n = buildI18n();
    const w = mount(DailyLoopPanel, {
      global: { plugins: [router, i18n] },
    });
    await router.isReady();
    await flushPromises();
    expect(w.find('[data-testid="daily-loop-panel"]').exists()).toBe(false);
  });

  it('renders cultivation activity when character exists and not cultivating', async () => {
    const router = buildRouter();
    const i18n = buildI18n();
    const game = useGameStore();
    game.character = buildCharacter({ cultivating: false });
    const w = mount(DailyLoopPanel, {
      global: { plugins: [router, i18n] },
    });
    await router.isReady();
    await flushPromises();
    expect(w.find('[data-testid="daily-loop-panel"]').exists()).toBe(true);
    expect(w.find('[data-testid="daily-loop-item-cultivate"]').exists()).toBe(true);
  });

  it('shows cultivation as active when character is cultivating', async () => {
    const router = buildRouter();
    const i18n = buildI18n();
    const game = useGameStore();
    game.character = buildCharacter({ cultivating: true });
    const w = mount(DailyLoopPanel, {
      global: { plugins: [router, i18n] },
    });
    await router.isReady();
    await flushPromises();
    const item = w.find('[data-testid="daily-loop-item-cultivate"]');
    expect(item.exists()).toBe(true);
    expect(item.classes()).toContain('xt-daily-loop__item--active');
  });

  it('shows daily login as claimable when canClaimToday=true', async () => {
    getDailyLoginStatusMock.mockResolvedValueOnce({
      todayDateLocal: '2026-05-17',
      canClaimToday: true,
      currentStreak: 3,
      nextRewardLinhThach: '500',
    });
    const router = buildRouter();
    const i18n = buildI18n();
    const game = useGameStore();
    game.character = buildCharacter();
    const w = mount(DailyLoopPanel, {
      global: { plugins: [router, i18n] },
    });
    await router.isReady();
    await flushPromises();
    const item = w.find('[data-testid="daily-loop-item-daily-login"]');
    expect(item.exists()).toBe(true);
    expect(item.classes()).toContain('xt-daily-loop__item--claimable');
  });

  it('shows daily login as completed when already claimed', async () => {
    getDailyLoginStatusMock.mockResolvedValueOnce({
      todayDateLocal: '2026-05-17',
      canClaimToday: false,
      currentStreak: 4,
      nextRewardLinhThach: '600',
    });
    const router = buildRouter();
    const i18n = buildI18n();
    const game = useGameStore();
    game.character = buildCharacter();
    const w = mount(DailyLoopPanel, {
      global: { plugins: [router, i18n] },
    });
    await router.isReady();
    await flushPromises();
    const item = w.find('[data-testid="daily-loop-item-daily-login"]');
    expect(item.exists()).toBe(true);
    expect(item.classes()).toContain('xt-daily-loop__item--completed');
    // No Go button for completed items
    expect(w.find('[data-testid="daily-loop-go-daily-login"]').exists()).toBe(false);
  });

  it('shows boss activity when bossActive is true', async () => {
    const router = buildRouter();
    const i18n = buildI18n();
    const game = useGameStore();
    game.character = buildCharacter();
    const badges = useBadgesStore();
    // Manually set actions to trigger bossActive
    badges.actions = [{ key: 'BOSS_ACTIVE', priority: 2, params: {}, route: '/boss' }];
    const w = mount(DailyLoopPanel, {
      global: { plugins: [router, i18n] },
    });
    await router.isReady();
    await flushPromises();
    expect(w.find('[data-testid="daily-loop-item-boss"]').exists()).toBe(true);
  });

  it('shows mail activity when unreadMail > 0', async () => {
    const router = buildRouter();
    const i18n = buildI18n();
    const game = useGameStore();
    game.character = buildCharacter();
    game.unreadMail = 5;
    const w = mount(DailyLoopPanel, {
      global: { plugins: [router, i18n] },
    });
    await router.isReady();
    await flushPromises();
    expect(w.find('[data-testid="daily-loop-item-mail"]').exists()).toBe(true);
  });

  it('does NOT show mail activity when unreadMail = 0', async () => {
    const router = buildRouter();
    const i18n = buildI18n();
    const game = useGameStore();
    game.character = buildCharacter();
    game.unreadMail = 0;
    const w = mount(DailyLoopPanel, {
      global: { plugins: [router, i18n] },
    });
    await router.isReady();
    await flushPromises();
    expect(w.find('[data-testid="daily-loop-item-mail"]').exists()).toBe(false);
  });

  it('shows sect activity when currentSect is set', async () => {
    const router = buildRouter();
    const i18n = buildI18n();
    const game = useGameStore();
    game.character = buildCharacter();
    game.currentSect = {
      id: 's1',
      name: 'Test Sect',
      description: '',
      level: 3,
      treasuryLinhThach: '0',
      memberCount: 10,
      leaderName: 'Leader',
      createdAt: new Date().toISOString(),
      members: [],
      isMyMember: true,
      isMyLeader: false,
    };
    const w = mount(DailyLoopPanel, {
      global: { plugins: [router, i18n] },
    });
    await router.isReady();
    await flushPromises();
    expect(w.find('[data-testid="daily-loop-item-sect"]').exists()).toBe(true);
  });

  it('does NOT show sect activity when currentSect is null', async () => {
    const router = buildRouter();
    const i18n = buildI18n();
    const game = useGameStore();
    game.character = buildCharacter();
    game.currentSect = null;
    const w = mount(DailyLoopPanel, {
      global: { plugins: [router, i18n] },
    });
    await router.isReady();
    await flushPromises();
    expect(w.find('[data-testid="daily-loop-item-sect"]').exists()).toBe(false);
  });

  it('shows breakthrough activity when breakthroughReady', async () => {
    const router = buildRouter();
    const i18n = buildI18n();
    const game = useGameStore();
    game.character = buildCharacter();
    const badges = useBadgesStore();
    badges.actions = [{ key: 'BREAKTHROUGH_READY', priority: 1, params: {}, route: '/breakthrough' }];
    const w = mount(DailyLoopPanel, {
      global: { plugins: [router, i18n] },
    });
    await router.isReady();
    await flushPromises();
    const item = w.find('[data-testid="daily-loop-item-breakthrough"]');
    expect(item.exists()).toBe(true);
    expect(item.classes()).toContain('xt-daily-loop__item--claimable');
  });

  it('Go button navigates to correct route', async () => {
    const router = buildRouter();
    const i18n = buildI18n();
    const game = useGameStore();
    game.character = buildCharacter({ cultivating: false });
    const pushSpy = vi.spyOn(router, 'push');
    const w = mount(DailyLoopPanel, {
      global: { plugins: [router, i18n] },
    });
    await router.isReady();
    await flushPromises();
    const goBtn = w.find('[data-testid="daily-loop-go-cultivate"]');
    expect(goBtn.exists()).toBe(true);
    await goBtn.trigger('click');
    expect(pushSpy).toHaveBeenCalledWith('/cultivation');
  });

  it('shows activity count badge in header', async () => {
    getDailyLoginStatusMock.mockResolvedValueOnce({
      todayDateLocal: '2026-05-17',
      canClaimToday: true,
      currentStreak: 1,
      nextRewardLinhThach: '200',
    });
    const router = buildRouter();
    const i18n = buildI18n();
    const game = useGameStore();
    game.character = buildCharacter({ cultivating: true });
    game.unreadMail = 3;
    const badges = useBadgesStore();
    badges.actions = [{ key: 'BOSS_ACTIVE', priority: 2, params: {}, route: '/boss' }];
    const w = mount(DailyLoopPanel, {
      global: { plugins: [router, i18n] },
    });
    await router.isReady();
    await flushPromises();
    // Count should show at least 4: daily-login + cultivate + boss + mail
    const countEl = w.find('.xt-daily-loop__count');
    expect(countEl.exists()).toBe(true);
    const count = Number(countEl.text());
    expect(count).toBeGreaterThanOrEqual(4);
  });
});
