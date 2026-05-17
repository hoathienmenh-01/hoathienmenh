import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { createI18n } from 'vue-i18n';
import { setActivePinia, createPinia } from 'pinia';

/**
 * Phase 34.0 PR2 — OnboardingQuestView polished tests.
 *
 * Verify step progress bar, deep-link CTAs, day state rendering,
 * loading state, and task action dispatch.
 */

const fetchProgressMock = vi.fn();
const completeTaskMock = vi.fn();
const claimTaskMock = vi.fn();

vi.mock('@/api/onboardingQuest', () => ({
  fetchOnboardingProgress: (...a: unknown[]) => fetchProgressMock(...a),
  fetchOnboardingDay: vi.fn(),
  acceptOnboardingTask: vi.fn(),
  completeOnboardingTask: (...a: unknown[]) => completeTaskMock(...a),
  claimOnboardingTask: (...a: unknown[]) => claimTaskMock(...a),
  recomputeOnboarding: vi.fn(),
}));

const toastPushMock = vi.fn();
vi.mock('@/stores/toast', () => ({
  useToastStore: () => ({ push: toastPushMock }),
}));

vi.mock('@/stores/auth', () => ({
  useAuthStore: () => ({
    user: { id: 'u1' },
    hydrate: vi.fn().mockResolvedValue(undefined),
  }),
}));

const routerPushMock = vi.fn().mockResolvedValue(undefined);
vi.mock('vue-router', () => ({
  useRouter: () => ({ push: routerPushMock, replace: vi.fn() }),
}));

vi.mock('@/components/shell/AppShell.vue', () => ({
  default: {
    name: 'AppShellStub',
    template: '<div data-testid="app-shell"><slot /></div>',
  },
}));

vi.mock('@/components/xianxia/XTLuxHero.vue', () => ({
  default: {
    name: 'XTLuxHeroStub',
    props: ['eyebrow', 'label', 'title', 'subtitle', 'tone', 'watermarkLetter', 'breadcrumb', 'testId'],
    template: '<div data-testid="hero"><slot /></div>',
  },
}));

vi.mock('@/components/xianxia/XTPageEyebrow.vue', () => ({
  default: {
    name: 'XTPageEyebrowStub',
    template: '<span />',
  },
}));

import OnboardingQuestView from '@/views/OnboardingQuestView.vue';
import { useOnboardingQuestStore } from '@/stores/onboardingQuest';

const MOCK_PROGRESS = {
  totalDays: 7,
  totalTasks: 26,
  completedTasks: 7,
  claimedTasks: 5,
  days: [
    {
      dayNumber: 1,
      titleVi: 'Khởi đầu',
      titleEn: 'Beginning',
      themeVi: 'Bắt đầu',
      themeEn: 'Start',
      status: 'COMPLETED',
      unlockedAt: '2026-01-01T00:00:00Z',
      completedAt: '2026-01-01T12:00:00Z',
      totalTasks: 5,
      completedTasks: 5,
      claimedTasks: 5,
      tasks: [],
    },
    {
      dayNumber: 2,
      titleVi: 'Tu luyện',
      titleEn: 'Cultivation',
      themeVi: 'Hoc tu luyen',
      themeEn: 'Learn cultivation',
      status: 'IN_PROGRESS',
      unlockedAt: '2026-01-02T00:00:00Z',
      completedAt: null,
      totalTasks: 4,
      completedTasks: 2,
      claimedTasks: 0,
      tasks: [
        {
          taskKey: 'd2_check_spiritual_root',
          dayNumber: 2,
          titleVi: 'Xem linh căn',
          titleEn: 'Check spiritual root',
          descriptionVi: 'Xem linh căn',
          descriptionEn: 'Check your spiritual root',
          actionRoute: '/spiritual-root',
          category: 'cultivation',
          status: 'AVAILABLE',
          completedAt: null,
          claimedAt: null,
          reward: { linhThach: 100, exp: 0 },
        },
        {
          taskKey: 'd2_equip_weapon',
          dayNumber: 2,
          titleVi: 'Trang bị',
          titleEn: 'Equip weapon',
          descriptionVi: 'Trang bị vũ khí',
          descriptionEn: 'Equip weapon',
          actionRoute: '/inventory',
          category: 'combat',
          status: 'COMPLETED',
          completedAt: '2026-01-02T01:00:00Z',
          claimedAt: null,
          reward: { linhThach: 150, exp: 50 },
        },
      ],
    },
    {
      dayNumber: 3,
      titleVi: 'Chiến đấu',
      titleEn: 'Combat',
      themeVi: 'Chiến đấu',
      themeEn: 'Combat basics',
      status: 'LOCKED',
      unlockedAt: null,
      completedAt: null,
      totalTasks: 4,
      completedTasks: 0,
      claimedTasks: 0,
      tasks: [],
    },
  ],
};

