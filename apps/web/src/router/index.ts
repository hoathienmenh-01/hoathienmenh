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
    path: '/inventory',
    name: 'inventory',
    component: () => import('@/views/InventoryView.vue'),
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
    path: '/admin',
    name: 'admin',
    component: () => import('@/views/AdminView.vue'),
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
