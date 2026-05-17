import {
  createRouter,
  createWebHistory,
  type NavigationGuardWithThis,
  type RouteRecordRaw,
} from 'vue-router';
import type { FeatureFlagKey } from '@xuantoi/shared';

/**
 * Beta safe integration sweep — Phase 45.0 finish.
 *
 * Mid-priority flag gate. Khi flag OFF, redirect về `/home` thay vì
 * crash route. Guard `await ensureLoaded()` để fail-closed sau khi store
 * đã hydrate; nếu fetch lỗi, store fallback ON (fail-open) — UI vẫn
 * giữ behavior hiện tại. Server vẫn enforce `FEATURE_DISABLED` cuối.
 *
 * Lazy import store để tránh circular import giữa router ↔ pinia init.
 */
function featureFlagGuard(
  flag: FeatureFlagKey,
): NavigationGuardWithThis<undefined> {
  return async (_to, _from, next) => {
    const { useFeatureFlagsStore } = await import('@/stores/featureFlags');
    const store = useFeatureFlagsStore();
    try {
      await store.ensureLoaded();
    } catch {
      // Fail-open: hydrate lỗi → cho qua, server vẫn gate cuối.
    }
    if (store.isDisabled(flag)) {
      next({ name: 'home', replace: true });
      return;
    }
    next();
  };
}

// `XianxiaPlaceholderView.vue` is intentionally kept in the repo as a
// fallback for future routes-under-development. Earlier `celestialPlaceholder`
// factory wiring (used to mount `/character`, `/cultivation`, `/notifications`
// onto that view) was removed when those paths were redirected to live
// gameplay views (`/dashboard`, `/cultivation-method-v2`, `/mail`). If a new
// placeholder is ever needed, re-add the factory or inline the import.