function makeI18n() {
  return createI18n({
    legacy: false,
    locale: 'en',
    fallbackLocale: 'en',
    missingWarn: false,
    fallbackWarn: false,
    messages: {
      en: {
        luxHero: { onboardingQuest: { eyebrow: 'PATH', label: 'Path', breadcrumb: 'Home' } },
        onboardingQuest: {
          title: '7-Day Path',
          subtitle: 'Journey',
          overallProgress: '{claimed}/{total} ({pct}%)',
          dayLabel: 'Day {n}',
          doneCount: '{done}/{total} done',
          empty: 'No days.',
          back: 'Back',
          loading: 'Loading...',
          currentDayCta: 'You are here!',
          completeToast: 'Done: {name}',
          claimToast: 'Claimed +{linhThach} +{exp}',
          claimToastTitle: 'Claimed + {title}',
          dayStatus: { LOCKED: 'Locked', AVAILABLE: 'Available', IN_PROGRESS: 'In progress', COMPLETED: 'Completed' },
          taskStatus: { LOCKED: 'Locked', AVAILABLE: 'Ready', COMPLETED: 'Completed', CLAIMED: 'Claimed' },
          category: { tutorial: 'Tutorial', cultivation: 'Cultivation', combat: 'Combat', story: 'Story', social: 'Social', system: 'System' },
          actions: { open: 'Open', complete: 'Report', claim: 'Claim', claimed: 'Claimed' },
          cta: { dailyLogin: 'Go to Daily Login', inventory: 'Open Inventory', cultivation: 'Start Cultivating', quest: 'View Quests', profile: 'View Profile', spiritualRoot: 'Check Spiritual Root', combat: 'Enter Combat', dungeon: 'Explore Dungeon', story: 'Open Story', sect: 'Browse Sects', chat: 'Open Chat', mail: 'Check Mail', home: 'Go to Home' },
          reward: { linhThach: 'LT', exp: 'EXP', title: 'Title' },
          error: { UNKNOWN_ERROR: 'Unknown error' },
        },
      },
    },
  });
}

function mountView() {
  return mount(OnboardingQuestView, {
    attachTo: document.body,
    global: { plugins: [makeI18n()] },
  });
}

