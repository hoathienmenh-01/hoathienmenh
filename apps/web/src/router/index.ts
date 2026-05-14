import { createRouter, createWebHistory, type RouteRecordRaw } from 'vue-router';

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