const routes: RouteRecordRaw[] = [
  { path: '/', redirect: '/home' },
  {
    path: '/auth',
    name: 'auth',
    component: () => import('@/views/AuthView.vue'),
    meta: { public: true },
  },
  {
    path: '/auth/forgot-password',
    name: 'forgot-password',
    component: () => import('@/views/ForgotPasswordView.vue'),
    meta: { public: true },
  },
  {
    path: '/auth/reset-password',
    name: 'reset-password',
    component: () => import('@/views/ResetPasswordView.vue'),
    meta: { public: true },
  },
  {
    path: '/home',
    name: 'home',
    component: () => import('@/views/HomeView.vue'),
  },
  // Phase 15.9 — `/cultivation` placeholder still redirects (cultivation hub
  // PR is the next roadmap item). `/notifications` redirect lives further
  // below. `/character` was a redirect from PR #619 but is now a real
  // player-profile page (Phase 15.14).
  {
    path: '/character',
    name: 'character',
    component: () => import('@/views/CharacterView.vue'),
  },
  // Phase 15.15 (PR #625) — `/cultivation` is now a real read-only hub
  // (`CultivationHubView`) that aggregates qi/body/method/root/breakthrough
  // progression and surfaces deep links to the dedicated views. Replaces
  // the legacy `redirect: '/cultivation-method-v2'` placeholder kept since
  // PR #619/#622 — see `docs/AI_HANDOFF_REPORT.md`.
  {
    path: '/cultivation',
    name: 'cultivation',
    component: () => import('@/views/CultivationHubView.vue'),
  },
  {
    path: '/onboarding',
    name: 'onboarding',
    component: () => import('@/views/OnboardingView.vue'),
  },
  {
    path: '/dungeon',
    name: 'dungeon',
    component: () => import('@/views/DungeonView.vue'),
  },
  {
    path: '/dungeon-run',
    name: 'dungeon-run',
    component: () => import('@/views/DungeonRunView.vue'),
  },
  {
    path: '/roguelike',
    name: 'roguelike',
    component: () => import('@/views/RoguelikeView.vue'),
  },
  {
    path: '/roguelike-realms',
    name: 'roguelike-realms',
    redirect: '/roguelike',
  },
  {
    path: '/seasons',
    name: 'seasons',
    component: () => import('@/views/SeasonsView.vue'),
  },
  {
    path: '/story-dungeons',
    name: 'story-dungeons',
    component: () => import('@/views/StoryDungeonView.vue'),
  },
  {
    path: '/inventory',
    name: 'inventory',
    component: () => import('@/views/InventoryView.vue'),
  },
  {
    path: '/equipment',
    name: 'equipment',
    component: () => import('@/views/EquipmentView.vue'),
  },
  {
    path: '/loadouts',
    name: 'loadouts',
    component: () => import('@/views/LoadoutView.vue'),
  },
  {
    path: '/notification-settings',
    name: 'notification-settings',
    component: () => import('@/views/NotificationSettingsView.vue'),
  },
  {
    path: '/market',
    name: 'market',
    component: () => import('@/views/MarketView.vue'),
  },
  {
    path: '/auction',
    name: 'auction',
    redirect: '/market',
    beforeEnter: featureFlagGuard('AUCTION_HOUSE_ENABLED'),
  },
  {
    path: '/shop',
    name: 'shop',
    component: () => import('@/views/ShopView.vue'),
  },
  {
    path: '/sect',
    name: 'sect',
    component: () => import('@/views/SectView.vue'),
  },
  {
    path: '/sect-war',
    name: 'sect-war',
    component: () => import('@/views/SectWarView.vue'),
  },
  {
    path: '/territory',
    name: 'territory',
    component: () => import('@/views/TerritoryView.vue'),
  },
  {
    path: '/boss',
    name: 'boss',
    component: () => import('@/views/BossView.vue'),
  },
  {
    path: '/missions',
    name: 'missions',
    component: () => import('@/views/MissionView.vue'),
  },
  {
    path: '/mail',
    name: 'mail',
    component: () => import('@/views/MailView.vue'),
  },
  {
    path: '/giftcode',
    name: 'giftcode',
    component: () => import('@/views/GiftCodeView.vue'),
  },
  {
    path: '/topup',
    name: 'topup',
    component: () => import('@/views/TopupView.vue'),
  },
  {
    path: '/monetization',
    name: 'monetization',
    component: () => import('@/views/MonetizationView.vue'),
  },
  {
    path: '/wallet',
    name: 'wallet',
    component: () => import('@/views/WalletView.vue'),
  },
  {
    path: '/monetization-shop',
    name: 'monetizationShop',
    component: () => import('@/views/MonetizationShopView.vue'),
  },
  {
    path: '/dac-quyen',
    name: 'monetizationDacQuyen',
    component: () => import('@/views/MonetizationDacQuyenView.vue'),
  },
  {
    path: '/shop-packs',
    name: 'shopPacks',
    component: () => import('@/views/ShopPacksView.vue'),
  },
  {
    path: '/cosmetics',
    name: 'cosmetics',
    component: () => import('@/views/CosmeticView.vue'),
  },
  {
    path: '/admin',
    name: 'admin',
    component: () => import('@/views/AdminView.vue'),
  },
  {
    path: '/admin/control-center',
    name: 'adminControlCenter',
    component: () => import('@/views/AdminControlCenterView.vue'),
  },
  {
    path: '/admin/event-builder',
    name: 'adminEventBuilder',
    component: () => import('@/views/AdminEventBuilderView.vue'),
  },
  {
    path: '/events',
    name: 'events',
    component: () => import('@/views/EventsView.vue'),
  },
  {
    path: '/pvp',
    name: 'pvp',
    component: () => import('@/views/PvpView.vue'),
  },
  {
    path: '/admin/pvp',
    name: 'adminPvp',
    component: () => import('@/views/AdminPvpCenterView.vue'),
  },
  {
    path: '/market-v2',
    name: 'marketV2',
    component: () => import('@/views/MarketV2View.vue'),
    beforeEnter: featureFlagGuard('AUCTION_HOUSE_ENABLED'),
  },
  {
    path: '/codex',
    name: 'codex',
    component: () => import('@/views/CodexView.vue'),
  },
  {
    path: '/admin/market-v2',
    name: 'adminMarketV2',
    component: () => import('@/views/AdminMarketV2View.vue'),
  },
  {
    path: '/admin/codex',
    name: 'adminCodex',
    component: () => import('@/views/AdminCodexView.vue'),
  },
  {
    path: '/admin/achievement-reputation',
    name: 'adminAchievementReputation',
    component: () => import('@/views/AdminAchievementReputationView.vue'),
  },
  {
    path: '/pets',
    name: 'pets',
    component: () => import('@/views/PetsView.vue'),
  },
  {
    path: '/admin/pets',
    name: 'adminPets',
    component: () => import('@/views/AdminPetsView.vue'),
  },
  {
    path: '/profile/:id',
    name: 'profile',
    component: () => import('@/views/ProfileView.vue'),
  },
  {
    path: '/activity',
    name: 'activity',
    component: () => import('@/views/ActivityView.vue'),
  },
  {
    path: '/leaderboard',
    name: 'leaderboard',
    component: () => import('@/views/LeaderboardView.vue'),
  },
  {
    path: '/arena',
    name: 'arena',
    component: () => import('@/views/ArenaView.vue'),
  },
  {
    path: '/settings',
    name: 'settings',
    component: () => import('@/views/SettingsView.vue'),
  },
  {
    path: '/talents',
    name: 'talents',
    component: () => import('@/views/TalentCatalogView.vue'),
  },
  {
    path: '/alchemy',
    name: 'alchemy',
    component: () => import('@/views/AlchemyView.vue'),
  },
  {
    path: '/homestead',
    name: 'homestead',
    component: () => import('@/views/HomesteadView.vue'),
  },
  {
    path: '/cultivation-method',
    name: 'cultivation-method',
    component: () => import('@/views/CultivationMethodView.vue'),
  },
  {
    path: '/artifact-v2',
    name: 'artifact-v2',
    component: () => import('@/views/ArtifactV2View.vue'),
  },
  {
    path: '/cultivation-method-v2',
    name: 'cultivation-method-v2',
    component: () => import('@/views/CultivationMethodV2View.vue'),
  },
  {
    path: '/body-cultivation',
    name: 'body-cultivation',
    component: () => import('@/views/BodyCultivationView.vue'),
  },
  {
    path: '/spiritual-root',
    name: 'spiritual-root',
    component: () => import('@/views/SpiritualRootView.vue'),
  },
  {
    path: '/skill-book',
    name: 'skill-book',
    component: () => import('@/views/SkillBookView.vue'),
  },
  {
    path: '/skills',
    name: 'skills',
    redirect: '/skill-book',
  },
  {
    path: '/methods',
    name: 'methods',
    redirect: '/cultivation-method',
  },
  {
    path: '/cultivation-methods',
    name: 'cultivation-methods',
    redirect: '/cultivation-method',
  },
  {
    path: '/spiritual-roots',
    name: 'spiritual-roots',
    redirect: '/spiritual-root',
  },
  {
    path: '/achievements',
    name: 'achievements',
    component: () => import('@/views/AchievementView.vue'),
  },
  {
    path: '/titles',
    name: 'titles',
    component: () => import('@/views/TitleView.vue'),
  },
  {
    path: '/reputation',
    name: 'reputation',
    component: () => import('@/views/ReputationView.vue'),
  },
  {
    path: '/tribulation',
    name: 'tribulation',
    component: () => import('@/views/TribulationView.vue'),
  },
  {
    path: '/breakthrough',
    name: 'breakthrough',
    component: () => import('@/views/BreakthroughView.vue'),
  },
  {
    path: '/npcs',
    name: 'npcs',
    component: () => import('@/views/NpcView.vue'),
  },
  {
    path: '/quests',
    name: 'quests',
    component: () => import('@/views/QuestView.vue'),
  },
  {
    // Phase 33.2 — Story V2 (Tu Tiên Lộ Quyển II–IV) StoryV2View.
    path: '/story-v2',
    name: 'story-v2',
    component: () => import('@/views/StoryV2View.vue'),
    beforeEnter: featureFlagGuard('STORY_V2_ENABLED'),
  },
  {
    // Phase 34.0 — 7-Day Onboarding Questline.
    path: '/onboarding-quest',
    name: 'onboarding-quest',
    component: () => import('@/views/OnboardingQuestView.vue'),
  },
  {
    // Phase 34.1 — Daily Random Encounter / Kỳ Ngộ.
    path: '/encounter',
    name: 'encounter',
    component: () => import('@/views/EncounterView.vue'),
  },
  {
    // Phase 34.2 — Secret Realm / Bí Cảnh.
    path: '/secret-realm',
    name: 'secret-realm',
    component: () => import('@/views/SecretRealmView.vue'),
  },
  {
    path: '/secret-realms',
    name: 'secret-realms',
    redirect: '/secret-realm',
  },
  {
    path: '/spirit-pets',
    name: 'spirit-pets',
    redirect: '/pets',
  },
  // Phase 15.16 (PR #628) — `/notifications` is now a real Notification
  // Center view aggregating notifications + mail into a unified feed with
  // category filters and an online-friends presence widget sidebar.
  {
    path: '/notifications',
    name: 'notifications',
    component: () => import('@/views/NotificationCenterView.vue'),
  },
  {
    // Phase 34.3 — Inventory Auto-sort & Lock.
    path: '/inventory-auto-sort',
    name: 'inventory-auto-sort',
    component: () => import('@/views/InventoryAutoSortView.vue'),
  },
  {
    path: '/social',
    name: 'social',
    component: () => import('@/views/SocialView.vue'),
  },
  // Phase 19.4+ (PR #629) — Party Hub + Party Dungeon + Co-op Boss surfaces.
  {
    path: '/party',
    name: 'party',
    component: () => import('@/views/PartyHubView.vue'),
  },
  {
    path: '/party/dungeon',
    name: 'party-dungeon',
    component: () => import('@/views/PartyDungeonView.vue'),
  },
  {
    path: '/party/coop-boss',
    name: 'party-coop-boss',
    component: () => import('@/views/CoopBossView.vue'),
  },
  {
    path: '/mentor',
    name: 'mentor',
    component: () => import('@/views/MentorView.vue'),
  },
  {
    path: '/returner',
    name: 'returner',
    component: () => import('@/views/ReturnerView.vue'),
  },
  {
    path: '/admin/mail',
    name: 'admin-mail',
    component: () => import('@/views/AdminMailView.vue'),
  },
  {
    path: '/world',
    name: 'world-content',
    component: () => import('@/views/WorldContentView.vue'),
  },
  {
    path: '/world/farm-maps',
    name: 'world-farm-maps',
    component: () => import('@/views/FarmMapView.vue'),
  },
  {
    path: '/world/dungeons',
    name: 'world-dungeons-v2',
    component: () => import('@/views/DungeonHubV2View.vue'),
  },
  {
    path: '/dungeons',
    name: 'dungeons',
    redirect: '/world/dungeons',
  },
  {
    path: '/world/bosses',
    name: 'world-bosses-v2',
    component: () => import('@/views/BossHubView.vue'),
  },
  {
    path: '/world/sect',
    name: 'world-sect',
    component: () => import('@/views/SectContentView.vue'),
  },
  {
    path: '/world/towers',
    name: 'world-trial-tower',
    component: () => import('@/views/TrialTowerView.vue'),
  },
  {
    path: '/tower',
    name: 'tower',
    redirect: '/world/towers',
  },
  // Phase 41.0 — Player Experience QoL V1 (dashboard, feedback, report,
  // logs viewer). KHÔNG đụng gameplay routes; layout chuẩn AppShell.
  {
    path: '/dashboard',
    name: 'dashboard',
    component: () => import('@/views/DashboardView.vue'),
  },
  {
    path: '/support/feedback',
    name: 'support-feedback',
    component: () => import('@/views/FeedbackView.vue'),
  },
  {
    path: '/support/report-player',
    name: 'support-report-player',
    component: () => import('@/views/ReportPlayerView.vue'),
  },
  {
    path: '/support/logs',
    name: 'support-logs',
    component: () => import('@/views/PlayerLogsView.vue'),
  },
  {
    path: '/admin/feedback',
    name: 'admin-feedback',
    component: () => import('@/views/AdminFeedbackView.vue'),
  },
  {
    path: '/admin/reports',
    name: 'admin-reports',
    component: () => import('@/views/AdminReportsView.vue'),
  },
  // Phase 42.0 — Visual effects developer preview lab.
  {
    path: '/dev/effects-preview',
    name: 'dev-effects-preview',
    component: () => import('@/views/EffectsPreviewView.vue'),
  },
  {
    // Phase 43 — Admin System Status (health + version + recent errors +
    // integrity last-run, read-only).
    path: '/admin/system-status',
    name: 'admin-system-status',
    component: () => import('@/views/AdminSystemStatusView.vue'),
  },
  {
    // Phase 15.8 — Admin Hall of Fame (sect season history + reward
    // grant status + champion snapshot meta, read-only ADMIN-only).
    path: '/admin/hall-of-fame',
    name: 'admin-hall-of-fame',
    component: () => import('@/views/AdminHallOfFameView.vue'),
  },
  {
    path: '/:pathMatch(.*)*',
    name: 'not-found',
    component: () => import('@/views/NotFoundView.vue'),
    meta: { public: true },
  },
];

const router = createRouter({
  history: createWebHistory(),
  routes,
});

export default router;