describe('OnboardingQuestView (polished)', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    fetchProgressMock.mockReset();
    completeTaskMock.mockReset();
    claimTaskMock.mockReset();
    toastPushMock.mockReset();
    routerPushMock.mockClear();
    fetchProgressMock.mockResolvedValue(MOCK_PROGRESS);
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('renders step progress bar when loaded', async () => {
    const wrapper = mountView();
    const store = useOnboardingQuestStore();
    store.progress = MOCK_PROGRESS as never;
    store.loaded = true;
    await flushPromises();

    expect(wrapper.find('[data-testid="onboarding-step-progress"]').exists()).toBe(true);
  });

  it('renders day cards with correct status text', async () => {
    const wrapper = mountView();
    const store = useOnboardingQuestStore();
    store.progress = MOCK_PROGRESS as never;
    store.loaded = true;
    await flushPromises();

    const day1 = wrapper.find('[data-testid="onboarding-day-card-1"]');
    expect(day1.exists()).toBe(true);
    expect(day1.text()).toContain('Completed');

    const day2 = wrapper.find('[data-testid="onboarding-day-card-2"]');
    expect(day2.text()).toContain('In progress');
  });

  it('shows current day CTA on active day', async () => {
    const wrapper = mountView();
    const store = useOnboardingQuestStore();
    store.progress = MOCK_PROGRESS as never;
    store.loaded = true;
    await flushPromises();

    expect(wrapper.find('[data-testid="onboarding-current-day-cta"]').text()).toContain('You are here!');
  });

  it('locked day is disabled', async () => {
    const wrapper = mountView();
    const store = useOnboardingQuestStore();
    store.progress = MOCK_PROGRESS as never;
    store.loaded = true;
    await flushPromises();

    const day3 = wrapper.find('[data-testid="onboarding-day-card-3"]');
    expect((day3.element as HTMLButtonElement).disabled).toBe(true);
  });

  it('clicking day opens detail with tasks', async () => {
    const wrapper = mountView();
    const store = useOnboardingQuestStore();
    store.progress = MOCK_PROGRESS as never;
    store.loaded = true;
    await flushPromises();

    await wrapper.find('[data-testid="onboarding-day-card-2"]').trigger('click');
    await flushPromises();

    expect(wrapper.find('[data-testid="onboarding-task-d2_check_spiritual_root"]').exists()).toBe(true);
  });

  it('deep-link CTA has route-specific label', async () => {
    const wrapper = mountView();
    const store = useOnboardingQuestStore();
    store.progress = MOCK_PROGRESS as never;
    store.loaded = true;
    await flushPromises();

    await wrapper.find('[data-testid="onboarding-day-card-2"]').trigger('click');
    await flushPromises();

    const btn = wrapper.find('[data-testid="onboarding-open-d2_check_spiritual_root"]');
    expect(btn.text()).toContain('Check Spiritual Root');
  });

  it('CTA navigates to correct route', async () => {
    const wrapper = mountView();
    const store = useOnboardingQuestStore();
    store.progress = MOCK_PROGRESS as never;
    store.loaded = true;
    await flushPromises();

    await wrapper.find('[data-testid="onboarding-day-card-2"]').trigger('click');
    await flushPromises();

    await wrapper.find('[data-testid="onboarding-open-d2_check_spiritual_root"]').trigger('click');
    await flushPromises();

    expect(routerPushMock).toHaveBeenCalledWith('/spiritual-root');
  });

  it('loading state shows spinner', async () => {
    fetchProgressMock.mockReturnValue(new Promise(() => {})); // Never resolves
    const wrapper = mountView();
    const store = useOnboardingQuestStore();
    store.loading = true;
    store.loaded = false;
    await flushPromises();

    expect(wrapper.find('[data-testid="onboarding-loading"]').exists()).toBe(true);
  });

  it('back button returns to grid', async () => {
    const wrapper = mountView();
    const store = useOnboardingQuestStore();
    store.progress = MOCK_PROGRESS as never;
    store.loaded = true;
    await flushPromises();

    await wrapper.find('[data-testid="onboarding-day-card-2"]').trigger('click');
    await flushPromises();

    await wrapper.find('[data-testid="onboarding-back"]').trigger('click');
    await flushPromises();

    expect(wrapper.find('[data-testid="onboarding-day-grid"]').exists()).toBe(true);
  });

  it('complete button calls store.completeTask', async () => {
    const wrapper = mountView();
    const store = useOnboardingQuestStore();
    store.progress = MOCK_PROGRESS as never;
    store.loaded = true;
    const spy = vi.spyOn(store, 'completeTask').mockResolvedValue();
    await flushPromises();

    await wrapper.find('[data-testid="onboarding-day-card-2"]').trigger('click');
    await flushPromises();

    await wrapper.find('[data-testid="onboarding-complete-d2_check_spiritual_root"]').trigger('click');
    await flushPromises();

    expect(spy).toHaveBeenCalledWith('d2_check_spiritual_root');
  });

  it('claim button calls store.claimTask', async () => {
    const wrapper = mountView();
    const store = useOnboardingQuestStore();
    store.progress = MOCK_PROGRESS as never;
    store.loaded = true;
    const spy = vi.spyOn(store, 'claimTask').mockResolvedValue();
    await flushPromises();

    await wrapper.find('[data-testid="onboarding-day-card-2"]').trigger('click');
    await flushPromises();

    await wrapper.find('[data-testid="onboarding-claim-d2_equip_weapon"]').trigger('click');
    await flushPromises();

    expect(spy).toHaveBeenCalledWith('d2_equip_weapon');
  });
});
